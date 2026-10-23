#!/usr/bin/env python3
"""Path-trace a MOZU design (the user's exact scanned room + placed furniture) with
Blender Cycles and write a photoreal PNG. This is the server-side "Render Photoreal"
worker: the iPad app posts the live design as JSON, the render server (render-server.mjs)
invokes this, and the resulting image is sent back to the device.

  python3 blender_render_design.py -- <request.json> <out.png> [models_dir] [tex_dir]

REQUEST JSON  (mozu.render/1 — mirrored by PhotorealRenderer.swift on the device).
All coordinates are in the iOS design space: METRES, floor plane X (right) / Z
(forward), Y up. We convert to Blender's Z-up here.
  {
    "schema": "mozu.render/1",
    "room": {
      "footprint": [[x, z], ...],                 # closed floor polygon, metres
      "height": 2.7,
      "wall":    {"rgba":[r,g,b,a], "texture":"plaster"|null, "rough":0.9,  "metal":0.0, "tile":1.0},
      "floor":   {"rgba":[r,g,b,a], "texture":"oak"|null,     "rough":0.35, "metal":0.0, "tile":1.0},
      "ceiling": {"rgba":[r,g,b,a], "texture":null,           "rough":0.95, "metal":0.0, "tile":1.0}
    },
    "items": [
      {"model":"KF01"|null, "x":1.2, "z":0.4, "rotationY":0.0,
       "size":[w,h,d], "finish":{"rgba":[...],"texture":null,"rough":0.5,"metal":0.0}|null}
    ],
    "camera": {"pos":[x,y,z], "target":[x,y,z], "fovDeg":55},
    "render": {"width":1280, "height":800, "samples":128}
  }
"""
import json
import os
import sys

import bpy
import mathutils

# ── args ──
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
REQ = argv[0] if len(argv) > 0 else '/tmp/mozu_render.json'
OUT = argv[1] if len(argv) > 1 else '/tmp/mozu_render.png'
MODELS = argv[2] if len(argv) > 2 else 'apps/ios/MozuScanner/Resources/Models'
TEX = argv[3] if len(argv) > 3 else 'apps/ios/MozuScanner/Resources/Textures'

with open(REQ) as f:
    req = json.load(f)

room = req.get('room', {})
items = req.get('items', [])
cam_req = req.get('camera', {})
render_req = req.get('render', {})


def ios_to_blender(p):
    """iOS (x right, y up, z forward) → Blender (x right, y forward, z up)."""
    return (p[0], p[2], p[1])


# ── reset scene ──
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


# ── materials ──
def make_material(spec, name):
    """Principled BSDF from a finish spec: image texture (tiled per `tile` metres)
    when present and on disk, else a solid base colour; plus roughness / metalness."""
    spec = spec or {}
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = float(spec.get('rough', 0.5))
    bsdf.inputs['Metallic'].default_value = float(spec.get('metal', 0.0))

    rgba = spec.get('rgba') or [0.8, 0.8, 0.8, 1.0]
    tex_name = spec.get('texture')
    tex_path = os.path.join(TEX, f'{tex_name}.png') if tex_name else None

    if tex_path and os.path.exists(tex_path):
        try:
            img = bpy.data.images.load(tex_path)
            tex = nt.nodes.new('ShaderNodeTexImage')
            tex.image = img
            mapping = nt.nodes.new('ShaderNodeMapping')
            coord = nt.nodes.new('ShaderNodeTexCoord')
            tile = max(float(spec.get('tile', 1.0)), 1e-3)   # metres per repeat
            s = 1.0 / tile
            mapping.inputs['Scale'].default_value = (s, s, s)
            nt.links.new(coord.outputs['UV'], mapping.inputs['Vector'])
            nt.links.new(mapping.outputs['Vector'], tex.inputs['Vector'])
            # Tint the texture by the swatch colour (white = untinted) — matches the
            # device renderer, which multiplies the tint into textured materials.
            mix = nt.nodes.new('ShaderNodeMixRGB')
            mix.blend_type = 'MULTIPLY'
            mix.inputs['Fac'].default_value = 1.0
            mix.inputs['Color2'].default_value = (rgba[0], rgba[1], rgba[2], 1.0)
            nt.links.new(tex.outputs['Color'], mix.inputs['Color1'])
            nt.links.new(mix.outputs['Color'], bsdf.inputs['Base Color'])
            return m
        except Exception:
            pass

    bsdf.inputs['Base Color'].default_value = (rgba[0], rgba[1], rgba[2], 1.0)
    return m


