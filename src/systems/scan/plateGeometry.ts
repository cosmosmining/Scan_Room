/**
 * Depth-gated socket confirmation — the reference implementation of what
 * `apps/ios/MozuScanner/Scan/DepthGate.swift` and `FixtureCapture.swift` do on
 * device, kept here so the geometry is testable without a LiDAR iPad.
 *
 * The image detector answers "is there a plate-shaped bright block here?" — a
 * question a shadow, a poster, a laundry bottle and a patch of sunlit drywall
 * all answer yes to. On device that produced boxes on cables, on baseboards and
 * on empty space, while real outlets went unmarked. Brightness alone is not
 * enough information to decide; depth is.
 *
 * So a candidate has to pass four questions that only geometry can settle:
 *
 *   1. How BIG is it, in millimetres? A faceplate is 45-260mm. A poster, a
 *      window frame and a detergent bottle are not.
 *   2. Is it ON the surface around it, or floating in front of it? Fit the
 *      surrounding wall and check the candidate lies in that plane.
 *   3. Is that surface FLAT and VERTICAL? Floors, worktops, box tops and
 *      crumpled fabric are excluded by construction rather than by luck.
 *   4. WHERE is it? A metric world position, measured at the moment of seeing —
 *      not a ray re-cast at a floor polygon that will not exist until the scan
 *      ends, which is what made placement drift.
 *
 * The plane fit uses a small piece of projective geometry: for any planar
 * surface, 1/depth is EXACTLY linear in image coordinates. Fitting the wall is
 * therefore a three-unknown least squares on 1/d — no iteration, no
 * eigenvectors — and the residual comes back as real millimetres of deviation.
 */

import { classifyPlate, type PlateKind, type SocketDetection } from './fixtureDetector';

export type Vec3 = { x: number; y: number; z: number };

/** Depth in metres; 0 means "no usable reading here". */
export interface DepthFrame {
  depth: Float32Array | number[];
  width: number;
  height: number;
}

/** Pinhole parameters for the CAPTURED image (not the depth map). */
export interface PlateIntrinsics {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
}

/**
 * Camera pose: a column-major 4x4, the layout ARKit's `simd_float4x4` uses.
 * Columns 0-2 are the camera's right / up / backward axes in world space
 * (ARKit looks down its own -Z); column 3 is its position.
 */
export type CameraTransform = readonly number[];

export interface PlateGeometry {
  /** Plate centre in world coordinates (metres). */
  world: Vec3;
  /** Wall normal in world coordinates, pointing into the room. */
  normal: Vec3;
  widthMm: number;
  heightMm: number;
  /** How far the candidate sits off the plane of the wall around it (mm). */
  standoffMm: number;
  /** RMS deviation of that surrounding wall from a perfect plane (mm). */
  flatnessMm: number;
  /** Distance from the camera (metres). */
  rangeM: number;
}

/**
 * Physical limits. These are the whole point: they are facts about sockets, not
 * thresholds tuned against a screenshot, so they hold in rooms nobody has tested.
 */
export const PLATE_LIMITS = {
  /** A faceplate's smaller side. UK single gang 86mm, US duplex ~70mm. */
  minSideMm: 45,
  /** The larger side. Quad-gang plates reach ~220mm; the rest is halo margin. */
  maxSideMm: 260,
  /**
   * How far off the surrounding wall plane a candidate can read. LiDAR at this
   * resolution cannot see a 6mm proudness, so this does not measure the plate —
   * it rejects candidates that are not on the wall at all.
   */
  maxStandoffMm: 120,
  /** RMS flatness of the wall around the candidate (drywall at 3m reads 10-20mm). */
  maxFlatnessMm: 35,
  /** |normal.y| — a wall is vertical. 0.42 is ~25 degrees of tolerance. */
  maxVerticalComponent: 0.42,
  minRangeM: 0.22,
  maxRangeM: 6.5,
  /** Fewer wall samples than this and there is nothing to call a plane. */
  minWallSamples: 12,
  /**
   * ...and they must be most of what was actually there.
   *
   * The +/-600mm filter that keeps the fit on one surface has a sharp edge: a
   * candidate at a depth CLIFF has its far side removed entirely, leaving a
   * clean near-side plane that fits beautifully and means nothing. Requiring the
   * survivors to be a majority of the readings turns "I discarded most of this
   * patch" from a silent success into the rejection it should be.
   */
  minWallCoverage: 0.55,
} as const;

