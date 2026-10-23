/**
 * Web adapter for the floorplan engine.
 *
 * The dimensioning / SVG logic lives once in `@mozu/scan-sdk` (so the browser
 * extensions and — via the JSON contract — the iOS app share it). This module
 * bridges the web app's domain types (`Room`, `RoomGeometry` — Vec3 footprints,
 * walls with openings) to the SDK's `RoomScan`, and re-exports the engine so
 * the React layer imports floorplan helpers from one place.
 */
import {
  buildFloorplan,
  floorplanToSvg,
  formatArea,
  formatLength,
  type Floorplan,
  type RoomScan,
  type ScanFixture,
  type ScanOpening,
  type ScanSource,
} from '@mozu/scan-sdk';
import type { Room, Wall } from '@/lib/types';
import type { RoomGeometry, ScannerId } from './types';

export { buildFloorplan, floorplanToSvg, formatArea, formatLength };
export type { Floorplan, RoomScan };

/** Fine-grained provider → SDK capture source (drives the floorplan badge). */
function providerToSource(provider: ScannerId): ScanSource {
  switch (provider) {
    case 'roomplan':
      return 'roomplan';
    case 'webxr-depth':
      return 'webxr';
    case 'manual':
    case 'floorplan':
      return 'manual';
    default:
      return 'webxr';
  }
}

/** Domain wall openings → SDK openings, indexed by their wall's edge order. */
function wallsToOpenings(walls: Wall[]): ScanOpening[] {
  const openings: ScanOpening[] = [];
  walls.forEach((wall, wallIndex) => {
    for (const o of wall.openings) {
      openings.push({
        type: o.type,
        wall: wallIndex,
        offset: o.offset,
        width: o.width,
        height: o.height,
        sill: o.sillHeight,
      });
    }
  });
  return openings;
}

/** Domain wall fixtures → SDK fixtures, indexed by their wall's edge order. */
function wallsToFixtures(walls: Wall[]): ScanFixture[] {
  const fixtures: ScanFixture[] = [];
  walls.forEach((wall, wallIndex) => {
    for (const f of wall.fixtures ?? []) {
      fixtures.push({
        type: f.type,
        wall: wallIndex,
        offset: f.offset,
        height: f.height,
        source: f.source,
        confidence: f.confidence,
        diameterMm: f.diameterMm,
      });
    }
  });
  return fixtures;
}

/** A captured `RoomGeometry` → the SDK's normalized `RoomScan`. */
export function roomGeometryToScan(geometry: RoomGeometry): RoomScan {
  return {
    schema: 'mozu.roomscan/1',
    polygon: geometry.footprint.map((p) => ({ x: p.x, z: p.z })),
    height: geometry.height,
    openings: wallsToOpenings(geometry.walls),
    objects: [],
    fixtures: wallsToFixtures(geometry.walls),
    source: providerToSource(geometry.provider),
    unitSystem: geometry.unitSystem,
    confidence: geometry.confidence,
    capturedAt: geometry.capturedAt,
  };
}

/** The domain `Room` aggregate → a `RoomScan` (for rendering its floorplan). */
export function roomToScan(room: Room): RoomScan {
  return {
    schema: 'mozu.roomscan/1',
    polygon: room.footprint.map((p) => ({ x: p.x, z: p.z })),
    height: room.height,
    openings: wallsToOpenings(room.walls),
    objects: [],
    fixtures: wallsToFixtures(room.walls),
    source: room.source === 'ar-scan' ? 'webxr' : 'manual',
    unitSystem: room.unitSystem,
    confidence: 1,
    capturedAt: room.updatedAt,
  };
}

/** Domain `Room` → dimensioned `Floorplan`. */
export function roomToFloorplan(room: Room): Floorplan {
  return buildFloorplan(roomToScan(room));
}