def add_poly(name, verts, uvs, mat):
    """Build a single-face polygon mesh with explicit per-vertex UVs (in metres)."""
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], [list(range(len(verts)))])
    mesh.update()
    uv_layer = mesh.uv_layers.new(name='UVMap')
    for loop in mesh.loops:
        uv_layer.data[loop.index].uv = uvs[loop.vertex_index]
    obj = bpy.data.objects.new(name, mesh)
    obj.data.materials.append(mat)
    scene.collection.objects.link(obj)
    return obj


def import_model(mid, x, y, rot_z, finish):
    """Import a MOZU USDZ at Blender (x, y, base on z=0); rotate `rot_z` about Z.
    Keeps the model's authored materials unless `finish` overrides them."""
    path = os.path.join(MODELS, f'{mid}.usdz')
    if not os.path.exists(path):
        return None
    before = set(bpy.data.objects)
    try:
        bpy.ops.wm.usd_import(filepath=path)
    except Exception:
        return None
    imp = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    if not imp:
        return None
    for o in bpy.data.objects:
        o.select_set(False)
    for o in imp:
        o.select_set(True)
    bpy.context.view_layer.objects.active = imp[0]
    if len(imp) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    bpy.context.view_layer.update()

    # scale mm→m if the asset was authored in millimetres
    cs = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
    span = max(max(c[i] for c in cs) - min(c[i] for c in cs) for i in range(3))
    if span > 50:
        obj.scale = (0.001, 0.001, 0.001)
    obj.rotation_euler[2] = rot_z
    bpy.context.view_layer.update()

    # recentre: base on the floor (z=0), footprint centred on (x, y)
    cs = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
    minz = min(c.z for c in cs)
    cx = sum(c.x for c in cs) / 8
    cy = sum(c.y for c in cs) / 8
    obj.location.x += x - cx
    obj.location.y += y - cy
    obj.location.z += -minz

    if finish:
        mat = make_material(finish, f'{mid}_finish')
        obj.data.materials.clear()
        obj.data.materials.append(mat)
    return obj


def add_box(size, x, y, rot_z, finish):
    """Fallback box of real size when an item has no USDZ model."""
    w, h, d = size
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    obj = bpy.context.active_object
    obj.scale = (max(w, 0.01), max(d, 0.01), max(h, 0.01))   # iOS (w,h,d)->Blender (x,y,z)
    obj.rotation_euler[2] = rot_z
    obj.location = (x, y, max(h, 0.01) / 2)
    obj.data.materials.append(make_material(finish, 'box_finish'))
    return obj


# ── glass (real refractive glass under Cycles) ──
def set_bsdf_input(bsdf, names, value):
    """Set the first matching Principled input (names differ across Blender versions)."""
    for name in names:
        if name in bsdf.inputs:
            bsdf.inputs[name].default_value = value
            return


def glass_material():
    m = bpy.data.materials.new('window_glass')
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.92, 0.96, 1.0, 1.0)
    b.inputs['Roughness'].default_value = 0.03
    set_bsdf_input(b, ['Transmission Weight', 'Transmission'], 1.0)
    # Single-quad pane: there is no exit interface, so any IOR > 1 would bend
    # transmitted rays permanently (distorted view, deflected sunlight). IOR 1.0
    # is the thin-glass approximation that matches the geometry.
    set_bsdf_input(b, ['IOR'], 1.0)
    return m


GLASS = None


