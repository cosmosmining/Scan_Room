import { apparentWidthToMm, classifyPipe } from '@mozu/scan-sdk';
import type { FixtureType, Vec3, Wall, WallFixture } from '@/lib/types';
import { detectSockets, heuristicSocketDetector } from './fixtureDetector';
import type { DetectorImage, DetectorOptions, SocketDetection, SocketDetector } from './fixtureDetector';
import { heuristicPipeDetector } from './pipeDetector';
import type { PipeDetection, PipeDetector } from './pipeDetector';

/**
 * Turn an in-frame socket detection into a position on a wall — the geometry half
 * of "scan the sockets on the wall". A detector says "there's a socket here in the
 * image"; this casts that image point out through the camera and onto the scanned
 * walls to get {which wall, how far along it, how high}, i.e. a {@link WallFixture}.
 *
 * Pure math (pinhole camera + ray/plane intersection) so it unit-tests without a
 * device. Coordinates are the scan's millimetre world space, Y up.
 */

// ── minimal Vec3 helpers ──
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const addv = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const mul = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

/** Pinhole camera pose for a captured frame (world space, mm; angles in radians). */
export interface PinholeCamera {
  position: Vec3;
  forward: Vec3; // viewing direction (need not be unit)
  up: Vec3; // approximate up (need not be exactly orthogonal)
  fovY: number; // vertical field of view
  aspect: number; // width / height
}

/** A captured frame: the pixels plus the pose they were taken from. */
export interface CameraFrame {
  image: DetectorImage;
  camera: PinholeCamera;
}

export interface WallHit {
  wallId: string;
  offset: number; // mm along the wall from its start
  height: number; // mm off the floor
  /**
   * Distance from the camera to the point on the wall (mm). This is what turns
   * an apparent size in pixels into a real millimetre size — the basis for
   * measuring a pipe's bore and therefore classifying it.
   */
  distanceMm: number;
}

/**
 * Cast the ray through a normalised image point and return the nearest wall it
 * lands on (within the wall's extent), or null if it misses every wall.
 */
export function projectDetectionToWall(
  det: Pick<SocketDetection, 'cx' | 'cy'>,
  cam: PinholeCamera,
  walls: Wall[],
  roomHeight: number,
): WallHit | null {
  const f = norm(cam.forward);
  const right = norm(cross(f, cam.up));
  const trueUp = cross(right, f); // orthonormal
  const ndcX = det.cx * 2 - 1;
  const ndcY = 1 - det.cy * 2; // image y grows downward
  const tanY = Math.tan(cam.fovY / 2);
  const tanX = tanY * cam.aspect;
  const dir = norm(addv(addv(f, mul(right, ndcX * tanX)), mul(trueUp, ndcY * tanY)));

  let best: (WallHit & { t: number }) | null = null;
  for (const wall of walls) {
    const wd = norm({ x: wall.end.x - wall.start.x, y: 0, z: wall.end.z - wall.start.z });
    const len = Math.hypot(wall.end.x - wall.start.x, wall.end.z - wall.start.z);
    const n: Vec3 = { x: wd.z, y: 0, z: -wd.x }; // horizontal wall normal
    const denom = dot(dir, n);
    if (Math.abs(denom) < 1e-6) continue; // ray parallel to wall
    const t = dot(sub(wall.start, cam.position), n) / denom;
    if (t <= 0) continue; // behind the camera
    const p = addv(cam.position, mul(dir, t));
    const offset = (p.x - wall.start.x) * wd.x + (p.z - wall.start.z) * wd.z;
    const H = wall.height || roomHeight;
    if (offset < -50 || offset > len + 50) continue; // beyond the wall ends
    if (p.y < -50 || p.y > H + 50) continue; // above / below the wall
    if (!best || t < best.t) {
      best = {
        t,
        wallId: wall.id,
        offset: Math.max(0, Math.min(len, offset)),
        height: Math.max(0, p.y),
        distanceMm: t,
      };
    }
  }
  return best
    ? { wallId: best.wallId, offset: best.offset, height: best.height, distanceMm: best.distanceMm }
    : null;
}

/** A detected fixture tagged with the wall it belongs to (pre-attachment). */
export interface DetectedFixture {
  wallId: string;
  fixture: WallFixture;
}

/** @deprecated Sockets are one fixture kind — use {@link DetectedFixture}. */
export type DetectedSocket = DetectedFixture;

export interface DetectFixturesOptions {
  /** Socket detector. Defaults to the built-in heuristic. */
  detector?: SocketDetector;
  /** Pipe detector. Defaults to the built-in heuristic; pass null to skip pipes. */
  pipeDetector?: PipeDetector | null;
  detectorOptions?: DetectorOptions;
  /** Detections on the same wall within this distance are the same fixture (mm). */
  mergeMm?: number;
}

/** One projected observation before merging. */
interface Observation extends WallHit {
  type: FixtureType;
  score: number;
  diameterMm?: number;
  reason?: string;
}

/**
 * Measure a pipe detection and decide which service it is.
 *
 * The detector reports the pipe's apparent bore in pixels; the ray-cast gives
 * the distance to the wall it sits on. Together those yield a real diameter in
 * millimetres, and diameter (plus a colour/geometry cue in the small-bore
 * overlap) is what separates waste from water from gas.
 */
