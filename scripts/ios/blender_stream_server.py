#!/usr/bin/env python3
"""MOZU LIVE — persistent Blender EEVEE pixel-streaming server (raw TCP).

Blender itself is the socket server: it builds the MOZU room + furniture once, then
stays alive and re-renders a fast EEVEE frame for every camera pose the client
sends — so an iPad (Network.framework) or the browser bridge can WALK the rendered
space in real time on the Mac's GPU. Near-photoreal (EEVEE: SSR, soft shadows, AO),
not Cycles (true real-time path tracing does not exist on any hardware).

  blender --background --python blender_stream_server.py -- [port] [scene.json] [models] [tex]
  # or with the bpy pip module:
  python3 blender_stream_server.py -- [port] [scene.json] [models] [tex]

WIRE PROTOCOL (length-prefixed, both directions):
  client → server : [4-byte big-endian length N][N bytes UTF-8 JSON]
      {"t":"scene","design": <mozu.render/1>}   → rebuild the room+furniture
      {"t":"pose","pos":[x,y,z],"target":[x,y,z],"fov":62,"w":960,"h":600}  → one frame
  server → client : [4-byte big-endian length M][M bytes JPEG]   (one per message)

Using pos+target (the server does the look-at) instead of raw Euler angles means the
client never has to get Blender's Z-up axis convention right — no gimbal/flip bugs.
Coordinates are iOS metres (X/Z floor, Y up); the server converts to Blender Z-up.
"""
import json
import os
import socket
import struct
import sys

import bpy
import mathutils

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
PORT = int(argv[0]) if len(argv) > 0 else 8080
SCENE_JSON = argv[1] if len(argv) > 1 else 'server/sample-request.json'
MODELS = argv[2] if len(argv) > 2 else 'apps/ios/MozuScanner/Resources/Models'
TEX = argv[3] if len(argv) > 3 else 'apps/ios/MozuScanner/Resources/Textures'
FRAME = os.path.join(os.environ.get('TMPDIR', '/tmp'), 'mozu_stream_frame.jpg')

scene = bpy.context.scene


def log(m):
    print(m, flush=True)


def ios_to_blender(p):
    return (p[0], p[2], p[1])   # iOS (x, y-up, z-fwd) → Blender (x, y-fwd, z-up)


def configure_eevee():
    for engine in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
        try:
            scene.render.engine = engine
            break
        except Exception:
            continue
    ee = getattr(scene, 'eevee', None)
    if ee is not None:
        for attr, val in (('taa_render_samples', 16), ('use_gtao', True), ('use_bloom', True),
                          ('use_ssr', True), ('use_ssr_refraction', True), ('use_raytracing', True)):
            try:
                setattr(ee, attr, val)
            except Exception:
                pass
    try:
        scene.view_settings.view_transform = 'AgX'
    except Exception:
        pass
    scene.render.image_settings.file_format = 'JPEG'
    scene.render.image_settings.quality = 80
    scene.render.filepath = FRAME


def make_material(spec, name):
    spec = spec or {}
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = float(spec.get('rough', 0.5))
    b.inputs['Metallic'].default_value = float(spec.get('metal', 0.0))
    rgba = spec.get('rgba') or [0.8, 0.8, 0.8, 1.0]
    tex_name = spec.get('texture')
    tex_path = os.path.join(TEX, f'{tex_name}.png') if tex_name else None
    if tex_path and os.path.exists(tex_path):
        try:
            nt = m.node_tree
            img = nt.nodes.new('ShaderNodeTexImage'); img.image = bpy.data.images.load(tex_path)
            mp = nt.nodes.new('ShaderNodeMapping'); co = nt.nodes.new('ShaderNodeTexCoord')
            tile = max(float(spec.get('tile', 1.0)), 1e-3); s = 1.0 / tile
            mp.inputs['Scale'].default_value = (s, s, s)
            nt.links.new(co.outputs['UV'], mp.inputs['Vector'])
            nt.links.new(mp.outputs['Vector'], img.inputs['Vector'])
            nt.links.new(img.outputs['Color'], b.inputs['Base Color'])
            return m
        except Exception:
            pass
    b.inputs['Base Color'].default_value = (rgba[0], rgba[1], rgba[2], 1.0)
    return m


def add_poly(name, verts, uvs, mat):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], [list(range(len(verts)))]); mesh.update()
    uv = mesh.uv_layers.new(name='UVMap')
    for loop in mesh.loops:
        uv.data[loop.index].uv = uvs[loop.vertex_index]
    obj = bpy.data.objects.new(name, mesh); obj.data.materials.append(mat)
    scene.collection.objects.link(obj)
    return obj


def import_model(mid, x, y, rot_z):
    path = os.path.join(MODELS, f'{mid}.usdz')
    if not (mid and os.path.exists(path)):
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
    cs = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
    if max(max(c[i] for c in cs) - min(c[i] for c in cs) for i in range(3)) > 50:
        obj.scale = (0.001, 0.001, 0.001)
    obj.rotation_euler[2] = rot_z
    bpy.context.view_layer.update()
    cs = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
    obj.location.x += x - sum(c.x for c in cs) / 8
    obj.location.y += y - sum(c.y for c in cs) / 8
    obj.location.z += -min(c.z for c in cs)
    return obj


