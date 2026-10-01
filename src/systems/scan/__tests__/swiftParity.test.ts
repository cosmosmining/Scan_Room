import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { detectSockets, type DetectorImage } from '@/systems/scan';
import { analyseWalls } from '@/systems/scan/wallLoop';
import { findGlass, type DepthRay } from '@/systems/scan/glassFinder';
import { mulberry32, room } from './helpers/roomGen';

// ---------------------------------------------------------------------------
// The iPad and the web must draw the SAME floor plan from the same scan.
//
// The iPad's geometry is Swift; its tests live here, against the TypeScript
// twin. This holds the twins together: the same rooms, glass and camera images
// go through both, and the answers must match to the micron.
//
// Needs the Swift harness, so it is skipped unless one is given:
//   scripts/swift-parity.sh
//   SWIFT_PARITY_BIN=.cache/swift-parity/parity npx vitest run swiftParity
// CI runs it on every push (.github/workflows/ci.yml, job "swift-parity").
// ---------------------------------------------------------------------------

const BIN = process.env.SWIFT_PARITY_BIN;
const ROOMS = Number(process.env.PARITY_ROOMS ?? 2000);

type P = { x: number; z: number };
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a));

function glassCase(rnd: () => number) {
  const lerp = (a: number, b: number) => a + (b - a) * rnd();
  const W = lerp(3000, 6000), D = lerp(2500, 5000), H = 2600;
  const poly = [{ x: 0, z: 0 }, { x: W, z: 0 }, { x: W, z: D }, { x: 0, z: D }];
  const x0 = lerp(200, W - 1600), x1 = x0 + lerp(600, 1400);
  const y0 = rnd() < 0.5 ? 0 : lerp(500, 1000), y1 = Math.min(H - 100, y0 + lerp(700, 2000));
  const rays: DepthRay[] = [];
  for (let e = 0; e < 3; e++) {
    const eye = { x: lerp(500, W - 500), y: lerp(1200, 1600), z: lerp(D * 0.5, D - 300) };
    for (let x = 60; x < W; x += 70) {
      for (let y = 40; y < H; y += 70) {
        if (rnd() > 0.35) continue;
        if (!(x >= x0 && x <= x1 && y >= y0 && y <= y1)) {
          rays.push({ eye, hit: { x, y, z: lerp(-30, 30) } });
          continue;
        }
        const f = (eye.z + 2000) / eye.z; // through the glass, 2m beyond
        rays.push({ eye, hit: { x: eye.x + (x - eye.x) * f, y: eye.y + (y - eye.y) * f, z: eye.z - eye.z * f } });
      }
    }
  }
  const existing = rnd() < 0.3 ? [{ wall: 0, offset: x0 + 50, width: x1 - x0 - 100 }] : [];
  return { rays, polygon: rnd() < 0.5 ? poly : [...poly].reverse(), ceilingMm: H, existing };
}

function images(): DetectorImage[] {
  const make = (bg: number): DetectorImage => {
    const data = new Uint8ClampedArray(256 * 192 * 4);
    for (let i = 0; i < 256 * 192; i++) { data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = bg; data[i * 4 + 3] = 255; }
    return { data, width: 256, height: 192 };
  };
  const rect = (img: DetectorImage, x: number, y: number, w: number, h: number, v: number) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const i = (yy * img.width + xx) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    }
  };
  const socket = (img: DetectorImage, cx: number, cy: number, plate = 235, slot = 40) => {
    rect(img, cx - 17, cy - 22, 34, 44, plate);
    rect(img, cx - 10, cy - 6, 4, 10, slot); rect(img, cx + 6, cy - 6, 4, 10, slot); rect(img, cx - 2, cy + 9, 4, 5, slot);
  };
  const out: DetectorImage[] = [];
  let i = make(180); socket(i, 128, 96); out.push(i);                                    // one socket
  i = make(170); socket(i, 70, 96); socket(i, 180, 96, 225, 60); out.push(i);            // two sockets
  i = make(70); rect(i, 20, 30, 220, 10, 255); out.push(i);                              // LED strip
  i = make(70); rect(i, 20, 30, 220, 10, 255); socket(i, 128, 120, 150, 60); out.push(i); // socket under LED
  i = make(150); rect(i, 111, 74, 34, 44, 255); rect(i, 118, 88, 4, 10, 90);              // sunlit plate
  rect(i, 134, 88, 4, 10, 90); rect(i, 126, 103, 4, 5, 90); out.push(i);
  i = make(70); rect(i, 111, 74, 34, 44, 105);                                            // textured beige cover
  for (let y = 79; y < 113; y += 6) for (let x = 116; x < 141; x += 5) rect(i, x, y, 2, 2, 83);
  out.push(i);
  i = make(180); rect(i, 60, 60, 120, 70, 240); out.push(i);                              // poster
  return out;
}

