#!/usr/bin/env python3
"""Photorealistic MOZU kitchen rendered with Blender Cycles (path-traced GI).

Imports the real MOZU USDZ cabinets, builds the scanned room (3.6 x 2.81 m) with
PBR floor/wall materials and soft interior lighting, and renders with Cycles +
OpenImageDenoise.

  python3 blender_kitchen.py -- <out.png> [samples] [res_y]
"""
import sys
import bpy
import mathutils

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else '/tmp/blender_kitchen.png'
SAMPLES = int(argv[1]) if len(argv) > 1 else 96
RES_Y = int(argv[2]) if len(argv) > 2 else 720
MODELS = 'apps/ios/MozuScanner/Resources/Models'
TEX_WOOD = '/tmp/realtex/floor_wood.jpg'

# ── reset ──
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def pbr(name, base, rough=0.5, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*base, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


def wood_mat(name, path, scale=1.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = 0.35
    tex = nt.nodes.new('ShaderNodeTexImage')
    try:
        tex.image = bpy.data.images.load(path)
    except Exception:
        b.inputs['Base Color'].default_value = (0.5, 0.35, 0.2, 1)
        return m
    mp = nt.nodes.new('ShaderNodeMapping')
    co = nt.nodes.new('ShaderNodeTexCoord')
    mp.inputs['Scale'].default_value = (scale, scale, scale)
    nt.links.new(co.outputs['UV'], mp.inputs['Vector'])
    nt.links.new(mp.outputs['Vector'], tex.inputs['Vector'])
    nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    return m


def add_plane(name, verts, mat):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], [[0, 1, 2, 3]])
    mesh.update()
    # simple planar UVs
    mesh.uv_layers.new()
    obj = bpy.data.objects.new(name, mesh)
    obj.data.materials.append(mat)
    scene.collection.objects.link(obj)
    return obj


def import_model(mid, x, y, z, rot_z=0.0):
    """Import a MOZU USDZ; scale mm→m; sit base on z, centre on (x,y)."""
    before = set(bpy.data.objects)
    bpy.ops.wm.usd_import(filepath=f'{MODELS}/{mid}.usdz')
    imp = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    if not imp:
        return None
    # join
    for o in bpy.data.objects:
        o.select_set(False)
    for o in imp:
        o.select_set(True)
    bpy.context.view_layer.objects.active = imp[0]
    if len(imp) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    bpy.context.view_layer.update()
    # scale mm→m
    cs = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
    span = max(max(c[i] for c in cs) - min(c[i] for c in cs) for i in range(3))
    if span > 50:
        obj.scale = (0.001, 0.001, 0.001)
    obj.rotation_euler[2] = rot_z
    bpy.context.view_layer.update()
    # recentre: base at z, centred on x,y
    cs = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
    minz = min(c.z for c in cs)
    cx = sum(c.x for c in cs) / 8
    cy = sum(c.y for c in cs) / 8
    obj.location.x += x - cx
    obj.location.y += y - cy
    obj.location.z += z - minz
    return obj


# ── room (Blender Z-up; floor on XY) ──
W, D, H = 3.6, 2.81, 2.7
floor = add_plane('floor', [(0, 0, 0), (W, 0, 0), (W, D, 0), (0, D, 0)], wood_mat('wood', TEX_WOOD, 2.0))
wall_mat = pbr('wall', (0.86, 0.84, 0.80), rough=0.9)
add_plane('wall_back', [(0, 0, 0), (W, 0, 0), (W, 0, H), (0, 0, H)], wall_mat)
add_plane('wall_left', [(0, 0, 0), (0, D, 0), (0, D, H), (0, 0, H)], wall_mat)
add_plane('wall_right', [(W, 0, 0), (W, D, 0), (W, D, H), (W, 0, H)], wall_mat)
add_plane('ceiling', [(0, 0, H), (W, 0, H), (W, D, H), (0, D, H)], pbr('ceil', (0.92, 0.92, 0.9), 0.95))

# ── cabinets (USD models import upright; place against back wall y≈depth/2) ──
white = pbr('cab_white', (0.9, 0.9, 0.88), rough=0.4)
wood_cab = wood_mat('cab_wood', TEX_WOOD, 2.5)
for mid, x in [('KF06', 0.5), ('KF06', 1.4), ('KF08', 2.45)]:
    o = import_model(mid, x, 0.3, 0.0)
    if o:
        o.data.materials.clear(); o.data.materials.append(white)
larder = import_model('KT01', 3.3, 0.47, 0.0)
if larder:
    larder.data.materials.clear(); larder.data.materials.append(wood_cab)
for x in (0.5, 1.4, 2.3):
    o = import_model('KH01', x, 0.3, 1.5)
    if o:
        o.data.materials.clear(); o.data.materials.append(white)
# worktop
wt = add_plane('worktop', [(0, 0, 0.82), (3.0, 0, 0.82), (3.0, 0.62, 0.82), (0, 0.62, 0.82)],
               pbr('stone', (0.05, 0.05, 0.06), rough=0.18))
wt2 = bpy.data.objects.new('worktop_solid', wt.data)  # thin slab via solidify
mod = wt.modifiers.new('s', 'SOLIDIFY'); mod.thickness = 0.04

# ── lighting: warm sun + soft window area + sky ──
world = bpy.data.worlds.new('w'); scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.62, 0.72, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6

sun_d = bpy.data.lights.new('sun', 'SUN'); sun_d.energy = 3.0; sun_d.angle = 0.09
sun_d.color = (1.0, 0.95, 0.85)
sun = bpy.data.objects.new('sun', sun_d); scene.collection.objects.link(sun)
sun.rotation_euler = (0.9, 0.1, 2.3)

win_d = bpy.data.lights.new('win', 'AREA'); win_d.energy = 300; win_d.size = 1.6
win_d.color = (0.95, 0.97, 1.0)
win = bpy.data.objects.new('win', win_d); scene.collection.objects.link(win)
win.location = (1.8, 3.6, 1.6); win.rotation_euler = (1.5708, 0, 0)

# ── camera ──
cam_d = bpy.data.cameras.new('cam'); cam_d.lens = 24
cam = bpy.data.objects.new('cam', cam_d); scene.collection.objects.link(cam)
scene.camera = cam
cam.location = (3.25, 2.45, 1.55)
look = mathutils.Vector((1.4, 0.2, 0.85)) - cam.location
cam.rotation_euler = look.to_track_quat('-Z', 'Y').to_euler()

# ── Cycles ──
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
try:
    scene.cycles.denoiser = 'OPENIMAGEDENOISE'
except Exception:
    pass
scene.view_settings.view_transform = 'AgX'  # filmic
scene.render.resolution_x = int(RES_Y * 16 / 10)
scene.render.resolution_y = RES_Y
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print('rendered', OUT)
