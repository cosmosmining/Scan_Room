/**
 * The ceiling, from the depth readings banked on the scan.
 *
 * RoomPlan gives one height for the whole room, read off its walls. A real
 * ceiling is not one height: a bulkhead runs along the windows, a soffit boxes
 * in a beam, the ceiling over a corridor is dropped, and its edges do not have
 * to follow the walls — they run at an angle, or step round a column. And an
 * open ceiling — expanded metal mesh, a grid with no tiles — is not even one
 * surface to the sensor: its dots pass through the holes to the slab above,
 * and where they disagree ARKit's smoothed depth lands in between.
 *
 * So the readings that landed overhead are binned on a floor-plan grid, and
 * each cell takes the LOWEST surface seen there: the lowest height that a fair
 * share of its readings agree on. Through a mesh that is the mesh, not the
 * slab and not the blend; under a bulkhead it is the bulkhead. The height most
 * of the room agrees on is the ceiling. Where the slab also shows clearly
 * above it, the ceiling is see-through. The rest — lower (bulkheads, soffits)
 * or higher (recesses, a void) — is traced, simplified and snapped to the walls
 * it meets: its outline, whatever its shape.
 *
 * `apps/ios/MozuScanner/Scan/CeilingFinder.swift` is its twin; keep them in step
 * (the Swift ⇄ TypeScript parity test holds them to the same answers).
 */

import type { DepthRay } from './glassFinder';

type Vec2 = { x: number; z: number };

/** An area of the ceiling at another height: its outline on the plan, and its underside. */
export interface CeilingZone {
  /** Counter-clockwise in (x, z), millimetres. */
  polygon: Vec2[];
  /** Height of the ceiling over this area, mm off the floor. */
  height: number;
}

export interface CeilingAnalysis {
  /** The ceiling over most of the room, mm off the floor. */
  height: number;
  /** For a see-through ceiling (mesh, open grid): the height of the slab seen through it. */
  seeThroughTo: number | null;
  /** Bulkheads and soffits (lower), recesses (higher). */
  zones: CeilingZone[];
}

export interface CeilingOptions {
  /** Grid resolution on the plan. */
  cellMm?: number;
  /** Readings this close to a wall landed on the wall, not the ceiling. */
  wallClearMm?: number;
  /** Overhead means at least this high… */
  minHeightMm?: number;
  /** …and at least this far above the iPad. */
  minRiseMm?: number;
  /** A cell with fewer readings borrows its neighbours'. */
  minHits?: number;
  /** A surface is readings within this of each other… */
  surfaceMm?: number;
  /** …that are at least this share of the cell's readings. */
  surfaceShare?: number;
  /** A neighbourhood's surface needs this share of its readings. */
  pooledShare?: number;
  /** The ceiling is the lowest surface present in this share of neighbourhoods. */
  ceilingPresence?: number;
  /** Higher than the ceiling only where under this share of the neighbourhood is at it. */
  upMaxShare?: number;
  /** Left out round anything standing in the room. */
  excludeMarginMm?: number;
  /** Passes filling cells nothing was seen in from their neighbours. */
  fillPasses?: number;
  /** A zone's own cells mostly at one height: this share within surfaceMm of it. */
  flatShare?: number;
  /** The slab through a see-through ceiling sits at least this far above it. */
  plenumGapMm?: number;
  /** …in at least this share of the ceiling's cells. */
  seeThroughShare?: number;
  /** An area this much lower or higher than the ceiling is a zone. */
  stepMm?: number;
  /** Smallest zone reported. */
  minZoneAreaMm2?: number;
  minZoneSideMm?: number;
  /** Outline simplification tolerance. */
  simplifyMm?: number;
  /** A zone's edge this close to a wall is on it. */
  snapMm?: number;
  /**
   * After tracing, a corner whose triangle with its neighbours is smaller than
   * this is grid noise and is dropped (smallest first), mm². Never more than a
   * tenth of the bulkhead's own area, so a small one keeps its corners.
   */
  cornerAreaMm2?: number;
  /** Fewer cells than this seen overhead says nothing about the ceiling. */
  minCells?: number;
}

