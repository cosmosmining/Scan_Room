/**
 * `RoomScan` → `RoomGeometry`: the one place the wire format becomes the
 * configurator's room.
 *
 * Shared by every way a scan can arrive — the `/scan?scan=…` deep link, the
 * `/scan/CODE` handoff, a pasted file — so a room designed from a code is the
 * same room, wall for wall and socket for socket, as one opened from a link.
 * Divergence here would be invisible until someone compared two plans of the
 * same kitchen and found the sockets in different places.
 */

import type { RoomScan } from '@mozu/scan-sdk';
import { floorplanSketchToRoomGeometry } from '@/systems/scan';
import type { RoomGeometry, ScannerId } from '@/systems/scan';

const SOURCE_TO_PROVIDER: Record<RoomScan['source'], ScannerId> = {
  roomplan: 'roomplan',
  webxr: 'webxr-depth',
  camera: 'manual',
  manual: 'manual',
};

export function scanToGeometry(scan: RoomScan): RoomGeometry {
  const geometry = floorplanSketchToRoomGeometry({
    vertices: scan.polygon,
    height: scan.height,
    unitSystem: scan.unitSystem,
  });
  geometry.provider = SOURCE_TO_PROVIDER[scan.source];
  geometry.source = scan.source === 'manual' ? 'manual' : 'ar-scan';
  geometry.confidence = scan.confidence;
  // Attach any detected openings to their walls (edge i → wall_i).
  if (scan.openings.length) {
    geometry.walls = geometry.walls.map((wall, i) => ({
      ...wall,
      openings: scan.openings
        .filter((o) => o.wall === i)
        .map((o, j) => ({
          id: `op_${i}_${j}`,
          type: o.type,
          offset: o.offset,
          width: o.width,
          height: o.height,
          sillHeight: o.sill ?? 0,
        })),
    }));
  }
  // …and the fixtures the scan found, so the sockets and pipework reach the
  // floor plan and the conflict engine instead of being dropped at the door.
  const fixtures = scan.fixtures ?? [];
  if (fixtures.length) {
    geometry.walls = geometry.walls.map((wall, i) => ({
      ...wall,
      fixtures: fixtures
        .filter((f) => f.wall === i)
        .map((f, j) => ({
          id: `fx_${i}_${j}`,
          type: f.type,
          offset: f.offset,
          height: f.height,
          source: f.source,
          confidence: f.confidence,
          ...(f.diameterMm !== undefined ? { diameterMm: f.diameterMm } : {}),
        })),
    }));
    geometry.fixtureScan = {
      attempted: true,
      frames: 0,
      detected: fixtures.filter((f) => f.source === 'detected').length,
    };
  }
  return geometry;
}
