/**
 * The lines the scan screen draws over the camera, worked out from the room so
 * far instead of taken from RoomPlan's own overlay.
 *
 * RoomPlan redraws its lines every time it re-fits a surface, several times a
 * second, so they flicker and jump; a door it fits short of the floor is drawn
 * floating; and where the ceiling steps down to a bulkhead its walls run on to
 * whichever height it saw last. Here the lines come from the model the floor
 * plan is built from — WallLoop's outline, the ceiling finder's height and
 * bulkheads, openings stood on the floor — after `SurfaceTracker` has held each
 * surface still until a change in it has lasted.
 *
 * Two parts, both pure:
 *
 *   * `buildLiveLines` — a room (outline, ceiling, bulkheads, openings,
 *     columns) → the line segments to draw. The top of each wall follows the
 *     ceiling over it, stepping down under a bulkhead and back up after it,
 *     whatever shape the bulkhead's edge has; doors stand on the floor.
 *   * `SurfaceTracker` — the room's surfaces as they arrive, update after
 *     update → the ones worth drawing, where to draw them. A surface is drawn
 *     once it has been seen twice, outlives a missed update or four, ignores
 *     wobble under 25 mm, and once it has held still it only moves for a change
 *     that persists.
 *
 * Millimetres. Plan (x, z); y is height above the floor. Same code as
 * `Scan/LiveLines.swift`.
 */

type P = { x: number; z: number };

export interface P3 {
  x: number;
  y: number;
  z: number;
}

export type LineKind = 'floor' | 'ceiling' | 'corner' | 'door' | 'window' | 'glass' | 'bulkhead' | 'pillar';

export interface LiveLine {
  a: P3;
  b: P3;
  kind: LineKind;
}

/** A door, window or opening, placed by its centre — it is put on whichever wall it is at. */
export interface LiveOpening {
  center: P;
  width: number;
  /** Bottom and top of the box it was measured as, mm above the floor. */
  bottom: number;
  top: number;
  type: 'door' | 'window' | 'archway';
  /** Suggested from readings that went through the wall. */
  glass?: boolean;
}

export interface LivePillar {
  center: P;
  shape: 'round' | 'box';
  width: number;
  depth: number;
  /** Yaw of the width axis, radians, plan sense. */
  rotation: number;
}

/** Part of the ceiling at another height — a bulkhead (lower) or a recess (higher). */
export interface LiveZone {
  polygon: P[];
  height: number;
}

export interface LiveRoom {
  /** The outline, either winding. */
  polygon: P[];
  /**
   * The walls actually seen. The outline is always closed — before the last
   * wall has been scanned it closes straight across the gap — so an edge with
   * no seen wall along it is a guess, and is not drawn. Absent: all are drawn.
   */
  walls?: { a: P; b: P }[];
  /** The main ceiling, mm above the floor. */
  ceiling: number;
  zones: LiveZone[];
  openings: LiveOpening[];
  pillars: LivePillar[];
}

export interface LiveLineOptions {
  /** A bulkhead's corner this close to a room corner, or edge this close to a wall, is put on it. */
  snapMm?: number;
  /** How far inside a wall to look for the ceiling over it. */
  probeMm?: number;
  /** Heights closer than this are one height, not a step. */
  minStepMm?: number;
  /** A stretch of wall top shorter than this joins its neighbour. */
  minRunMm?: number;
  /** A point this close to a wall is on it. */
  onWallMm?: number;
  /** An opening further than this from every wall is not drawn. */
  openingReachMm?: number;
  /** Narrower or shorter than this is not an opening worth drawing. */
  minOpeningMm?: number;
  /** A door's box is run down to the floor by at most this. */
  doorReachMm?: number;
  /** Sides of the circle a round column is drawn with. */
  circleSegments?: number;
  /** A seen wall this close to an edge's line, and this near parallel, lies along it. */
  supportMm?: number;
  supportDeg?: number;
  /** An edge is seen when walls lie along this much of it (or the share below, if less). */
  supportLengthMm?: number;
  supportShare?: number;
}

export const LIVE_LINE_DEFAULTS: Required<LiveLineOptions> = {
  snapMm: 150,
  probeMm: 30,
  minStepMm: 40,
  minRunMm: 150,
  onWallMm: 1,
  openingReachMm: 600,
  minOpeningMm: 100,
  doorReachMm: 600,
  circleSegments: 16,
  supportMm: 250,
  supportDeg: 10,
  supportLengthMm: 600,
  supportShare: 0.3,
};

