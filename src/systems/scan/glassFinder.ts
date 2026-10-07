/**
 * Find the glass RoomPlan missed — from what the depth sensor saw THROUGH it,
 * and from what it could not see at all.
 *
 * WHY THIS EXISTS. RoomPlan finds a window by recognising a window. A sliding
 * glass door, a floor-to-ceiling pane or a frameless partition does not look
 * like one, so it comes back as plain wall and the plan says there is a wall
 * where there is a view. Testers hit this first ("有玻璃偵測不到").
 *
 * THREE KINDS OF EVIDENCE, because no single one survives every condition.
 *
 *   1. THROUGH. LiDAR does not stop at clear glass. A confident reading taken
 *      through a pane lands on whatever is BEHIND it — the balcony rail, the
 *      flat opposite — well beyond the wall the room says is there. Solid wall
 *      can never do that. This is the only cue the first version used, and it
 *      needs something within the sensor's ~5 m reach behind the glass and a
 *      sensor that is not blinded — i.e. a balcony, at night.
 *
 *   2. NO RETURN. In daylight the sun floods the LiDAR's 940 nm band, and from
 *      a high floor there is nothing within 5 m behind the glass at all. Either
 *      way ARKit has no real measurement there; it fills the hole with a guess
 *      (often painted at the depth of the wall around the pane) and marks it
 *      LOW confidence. The first version threw every low-confidence reading
 *      away, so in daylight a window produced no evidence whatsoever — that is
 *      the field bug. A painted wall within 4 m, looked at squarely, always
 *      returns a confident reading, so a low-confidence reading that reaches the
 *      wall IS evidence: of nothing there to measure. Only looks that are close
 *      enough and square enough to the wall count, so a far wall or one seen
 *      edge-on while walking past it does not.
 *
 *   3. LIGHT. In daylight a window is the brightest thing in the room by an
 *      order of magnitude and the camera blows it out. A see-through or
 *      no-return reading on a blown-out pixel, taken from close, counts twice.
 *      Brightness never creates evidence on its own: a sunlit patch of wall is
 *      blown out too, and from close the sensor still measures it, so it votes
 *      solid. Only from across the room is a sunlit wall as hard to measure as
 *      a window — which is why the bonus stops there.
 *
 * Readings that land ON the wall with confidence vote the other way. Patches
 * where the see-through evidence wins, over an area the size of a window, are
 * the glass.
 *
 * WHAT IT CANNOT TELL APART. A mirror returns depth from the reflected room,
 * which also lands "behind" the wall — to a depth sensor a mirror IS a window
 * into a second room. A television that is on is bright and glossy. So are a
 * doorway RoomPlan missed and a deep unrecorded alcove. Everything found here
 * is therefore marked `glass: true`, drawn as a suggestion, and can be removed
 * with one tap. It is never presented as a measurement the way RoomPlan's own
 * windows are. (Frosted or IR-reflective film reads as a solid wall to LiDAR
 * and is beyond any depth cue; add those by hand.)
 *
 * Millimetres, y = height above the floor. Pure — the Swift twin is
 * `apps/ios/MozuScanner/Scan/GlassFinder.swift`.
 */

export interface GlassPoint {
  x: number;
  y: number;
  z: number;
}

/** One depth reading: where the camera was, and where the reading landed. */
export interface DepthRay {
  eye: GlassPoint;
  hit: GlassPoint;
  /**
   * ARKit's confidence in the reading: 0 low, 1 medium, 2 high. Absent means
   * high. A reading ARKit has no depth for at all is a low-confidence ray whose
   * `hit` is simply a point far along the pixel's line of sight.
   */
  confidence?: number;
  /** Camera brightness at the reading, 0–255. Absent: unknown, never bright. */
  luma?: number;
}

export interface GlassOpening {
  /** Wall index: edge `wall` → `wall + 1` of the polygon. */
  wall: number;
  /** Leading edge along the wall, mm (the RoomScan contract). */
  offset: number;
  width: number;
  height: number;
  sill: number;
  /** Glass that reaches the floor is a door (sliding, French); else a window. */
  type: 'window' | 'door';
  /** See-through votes behind this suggestion — how sure it is. */
  votes: number;
}

export interface GlassOptions {
  /** Evidence grid resolution on each wall. */
  cellMm?: number;
  /** A reading must land at least this far beyond the wall to see through it. */
  beyondMm?: number;
  /** A reading within this of the wall landed ON it. */
  onWallMm?: number;
  /** Ignore crossings this close to a wall's ends — corners are noisy. */
  endMarginMm?: number;
  /** See-through votes a cell needs… */
  minThrough?: number;
  /** …and by how many times they must outnumber the solid ones. */
  throughRatio?: number;
  /** Smallest pane reported, either way. */
  minSideMm?: number;
  /** Fraction of the OBSERVED cells in a patch that must be see-through. */
  minFill?: number;
  /** Total see-through votes a patch needs to be reported at all. */
  minVotes?: number;
  /**
   * …and per cell it was seen in. Glass gives see-through evidence from every
   * look at it; a solid wall that is merely hard to measure (sun on it, seen
   * from far off) gives it now and then. This is what tells them apart.
   */
  minDensity?: number;
  /** Glass starting lower than this runs to the floor: a door. */
  doorSillMm?: number;
  /** A pixel at least this bright is blown out: daylight, or a lamp. */
  brightLuma?: number;
  /** …and counts double only when the wall it reached is this close. */
  brightRangeMm?: number;
  /** No-return readings only count where a solid wall is this close… */
  voidRangeMm?: number;
  /** …and looked at this squarely: the cosine of the angle off the wall's normal. */
  voidMinCos?: number;
}

