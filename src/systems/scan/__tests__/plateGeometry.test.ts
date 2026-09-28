import { describe, expect, it } from 'vitest';
import {
  measurePlate,
  integrateSighting,
  pinTrack,
  confirmedTracks,
  trackConfidence,
  trackKind,
  type DepthFrame,
  type PlateGeometry,
  type PlateIntrinsics,
  type SocketTrack,
  type Vec3,
} from '../plateGeometry';
import { classifyPlate, RESOLVABLE_PLATE_PX, type SocketDetection } from '../fixtureDetector';

// ---------------------------------------------------------------------------
// A synthetic room: one wall, one camera, one LiDAR depth map.
//
// Every number the detector is trusted to produce — the socket's world
// position, the wall's normal, the plate's size in millimetres — is checked
// against a ground truth we chose, from a camera that is neither at the origin
// nor square to the wall. A sign error anywhere in the unprojection would put
// the socket somewhere else in the room, which is exactly the failure this is
// here to catch.
// ---------------------------------------------------------------------------

const IMAGE = { width: 1920, height: 1440 };
const INTRINSICS: PlateIntrinsics = { fx: 1450, fy: 1450, cx: 960, cy: 720 };
const DEPTH_W = 256;
const DEPTH_H = 192;

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** ARKit-style column-major pose: yaw about Y, then translate. */
function pose(yaw: number, at: Vec3): number[] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // Columns: right, up, backward (camera looks down -Z), position.
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, at.x, at.y, at.z, 1];
}

/** World vector -> camera space (the pose's rotation, transposed). */
function toCamera(t: number[], world: Vec3): Vec3 {
  const d = sub(world, { x: t[12], y: t[13], z: t[14] });
  return {
    x: t[0] * d.x + t[1] * d.y + t[2] * d.z,
    y: t[4] * d.x + t[5] * d.y + t[6] * d.z,
    z: t[8] * d.x + t[9] * d.y + t[10] * d.z,
  };
}

/** Camera-space ray direction for a depth-map pixel (z = -1, so t IS depth). */
function rayFor(x: number, y: number): Vec3 {
  const sx = DEPTH_W / IMAGE.width;
  const sy = DEPTH_H / IMAGE.height;
  const fx = INTRINSICS.fx * sx;
  const fy = INTRINSICS.fy * sy;
  const cx = INTRINSICS.cx * sx;
  const cy = INTRINSICS.cy * sy;
  return { x: (x - cx) / fx, y: -(y - cy) / fy, z: -1 };
}

function rotate(t: number[], v: Vec3): Vec3 {
  return {
    x: t[0] * v.x + t[4] * v.y + t[8] * v.z,
    y: t[1] * v.x + t[5] * v.y + t[9] * v.z,
    z: t[2] * v.x + t[6] * v.y + t[10] * v.z,
  };
}

interface Plane {
  point: Vec3;
  normal: Vec3;
}

/**
 * Render the depth map a LiDAR would return for a camera looking at one plane,
 * optionally with a second, nearer plane occluding part of the view.
 */
function renderDepth(t: number[], wall: Plane, occluder?: { plane: Plane; box: [number, number, number, number] }): DepthFrame {
  const depth = new Float32Array(DEPTH_W * DEPTH_H);
  const eye: Vec3 = { x: t[12], y: t[13], z: t[14] };
  for (let y = 0; y < DEPTH_H; y++) {
    for (let x = 0; x < DEPTH_W; x++) {
      const dir = rotate(t, rayFor(x, y));
      const surface =
        occluder && x >= occluder.box[0] && x <= occluder.box[2] && y >= occluder.box[1] && y <= occluder.box[3]
          ? occluder.plane
          : wall;
      const denominator = dot(surface.normal, dir);
      if (Math.abs(denominator) < 1e-9) continue;
      const k = dot(surface.normal, sub(surface.point, eye)) / denominator;
      if (k <= 0) continue;
      depth[y * DEPTH_W + x] = k;
    }
  }
  return { depth, width: DEPTH_W, height: DEPTH_H };
}

/** Make a detection box for a plate of a known metric size at a known place. */
function detectionFor(
  t: number[],
  centre: Vec3,
  sizeMm: { w: number; h: number },
  score = 0.8,
): SocketDetection {
  const local = toCamera(t, centre);
  const d = -local.z;
  const u = INTRINSICS.cx + (INTRINSICS.fx * local.x) / d;
  const v = INTRINSICS.cy - (INTRINSICS.fy * local.y) / d;
  return {
    cx: u / IMAGE.width,
    cy: v / IMAGE.height,
    w: (sizeMm.w / 1000 / d) * INTRINSICS.fx / IMAGE.width,
    h: (sizeMm.h / 1000 / d) * INTRINSICS.fy / IMAGE.height,
    score,
    holes: 2,
    platePx: (sizeMm.w / 1000 / d) * INTRINSICS.fx * (DEPTH_W / IMAGE.width),
  };
}