const dist = (a: P, b: P): number => Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z));

function nearestOnSegment(p: P, a: P, b: P): { q: P; d: number; t: number } {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  let t = len2 > 0 ? ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const q = { x: a.x + abx * t, z: a.z + abz * t };
  return { q, d: dist(p, q), t };
}

function signedArea(poly: P[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.z - b.x * a.z;
  }
  return s / 2;
}

function inside(p: P, poly: P[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) hit = !hit;
  }
  return hit;
}

/** Drop repeated points (within 1 mm), the closing repeat included. */
function dedupe(poly: P[]): P[] {
  const out: P[] = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > 1 || Math.abs(last.z - p.z) > 1) out.push({ x: p.x, z: p.z });
  }
  if (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.abs(a.x - b.x) <= 1 && Math.abs(a.z - b.z) <= 1) out.pop();
  }
  return out;
}

/**
 * A bulkhead's outline put onto the room as it is now: corners near a room
 * corner into it, edges near a wall onto it. The finder snapped it to the room
 * it saw; the walls have moved a little since.
 */
function snapZone(zone: P[], room: P[], snapMm: number): P[] {
  const n = room.length;
  const snapped = zone.map((p): P => {
    let corner: P | null = null;
    let cornerD = Infinity;
    for (const c of room) {
      const d = dist(p, c);
      if (d < cornerD) {
        cornerD = d;
        corner = c;
      }
    }
    if (corner && cornerD <= snapMm) return { x: corner.x, z: corner.z };
    let wall = { q: p, d: Infinity };
    for (let i = 0; i < n; i++) {
      const hit = nearestOnSegment(p, room[i], room[(i + 1) % n]);
      if (hit.d < wall.d) wall = { q: hit.q, d: hit.d };
    }
    return wall.d <= snapMm || !inside(p, room) ? { x: wall.q.x, z: wall.q.z } : { x: p.x, z: p.z };
  });
  const clean = dedupe(snapped);
  return clean.length >= 3 && Math.abs(signedArea(clean)) >= 1000 ? clean : [];
}

interface Run {
  t0: number;
  t1: number;
  h: number;
}

/** Neighbouring stretches at the same height become one, at the longer one's height. */
function joinEqual(runs: Run[], minStep: number): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.h - r.h) < minStep) {
      if (r.t1 - r.t0 > last.t1 - last.t0) last.h = r.h;
      last.t1 = r.t1;
    } else {
      out.push({ t0: r.t0, t1: r.t1, h: r.h });
    }
  }
  return out;
}

/** …and a stretch too short to be a step of its own goes to the neighbour nearest its height. */
function mergeRuns(runs: Run[], minStep: number, minRun: number): Run[] {
  let out = joinEqual(runs, minStep);
  while (out.length > 1) {
    let k = -1;
    let shortest = Infinity;
    for (let i = 0; i < out.length; i++) {
      const len = out[i].t1 - out[i].t0;
      if (len < minRun && len < shortest) {
        shortest = len;
        k = i;
      }
    }
    if (k < 0) break;
    const prev = k > 0 ? out[k - 1] : null;
    const next = k + 1 < out.length ? out[k + 1] : null;
    const toPrev = !next || (prev !== null && Math.abs(prev.h - out[k].h) <= Math.abs(next.h - out[k].h));
    if (toPrev && prev) prev.t1 = out[k].t1;
    else if (next) next.t0 = out[k].t0;
    out.splice(k, 1);
    out = joinEqual(out, minStep);
  }
  return out;
}

