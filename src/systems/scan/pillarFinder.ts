/**
 * Find the columns standing in a room from the depth readings themselves —
 * for when RoomPlan reports them badly or not at all.
 *
 * WHY THIS EXISTS. RoomPlan has no category for a column. A round pillar in
 * the middle of an open-plan flat comes back as a curved wall (iOS 17), as one
 * or two flat "walls" for the faces it happened to see, or as nothing. The
 * wall analysis (wallLoop.ts) makes the most of the first two; this covers
 * the rest, from evidence that does not depend on RoomPlan recognising
 * anything.
 *
 * THE ONE PHYSICAL FACT USED. A column runs from the floor to the ceiling.
 * Nothing else standing clear of the walls does: a sofa stops below a metre, a
 * table at 750mm, a fridge or a bookcase short of the ceiling, and a pendant
 * lamp starts well below it and never reaches the floor. So the readings that
 * land in the room — clear of the walls, off the floor and below the ceiling —
 * are binned into a floor-plan grid, each cell remembering which heights it was
 * seen at. A patch of cells seen over most of the height, right up to just
 * under the ceiling, is a column. Its readings lie on the faces that were seen,
 * so a circle fit through them gives a round column's centre and diameter even
 * from one side; otherwise the tightest box round them is a square column.
 *
 * WHAT IT CANNOT TELL APART. A freestanding floor-to-ceiling cupboard or room
 * divider is, to a depth sensor, a box column. Columns found here are reported
 * like any other and can be removed with one tap.
 *
 * Millimetres, y = height above the floor. Pure — the Swift twin is
 * `apps/ios/MozuScanner/Scan/PillarFinder.swift`.
 */

import type { DepthRay } from './glassFinder';
import type { LoopPoint, Pillar } from './wallLoop';

export interface PillarOptions {
  /** Floor-plan grid resolution. */
  cellMm?: number;
  /** Readings closer than this to a wall are the wall. */
  wallClearMm?: number;
  /** Readings within this of the floor or the ceiling are the floor or the ceiling. */
  surfaceBandMm?: number;
  /** The height in between is split into this many bands… */
  bands?: number;
  /** …and a column is seen in at least this many of them… */
  minBands?: number;
  /**
   * …up to the top one, or at least to this height. Nothing standing clear of
   * the walls in a home reaches 3 m except a column, and in a tall room the
   * sensor may never reach the ceiling — in sunlight it stops near 4 m.
   */
  columnMm?: number;
  /** A cell needs this many readings to count at all. */
  minCellHits?: number;
  /** A column needs this many readings in all. */
  minHits?: number;
  /** Column size limits, across. */
  minSpanMm?: number;
  maxSpanMm?: number;
  /** A column is compact: its long side is at most this many times its short one. */
  maxAspect?: number;
  /**
   * A column found here stands at least this clear of every wall — more than
   * `wallClearMm`, because readings in that band are never looked at, so
   * something that seems to stop at its edge may run on to the wall (a tall
   * cupboard does).
   */
  footprintClearMm?: number;
  /** A round column may reach this far into the wall line (a fitting error, a recess). */
  wallTouchMm?: number;
}

export const PILLAR_DEFAULTS: Required<PillarOptions> = {
  cellMm: 100,
  wallClearMm: 250,
  surfaceBandMm: 150,
  bands: 8,
  minBands: 6,
  columnMm: 3000,
  minCellHits: 2,
  minHits: 40,
  minSpanMm: 120,
  maxSpanMm: 1300,
  maxAspect: 2.5,
  footprintClearMm: 300,
  wallTouchMm: 100,
};

/** Something already known to stand there — a RoomPlan object, as a footprint. */
export interface Footprint {
  center: LoopPoint;
  width: number;
  depth: number;
  /** Yaw of the width axis, plan convention: (cos r, sin r). */
  rotation: number;
}

interface Cell {
  key: number;
  ix: number;
  iz: number;
  bands: number;
  pts: number[];
}

// Square roots, not Math.hypot, throughout: the Swift twin must get the same bits.
const len2 = (x: number, z: number): number => Math.sqrt(x * x + z * z);

const distToSegment = (p: LoopPoint, a: LoopPoint, b: LoopPoint): number => {
  const abx = b.x - a.x, abz = b.z - a.z;
  const l2 = abx * abx + abz * abz;
  if (l2 < 1e-9) return len2(p.x - a.x, p.z - a.z);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / l2));
  return len2(p.x - a.x - abx * t, p.z - a.z - abz * t);
};