/**
 * Measure one detection against a depth map, or reject it.
 *
 * @param detection box normalised 0..1 against the captured image, origin top-left
 * @param depth     depth snapshot for the same frame (any resolution; same FOV)
 * @param intrinsics for the CAPTURED image — scaled internally to depth space
 * @param imageSize captured image size in pixels
 * @param cameraTransform camera pose, column-major 4x4
 */
export function measurePlate(
  detection: SocketDetection,
  depth: DepthFrame,
  intrinsics: PlateIntrinsics,
  imageSize: { width: number; height: number },
  cameraTransform: CameraTransform,
): PlateGeometry | null {
  if (depth.width <= 8 || depth.height <= 8) return null;
  if (imageSize.width <= 0 || imageSize.height <= 0) return null;
  if (!(intrinsics.fx > 1) || !(intrinsics.fy > 1)) return null;

  // The depth map covers the same field of view as the captured image, so
  // mapping the intrinsics across is a pure ratio.
  const sx = depth.width / imageSize.width;
  const sy = depth.height / imageSize.height;
  const fx = intrinsics.fx * sx;
  const fy = intrinsics.fy * sy;
  const cx = intrinsics.cx * sx;
  const cy = intrinsics.cy * sy;

  const bcx = detection.cx * depth.width;
  const bcy = detection.cy * depth.height;
  const bw = Math.max(1, detection.w * depth.width);
  const bh = Math.max(1, detection.h * depth.height);

  // How far away is the plate itself? Median of the inner patch, so one stray
  // reading on the plate edge cannot move it.
  const plateDepth = medianDepth(depth, bcx, bcy, Math.max(0.5, bw * 0.3), Math.max(0.5, bh * 0.3));
  if (plateDepth === null) return null;
  if (plateDepth < PLATE_LIMITS.minRangeM || plateDepth > PLATE_LIMITS.maxRangeM) return null;

  // The wall AROUND the plate: an annulus wide enough to be wall, near enough
  // to be the SAME wall.
  const innerW = bw * 0.75;
  const innerH = bh * 0.75;
  const outerW = Math.max(bw * 2.1, bw + 6);
  const outerH = Math.max(bh * 2.1, bh + 6);
  const x0 = Math.max(0, Math.floor(bcx - outerW));
  const x1 = Math.min(depth.width - 1, Math.ceil(bcx + outerW));
  const y0 = Math.max(0, Math.floor(bcy - outerH));
  const y1 = Math.min(depth.height - 1, Math.ceil(bcy + outerH));
  if (x0 > x1 || y0 > y1) return null;

  const su: number[] = [];
  const sv: number[] = [];
  const sr: number[] = [];
  let available = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (Math.abs(x - bcx) <= innerW && Math.abs(y - bcy) <= innerH) continue;
      const d = depth.depth[y * depth.width + x];
      if (!(d > 0)) continue;
      available++;
      // Anything wildly nearer or further is a different surface and must not
      // be allowed to drag the plane fit.
      if (Math.abs(d - plateDepth) >= 0.6) continue;
      su.push(x);
      sv.push(y);
      sr.push(1 / d);
    }
  }
  if (su.length < PLATE_LIMITS.minWallSamples) return null;
  if (su.length < available * PLATE_LIMITS.minWallCoverage) return null;

  const fit = solvePlane(su, sv, sr);
  if (!fit) return null;

  // Residuals back in metres, then millimetres — a real physical flatness.
  let sumSq = 0;
  for (let i = 0; i < su.length; i++) {
    const predicted = fit.a * su[i] + fit.b * sv[i] + fit.c;
    if (!(predicted > 1e-6)) return null;
    const error = 1 / predicted - 1 / sr[i];
    sumSq += error * error;
  }
  const flatnessMm = Math.sqrt(sumSq / su.length) * 1000;
  if (flatnessMm > PLATE_LIMITS.maxFlatnessMm) return null;

  // Is the candidate in that plane, or floating off it?
  const predictedAtPlate = fit.a * bcx + fit.b * bcy + fit.c;
  if (!(predictedAtPlate > 1e-6)) return null;
  const standoffMm = (1 / predictedAtPlate - plateDepth) * 1000;
  if (Math.abs(standoffMm) > PLATE_LIMITS.maxStandoffMm) return null;

  // Plane normal in camera space, straight from the fit coefficients:
  //   1/d = a*u + b*v + c  <=>  n = (a*fx, -b*fy, -(c + a*cx + b*cy))
  let normalCamera: Vec3 = {
    x: fit.a * fx,
    y: -fit.b * fy,
    z: -(fit.c + fit.a * cx + fit.b * cy),
  };
  const nLength = length3(normalCamera);
  if (!(nLength > 1e-9)) return null;
  normalCamera = scale3(normalCamera, 1 / nLength);
  // Point it back towards the camera — a surface we can see faces us.
  if (normalCamera.z < 0) normalCamera = scale3(normalCamera, -1);

  // Physical size, measured in CAPTURED-image pixels (far finer than the depth
  // map) at the plate's measured distance.
  const widthMm = ((detection.w * imageSize.width * plateDepth) / intrinsics.fx) * 1000;
  const heightMm = ((detection.h * imageSize.height * plateDepth) / intrinsics.fy) * 1000;
  if (Math.min(widthMm, heightMm) < PLATE_LIMITS.minSideMm) return null;
  if (Math.max(widthMm, heightMm) > PLATE_LIMITS.maxSideMm) return null;

  // Camera space -> world.
  const pointCamera: Vec3 = {
    x: ((bcx - cx) / fx) * plateDepth,
    y: (-(bcy - cy) / fy) * plateDepth,
    z: -plateDepth,
  };
  const world = transformPoint(cameraTransform, pointCamera);
  const normal = normalize3(rotateVector(cameraTransform, normalCamera));

  // A socket is on a VERTICAL surface. This is what stops the detector
  // labelling floors, worktops and the tops of boxes.
  if (Math.abs(normal.y) > PLATE_LIMITS.maxVerticalComponent) return null;

  return { world, normal, widthMm, heightMm, standoffMm, flatnessMm, rangeM: plateDepth };
}