export function buildLiveLines(room: LiveRoom, options: LiveLineOptions = {}): LiveLine[] {
  const o = { ...LIVE_LINE_DEFAULTS, ...options };
  const poly = dedupe(room.polygon);
  const n = poly.length;
  if (n < 3) return [];
  const sign = signedArea(poly) >= 0 ? 1 : -1;
  const H = room.ceiling;
  const at = (p: P, y: number): P3 => ({ x: p.x, y, z: p.z });

  const zones = room.zones
    .map((z) => ({ polygon: snapZone(z.polygon, poly, o.snapMm), height: z.height }))
    .filter((z) => z.polygon.length >= 3 && Math.abs(z.height - H) >= o.minStepMm);

  /** The ceiling over a point: the lowest bulkhead it is under, else the ceiling. */
  const heightAt = (p: P): number => {
    let h = Infinity;
    for (const z of zones) if (z.height < h && inside(p, z.polygon)) h = z.height;
    return h === Infinity ? H : h;
  };
  const onWall = (p: P): number => {
    for (let i = 0; i < n; i++) if (nearestOnSegment(p, poly[i], poly[(i + 1) % n]).d <= o.onWallMm) return i;
    return -1;
  };

  /** Is there a seen wall along edge i — or is it the outline closing a gap? */
  const minCos = Math.cos((o.supportDeg * Math.PI) / 180);
  const seen = poly.map((a, i) => {
    if (!room.walls) return true;
    const b = poly[(i + 1) % n];
    const L = dist(a, b);
    const dir = { x: (b.x - a.x) / L, z: (b.z - a.z) / L };
    const spans: [number, number][] = [];
    for (const w of room.walls) {
      const wl = dist(w.a, w.b);
      if (wl < 1) continue;
      const along = Math.abs(((w.b.x - w.a.x) / wl) * dir.x + ((w.b.z - w.a.z) / wl) * dir.z);
      if (along < minCos) continue;
      const offA = Math.abs((w.a.x - a.x) * dir.z - (w.a.z - a.z) * dir.x);
      const offB = Math.abs((w.b.x - a.x) * dir.z - (w.b.z - a.z) * dir.x);
      if (Math.max(offA, offB) > o.supportMm) continue;
      const t0 = (w.a.x - a.x) * dir.x + (w.a.z - a.z) * dir.z;
      const t1 = (w.b.x - a.x) * dir.x + (w.b.z - a.z) * dir.z;
      const lo = Math.max(0, Math.min(t0, t1));
      const hi = Math.min(L, Math.max(t0, t1));
      if (hi > lo) spans.push([lo, hi]);
    }
    spans.sort((u, v) => u[0] - v[0] || u[1] - v[1]);
    let covered = 0;
    let end = -Infinity;
    for (const [lo, hi] of spans) {
      if (hi <= end) continue;
      covered += hi - Math.max(lo, end);
      end = hi;
    }
    return covered >= Math.min(o.supportLengthMm, o.supportShare * L);
  });

  const lines: LiveLine[] = [];
  const runsOf: Run[][] = [];

  // Each wall: its floor line, and its top following the ceiling over it.
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const L = dist(a, b);
    const dir = { x: (b.x - a.x) / L, z: (b.z - a.z) / L };
    const inward = { x: -dir.z * sign, z: dir.x * sign };
    if (seen[i]) lines.push({ a: at(a, 0), b: at(b, 0), kind: 'floor' });

    // Where a bulkhead's outline meets this wall, its top may step.
    const ts = [0, L];
    for (const z of zones) {
      for (const v of z.polygon) {
        const hit = nearestOnSegment(v, a, b);
        if (hit.d <= o.onWallMm) ts.push(hit.t * L);
      }
    }
    ts.sort((u, v) => u - v);
    const cuts: number[] = [];
    for (const t of ts) if (cuts.length === 0 || t - cuts[cuts.length - 1] > 1) cuts.push(t);
    cuts[0] = 0;
    if (cuts.length === 1) cuts.push(L);
    else cuts[cuts.length - 1] = L;

    const raw: Run[] = [];
    for (let k = 0; k + 1 < cuts.length; k++) {
      const tm = (cuts[k] + cuts[k + 1]) / 2;
      const probe = { x: a.x + dir.x * tm + inward.x * o.probeMm, z: a.z + dir.z * tm + inward.z * o.probeMm };
      raw.push({ t0: cuts[k], t1: cuts[k + 1], h: heightAt(probe) });
    }
    const runs = mergeRuns(raw, o.minStepMm, o.minRunMm);
    runsOf.push(runs);
    if (!seen[i]) continue;
    const along = (t: number): P => ({ x: a.x + dir.x * t, z: a.z + dir.z * t });
    runs.forEach((r, k) => {
      lines.push({ a: at(along(r.t0), r.h), b: at(along(r.t1), r.h), kind: 'ceiling' });
      const next = runs[k + 1];
      if (next) {
        const p = along(r.t1);
        lines.push({ a: at(p, Math.min(r.h, next.h)), b: at(p, Math.max(r.h, next.h)), kind: 'ceiling' });
      }
    });
  }

  // Corners, floor to wherever the walls meet the ceiling — where a seen wall ends.
  for (let i = 0; i < n; i++) {
    if (!seen[i] && !seen[(i - 1 + n) % n]) continue;
    const before = runsOf[(i - 1 + n) % n];
    const top = Math.max(before[before.length - 1].h, runsOf[i][0].h);
    lines.push({ a: at(poly[i], 0), b: at(poly[i], top), kind: 'corner' });
  }

  // Bulkheads: the edges that are not on a wall, at the bulkhead's underside
  // and where its face meets the ceiling, and its corners out in the room.
  for (const z of zones) {
    const zp = z.polygon;
    const m = zp.length;
    const lo = Math.min(z.height, H);
    const hi = Math.max(z.height, H);
    for (let j = 0; j < m; j++) {
      const p = zp[j];
      const q = zp[(j + 1) % m];
      let alongWall = false;
      for (let i = 0; i < n && !alongWall; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % n];
        alongWall = nearestOnSegment(p, a, b).d <= o.onWallMm && nearestOnSegment(q, a, b).d <= o.onWallMm;
      }
      if (alongWall) continue;
      lines.push({ a: at(p, z.height), b: at(q, z.height), kind: 'bulkhead' });
      lines.push({ a: at(p, H), b: at(q, H), kind: 'bulkhead' });
    }
    for (let j = 0; j < m; j++) {
      const v = zp[j];
      if (onWall(v) >= 0) continue;
      const u = zp[(j - 1 + m) % m];
      const w = zp[(j + 1) % m];
      const e1 = { x: v.x - u.x, z: v.z - u.z };
      const e2 = { x: w.x - v.x, z: w.z - v.z };
      const cross = e1.x * e2.z - e1.z * e2.x;
      const lens = Math.sqrt(e1.x * e1.x + e1.z * e1.z) * Math.sqrt(e2.x * e2.x + e2.z * e2.z);
      if (lens <= 0 || Math.abs(cross) / lens < Math.sin((10 * Math.PI) / 180)) continue;
      lines.push({ a: at(v, lo), b: at(v, hi), kind: 'bulkhead' });
    }
  }

  // Openings, on the wall they are at. A door stands on the floor.
  for (const op of room.openings) {
    let wall = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const d = nearestOnSegment(op.center, poly[i], poly[(i + 1) % n]).d;
      if (d < best) {
        best = d;
        wall = i;
      }
    }
    if (wall < 0 || best > o.openingReachMm || !seen[wall]) continue;
    const a = poly[wall];
    const b = poly[(wall + 1) % n];
    const L = dist(a, b);
    const dir = { x: (b.x - a.x) / L, z: (b.z - a.z) / L };
    const t = (op.center.x - a.x) * dir.x + (op.center.z - a.z) * dir.z;
    const s0 = Math.max(0, Math.min(L, t - op.width / 2));
    const s1 = Math.max(0, Math.min(L, t + op.width / 2));
    if (s1 - s0 < o.minOpeningMm) continue;
    const runs = runsOf[wall];
    const tc = Math.max(0, Math.min(L, t));
    let border = runs[runs.length - 1].h;
    for (const r of runs) {
      if (tc >= r.t0 && tc <= r.t1) {
        border = r.h;
        break;
      }
    }
    const boxH = op.top - op.bottom;
    let y0: number;
    let y1: number;
    if (op.type === 'window') {
      y0 = Math.max(0, op.bottom);
      y1 = Math.min(op.top, border);
    } else {
      y0 = 0;
      y1 = Math.min(Math.min(Math.max(boxH, op.top), boxH + o.doorReachMm), border);
    }
    if (y1 - y0 < o.minOpeningMm) continue;
    const kind: LineKind = op.glass ? 'glass' : op.type === 'window' ? 'window' : 'door';
    const p0 = { x: a.x + dir.x * s0, z: a.z + dir.z * s0 };
    const p1 = { x: a.x + dir.x * s1, z: a.z + dir.z * s1 };
    lines.push({ a: at(p0, y0), b: at(p0, y1), kind });
    lines.push({ a: at(p0, y1), b: at(p1, y1), kind });
    lines.push({ a: at(p1, y1), b: at(p1, y0), kind });
    if (y0 >= 1) lines.push({ a: at(p1, y0), b: at(p0, y0), kind });
  }

  // Columns, at the floor and where they meet the ceiling over them.
  for (const c of room.pillars) {
    const top = heightAt(c.center);
    let ring: P[];
    if (c.shape === 'round') {
      const r = c.width / 2;
      const k = o.circleSegments;
      ring = Array.from({ length: k }, (_, j) => {
        const th = (2 * Math.PI * j) / k;
        return { x: c.center.x + r * Math.cos(th), z: c.center.z + r * Math.sin(th) };
      });
    } else {
      const cs = Math.cos(c.rotation);
      const sn = Math.sin(c.rotation);
      const hw = c.width / 2;
      const hd = c.depth / 2;
      ring = [
        [-hw, -hd],
        [hw, -hd],
        [hw, hd],
        [-hw, hd],
      ].map(([lx, lz]) => ({ x: c.center.x + lx * cs - lz * sn, z: c.center.z + lx * sn + lz * cs }));
    }
    const k = ring.length;
    for (let j = 0; j < k; j++) lines.push({ a: at(ring[j], 0), b: at(ring[(j + 1) % k], 0), kind: 'pillar' });
    for (let j = 0; j < k; j++) lines.push({ a: at(ring[j], top), b: at(ring[(j + 1) % k], top), kind: 'pillar' });
    if (c.shape === 'box') for (const p of ring) lines.push({ a: at(p, 0), b: at(p, top), kind: 'pillar' });
  }

  return lines.filter((l) => {
    const dx = l.b.x - l.a.x;
    const dy = l.b.y - l.a.y;
    const dz = l.b.z - l.a.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) >= 1;
  });
}