/** Push the depth nearer inside a box, the way a plate stands proud of a wall. */
function raiseBox(frame: DepthFrame, detection: SocketDetection, byM: number): DepthFrame {
  const depth = Float32Array.from(frame.depth);
  const bcx = detection.cx * frame.width;
  const bcy = detection.cy * frame.height;
  const bw = (detection.w * frame.width) / 2;
  const bh = (detection.h * frame.height) / 2;
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      if (Math.abs(x - bcx) > bw || Math.abs(y - bcy) > bh) continue;
      const i = y * frame.width + x;
      if (depth[i] > 0) depth[i] -= byM;
    }
  }
  return { depth, width: frame.width, height: frame.height };
}

// A wall that is neither axis-aligned nor square to the camera.
const WALL_TILT = 0.15;
const WALL: Plane = {
  point: { x: 0, y: 1.2, z: -1.0 },
  normal: { x: Math.sin(WALL_TILT), y: 0, z: Math.cos(WALL_TILT) },
};
/** In-plane axes of that wall. */
const ALONG: Vec3 = { x: Math.cos(WALL_TILT), y: 0, z: -Math.sin(WALL_TILT) };
const UP: Vec3 = { x: 0, y: 1, z: 0 };
/** A socket 300mm along the wall and 100mm above the reference point. */
const SOCKET = add(add(WALL.point, scale(ALONG, 0.3)), scale(UP, 0.1));

const CAMERA = pose(0.25, { x: 0.4, y: 1.45, z: 1.2 });
const PLATE = { w: 86, h: 146 };

describe('depth gate: measuring a plate', () => {
  it('recovers the socket world position from an oblique view', () => {
    const detection = detectionFor(CAMERA, SOCKET, PLATE);
    const depth = raiseBox(renderDepth(CAMERA, WALL), detection, 0.006);
    const measured = measurePlate(detection, depth, INTRINSICS, IMAGE, CAMERA);

    expect(measured).not.toBeNull();
    // Within 15mm of ground truth, from 2.2m away through a 256x192 depth map.
    expect(dist(measured!.world, SOCKET)).toBeLessThan(0.015);
  });

  it('recovers the wall normal, pointing into the room', () => {
    const detection = detectionFor(CAMERA, SOCKET, PLATE);
    const depth = renderDepth(CAMERA, WALL);
    const measured = measurePlate(detection, depth, INTRINSICS, IMAGE, CAMERA)!;

    expect(measured).not.toBeNull();
    // Within ~3 degrees of the true wall normal.
    expect(dot(measured.normal, WALL.normal)).toBeGreaterThan(0.998);
    expect(Math.abs(measured.normal.y)).toBeLessThan(0.02);
  });

  it('measures the plate in millimetres', () => {
    const detection = detectionFor(CAMERA, SOCKET, PLATE);
    const depth = renderDepth(CAMERA, WALL);
    const measured = measurePlate(detection, depth, INTRINSICS, IMAGE, CAMERA)!;

    expect(measured.widthMm).toBeGreaterThan(80);
    expect(measured.widthMm).toBeLessThan(93);
    expect(measured.heightMm).toBeGreaterThan(138);
    expect(measured.heightMm).toBeLessThan(155);
    expect(Math.abs(measured.standoffMm)).toBeLessThan(20);
    expect(measured.flatnessMm).toBeLessThan(5);
  });

  it('sees the plate proud of the wall rather than sunk into it', () => {
    const detection = detectionFor(CAMERA, SOCKET, PLATE);
    const depth = raiseBox(renderDepth(CAMERA, WALL), detection, 0.02);
    const measured = measurePlate(detection, depth, INTRINSICS, IMAGE, CAMERA)!;
    expect(measured.standoffMm).toBeGreaterThan(10);
  });
});

