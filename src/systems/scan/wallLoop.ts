/**
 * Build a room outline from scanner wall segments — the step that decides what
 * the floor plan actually says the room is.
 *
 * WHY THIS EXISTS. The previous chaining had three faults, and together they
 * are why a pile of shoes moved a wall:
 *
 *   1. It discarded the NEAR endpoint of every segment it chained. Only the far
 *      end was appended, so each polygon edge was a chord fusing the gap between
 *      two walls with the wall itself. Measured on a 4×3 m room whose z = 0 wall
 *      was split by occlusion, with the second fragment fitted 150mm into the
 *      room: the chord ran diagonally from (1500, 0) to (4000, 150), tilting a
 *      wall that is straight in reality along its entire length. Shoes occupying
 *      500mm of one wall put the far corner 150mm out.
 *
 *   2. It had no maximum jump, so the nearest remaining endpoint could be across
 *      the room and the loop would happily go there and come back.
 *
 *   3. It never merged the fragments a scanner splits one wall into. Occlusion
 *      routinely breaks a hallway wall into two or three surfaces, and each is
 *      fitted separately, so a clear fragment and an occluded one end up at
 *      different offsets and the join between them is a jog.
 *
 * THE ONE ASYMMETRY THAT MATTERS. Clutter sits BETWEEN the camera and the wall.
 * It can hide a wall; it can never put a surface behind one. So when fragments
 * of the same wall disagree about where that wall is, the answer is not their
 * mean, their median or a least-squares fit — every one of those is dragged
 * inward by whichever fragment was occluded. It is the OUTERMOST of them. That
 * makes the estimate insensitive to how much clutter there is: one shoe and a
 * hundred shoes give the same wall, because neither can produce evidence
 * further out than the wall itself.
 *
 * Corners then come from intersecting the wall LINES rather than from joining
 * endpoints, so a corner hidden behind a bin still lands where the two walls
 * actually meet.
 *
 * Millimetres throughout. Pure geometry — no sensor data, no platform — so it
 * is the same code and the same behaviour as `Scan/WallLoop.swift`.
 */

export interface LoopPoint {
  x: number;
  z: number;
}

/** A wall as the scanner reported it: two endpoints on the floor plane. */
export interface LoopSegment {
  a: LoopPoint;
  b: LoopPoint;
  /** The surface's own height, mm, when the scanner reports it. */
  heightMm?: number;
  /** How far its top edge sits above the FLOOR, mm. */
  topMm?: number;
}

/**
 * A column the scan found standing in the room — round or square, freestanding
 * or engaged against a wall. It is STRUCTURE: it cannot be moved and a cabinet
 * cannot go through it, so it is reported beside the outline rather than being
 * woven into it.
 */
export interface Pillar {
  center: LoopPoint;
  shape: 'round' | 'box';
  /** Across, mm. For a round pillar, width = depth = diameter. */
  width: number;
  depth: number;
  /** Yaw of the box's width axis, radians (0 for round). */
  rotation: number;
}

export interface WallAnalysis {
  outline: LoopPoint[];
  pillars: Pillar[];
  /** Surfaces discarded as too low to be walls — shoe racks, boxes, radiators. */
  clutterRejected: number;
}

export interface WallLoopOptions {
  /** Shorter than this is not a wall — it is a fragment or a piece of clutter. */
  minSegmentMm?: number;
  /** Fragments differing by less than this in heading may be the same wall. */
  parallelDeg?: number;
  /** …and by less than this in perpendicular offset. */
  coplanarMm?: number;
  /** A chain step longer than this is a teleport across the room, not a corner. */
  maxJumpMm?: number;
  /** Below this angle two walls are parallel and are not given a corner. */
  minCornerDeg?: number;
  /** A wall runs most of the room's height; a shoe rack, a box, a radiator does not. */
  minWallHeightMm?: number;
  /** …and its top clears worktop height. */
  minWallTopMm?: number;
  /** A pillar facet is at most this long. */
  pillarMaxFacetMm?: number;
  /** A pillar fits inside a square this big. */
  pillarMaxSpanMm?: number;
  /** Facets closer than this belong to the same pillar. */
  pillarLinkMm?: number;
}

export const WALL_LOOP_DEFAULTS: Required<WallLoopOptions> = {
  // A 250mm stub is a door reveal or a fragment, never a wall worth a corner.
  minSegmentMm: 250,
  // Scanner headings on the same wall agree closely; 8° is slack, not licence.
  parallelDeg: 8,
  // Wide enough to absorb an occluded fragment's error (the observed case was
  // 150mm). Deliberately NOT wide enough to reach a genuine 250-300mm return,
  // boxed pipework or chimney reveal: perpendicular distance alone cannot tell
  // those from clutter, which is why clutter is removed by HEIGHT first and
  // this only has to mop up what occlusion did to real walls.
  coplanarMm: 200,
  // A doorway is ~900mm; an occluded patch of wall can be wider than that.
  maxJumpMm: 1500,
  minCornerDeg: 15,
  // HEIGHT is the one physical property that separates a wall from clutter
  // standing against it. RoomPlan fits a wall plane to any large flat vertical
  // face, so the front of a shoe rack or a stack of boxes arrives as a "wall"
  // 100-400mm in front of the real one. A wall runs most of the room's height;
  // clutter does not.
  minWallHeightMm: 900,
  minWallTopMm: 1000,
  // A round column is approximated by short facets at many headings; a 600mm
  // column in six facets has ~300mm facets. Walls are longer than this.
  pillarMaxFacetMm: 1000,
  pillarMaxSpanMm: 1300,
  pillarLinkMm: 350,
};