/** Even-odd point-in-polygon. */
function inside(p: LoopPoint, poly: LoopPoint[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < a.x + ((p.z - a.z) / (b.z - a.z)) * (b.x - a.x)) hit = !hit;
  }
  return hit;
}

const edgeClearance = (p: LoopPoint, poly: LoopPoint[]): number => {
  let d = Infinity;
  for (let k = 0; k < poly.length; k++) d = Math.min(d, distToSegment(p, poly[k], poly[(k + 1) % poly.length]));
  return d;
};

const bitCount = (m: number): number => {
  let c = 0;
  for (let v = m; v; v &= v - 1) c++;
  return c;
};

/** Least-squares circle (Kåsa), points centred first. */
function fitCircle(xs: number[], zs: number[]): { cx: number; cz: number; r: number; rms: number } | null {
  const n = xs.length;
  if (n < 3) return null;
  let mx = 0, mz = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; mz += zs[i]; }
  mx /= n; mz /= n;
  let sxx = 0, sxz = 0, szz = 0, sx = 0, sz = 0, bx = 0, bz = 0, b1 = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i] - mx, z = zs[i] - mz, r2 = x * x + z * z;
    sxx += x * x; sxz += x * z; szz += z * z; sx += x; sz += z;
    bx -= r2 * x; bz -= r2 * z; b1 -= r2;
  }
  const det3 = (a: number[][]) =>
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const m = [[sxx, sxz, sx], [sxz, szz, sz], [sx, sz, n]];
  const rhs = [bx, bz, b1];
  const det = det3(m);
  if (Math.abs(det) < 1e-9) return null;
  const solved = (c: number) => det3(m.map((row, i) => row.map((v, j) => (j === c ? rhs[i] : v)))) / det;
  const cx = -solved(0) / 2, cz = -solved(1) / 2;
  const r2 = cx * cx + cz * cz - solved(2);
  if (!(r2 > 0)) return null;
  const r = Math.sqrt(r2);
  let e2 = 0;
  for (let i = 0; i < n; i++) {
    const e = len2(xs[i] - mx - cx, zs[i] - mz - cz) - r;
    e2 += e * e;
  }
  return { cx: cx + mx, cz: cz + mz, r, rms: Math.sqrt(e2 / n) };
}

/** Is `p` inside footprint `f`, grown by `grow` on every side? */
function withinFootprint(p: LoopPoint, f: Footprint, grow: number): boolean {
  const c = Math.cos(f.rotation), s = Math.sin(f.rotation);
  const dx = p.x - f.center.x, dz = p.z - f.center.z;
  return Math.abs(dx * c + dz * s) <= f.width / 2 + grow && Math.abs(-dx * s + dz * c) <= f.depth / 2 + grow;
}

