/**
 * Procedural PBR base-colour textures for the iOS design app, so a scanned room
 * renders with realistic marble / wood / plaster surfaces — not flat white walls.
 * Value-noise + fbm; written as PPM then converted to PNG by the caller (ffmpeg).
 *
 *   node scripts/ios/gen-textures.mjs <outDir>
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SIZE = 512;

const hash = (x, y) => {
  let n = (x * 374761393 + y * 668265263) | 0;
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
};
const smooth = (t) => t * t * (3 - 2 * t);
function vnoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = smooth(xf);
  const v = smooth(yf);
  const tl = hash(xi, yi);
  const tr = hash(xi + 1, yi);
  const bl = hash(xi, yi + 1);
  const br = hash(xi + 1, yi + 1);
  return tl * (1 - u) * (1 - v) + tr * u * (1 - v) + bl * (1 - u) * v + br * u * v;
}
function fbm(x, y, oct = 6) {
  let a = 0.5;
  let f = 1;
  let s = 0;
  let n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * vnoise(x * f, y * f);
    n += a;
    a *= 0.5;
    f *= 2;
  }
  return s / n;
}
const lerp = (a, b, t) => a + (b - a) * t;
const mix3 = (c0, c1, t) => [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)];
const clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)));

function render(fn) {
  const buf = new Uint8Array(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const c = fn(x / SIZE, y / SIZE, x, y);
      const i = (y * SIZE + x) * 3;
      buf[i] = clamp255(c[0]);
      buf[i + 1] = clamp255(c[1]);
      buf[i + 2] = clamp255(c[2]);
    }
  }
  return Buffer.concat([Buffer.from(`P6\n${SIZE} ${SIZE}\n255\n`, 'ascii'), Buffer.from(buf)]);
}

// Marble: turbulence-warped veins over a stone base.
const marble = (base, vein, freq) => (u, v) => {
  const turb = fbm(u * 5, v * 5, 6);
  const m = Math.abs(Math.sin((u * freq + turb * 2.2) * Math.PI));
  const t = Math.pow(1 - m, 2.2); // sharp dark veins
  const grain = (fbm(u * 40, v * 40, 3) - 0.5) * 10;
  return mix3(base, vein, Math.min(1, t)).map((c) => c + grain);
};

// Wood: stretched rings along the plank with fine grain.
const wood = (light, dark) => (u, v) => {
  const warp = fbm(u * 3, v * 8, 4) * 1.5;
  const rings = Math.sin((u * 10 + warp) * Math.PI);
  const t = (rings * 0.5 + 0.5) * 0.7 + fbm(u * 4, v * 90, 3) * 0.3;
  const grain = (fbm(u * 6, v * 200, 2) - 0.5) * 14;
  return mix3(dark, light, t).map((c) => c + grain);
};

// Plaster: near-white with soft tonal variation (not flat).
const plaster = (base) => (u, v) => {
  const n = (fbm(u * 6, v * 6, 5) - 0.5) * 16 + (fbm(u * 60, v * 60, 2) - 0.5) * 6;
  return base.map((c) => c + n);
};

// Ceramic tile: a grid with grout lines and gentle per-tile tonal variation.
const tile = (base, grout, n) => (u, v) => {
  const gx = (u * n) % 1;
  const gy = (v * n) % 1;
  const gw = 0.035;
  if (gx < gw || gx > 1 - gw || gy < gw || gy > 1 - gw) {
    return grout.map((c) => c + (fbm(u * 30, v * 30, 2) - 0.5) * 6);
  }
  const ti = Math.floor(u * n);
  const tj = Math.floor(v * n);
  const shade = (hash(ti, tj) - 0.5) * 18;
  const sheen = (fbm(u * 8, v * 8, 3) - 0.5) * 10;
  return base.map((c) => c + shade + sheen);
};

// Granite: dense mineral speckle with occasional dark flecks.
const granite = (base) => (u, v) => {
  const fine = (fbm(u * 130, v * 130, 2) - 0.5) * 38;
  const micro = (fbm(u * 320, v * 320, 1) - 0.5) * 26;
  const fleck = hash(Math.floor(u * 220), Math.floor(v * 220)) < 0.1 ? -55 : 0;
  return base.map((c) => c + fine + micro + fleck);
};

const TEXTURES = {
  marble_cream: marble([238, 232, 220], [176, 150, 110], 6), // warm wall/floor marble
  marble_white: marble([241, 241, 238], [120, 122, 128], 7), // cool grey marble
  oak: wood([196, 162, 112], [150, 116, 74]),
  walnut: wood([121, 84, 56], [74, 48, 30]),
  plaster: plaster([234, 230, 223]),
  tile_ceramic: tile([214, 220, 210], [176, 178, 170], 6), // soft ceramic
  granite_grey: granite([138, 134, 138]),
  granite_black: granite([54, 52, 56]),
};

const outDir = resolve(process.argv[2] ?? '.');
for (const [name, fn] of Object.entries(TEXTURES)) {
  const file = resolve(outDir, `${name}.ppm`);
  writeFileSync(file, render(fn));
  console.log(`wrote ${file}`);
}
