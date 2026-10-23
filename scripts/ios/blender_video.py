#!/usr/bin/env python3
"""Animated photorealistic MOZU kitchen walkthrough, Blender Cycles.

Builds the scene once, then renders a frame range with a lerped cinematic camera
move. Render in batches to fit time limits:
  python3 blender_video.py -- <outdir> <start> <end> <total> [samples] [res_y]
Frames write to <outdir>/f_%04d.png; encode with ffmpeg afterwards.
"""
import sys
import bpy
import mathutils

a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUTDIR = a[0]
START, END, TOTAL = int(a[1]), int(a[2]), int(a[3])
SAMPLES = int(a[4]) if len(a) > 4 else 24
RES_Y = int(a[5]) if len(a) > 5 else 506
MODELS = 'apps/ios/MozuScanner/Resources/Models'
TEX_WOOD = '/tmp/realtex/floor_wood.jpg'

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def pbr(name, base, rough=0.5, metal=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*base, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


def wood_mat(name, path, scale=2.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = 0.35
    tex = nt.nodes.new('ShaderNodeTexImage')
    try:
        tex.image = bpy.data.images.load(path)
    except Exception:
        b.inputs['Base Color'].default_value = (0.5, 0.35, 0.2, 1); return m
    mp = nt.nodes.new('ShaderNodeMapping'); co = nt.nodes.new('ShaderNodeTexCoord')
    mp.inputs['Scale'].default_value = (scale, scale, scale)
    nt.links.new(co.outputs['UV'], mp.inputs['Vector'])
    nt.links.new(mp.outputs['Vector'], tex.inputs['Vector'])
    nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    return m


def add_plane(name, verts, mat):
    me = bpy.data.meshes.new(name); me.from_pydata(verts, [], [[0, 1, 2, 3]]); me.update()
    me.uv_layers.new()
    o = bpy.data.objects.new(name, me); o.data.materials.append(mat)
    scene.collection.objects.link(o); return o


def import_model(mid, x, y, z, mat=None, rot_z=0.0):
    before = set(bpy.data.objects)
    bpy.ops.wm.usd_import(filepath=f'{MODELS}/{mid}.usdz')
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
    cs = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
    span = max(max(c[i] for c in cs) - min(c[i] for c in cs) for i in range(3))
    if span > 50:
        obj.scale = (0.001, 0.001, 0.001)
    obj.rotation_euler[2] = rot_z
    bpy.context.view_layer.update()
    cs = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
    obj.location.x += x - sum(c.x for c in cs) / 8
    obj.location.y += y - sum(c.y for c in cs) / 8
    obj.location.z += z - min(c.z for c in cs)
    if mat:
        obj.data.materials.clear(); obj.data.materials.append(mat)
    return obj


# ── scene ──
W, D, H = 3.6, 2.81, 2.7
add_plane('floor', [(0, 0, 0), (W, 0, 0), (W, D, 0), (0, D, 0)], wood_mat('wood', TEX_WOOD, 2.0))
wm = pbr('wall', (0.87, 0.85, 0.81), 0.9)
add_plane('back', [(0, 0, 0), (W, 0, 0), (W, 0, H), (0, 0, H)], wm)
add_plane('left', [(0, 0, 0), (0, D, 0), (0, D, H), (0, 0, H)], wm)
add_plane('right', [(W, 0, 0), (W, D, 0), (W, D, H), (W, 0, H)], wm)
add_plane('ceil', [(0, 0, H), (W, 0, H), (W, D, H), (0, D, H)], pbr('c', (0.92, 0.92, 0.9), 0.95))
white = pbr('white', (0.9, 0.9, 0.88), 0.4)
woodc = wood_mat('woodc', TEX_WOOD, 2.5)
for mid, x in [('KF06', 0.5), ('KF06', 1.4), ('KF08', 2.45)]:
    import_model(mid, x, 0.3, 0.0, white)
import_model('KT01', 3.3, 0.47, 0.0, woodc)
for x in (0.5, 1.4, 2.3):
    import_model('KH01', x, 0.3, 1.5, white)
wt = add_plane('wt', [(0, 0, 0.82), (3.0, 0, 0.82), (3.0, 0.62, 0.82), (0, 0.62, 0.82)], pbr('stone', (0.05, 0.05, 0.06), 0.16))
wt.modifiers.new('s', 'SOLIDIFY').thickness = 0.04

scene.world = bpy.data.worlds.new('w'); scene.world.use_nodes = True
bg = scene.world.node_tree.nodes['Background']
bg.inputs['Color'].default_value = (0.55, 0.62, 0.72, 1); bg.inputs['Strength'].default_value = 0.6
sd = bpy.data.lights.new('sun', 'SUN'); sd.energy = 3.0; sd.angle = 0.09; sd.color = (1.0, 0.95, 0.85)
so = bpy.data.objects.new('sun', sd); scene.collection.objects.link(so); so.rotation_euler = (0.9, 0.1, 2.3)
wd = bpy.data.lights.new('win', 'AREA'); wd.energy = 320; wd.size = 1.6; wd.color = (0.95, 0.97, 1.0)
wo = bpy.data.objects.new('win', wd); scene.collection.objects.link(wo); wo.location = (1.8, 3.6, 1.6); wo.rotation_euler = (1.5708, 0, 0)

cam_d = bpy.data.cameras.new('cam'); cam_d.lens = 22
cam = bpy.data.objects.new('cam', cam_d); scene.collection.objects.link(cam); scene.camera = cam

# cinematic lateral dolly
A = (mathutils.Vector((3.32, 2.5, 1.6)), mathutils.Vector((1.5, 0.25, 0.9)))
B = (mathutils.Vector((1.45, 2.5, 1.45)), mathutils.Vector((1.0, 0.25, 0.98)))


def smooth(t):
    return t * t * (3 - 2 * t)


# ── Cycles ──
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
try:
    scene.cycles.denoiser = 'OPENIMAGEDENOISE'
except Exception:
    pass
scene.cycles.max_bounces = 4
scene.cycles.diffuse_bounces = 3
scene.cycles.glossy_bounces = 2
scene.render.use_persistent_data = True
scene.view_settings.view_transform = 'AgX'
scene.render.resolution_x = int(RES_Y * 16 / 10)
scene.render.resolution_y = RES_Y
scene.render.image_settings.file_format = 'PNG'

for f in range(START, END):
    t = smooth(f / (TOTAL - 1) if TOTAL > 1 else 0)
    loc = A[0].lerp(B[0], t); tgt = A[1].lerp(B[1], t)
    cam.location = loc
    cam.rotation_euler = (tgt - loc).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = f'{OUTDIR}/f_{f:04d}.png'
    bpy.ops.render.render(write_still=True)
    print('frame', f)