describe.skipIf(!BIN)('Swift and TypeScript agree', () => {
  const rnd = mulberry32(Number(process.env.PARITY_SEED ?? 4242));
  const walls = Array.from({ length: ROOMS }, () => room(rnd).segments);
  const glass = Array.from({ length: 100 }, () => glassCase(rnd));
  const imgs = images();
  const gray = imgs.map((img) => ({
    width: img.width,
    height: img.height,
    pixels: Array.from({ length: img.width * img.height }, (_, k) =>
      0.299 * img.data[k * 4] + 0.587 * img.data[k * 4 + 1] + 0.114 * img.data[k * 4 + 2]),
  }));
  const out = BIN
    ? JSON.parse(execFileSync(BIN, [], { input: JSON.stringify({ walls, glass, images: gray }), maxBuffer: 1 << 28 }).toString())
    : { walls: [], glass: [], detections: [] };

  it(`on ${ROOMS} rooms: outline, pillars and clutter`, () => {
    const diffs: number[] = [];
    walls.forEach((segs, i) => {
      const ts = analyseWalls(segs);
      const sw = out.walls[i];
      const key = (p: { center: P }) => p.center.x * 1e3 + p.center.z;
      const tp = [...ts.pillars].sort((a, b) => key(a) - key(b));
      const sp = [...sw.pillars].sort((a: { center: P }, b: { center: P }) => key(a) - key(b));
      const same =
        ts.clutterRejected === sw.clutterRejected &&
        ts.outline.length === sw.outline.length &&
        ts.outline.every((p, k) => close(p.x, sw.outline[k].x) && close(p.z, sw.outline[k].z)) &&
        tp.length === sp.length &&
        tp.every((p, k) => p.shape === sp[k].shape && close(p.center.x, sp[k].center.x) &&
          close(p.center.z, sp[k].center.z) && close(p.width, sp[k].width) && close(p.depth, sp[k].depth));
      if (!same) diffs.push(i);
    });
    expect(diffs, `rooms that differ: ${diffs.slice(0, 10).join(', ')}`).toEqual([]);
  });

  it('on 100 glass cases', () => {
    const diffs: number[] = [];
    glass.forEach((g, i) => {
      const ts = findGlass(g.rays, g.polygon, g.ceilingMm, g.existing);
      const sw = out.glass[i];
      const same = ts.length === sw.length && ts.every((o, k) =>
        o.wall === sw[k].wall && o.type === sw[k].type && close(o.offset, sw[k].offset) &&
        close(o.width, sw[k].width) && close(o.height, sw[k].height) && close(o.sill, sw[k].sill ?? 0) &&
        sw[k].glass === true);
      if (!same) diffs.push(i);
    });
    expect(diffs).toEqual([]);
  });

  it('on the socket detector’s camera images', () => {
    imgs.forEach((img, k) => {
      const ts = detectSockets(img, { maxDim: 256 });
      const sw = out.detections[k];
      expect(sw.length, `image ${k}`).toBe(ts.length);
      ts.forEach((d, n) => {
        expect(sw[n].holes).toBe(d.holes);
        expect(close(sw[n].cx, d.cx) && close(sw[n].cy, d.cy)).toBe(true);
      });
    });
  });
});