export const CEILING_DEFAULTS: Required<CeilingOptions> = {
  cellMm: 100,
  wallClearMm: 80,
  minHeightMm: 1950,
  minRiseMm: 300,
  minHits: 4,
  surfaceMm: 60,
  surfaceShare: 0.15,
  pooledShare: 0.04,
  ceilingPresence: 0.5,
  upMaxShare: 0.03,
  excludeMarginMm: 150,
  fillPasses: 4,
  flatShare: 0.6,
  plenumGapMm: 150,
  seeThroughShare: 0.3,
  stepMm: 100,
  minZoneAreaMm2: 200_000,
  minZoneSideMm: 200,
  simplifyMm: 70,
  snapMm: 150,
  cornerAreaMm2: 150_000,
  minCells: 30,
};

function insidePolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** The nearest point on segment a–b to p, and how far it is. */
function nearestOnSegment(p: Vec2, a: Vec2, b: Vec2): { q: Vec2; d: number } {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  let t = len2 > 0 ? ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const q = { x: a.x + abx * t, z: a.z + abz * t };
  const dx = p.x - q.x;
  const dz = p.z - q.z;
  return { q, d: Math.sqrt(dx * dx + dz * dz) };
}

/** The room corner nearest p, and how far it is. */
function nearestCorner(p: Vec2, poly: Vec2[]): { q: Vec2; d: number } {
  let best = { q: p, d: Infinity };
  for (const c of poly) {
    const d = Math.sqrt((p.x - c.x) * (p.x - c.x) + (p.z - c.z) * (p.z - c.z));
    if (d < best.d) best = { q: c, d };
  }
  return best;
}

function nearestWall(p: Vec2, poly: Vec2[]): { q: Vec2; d: number } {
  let best = { q: p, d: Infinity };
  for (let i = 0; i < poly.length; i++) {
    const hit = nearestOnSegment(p, poly[i], poly[(i + 1) % poly.length]);
    if (hit.d < best.d) best = hit;
  }
  return best;
}

const median = (sorted: number[]): number => {
  const n = sorted.length;
  return n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
};

/**
 * The lowest surface in a sorted run of heights: the lowest window of
 * `surfaceMm` holding `need` readings, as the median of what it holds.
 */
function lowestSurface(hs: number[], from: number, need: number, surfaceMm: number): number | null {
  let j = from;
  for (let i = from; i < hs.length; i++) {
    while (hs[i] - hs[j] > surfaceMm) j++;
    if (i - j + 1 >= need) {
      const lo = hs[j];
      const run: number[] = [];
      for (let k = j; k < hs.length && hs[k] - lo <= surfaceMm; k++) run.push(hs[k]);
      return median(run);
    }
  }
  return null;
}

function signedArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

/** Douglas–Peucker on an open chain, keeping both ends. */
function simplifyChain(pts: Vec2[], tol: number): Vec2[] {
  if (pts.length <= 2) return pts.slice();
  const a = pts[0];
  const b = pts[pts.length - 1];
  let worst = -1;
  let worstD = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = nearestOnSegment(pts[i], a, b).d;
    if (d > worstD) {
      worstD = d;
      worst = i;
    }
  }
  if (worstD <= tol) return [a, b];
  const left = simplifyChain(pts.slice(0, worst + 1), tol);
  const right = simplifyChain(pts.slice(worst), tol);
  return left.slice(0, -1).concat(right);
}