describe('depth gate: what it refuses', () => {
  it('rejects a poster-sized bright rectangle on the same wall', () => {
    // The image stage cannot tell 800mm from 90mm; the depth stage can.
    const detection = detectionFor(CAMERA, SOCKET, { w: 800, h: 600 });
    const depth = renderDepth(CAMERA, WALL);
    expect(measurePlate(detection, depth, INTRINSICS, IMAGE, CAMERA)).toBeNull();
  });

  it('rejects a plate-sized mark that is too small to be a faceplate', () => {
    const detection = detectionFor(CAMERA, SOCKET, { w: 20, h: 25 });
    const depth = renderDepth(CAMERA, WALL);
    expect(measurePlate(detection, depth, INTRINSICS, IMAGE, CAMERA)).toBeNull();
  });

  it('rejects something floating a metre in front of the wall', () => {
    // The bottle-on-a-dresser case: right size, right brightness, not on a wall.
    const detection = detectionFor(CAMERA, SOCKET, PLATE);
    const depth = raiseBox(renderDepth(CAMERA, WALL), detection, 0.9);
    expect(measurePlate(detection, depth, INTRINSICS, IMAGE, CAMERA)).toBeNull();
  });

  it('rejects a candidate lying on a horizontal surface', () => {
    // A worktop or the top of a box: flat, plate-sized, but not a wall.
    const floor: Plane = { point: { x: 0, y: 0.2, z: -0.6 }, normal: { x: 0, y: 1, z: 0 } };
    const looking = pose(0, { x: 0, y: 1.5, z: 0.2 });
    const target: Vec3 = { x: 0, y: 0.2, z: -0.6 };
    const detection = detectionFor(looking, target, PLATE);
    const depth = renderDepth(looking, floor);
    expect(measurePlate(detection, depth, INTRINSICS, IMAGE, looking)).toBeNull();
  });

  it('rejects a candidate straddling a depth cliff', () => {
    // The mid-air box near a corner: the "wall" around it is not one surface.
    const detection = detectionFor(CAMERA, SOCKET, PLATE);
    const base = renderDepth(CAMERA, WALL);
    const bcx = Math.round(detection.cx * DEPTH_W);
    const bcy = Math.round(detection.cy * DEPTH_H);
    const depth = Float32Array.from(base.depth);
    // Everything to the right of the candidate is a far-off surface.
    for (let y = 0; y < DEPTH_H; y++) {
      for (let x = bcx + 2; x < DEPTH_W; x++) {
        if (y > bcy - 40 && y < bcy + 40) depth[y * DEPTH_W + x] = base.depth[y * DEPTH_W + x] + 0.45;
      }
    }
    expect(
      measurePlate(detection, { depth, width: DEPTH_W, height: DEPTH_H }, INTRINSICS, IMAGE, CAMERA),
    ).toBeNull();
  });

  it('rejects a reading with no depth at all', () => {
    const detection = detectionFor(CAMERA, SOCKET, PLATE);
    const empty: DepthFrame = {
      depth: new Float32Array(DEPTH_W * DEPTH_H),
      width: DEPTH_W,
      height: DEPTH_H,
    };
    expect(measurePlate(detection, empty, INTRINSICS, IMAGE, CAMERA)).toBeNull();
  });
});

describe('multi-view confirmation', () => {
  /** Walk past the socket, measuring it from each stop. */
  function walkPast(): SocketTrack[] {
    const tracks: SocketTrack[] = [];
    for (const [i, x] of [0.0, 0.25, 0.5, 0.75].entries()) {
      const camera = pose(0.25 - i * 0.06, { x: 0.1 + x, y: 1.45, z: 1.2 });
      const detection = detectionFor(camera, SOCKET, PLATE);
      const depth = renderDepth(camera, WALL);
      const measured = measurePlate(detection, depth, INTRINSICS, IMAGE, camera);
      if (!measured) continue;
      integrateSighting(tracks, measured, detection, {
        x: camera[12],
        y: camera[13],
        z: camera[14],
      });
    }
    return tracks;
  }

  it('confirms one socket seen from four positions, at the right place', () => {
    const tracks = walkPast();
    const confirmed = confirmedTracks(tracks);
    expect(confirmed).toHaveLength(1);
    expect(dist(confirmed[0].world, SOCKET)).toBeLessThan(0.02);
    expect(confirmed[0].hits).toBe(4);
    expect(confirmed[0].baselineM).toBeGreaterThan(0.5);
    expect(trackConfidence(confirmed[0])).toBeGreaterThan(0.6);
  });

  it('never confirms a phantom that lands somewhere new every frame', () => {
    // This is what a shadow edge or a bright scuff actually does: it passes the
    // image test again and again, but it is not a point in the room, so it does
    // not re-measure to the same place — and never accumulates a track.
    const tracks: SocketTrack[] = [];
    for (let i = 0; i < 8; i++) {
      const camera = pose(0.25 - i * 0.02, { x: 0.1 + i * 0.12, y: 1.45, z: 1.2 });
      const drifting = add(SOCKET, scale(ALONG, i * 0.35));
      const detection = detectionFor(camera, drifting, PLATE);
      const depth = renderDepth(camera, WALL);
      const measured = measurePlate(detection, depth, INTRINSICS, IMAGE, camera);
      if (!measured) continue;
      integrateSighting(tracks, measured, detection, {
        x: camera[12],
        y: camera[13],
        z: camera[14],
      });
    }
    expect(confirmedTracks(tracks)).toHaveLength(0);
  });

  it('keeps two sockets 250mm apart as two sockets', () => {
    const second = add(SOCKET, scale(ALONG, 0.25));
    const tracks: SocketTrack[] = [];
    for (let i = 0; i < 4; i++) {
      const camera = pose(0.25 - i * 0.05, { x: 0.1 + i * 0.22, y: 1.45, z: 1.2 });
      const depth = renderDepth(camera, WALL);
      for (const target of [SOCKET, second]) {
        const detection = detectionFor(camera, target, PLATE);
        const measured = measurePlate(detection, depth, INTRINSICS, IMAGE, camera);
        if (!measured) continue;
        integrateSighting(tracks, measured, detection, {
          x: camera[12],
          y: camera[13],
          z: camera[14],
        });
      }
    }
    expect(confirmedTracks(tracks)).toHaveLength(2);
  });

  it('holds a single glimpse back as unconfirmed', () => {
    const camera = pose(0.25, { x: 0.4, y: 1.45, z: 1.2 });
    const detection = detectionFor(camera, SOCKET, PLATE);
    const depth = renderDepth(camera, WALL);
    const measured = measurePlate(detection, depth, INTRINSICS, IMAGE, camera)!;
    const tracks: SocketTrack[] = [];
    integrateSighting(tracks, measured, detection, { x: camera[12], y: camera[13], z: camera[14] });
    expect(tracks).toHaveLength(1);
    expect(confirmedTracks(tracks)).toHaveLength(0);
  });
});