# ── room shell with openings cut out ──
def resolve_spans(openings, L, H):
    """Clamp openings onto a wall. `offset` is the distance to the opening CENTRE.
    Returns sorted spans (t0, t1, y0, y1, kind)."""
    spans = []
    for o in openings or []:
        w = float(o.get('width', 0))
        t0 = float(o.get('offset', 0)) - w / 2
        t1 = float(o.get('offset', 0)) + w / 2
        t0, t1 = max(t0, 0.02), min(t1, L - 0.02)
        if t1 - t0 < 0.05:
            continue
        kind = o.get('kind', 'door')
        y0 = max(float(o.get('sill', 0)), 0.05) if kind == 'window' else 0.0
        y1 = min(y0 + max(float(o.get('height', 2.0)), 0.1), H - 0.05)
        if y1 - y0 < 0.05:
            continue
        spans.append((t0, t1, y0, y1, kind))
    spans.sort(key=lambda s: s[0])
    merged = []
    for t0, t1, y0, y1, kind in spans:
        if merged and t0 < merged[-1][1] + 0.01:
            t0 = merged[-1][1] + 0.02
            if t1 - t0 < 0.05:
                continue
        merged.append((t0, t1, y0, y1, kind))
    return merged


def solid_rects(spans, L, H):
    """Wall face minus openings → solid rectangles (piers, headers, window aprons)."""
    rects = []
    cursor = 0.0
    for t0, t1, y0, y1, _ in spans:
        if t0 > cursor + 0.005:
            rects.append((cursor, t0, 0.0, H))
        if y1 < H - 0.005:
            rects.append((t0, t1, y1, H))
        if y0 > 0.005:
            rects.append((t0, t1, 0.0, y0))
        cursor = t1
    if cursor < L - 0.005:
        rects.append((cursor, L, 0.0, H))
    return rects or [(0.0, L, 0.0, H)]


def build_room_shell(prefix, footprint, H, openings, wall_mat, floor_mat, ceil_mat):
    """Floor + ceiling + opening-aware walls (+ glass panes) for one room."""
    global GLASS
    if len(footprint) < 3:
        return
    floor_v = [(p[0], p[1], 0.0) for p in footprint]
    floor_uv = [(p[0], p[1]) for p in footprint]
    add_poly(f'{prefix}_floor', floor_v, floor_uv, floor_mat)
    add_poly(f'{prefix}_ceiling', [(p[0], p[1], H) for p in footprint], floor_uv, ceil_mat)

    by_wall = {}
    for o in openings or []:
        by_wall.setdefault(int(o.get('wall', -1)), []).append(o)

    n = len(footprint)
    for i in range(n):
        a = footprint[i]
        b = footprint[(i + 1) % n]
        L = ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** 0.5
        if L < 1e-3:
            continue
        dx, dy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        spans = resolve_spans(by_wall.get(i, []), L, H)
        for j, (t0, t1, y0, y1) in enumerate(solid_rects(spans, L, H)):
            p0 = (a[0] + dx * t0, a[1] + dy * t0)
            p1 = (a[0] + dx * t1, a[1] + dy * t1)
            verts = [(p0[0], p0[1], y0), (p1[0], p1[1], y0), (p1[0], p1[1], y1), (p0[0], p0[1], y1)]
            uvs = [(t0, y0), (t1, y0), (t1, y1), (t0, y1)]
            add_poly(f'{prefix}_wall_{i}_{j}', verts, uvs, wall_mat)
        # Glass panes in the window openings (light streams through with refraction).
        for t0, t1, y0, y1, kind in spans:
            if kind != 'window':
                continue
            if GLASS is None:
                GLASS = glass_material()
            p0 = (a[0] + dx * t0, a[1] + dy * t0)
            p1 = (a[0] + dx * t1, a[1] + dy * t1)
            verts = [(p0[0], p0[1], y0), (p1[0], p1[1], y0), (p1[0], p1[1], y1), (p0[0], p0[1], y1)]
            uvs = [(0, 0), (1, 0), (1, 1), (0, 1)]
            pane = add_poly(f'{prefix}_glass_{i}', verts, uvs, GLASS)
            # A transmissive Principled surface is still opaque to shadow rays, which
            # would kill all direct sun/sky through the window; let shadows pass.
            # (Attribute is `visible_shadow` on Blender 3.0+; guard for renames.)
            if hasattr(pane, 'visible_shadow'):
                pane.visible_shadow = False