/** Douglas–Peucker on a closed outline: split at the vertex farthest from the first. */
function simplifyLoop(loop: Vec2[], tol: number): Vec2[] {
  if (loop.length <= 3) return loop.slice();
  let far = 0;
  let farD = -1;
  for (let i = 1; i < loop.length; i++) {
    const dx = loop[i].x - loop[0].x;
    const dz = loop[i].z - loop[0].z;
    const d = dx * dx + dz * dz;
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const one = simplifyChain(loop.slice(0, far + 1), tol);
  const two = simplifyChain(loop.slice(far).concat([loop[0]]), tol);
  return one.slice(0, -1).concat(two.slice(0, -1));
}

/**
 * Drop the corners that are only grid noise: repeatedly the one whose
 * triangle with its two neighbours is smallest, while that is under `minArea`.
 * A staircase along an angled edge, or a zig-zag where the readings were thin,
 * goes; the real corners, whose triangles span the bulkhead, stay.
 */
function pruneByArea(loop: Vec2[], minArea: number, polygon: Vec2[]): Vec2[] {
  const pts = loop.slice();
  // Where it meets a wall is where the wall's top steps: those corners stay,
  // unless they are only a point along the wall between two others on it.
  const onWall = (p: Vec2) => nearestWall(p, polygon).d <= 1;
  while (pts.length > 3) {
    const n = pts.length;
    let k = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const a = pts[(i - 1 + n) % n];
      const b = pts[i];
      const c = pts[(i + 1) % n];
      const area = Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
      if (area >= 1000 && onWall(b)) continue;
      if (area < best) {
        best = area;
        k = i;
      }
    }
    if (k < 0 || best >= minArea) break;
    pts.splice(k, 1);
  }
  return pts;
}

/**
 * The outer outline of a set of grid cells, as grid corners, counter-clockwise.
 * Each cell side with no member beyond it is an edge; edges are chained into
 * loops, turning left first where two leave the same corner.
 */
function traceOutline(member: (c: number, r: number) => boolean, cells: number[], cols: number): [number, number][] {
  // Corner key → outgoing edge ends.
  const out = new Map<number, [number, number][]>();
  const key = (x: number, y: number) => y * (cols + 1) + x;
  const addEdge = (x0: number, y0: number, x1: number, y1: number) => {
    const k = key(x0, y0);
    const list = out.get(k);
    if (list) list.push([x1, y1]);
    else out.set(k, [[x1, y1]]);
  };
  for (const i of cells) {
    const c = i % cols;
    const r = (i - c) / cols;
    if (!member(c, r - 1)) addEdge(c, r, c + 1, r);
    if (!member(c + 1, r)) addEdge(c + 1, r, c + 1, r + 1);
    if (!member(c, r + 1)) addEdge(c + 1, r + 1, c, r + 1);
    if (!member(c - 1, r)) addEdge(c, r + 1, c, r);
  }
  let best: [number, number][] = [];
  let bestArea = 0;
  const starts = [...out.keys()].sort((p, q) => p - q);
  for (const s of starts) {
    while ((out.get(s)?.length ?? 0) > 0) {
      const loop: [number, number][] = [];
      let x = s % (cols + 1);
      let y = (s - x) / (cols + 1);
      let px = x;
      let py = y - 1; // arbitrary "came from" below
      for (;;) {
        const list = out.get(key(x, y));
        if (!list || list.length === 0) break;
        // Turn left first, then straight, then right.
        const inx = x - px;
        const iny = y - py;
        let pick = 0;
        let pickRank = 9;
        for (let k = 0; k < list.length; k++) {
          const ox = list[k][0] - x;
          const oy = list[k][1] - y;
          const cross = inx * oy - iny * ox;
          const dotp = inx * ox + iny * oy;
          const rank = cross > 0 ? 0 : dotp > 0 ? 1 : cross < 0 ? 2 : 3;
          if (rank < pickRank) {
            pickRank = rank;
            pick = k;
          }
        }
        const [nx, ny] = list.splice(pick, 1)[0];
        loop.push([x, y]);
        px = x;
        py = y;
        x = nx;
        y = ny;
        if (key(x, y) === s) break;
      }
      let area = 0;
      for (let k = 0; k < loop.length; k++) {
        const [ax, ay] = loop[k];
        const [bx, by] = loop[(k + 1) % loop.length];
        area += ax * by - bx * ay;
      }
      if (area > bestArea) {
        bestArea = area;
        best = loop;
      }
    }
  }
  return best;
}

/**
 * The walls' common direction, folded into a quarter turn: each wall votes
 * with its length for its angle modulo 90°.
 */
function wallAngle(polygon: Vec2[]): number {
  let c = 0;
  let s = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    const angle = Math.atan2(dz, dx);
    c += len * Math.cos(4 * angle);
    s += len * Math.sin(4 * angle);
  }
  return Math.sqrt(c * c + s * s) < 1e-9 ? 0 : Math.atan2(s, c) / 4;
}