const sub = (p: LoopPoint, q: LoopPoint): LoopPoint => ({ x: p.x - q.x, z: p.z - q.z });
const len = (p: LoopPoint): number => Math.hypot(p.x, p.z);
const dot = (p: LoopPoint, q: LoopPoint): number => p.x * q.x + p.z * q.z;
const dist = (p: LoopPoint, q: LoopPoint): number => Math.hypot(p.x - q.x, p.z - q.z);

function unit(p: LoopPoint): LoopPoint {
  const l = len(p) || 1;
  return { x: p.x / l, z: p.z / l };
}

/** A wall reduced to an infinite line plus the extent actually observed. */
interface WallLine {
  /** A point on the line. */
  origin: LoopPoint;
  /** Unit direction along the wall. */
  dir: LoopPoint;
  /** Unit normal pointing INTO the room. */
  inward: LoopPoint;
  /** Signed offsets along `dir` from `origin` covering what was seen. */
  t0: number;
  t1: number;
  /** Total observed length, for weighting. */
  support: number;
}

const endpoints = (line: WallLine): [LoopPoint, LoopPoint] => [
  { x: line.origin.x + line.dir.x * line.t0, z: line.origin.z + line.dir.z * line.t0 },
  { x: line.origin.x + line.dir.x * line.t1, z: line.origin.z + line.dir.z * line.t1 },
];

/**
 * Merge the fragments a scanner split one wall into, taking the OUTERMOST
 * offset rather than an average — see the note at the top of this file.
 *
 * Two collinear fragments are only bridged across an EMPTY gap: occlusion, or a
 * doorway. If another wall turns off the line at both ends of the gap, the gap
 * is the mouth of an alcove or a chimney breast, and bridging it would delete
 * real architecture from the plan.
 */
function mergeCoplanar(lines: WallLine[], context: LoopSegment[], o: Required<WallLoopOptions>): WallLine[] {
  const cosLimit = Math.cos((o.parallelDeg * Math.PI) / 180);

  /**
   * Is the gap [lo, hi] along `host` the MOUTH of something — an alcove, a
   * chimney breast, the notch of a U-shaped room — rather than an empty stretch
   * hidden behind clutter? It is when two different full-height walls turn off
   * the host's line inside it.
   *
   * Measured to survive occlusion, which is exactly what a gap is made of: a
   * wall counts when its LINE crosses the host line within the gap and it comes
   * within reach of it, not only when its endpoint touches — the last piece of
   * a notch wall is often a stub too short to be a wall on its own, or missing,
   * leaving the rest ending short of the corner. Stubs count here for the same
   * reason. Low surfaces do not (the side of a cabinet is not a wall), and the
   * two crossings must be apart, so one wall reported in two pieces is one.
   */
  const isMouth = (host: WallLine, lo: number, hi: number): boolean => {
    const crossings: number[] = [];
    for (const s of context) {
      if (dist(s.a, s.b) < STUB_MM) continue;
      if ((s.heightMm !== undefined && s.heightMm < o.minWallHeightMm) || (s.topMm !== undefined && s.topMm < o.minWallTopMm)) continue;
      const d = unit(sub(s.b, s.a));
      const cross = host.dir.x * d.z - host.dir.z * d.x;
      if (Math.abs(cross) < Math.sin((o.minCornerDeg * Math.PI) / 180)) continue;
      const near = Math.min(
        Math.abs(dot(sub(s.a, host.origin), host.inward)),
        Math.abs(dot(sub(s.b, host.origin), host.inward)),
      );
      if (near > MOUTH_REACH_MM) continue;
      // Where the wall's line meets the host's line, as a distance along it.
      const w = sub(s.a, host.origin);
      const t = (w.x * d.z - w.z * d.x) / cross;
      if (t >= lo - CORNER_REACH_MM && t <= hi + CORNER_REACH_MM) crossings.push(t);
    }
    return crossings.length >= 2 && Math.max(...crossings) - Math.min(...crossings) >= MOUTH_MIN_WIDTH_MM;
  };

  const merged: WallLine[] = [];
  for (const line of lines) {
    // Of the walls this fragment could belong to, the one it is closest to
    // along its length — so the result does not depend on the order RoomPlan
    // happened to list the fragments in.
    let bestHost = -1;
    let bestGap = Infinity;
    for (let i = 0; i < merged.length; i++) {
      const host = merged[i];
      // Same heading? Allow either direction — a fragment can be reported
      // running the other way along the same wall.
      if (Math.abs(dot(host.dir, line.dir)) < cosLimit) continue;
      // Same plane? Measure the fragment's offset across the host's normal.
      const offset = dot(sub(line.origin, host.origin), host.inward);
      if (Math.abs(offset) > o.coplanarMm) continue;

      // Where is the gap between them, if there is one?
      const [la, lb] = endpoints(line);
      const ta = dot(sub(la, host.origin), host.dir);
      const tb = dot(sub(lb, host.origin), host.dir);
      const lineLo = Math.min(ta, tb);
      const lineHi = Math.max(ta, tb);
      // The empty stretch between them along the host, if they do not overlap.
      const gapLo = lineLo > host.t1 ? host.t1 : lineHi < host.t0 ? lineHi : 0;
      const gapHi = lineLo > host.t1 ? lineLo : lineHi < host.t0 ? host.t0 : 0;
      const gap = gapHi - gapLo;
      if (gap > 0 && isMouth(host, gapLo, gapHi)) continue;
      if (gap < bestGap) {
        bestGap = gap;
        bestHost = i;
      }
    }

    if (bestHost < 0) {
      merged.push(line);
      continue;
    }

    // Same wall. Keep whichever is further OUT: a negative inward offset is
    // further from the room, which occlusion cannot manufacture.
    const host = merged[bestHost];
    const offset = dot(sub(line.origin, host.origin), host.inward);
    const dir = host.dir;
    const origin = offset < 0
      ? { x: host.origin.x + host.inward.x * offset, z: host.origin.z + host.inward.z * offset }
      : host.origin;

    // Union the observed extents, re-projected onto the kept line.
    const ts = [...endpoints(host), ...endpoints(line)].map((p) => dot(sub(p, origin), dir));
    merged[bestHost] = {
      origin,
      dir,
      inward: host.inward,
      t0: Math.min(...ts),
      t1: Math.max(...ts),
      support: host.support + line.support,
    };
  }
  return merged;
}

