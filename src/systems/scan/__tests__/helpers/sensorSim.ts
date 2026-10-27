import type { DepthRay } from '@/systems/scan/glassFinder';
import { mulberry32 } from './roomGen';

// ---------------------------------------------------------------------------
// A walk around a room with an iPad's depth sensor, simulated.
//
// The glass and pillar finders are judged on what the sensor would actually
// hand them, not on rays drawn to make a test pass. So this ray-casts a real
// room — walls, floor, ceiling, columns, furniture, panes of glass and what is
// behind them — from a scanning walk, and reports each reading the way ARKit
// does, sampled on the same 24 x 18 grid FixtureCapture.sampleRays uses:
//
//   * Range. Confident to ~3.5 m, medium to 5 m, nothing beyond.
//   * Incidence. A surface seen edge-on returns nothing.
//   * Daylight. The sun floods the LiDAR's band: everything past 2.5 m loses a
//     confidence level, and nothing is measured through a sunlit pane at all.
//   * The fill. Where ARKit has no measurement it still reports a depth — its
//     guess — at LOW confidence. `fill` picks the guess: painted at the depth
//     of the pane ('wall', the worst case and the common one), somewhere far
//     beyond ('beyond'), or no depth at all ('none').
//   * Brightness. A pane is blown out in daylight, dark at night; a sunlit
//     patch of wall is blown out too, and still measured.
//
// Millimetres, y up from the floor. Deterministic for a given seed.
// ---------------------------------------------------------------------------

type P = { x: number; z: number };
type V3 = { x: number; y: number; z: number };

export type Surface = 'glass' | 'mirror' | 'tv' | 'dark' | 'sunlit';

/** A region of wall `wall` (edge wall → wall+1), `t` along it, `y` up it. */
export interface Patch {
  wall: number;
  t0: number;
  t1: number;
  y0: number;
  y1: number;
  surface: Surface;
}

export interface SimPillar {
  x: number;
  z: number;
  shape: 'round' | 'box';
  /** Diameter for round; x extent for box. */
  width: number;
  /** z extent for box. */
  depth?: number;
}

/** Furniture, as an axis-aligned box. */
export interface SimBox {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y0: number;
  y1: number;
}

export interface SimRoom {
  /** Counter-clockwise in (x, z). */
  polygon: P[];
  ceiling: number;
  patches?: Patch[];
  pillars?: SimPillar[];
  furniture?: SimBox[];
  /** Behind the glass: a balcony whose parapet stands this far out, or nothing in reach. */
  balconyMm?: number | null;
  /** The walk, as a closed loop. Defaults to the bounding box inset by 1.1 m. */
  path?: P[];
  /**
   * Bulkheads and soffits: solid, hanging from the ceiling down to `bottom`
   * over any outline — along a window, across the room, at an angle.
   */
  soffits?: { polygon: P[]; bottom: number }[];
  /**
   * An open ceiling (expanded metal mesh, a grid with no tiles): `open` of the
   * sensor's dots pass through it to the slab at `slab`. Where a dot and its
   * neighbours disagree, ARKit's smoothed depth lands somewhere in between.
   */
  ceilingMesh?: { open: number; slab: number };
}

export interface SimConditions {
  daylight: boolean;
  fill: 'wall' | 'beyond' | 'none';
  /** Harsher sun: a level of confidence lost past 2 m, two past 3 m. */
  harsh?: boolean;
  seed?: number;
  laps?: number;
  stepMm?: number;
}

const PARAPET_MM = 1100;
const NO_DEPTH_MM = 8000;
const FX = 212;
const DEPTH_W = 256;
const DEPTH_H = 192;
const COLS = 24;
const ROWS = 18;

interface Hit {
  t: number;
  kind: 'wall' | 'floor' | 'ceiling' | 'pillar' | 'box' | 'soffit';
  wall?: number;
  u?: number;
  normal: V3;
}

