/**
 * Render a walkthrough VIDEO of two real scanned rooms (from the MOZU floorplans)
 * furnished with the actual MOZU cabinet models, AI-placed along the walls, with
 * realistic marble/wood materials. Emits a PPM frame sequence (encode with ffmpeg).
 *
 * Room geometry comes from the floorplan dimensions; furniture geometry comes from
 * the MOZU STEP files tessellated with OpenCASCADE. Camera animates per segment.
 *
 *   node scripts/ios/render-video.mjs <texDir> <outFramesDir>
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const W = 1600;          // supersampled render res (downscaled at encode for AA)
const H = 984;
const FPS = 20;

// ── math ──
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (t) => t * t * (3 - 2 * t);
function mul(a, b) { const r = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j]; return r; }
const ap = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + m[3] * v[3], m[4] * v[0] + m[5] * v[1] + m[6] * v[2] + m[7] * v[3], m[8] * v[0] + m[9] * v[1] + m[10] * v[2] + m[11] * v[3], m[12] * v[0] + m[13] * v[1] + m[14] * v[2] + m[15] * v[3]];
function perspective(fovy, aspect, near, far) { const f = 1 / Math.tan(fovy / 2); return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), (2 * far * near) / (near - far), 0, 0, -1, 0]; }
function lookAt(eye, c, up) { const z = nrm(sub(eye, c)); const x = nrm(cross(up, z)); const y = cross(z, x); return [x[0], x[1], x[2], -dot(x, eye), y[0], y[1], y[2], -dot(y, eye), z[0], z[1], z[2], -dot(z, eye), 0, 0, 0, 1]; }

// ── textures ──
function readPPM(p) { const b = readFileSync(p); let i = 0; const t = () => { while (b[i] === 32 || b[i] === 10) i++; const s = i; while (b[i] !== 32 && b[i] !== 10) i++; return b.toString('ascii', s, i); }; t(); const w = +t(); const h = +t(); t(); i++; return { w, h, data: b.subarray(i) }; }
function sample(tex, u, v) { u -= Math.floor(u); v -= Math.floor(v); const x = Math.min(tex.w - 1, (u * tex.w) | 0); const y = Math.min(tex.h - 1, (v * tex.h) | 0); const i = (y * tex.w + x) * 3; return [tex.data[i], tex.data[i + 1], tex.data[i + 2]]; }
const texDir = resolve(process.argv[2] ?? '/tmp/tex');
const TEX = {
  wood_real: readPPM(resolve(texDir, 'wood_real.ppm')),   // real CC0 hardwood (github)
  plaster: readPPM(resolve(texDir, 'plaster.ppm')),       // clean painted wall
  granite_black: readPPM(resolve(texDir, 'granite_black.ppm')),
};

// ── Real MOZU model meshes (extracted from USDZ by usd_extract.py): full geometry
// incl. doors/knobs, per-part materials. Normalised to metres, base at y=0,
// footprint centred. ──
const meshDir = process.argv[4] ?? '/tmp/usdmesh';
const modelCache = {};
function loadModel(id) {
  if (modelCache[id]) return modelCache[id];
  const d = JSON.parse(readFileSync(resolve(meshDir, `${id}.json`), 'utf8'));
  const span = Math.max(d.bbox.max[0] - d.bbox.min[0], d.bbox.max[1] - d.bbox.min[1], d.bbox.max[2] - d.bbox.min[2]);
  const s = span > 50 ? 0.001 : 1; // mm → m
  const mn = d.bbox.min.map((v) => v * s), mx = d.bbox.max.map((v) => v * s);
  const cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2, my = mn[1];
  const meshes = d.meshes.map((me) => {
    const V = me.pts.map((p) => [p[0] * s - cx, p[1] * s - my, p[2] * s - cz]);
    return { tris: me.tris.map((t) => [V[t[0]], V[t[1]], V[t[2]]]), color: me.color.map((c) => Math.round(c * 255)) };
  });
  modelCache[id] = { meshes, size: mx.map((v, k) => v - mn[k]) };
  return modelCache[id];
}

// Place a model's real meshes into world space (translate + yaw), each with its
// authored material colour (opts.color overrides; opts.tex applies triplanar wood).
function placeCab(scene, id, x, z, y, yaw, opts = {}) {
  const { meshes } = loadModel(id);
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  const ts = opts.scale ?? 0.6;
  for (const mesh of meshes) {
    const color = opts.color ?? mesh.color;
    for (const t of mesh.tris) {
      const w = t.map((p) => [x + p[0] * c + p[2] * sn, y + p[1], z - p[0] * sn + p[2] * c]);
      if (opts.tex) {
        const n = nrm(cross(sub(w[1], w[0]), sub(w[2], w[0])));
        const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
        const uv = (P) => (ax >= ay && ax >= az ? [P[2] * ts, P[1] * ts] : ay >= az ? [P[0] * ts, P[2] * ts] : [P[0] * ts, P[1] * ts]);
        scene.push({ v: w.map((P) => ({ pos: P, uv: uv(P) })), tex: opts.tex });
      } else {
        scene.push({ v: w.map((P) => ({ pos: P, uv: [0, 0] })), color });
      }
    }
  }
}

// ── room geometry ──
function addRoom(scene, footprint, height, opts) {
  const TS = 0.3;
  // floor
  for (let i = 1; i < footprint.length - 1; i++) {
    const a = [footprint[0][0], 0, footprint[0][1]], b = [footprint[i][0], 0, footprint[i][1]], d = [footprint[i + 1][0], 0, footprint[i + 1][1]];
    scene.push({ v: [a, b, d].map((P) => ({ pos: P, uv: [P[0] * TS, P[2] * TS] })), tex: opts.floor });
  }
  // ceiling
  for (let i = 1; i < footprint.length - 1; i++) {
    const a = [footprint[0][0], height, footprint[0][1]], b = [footprint[i][0], height, footprint[i][1]], d = [footprint[i + 1][0], height, footprint[i + 1][1]];
    scene.push({ v: [a, d, b].map((P) => ({ pos: P, uv: [P[0] * 0.25, P[2] * 0.25] })), tex: 'plaster' });
  }
  // walls
  for (let i = 0; i < footprint.length; i++) {
    const a = footprint[i], b = footprint[(i + 1) % footprint.length];
    const p0 = [a[0], 0, a[1]], p1 = [b[0], 0, b[1]], p2 = [b[0], height, b[1]], p3 = [a[0], height, a[1]];
    const uvOf = (P) => [Math.hypot(P[0] - a[0], P[2] - a[1]) * TS, P[1] * TS];
    scene.push({ v: [p0, p1, p2].map((P) => ({ pos: P, uv: uvOf(P) })), tex: opts.wall });
    scene.push({ v: [p0, p2, p3].map((P) => ({ pos: P, uv: uvOf(P) })), tex: opts.wall });
  }
}
function box(scene, cx, cy, cz, sx, sy, sz, color) {
  const x = sx / 2, y = sy / 2, z = sz / 2;
  const c = [[cx - x, cy - y, cz - z], [cx + x, cy - y, cz - z], [cx + x, cy - y, cz + z], [cx - x, cy - y, cz + z], [cx - x, cy + y, cz - z], [cx + x, cy + y, cz - z], [cx + x, cy + y, cz + z], [cx - x, cy + y, cz + z]];
  const fs = [[4, 5, 6, 7], [0, 3, 2, 1], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  for (const q of fs) { scene.push({ v: [c[q[0]], c[q[1]], c[q[2]]].map((P) => ({ pos: P, uv: [0, 0] })), color }); scene.push({ v: [c[q[0]], c[q[2]], c[q[3]]].map((P) => ({ pos: P, uv: [0, 0] })), color }); }
}

const WHITE = [233, 232, 228], WOOD = [168, 130, 84], GREY = [120, 122, 126];

// ── Scene A: Ken's room (3.6 × 2.81, h 2.70) — MOZU kitchen along the back wall ──
function sceneKitchen() {
  const s = [];
  addRoom(s, [[0, 0], [3.6, 0], [3.6, 2.81], [0, 2.81]], 2.7, { floor: 'wood_real', wall: 'plaster' });
  // base cabinets against z=0 wall (depth 0.6 → centre z=0.3) — real model materials
  placeCab(s, 'KF06', 0.5, 0.3, 0, 0);
  placeCab(s, 'KF06', 1.4, 0.3, 0, 0);
  placeCab(s, 'KF08', 2.45, 0.3, 0, 0);
  placeCab(s, 'KT01', 3.3, 0.47, 0, 0); // tall larder (real geometry + knobs)
  box(s, 1.5, 0.82, 0.31, 3.0, 0.04, 0.62, [36, 35, 38]); // dark stone worktop
  // wall cabinets above (elevation 1.5)
  placeCab(s, 'KH01', 0.5, 0.3, 1.5, 0);
  placeCab(s, 'KH01', 1.4, 0.3, 1.5, 0);
  placeCab(s, 'KH01', 2.3, 0.3, 1.5, 0);
  return s;
}

// ── Scene B: Vicky's room (~12.5 m², h 3.03, irregular) — MOZU wardrobe ──
function sceneWardrobe() {
  const s = [];
  addRoom(s, [[0.5, 0], [3.5, 0], [3.5, 3.4], [0, 3.4], [0, 0.7]], 3.03, { floor: 'wood_real', wall: 'plaster' });
  // wardrobe run against z=0 wall (depth 0.9 → centre z=0.46) — real model materials
  let x = 0.95;
  for (const id of ['W04', 'W05', 'W06', 'W07', 'W08']) { placeCab(s, id, x, 0.46, 0, 0); x += 0.58; }
  placeCab(s, 'W02', x + 0.1, 0.3, 0, 0); // side cabinet
  box(s, 1.75, 0.02, 2.05, 2.3, 0.03, 1.7, [150, 110, 96]); // rug
  placeCab(s, 'bed_queen', 1.75, 2.1, 0, 0); // queen bed (head toward the wardrobe wall)
  placeCab(s, 'planter', 3.05, 0.62, 0, 0);  // plant in the corner
  return s;
}

// ── pricing ──
const PRICE = { KF06: 320, KF08: 360, KH01: 185, KT01: 640, W02: 240, W04: 380, W05: 380, W06: 380, W07: 380, W08: 380 };
const kitchenBill = { KF06: 2, KF08: 1, KH01: 3, KT01: 1, worktop: 1 };
const wardrobeBill = { W04: 1, W05: 1, W06: 1, W07: 1, W08: 1, W02: 1 };
const sum = (bill) => Object.entries(bill).reduce((t, [k, n]) => t + (PRICE[k] ?? (k === 'worktop' ? 420 : 0)) * n, 0);

// ── render ──
// Per-surface specular response (strength, shininess) → glossy stone, matte walls…
function matOf(tri) {
  if (tri.tex === 'granite_black') return [0.5, 60];
  if (tri.tex === 'plaster') return [0.05, 12];
  if (tri.tex === 'wood_real') return [0.16, 30];
  const c = tri.color || [200, 200, 200];
  if (c[0] < 60 && c[1] < 60) return [0.6, 80]; // dark stone worktop = glossy
  return [0.13, 26]; // matte cabinetry
}
function buildTris(scene) {
  return scene.map((tri) => {
    const wp = tri.v.map((x) => x.pos);
    const normal = nrm(cross(sub(wp[1], wp[0]), sub(wp[2], wp[0])));
    const centroid = [(wp[0][0] + wp[1][0] + wp[2][0]) / 3, (wp[0][1] + wp[1][1] + wp[2][1]) / 3, (wp[0][2] + wp[1][2] + wp[2][2]) / 3];
    return { ...tri, normal, centroid, mat: matOf(tri) };
  });
}

// Three-point lighting (warm key + cool fill + ambient) — cinematic.
const KEY = nrm([-0.5, 1.1, 0.45]), KEYC = [1.0, 0.95, 0.88], KEYI = 0.95;
const FILL = nrm([0.7, 0.4, 0.7]), FILLC = [0.82, 0.88, 1.0], FILLI = 0.33;
const AMB = 0.36;
function shadeTri(tri, eye) {
  const N = tri.normal, V = nrm(sub(eye, tri.centroid)), spec = tri.mat[0], shin = tri.mat[1];
  let df = AMB;
  const sa = [0, 0, 0];
  for (const [L, C, I] of [[KEY, KEYC, KEYI], [FILL, FILLC, FILLI]]) {
    df += I * Math.max(0, dot(N, L));
    const Hh = nrm([L[0] + V[0], L[1] + V[1], L[2] + V[2]]);
    const sp = Math.pow(Math.max(0, dot(N, Hh)), shin) * spec * I * 255;
    sa[0] += sp * C[0]; sa[1] += sp * C[1]; sa[2] += sp * C[2];
  }
  tri._df = df; tri._sa = sa;
}
// ACES filmic tone-map for the final framebuffer.
const ACES = (x) => { x *= 1.05; return Math.max(0, Math.min(1, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14))); };
function clipNear(poly) { const eps = 0.02; const out = []; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; const ai = a.clip[3] >= eps, bi = b.clip[3] >= eps; if (ai) out.push(a); if (ai !== bi) { const t = (eps - a.clip[3]) / (b.clip[3] - a.clip[3]); out.push({ clip: a.clip.map((v, k) => v + t * (b.clip[k] - v)), uv: [a.uv[0] + t * (b.uv[0] - a.uv[0]), a.uv[1] + t * (b.uv[1] - a.uv[1])] }); } } return out; }
function renderFrame(tris, VP, eye, fb, zbuf) {
  for (let i = 0; i < W * H; i++) { fb[i * 3] = 232; fb[i * 3 + 1] = 229; fb[i * 3 + 2] = 224; }
  zbuf.fill(-Infinity);
  for (const tri of tris) {
    shadeTri(tri, eye);
    const poly = tri.v.map((vert) => ({ clip: ap(VP, [...vert.pos, 1]), uv: vert.uv }));
    const cl = clipNear(poly);
    for (let i = 1; i < cl.length - 1; i++) rasterTri(cl[0], cl[i], cl[i + 1], tri, fb, zbuf);
  }
  for (let i = 0; i < W * H * 3; i++) fb[i] = ACES(fb[i] / 255) * 255; // filmic tone-map
}
function rasterTri(a, b, c, tri, fb, zbuf) {
  const S = [a, b, c].map((v) => { const w = v.clip[3]; return { x: (v.clip[0] / w * 0.5 + 0.5) * W, y: (1 - (v.clip[1] / w * 0.5 + 0.5)) * H, iw: 1 / w, uw: v.uv[0] / w, vw: v.uv[1] / w }; });
  const minX = Math.max(0, Math.floor(Math.min(S[0].x, S[1].x, S[2].x))), maxX = Math.min(W - 1, Math.ceil(Math.max(S[0].x, S[1].x, S[2].x)));
  const minY = Math.max(0, Math.floor(Math.min(S[0].y, S[1].y, S[2].y))), maxY = Math.min(H - 1, Math.ceil(Math.max(S[0].y, S[1].y, S[2].y)));
  const area = (S[1].x - S[0].x) * (S[2].y - S[0].y) - (S[1].y - S[0].y) * (S[2].x - S[0].x);
  if (Math.abs(area) < 1e-6) return;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const px = x + 0.5, py = y + 0.5;
    const w0 = ((S[1].x - px) * (S[2].y - py) - (S[1].y - py) * (S[2].x - px)) / area;
    const w1 = ((S[2].x - px) * (S[0].y - py) - (S[2].y - py) * (S[0].x - px)) / area;
    const w2 = 1 - w0 - w1;
    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
    const iw = w0 * S[0].iw + w1 * S[1].iw + w2 * S[2].iw;
    const idx = y * W + x;
    if (iw <= zbuf[idx]) continue;
    zbuf[idx] = iw;
    let col;
    if (tri.tex) { const u = (w0 * S[0].uw + w1 * S[1].uw + w2 * S[2].uw) / iw, v = (w0 * S[0].vw + w1 * S[1].vw + w2 * S[2].vw) / iw; col = sample(TEX[tri.tex], u, v); }
    else col = tri.color;
    const o = idx * 3, df = tri._df, sa = tri._sa;
    fb[o] = Math.min(255, col[0] * df + sa[0]); fb[o + 1] = Math.min(255, col[1] * df + sa[1]); fb[o + 2] = Math.min(255, col[2] * df + sa[2]);
  }
}

// ── timeline ──
const out = resolve(process.argv[3] ?? '/tmp/vid');
mkdirSync(out, { recursive: true });
const fb = new Uint8Array(W * H * 3);
const zbuf = new Float32Array(W * H);
const proj = perspective((60 * Math.PI) / 180, W / H, 0.04, 60);

const kitchen = buildTris(sceneKitchen());
const wardrobe = buildTris(sceneWardrobe());

const segments = [
  { tris: kitchen, secs: 5, eye: [[3.3, 1.55, 2.5], [1.2, 1.5, 2.5]], ctr: [[1.4, 0.9, 0.3], [1.4, 1.0, 0.2]] },
  { tris: kitchen, secs: 2.5, eye: [[1.2, 1.5, 2.5], [2.4, 1.35, 1.4]], ctr: [[1.4, 1.0, 0.2], [2.7, 1.1, 0.2]] },
  { tris: wardrobe, secs: 5, eye: [[3.2, 1.75, 3.18], [0.95, 1.7, 3.12]], ctr: [[1.5, 0.75, 1.5], [1.95, 0.8, 1.2]] },
];

let frame = 0;
for (const seg of segments) {
  const n = Math.round(seg.secs * FPS);
  for (let f = 0; f < n; f++) {
    const t = smooth(n > 1 ? f / (n - 1) : 0);
    const eye = lerp3(seg.eye[0], seg.eye[1], t);
    const VP = mul(proj, lookAt(eye, lerp3(seg.ctr[0], seg.ctr[1], t), [0, 1, 0]));
    renderFrame(seg.tris, VP, eye, fb, zbuf);
    writeFileSync(resolve(out, `f_${String(frame).padStart(4, '0')}.ppm`), Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`, 'ascii'), Buffer.from(fb)]));
    frame++;
  }
}

console.log(`rendered ${frame} frames @ ${FPS}fps → ${out}`);
console.log(`Kitchen (Ken, 10.1 m²): $${sum(kitchenBill).toLocaleString()}`);
console.log(`Wardrobe (Vicky, 12.5 m²): $${sum(wardrobeBill).toLocaleString()}`);
writeFileSync(resolve(out, 'meta.json'), JSON.stringify({ W, H, FPS, frames: frame, kitchen: sum(kitchenBill), wardrobe: sum(wardrobeBill) }, null, 2));