/** A wall ending within this of another wall's end is meeting it at a corner. */
const CORNER_REACH_MM = 200;
/** A wall turning off a gap may stop this short of the line (occlusion). */
const MOUTH_REACH_MM = 1200;
/** The two sides of a mouth are at least this far apart. */
const MOUTH_MIN_WIDTH_MM = 300;
/** Shorter than this is noise, even as evidence of a mouth. */
const STUB_MM = 60;
/**
 * The two corners of a step between `here` and `next`, from a surface seen
 * between them that crosses both — the step's return — or null.
 */
function returnBetween(
  here: WallLine,
  next: WallLine,
  hereEnd: LoopPoint,
  nextStart: LoopPoint,
  context: LoopSegment[],
  o: Required<WallLoopOptions>,
): [LoopPoint, LoopPoint] | null {
  let best: [LoopPoint, LoopPoint] | null = null;
  let bestD = Infinity;
  for (const s of context) {
    const len = dist(s.a, s.b);
    if (len < STUB_MM) continue;
    const line: WallLine = { origin: s.a, dir: unit(sub(s.b, s.a)), inward: { x: 0, z: 0 }, t0: 0, t1: len, support: len };
    const c1 = intersect(here, line, o.minCornerDeg);
    const c2 = intersect(line, next, o.minCornerDeg);
    if (!c1 || !c2) continue;
    const mid = { x: (s.a.x + s.b.x) / 2, z: (s.a.z + s.b.z) / 2 };
    // It must be part of THIS step: near both ends, and its corners too.
    if (dist(c1, hereEnd) > o.maxJumpMm || dist(c2, nextStart) > o.maxJumpMm) continue;
    const d = dist(mid, hereEnd) + dist(mid, nextStart);
    if (d <= 2 * o.maxJumpMm && d < bestD) {
      bestD = d;
      best = [c1, c2];
    }
  }
  return best;
}

/** What connecting two walls without a corner between them costs the chain. */
const JOG_PENALTY_MM = 500;
/** How much of a wall occlusion may hide at a corner and still be a corner. */
const OCCLUDED_CORNER_MM = 600;

/** Where two lines cross, or null when they are too near parallel to say. */
function intersect(a: WallLine, b: WallLine, minCornerDeg: number): LoopPoint | null {
  const cross = a.dir.x * b.dir.z - a.dir.z * b.dir.x;
  if (Math.abs(cross) < Math.sin((minCornerDeg * Math.PI) / 180)) return null;
  const d = sub(b.origin, a.origin);
  const t = (d.x * b.dir.z - d.z * b.dir.x) / cross;
  return { x: a.origin.x + a.dir.x * t, z: a.origin.z + a.dir.z * t };
}

/** Even-odd point-in-polygon. */
function inside(p: LoopPoint, poly: LoopPoint[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < a.x + ((p.z - a.z) / (b.z - a.z)) * (b.x - a.x)) {
      hit = !hit;
    }
  }
  return hit;
}

