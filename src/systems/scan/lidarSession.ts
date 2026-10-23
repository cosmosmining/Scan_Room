import type { Vec3, Wall } from '@/lib/types';
import { createId } from '@/lib/utils';
import { buildMassing, type MassingModel, type MassingObject } from './massing';
import type { RoomGeometry } from './types';

/**
 * The live LiDAR scan session — the heart of Phase 1. As the depth sensor
 * detects wall planes and objects, this accumulator lights up boundary **edges**
 * (the glowing white lines tracing wall/floor/ceiling junctions) and grows the
 * **box massing** model, emitting a snapshot after every observation.
 *
 * It is pure and deterministic: feed it the same observations and it produces
 * the same snapshots. The browser sensor loop (WebXR depth/plane detection) and
 * the demo "replay" path both drive it through the same `addPlane`/`addObject`
 * surface, which is why the scan experience works with or without LiDAR.
 */

export type ScanPhase = 'initializing' | 'capturing' | 'processing' | 'done';

export type ScanEdgeKind = 'wall-base' | 'wall-top' | 'corner' | 'object';

/** A glowing boundary line snapped onto a detected edge (mm, world space). */
export interface ScanEdge {
  id: string;
  a: Vec3;
  b: Vec3;
  kind: ScanEdgeKind;
}

/** A single detected wall plane (its floor line + height). */
export interface PlaneObservation {
  start: { x: number; z: number };
  end: { x: number; z: number };
  height: number;
  thickness?: number;
}

/** One immutable frame of the scan: lines + massing + progress. */
export interface ScanSnapshot {
  edges: ScanEdge[];
  massing: MassingModel;
  /** 0..1 capture progress. */
  progress: number;
  /** Wall planes detected so far. */
  planeCount: number;
  phase: ScanPhase;
}

export interface ScanAccumulator {
  /** Ingest one detected wall plane; returns the new snapshot. */
  addPlane(plane: PlaneObservation): ScanSnapshot;
  /** Ingest one detected object (closet, appliance…); returns the new snapshot. */
  addObject(object: MassingObject): ScanSnapshot;
  /** Current snapshot without mutating. */
  snapshot(): ScanSnapshot;
  /** Close the loop into a `RoomGeometry` and a final `done` snapshot. */
  finish(): { geometry: RoomGeometry; snapshot: ScanSnapshot };
}

const DEFAULT_THICKNESS = 100;

export interface ScanAccumulatorOptions {
  unitSystem?: RoomGeometry['unitSystem'];
  /** Expected wall count, used to scale the progress bar. */
  expectedWalls?: number;
}

