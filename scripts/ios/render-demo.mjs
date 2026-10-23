/**
 * Software preview of the furnished room — the same room geometry, textures and
 * furniture the iOS app builds, rendered to a still so the result is visible
 * without Xcode. Perspective camera, z-buffer, perspective-correct texture
 * mapping (marble walls/floor), flat directional + ambient lighting.
 *
 *   node scripts/ios/render-demo.mjs <texDir(PPM)> <out.ppm>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const W = 1100;
const H = 760;

// ── tiny vec/mat ──
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function mul(a, b) {
  const r = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
  return r;
}
const apply = (m, v) => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + m[3] * v[3],
  m[4] * v[0] + m[5] * v[1] + m[6] * v[2] + m[7] * v[3],
  m[8] * v[0] + m[9] * v[1] + m[10] * v[2] + m[11] * v[3],
  m[12] * v[0] + m[13] * v[1] + m[14] * v[2] + m[15] * v[3],
];
function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), (2 * far * near) / (near - far), 0, 0, -1, 0];
}
function lookAt(eye, center, up) {
  const z = norm(sub(eye, center));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return [x[0], x[1], x[2], -dot(x, eye), y[0], y[1], y[2], -dot(y, eye), z[0], z[1], z[2], -dot(z, eye), 0, 0, 0, 1];
}

// ── textures (PPM) ──
function readPPM(path) {
  const buf = readFileSync(path);
  // header: P6\n<w> <h>\n255\n
  let p = 0;
  const tok = () => { while (buf[p] === 0x20 || buf[p] === 0x0a) p++; let s = p; while (buf[p] !== 0x20 && buf[p] !== 0x0a) p++; return buf.toString('ascii', s, p); };
  tok(); const w = +tok(); const h = +tok(); tok(); p++;
  return { w, h, data: buf.subarray(p) };
}
function sample(tex, u, v) {
  if (!tex) return null;
  u -= Math.floor(u); v -= Math.floor(v);
  const x = Math.min(tex.w - 1, (u * tex.w) | 0);
  const y = Math.min(tex.h - 1, (v * tex.h) | 0);
  const i = (y * tex.w + x) * 3;
  return [tex.data[i], tex.data[i + 1], tex.data[i + 2]];
}

const texDir = resolve(process.argv[2] ?? '/tmp/tex');
const TEX = {
  marble_cream: readPPM(resolve(texDir, 'marble_cream.ppm')),
  marble_white: readPPM(resolve(texDir, 'marble_white.ppm')),
  oak: readPPM(resolve(texDir, 'oak.ppm')),
  plaster: readPPM(resolve(texDir, 'plaster.ppm')),
};

// ── scene ──
const tris = [];
const pushQuad = (p0, p1, p2, p3, opts) => {
  // uv from a mapper(point)->[u,v]
  const mk = (P) => ({ pos: P, uv: opts.uv ? opts.uv(P) : [0, 0] });
  tris.push({ v: [mk(p0), mk(p1), mk(p2)], ...opts });
  tris.push({ v: [mk(p0), mk(p2), mk(p3)], ...opts });
};
function boxTris(cx, cy, cz, sx, sy, sz, color) {
  const x = sx / 2, y = sy / 2, z = sz / 2;
  const c = [
    [cx - x, cy - y, cz - z], [cx + x, cy - y, cz - z], [cx + x, cy - y, cz + z], [cx - x, cy - y, cz + z],
    [cx - x, cy + y, cz - z], [cx + x, cy + y, cz - z], [cx + x, cy + y, cz + z], [cx - x, cy + y, cz + z],
  ];
  const faces = [[4, 5, 6, 7], [0, 3, 2, 1], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  for (const fq of faces) pushQuad(c[fq[0]], c[fq[1]], c[fq[2]], c[fq[3]], { color });
}

// Room: L-shaped footprint (metres), height 2.7
const FP = [[0, 0], [4.2, 0], [4.2, 1.7], [1.8, 1.7], [1.8, 3.4], [0, 3.4]];
const Hh = 2.7;
const TS = 0.3; // texture scale (repeats/m)

// Floor (fan triangulation) — cream marble
for (let i = 1; i < FP.length - 1; i++) {
  const a = [FP[0][0], 0, FP[0][1]], b = [FP[i][0], 0, FP[i][1]], d = [FP[i + 1][0], 0, FP[i + 1][1]];
  tris.push({ v: [a, b, d].map((P) => ({ pos: P, uv: [P[0] * TS, P[2] * TS] })), tex: 'marble_cream' });
}
// Ceiling (plaster), slightly dim
for (let i = 1; i < FP.length - 1; i++) {
  const a = [FP[0][0], Hh, FP[0][1]], b = [FP[i][0], Hh, FP[i][1]], d = [FP[i + 1][0], Hh, FP[i + 1][1]];
  tris.push({ v: [a, d, b].map((P) => ({ pos: P, uv: [P[0] * 0.3, P[2] * 0.3] })), tex: 'plaster' });
}
// Walls (marble_white) — inner faces
for (let i = 0; i < FP.length; i++) {
  const a = FP[i], b = FP[(i + 1) % FP.length];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const p0 = [a[0], 0, a[1]], p1 = [b[0], 0, b[1]], p2 = [b[0], Hh, b[1]], p3 = [a[0], Hh, a[1]];
  let acc = 0;
  const uvOf = (P) => {
    const along = Math.hypot(P[0] - a[0], P[2] - a[1]);
    return [along * TS, P[1] * TS];
  };
  pushQuad(p0, p1, p2, p3, { tex: 'marble_cream', uv: uvOf });
}

// ── furniture (composed boxes; colours match the USDZ catalogue) ──
const C = { fabric: [150, 150, 154], wood: [120, 86, 55], oak: [168, 128, 82], walnut: [78, 52, 34], white: [228, 228, 222], green: [82, 128, 66], metal: [150, 150, 156], rug: [188, 92, 86], cabinet: [188, 178, 162], pot: [104, 78, 62] };
const place = [];
// rug
place.push(() => boxTris(1.3, 0.01, 1.15, 2.4, 0.02, 1.6, C.rug));
// sofa against the left/back wall (back toward -z)
const sofa = (ox, oz) => {
  boxTris(ox, 0.2, oz, 2.0, 0.4, 0.9, C.fabric);
  boxTris(ox, 0.55, oz - 0.34, 2.0, 0.7, 0.2, C.fabric);
  boxTris(ox - 0.93, 0.4, oz, 0.14, 0.55, 0.9, C.fabric);
  boxTris(ox + 0.93, 0.4, oz, 0.14, 0.55, 0.9, C.fabric);
  for (const dx of [-0.6, 0, 0.6]) boxTris(ox + dx, 0.46, oz + 0.05, 0.58, 0.16, 0.74, [168, 168, 172]);
};
place.push(() => sofa(1.3, 0.62));
// coffee table
const table = (ox, oz) => {
  boxTris(ox, 0.4, oz, 1.0, 0.06, 0.56, C.walnut);
  for (const [dx, dz] of [[-0.42, -0.22], [0.42, -0.22], [-0.42, 0.22], [0.42, 0.22]]) boxTris(ox + dx, 0.19, oz + dz, 0.05, 0.38, 0.05, C.metal);
};
place.push(() => table(1.3, 1.45));
// tall cabinet in the corner
place.push(() => boxTris(0.34, 1.175, 0.36, 0.45, 2.35, 0.58, C.cabinet));
// bookshelf against right wall
const shelf = (ox, oz) => {
  boxTris(ox - 0.4, 1.0, oz, 0.04, 2.0, 0.3, C.oak);
  boxTris(ox + 0.4, 1.0, oz, 0.04, 2.0, 0.3, C.oak);
  for (const y of [0.02, 0.5, 1.0, 1.5, 1.98]) boxTris(ox, y, oz, 0.84, 0.04, 0.3, C.oak);
  boxTris(ox, 1.0, oz - 0.14, 0.84, 2.0, 0.02, [150, 114, 72]);
};
place.push(() => shelf(2.95, 0.28));
// plant in far corner
const plant = (ox, oz) => { boxTris(ox, 0.2, oz, 0.35, 0.4, 0.35, C.pot); boxTris(ox, 0.65, oz, 0.5, 0.6, 0.5, C.green); boxTris(ox + 0.1, 0.95, oz + 0.05, 0.34, 0.5, 0.34, C.green); };
place.push(() => plant(0.5, 1.5));
place.forEach((fn) => fn());

// ── render ──
const eye = [3.75, 1.66, 1.5];    // corner of the main living area
const center = [0.7, 0.8, 0.4];   // looking across at the sofa wall
const view = lookAt(eye, center, [0, 1, 0]);
const proj = perspective((58 * Math.PI) / 180, W / H, 0.05, 60);
const VP = mul(proj, view);
const light = norm([-0.5, 1.0, 0.4]);

const fb = new Uint8Array(W * H * 3);
// soft warm background
for (let i = 0; i < W * H; i++) { fb[i * 3] = 232; fb[i * 3 + 1] = 228; fb[i * 3 + 2] = 222; }
const zbuf = new Float32Array(W * H).fill(-Infinity);

function shadeOf(tri) {
  const wp = tri.v.map((x) => x.pos);
  const n = norm(cross(sub(wp[1], wp[0]), sub(wp[2], wp[0])));
  const d = Math.abs(dot(n, light));
  return 0.5 + 0.5 * d; // ambient + diffuse
}
// near-plane clip (w >= eps) of a polygon of verts {clip, uv}
function clipNear(poly) {
  const eps = 0.02;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ain = a.clip[3] >= eps, bin = b.clip[3] >= eps;
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = (eps - a.clip[3]) / (b.clip[3] - a.clip[3]);
      out.push({
        clip: a.clip.map((v, k) => v + t * (b.clip[k] - v)),
        uv: [a.uv[0] + t * (b.uv[0] - a.uv[0]), a.uv[1] + t * (b.uv[1] - a.uv[1])],
      });
    }
  }
  return out;
}
function raster(va, vb, vc, tri, shade) {
  const S = [va, vb, vc].map((v) => {
    const w = v.clip[3];
    const x = (v.clip[0] / w * 0.5 + 0.5) * W;
    const y = (1 - (v.clip[1] / w * 0.5 + 0.5)) * H;
    const iw = 1 / w;
    return { x, y, iw, uw: v.uv[0] * iw, vw: v.uv[1] * iw };
  });
  const minX = Math.max(0, Math.floor(Math.min(S[0].x, S[1].x, S[2].x)));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(S[0].x, S[1].x, S[2].x)));
  const minY = Math.max(0, Math.floor(Math.min(S[0].y, S[1].y, S[2].y)));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(S[0].y, S[1].y, S[2].y)));
  const area = (S[1].x - S[0].x) * (S[2].y - S[0].y) - (S[1].y - S[0].y) * (S[2].x - S[0].x);
  if (Math.abs(area) < 1e-6) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      let w0 = ((S[1].x - px) * (S[2].y - py) - (S[1].y - py) * (S[2].x - px)) / area;
      let w1 = ((S[2].x - px) * (S[0].y - py) - (S[2].y - py) * (S[0].x - px)) / area;
      let w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const iw = w0 * S[0].iw + w1 * S[1].iw + w2 * S[2].iw;
      const idx = y * W + x;
      if (iw <= zbuf[idx]) continue;
      zbuf[idx] = iw;
      let col;
      if (tri.tex) {
        const u = (w0 * S[0].uw + w1 * S[1].uw + w2 * S[2].uw) / iw;
        const v = (w0 * S[0].vw + w1 * S[1].vw + w2 * S[2].vw) / iw;
        col = sample(TEX[tri.tex], u, v);
      } else col = tri.color;
      const o = idx * 3;
      fb[o] = Math.min(255, col[0] * shade);
      fb[o + 1] = Math.min(255, col[1] * shade);
      fb[o + 2] = Math.min(255, col[2] * shade);
    }
  }
}

for (const tri of tris) {
  const shade = shadeOf(tri);
  const poly = tri.v.map((vert) => ({ clip: apply(VP, [...vert.pos, 1]), uv: vert.uv }));
  const clipped = clipNear(poly);
  for (let i = 1; i < clipped.length - 1; i++) raster(clipped[0], clipped[i], clipped[i + 1], tri, shade);
}

const out = resolve(process.argv[3] ?? '/tmp/home.ppm');
writeFileSync(out, Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`, 'ascii'), Buffer.from(fb)]));
console.log(`wrote ${out}  (${tris.length} tris)`);
