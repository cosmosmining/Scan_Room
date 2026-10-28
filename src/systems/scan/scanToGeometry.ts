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
import { squareUp } from './squareUp';

const SOURCE_TO_PROVIDER: Record<RoomScan['source'], ScannerId> = {
  roomplan: 'roomplan',
  webxr: 'webxr-depth',
  camera: 'manual',
  manual: 'manual',
};

export function scanToGeometry(received: RoomScan): RoomGeometry {
  // Straight on the page, whichever way the iPad faced — see `squareUp`.
  const scan = squareUp(received);
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
          ...(o.glass ? { glass: true } : {}),
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
  // …and the furniture the scan saw. This used to be dropped here, silently:
  // the iPad measured a room full of objects and the web opened an empty shell,
  // so nothing could be checked against what is actually in the room and
  // nothing could be removed. They are carried as MEASUREMENTS, not products —
  // see `applyRoomGeometry`, which seeds them as removable placed items.
  geometry.objects = scan.objects ?? [];
  // …and the ceiling's bulkheads and recesses, in the same turned frame as the
  // walls (squareUp moved them with the room).
  if (scan.ceiling) geometry.ceiling = scan.ceiling;
  return geometry;
}