// ---------------------------------------------------------------------------
// Multi-view confirmation
// ---------------------------------------------------------------------------

/**
 * Confirmation policy. A candidate is a hypothesis until it has been seen
 * several times from meaningfully DIFFERENT places, because that is the one
 * thing an artefact of light cannot fake: a highlight, a shadow edge or a
 * bright patch of drywall does not live at a fixed point in the room, so it
 * cannot be re-measured to the same world position from somewhere else.
 */
export const TRACK_POLICY = {
  /** Frames that must agree before a candidate is called a socket. */
  confirmHits: 3,
  /** …with the camera this far apart between the extremes (metres). */
  confirmBaselineM: 0.14,
  /** Unless simply seen this many times — a user standing still still gets it. */
  confirmHitsStatic: 7,
  /**
   * Detections within this of a track are the same socket. Tighter than the
   * ~200mm gap between two outlets side by side, so a double outlet stays two.
   */
  mergeM: 0.11,
  /** …and their normals must agree to this cosine, so a corner never merges. */
  mergeNormalDot: 0.72,
} as const;

export interface SocketTrack {
  id: number;
  world: Vec3;
  normal: Vec3;
  widthMm: number;
  heightMm: number;
  score: number;
  hits: number;
  baselineM: number;
  viewpoints: Vec3[];
  /**
   * Dark features counted in the CLOSEST view of this plate, with the plate size
   * that view had. Kept from the best look rather than averaged: slot counting
   * degrades with distance, so one good look settles what a run of distant ones
   * cannot.
   */
  bestFeatures: number;
  bestPlatePx: number;
  /**
   * Total weight of the looks averaged into `world`. Each look counts
   * 1/range²: a reading's error grows with distance, so a close look settles
   * the position and a distant one only nudges it. With a plain mean, one
   * far-off sighting could drag a confirmed marker off its socket.
   */
  weight: number;
  /** Pinned by hand. Detections corroborate it; they never move it. */
  manual?: boolean;
  /**
   * The number shown beside the marker, fixed the moment the track first
   * confirms (0 until then). Numbering by list position renumbered every later
   * socket whenever an earlier-created one confirmed late — labels hopping
   * from socket to socket mid-scan.
   */
  number: number;
}

/** Power outlet, data/switch plate, blank cover — or unknown if never seen close. */
export function trackKind(track: SocketTrack): PlateKind {
  return classifyPlate(track.bestFeatures, track.bestPlatePx);
}