// ---------------------------------------------------------------------------
// Holding the surfaces still
// ---------------------------------------------------------------------------

/**
 * A surface as it arrives: its kind, RoomPlan's identifier for it when it has
 * one, and its numbers — millimetres (angles in milliradians), the first
 * `anchor` of them placing it on the plan.
 */
export interface TrackItem {
  kind: string;
  key?: string;
  values: number[];
}

export interface TrackedItem {
  id: number;
  kind: string;
  key?: string;
  values: number[];
  /** Has held still: it only moves now for a change that lasts. */
  locked: boolean;
  /** Was in the latest update (false while it is being kept through a miss). */
  seen: boolean;
}

export interface TrackerOptions {
  /** An item with no identifier this close to a tracked one (by its anchor) is the same item. */
  matchMm?: number;
  /** Leading values that place an item without an identifier — its x, z. */
  anchor?: number;
  /**
   * Changes smaller than this are wobble, not movement — or than `spread`
   * times how much the item's own readings wobble, if that is more.
   */
  deadbandMm?: number;
  spread?: number;
  /** Updates an item must be seen in before it is drawn. */
  showAfter?: number;
  /** Updates a drawn item outlives without being seen. */
  keepFor?: number;
  /** Updates a drawn item must hold still to lock. */
  lockAfter?: number;
  /** Updates a locked item's change must last before it moves. */
  settle?: number;
  /** Recent readings a drawn item's position is the median of… */
  window?: number;
  /** …and, once it has locked, the longer run it is the median of. */
  history?: number;
}

