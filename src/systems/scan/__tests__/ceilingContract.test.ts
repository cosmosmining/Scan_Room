/**
 * The ceiling's bulkheads, recesses and see-through mesh, from the iPad's scan
 * to the studio's room: kept by the wire format, turned with the room when it
 * is squared up, and carried onto the Room the plan and 3D view draw.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { handoffUrl, parseScan, scanFromParams, serializeScan, type RoomScan } from '@mozu/scan-sdk';
import { squareUp } from '@/systems/scan/squareUp';
import { scanToGeometry } from '@/systems/scan/scanToGeometry';
import { roomGeometryToRoom } from '@/systems/scan';

const GOLDEN = parseScan(readFileSync('fixtures/scans/synthetic-l-room.scan.json', 'utf8'))!;

/** An L-shaped bulkhead along two walls, with an angled end, and a mesh ceiling over the rest. */
const CEILING: NonNullable<RoomScan['ceiling']> = {
  zones: [
    {
      polygon: [
        { x: 0, z: 0 }, { x: 6000, z: 0 }, { x: 6000, z: 600 }, { x: 1100, z: 600 },
        { x: 700, z: 1000 }, { x: 700, z: 5000 }, { x: 0, z: 5000 },
      ],
      height: 2350,
    },
  ],
  seeThroughTo: 3400,
};
const WITH = { ...GOLDEN, ceiling: CEILING };

const turned = (scan: RoomScan, deg: number, dx: number, dz: number): RoomScan => {
  const a = (deg * Math.PI) / 180;
  const move = (v: { x: number; z: number }) => ({
    x: v.x * Math.cos(a) - v.z * Math.sin(a) + dx,
    z: v.x * Math.sin(a) + v.z * Math.cos(a) + dz,
  });
  return {
    ...scan,
    polygon: scan.polygon.map(move),
    objects: scan.objects.map((o) => ({ ...o, center: move(o.center), rotation: o.rotation + a })),
    ...(scan.ceiling
      ? { ceiling: { ...scan.ceiling, zones: scan.ceiling.zones.map((z) => ({ ...z, polygon: z.polygon.map(move) })) } }
      : {}),
  };
};

describe('the ceiling, from scan to room', () => {
  it('survives the file and the hand-off link unchanged', () => {
    expect(parseScan(serializeScan(WITH))?.ceiling).toEqual(CEILING);
    const url = new URL(handoffUrl('https://mozu.example', { ...WITH, openings: [], objects: [], fixtures: [] }));
    expect(scanFromParams(url.search)?.ceiling).toEqual(CEILING);
  });

  it('is absent when the scan found nothing on the ceiling', () => {
    expect(parseScan(serializeScan(GOLDEN))?.ceiling).toBeUndefined();
    expect(parseScan(JSON.stringify({ ...GOLDEN, ceiling: { zones: [] } }))?.ceiling).toBeUndefined();
  });

  it('drops a malformed zone, not the scan', () => {
    const bad = {
      ...GOLDEN,
      ceiling: {
        zones: [
          { polygon: [{ x: 0, z: 0 }, { x: 1, z: 0 }], height: 2300 },
          { polygon: 'nope', height: 2300 },
          { polygon: CEILING.zones[0].polygon, height: 'high' },
          CEILING.zones[0],
        ],
      },
    };
    const scan = parseScan(JSON.stringify(bad));
    expect(scan?.polygon).toEqual(GOLDEN.polygon);
    expect(scan?.ceiling).toEqual({ zones: [CEILING.zones[0]] });
    // A see-through ceiling with no bulkheads is still worth keeping.
    expect(parseScan(JSON.stringify({ ...GOLDEN, ceiling: { zones: [], seeThroughTo: 3300 } }))?.ceiling)
      .toEqual({ zones: [], seeThroughTo: 3300 });
  });

  it('turns and moves with the room when it is squared up', () => {
    for (const deg of [3, 23, -31, 44]) {
      const back = squareUp(turned(WITH, deg, -2400, 7100));
      expect(back.ceiling?.seeThroughTo).toBe(3400);
      back.ceiling!.zones[0].polygon.forEach((p, i) => {
        const want = CEILING.zones[0].polygon[i];
        expect(Math.hypot(p.x - want.x, p.z - want.z), `${deg}° corner ${i}`).toBeLessThan(1e-6);
      });
      expect(back.ceiling!.zones[0].height).toBe(2350);
    }
  });

  it('reaches the Room the plan and the 3D view draw', () => {
    const room = roomGeometryToRoom(scanToGeometry(turned(WITH, 23, 500, -900)));
    expect(room.ceiling?.zones).toHaveLength(1);
    expect(room.ceiling?.zones[0].height).toBe(2350);
    expect(room.ceiling?.seeThroughTo).toBe(3400);
    // Inside the room's own frame: every bulkhead corner lies within its bounds.
    const xs = room.footprint.map((p) => p.x);
    const zs = room.footprint.map((p) => p.z);
    for (const p of room.ceiling!.zones[0].polygon) {
      expect(p.x).toBeGreaterThanOrEqual(Math.min(...xs) - 1e-6);
      expect(p.x).toBeLessThanOrEqual(Math.max(...xs) + 1e-6);
      expect(p.z).toBeGreaterThanOrEqual(Math.min(...zs) - 1e-6);
      expect(p.z).toBeLessThanOrEqual(Math.max(...zs) + 1e-6);
    }
    expect(roomGeometryToRoom(scanToGeometry(GOLDEN)).ceiling).toBeUndefined();
  });
});