function measurePipe(
  det: PipeDetection,
  frame: CameraFrame,
  hit: WallHit,
): { type: FixtureType; diameterMm: number; reason: string; confidence: number } | null {
  const diameterMm = apparentWidthToMm(
    det.widthPx,
    hit.distanceMm,
    frame.camera.fovY,
    frame.image.width,
    frame.image.height,
  );
  // Real-world plausibility gate. Sizing the run in millimetres is what finally
  // separates pipework from the other long straight things on a wall: a cable
  // or a grout line comes out too thin, a door architrave or skirting board too
  // fat. Anything outside domestic pipe bores is not a pipe.
  if (diameterMm < MIN_PIPE_MM || diameterMm > MAX_PIPE_MM) return null;

  const call = classifyPipe(diameterMm, {
    heightMm: hit.height,
    vertical: det.vertical,
    yellowness: det.yellowness,
  });
  return {
    type: call.type,
    diameterMm,
    reason: call.reason,
    // The pipe has to be seen well AND classified confidently.
    confidence: det.score * call.confidence,
  };
}

/** Thinner than this is a cable or a line, not a pipe (mm). */
const MIN_PIPE_MM = 8;
/** Fatter than this is architrave / skirting / trunking, not a pipe (mm). */
const MAX_PIPE_MM = 130;

/**
 * Run the detectors over every captured frame, project each hit onto a wall,
 * measure and label it, then merge repeats (the same fixture seen from several
 * frames) into one confident fixture.
 *
 * This is the engine behind `LidarScanner`'s fixture pass: give it frames and
 * it returns labelled sockets and pipes ready to attach to the walls. Manual
 * entry exists only to correct what this produced — it is never required.
 */
export function detectWallFixtures(
  frames: CameraFrame[],
  walls: Wall[],
  roomHeight: number,
  opts: DetectFixturesOptions = {},
): DetectedFixture[] {
  const socketDetector = opts.detector ?? heuristicSocketDetector;
  const pipeDetector = opts.pipeDetector === null ? null : (opts.pipeDetector ?? heuristicPipeDetector);
  const mergeMm = opts.mergeMm ?? 200;

  const raw: Observation[] = [];
  for (const frame of frames) {
    for (const d of socketDetector.detect(frame.image, opts.detectorOptions)) {
      const hit = projectDetectionToWall(d, frame.camera, walls, roomHeight);
      if (hit) raw.push({ ...hit, type: 'socket', score: d.score });
    }
    if (!pipeDetector) continue;
    for (const d of pipeDetector.detect(frame.image, opts.detectorOptions)) {
      const hit = projectDetectionToWall(d, frame.camera, walls, roomHeight);
      if (!hit) continue;
      const m = measurePipe(d, frame, hit);
      if (!m) continue; // sized out of the domestic pipe range → not pipework
      raw.push({
        ...hit,
        type: m.type,
        score: m.confidence,
        diameterMm: m.diameterMm,
        reason: m.reason,
      });
    }
  }

  const merged: Array<Observation & { hits: number }> = [];
  for (const r of raw) {
    const m = merged.find(
      (x) =>
        x.wallId === r.wallId &&
        x.type === r.type &&
        Math.abs(x.offset - r.offset) < mergeMm &&
        Math.abs(x.height - r.height) < mergeMm,
    );
    if (m) {
      m.hits += 1;
      m.offset = (m.offset * (m.hits - 1) + r.offset) / m.hits;
      m.height = (m.height * (m.hits - 1) + r.height) / m.hits;
      if (r.diameterMm !== undefined) {
        m.diameterMm =
          m.diameterMm === undefined
            ? r.diameterMm
            : (m.diameterMm * (m.hits - 1) + r.diameterMm) / m.hits;
      }
      m.score = Math.max(m.score, r.score);
    } else {
      merged.push({ ...r, hits: 1 });
    }
  }

  return merged.map((m, i) => ({
    wallId: m.wallId,
    fixture: {
      id: `fix_${i}`,
      type: m.type,
      offset: Math.round(m.offset),
      height: Math.round(m.height),
      source: 'detected' as const,
      // More frames agreeing → more confident, capped below 1.
      confidence: Math.min(0.98, m.score * (0.6 + 0.15 * m.hits)),
      ...(m.diameterMm !== undefined ? { diameterMm: Math.round(m.diameterMm) } : {}),
      ...(m.reason ? { reason: m.reason } : {}),
    },
  }));
}

/**
 * Sockets only — the original entry point, kept for callers that just want
 * electrical. Prefer {@link detectWallFixtures}, which also finds pipework.
 */
export function detectWallSockets(
  frames: CameraFrame[],
  walls: Wall[],
  roomHeight: number,
  opts: DetectFixturesOptions = {},
): DetectedFixture[] {
  return detectWallFixtures(frames, walls, roomHeight, { ...opts, pipeDetector: null });
}

/** Attach detected fixtures to their walls, returning a new walls array. */
export function assignFixturesToWalls(walls: Wall[], detected: DetectedFixture[]): Wall[] {
  return walls.map((w) => {
    const mine = detected.filter((d) => d.wallId === w.id).map((d) => d.fixture);
    return mine.length ? { ...w, fixtures: [...(w.fixtures ?? []), ...mine] } : w;
  });
}

export { detectSockets };