footprint = room.get('footprint', [])
H = float(room.get('height', 2.7))
build_room_shell('room', footprint, H, room.get('openings'),
                 make_material(room.get('wall'), 'wall'),
                 make_material(room.get('floor'), 'floor'),
                 make_material(room.get('ceiling'), 'ceiling'))

# Context rooms (whole-house mode): shells with sensible defaults.
for k, shell in enumerate(req.get('extraRooms') or []):
    build_room_shell(
        f'extra{k}',
        shell.get('footprint', []),
        float(shell.get('height', H)),
        shell.get('openings'),
        make_material({'rgba': [0.90, 0.88, 0.85, 1], 'texture': 'plaster', 'rough': 0.9}, f'extra{k}_wall'),
        make_material({'rgba': [1, 1, 1, 1], 'texture': 'oak', 'rough': 0.35}, f'extra{k}_floor'),
        make_material({'rgba': [0.92, 0.92, 0.90, 1], 'rough': 0.95}, f'extra{k}_ceiling'),
    )

# ── furniture ──
for it in items:
    bx, by, _ = ios_to_blender([it['x'], 0.0, it['z']])
    rot_z = -float(it.get('rotationY', 0.0))   # iOS yaw about +Y → Blender about +Z
    finish = it.get('finish')
    model = it.get('model')
    if model:
        if import_model(model, bx, by, rot_z, finish) is None:
            add_box(it.get('size', [0.5, 0.5, 0.5]), bx, by, rot_z, finish)
    else:
        add_box(it.get('size', [0.5, 0.5, 0.5]), bx, by, rot_z, finish)

# ── world / sky ──
world = bpy.data.worlds.new('w')
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes['Background']
bg.inputs['Color'].default_value = (0.62, 0.68, 0.78, 1)
bg.inputs['Strength'].default_value = 0.7

# ── sun (warm key) + soft sky area light ──
sun_d = bpy.data.lights.new('sun', 'SUN')
sun_d.energy = 3.2
sun_d.angle = 0.09           # soft shadows
sun_d.color = (1.0, 0.95, 0.86)
sun = bpy.data.objects.new('sun', sun_d)
scene.collection.objects.link(sun)
sun.rotation_euler = (0.85, 0.15, 2.2)

# ── camera ──
cam_d = bpy.data.cameras.new('cam')
cam_d.sensor_fit = 'VERTICAL'
cam_d.angle_y = (float(cam_req.get('fovDeg', 55.0))) * 3.14159265 / 180.0
cam = bpy.data.objects.new('cam', cam_d)
scene.collection.objects.link(cam)
scene.camera = cam

cam_pos = ios_to_blender(cam_req.get('pos', [3.0, 1.6, 3.0]))
cam_tgt = ios_to_blender(cam_req.get('target', [0.0, 1.0, 0.0]))
cam.location = cam_pos
look = mathutils.Vector(cam_tgt) - mathutils.Vector(cam_pos)
if look.length < 1e-5:
    look = mathutils.Vector((0, 1, 0))
cam.rotation_euler = look.to_track_quat('-Z', 'Y').to_euler()

# ── Cycles ──
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = int(render_req.get('samples', 128))
scene.cycles.use_denoising = True
try:
    scene.cycles.denoiser = 'OPENIMAGEDENOISE'
except Exception:
    pass
scene.view_settings.view_transform = 'AgX'
scene.render.resolution_x = int(render_req.get('width', 1280))
scene.render.resolution_y = int(render_req.get('height', 800))
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print('rendered', OUT)