function distToSegment(p: LoopPoint, a: LoopPoint, b: LoopPoint): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-9) return dist(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return dist(p, { x: a.x + ab.x * t, z: a.z + ab.z * t });
}

const segmentGap = (s: LoopSegment, t: LoopSegment): number =>
  Math.min(
    distToSegment(s.a, t.a, t.b),
    distToSegment(s.b, t.a, t.b),
    distToSegment(t.a, s.a, s.b),
    distToSegment(t.b, s.a, s.b),
  );

/**
 * How much of the compass a set of facets covers, radians in [0, π]. Headings
 * are folded to [0, π) because a facet has no direction, and the spread is π
 * minus the largest empty arc between them.
 */
function headingSpread(segs: LoopSegment[]): number {
  const hs = segs
    .map((s) => {
      const h = Math.atan2(s.b.z - s.a.z, s.b.x - s.a.x);
      return ((h % Math.PI) + Math.PI) % Math.PI;
    })
    .sort((a, b) => a - b);
  if (hs.length < 2) return 0;
  let gap = Math.PI - hs[hs.length - 1] + hs[0];
  for (let i = 1; i < hs.length; i++) gap = Math.max(gap, hs[i] - hs[i - 1]);
  return Math.PI - gap;
}

/**
 * Least-squares circle through points (Kåsa): solve x² + z² + Dx + Ez + F = 0.
 * Points are centred first, which keeps the normal equations well conditioned
 * at room coordinates in millimetres.
 */
function fitCircle(pts: LoopPoint[]): { center: LoopPoint; radius: number; rms: number } | null {
  if (pts.length < 3) return null;
  const mx = pts.reduce((n, p) => n + p.x, 0) / pts.length;
  const mz = pts.reduce((n, p) => n + p.z, 0) / pts.length;
  let sxx = 0, sxz = 0, szz = 0, sx = 0, sz = 0, bx = 0, bz = 0, b1 = 0;
  const n = pts.length;
  for (const p of pts) {
    const x = p.x - mx;
    const z = p.z - mz;
    const r2 = x * x + z * z;
    sxx += x * x; sxz += x * z; szz += z * z; sx += x; sz += z;
    bx -= r2 * x; bz -= r2 * z; b1 -= r2;
  }
  // [sxx sxz sx; sxz szz sz; sx sz n] [D E F]ᵀ = [bx bz b1]ᵀ, by Cramer.
  const m = [[sxx, sxz, sx], [sxz, szz, sz], [sx, sz, n]];
  const det3 = (a: number[][]) =>
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const det = det3(m);
  if (Math.abs(det) < 1e-9) return null;
  const col = (c: number) => m.map((row, i) => row.map((v, j) => (j === c ? [bx, bz, b1][i] : v)));
  const D = det3(col(0)) / det;
  const E = det3(col(1)) / det;
  const F = det3(col(2)) / det;
  const cx = -D / 2;
  const cz = -E / 2;
  const r2 = cx * cx + cz * cz - F;
  if (!(r2 > 0)) return null;
  const radius = Math.sqrt(r2);
  const rms = Math.sqrt(
    pts.reduce((acc, p) => acc + (Math.hypot(p.x - mx - cx, p.z - mz - cz) - radius) ** 2, 0) / n,
  );
  return { center: { x: cx + mx, z: cz + mz }, radius, rms };
}

/** Round if the facets sit on a circle, otherwise the box that holds them. */
function fitPillar(facets: LoopSegment[]): Pillar {
  const pts = facets.flatMap((f) => [f.a, f.b, { x: (f.a.x + f.b.x) / 2, z: (f.a.z + f.b.z) / 2 }]);
  const circle = fitCircle(pts);
  if (
    circle &&
    facets.length >= 3 &&
    headingSpread(facets) >= (100 * Math.PI) / 180 &&
    circle.rms <= circle.radius * 0.12
  ) {
    const d = circle.radius * 2;
    return { center: circle.center, shape: 'round', width: d, depth: d, rotation: 0 };
  }
  // A box, aligned with its longest face.
  // Longest face, to the micron, first one on a tie — a square column's four
  // faces tie, and the Swift twin must pick the same one.
  const mm = (f: LoopSegment) => Math.round(dist(f.a, f.b) * 1000);
  const longest = facets.reduce((a, b) => (mm(b) > mm(a) ? b : a));
  const dir = unit(sub(longest.b, longest.a));
  const perp = { x: -dir.z, z: dir.x };
  const us = pts.map((p) => dot(p, dir));
  const vs = pts.map((p) => dot(p, perp));
  const u0 = Math.min(...us), u1 = Math.max(...us);
  const v0 = Math.min(...vs), v1 = Math.max(...vs);
  const uc = (u0 + u1) / 2;
  const vc = (v0 + v1) / 2;
  return {
    center: { x: dir.x * uc + perp.x * vc, z: dir.z * uc + perp.z * vc },
    shape: 'box',
    width: u1 - u0,
    depth: v1 - v0,
    rotation: Math.atan2(dir.z, dir.x),
  };
}