export const TRACKER_DEFAULTS: Required<TrackerOptions> = {
  matchMm: 400,
  anchor: 2,
  deadbandMm: 25,
  spread: 2,
  showAfter: 2,
  keepFor: 4,
  lockAfter: 4,
  settle: 2,
  window: 5,
  history: 9,
};

interface Track {
  id: number;
  kind: string;
  key?: string;
  shown: number[];
  history: number[][];
  hits: number;
  misses: number;
  visible: boolean;
  locked: boolean;
  still: number;
  away: number;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

export class SurfaceTracker {
  private readonly o: Required<TrackerOptions>;
  private tracks: Track[] = [];
  private nextId = 1;

  constructor(options: TrackerOptions = {}) {
    this.o = { ...TRACKER_DEFAULTS, ...options };
  }

  update(items: TrackItem[]): TrackedItem[] {
    const o = this.o;
    const used = items.map(() => false);
    const match = new Map<number, number>();

    // Items RoomPlan names keep their name.
    const byKey = new Map<string, number>();
    this.tracks.forEach((t, i) => {
      if (t.key !== undefined) byKey.set(`${t.kind}\u0000${t.key}`, i);
    });
    items.forEach((it, j) => {
      if (it.key === undefined) return;
      const ti = byKey.get(`${it.kind}\u0000${it.key}`);
      if (ti !== undefined && !match.has(ti)) {
        match.set(ti, j);
        used[j] = true;
      }
    });

    // The rest are found by where they are: nearest first.
    const pairs: { d: number; ti: number; j: number }[] = [];
    this.tracks.forEach((t, ti) => {
      if (t.key !== undefined) return;
      const last = t.history[t.history.length - 1];
      items.forEach((it, j) => {
        if (used[j] || it.key !== undefined || it.kind !== t.kind) return;
        let s = 0;
        for (let k = 0; k < o.anchor; k++) {
          const d = (it.values[k] ?? 0) - (last[k] ?? 0);
          s += d * d;
        }
        const d = Math.sqrt(s);
        if (d <= o.matchMm) pairs.push({ d, ti, j });
      });
    });
    pairs.sort((p, q) => p.d - q.d || p.ti - q.ti || p.j - q.j);
    for (const p of pairs) {
      if (match.has(p.ti) || used[p.j]) continue;
      match.set(p.ti, p.j);
      used[p.j] = true;
    }

    this.tracks.forEach((t, ti) => {
      const j = match.get(ti);
      if (j === undefined) {
        t.misses++;
        t.away = 0;
        return;
      }
      const raw = items[j].values;
      t.hits++;
      t.misses = 0;
      if (raw.length !== t.shown.length) {
        // Another shape altogether (a bulkhead traced with more corners):
        // take it as it is.
        t.history = [[...raw]];
        t.shown = [...raw];
        t.still = 0;
        t.away = 0;
        t.locked = false;
        return;
      }
      t.history.push([...raw]);
      if (t.history.length > o.history) t.history.shift();
      // Recent readings while it is settling; the longer run once it has.
      const span = t.locked ? t.history : t.history.slice(-o.window);
      const target = raw.map((_, k) => median(span.map((h) => h[k])));
      // How far each number may stray before it has moved: the deadband, or
      // more for a number whose readings wobble more (σ from the median
      // absolute deviation).
      const band = target.map((m, k) =>
        Math.max(o.deadbandMm, o.spread * 1.4826 * median(span.map((h) => Math.abs(h[k] - m)))));
      let off = false;
      for (let k = 0; k < target.length; k++) if (Math.abs(target[k] - t.shown[k]) > band[k]) off = true;
      /** Take the numbers that have moved; leave the ones still inside half their band. */
      const follow = (to: number[]) =>
        t.shown.map((v, k) => (Math.abs(to[k] - v) > band[k] / 2 ? to[k] : v));
      if (!t.visible) {
        t.shown = target;
        if (t.hits >= o.showAfter) t.visible = true;
      } else if (!t.locked) {
        if (off) {
          t.shown = follow(target);
          t.still = 0;
          // What it moved away from is not evidence for where it is now.
          t.history = t.history.slice(-o.window);
        } else {
          t.still++;
          // Held still, and long enough to know where its middle is.
          if (t.still >= o.lockAfter && t.history.length >= o.history) {
            t.locked = true;
            // Lock onto the middle of everything since it last moved, not
            // onto whichever reading it happened to be drawn at.
            t.shown = raw.map((_, k) => median(t.history.map((h) => h[k])));
          }
        }
      } else if (off) {
        t.away++;
        if (t.away >= o.settle) {
          t.shown = follow(raw.map((_, k) => median(t.history.slice(-o.window).map((h) => h[k]))));
          t.away = 0;
          t.history = t.history.slice(-o.window);
        }
      } else {
        t.away = 0;
      }
    });

    items.forEach((it, j) => {
      if (used[j]) return;
      this.tracks.push({
        id: this.nextId++,
        kind: it.kind,
        key: it.key,
        shown: [...it.values],
        history: [[...it.values]],
        hits: 1,
        misses: 0,
        visible: o.showAfter <= 1,
        locked: false,
        still: 0,
        away: 0,
      });
    });

    this.tracks = this.tracks.filter((t) => t.misses === 0 || t.misses <= (t.visible ? o.keepFor : 1));
    return this.tracks
      .filter((t) => t.visible)
      .map((t) => ({
        id: t.id,
        kind: t.kind,
        ...(t.key !== undefined ? { key: t.key } : {}),
        values: [...t.shown],
        locked: t.locked,
        seen: t.misses === 0,
      }));
  }
}