describe('telling a power outlet from a data plate', () => {
  it('calls three or more features a power outlet', () => {
    expect(classifyPlate(3, 80)).toBe('power');
    expect(classifyPlate(6, 80)).toBe('power');
  });

  it('calls one or two features a data / switch plate', () => {
    // A coax barrel or an RJ45 gate is a single dark feature; a rocker seam is
    // one too. This is what stops a coax plate claiming to be a power socket.
    expect(classifyPlate(1, 80)).toBe('data');
    expect(classifyPlate(2, 80)).toBe('data');
  });

  it('calls a featureless plate blank', () => {
    expect(classifyPlate(0, 80)).toBe('blank');
  });

  it('refuses to classify a plate too small for the slots to resolve', () => {
    // At range the slots are sub-pixel, so a count of 1 means nothing. Guessing
    // "data" here would silently downgrade a real outlet.
    expect(classifyPlate(1, RESOLVABLE_PLATE_PX - 1)).toBe('unknown');
    expect(classifyPlate(0, 12)).toBe('unknown');
  });

  it('classifies a track from its closest look, not its average', () => {
    const tracks: SocketTrack[] = [];
    const camera = pose(0.25, { x: 0.4, y: 1.45, z: 1.2 });
    const detection = detectionFor(camera, SOCKET, PLATE);
    const depth = renderDepth(camera, WALL);
    const measured = measurePlate(detection, depth, INTRINSICS, IMAGE, camera)!;

    // A distant, feature-poor look first...
    integrateSighting(tracks, measured, { score: 0.6, holes: 0, platePx: 14 }, {
      x: camera[12], y: camera[13], z: camera[14],
    });
    expect(trackKind(tracks[0])).toBe('unknown');

    // ...then a close one that can actually count the slots.
    integrateSighting(tracks, measured, { score: 0.9, holes: 3, platePx: 90 }, {
      x: camera[12], y: camera[13], z: camera[14],
    });
    expect(trackKind(tracks[0])).toBe('power');

    // A later distant look must not undo it.
    integrateSighting(tracks, measured, { score: 0.5, holes: 0, platePx: 10 }, {
      x: camera[12], y: camera[13], z: camera[14],
    });
    expect(trackKind(tracks[0])).toBe('power');
  });
});

