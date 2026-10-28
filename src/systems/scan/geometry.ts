import type { Millimeters, Room, Vec3, Wall } from '@/lib/types';
import { createId } from '@/lib/utils';
import type {
  FloorplanSketch,
  ManualDimensions,
  RoomGeometry,
} from './types';

const DEFAULT_WALL_THICKNESS: Millimeters = 100;

/** Build closed-loop walls from an ordered floor polygon. */
function wallsFromFootprint(
  footprint: Vec3[],
  height: Millimeters,
  thickness: Millimeters = DEFAULT_WALL_THICKNESS,
): Wall[] {
  return footprint.map((start, i) => ({
    id: `wall_${i}`,
    start,
    end: footprint[(i + 1) % footprint.length],
    height,
    thickness,
    openings: [],
  }));
}

/** Manual dimension input → geometry. Exact by definition (confidence 1). */
export function manualDimensionsToRoomGeometry(
  d: ManualDimensions,
): RoomGeometry {
  const footprint: Vec3[] = [
    { x: 0, y: 0, z: 0 },
    { x: d.width, y: 0, z: 0 },
    { x: d.width, y: 0, z: d.depth },
    { x: 0, y: 0, z: d.depth },
  ];
  return {
    footprint,
    walls: wallsFromFootprint(footprint, d.height),
    height: d.height,
    unitSystem: d.unitSystem,
    source: 'manual',
    provider: 'manual',
    confidence: 1,
    capturedAt: new Date().toISOString(),
  };
}

/** Floorplan sketch (drawn-to-scale polygon) → geometry. */
export function floorplanSketchToRoomGeometry(
  sketch: FloorplanSketch,
): RoomGeometry {
  const footprint: Vec3[] = sketch.vertices.map((v) => ({
    x: v.x,
    y: 0,
    z: v.z,
  }));
  return {
    footprint,
    walls: wallsFromFootprint(footprint, sketch.height),
    height: sketch.height,
    unitSystem: sketch.unitSystem,
    source: 'manual',
    provider: 'floorplan',
    confidence: 0.95,
    capturedAt: new Date().toISOString(),
  };
}

/** Lift a captured geometry into the domain `Room` aggregate. */
export function roomGeometryToRoom(
  geometry: RoomGeometry,
  name = 'My Room',
): Room {
  const now = new Date().toISOString();
  return {
    id: createId('room'),
    name,
    footprint: geometry.footprint,
    walls: geometry.walls,
    height: geometry.height,
    unitSystem: geometry.unitSystem,
    source: geometry.source,
    // Carry what the fixture pass found; without it the UI cannot tell
    // "we looked and found none" from "we never looked".
    fixtureScan: geometry.fixtureScan,
    ...(geometry.ceiling ? { ceiling: geometry.ceiling } : {}),
    createdAt: now,
    updatedAt: now,
  };
}