const turn = (p: Vec2, cos: number, sin: number): Vec2 => ({
  x: p.x * cos - p.z * sin,
  z: p.x * sin + p.z * cos,
});

/** Something standing in the room whose sides are not ceiling: a column, a wardrobe. */
export interface CeilingExclude {
  center: Vec2;
  width: number;
  depth: number;
  /** Plan-sense yaw: the width axis runs along (cos, sin). */
  rotation: number;
}

export function findCeiling(
  rays: DepthRay[],
  polygon: Vec2[],
  exclude: CeilingExclude[] = [],
  options: CeilingOptions = {},
): CeilingAnalysis | null {
  if (polygon.length < 3 || rays.length === 0) return null;
  // The grid runs along the walls: a scan arrives turned to wherever the iPad
  // faced, and a bulkhead's straight edge would otherwise be a staircase.
  const angle = wallAngle(polygon);
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const square = polygon.map((p) => turn(p, cos, sin));
  const squareRays = rays.map((r) => {
    const e = turn({ x: r.eye.x, z: r.eye.z }, cos, sin);
    const h = turn({ x: r.hit.x, z: r.hit.z }, cos, sin);
    return { ...r, eye: { x: e.x, y: r.eye.y, z: e.z }, hit: { x: h.x, y: r.hit.y, z: h.z } };
  });
  const squareExclude = exclude.map((e) => ({ ...e, center: turn(e.center, cos, sin), rotation: e.rotation - angle }));
  const found = findSquare(squareRays, square, squareExclude, { ...CEILING_DEFAULTS, ...options });
  if (!found) return null;
  const back = (p: Vec2) => turn(p, Math.cos(angle), Math.sin(angle));
  return { ...found, zones: found.zones.map((z) => ({ ...z, polygon: z.polygon.map(back) })) };
}

