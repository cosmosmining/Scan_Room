#!/usr/bin/env python3
"""
Convert the iPad app's USDZ product models to glTF, so the browser renders the
SAME cabinets the iPad does.

  pip install usd-core pygltflib
  python3 scripts/usdz-to-glb.py

Three.js cannot read USDZ, and 29 of the 40 bundled models are binary USD crate
files, so there is no way to reach them from the web without a real USD reader.
This runs once and commits its output; nobody needs USD tooling to build the
site.

WHAT IT HAS TO GET RIGHT

The models are authored inconsistently — some Z-up in millimetres (declared as
metres), some Y-up in metres — and the iPad papers over this at load time in
`Design/Render/ModelLoader.swift`. The same rules are applied here, in the same
order, or a cabinet is the wrong size or lying on its side:

  1. Up-axis. USD Z-up means (x, y, z) -> (x, z, -y) for glTF's Y-up.
  2. Scale. `normalize` corrects only a GROSS mismatch against the catalogue
     size — `ratio > 3 || ratio < 0.34` — and does it uniformly. Per-axis
     fitting would distort a cabinet whose real proportions differ slightly
     from the catalogue figure, and a 5% mismatch is the real cabinet, not an
     error to "fix".
  3. Origin. Base at y = 0, footprint centred on the origin.

Output is in MILLIMETRES, which is what the web scene authors in, and what
`public/models/cad-base-600.glb` already uses.
"""

import json
import struct
import sys
import zipfile
from pathlib import Path

from pxr import Usd, UsdGeom, UsdShade, Gf

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "apps/ios/MozuScanner/Resources/Models"
DEST = ROOT / "public/models/mozu"
CATALOG = ROOT / "src/systems/furniture/catalog.ts"


def catalogue_sizes():
    """Target sizes in millimetres, read from the web catalogue (w, h, d)."""
    import re

    text = CATALOG.read_text()
    sizes = {}
    for chunk in text.split("{ id: '")[1:]:
        ident = chunk.split("'", 1)[0]
        m = re.search(r"size: m\(([\d.]+), ([\d.]+), ([\d.]+)\)", chunk)
        if m:
            sizes[ident] = tuple(round(float(m.group(i)) * 1000) for i in (1, 2, 3))
    return sizes


def triangulate(counts, indices):
    """Fan-triangulate arbitrary polygons, yielding (a, b, c) corner ordinals."""
    out = []
    cursor = 0
    for n in counts:
        for i in range(1, n - 1):
            out.append((cursor, cursor + i, cursor + i + 1))
        cursor += n
    return out


def surface_inputs(prim):
    """UsdPreviewSurface inputs of the material bound to `prim`."""
    material = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()[0]
    if not material:
        return {}
    source = material.ComputeSurfaceSource()[0]
    if not source:
        return {}
    values = {}
    for inp in source.GetInputs():
        v = inp.Get()
        if v is not None:
            values[inp.GetBaseName()] = v
    return values


