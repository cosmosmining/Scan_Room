import { manualDimensionsToRoomGeometry } from './geometry';
import {
  assignFixturesToWalls,
  detectWallFixtures,
  type CameraFrame,
} from './fixtureProjection';
import {
  createScanAccumulator,
  type PlaneObservation,
} from './lidarSession';
import type {
  RoomGeometry,
  ScanOptions,
  ScannerCapabilities,
  SpaceScanner,
} from './types';

/**
 * Depth-sensor room scanner (Apple RoomPlan-class / WebXR depth). Detects wall
 * geometry automatically and feeds the live {@link createScanAccumulator} so the
 * capture UI can light up boundary edges and grow the box massing in real time.
 *
 * `isAvailable()` feature-detects an immersive-AR session with depth-sensing or
 * plane-detection; on a phone without LiDAR it returns false and the registry
 * falls through to lighter providers (and the UI offers the no-sensor replay
 * walkthrough instead — so the experience still works, just less precise).
 */
const LIDAR_CAPABILITIES: ScannerCapabilities = {
  inBrowser: true,
  detectsGeometry: true,
  detectsOpenings: false,
  detectsFixtures: true,
  typicalErrorMm: 30,
  requiresDepthSensor: true,
};

type AnyXR = { isSessionSupported?: (mode: string) => Promise<boolean> };
const getXR = (): AnyXR | undefined =>
  typeof navigator !== 'undefined'
    ? (navigator as unknown as { xr?: AnyXR }).xr
    : undefined;

export class LidarScanner implements SpaceScanner {
  readonly id = 'webxr-depth' as const;
  readonly capabilities = LIDAR_CAPABILITIES;

  async isAvailable(): Promise<boolean> {
    try {
      const xr = getXR();
      if (!xr?.isSessionSupported) return false;
      // immersive-ar is the gate; depth/plane features are requested at scan time.
      return (await xr.isSessionSupported('immersive-ar')) ?? false;
    } catch {
      return false;
    }
  }

  /**
   * Run a depth capture. Walks the room's wall planes through the accumulator,
   * reporting live progress, and resolves the closed {@link RoomGeometry}.
   *
   * The interactive WebXR/RoomPlan bridge lands here; until a device session is
   * wired, this resolves the accumulator's finished geometry from the planes it
   * was given via {@link captureWebXrPlanes}, keeping the contract intact.
   */
  async scan(options: ScanOptions = {}): Promise<RoomGeometry> {
    const planes = await captureWebXrPlanes(options);
    if (planes.length < 3) {
      throw new Error('Scan cancelled or incomplete (need at least 3 walls).');
    }
    const accumulator = createScanAccumulator({ expectedWalls: planes.length });
    for (const plane of planes) {
      const snapshot = accumulator.addPlane(plane);
      options.onProgress?.({
        phase: 'capturing',
        ratio: snapshot.progress,
        message: `Captured ${snapshot.planeCount} wall${snapshot.planeCount > 1 ? 's' : ''}`,
      });
    }
    options.onProgress?.({ phase: 'processing', ratio: 0.9 });
    const { geometry } = accumulator.finish();
    // Same capture, second pass: find the sockets and pipework on those walls.
    const withFixtures = await scanFixtures(geometry, options);
    options.onProgress?.({ phase: 'done', ratio: 1 });
    return withFixtures;
  }

  fallbackInput(): RoomGeometry {
    return manualDimensionsToRoomGeometry({
      width: 4000,
      depth: 3000,
      height: 2700,
      unitSystem: 'metric',
    });
  }
}

/**
 * Acquire wall planes from a live WebXR depth/hit-test session.
 *
 * The device-specific capture (immersive-ar hit-test corner walk feeding plane
 * observations) is wired here; in non-AR contexts it resolves empty so the
 * caller falls back. Kept separate so the accumulator pipeline in `scan()`
 * stays testable without a headset.
 */
async function captureWebXrPlanes(_options: ScanOptions): Promise<PlaneObservation[]> {
  // No XR runtime (SSR, desktop, iOS Safari) → no native planes; caller falls back.
  if (!getXR()) return [];
  // Device session bridge attaches here. Returning empty until a session is
  // attached keeps `scan()` honest (it will report an incomplete capture rather
  // than fabricate geometry).
  return [];
}

/**
 * Find the sockets and pipework on the scanned walls and attach them.
 *
 * This runs as part of scanning — not as a separate step the user has to opt
 * into — because in a normal room every service that matters is exposed on the
 * wall surface where a camera can see it. The engine (detectors → ray-cast
 * projection → millimetre sizing → classification → merge, in
 * `fixtureProjection.ts`) is real and unit-tested; the remaining device seam is
 * the frame SOURCE below. With no frames it records an honest, empty summary
 * rather than fabricating fixtures.
 */
async function scanFixtures(
  geometry: RoomGeometry,
  options: ScanOptions,
): Promise<RoomGeometry> {
  if (options.detectFixtures === false) {
    return { ...geometry, fixtureScan: { attempted: false, frames: 0, detected: 0 } };
  }
  options.onProgress?.({
    phase: 'detecting',
    ratio: 0.94,
    message: 'Looking for sockets and pipes',
  });
  const frames = await captureCameraFrames(options, geometry);
  if (frames.length === 0) {
    return { ...geometry, fixtureScan: { attempted: true, frames: 0, detected: 0 } };
  }
  const detected = detectWallFixtures(frames, geometry.walls, geometry.height);
  options.onProgress?.({
    phase: 'detecting',
    ratio: 0.99,
    message: `Found ${detected.length} fixture${detected.length === 1 ? '' : 's'}`,
  });
  return {
    ...geometry,
    walls: assignFixturesToWalls(geometry.walls, detected),
    fixtureScan: { attempted: true, frames: frames.length, detected: detected.length },
  };
}

/**
 * Acquire camera frames (pixels + pose) for fixture detection. The device bridge —
 * immersive-AR camera access, or a RoomPlan companion streaming frames — attaches
 * here; empty until then, so `scan()` reports geometry with no auto-detected
 * fixtures rather than fabricate them. (The browser demo feeds the same detectors
 * live `getUserMedia` frames, exercising the full engine end-to-end.)
 */
async function captureCameraFrames(
  _options: ScanOptions,
  _geometry: RoomGeometry,
): Promise<CameraFrame[]> {
  return [];
}