export const GLASS_DEFAULTS: Required<GlassOptions> = {
  cellMm: 100,
  beyondMm: 300,
  onWallMm: 120,
  endMarginMm: 150,
  minThrough: 2,
  throughRatio: 2,
  minSideMm: 400,
  minFill: 0.6,
  minVotes: 24,
  minDensity: 1,
  doorSillMm: 300,
  brightLuma: 235,
  brightRangeMm: 2500,
  voidRangeMm: 4000,
  voidMinCos: 0.4,
};

/** Openings already on the plan, so glass is not reported twice. */
export interface KnownOpening {
  wall: number;
  offset: number;
  width: number;
}

export function findGlass(
  rays: DepthRay[],
  polygon: { x: number; z: number }[],
  ceilingMm: number,
  existing: KnownOpening[] = [],
  options: GlassOptions = {},
): GlassOpening[] {
  const o = { ...GLASS_DEFAULTS, ...options };
  const n = polygon.length;
  if (n < 3 || rays.length === 0 || !(ceilingMm > 0)) return [];

  // Which side is in? Positive shoelace area = counter-clockwise in (x, z),
  // and then the room is on the LEFT of every edge.
  let twiceArea = 0;
  for (let i = 0; i < n; i++) {
    const p = polygon[i];
    const q = polygon[(i + 1) % n];
    twiceArea += p.x * q.z - q.x * p.z;
  }
  const leftIsIn = twiceArea > 0;

  const walls = polygon.map((a, i) => {
    const b = polygon[(i + 1) % n];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const d = length > 0 ? { x: (b.x - a.x) / length, z: (b.z - a.z) / length } : { x: 1, z: 0 };
    const inward = leftIsIn ? { x: -d.z, z: d.x } : { x: d.z, z: -d.x };
    const cols = Math.max(1, Math.ceil(length / o.cellMm));
    const rows = Math.max(1, Math.ceil(ceilingMm / o.cellMm));
    return {
      a, length, d, inward, cols, rows,
      // See-through evidence (weighted: a blown-out reading counts twice) and
      // solid votes, per cell.
      through: new Uint16Array(cols * rows),
      solid: new Uint16Array(cols * rows),
    };
  });

  const cellOf = (w: (typeof walls)[number], t: number, y: number): number => {
    const c = Math.min(w.cols - 1, Math.max(0, Math.floor(t / o.cellMm)));
    const r = Math.min(w.rows - 1, Math.max(0, Math.floor(y / o.cellMm)));
    return r * w.cols + c;
  };
  const bump = (arr: Uint16Array, i: number, by: number) => {
    arr[i] = Math.min(65535, arr[i] + by);
  };

  for (const ray of rays) {
    const { eye, hit } = ray;
    const confidence = ray.confidence ?? 2;
    // Medium or high confidence measured something; low says only that
    // nothing could be measured along this line of sight.
    const measured = confidence >= 1;
    const bright = ray.luma !== undefined && ray.luma >= o.brightLuma;
    const dx = hit.x - eye.x, dy = hit.y - eye.y, dz = hit.z - eye.z;
    // Not Math.hypot: the Swift twin must get the same bits.
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // Where the ray first LEAVES the room through a wall, if it does — and,
    // for a reading that measured nothing, where it first reaches one.
    let exit: { wall: number; f: number } | null = null;
    let reach: { wall: number; f: number } | null = null;
    for (let wi = 0; wi < n; wi++) {
      const w = walls[wi];
      if (w.length <= 0) continue;
      const sEye = (eye.x - w.a.x) * w.inward.x + (eye.z - w.a.z) * w.inward.z;
      const sHit = (hit.x - w.a.x) * w.inward.x + (hit.z - w.a.z) * w.inward.z;
      const tHit = (hit.x - w.a.x) * w.d.x + (hit.z - w.a.z) * w.d.z;

      // Landed ON this wall: a vote that it is solid there.
      if (measured && Math.abs(sHit) <= o.onWallMm && tHit >= 0 && tHit <= w.length && hit.y >= 0 && hit.y <= ceilingMm) {
        bump(w.solid, cellOf(w, tHit, hit.y), 1);
      }

      if (measured) {
        // Measured, and measured BEYOND the wall.
        if (!(sEye > 0 && sHit < -o.beyondMm)) continue;
        const f = sEye / (sEye - sHit);
        const cx = eye.x + (hit.x - eye.x) * f;
        const cz = eye.z + (hit.z - eye.z) * f;
        const t = (cx - w.a.x) * w.d.x + (cz - w.a.z) * w.d.z;
        if (t < o.endMarginMm || t > w.length - o.endMarginMm) continue;
        if (!exit || f < exit.f) exit = { wall: wi, f };
        continue;
      }

      // Nothing measured. Where does its line of sight reach this wall?
      if (!(sEye > 0 && sHit <= o.onWallMm && sEye - sHit > 1e-6) || !(length > 0)) continue;
      // Squarely enough: a wall seen edge-on returns nothing even when solid.
      if ((sEye - sHit) / length < o.voidMinCos) continue;
      const f = sEye / (sEye - sHit);
      if (f * length > o.voidRangeMm) continue;
      const cx = eye.x + (hit.x - eye.x) * f;
      const cz = eye.z + (hit.z - eye.z) * f;
      const t = (cx - w.a.x) * w.d.x + (cz - w.a.z) * w.d.z;
      if (t < o.endMarginMm || t > w.length - o.endMarginMm) continue;
      if (!reach || f < reach.f) reach = { wall: wi, f };
    }
    const at = exit ?? reach;
    if (!at) continue;
    const w = walls[at.wall];
    const y = eye.y + (hit.y - eye.y) * at.f;
    if (y < 0 || y > ceilingMm) continue;
    const cx = eye.x + (hit.x - eye.x) * at.f;
    const cz = eye.z + (hit.z - eye.z) * at.f;
    const weight = bright && at.f * length <= o.brightRangeMm ? 2 : 1;
    bump(w.through, cellOf(w, (cx - w.a.x) * w.d.x + (cz - w.a.z) * w.d.z, y), weight);
  }

  const found: GlassOpening[] = [];
  for (let wi = 0; wi < n; wi++) {
    const w = walls[wi];
    const cells = w.cols * w.rows;
    const glassy = new Uint8Array(cells);
    for (let i = 0; i < cells; i++) {
      glassy[i] = w.through[i] >= o.minThrough && w.through[i] >= o.throughRatio * w.solid[i] ? 1 : 0;
    }

    // Patches: glass cells within two cells of each other along the wall, or
    // three up it, belong together. The rays are sparse, so a pane is observed
    // as a speckle rather than a solid block; joining across small gaps is
    // what makes it one pane — and the extra row bridges a transom.
    const label = new Int32Array(cells).fill(-1);
    let next = 0;
    for (let start = 0; start < cells; start++) {
      if (!glassy[start] || label[start] >= 0) continue;
      const stack = [start];
      label[start] = next;
      let c0 = w.cols, c1 = -1, r0 = w.rows, r1 = -1, votes = 0;
      while (stack.length) {
        const i = stack.pop()!;
        const c = i % w.cols;
        const r = (i - c) / w.cols;
        c0 = Math.min(c0, c); c1 = Math.max(c1, c);
        r0 = Math.min(r0, r); r1 = Math.max(r1, r);
        votes += w.through[i];
        for (let dr = -3; dr <= 3; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const rr = r + dr, cc = c + dc;
            if (rr < 0 || cc < 0 || rr >= w.rows || cc >= w.cols) continue;
            const j = rr * w.cols + cc;
            if (glassy[j] && label[j] < 0) {
              label[j] = next;
              stack.push(j);
            }
          }
        }
      }
      next++;

      const width = (c1 - c0 + 1) * o.cellMm;
      const height = (r1 - r0 + 1) * o.cellMm;
      if (width < o.minSideMm || height < o.minSideMm || votes < o.minVotes) continue;

      // Of what was actually SEEN inside the patch, most must be see-through.
      // Unobserved cells say nothing either way and are not held against it.
      let seen = 0, clear = 0;
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const j = r * w.cols + c;
          if (w.through[j] + w.solid[j] > 0) seen++;
          if (glassy[j]) clear++;
        }
      }
      if (seen === 0 || clear / seen < o.minFill || votes < o.minDensity * seen) continue;

      const offset = c0 * o.cellMm;
      const bottom = r0 * o.cellMm;
      const top = Math.min(ceilingMm, (r1 + 1) * o.cellMm);
      const toFloor = bottom <= o.doorSillMm;
      const opening: GlassOpening = {
        wall: wi,
        offset,
        width: Math.min(width, w.length - offset),
        height: toFloor ? top : top - bottom,
        sill: toFloor ? 0 : bottom,
        type: toFloor ? 'door' : 'window',
        votes,
      };

      // Already on the plan — RoomPlan recognised this one itself.
      const duplicate = existing.some((e) => {
        if (e.wall !== wi) return false;
        const overlap = Math.min(e.offset + e.width, opening.offset + opening.width) - Math.max(e.offset, opening.offset);
        return overlap >= 0.5 * Math.min(e.width, opening.width);
      });
      if (!duplicate) found.push(opening);
    }
  }
  return found.sort((a, b) => a.wall - b.wall || a.offset - b.offset);
}