def read_meshes(stage):
    """Every mesh, world-baked, in Y-up: (positions, normals, tris, material)."""
    z_up = UsdGeom.GetStageUpAxis(stage) == UsdGeom.Tokens.z
    meshes = []

    for prim in stage.Traverse():
        if not prim.IsA(UsdGeom.Mesh):
            continue
        mesh = UsdGeom.Mesh(prim)
        points = mesh.GetPointsAttr().Get()
        counts = mesh.GetFaceVertexCountsAttr().Get()
        indices = mesh.GetFaceVertexIndicesAttr().Get()
        if not points or not counts or not indices:
            continue

        xform = UsdGeom.Xformable(prim).ComputeLocalToWorldTransform(Usd.TimeCode.Default())
        normals = mesh.GetNormalsAttr().Get()
        interp = mesh.GetNormalsInterpolation() if normals else None

        def convert(v):
            return (v[0], v[2], -v[1]) if z_up else (v[0], v[1], v[2])

        world = [convert(xform.Transform(Gf.Vec3d(p))) for p in points]
        # Normals transform by the inverse-transpose; these models carry no
        # shear, but doing it properly costs nothing and cannot be wrong.
        nxf = xform.GetInverse().GetTranspose()

        def convert_normal(v):
            w = nxf.TransformDir(Gf.Vec3d(v))
            length = w.GetLength() or 1.0
            w = w / length
            return (w[0], w[2], -w[1]) if z_up else (w[0], w[1], w[2])

        # Rebuild as (position, normal) pairs, deduped: with faceVarying normals
        # a corner's normal depends on its face, so a shared point can carry
        # several. Deduping keeps hard edges hard without exploding the file.
        lookup = {}
        positions, out_normals, tris = [], [], []
        for a, b, c in triangulate(counts, indices):
            tri = []
            for corner in (a, b, c):
                point_index = indices[corner]
                pos = world[point_index]
                if normals is None:
                    nrm = (0.0, 0.0, 0.0)
                elif interp == UsdGeom.Tokens.faceVarying:
                    nrm = convert_normal(normals[corner])
                elif interp == UsdGeom.Tokens.uniform:
                    nrm = convert_normal(normals[0])
                else:
                    nrm = convert_normal(normals[point_index])
                # Round the normal before deduping. These are scan-derived
                # meshes where nearly every corner carries a minutely different
                # normal, so an exact key shares almost nothing and the file is
                # a third larger for a difference no eye can see.
                key = (pos, tuple(round(v, 2) for v in nrm))
                idx = lookup.get(key)
                if idx is None:
                    idx = len(positions)
                    lookup[key] = idx
                    positions.append(pos)
                    out_normals.append(nrm)
                tri.append(idx)
            tris.append(tuple(tri))

        # These models are authored double-sided, and they mean it: a cabinet
        # door is a thin single-thickness panel whose back face is a real
        # surface. Rendered single-sided it disappears from one side and you
        # look straight into the carcass.
        double_sided = bool(mesh.GetDoubleSidedAttr().Get())
        if mesh.GetOrientationAttr().Get() == UsdGeom.Tokens.leftHanded:
            tris = [(a, c, b) for (a, b, c) in tris]

        meshes.append({
            "positions": positions,
            "normals": out_normals if normals is not None else None,
            "tris": tris,
            "doubleSided": double_sided,
            "material": surface_inputs(prim),
        })
    return meshes


def normalise(meshes, target_mm):
    """
    Apply `ModelLoader.normalize`: correct only an order-of-magnitude scale
    error against the catalogue size, then seat the base at y = 0 with the
    footprint centred. Returns the scale that also converts to millimetres.
    """
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    for mesh in meshes:
        for p in mesh["positions"]:
            for i in range(3):
                lo[i] = min(lo[i], p[i])
                hi[i] = max(hi[i], p[i])
    if lo[0] > hi[0]:
        return

    extents = [hi[i] - lo[i] for i in range(3)]
    # The catalogue is millimetres; the models claim metres. Compare in metres,
    # exactly as the iPad does, then convert the whole thing to millimetres at
    # the end.
    target_m = max(target_mm) / 1000.0
    largest = max(extents)
    scale = 1.0
    if largest > 1e-4 and target_m > 1e-4:
        ratio = target_m / largest
        if ratio > 3 or ratio < 0.34:
            scale = ratio

    centre = [(lo[i] + hi[i]) / 2 for i in range(3)]
    offset = (-centre[0] * scale, -lo[1] * scale, -centre[2] * scale)

    for mesh in meshes:
        mesh["positions"] = [
            ((p[0] * scale + offset[0]) * 1000,
             (p[1] * scale + offset[1]) * 1000,
             (p[2] * scale + offset[2]) * 1000)
            for p in mesh["positions"]
        ]