/**
 * Candidate pillars: groups of short facets, close together, facing many ways,
 * that fit in a column-sized square. Whether each really IS a pillar is decided
 * afterwards, against the outline built without it.
 */
function pillarClusters(segs: LoopSegment[], o: Required<WallLoopOptions>): number[][] {
  const short = segs
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => dist(s.a, s.b) <= o.pillarMaxFacetMm);
  const parent = short.map((_, k) => k);
  const find = (k: number): number => (parent[k] === k ? k : (parent[k] = find(parent[k])));
  for (let a = 0; a < short.length; a++) {
    for (let b = a + 1; b < short.length; b++) {
      if (segmentGap(short[a].s, short[b].s) <= o.pillarLinkMm) parent[find(a)] = find(b);
    }
  }
  const groups = new Map<number, number[]>();
  short.forEach(({ i }, k) => {
    const root = find(k);
    groups.set(root, [...(groups.get(root) ?? []), i]);
  });

  return [...groups.values()].filter((idx) => {
    if (idx.length < 2) return false;
    const facets = idx.map((i) => segs[i]);
    const pts = facets.flatMap((f) => [f.a, f.b]);
    const spanX = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
    const spanZ = Math.max(...pts.map((p) => p.z)) - Math.min(...pts.map((p) => p.z));
    if (Math.max(spanX, spanZ) > o.pillarMaxSpanMm) return false;
    // A straight run of short fragments is a wall, however short.
    return headingSpread(facets) >= (60 * Math.PI) / 180;
  });
}

/**
 * The full analysis: clutter out by height, pillars out as structure, and the
 * outline built from what is left.
 */
export function analyseWalls(segments: LoopSegment[], options: WallLoopOptions = {}): WallAnalysis {
  const o = { ...WALL_LOOP_DEFAULTS, ...options };

  // 1 — CLUTTER BY HEIGHT. Only surfaces that report a height can be judged;
  // a trace with no heights (manual, WebXR taps) passes through untouched.
  // Low is not enough on its own: an attic's knee wall is low and is still the
  // room's edge. Clutter is low AND stands in front of a real wall — the same
  // asymmetry as everywhere else here — so a low surface is only dropped when
  // a tall wall runs parallel right behind it.
  const tallEnough = (s: LoopSegment) =>
    (s.heightMm === undefined || s.heightMm >= o.minWallHeightMm) &&
    (s.topMm === undefined || s.topMm >= o.minWallTopMm);
  const tall = segments.filter(tallEnough);
  const clutter = (s: LoopSegment) => !tallEnough(s) && standsInFront(s, tall, o);
  // If that leaves no room at all, the heights are what is wrong, not the room.
  const walls = tall.length >= 3 ? segments.filter((s) => !clutter(s)) : segments;
  const clutterRejected = segments.length - walls.length;

  // 2 — PILLARS. A column's facets, woven into the outline, are what turned a
  // round pillar into a spike across the plan: greedy chaining visits the
  // column and comes back. So they are pulled out first — but only after the
  // clusters that are plainly part of the room (see `clusterIsBoundary`) have
  // been put back. The outline the rest are judged against has to be the
  // room's: built without one of its own corners it can stop short, and a real
  // column then looks as if it stands outside the room.
  const clusters = pillarClusters(walls, o).filter((idx) => !clusterIsBoundary(idx, walls, o));
  const inCluster = new Set(clusters.flat());
  const rest = walls.filter((_, i) => !inCluster.has(i));
  let outline = buildOutline(rest, o);

  // A true pillar stands INSIDE the room it was taken out of, clear of its
  // walls and not wedged into a corner. A cluster that does not — an alcove, a
  // small bay, a rounded corner — was part of the boundary after all, so it
  // goes back and the outline is rebuilt.
  const accepted: number[][] = [];
  const rejected: number[] = [];
  for (const idx of clusters) {
    const pts = idx.flatMap((i) => [walls[i].a, walls[i].b]);
    const c = {
      x: pts.reduce((n, p) => n + p.x, 0) / pts.length,
      z: pts.reduce((n, p) => n + p.z, 0) / pts.length,
    };
    const clearOfEdge =
      outline.length >= 3 &&
      inside(c, outline) &&
      outline.every((p, k) => distToSegment(c, p, outline[(k + 1) % outline.length]) >= 50);
    // A column stands free or against ONE wall. Something that reaches two
    // walls meeting at a corner is the corner itself — a rounded corner, or a
    // column built into it — and belongs in the boundary. Without this a
    // rounded corner came back as a 1.2 m "pillar" standing in the corner.
    if (clearOfEdge && !touchesCorner(pts, outline, o)) accepted.push(idx);
    else rejected.push(...idx);
  }
  if (rejected.length) {
    const back = new Set(rejected);
    outline = buildOutline(walls.filter((_, i) => !inCluster.has(i) || back.has(i)), o);
  }

  return {
    outline,
    pillars: accepted.map((idx) => fitPillar(idx.map((i) => walls[i]))),
    clutterRejected,
  };
}