def build_shell(prefix, footprint, H, wall_mat, floor_mat, ceil_mat):
    if len(footprint) < 3:
        return
    add_poly(f'{prefix}_floor', [(p[0], p[1], 0.0) for p in footprint],
             [(p[0], p[1]) for p in footprint], floor_mat)
    add_poly(f'{prefix}_ceil', [(p[0], p[1], H) for p in footprint],
             [(p[0], p[1]) for p in footprint], ceil_mat)
    n = len(footprint)
    for i in range(n):
        a, b = footprint[i], footprint[(i + 1) % n]
        L = ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** 0.5
        verts = [(a[0], a[1], 0), (b[0], b[1], 0), (b[0], b[1], H), (a[0], a[1], H)]
        add_poly(f'{prefix}_wall_{i}', verts, [(0, 0), (L, 0), (L, H), (0, H)], wall_mat)


def build_scene(req):
    """(Re)build the whole scene from a mozu.render/1 design dict."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    global scene
    scene = bpy.context.scene
    configure_eevee()

    room = req.get('room', {})
    H = float(room.get('height', 2.7))
    build_shell('room', room.get('footprint', []), H,
                make_material(room.get('wall'), 'wall'),
                make_material(room.get('floor'), 'floor'),
                make_material(room.get('ceiling'), 'ceiling'))
    for k, sh in enumerate(req.get('extraRooms') or []):
        build_shell(f'x{k}', sh.get('footprint', []), float(sh.get('height', H)),
                    make_material({'texture': 'plaster', 'rough': 0.9}, f'x{k}w'),
                    make_material({'texture': 'oak', 'rough': 0.35}, f'x{k}f'),
                    make_material({'rgba': [0.92, 0.92, 0.9, 1]}, f'x{k}c'))
    for it in req.get('items', []):
        bx, by, _ = ios_to_blender([it['x'], 0.0, it['z']])
        import_model(it.get('model'), bx, by, -float(it.get('rotationY', 0.0)))

    world = bpy.data.worlds.new('w'); scene.world = world; world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.62, 0.68, 0.78, 1); bg.inputs['Strength'].default_value = 0.85
    sun_d = bpy.data.lights.new('sun', 'SUN'); sun_d.energy = 3.0; sun_d.angle = 0.09
    sun = bpy.data.objects.new('sun', sun_d); scene.collection.objects.link(sun)
    sun.rotation_euler = (0.85, 0.15, 2.2)
    cam_d = bpy.data.cameras.new('cam'); cam_d.sensor_fit = 'VERTICAL'
    cam = bpy.data.objects.new('cam', cam_d); scene.collection.objects.link(cam)
    scene.camera = cam


def render_pose(msg):
    cam = scene.camera
    cam.data.angle_y = float(msg.get('fov', 62.0)) * 3.14159265 / 180.0
    pos = ios_to_blender(msg.get('pos', [3, 1.6, 3]))
    tgt = ios_to_blender(msg.get('target', [0, 1, 0]))
    cam.location = pos
    look = mathutils.Vector(tgt) - mathutils.Vector(pos)
    if look.length < 1e-5:
        look = mathutils.Vector((0, 1, 0))
    cam.rotation_euler = look.to_track_quat('-Z', 'Y').to_euler()
    scene.render.resolution_x = int(msg.get('w', 960))
    scene.render.resolution_y = int(msg.get('h', 600))
    bpy.ops.render.render(write_still=True)
    with open(FRAME, 'rb') as f:
        return f.read()


def recv_exact(conn, n):
    buf = b''
    while len(buf) < n:
        c = conn.recv(n - len(buf))
        if not c:
            return None
        buf += c
    return buf


# ── build the initial scene, then serve ──
try:
    with open(SCENE_JSON) as f:
        build_scene(json.load(f))
    log('MOZU_READY')
except Exception as e:
    log('MOZU_ERR initial build: %s' % e)

srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(('0.0.0.0', PORT))
srv.listen(1)
log('MOZU_LISTEN %d' % PORT)

while True:
    conn, addr = srv.accept()
    conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)   # low latency
    log('MOZU_CONN %s' % str(addr))
    try:
        while True:
            head = recv_exact(conn, 4)
            if head is None:
                break
            n = struct.unpack('!I', head)[0]
            if n <= 0 or n > 32_000_000:
                break
            payload = recv_exact(conn, n)
            if payload is None:
                break
            msg = json.loads(payload.decode('utf-8'))
            if msg.get('t') == 'scene' and msg.get('design'):
                build_scene(msg['design'])
                jpg = render_pose(msg.get('cam') or {})
            else:
                jpg = render_pose(msg)
            conn.sendall(struct.pack('!I', len(jpg)) + jpg)
    except (ConnectionResetError, BrokenPipeError):
        pass
    except Exception as e:
        log('MOZU_ERR %s' % e)
    finally:
        conn.close()
        log('MOZU_DISCONN')