export function findPillars(
  rays: DepthRay[],
  polygon: LoopPoint[],
  ceilingMm: number,
  exclude: Footprint[] = [],
  options: PillarOptions = {},
): Pillar[] {
  const o = { ...PILLAR_DEFAULTS, ...options };
  const lo = o.surfaceBandMm;
  const hi = ceilingMm - o.surfaceBandMm;
  if (polygon.length < 3 || rays.length === 0 || !(hi - lo >= 500)) return [];
  const bandMm = (hi - lo) / o.bands;

  let minX = Infinity, minZ = Infinity, maxX = -Infinity;
  for (const p of polygon) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z);
  }
  const cols = Math.floor((maxX - minX) / o.cellMm) + 1;

  // 1 — Bin the readings that are in the room, clear of walls, floor and ceiling.
  const xs: number[] = [], zs: number[] = [], ex: number[] = [], ez: number[] = [];
  const cells = new Map<number, Cell>();
  for (const ray of rays) {
    if ((ray.confidence ?? 2) < 1) continue;
    const { hit, eye } = ray;
    if (!(hit.y > lo && hit.y < hi)) continue;
    const p = { x: hit.x, z: hit.z };
    if (!inside(p, polygon) || edgeClearance(p, polygon) < o.wallClearMm) continue;
    const ix = Math.floor((hit.x - minX) / o.cellMm);
    const iz = Math.floor((hit.z - minZ) / o.cellMm);
    const key = iz * cols + ix;
    let cell = cells.get(key);
    if (!cell) {
      cell = { key, ix, iz, bands: 0, pts: [] };
      cells.set(key, cell);
    }
    cell.bands |= 1 << Math.min(o.bands - 1, Math.floor((hit.y - lo) / bandMm));
    cell.pts.push(xs.length);
    xs.push(hit.x); zs.push(hit.z); ex.push(eye.x); ez.push(eye.z);
  }

  // The band a column must be seen in (or above): the top one, or the one
  // holding `columnMm` in a room taller than that.
  const topBand = Math.min(o.bands - 1, Math.max(0, Math.floor((o.columnMm - lo) / bandMm)));

  // 2 — Patches of well-seen cells that were seen that HIGH UP, a one-cell
  // gap allowed (the readings are sparse). Only cells seen that high link up,
  // so a person, a chair or a bookcase beside a column never joins it.
  // Visited in key order so the twins label them identically.
  const live = [...cells.values()]
    .filter((c) => c.pts.length >= o.minCellHits && c.bands >> topBand !== 0)
    .sort((a, b) => a.key - b.key);
  const byKey = new Map(live.map((c) => [c.key, c]));
  const seen = new Set<number>();
  const found: Pillar[] = [];
  for (const start of live) {
    if (seen.has(start.key)) continue;
    const patch: Cell[] = [];
    const stack = [start];
    seen.add(start.key);
    while (stack.length) {
      const c = stack.pop()!;
      patch.push(c);
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          const ix = c.ix + dx, iz = c.iz + dz;
          if (ix < 0 || ix >= cols) continue;
          const n = byKey.get(iz * cols + ix);
          if (n && !seen.has(n.key)) {
            seen.add(n.key);
            stack.push(n);
          }
        }
      }
    }

    // 3 — Floor to ceiling? Most of the height, right up under the ceiling
    // (or above `columnMm`), and at least one cell seen over most of it on its
    // own (a lamp above a table is two things, not one tall one).
    let bands = 0, best = 0;
    for (const c of patch) {
      bands |= c.bands;
      best = Math.max(best, bitCount(c.bands));
    }
    if (bitCount(bands) < o.minBands || bands >> topBand === 0 || best < o.minBands - 2) continue;
    // Fit on the patch AND the cells right next to it that were seen nearly as
    // high: the test that found the column is too strict to measure it with —
    // in a sparse scan it leaves only scraps of each face — while a person
    // standing beside it never gets that high.
    const near = new Set<number>();
    for (const c of patch) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ix = c.ix + dx;
          if (ix < 0 || ix >= cols) continue;
          const k = (c.iz + dz) * cols + ix;
          const m = cells.get(k);
          if (m && m.bands >> Math.max(0, topBand - 1) !== 0) near.add(k);
        }
      }
    }
    const idx = [...near].flatMap((k) => cells.get(k)!.pts).sort((a, b) => a - b);
    if (idx.length < o.minHits) continue;

    const px = idx.map((i) => xs[i]), pz = idx.map((i) => zs[i]);
    const pillar = fit(px, pz, idx.map((i) => ex[i]), idx.map((i) => ez[i]), o);
    if (!pillar) continue;

    // 4 — Where it stands: inside the room, clear of the walls, not already
    // known as a piece of furniture, not found twice.
    const corners = footprintCorners(pillar);
    // A round one may stand right against a wall — the concrete column at a
    // glass wall — since nothing that only looks like a column there (a tall
    // cupboard, a pantry) is round. A box must stand clear.
    const clear = pillar.shape === 'round'
      ? inside(pillar.center, polygon) && edgeClearance(pillar.center, polygon) >= pillar.width / 2 - o.wallTouchMm
      : corners.every((p) => inside(p, polygon) && edgeClearance(p, polygon) >= o.footprintClearMm);
    if (!clear) continue;
    if (exclude.some((f) => withinFootprint(pillar.center, f, 150))) continue;
    if (found.some((e) => overlaps(e, pillar))) continue;
    found.push(pillar);
  }
  return found.sort((a, b) => a.center.x - b.center.x || a.center.z - b.center.z);
}

/** Two columns closer than their half-sizes summed are the same column. */
function overlaps(a: Pillar, b: Pillar): boolean {
  const gap = len2(a.center.x - b.center.x, a.center.z - b.center.z);
  return gap < (Math.max(a.width, a.depth) + Math.max(b.width, b.depth)) / 2;
}

/**
 * Columns from both sources, each once. RoomPlan's surfaces measure a column
 * best when it saw several faces, so those stand; one it saw a single face of
 * (`partial`) gives way to what the depth readings found there; and the depth
 * readings add the columns RoomPlan did not report at all.
 */