/** Clutter this far or less in front of a wall is standing against it. */
const CLUTTER_REACH_MM = 1200;

/**
 * Does low surface `s` stand in front of a tall wall: one running parallel
 * within reach of it, whose extent covers most of it?
 *
 * The extent is the whole wall line — every tall piece on it, AND the gaps
 * between them — because clutter hides exactly the stretch of wall behind it:
 * a shoe rack arrives with the wall behind it missing, and measured against the
 * pieces alone it covered nothing and survived as a "wall".
 */
function standsInFront(s: LoopSegment, tall: LoopSegment[], o: Required<WallLoopOptions>): boolean {
  const sLen = dist(s.a, s.b);
  if (sLen < 1) return false;
  const d = unit(sub(s.b, s.a));
  const cosLimit = Math.cos((o.parallelDeg * Math.PI) / 180);
  const mid = { x: (s.a.x + s.b.x) / 2, z: (s.a.z + s.b.z) / 2 };
  let lo = Infinity;
  let hi = -Infinity;
  for (const t of tall) {
    const tLen = dist(t.a, t.b);
    if (tLen < 1) continue;
    const td = unit(sub(t.b, t.a));
    if (Math.abs(dot(td, d)) < cosLimit) continue;
    const across = Math.abs(-td.z * (mid.x - t.a.x) + td.x * (mid.z - t.a.z));
    if (across > CLUTTER_REACH_MM) continue;
    // The tall piece's extent, measured along the low surface.
    const ta = dot(sub(t.a, s.a), d);
    const tb = dot(sub(t.b, s.a), d);
    lo = Math.min(lo, ta, tb);
    hi = Math.max(hi, ta, tb);
  }
  // …and on past its last visible piece, for the same reason: the stretch the
  // clutter hides can be the wall's end.
  const overlap = Math.min(hi + o.maxJumpMm, sLen) - Math.max(lo - o.maxJumpMm, 0);
  return overlap >= 0.5 * sLen;
}

/**
 * Is this cluster of short pieces part of the room's BOUNDARY rather than a
 * column standing in it?
 *
 * Seen locally the two cannot be told apart — two wall pieces meeting at an
 * inside corner look exactly like two faces of a square column. What differs
 * is how they connect. A column's faces close into a ring, or leave loose ends
 * that touch nothing (it stands free) or one wall (it is built into it). A
 * corner of the room carries on into the rest of it: its loose ends meet walls
 * on two DIFFERENT lines. Taken for a column, such a corner was cut out of the
 * outline — the notch of a U-shaped room went with it, and a column appeared
 * where the notch should have been.
 */
function clusterIsBoundary(idx: number[], walls: LoopSegment[], o: Required<WallLoopOptions>): boolean {
  const cosLimit = Math.cos((o.parallelDeg * Math.PI) / 180);
  const facets = idx.map((i) => walls[i]);
  const ends = facets.flatMap((f, k) => [{ k, p: f.a, q: f.b }, { k, p: f.b, q: f.a }]);

  // Pair up the ends that meet (closest first); the rest are loose.
  const pairs: [number, number, number][] = [];
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      if (ends[i].k !== ends[j].k) pairs.push([dist(ends[i].p, ends[j].p), i, j]);
    }
  }
  pairs.sort((a, b) => a[0] - b[0]);
  const joined = ends.map(() => false);
  for (const [d, i, j] of pairs) {
    if (d > o.pillarLinkMm) break;
    if (!joined[i] && !joined[j]) joined[i] = joined[j] = true;
  }
  const loose = ends.filter((_, i) => !joined[i]);
  // A closed ring — or one closed but for a small gap — is a column.
  if (loose.length === 0) return false;
  if (loose.length === 2 && dist(loose[0].p, loose[1].p) <= o.pillarLinkMm) return false;

  const inCluster = new Set(idx);
  const others = walls.filter((s, i) => !inCluster.has(i) && dist(s.a, s.b) >= STUB_MM);
  /**
   * The walls a loose end runs into: one ending near it; one its own piece
   * carries straight on into; or one its piece would meet at a corner hidden
   * behind clutter — carried on, it crosses that wall's line close to where
   * that wall stops.
   */
  const meets = (end: { p: LoopPoint; q: LoopPoint }): LoopSegment[] => {
    const out = unit(sub(end.p, end.q));
    return others.filter((s) => {
      if (Math.min(dist(end.p, s.a), dist(end.p, s.b)) <= CORNER_REACH_MM) return true;
      const d = unit(sub(s.b, s.a));
      const cross = out.x * d.z - out.z * d.x;
      if (Math.abs(cross) >= Math.sin((o.minCornerDeg * Math.PI) / 180)) {
        const w = sub(s.a, end.p);
        const u = (w.x * d.z - w.z * d.x) / cross;
        if (u < -CORNER_REACH_MM || u > o.maxJumpMm) return false;
        const x = { x: end.p.x + out.x * u, z: end.p.z + out.z * u };
        return Math.min(dist(x, s.a), dist(x, s.b)) <= OCCLUDED_CORNER_MM;
      }
      if (Math.abs(dot(sub(s.a, end.p), { x: -out.z, z: out.x })) > o.coplanarMm) return false;
      const ta = dot(sub(s.a, end.p), out);
      const tb = dot(sub(s.b, end.p), out);
      return Math.min(ta, tb) >= -CORNER_REACH_MM && Math.min(ta, tb) <= o.maxJumpMm;
    });
  };
  const sameLine = (s: LoopSegment, t: LoopSegment): boolean => {
    const d = unit(sub(s.b, s.a));
    if (Math.abs(dot(d, unit(sub(t.b, t.a)))) < cosLimit) return false;
    const mid = { x: (t.a.x + t.b.x) / 2, z: (t.a.z + t.b.z) / 2 };
    return Math.abs(dot(sub(mid, s.a), { x: -d.z, z: d.x })) <= o.coplanarMm;
  };
  const met = loose.map(meets);
  for (let i = 0; i < met.length; i++) {
    for (let j = i + 1; j < met.length; j++) {
      if (met[i].some((s) => met[j].some((t) => !sameLine(s, t)))) return true;
    }
  }
  return false;
}