describe('a plane fit is only as good as the patch it agreed with', () => {
  it('rejects a candidate at a depth cliff the outlier filter would have hidden', () => {
    // The subtle case. A NEAR cliff (+450mm) drags the fit and fails flatness,
    // which the earlier test covers. A FAR one (+1.5m) is removed wholesale by
    // the same-surface filter, leaving a spotless near-side plane that fits
    // beautifully and describes half a wall. Requiring the survivors to be a
    // majority of the readings is what catches it.
    const detection = detectionFor(CAMERA, SOCKET, PLATE);
    const base = renderDepth(CAMERA, WALL);
    const bcx = Math.round(detection.cx * DEPTH_W);
    const depth = Float32Array.from(base.depth);
    for (let y = 0; y < DEPTH_H; y++) {
      for (let x = bcx + 2; x < DEPTH_W; x++) {
        depth[y * DEPTH_W + x] = base.depth[y * DEPTH_W + x] + 1.5;
      }
    }
    expect(
      measurePlate(detection, { depth, width: DEPTH_W, height: DEPTH_H }, INTRINSICS, IMAGE, CAMERA),
    ).toBeNull();
  });
});

describe('markers that hold still (field report: "跑來跑去")', () => {
  const WALL_NORMAL: Vec3 = { x: 0, y: 0, z: 1 };
  const look = (world: Vec3, rangeM: number): PlateGeometry => ({
    world,
    normal: WALL_NORMAL,
    widthMm: 86,
    heightMm: 86,
    standoffMm: 5,
    flatnessMm: 2,
    rangeM,
  });
  const seen = { score: 0.8, holes: 2, platePx: 60 };
  const at = (x: number): Vec3 => ({ x, y: 1.1, z: 0 });

  it('lets a close look settle the position and a distant one only nudge it', () => {
    const tracks: SocketTrack[] = [];
    // Three close looks put it at x = 0…
    for (const e of [-0.2, 0, 0.2]) integrateSighting(tracks, look(at(0), 0.6), seen, { x: e, y: 1.4, z: 0.6 });
    // …then one look from across the room lands 8 cm off.
    integrateSighting(tracks, look(at(0.08), 3.5), seen, { x: 0, y: 1.4, z: 3.5 });
    expect(tracks).toHaveLength(1);
    // An unweighted mean would have moved it 2 cm; the far look barely counts.
    expect(Math.abs(tracks[0].world.x)).toBeLessThan(0.002);
  });

  it('gives a sighting between two sockets to the NEARER one', () => {
    const tracks: SocketTrack[] = [];
    integrateSighting(tracks, look(at(0), 0.8), seen, { x: 0, y: 1.4, z: 0.8 });
    integrateSighting(tracks, look(at(0.15), 0.8), seen, { x: 0.15, y: 1.4, z: 0.8 });
    expect(tracks).toHaveLength(2);
    // 0.10 from the first (inside the merge radius), 0.05 from the second.
    integrateSighting(tracks, look(at(0.1), 0.8), seen, { x: 0.1, y: 1.4, z: 0.8 });
    expect(tracks[0].hits).toBe(1);
    expect(tracks[1].hits).toBe(2);
  });

  it('never moves a socket the user pinned by hand', () => {
    const tracks: SocketTrack[] = [];
    const pinned = pinTrack(tracks, at(0.02), WALL_NORMAL);
    for (let i = 0; i < 5; i++) integrateSighting(tracks, look(at(0.07), 1.0), seen, { x: i * 0.1, y: 1.4, z: 1 });
    expect(tracks).toHaveLength(1);
    expect(pinned.world.x).toBeCloseTo(0.02, 9);
    expect(pinned.hits).toBe(6);
    expect(confirmedTracks(tracks)).toEqual([pinned]);
  });

  it('keeps each marker’s number when an earlier-seen socket confirms late', () => {
    const tracks: SocketTrack[] = [];
    // A is glimpsed first but only once; B is walked past and confirms.
    integrateSighting(tracks, look(at(0), 1), seen, { x: 0, y: 1.4, z: 1 });
    for (const e of [0, 0.1, 0.2]) integrateSighting(tracks, look(at(0.6), 1), seen, { x: 0.6 + e, y: 1.4, z: 1 });
    const b = tracks[1];
    expect(b.number).toBe(1);
    // Now A confirms. Numbered by list position, B would become "2".
    for (const e of [0.1, 0.2]) integrateSighting(tracks, look(at(0), 1), seen, { x: e, y: 1.4, z: 1 });
    expect(b.number).toBe(1);
    expect(tracks[0].number).toBe(2);
    expect(confirmedTracks(tracks).map((t) => t.number)).toEqual([1, 2]);
  });

  it('numbers a pinned socket straight away', () => {
    const tracks: SocketTrack[] = [];
    expect(pinTrack(tracks, at(0), WALL_NORMAL).number).toBe(1);
    expect(pinTrack(tracks, at(0.5), WALL_NORMAL).number).toBe(2);
    // Pinning onto an existing marker keeps its number.
    expect(pinTrack(tracks, at(0.52), WALL_NORMAL).number).toBe(2);
    expect(tracks).toHaveLength(2);
  });
});