/** Create a fresh accumulator for one scan session. */
export function createScanAccumulator(
  opts: ScanAccumulatorOptions = {},
): ScanAccumulator {
  const unitSystem = opts.unitSystem ?? 'metric';
  const expectedWalls = Math.max(3, opts.expectedWalls ?? 4);
  const planes: PlaneObservation[] = [];
  const objects: MassingObject[] = [];

  const edgesForPlane = (p: PlaneObservation): ScanEdge[] => {
    const base = (y: number): [Vec3, Vec3] => [
      { x: p.start.x, y, z: p.start.z },
      { x: p.end.x, y, z: p.end.z },
    ];
    const [b0, b1] = base(0);
    const [t0, t1] = base(p.height);
    return [
      { id: createId('edge'), kind: 'wall-base', a: b0, b: b1 },
      { id: createId('edge'), kind: 'wall-top', a: t0, b: t1 },
      { id: createId('edge'), kind: 'corner', a: b0, b: t0 },
      { id: createId('edge'), kind: 'corner', a: b1, b: t1 },
    ];
  };

  const build = (phase: ScanPhase): ScanSnapshot => {
    const edges: ScanEdge[] = [];
    for (const p of planes) edges.push(...edgesForPlane(p));
    for (const o of objects) {
      // Four base edges outlining the object footprint.
      const hw = o.width / 2;
      const hd = o.depth / 2;
      const corners: Vec3[] = [
        { x: o.center.x - hw, y: 0, z: o.center.z - hd },
        { x: o.center.x + hw, y: 0, z: o.center.z - hd },
        { x: o.center.x + hw, y: 0, z: o.center.z + hd },
        { x: o.center.x - hw, y: 0, z: o.center.z + hd },
      ];
      for (let i = 0; i < 4; i++) {
        edges.push({
          id: createId('edge'),
          kind: 'object',
          a: corners[i],
          b: corners[(i + 1) % 4],
        });
      }
    }

    const geometry = toGeometry(phase === 'done');
    const massing = buildMassing(geometry, objects, {
      includeFloor: planes.length >= 2,
    });
    const progress =
      phase === 'done'
        ? 1
        : Math.min(0.95, planes.length / expectedWalls) * 0.9 + (objects.length > 0 ? 0.05 : 0);

    return { edges, massing, progress, planeCount: planes.length, phase };
  };

  /** Footprint from the ordered plane endpoints (or their bounding rect). */
  const toGeometry = (closed: boolean): RoomGeometry => {
    const height = planes[0]?.height ?? 2700;
    let footprint: Vec3[];
    let walls: Wall[];

    if (planes.length >= 3) {
      footprint = [
        { x: planes[0].start.x, y: 0, z: planes[0].start.z },
        ...planes.map((p) => ({ x: p.end.x, y: 0, z: p.end.z })),
      ];
      // Drop the closing duplicate vertex if the loop returned to the start.
      const first = footprint[0];
      const last = footprint[footprint.length - 1];
      if (Math.hypot(first.x - last.x, first.z - last.z) < 50) footprint.pop();
      walls = planes.map((p, i) => ({
        id: `wall_${i}`,
        start: { x: p.start.x, y: 0, z: p.start.z },
        end: { x: p.end.x, y: 0, z: p.end.z },
        height: p.height,
        thickness: p.thickness ?? DEFAULT_THICKNESS,
        openings: [],
      }));
    } else {
      // Not enough planes yet — fall back to the bounding rectangle.
      const pts = planes.flatMap((p) => [p.start, p.end]);
      const xs = pts.map((p) => p.x);
      const zs = pts.map((p) => p.z);
      const minX = xs.length ? Math.min(...xs) : 0;
      const maxX = xs.length ? Math.max(...xs) : 4000;
      const minZ = zs.length ? Math.min(...zs) : 0;
      const maxZ = zs.length ? Math.max(...zs) : 3000;
      footprint = [
        { x: minX, y: 0, z: minZ },
        { x: maxX, y: 0, z: minZ },
        { x: maxX, y: 0, z: maxZ },
        { x: minX, y: 0, z: maxZ },
      ];
      walls = footprint.map((start, i) => ({
        id: `wall_${i}`,
        start,
        end: footprint[(i + 1) % footprint.length],
        height,
        thickness: DEFAULT_THICKNESS,
        openings: [],
      }));
    }

    return {
      footprint,
      walls,
      height,
      unitSystem,
      source: 'ar-scan',
      provider: 'webxr-depth',
      confidence: closed ? 0.9 : 0.6,
      capturedAt: new Date().toISOString(),
    };
  };

  return {
    addPlane(plane) {
      planes.push(plane);
      return build('capturing');
    },
    addObject(object) {
      objects.push(object);
      return build('capturing');
    },
    snapshot() {
      return build(planes.length === 0 ? 'initializing' : 'capturing');
    },
    finish() {
      const snapshot = build('done');
      return { geometry: toGeometry(true), snapshot };
    },
  };
}

/**
 * Turn an existing room geometry into ordered plane observations — the "replay"
 * source that lets the live scan animation run on any device (no LiDAR needed),
 * and the basis for deterministic tests.
 */
export function planesFromGeometry(geometry: RoomGeometry): PlaneObservation[] {
  return geometry.walls.map((wall) => ({
    start: { x: wall.start.x, z: wall.start.z },
    end: { x: wall.end.x, z: wall.end.z },
    height: wall.height,
    thickness: wall.thickness,
  }));
}