const add = (a: V3, b: V3, k = 1): V3 => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });
const dot3 = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const norm3 = (a: V3): V3 => {
  const l = Math.hypot(a.x, a.y, a.z);
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

function edges(room: SimRoom) {
  const n = room.polygon.length;
  return room.polygon.map((a, i) => {
    const b = room.polygon[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const d = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
    return { a, len, d, inward: { x: -d.z, z: d.x } };
  });
}

/** First thing a ray from inside the room meets. */
function cast(room: SimRoom, o: V3, dir: V3): Hit | null {
  let best: Hit | null = null;
  const take = (h: Hit) => {
    if (h.t > 1 && (!best || h.t < best.t)) best = h;
  };
  edges(room).forEach((e, i) => {
    const out = dir.x * e.inward.x + dir.z * e.inward.z;
    if (out >= -1e-9) return;
    const s = (o.x - e.a.x) * e.inward.x + (o.z - e.a.z) * e.inward.z;
    const t = -s / out;
    const p = add(o, dir, t);
    const u = (p.x - e.a.x) * e.d.x + (p.z - e.a.z) * e.d.z;
    if (u < 0 || u > e.len || p.y < 0 || p.y > room.ceiling) return;
    take({ t, kind: 'wall', wall: i, u, normal: { x: e.inward.x, y: 0, z: e.inward.z } });
  });
  if (dir.y < 0) take({ t: -o.y / dir.y, kind: 'floor', normal: { x: 0, y: 1, z: 0 } });
  if (dir.y > 0) take({ t: (room.ceiling - o.y) / dir.y, kind: 'ceiling', normal: { x: 0, y: -1, z: 0 } });

  for (const c of room.pillars ?? []) {
    if (c.shape === 'round') {
      const r = c.width / 2;
      const ox = o.x - c.x, oz = o.z - c.z;
      const A = dir.x * dir.x + dir.z * dir.z;
      const B = 2 * (ox * dir.x + oz * dir.z);
      const C = ox * ox + oz * oz - r * r;
      const disc = B * B - 4 * A * C;
      if (A < 1e-12 || disc < 0) continue;
      const t = (-B - Math.sqrt(disc)) / (2 * A);
      const p = add(o, dir, t);
      if (p.y < 0 || p.y > room.ceiling) continue;
      take({ t, kind: 'pillar', normal: norm3({ x: p.x - c.x, y: 0, z: p.z - c.z }) });
    } else {
      const hw = c.width / 2, hd = (c.depth ?? c.width) / 2;
      const h = slab(o, dir, { x0: c.x - hw, x1: c.x + hw, z0: c.z - hd, z1: c.z + hd, y0: 0, y1: room.ceiling });
      if (h) take({ ...h, kind: 'pillar' });
    }
  }
  for (const b of room.furniture ?? []) {
    const h = slab(o, dir, b);
    if (h) take({ ...h, kind: 'box' });
  }
  for (const sf of room.soffits ?? []) {
    // Its underside…
    if (dir.y > 0 && o.y < sf.bottom) {
      const t = (sf.bottom - o.y) / dir.y;
      const p = add(o, dir, t);
      if (inside(p, sf.polygon)) take({ t, kind: 'soffit', normal: { x: 0, y: -1, z: 0 } });
    }
    // …and its sides.
    const m = sf.polygon.length;
    for (let i = 0; i < m; i++) {
      const a = sf.polygon[i], b = sf.polygon[(i + 1) % m];
      const ex = b.x - a.x, ez = b.z - a.z;
      const den = dir.x * ez - dir.z * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((a.x - o.x) * ez - (a.z - o.z) * ex) / den;
      const u = ((a.x - o.x) * dir.z - (a.z - o.z) * dir.x) / den;
      if (u < 0 || u > 1) continue;
      const p = add(o, dir, t);
      if (p.y < sf.bottom || p.y > room.ceiling) continue;
      const len = Math.hypot(ex, ez);
      let normal = { x: ez / len, y: 0, z: -ex / len };
      if (dot3(normal, dir) > 0) normal = { x: -normal.x, y: 0, z: -normal.z };
      take({ t, kind: 'soffit', normal });
    }
  }
  return best;
}

function inside(p: { x: number; z: number }, poly: P[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
}

/** Ray against an axis-aligned box, from outside it. */
function slab(o: V3, dir: V3, b: SimBox): { t: number; normal: V3 } | null {
  let t0 = -Infinity, t1 = Infinity;
  let normal: V3 = { x: 0, y: 1, z: 0 };
  const axes: [keyof V3, number, number][] = [['x', b.x0, b.x1], ['y', b.y0, b.y1], ['z', b.z0, b.z1]];
  for (const [k, lo, hi] of axes) {
    if (Math.abs(dir[k]) < 1e-12) {
      if (o[k] < lo || o[k] > hi) return null;
      continue;
    }
    let a = (lo - o[k]) / dir[k];
    let c = (hi - o[k]) / dir[k];
    let sign = -1;
    if (a > c) { [a, c] = [c, a]; sign = 1; }
    if (a > t0) {
      t0 = a;
      normal = { x: 0, y: 0, z: 0, [k]: sign } as V3;
    }
    t1 = Math.min(t1, c);
    if (t0 > t1) return null;
  }
  return t0 > 0 ? { t: t0, normal } : null;
}

function patchAt(room: SimRoom, h: Hit, y: number): Patch | undefined {
  if (h.kind !== 'wall') return undefined;
  return (room.patches ?? []).find(
    (p) => p.wall === h.wall && h.u! >= p.t0 && h.u! <= p.t1 && y >= p.y0 && y <= p.y1,
  );
}

function baseConfidence(range: number, cos: number, daylight: boolean, harsh = false): number {
  if (cos < 0.25) return 0;
  let c = range <= 3500 ? 2 : range <= 5000 ? 1 : 0;
  if (daylight && harsh) c -= (range > 2000 ? 1 : 0) + (range > 3000 ? 1 : 0);
  else if (daylight && range > 2500) c -= 1;
  return Math.max(0, c);
}

/** What lies beyond a pane: the balcony floor or parapet, if in reach. */
function beyondPane(room: SimRoom, p: V3, dir: V3, wall: number): number | null {
  if (room.balconyMm == null) return null;
  const e = edges(room)[wall];
  const out = -(dir.x * e.inward.x + dir.z * e.inward.z);
  if (out <= 1e-9) return null;
  let best: number | null = null;
  if (dir.y < 0) {
    const t = -p.y / dir.y;
    if (t * out <= room.balconyMm) best = t;
  }
  const tp = room.balconyMm / out;
  const yp = p.y + dir.y * tp;
  if (yp >= 0 && yp <= PARAPET_MM && (best === null || tp < best)) best = tp;
  return best;
}

interface Reading {
  depth: number | null;
  confidence: number;
  luma: number;
}

function read(room: SimRoom, eye: V3, dir: V3, c: SimConditions, rnd: () => number): Reading | null {
  const h = cast(room, eye, dir);
  if (!h) return null;
  const noise = () => (rnd() - 0.5) * 2;
  const r = h.t;
  const p = add(eye, dir, r);
  const cos = Math.abs(dot3(dir, h.normal));
  const patch = patchAt(room, h, p.y);
  const lit = (base: number) => Math.max(0, Math.min(255, base + noise() * 8));
  const measured = (range: number, luma: number, confidence = baseConfidence(range, cos, c.daylight, c.harsh)): Reading => ({
    depth: range * (1 + noise() * 0.006),
    confidence,
    luma: lit(luma),
  });
  const fillFor = (pane: number, far: number | null): number | null =>
    c.fill === 'wall' ? pane * (1 + noise() * 0.01)
      : c.fill === 'beyond' ? (far ?? pane + 3000 + rnd() * 2000)
        : null;

  if (h.kind === 'ceiling' && room.ceilingMesh) {
    // Through the mesh to the slab, or caught on it, or ARKit's blend of both.
    const through = (room.ceilingMesh.slab - room.ceiling) / dir.y;
    const u = rnd();
    const extra = u < room.ceilingMesh.open ? through
      : u < room.ceilingMesh.open + 0.15 ? through * rnd()
        : 0;
    return measured(r + extra, extra > 0 ? 90 : 175);
  }
  if (!patch) {
    const luma = h.kind === 'floor' ? 120 : h.kind === 'ceiling' || h.kind === 'soffit' ? 175 : h.kind === 'box' ? 95 : 150;
    return measured(r, luma);
  }
  switch (patch.surface) {
    case 'sunlit':
      return measured(r, 252, Math.min(1, baseConfidence(r, cos, c.daylight, c.harsh)));
    case 'dark':
      return { depth: r, confidence: r < 2500 && cos >= 0.25 ? 1 : 0, luma: lit(25) };
    case 'tv':
      return { depth: r, confidence: 0, luma: lit(240) };
    case 'mirror': {
      const n = h.normal;
      const k = 2 * dot3(dir, n);
      const reflected = norm3({ x: dir.x - k * n.x, y: dir.y - k * n.y, z: dir.z - k * n.z });
      const second = cast(room, add(p, reflected, 2), reflected);
      if (!second) return null;
      return measured(r + second.t, 130);
    }
    case 'glass': {
      const t = beyondPane(room, p, dir, h.wall!);
      const range = t === null ? null : r + t;
      if (c.daylight) {
        return { depth: fillFor(r, range), confidence: 0, luma: lit(250) };
      }
      if (range !== null && range <= 5000) {
        return { depth: range * (1 + noise() * 0.006), confidence: range <= 3500 ? 2 : 1, luma: lit(30) };
      }
      return { depth: fillFor(r, range), confidence: 0, luma: lit(25) };
    }
  }
}

function defaultPath(room: SimRoom): P[] {
  const xs = room.polygon.map((p) => p.x), zs = room.polygon.map((p) => p.z);
  const x0 = Math.min(...xs) + 1100, x1 = Math.max(...xs) - 1100;
  const z0 = Math.min(...zs) + 1100, z1 = Math.max(...zs) - 1100;
  return [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
}

/** Every reading banked on a scanning walk, as FixtureCapture banks them. */
export function simulateScan(room: SimRoom, c: SimConditions): DepthRay[] {
  const rnd = mulberry32(c.seed ?? 7);
  const path = room.path ?? defaultPath(room);
  const step = c.stepMm ?? 250;
  const laps = c.laps ?? 2;
  const centre = {
    x: room.polygon.reduce((n, p) => n + p.x, 0) / room.polygon.length,
    z: room.polygon.reduce((n, p) => n + p.z, 0) / room.polygon.length,
  };
  const es = edges(room);

  const stations: P[] = [];
  for (let i = 0; i < path.length; i++) {
    const a = path[i], b = path[(i + 1) % path.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    for (let s = 0; s < len; s += step) stations.push({ x: a.x + ((b.x - a.x) * s) / len, z: a.z + ((b.z - a.z) * s) / len });
  }

  const rays: DepthRay[] = [];
  let frame = 0;
  for (let lap = 0; lap < laps; lap++) {
    for (const st of stations) {
      frame++;
      // Face the nearest wall, sweeping across it; every fourth look goes
      // across the room, the way a scan takes in the middle of it.
      let yaw: number;
      if (frame % 4 === 0) {
        yaw = Math.atan2(centre.z - st.z, centre.x - st.x) + (rnd() - 0.5) * 1.2;
      } else {
        let nearest = es[0], dmin = Infinity;
        for (const e of es) {
          const s = (st.x - e.a.x) * e.inward.x + (st.z - e.a.z) * e.inward.z;
          if (s > 0 && s < dmin) { dmin = s; nearest = e; }
        }
        yaw = Math.atan2(-nearest.inward.z, -nearest.inward.x) + Math.sin(frame * 0.9 + lap) * 0.9;
      }
      const pitch = Math.sin(frame * 1.3 + lap * 2) * 0.5;
      const eye: V3 = { x: st.x, y: 1350 + (rnd() - 0.5) * 200, z: st.z };
      const fwd: V3 = { x: Math.cos(pitch) * Math.cos(yaw), y: Math.sin(pitch), z: Math.cos(pitch) * Math.sin(yaw) };
      const right: V3 = { x: -Math.sin(yaw), y: 0, z: Math.cos(yaw) };
      const up: V3 = { x: -Math.cos(yaw) * Math.sin(pitch), y: Math.cos(pitch), z: -Math.sin(yaw) * Math.sin(pitch) };

      for (let gy = 0; gy < ROWS; gy++) {
        const py = ((gy + 0.5) * DEPTH_H) / ROWS;
        for (let gx = 0; gx < COLS; gx++) {
          const px = ((gx + 0.5) * DEPTH_W) / COLS;
          const a = (px - DEPTH_W / 2) / FX;
          const b = -(py - DEPTH_H / 2) / FX;
          const dir = norm3(add(add(fwd, right, a), up, b));
          const reading = read(room, eye, dir, c, rnd);
          if (!reading) continue;
          if (reading.depth === null) {
            rays.push({ eye, hit: add(eye, dir, NO_DEPTH_MM), confidence: 0, luma: reading.luma });
            continue;
          }
          if (reading.depth <= 300) continue;
          rays.push({ eye, hit: add(eye, dir, reading.depth), confidence: reading.confidence, luma: reading.luma });
        }
      }
    }
  }
  return rays;
}

/**
 * What the first version of the scanner kept: low-confidence readings were
 * dropped before they were ever banked, and nothing else was recorded.
 */
export function asFirstVersionBanked(rays: DepthRay[]): DepthRay[] {
  return rays.filter((r) => (r.confidence ?? 2) >= 1).map(({ eye, hit }) => ({ eye, hit }));
}
