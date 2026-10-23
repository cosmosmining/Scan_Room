#!/usr/bin/env python3
"""Extract real meshes + per-prim material colours from a USDZ into JSON for the
renderer — so the demo shows the actual MOZU geometry (doors, knobs, all faces)
with correct per-part colours, not a flat-coloured STEP tessellation.

  python3 usd_extract.py <in.usdz> <out.json>
"""
import json
import sys
from pxr import Usd, UsdGeom, UsdShade, Gf


def diffuse_for(prim):
    """Bound material's UsdPreviewSurface diffuse colour, or a neutral default."""
    try:
        mat, _ = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()
        if mat:
            surf = mat.ComputeSurfaceSource()
            shader = surf[0] if isinstance(surf, tuple) else surf
            if shader:
                inp = UsdShade.Shader(shader.GetPrim()).GetInput('diffuseColor')
                if inp and inp.Get() is not None:
                    c = inp.Get()
                    return [float(c[0]), float(c[1]), float(c[2])]
    except Exception:
        pass
    return [0.82, 0.82, 0.80]


def extract(path):
    stage = Usd.Stage.Open(path)
    up = UsdGeom.GetStageUpAxis(stage)
    mpu = UsdGeom.GetStageMetersPerUnit(stage) or 1.0
    meshes = []
    for prim in stage.Traverse():
        if not prim.IsA(UsdGeom.Mesh):
            continue
        m = UsdGeom.Mesh(prim)
        pts = m.GetPointsAttr().Get()
        counts = m.GetFaceVertexCountsAttr().Get()
        idx = m.GetFaceVertexIndicesAttr().Get()
        if not pts or not counts or not idx:
            continue
        xf = UsdGeom.Xformable(prim).ComputeLocalToWorldTransform(Usd.TimeCode.Default())
        # world-space points, metres, Y-up
        wpts = []
        for p in pts:
            w = xf.Transform(Gf.Vec3f(p[0], p[1], p[2]))
            x, y, z = w[0] * mpu, w[1] * mpu, w[2] * mpu
            if up == 'Z':
                x, y, z = x, z, -y  # Z-up → Y-up
            wpts.append([x, y, z])
        # fan-triangulate each face
        tris = []
        o = 0
        for c in counts:
            for k in range(1, c - 1):
                tris.append([idx[o], idx[o + k], idx[o + k + 1]])
            o += c
        meshes.append({'color': diffuse_for(prim), 'pts': wpts, 'tris': tris})
    return meshes


def main():
    src, out = sys.argv[1], sys.argv[2]
    meshes = extract(src)
    # bbox over all meshes
    mn = [1e9, 1e9, 1e9]
    mx = [-1e9, -1e9, -1e9]
    ntri = 0
    for me in meshes:
        ntri += len(me['tris'])
        for p in me['pts']:
            for k in range(3):
                mn[k] = min(mn[k], p[k])
                mx[k] = max(mx[k], p[k])
    json.dump({'meshes': meshes, 'bbox': {'min': mn, 'max': mx}}, open(out, 'w'))
    size = [round(mx[k] - mn[k], 3) for k in range(3)]
    print(f"{src.split('/')[-1]}: {len(meshes)} parts, {ntri} tris, size {size} m")


if __name__ == '__main__':
    main()