export function mergePillars(fromWalls: Pillar[], fromDepth: Pillar[]): Pillar[] {
  const kept = fromWalls.filter((p) => !p.partial || !fromDepth.some((d) => overlaps(p, d)));
  return [...kept, ...fromDepth.filter((d) => !kept.some((p) => overlaps(p, d)))];
}

function footprintCorners(p: Pillar): LoopPoint[] {
  const c = Math.cos(p.rotation), s = Math.sin(p.rotation);
  const hw = p.width / 2, hd = p.depth / 2;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => ({
    x: p.center.x + u * hw * c - v * hd * s,
    z: p.center.z + u * hw * s + v * hd * c,
  }));
}

/**
 * Round if the readings sit on an arc seen from outside — the circle behind
 * them, and fitting them more tightly than any box does; else the tightest box
 * round them, squared up when only one face was seen and set back from it,
 * away from where it was seen from.
 */
function fit(px: number[], pz: number[], ex: number[], ez: number[], o: Required<PillarOptions>): Pillar | null {
  const n = px.length;

  // The box whose faces the readings lie on, over headings a degree apart
  // (the first on a tie). Not the smallest box: two faces seen round a corner
  // make an L, and an L's smallest box can sit at 45° to it.
  const sides = (deg: number) => {
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const us = px.map((x, i) => x * c + pz[i] * s);
    const vs = px.map((x, i) => -x * s + pz[i] * c);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let i = 0; i < n; i++) {
      u0 = Math.min(u0, us[i]); u1 = Math.max(u1, us[i]); v0 = Math.min(v0, vs[i]); v1 = Math.max(v1, vs[i]);
    }
    let e2 = 0;
    for (let i = 0; i < n; i++) {
      const e = Math.min(us[i] - u0, u1 - us[i], vs[i] - v0, v1 - vs[i]);
      e2 += e * e;
    }
    return { a, c, s, u0, u1, v0, v1, e2 };
  };
  let box = sides(0);
  for (let deg = 1; deg < 90; deg++) {
    const b = sides(deg);
    if (b.e2 < box.e2 - 1e-6) box = b;
  }
  const { a, c, s, u0, u1, v0, v1 } = box;
  // How far the readings sit from the box's faces: noise for a square column,
  // the bulge of the arc for a round one.
  const boxRms = Math.sqrt(box.e2 / n);
  let eu = 0, ev = 0;
  for (let i = 0; i < n; i++) {
    eu += ex[i] * c + ez[i] * s;
    ev += -ex[i] * s + ez[i] * c;
  }
  eu /= n; ev /= n;

  const circle = fitCircle(px, pz);
  if (
    circle && circle.r * 2 >= o.minSpanMm && circle.r * 2 <= o.maxSpanMm &&
    circle.rms <= Math.max(15, 0.1 * circle.r) && circle.rms < boxRms
  ) {
    // How much of the circle the readings cover, and whether its centre lies
    // BEHIND them as seen — readings on the outside of a column, not the
    // inside of a curved wall.
    const angles = px.map((x, i) => Math.atan2(pz[i] - circle.cz, x - circle.cx)).sort((p, q) => p - q);
    let gap = 2 * Math.PI - angles[n - 1] + angles[0];
    for (let i = 1; i < n; i++) gap = Math.max(gap, angles[i] - angles[i - 1]);
    let behind = 0;
    for (let i = 0; i < n; i++) {
      behind += (circle.cx - px[i]) * (px[i] - ex[i]) + (circle.cz - pz[i]) * (pz[i] - ez[i]) > 0 ? 1 : 0;
    }
    if (2 * Math.PI - gap >= (70 * Math.PI) / 180 && behind >= 0.8 * n) {
      const d = circle.r * 2;
      return { center: { x: circle.cx, z: circle.cz }, shape: 'round', width: d, depth: d, rotation: 0 };
    }
  }

  let w = u1 - u0, d = v1 - v0, uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
  // One face seen: a square column whose far side was never in view.
  if (d < 0.3 * w) {
    vc += (ev > vc ? -1 : 1) * (w - d) / 2;
    d = w;
  } else if (w < 0.3 * d) {
    uc += (eu > uc ? -1 : 1) * (d - w) / 2;
    w = d;
  }
  // A tall cupboard's front, or a stub of wall, is long and thin; a column is not.
  if (Math.min(w, d) < o.minSpanMm || Math.max(w, d) > o.maxSpanMm || Math.max(w, d) > o.maxAspect * Math.min(w, d)) return null;
  return {
    center: { x: uc * c - vc * s, z: uc * s + vc * c },
    shape: 'box',
    width: w,
    depth: d,
    rotation: a,
  };
}
