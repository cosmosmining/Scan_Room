import type { LoopPoint, LoopSegment } from '@/systems/scan/wallLoop';

// ---------------------------------------------------------------------------
// Rooms with a known answer, scanned badly.
//
// Every room is built from a ground-truth floor plan — rectangles, L- and
// U-shapes, irregular rooms at odd angles, at any rotation — and then "scanned"
// the way a furnished room is: walls broken into pieces, pieces missing, hidden
// stretches, fragments fitted up to 180mm INTO the room, low clutter standing
// in front of walls, and round and square pillars.
//
// Shared by the fuzz test (TypeScript against the truth) and the Swift parity
// test (Swift against TypeScript), so both judge exactly the same rooms.
// Seeded: the same seed is the same rooms on every machine.
// ---------------------------------------------------------------------------

export type RoomShape = 'rect' | 'L' | 'U' | 'irregular';

type P = LoopPoint;

export function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function room(rnd: () => number): { truth: P[]; segments: LoopSegment[]; shape: RoomShape } {
  const lerp = (a: number, b: number) => a + (b - a) * rnd();
  const w = lerp(2500, 8000), d = lerp(2500, 7000), k = rnd();
  let poly: P[];
  const shape: RoomShape = k < 0.15 ? 'irregular' : k < 0.5 ? 'rect' : k < 0.8 ? 'L' : 'U';
  if (k < 0.15) {
    const n = 5 + Math.floor(rnd() * 3), r = Math.min(w, d) / 2 + 800;
    poly = Array.from({ length: n }, (_, i) => (2 * Math.PI * i) / n + lerp(-0.25, 0.25))
      .map((t) => ({ x: r + r * Math.cos(t), z: r + r * Math.sin(t) }));
  } else if (k < 0.5) {
    poly = [{ x: 0, z: 0 }, { x: w, z: 0 }, { x: w, z: d }, { x: 0, z: d }];
  } else if (k < 0.8) {
    const bx = lerp(0.3, 0.7) * w, bz = lerp(0.3, 0.7) * d;
    poly = [{ x: 0, z: 0 }, { x: w, z: 0 }, { x: w, z: bz }, { x: bx, z: bz }, { x: bx, z: d }, { x: 0, z: d }];
  } else {
    const a = lerp(0.25, 0.4) * w, b = lerp(0.6, 0.75) * w, c = lerp(0.3, 0.6) * d;
    poly = [{ x: 0, z: 0 }, { x: w, z: 0 }, { x: w, z: d }, { x: b, z: d }, { x: b, z: c }, { x: a, z: c }, { x: a, z: d }, { x: 0, z: d }];
  }

  const ang = lerp(0, 2 * Math.PI), off = { x: lerp(-5000, 5000), z: lerp(-5000, 5000) };
  const place = (p: P): P => ({
    x: off.x + p.x * Math.cos(ang) - p.z * Math.sin(ang),
    z: off.z + p.x * Math.sin(ang) + p.z * Math.cos(ang),
  });
  let twice = 0;
  poly.forEach((p, i) => { const q = poly[(i + 1) % poly.length]; twice += p.x * q.z - q.x * p.z; });
  const heights = rnd() < 0.8;
  const tall = heights ? { heightMm: 2600, topMm: 2600 } : {};
  const segments: LoopSegment[] = [];

  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const L = Math.hypot(b.x - a.x, b.z - a.z), dx = (b.x - a.x) / L, dz = (b.z - a.z) / L;
    const ix = twice > 0 ? -dz : dz, iz = twice > 0 ? dx : -dx;
    const pieces = 1 + Math.floor(rnd() * 3);
    let s0 = 0;
    for (let n = 0; n < pieces; n++) {
      const s1 = n === pieces - 1 ? L : s0 + (L - s0) * lerp(0.3, 0.7);
      const gap = n > 0 && rnd() < 0.4 ? lerp(0, 600) : 0;
      const inset = n > 0 && rnd() < 0.5 ? lerp(0, 180) : 0;
      if (s1 - (s0 + gap) > 100) {
        segments.push({
          a: place({ x: a.x + dx * (s0 + gap) + ix * inset, z: a.z + dz * (s0 + gap) + iz * inset }),
          b: place({ x: a.x + dx * s1 + ix * inset, z: a.z + dz * s1 + iz * inset }),
          ...tall,
        });
      }
      s0 = s1;
    }
    if (heights && rnd() < 0.25 && L > 1500) {
      const s = lerp(200, L - 1200), o = lerp(150, 600);
      const A = { x: a.x + dx * s + ix * o, z: a.z + dz * s + iz * o };
      segments.push({ a: place(A), b: place({ x: A.x + dx * 900, z: A.z + dz * 900 }), heightMm: 450, topMm: 450 });
    }
  });

  // A free-standing pillar, well clear of the walls.
  const segDist = (px: number, pz: number, a: P, b: P) => {
    const vx = b.x - a.x, vz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (pz - a.z) * vz) / (vx * vx + vz * vz)));
    return Math.hypot(px - a.x - vx * t, pz - a.z - vz * t);
  };
  const inside = (px: number, pz: number) => {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.z > pz) !== (b.z > pz) && px < a.x + ((pz - a.z) / (b.z - a.z)) * (b.x - a.x)) hit = !hit;
    }
    return hit;
  };
  const cx = lerp(900, 2300), cz = lerp(900, 2300);
  const clear = Math.min(...poly.map((a, i) => segDist(cx, cz, a, poly[(i + 1) % poly.length])));
  if (rnd() < 0.4 && inside(cx, cz) && clear > 800) {
    if (rnd() < 0.6) {
      const r = lerp(150, 400), n = [8, 12, 24][Math.floor(rnd() * 3)];
      for (let i = 0; i < n; i++) {
        const t0 = (2 * Math.PI * i) / n, t1 = (2 * Math.PI * (i + 1)) / n;
        segments.push({
          a: place({ x: cx + r * Math.cos(t0), z: cz + r * Math.sin(t0) }),
          b: place({ x: cx + r * Math.cos(t1), z: cz + r * Math.sin(t1) }),
          ...tall,
        });
      }
    } else {
      const h = lerp(150, 300);
      const c = [{ x: cx - h, z: cz - h }, { x: cx + h, z: cz - h }, { x: cx + h, z: cz + h }, { x: cx - h, z: cz + h }];
      c.forEach((p, i) => segments.push({ a: place(p), b: place(c[(i + 1) % 4]), ...tall }));
    }
  }
  return { truth: poly.map(place), segments, shape };
}

export const area = (q: P[]) =>
  Math.abs(q.reduce((n, a, i) => { const b = q[(i + 1) % q.length]; return n + a.x * b.z - b.x * a.z; }, 0)) / 2;

/** How far an outline is from the truth: missed corners, invented ones, area. */
export function outlineError(outline: P[], truth: P[]): { missed: number; invented: number; areaErr: number } {
  if (outline.length === 0) return { missed: Infinity, invented: Infinity, areaErr: 1 };
  const missed = Math.max(...truth.map((v) => Math.min(...outline.map((w) => Math.hypot(v.x - w.x, v.z - w.z)))));
  const invented = Math.max(...outline.map((w) => Math.min(...truth.map((v) => Math.hypot(v.x - w.x, v.z - w.z)))));
  return { missed, invented, areaErr: Math.abs(area(outline) - area(truth)) / area(truth) };
}

/** The acceptance bar: every corner within 5mm, area within 0.2%. */
export const isAccurate = (e: { missed: number; invented: number; areaErr: number }) =>
  e.missed <= 5 && e.invented <= 5 && e.areaErr <= 0.002;