function findSquare(
  rays: DepthRay[],
  polygon: Vec2[],
  exclude: CeilingExclude[],
  o: Required<CeilingOptions>,
): CeilingAnalysis | null {

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of polygon) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const cols = Math.max(1, Math.ceil((maxX - minX) / o.cellMm));
  const rows = Math.max(1, Math.ceil((maxZ - minZ) / o.cellMm));
  const cells = cols * rows;
  const centre = (i: number): Vec2 => {
    const c = i % cols;
    const r = (i - c) / cols;
    return { x: minX + (c + 0.5) * o.cellMm, z: minZ + (r + 0.5) * o.cellMm };
  };
  const inRoom = new Uint8Array(cells);
  for (let i = 0; i < cells; i++) inRoom[i] = insidePolygon(centre(i), polygon) ? 1 : 0;
  // The sides of a column or a tall cupboard are hit high up too; they are
  // not the ceiling, so the cells over them and just round them are left out.
  const excluded = (p: Vec2): boolean => exclude.some((e) => {
    const dx = p.x - e.center.x;
    const dz = p.z - e.center.z;
    const along = dx * Math.cos(e.rotation) + dz * Math.sin(e.rotation);
    const across = -dx * Math.sin(e.rotation) + dz * Math.cos(e.rotation);
    return Math.abs(along) <= e.width / 2 + o.excludeMarginMm && Math.abs(across) <= e.depth / 2 + o.excludeMarginMm;
  });
  for (let i = 0; i < cells; i++) if (inRoom[i] && excluded(centre(i))) inRoom[i] = 0;

  // What landed overhead, by cell.
  const heights: number[][] = Array.from({ length: cells }, () => []);
  for (const ray of rays) {
    if ((ray.confidence ?? 2) < 1) continue;
    const { eye, hit } = ray;
    if (hit.y < o.minHeightMm || hit.y - eye.y < o.minRiseMm) continue;
    const p = { x: hit.x, z: hit.z };
    if (!insidePolygon(p, polygon) || nearestWall(p, polygon).d < o.wallClearMm) continue;
    const c = Math.min(cols - 1, Math.max(0, Math.floor((hit.x - minX) / o.cellMm)));
    const r = Math.min(rows - 1, Math.max(0, Math.floor((hit.z - minZ) / o.cellMm)));
    heights[r * cols + c].push(hit.y);
  }
  for (const h of heights) h.sort((a, b) => a - b);

  // Each cell's neighbourhood, pooled: enough readings to find the surfaces
  // in, even through a mesh that catches only one dot in ten.
  const pooled: number[][] = Array.from({ length: cells }, () => []);
  for (let i = 0; i < cells; i++) {
    if (!inRoom[i]) continue;
    const c = i % cols;
    const r = (i - c) / cols;
    const into = pooled[i];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
        for (const y of heights[rr * cols + cc]) into.push(y);
      }
    }
    into.sort((x, y) => x - y);
  }
  const pooledNeed = (n: number) => Math.max(3, Math.ceil(o.pooledShare * n));

  // The ceiling: the lowest surface present over most of the room. Candidates
  // are the surfaces the neighbourhoods show — through a mesh, the mesh where
  // it caught enough dots and the slab where it did not — and each is tried
  // for how widely it is present, so the slab cannot outvote a sparse mesh, and
  // a bulkhead, present only over itself, cannot pass for the ceiling.
  const found: number[] = [];
  let neighbourhoods = 0;
  for (let i = 0; i < cells; i++) {
    const hs = pooled[i];
    if (!inRoom[i] || hs.length < o.minHits) continue;
    neighbourhoods++;
    const low = lowestSurface(hs, 0, pooledNeed(hs.length), o.surfaceMm);
    if (low === null) continue;
    found.push(low);
    let k = 0;
    while (k < hs.length && hs[k] < low + o.plenumGapMm) k++;
    const high = lowestSurface(hs, k, pooledNeed(hs.length), o.surfaceMm);
    if (high !== null) found.push(high);
  }
  if (neighbourhoods < o.minCells || found.length === 0) return null;
  found.sort((x, y) => x - y);
  const candidates: number[] = [];
  for (let i = 0; i < found.length; ) {
    let j = i;
    while (j + 1 < found.length && found[j + 1] - found[j] <= o.stepMm / 2) j++;
    if (j - i + 1 >= o.minCells / 3) candidates.push(median(found.slice(i, j + 1)));
    i = j + 1;
  }
  const presence = (level: number) => {
    let n = 0;
    for (let i = 0; i < cells; i++) {
      const hs = pooled[i];
      if (!inRoom[i] || hs.length < o.minHits) continue;
      let near = 0;
      for (const y of hs) if (Math.abs(y - level) <= o.surfaceMm) near++;
      if (near >= 2) n++;
    }
    return n / neighbourhoods;
  };
  let height = NaN;
  let widest = -1;
  let widestLevel = NaN;
  for (const c of candidates) {
    const share = presence(c);
    if (share >= o.ceilingPresence) {
      height = c;
      break;
    }
    if (share > widest) {
      widest = share;
      widestLevel = c;
    }
  }
  if (Number.isNaN(height)) height = widestLevel;
  if (Number.isNaN(height)) return null;
  const atCeiling = (hs: number[]) => {
    let n = 0;
    for (const y of hs) if (Math.abs(y - height) <= o.surfaceMm) n++;
    return n;
  };

  // Each cell: level with the ceiling if any of its own readings are; lower
  // where its own readings show a lower surface and none at the ceiling (a
  // bulkhead hides the ceiling above it); higher only where nothing around it
  // is at the ceiling either — through a mesh, most cells miss it by chance.
  const UNKNOWN = 9;
  const cls = new Int8Array(cells).fill(UNKNOWN);
  const level = new Float64Array(cells).fill(NaN);
  const upward = new Uint8Array(cells);
  // Overhead near a wall is seen only steeply, so a cell there may hold two or
  // three readings: enough to say which, not enough for "higher".
  for (let i = 0; i < cells; i++) {
    if (!inRoom[i]) continue;
    const own = heights[i];
    if (own.length === 0) continue;
    // Lower: two readings agreeing on a surface below the ceiling. Whatever
    // shows above it does not count against that — through a mesh the slab
    // over a bulkhead shows too, and nothing beyond the ceiling lands below it.
    const under = lowestSurface(own, 0, 2, o.surfaceMm);
    if (under !== null && under < height - o.stepMm) {
      cls[i] = -1;
      level[i] = under;
      continue;
    }
    if (atCeiling(own) > 0) {
      cls[i] = 0;
      level[i] = height;
      continue;
    }
    const low = lowestSurface(own, 0, Math.max(2, Math.ceil(o.surfaceShare * own.length)), o.surfaceMm);
    if (low !== null && low > height + o.stepMm) {
      // Higher, by its own readings — but through a mesh a cell can miss the
      // mesh by chance. Only a core, where nothing around is at the ceiling
      // either, starts a recess; the rest may join one that touches them.
      level[i] = low;
      if (own.length >= o.minHits && atCeiling(pooled[i]) < o.upMaxShare * pooled[i].length) cls[i] = 1;
      else upward[i] = 1;
    } else if (own.length < o.minHits) {
      continue;
    } else {
      cls[i] = 0;
      level[i] = height;
    }
  }

  // A cell nothing was seen in goes with most of its neighbours; then one
  // pass of majority smoothing, so a stray cell does not notch an edge.
  const neighbourVotes = (from: Int8Array, i: number) => {
    const c = i % cols;
    const r = (i - c) / cols;
    // Lower, level, higher — and how many neighbours are in the room at all.
    const votes = [0, 0, 0, 0];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if ((dr === 0 && dc === 0) || rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
        const v = from[rr * cols + cc];
        if (!inRoom[rr * cols + cc]) continue;
        votes[3]++;
        if (v !== UNKNOWN) votes[v + 1]++;
      }
    }
    return votes;
  };
  let filled = Int8Array.from(cls);
  for (let pass = 0; pass < o.fillPasses; pass++) {
    const next = Int8Array.from(filled);
    let changed = false;
    for (let i = 0; i < cells; i++) {
      if (!inRoom[i] || filled[i] !== UNKNOWN) continue;
      // With most of what round it was seen; a tie goes to the ceiling.
      const votes = neighbourVotes(filled, i);
      const top = Math.max(votes[0], votes[1], votes[2]);
      if (top === 0) continue;
      next[i] = votes[1] === top ? 0 : votes[0] === top ? -1 : 1;
      changed = true;
    }
    filled = next;
    if (!changed) break;
  }
  for (let i = 0; i < cells; i++) if (filled[i] === UNKNOWN) filled[i] = 0;
  const smooth = Int8Array.from(filled);
  for (let i = 0; i < cells; i++) {
    if (!inRoom[i]) continue;
    const votes = neighbourVotes(filled, i);
    for (let v = 0; v < 3; v++) {
      if (v - 1 !== filled[i] && votes[v] >= 5) smooth[i] = v - 1;
    }
  }

  // Close one-cell gaps in each kind, so one bulkhead is one outline.
  for (const kind of [-1, 1]) {
    const has = (i: number) => smooth[i] === kind;
    const grown = new Uint8Array(cells);
    for (let i = 0; i < cells; i++) {
      if (!inRoom[i]) continue;
      const c = i % cols;
      const r = (i - c) / cols;
      grown[i] = has(i) ||
        (c > 0 && has(i - 1)) || (c < cols - 1 && has(i + 1)) ||
        (r > 0 && has(i - cols)) || (r < rows - 1 && has(i + cols)) ? 1 : 0;
    }
    for (let i = 0; i < cells; i++) {
      if (!inRoom[i] || smooth[i] !== 0 || !grown[i]) continue;
      const c = i % cols;
      const r = (i - c) / cols;
      // Stays only if every neighbour in the room grew too (walls do not erode it).
      const keep = (j: number, ok: boolean) => !ok || !inRoom[j] || grown[j] === 1;
      if (keep(i - 1, c > 0) && keep(i + 1, c < cols - 1) && keep(i - cols, r > 0) && keep(i + cols, r < rows - 1)) {
        smooth[i] = kind;
      }
    }
  }

  // See-through: the slab shows above most of the ceiling.
  const slabs: number[] = [];
  let level0 = 0;
  for (let i = 0; i < cells; i++) {
    const hs = heights[i];
    if (cls[i] !== 0 || hs.length < o.minHits) continue;
    level0++;
    let k = 0;
    while (k < hs.length && hs[k] < height + o.plenumGapMm) k++;
    const high = lowestSurface(hs, k, Math.max(2, Math.ceil(o.surfaceShare * hs.length)), o.surfaceMm);
    if (high !== null) slabs.push(high);
  }
  slabs.sort((x, y) => x - y);
  const seeThroughTo = level0 > 0 && slabs.length >= o.seeThroughShare * level0 ? median(slabs) : null;

  // Zones: connected areas lower or higher than the ceiling.
  const zones: CeilingZone[] = [];
  const seen = new Uint8Array(cells);
  for (let start = 0; start < cells; start++) {
    const kind = smooth[start];
    if (!inRoom[start] || seen[start] || (kind !== -1 && kind !== 1)) continue;
    const members: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      members.push(i);
      const c = i % cols;
      const r = (i - c) / cols;
      const next = [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]];
      for (const [cc, rr] of next) {
        if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
        const j = rr * cols + cc;
        if (!seen[j] && inRoom[j] && (smooth[j] === kind || (kind === 1 && upward[j] && smooth[j] !== -1))) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (members.length * o.cellMm * o.cellMm < o.minZoneAreaMm2) continue;
    let c0 = cols, c1 = -1, r0 = rows, r1 = -1;
    for (const i of members) {
      const c = i % cols;
      const r = (i - c) / cols;
      c0 = Math.min(c0, c); c1 = Math.max(c1, c);
      r0 = Math.min(r0, r); r1 = Math.max(r1, r);
    }
    if (Math.min(c1 - c0 + 1, r1 - r0 + 1) * o.cellMm < o.minZoneSideMm) continue;
    // Seen, not just filled in; and one flat underside, which a lamp's sides
    // or the side of a column standing there are not.
    const levels = members
      .filter((i) => cls[i] === kind || (kind === 1 && upward[i]))
      .map((i) => level[i])
      .sort((a, b) => a - b);
    if (levels.length * o.cellMm * o.cellMm < o.minZoneAreaMm2 / 2) continue;

    const zoneHeight = median(levels);
    let flat = 0;
    for (const v of levels) if (Math.abs(v - zoneHeight) <= o.surfaceMm) flat++;
    if (flat < o.flatShare * levels.length) continue;

    members.sort((a, b) => a - b);
    const set = new Set(members);
    const member = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && set.has(r * cols + c);
    const corners = traceOutline(member, members, cols);
    let outline: Vec2[] = corners.map(([cx, cy]) => ({ x: minX + cx * o.cellMm, z: minZ + cy * o.cellMm }));
    outline = simplifyLoop(outline, o.simplifyMm);
    // Onto the walls it meets — into the corner when it is that close to one,
    // so a bulkhead round a corner does not stop short of it along one wall.
    outline = outline.map((p) => {
      const c = nearestCorner(p, polygon);
      if (c.d <= o.snapMm) return c.q;
      const w = nearestWall(p, polygon);
      return w.d <= o.snapMm || !insidePolygon(p, polygon) ? w.q : p;
    });
    const clean: Vec2[] = [];
    for (const p of outline) {
      const last = clean[clean.length - 1];
      if (!last || Math.abs(last.x - p.x) > 1 || Math.abs(last.z - p.z) > 1) clean.push(p);
    }
    if (clean.length > 1) {
      const a = clean[0], b = clean[clean.length - 1];
      if (Math.abs(a.x - b.x) <= 1 && Math.abs(a.z - b.z) <= 1) clean.pop();
    }
    if (clean.length < 3 || Math.abs(signedArea(clean)) < o.minZoneAreaMm2 / 2) continue;
    const pruned = o.cornerAreaMm2 > 0
      ? pruneByArea(clean, Math.min(o.cornerAreaMm2, Math.abs(signedArea(clean)) / 10), polygon)
      : clean;
    if (Math.abs(signedArea(pruned)) < o.minZoneAreaMm2 / 2) continue;
    if (signedArea(pruned) < 0) pruned.reverse();
    zones.push({ polygon: pruned, height: zoneHeight });
  }

  return { height, seeThroughTo, zones };
}
