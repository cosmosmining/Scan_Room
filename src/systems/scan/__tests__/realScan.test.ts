import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseScan, type RoomScan } from '@mozu/scan-sdk';
import { scanToGeometry } from '@/systems/scan/scanToGeometry';
import { recommendLayouts } from '@/systems/ai';
import { columnObstacles } from '@/systems/furniture/catalog';
import { pointInPolygon } from '@/systems/layout/geometry2d';
import { placementToRect, type LayoutResult } from '@/systems/layout';
import { GET, POST } from '@/app/api/scan-handoff/route';

// ---------------------------------------------------------------------------
// A room as the iPad really sends it, opened from its code.
//
// The golden scan is drawn square to the axes from (0, 0). A real one is not:
// RoomPlan's world is aligned to wherever the iPad faced when the scan began,
// so every wall comes in at some arbitrary angle, in coordinates around the
// spot the scan started from. These tests turn and move the same L-shaped room
// to where a real scan would put it and ask the studio for the same kitchen.
// They caught the plans changing with the angle, and cabinets packed facing
// out of the room against the walls of its inside corner.
// ---------------------------------------------------------------------------

const GOLDEN = parseScan(readFileSync('fixtures/scans/synthetic-l-room.scan.json', 'utf8'))!;

/** A structural column 100 mm off the long kitchen wall (wall 0, z = 0). */
const WITH_WALL_COLUMN: RoomScan = {
  ...GOLDEN,
  objects: [
    ...GOLDEN.objects,
    { category: 'column', center: { x: 4700, z: 300 }, width: 400, depth: 400, rotation: 0, height: 2650, shape: 'box' },
  ],
};

/** The same room, turned `deg` about the origin and moved by (dx, dz). */
function asScanned(scan: RoomScan, deg: number, dx: number, dz: number): RoomScan {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const move = (v: { x: number; z: number }) => ({ x: v.x * c - v.z * s + dx, z: v.x * s + v.z * c + dz });
  return {
    ...scan,
    polygon: scan.polygon.map(move),
    objects: scan.objects.map((o) => ({ ...o, center: move(o.center), rotation: o.rotation + a })),
  };
}

const POSES: [number, number, number][] = [
  [0, 0, 0],
  [23, -2400, -1800],
  [-71, 5300, -9100],
  [137, 800, 3100],
  [180, 0, 0],
];

/** Open a scan the way the browser does: code in, the room out. */
async function openFromCode(scan: RoomScan) {
  const posted = await POST(
    new Request('http://studio.test/api/scan-handoff', {
      method: 'POST',
      body: JSON.stringify({ scan }),
    }),
  );
  expect(posted.status).toBe(201);
  const { code } = (await posted.json()) as { code: string };
  const got = await GET(new Request(`http://studio.test/api/scan-handoff?code=${code.toLowerCase()}`));
  expect(got.status).toBe(200);
  const body = (await got.json()) as { scan: unknown };
  // …and exactly what `ScanCodeLoader` does with it.
  const parsed = parseScan(JSON.stringify(body.scan));
  expect(parsed).not.toBeNull();
  const { useConfiguratorStore } = await import('@/state/useConfiguratorStore');
  useConfiguratorStore.getState().applyRoomGeometry(scanToGeometry(parsed!));
  return useConfiguratorStore;
}

/** Every unit's footprint inside the room, a hair in from each corner. */
function footprintsInside(result: LayoutResult, footprint: { x: number; z: number }[]): boolean {
  return result.placements.every((p) => {
    const r = placementToRect(p);
    return [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].every(([u, v]) =>
      pointInPolygon(
        {
          x: r.center.x + r.axisX.x * u * (r.halfX - 2) + r.axisZ.x * v * (r.halfZ - 2),
          z: r.center.z + r.axisX.z * u * (r.halfX - 2) + r.axisZ.z * v * (r.halfZ - 2),
        },
        footprint,
      ),
    );
  });
}

type Summary = Record<string, { units: string[]; errors: string[]; inside: boolean }>;

async function kitchensFor(scan: RoomScan): Promise<Summary> {
  const store = await openFromCode(scan);
  const s = store.getState();
  const plans = recommendLayouts(s.room, s.catalog, {
    domain: 'kitchen',
    obstacles: columnObstacles(s.designItems),
  });
  const out: Summary = {};
  for (const plan of plans) {
    out[plan.shape] = {
      units: plan.result.instances.map((i) => i.definitionId).sort(),
      errors: plan.result.violations.filter((v) => v.severity === 'error').map((v) => v.message),
      inside: footprintsInside(plan.result, s.room.footprint),
    };
  }
  return out;
}

describe('a real scan, opened from its code', () => {
  beforeEach(async () => {
    const { useConfiguratorStore } = await import('@/state/useConfiguratorStore');
    useConfiguratorStore.getState().clearFurniture();
  });

  it('opens at any angle and position, with its walls, openings, sockets and furniture', async () => {
    for (const [deg, dx, dz] of POSES) {
      const store = await openFromCode(asScanned(GOLDEN, deg, dx, dz));
      const { room, designItems } = store.getState();
      expect(room.walls, `${deg}°`).toHaveLength(6);
      // Squared up with the page and moved to the origin, as it was drawn.
      const xs = room.footprint.map((p) => p.x);
      const zs = room.footprint.map((p) => p.z);
      expect(Math.min(...xs)).toBeCloseTo(0, 6);
      expect(Math.min(...zs)).toBeCloseTo(0, 6);
      // 6 × 5 m — not the 7.5 × 5.8 box around it standing crooked. (It may
      // come back a quarter turn round: the smallest turn that squares it.)
      const size = [Math.max(...xs), Math.max(...zs)].sort((a, b) => a - b);
      expect(size[0]).toBeCloseTo(5000, 6);
      expect(size[1]).toBeCloseTo(6000, 6);
      expect(room.walls.flatMap((w) => w.openings)).toHaveLength(3);
      expect(room.walls.flatMap((w) => w.fixtures ?? [])).toHaveLength(2);
      expect(designItems.filter((i) => i.scanned).map((i) => i.label).sort()).toEqual(['column', 'sofa']);
    }
  });

  it('is offered the same kitchens whichever way the iPad was facing', async () => {
    const square = await kitchensFor(GOLDEN);
    expect(Object.keys(square).sort()).toEqual(['galley', 'l-shaped', 'single-wall', 'u-shaped']);
    for (const [deg, dx, dz] of POSES.slice(1)) {
      const turned = await kitchensFor(asScanned(GOLDEN, deg, dx, dz));
      for (const shape of Object.keys(square)) {
        expect(turned[shape]?.units, `${shape} at ${deg}°`).toEqual(square[shape].units);
      }
    }
  });

  it('puts every cabinet of every plan inside the room, with nothing in the way', async () => {
    for (const [deg, dx, dz] of POSES) {
      for (const scan of [GOLDEN, WITH_WALL_COLUMN]) {
        const plans = await kitchensFor(asScanned(scan, deg, dx, dz));
        for (const [shape, plan] of Object.entries(plans)) {
          expect(plan.inside, `${shape} at ${deg}°`).toBe(true);
          expect(plan.errors, `${shape} at ${deg}°`).toEqual([]);
        }
      }
    }
  });
});