/** A pillar within this of a wall is touching it. */
const TOUCH_MM = 100;

/** Do these points touch two outline edges that are not parallel? */
function touchesCorner(pts: LoopPoint[], outline: LoopPoint[], o: Required<WallLoopOptions>): boolean {
  const cosLimit = Math.cos((o.parallelDeg * Math.PI) / 180);
  const touched: LoopPoint[] = [];
  for (let k = 0; k < outline.length; k++) {
    const a = outline[k];
    const b = outline[(k + 1) % outline.length];
    if (dist(a, b) < 1) continue;
    if (pts.some((p) => distToSegment(p, a, b) <= TOUCH_MM)) touched.push(unit(sub(b, a)));
  }
  return touched.some((d, i) => touched.some((e, j) => j > i && Math.abs(dot(d, e)) < cosLimit));
}

/** Wall segments → an ordered closed outline. See `analyseWalls` for the rest. */
export function wallLoop(segments: LoopSegment[], options: WallLoopOptions = {}): LoopPoint[] {
  return analyseWalls(segments, options).outline;
}

/**
 * Build the outline from segments already cleared of clutter and pillars.
 *
 * Returns the segments' own endpoints when there is nothing sensible to build
 * (fewer than three usable walls), so a degenerate scan degrades to what the
 * scanner said rather than to nothing.
 *
 * TWO PASSES, because "keep the OUTERMOST fragment" needs to know which side
 * of each wall the room is on. The first pass guesses it from the middle of
 * the walls — exact for a convex room, but in an L-shaped room that middle can
 * fall OUTSIDE the room, and then the reflex wall's "outermost" fragment is the
 * one clutter pushed INTO the room: the shoes bug again, in every non-convex
 * room. So the first pass's outline is asked instead — a point just to one side
 * of each wall is either in the room or not — and the outline is rebuilt with
 * those answers. Where the answer is unclear the first guess stands.
 */
function buildOutline(segments: LoopSegment[], o: Required<WallLoopOptions>): LoopPoint[] {
  const usable = segments.filter((s) => dist(s.a, s.b) >= o.minSegmentMm);
  const fallback = () => segments.flatMap((s) => [s.a, s.b]);
  if (usable.length < 3) return fallback();

  // Pass 1 — which way is "in", judged from the room's rough middle.
  const mids = usable.map((s) => ({ x: (s.a.x + s.b.x) / 2, z: (s.a.z + s.b.z) / 2 }));
  const centre = {
    x: mids.reduce((n, p) => n + p.x, 0) / mids.length,
    z: mids.reduce((n, p) => n + p.z, 0) / mids.length,
  };
  const guessed = usable.map((s, i) => {
    const dir = unit(sub(s.b, s.a));
    const left = { x: -dir.z, z: dir.x };
    return dot(left, sub(centre, mids[i])) >= 0 ? left : { x: -left.x, z: -left.z };
  });
  const first = outlineFrom(usable, guessed, segments, o);
  if (!first) return usable.flatMap((s) => [s.a, s.b]);

  // Pass 2 — which way is "in", asked of the room pass 1 found.
  let changed = false;
  const asked = usable.map((s, i) => {
    const side = roomSide(s, mids[i], first);
    if (!side || dot(side, guessed[i]) > 0) return guessed[i];
    changed = true;
    return side;
  });
  if (!changed) return first;
  return outlineFrom(usable, asked, segments, o) ?? first;
}

/**
 * The unit normal of `s` that points into `room`, or null when it cannot be
 * told: a point a little way off the wall is inside the room on one side and
 * not on the other. Several distances, because the first outline can be off by
 * a fragment's width near the wall and a small room is narrow far from it.
 */