/** Looks closer than this are weighted as if taken from here. */
const MIN_WEIGHT_RANGE_M = 0.3;

/** Inverse-variance weight of one look: its error grows with range. */
export function lookWeight(rangeM: number): number {
  return 1 / Math.max(rangeM, MIN_WEIGHT_RANGE_M) ** 2;
}

/** The track a sighting belongs to: the NEAREST that qualifies, not the first. */
function nearestTrack(tracks: SocketTrack[], world: Vec3, normal: Vec3): SocketTrack | undefined {
  let best: SocketTrack | undefined;
  let bestD = Infinity;
  for (const t of tracks) {
    const d = distance3(t.world, world);
    if (d < TRACK_POLICY.mergeM && dot3(t.normal, normal) > TRACK_POLICY.mergeNormalDot && d < bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

/** Give a track that has just confirmed the next free display number. */
function numberIfConfirmed(tracks: SocketTrack[], track: SocketTrack): void {
  if (track.number > 0 || !isConfirmed(track)) return;
  track.number = tracks.reduce((m, t) => Math.max(m, t.number), 0) + 1;
}

const nextId = (tracks: SocketTrack[]) => tracks.reduce((m, t) => Math.max(m, t.id), 0) + 1;

/** Fold one measured detection into a running set of tracks (mutates `tracks`). */
export function integrateSighting(
  tracks: SocketTrack[],
  geometry: PlateGeometry,
  detection: Pick<SocketDetection, 'score' | 'holes' | 'platePx'>,
  eye: Vec3,
): SocketTrack[] {
  // Nearest, so a sighting between two sockets side by side joins the one it
  // is actually on rather than whichever happened to be created first.
  const match = nearestTrack(tracks, geometry.world, geometry.normal);
  const w = lookWeight(geometry.rangeM);
  if (match) {
    // Weighted running mean (see `SocketTrack.weight`). A hand-placed pin is
    // where the person said it is, so a detection only corroborates it.
    if (!match.manual) {
      const W = match.weight;
      const k = 1 / (W + w);
      match.world = scale3(add3(scale3(match.world, W), scale3(geometry.world, w)), k);
      match.normal = normalize3(add3(scale3(match.normal, W), scale3(geometry.normal, w)));
      match.widthMm = (match.widthMm * W + geometry.widthMm * w) * k;
      match.heightMm = (match.heightMm * W + geometry.heightMm * w) * k;
      match.weight = W + w;
    }
    match.score = Math.max(match.score, detection.score);
    // Classification comes from the closest look, not the average.
    if (detection.platePx > match.bestPlatePx) {
      match.bestPlatePx = detection.platePx;
      match.bestFeatures = detection.holes;
    }
    match.hits += 1;
    if (match.viewpoints.length < 12) match.viewpoints.push(eye);
    match.baselineM = spread(match.viewpoints);
    numberIfConfirmed(tracks, match);
    return tracks;
  }
  tracks.push({
    id: nextId(tracks),
    world: geometry.world,
    normal: geometry.normal,
    widthMm: geometry.widthMm,
    heightMm: geometry.heightMm,
    score: detection.score,
    hits: 1,
    baselineM: 0,
    viewpoints: [eye],
    bestFeatures: detection.holes,
    bestPlatePx: detection.platePx,
    weight: w,
    number: 0,
  });
  return tracks;
}

/**
 * The user pointed at a socket. A track already there becomes theirs, at the
 * spot they chose; otherwise a new one starts. Either way it is confirmed and
 * numbered at once — a person saying "there" needs no corroboration.
 */
export function pinTrack(tracks: SocketTrack[], world: Vec3, normal: Vec3): SocketTrack {
  let track = nearestTrack(tracks, world, normal);
  if (track) {
    track.world = world;
    track.normal = normal;
    track.manual = true;
  } else {
    track = {
      id: nextId(tracks),
      world,
      normal,
      widthMm: 86,
      heightMm: 86,
      score: 1,
      hits: 1,
      baselineM: 0,
      viewpoints: [],
      bestFeatures: 0,
      bestPlatePx: 0,
      weight: 0,
      manual: true,
      number: 0,
    };
    tracks.push(track);
  }
  numberIfConfirmed(tracks, track);
  return track;
}

/** Seen often enough, from far enough apart, to be a thing in the room. */
export function isConfirmed(track: SocketTrack): boolean {
  if (track.manual) return true;
  return (
    track.hits >= TRACK_POLICY.confirmHits &&
    (track.baselineM >= TRACK_POLICY.confirmBaselineM ||
      track.hits >= TRACK_POLICY.confirmHitsStatic)
  );
}

/** Confirmed tracks in the order their numbers were given — stable as more confirm. */
export function confirmedTracks(tracks: SocketTrack[]): SocketTrack[] {
  return tracks.filter(isConfirmed).sort((a, b) => a.number - b.number);
}

/** Confidence for the placed fixture: corroboration first, image score second. */
export function trackConfidence(track: SocketTrack): number {
  const corroboration = Math.min(1, track.hits / 6);
  const parallax = Math.min(1, track.baselineM / 0.6);
  return Math.min(0.98, 0.45 * track.score + 0.35 * corroboration + 0.2 * parallax);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function medianDepth(
  depth: DepthFrame,
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
): number | null {
  const x0 = Math.max(0, Math.floor(cx - halfW));
  const x1 = Math.min(depth.width - 1, Math.ceil(cx + halfW));
  const y0 = Math.max(0, Math.floor(cy - halfH));
  const y1 = Math.min(depth.height - 1, Math.ceil(cy + halfH));
  if (x0 > x1 || y0 > y1) return null;
  const values: number[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = depth.depth[y * depth.width + x];
      if (d > 0) values.push(d);
    }
  }
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

/** Least-squares solve of r = a*u + b*v + c, by Cramer's rule on the normals. */
function solvePlane(
  u: number[],
  v: number[],
  r: number[],
): { a: number; b: number; c: number } | null {
  let suu = 0;
  let suv = 0;
  let svv = 0;
  let su = 0;
  let sv = 0;
  let sur = 0;
  let svr = 0;
  let sr = 0;
  const n = u.length;
  for (let i = 0; i < n; i++) {
    suu += u[i] * u[i];
    suv += u[i] * v[i];
    svv += v[i] * v[i];
    su += u[i];
    sv += v[i];
    sur += u[i] * r[i];
    svr += v[i] * r[i];
    sr += r[i];
  }
  const m = [
    [suu, suv, su],
    [suv, svv, sv],
    [su, sv, n],
  ];
  const det = det3(m);
  // Samples spread over a 2D patch give a well-conditioned system; a degenerate
  // one (all collinear) does not, and must not be trusted.
  if (Math.abs(det) < 1e-9) return null;
  const rhs = [sur, svr, sr];
  const a = det3(replaceColumn(m, 0, rhs)) / det;
  const b = det3(replaceColumn(m, 1, rhs)) / det;
  const c = det3(replaceColumn(m, 2, rhs)) / det;
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return null;
  return { a, b, c };
}

function replaceColumn(m: number[][], col: number, values: number[]): number[][] {
  return m.map((row, i) => row.map((value, j) => (j === col ? values[i] : value)));
}

function det3(m: number[][]): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}

/** Widest separation within a set of camera positions. */
function spread(points: Vec3[]): number {
  let best = 0;
  for (let i = 0; i < points.length - 1; i++) {
    for (let j = i + 1; j < points.length; j++) {
      best = Math.max(best, distance3(points[i], points[j]));
    }
  }
  return best;
}

/** Column-major 4x4 applied to a point. */
export function transformPoint(t: CameraTransform, p: Vec3): Vec3 {
  return {
    x: t[0] * p.x + t[4] * p.y + t[8] * p.z + t[12],
    y: t[1] * p.x + t[5] * p.y + t[9] * p.z + t[13],
    z: t[2] * p.x + t[6] * p.y + t[10] * p.z + t[14],
  };
}

/** Column-major 4x4 applied to a direction (no translation). */
export function rotateVector(t: CameraTransform, v: Vec3): Vec3 {
  return {
    x: t[0] * v.x + t[4] * v.y + t[8] * v.z,
    y: t[1] * v.x + t[5] * v.y + t[9] * v.z,
    z: t[2] * v.x + t[6] * v.y + t[10] * v.z,
  };
}

const add3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale3 = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const length3 = (a: Vec3): number => Math.sqrt(dot3(a, a));
const distance3 = (a: Vec3, b: Vec3): number =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function normalize3(a: Vec3): Vec3 {
  const l = length3(a);
  return l > 1e-9 ? scale3(a, 1 / l) : { x: 0, y: 0, z: 0 };
}