def write_glb(meshes, path):
    """A minimal, self-contained GLB: one primitive and one material per mesh."""
    buffer = bytearray()
    accessors, buffer_views, primitives, materials = [], [], [], []

    def view(data, target):
        while len(buffer) % 4:
            buffer.append(0)
        offset = len(buffer)
        buffer.extend(data)
        buffer_views.append({"buffer": 0, "byteOffset": offset,
                             "byteLength": len(data), "target": target})
        return len(buffer_views) - 1

    for mesh in meshes:
        positions = mesh["positions"]
        if not positions or not mesh["tris"]:
            continue
        lo = [min(p[i] for p in positions) for i in range(3)]
        hi = [max(p[i] for p in positions) for i in range(3)]

        pos_view = view(struct.pack(f"<{len(positions) * 3}f",
                                    *[c for p in positions for c in p]), 34962)
        accessors.append({"bufferView": pos_view, "componentType": 5126,
                          "count": len(positions), "type": "VEC3",
                          "min": lo, "max": hi})
        attributes = {"POSITION": len(accessors) - 1}

        if mesh["normals"]:
            # Normals as normalized shorts: half the bytes, and 1/32767 of a
            # unit is far finer than any shading difference a screen can show.
            quantized = [max(-32767, min(32767, int(round(c * 32767))))
                         for n in mesh["normals"] for c in n]
            nrm_view = view(struct.pack(f"<{len(quantized)}h", *quantized), 34962)
            accessors.append({"bufferView": nrm_view, "componentType": 5122,
                              "normalized": True, "count": len(mesh["normals"]),
                              "type": "VEC3"})
            attributes["NORMAL"] = len(accessors) - 1

        flat = [i for tri in mesh["tris"] for i in tri]
        wide = len(positions) > 65535
        packed = struct.pack(f"<{len(flat)}{'I' if wide else 'H'}", *flat)
        idx_view = view(packed, 34963)
        accessors.append({"bufferView": idx_view, "componentType": 5125 if wide else 5123,
                          "count": len(flat), "type": "SCALAR"})

        m = mesh["material"]
        colour = m.get("diffuseColor") or (0.8, 0.8, 0.8)
        opacity = float(m.get("opacity", 1.0))
        materials.append({
            "pbrMetallicRoughness": {
                "baseColorFactor": [float(colour[0]), float(colour[1]), float(colour[2]), opacity],
                "metallicFactor": float(m.get("metallic", 0.0)),
                "roughnessFactor": float(m.get("roughness", 0.8)),
            },
            "doubleSided": bool(mesh.get("doubleSided", True)),
            **({"alphaMode": "BLEND"} if opacity < 1 else {}),
        })
        primitives.append({"attributes": attributes, "indices": len(accessors) - 1,
                           "material": len(materials) - 1})

    if not primitives:
        return False

    gltf = {
        "asset": {"version": "2.0", "generator": "mozu usdz-to-glb"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": primitives}],
        "accessors": accessors,
        "bufferViews": buffer_views,
        "materials": materials,
        "buffers": [{"byteLength": len(buffer)}],
    }

    json_chunk = json.dumps(gltf, separators=(",", ":")).encode()
    json_chunk += b" " * (-len(json_chunk) % 4)
    bin_chunk = bytes(buffer) + b"\0" * (-len(buffer) % 4)

    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2,
                            12 + 8 + len(json_chunk) + 8 + len(bin_chunk)))
        f.write(struct.pack("<II", len(json_chunk), 0x4E4F534A))
        f.write(json_chunk)
        f.write(struct.pack("<II", len(bin_chunk), 0x004E4942))
        f.write(bin_chunk)
    return True


def main():
    sizes = catalogue_sizes()
    DEST.mkdir(parents=True, exist_ok=True)
    total = 0
    converted = 0

    for source in sorted(SOURCE.glob("*.usdz")):
        ident = source.stem
        target = sizes.get(ident)
        if not target:
            print(f"  skip {ident}: not in the web catalogue")
            continue
        try:
            stage = Usd.Stage.Open(str(source))
            meshes = read_meshes(stage)
            if not meshes:
                print(f"  skip {ident}: no meshes")
                continue
            normalise(meshes, target)
            out = DEST / f"{ident}.glb"
            if not write_glb(meshes, out):
                print(f"  skip {ident}: nothing to write")
                continue
            size = out.stat().st_size
            total += size
            converted += 1
            tris = sum(len(m["tris"]) for m in meshes)
            print(f"  {ident}: {len(meshes)} mesh, {tris} tris, {size // 1024} KB")
        except Exception as exc:  # noqa: BLE001 — report and keep going
            print(f"  FAIL {ident}: {exc}", file=sys.stderr)

    print(f"{converted} models, {total / 1e6:.1f} MB total -> {DEST.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
