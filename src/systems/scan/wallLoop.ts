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
}

export const WALL_LOOP_DEFAULTS: Required<WallLoopOptions> = {
  // A 250mm stub is a door reveal or a fragment, never a wall worth a corner.
  minSegmentMm: 250,
  // Scanner headings on the same wall agree closely; 8° is slack, not licence.
  parallelDeg: 8,
  // Wide enough to absorb an occluded fragment's error (the observed case was
  // 150mm), narrow enough not to swallow a genuine 400mm recess.
  coplanarMm: 300,
  maxJumpMm: 900,
  minCornerDeg: 15,
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
 */
function mergeCoplanar(lines: WallLine[], o: Required<WallLoopOptions>): WallLine[] {
  const cosLimit = Math.cos((o.parallelDeg * Math.PI) / 180);
  const merged: WallLine[] = [];

  for (const line of lines) {
    let joined = false;
    for (let i = 0; i < merged.length; i++) {
      const host = merged[i];
      // Same heading? Allow either direction — a fragment can be reported
      // running the other way along the same wall.
      if (Math.abs(dot(host.dir, line.dir)) < cosLimit) continue;
      // Same plane? Measure the fragment's offset across the host's normal.
      const offset = dot(sub(line.origin, host.origin), host.inward);
      if (Math.abs(offset) > o.coplanarMm) continue;

      // Same wall. Keep whichever is further OUT: a negative inward offset is
      // further from the room centre, which occlusion cannot manufacture.
      const outward = offset < 0;
      const dir = host.dir;
      const origin = outward
        ? { x: host.origin.x + host.inward.x * offset, z: host.origin.z + host.inward.z * offset }
        : host.origin;

      // Union the observed extents, re-projected onto the kept line.
      const ts = [...endpoints(host), ...endpoints(line)].map((p) => dot(sub(p, origin), dir));
      merged[i] = {
        origin,
        dir,
        inward: host.inward,
        t0: Math.min(...ts),
        t1: Math.max(...ts),
        support: host.support + line.support,
      };
      joined = true;
      break;
    }
    if (!joined) merged.push(line);
  }
  return merged;
}

/** Where two lines cross, or null when they are too near parallel to say. */
function intersect(a: WallLine, b: WallLine, minCornerDeg: number): LoopPoint | null {
  const cross = a.dir.x * b.dir.z - a.dir.z * b.dir.x;
  if (Math.abs(cross) < Math.sin((minCornerDeg * Math.PI) / 180)) return null;
  const d = sub(b.origin, a.origin);
  const t = (d.x * b.dir.z - d.z * b.dir.x) / cross;
  return { x: a.origin.x + a.dir.x * t, z: a.origin.z + a.dir.z * t };
}

/**
 * Wall segments → an ordered closed outline.
 *
 * Returns the segments' own endpoints when there is nothing sensible to build
 * (fewer than three usable walls), so a degenerate scan degrades to what the
 * scanner said rather than to nothing.
 */
export function wallLoop(segments: LoopSegment[], options: WallLoopOptions = {}): LoopPoint[] {
  const o = { ...WALL_LOOP_DEFAULTS, ...options };

  const usable = segments.filter((s) => dist(s.a, s.b) >= o.minSegmentMm);
  if (usable.length < 3) return segments.flatMap((s) => [s.a, s.b]);

  // The room's rough middle, used only to decide which way is "in".
  const mids = usable.map((s) => ({ x: (s.a.x + s.b.x) / 2, z: (s.a.z + s.b.z) / 2 }));
  const centre = {
    x: mids.reduce((n, p) => n + p.x, 0) / mids.length,
    z: mids.reduce((n, p) => n + p.z, 0) / mids.length,
  };

  const lines: WallLine[] = usable.map((s) => {
    const dir = unit(sub(s.b, s.a));
    let inward = { x: -dir.z, z: dir.x };
    const mid = { x: (s.a.x + s.b.x) / 2, z: (s.a.z + s.b.z) / 2 };
    if (dot(inward, sub(centre, mid)) < 0) inward = { x: -inward.x, z: -inward.z };
    const support = dist(s.a, s.b);
    return { origin: s.a, dir, inward, t0: 0, t1: support, support };
  });

  const walls = mergeCoplanar(lines, o);
  if (walls.length < 3) return usable.flatMap((s) => [s.a, s.b]);

  // Order them into a loop, starting from the longest — the wall most likely to
  // be reported correctly, and the best anchor for everything chained off it.
  const remaining = walls.slice();
  remaining.sort((a, b) => b.support - a.support);
  const ordered: WallLine[] = [remaining.shift() as WallLine];

  for (;;) {
    const tail = endpoints(ordered[ordered.length - 1])[1];
    let best = -1;
    let bestFlip = false;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const [p, q] = endpoints(remaining[i]);
      const dp = dist(tail, p);
      const dq = dist(tail, q);
      if (dp < bestDist) { bestDist = dp; best = i; bestFlip = false; }
      if (dq < bestDist) { bestDist = dq; best = i; bestFlip = true; }
    }
    if (best < 0) break;

    // A gap wider than a doorway is not a corner — unless the two wall lines
    // genuinely cross nearby, which is what an occluded corner looks like.
    if (bestDist > o.maxJumpMm) {
      const meeting = intersect(ordered[ordered.length - 1], remaining[best], o.minCornerDeg);
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

  if (ordered.length < 3) return usable.flatMap((s) => [s.a, s.b]);

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
    } else {
      // Near-parallel, or a corner implausibly far away: keep BOTH endpoints so
      // the jog is visible and correctable, rather than fusing it into a chord.
      out.push(hereEnd);
      if (dist(hereEnd, nextStart) > 1) out.push(nextStart);
    }
  }
  return out;
}