function roomSide(s: LoopSegment, mid: LoopPoint, room: LoopPoint[]): LoopPoint | null {
  const dir = unit(sub(s.b, s.a));
  const left = { x: -dir.z, z: dir.x };
  for (const d of [250, 500, 1000]) {
    const l = inside({ x: mid.x + left.x * d, z: mid.z + left.z * d }, room);
    const r = inside({ x: mid.x - left.x * d, z: mid.z - left.z * d }, room);
    if (l !== r) return l ? left : { x: -left.x, z: -left.z };
  }
  return null;
}

/** One pass: merge, chain, corner. Null when no loop can be made. */
function outlineFrom(
  usable: LoopSegment[],
  inwards: LoopPoint[],
  context: LoopSegment[],
  o: Required<WallLoopOptions>,
): LoopPoint[] | null {
  const lines: WallLine[] = usable.map((s, i) => {
    const support = dist(s.a, s.b);
    return { origin: s.a, dir: unit(sub(s.b, s.a)), inward: inwards[i], t0: 0, t1: support, support };
  });

  const walls = mergeCoplanar(lines, context, o);
  if (walls.length < 3) return null;

  // Order them into a loop, starting from the longest — the wall most likely to
  // be reported correctly, and the best anchor for everything chained off it.
  // Ties (a rectangle's opposite walls) break by list order, and support is
  // compared to the micron so the Swift twin, whose arithmetic differs in the
  // last bits, starts from the same wall.
  const remaining = walls.slice();
  remaining.sort((a, b) => Math.round(b.support * 1000) - Math.round(a.support * 1000));
  const ordered: WallLine[] = [remaining.shift() as WallLine];

  for (;;) {
    const current = ordered[ordered.length - 1];
    const tail = endpoints(current)[1];
    // The next wall is the one reached by the shortest path THROUGH THE CORNER
    // the two would form — where their lines meet — not simply the nearest
    // loose end. When clutter hides the end of a wall, the nearest end can
    // belong to a wall running parallel to it on the far side of a notch; two
    // parallel walls cannot meet at a corner, so such a wall only wins when
    // nothing forms a corner at all (a jog whose return went unseen).
    let best = -1;
    let bestFlip = false;
    let bestCost = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const [p, q] = endpoints(remaining[i]);
      const corner = intersect(current, remaining[i], o.minCornerDeg);
      let cost = Math.min(dist(tail, p), dist(tail, q)) + JOG_PENALTY_MM;
      let flip = dist(tail, q) < dist(tail, p);
      if (corner && dot(sub(corner, tail), current.dir) >= -CORNER_REACH_MM) {
        const viaCorner = dist(tail, corner) + Math.min(dist(corner, p), dist(corner, q));
        if (viaCorner < cost) {
          cost = viaCorner;
          flip = dist(corner, q) < dist(corner, p);
        }
      }
      if (cost < bestCost) { bestCost = cost; best = i; bestFlip = flip; }
    }
    if (best < 0) break;

    // A gap wider than a doorway is not a corner — unless the two wall lines
    // genuinely cross nearby, which is what an occluded corner looks like.
    const bestDist = Math.min(...endpoints(remaining[best]).map((p) => dist(tail, p)));
    if (bestDist > o.maxJumpMm) {
      const meeting = intersect(current, remaining[best], o.minCornerDeg);
      const reachable =
        meeting !== null &&
        dist(meeting, tail) <= o.maxJumpMm * 2 &&
        Math.min(...endpoints(remaining[best]).map((p) => dist(meeting, p))) <= o.maxJumpMm * 2;
      if (!reachable) break;
    }

    const picked = remaining.splice(best, 1)[0];
    ordered.push(
      bestFlip
        ? { ...picked, dir: { x: -picked.dir.x, z: -picked.dir.z }, t0: -picked.t1, t1: -picked.t0 }
        : picked,
    );
  }

  if (ordered.length < 3) return null;

  // Corners by INTERSECTION. A corner hidden behind a bin is still exactly
  // where its two walls meet, and no amount of occlusion moves that.
  const out: LoopPoint[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const here = ordered[i];
    const next = ordered[(i + 1) % ordered.length];
    const corner = intersect(here, next, o.minCornerDeg);
    const [, hereEnd] = endpoints(here);
    const [nextStart] = endpoints(next);
    if (corner && dist(corner, hereEnd) <= o.maxJumpMm * 3) {
      out.push(corner);
      continue;
    }
    // Two walls with no corner between them are a step, and a step has a
    // return. A short return is often seen only as a stub too short to be a
    // wall on its own — but its LINE is still known, and it gives the step
    // both of its real corners instead of a diagonal.
    const step = returnBetween(here, next, hereEnd, nextStart, context, o);
    if (step) {
      out.push(...step);
      continue;
    }
    // Nothing to go on: keep BOTH endpoints so the jog is visible and
    // correctable, rather than fusing it into a chord.
    out.push(hereEnd);
    if (dist(hereEnd, nextStart) > 1) out.push(nextStart);
  }
  return out;
}
