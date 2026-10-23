import { describe, expect, it } from 'vitest';
import {
  apparentWidthToMm,
  buildFloorplan,
  classifyPipe,
  describeFixture,
  fixtureLabel,
  floorplanToSvg,
  parseScan,
  serializeScan,
  type ScanFixture,
} from '@mozu/scan-sdk';
import { createDefaultRoom } from '@/lib/defaults';
import { roomToFloorplan, roomToScan } from '@/systems/scan/floorplan';
import type { WallFixture } from '@/lib/types';

const fixture = (over: Partial<ScanFixture> = {}): ScanFixture => ({
  type: 'socket',
  wall: 0,
  offset: 1000,
  height: 300,
  source: 'detected',
  confidence: 0.9,
  ...over,
});

describe('fixture labelling', () => {
  it('names a socket', () => {
    expect(fixtureLabel(fixture())).toBe('Socket');
  });

  it('includes the measured bore for pipework', () => {
    expect(fixtureLabel(fixture({ type: 'waste', diameterMm: 110 }))).toBe('Waste ⌀110');
    expect(fixtureLabel(fixture({ type: 'water', diameterMm: 15 }))).toBe('Water ⌀15');
  });

  it('honours an explicit label override', () => {
    expect(fixtureLabel(fixture({ label: 'Cooker point' }))).toBe('Cooker point');
  });

  it('describes height and how it was captured', () => {
    expect(describeFixture(fixture({ confidence: 0.82 }))).toContain('82% confident');
    expect(describeFixture(fixture({ source: 'manual' }))).toContain('added by hand');
  });
});

describe('pipe sizing and classification', () => {
  it('converts apparent pixels to millimetres via the wall distance', () => {
    // 1000px-wide frame, 90° horizontal FOV (tanX = 1) at 2000mm:
    // full frame spans 2*2000*1 = 4000mm, so 1px = 4mm and 10px = 40mm.
    const fovY = 2 * Math.atan(Math.tan(Math.PI / 4) / (1000 / 750)); // aspect 4:3
    const mm = apparentWidthToMm(10, 2000, fovY, 1000, 750);
    expect(mm).toBeGreaterThan(35);
    expect(mm).toBeLessThan(45);
  });

  it('scales linearly with distance', () => {
    const near = apparentWidthToMm(10, 1000, 1.0, 800, 600);
    const far = apparentWidthToMm(10, 2000, 1.0, 800, 600);
    expect(far / near).toBeCloseTo(2, 5);
  });

  it('calls a fat pipe waste', () => {
    const c = classifyPipe(110);
    expect(c.type).toBe('waste');
    expect(c.confidence).toBeGreaterThan(0.8);
    expect(c.reason).toContain('110mm');
  });

  it('calls small bore water by default', () => {
    expect(classifyPipe(15).type).toBe('water');
    expect(classifyPipe(22).type).toBe('water');
  });

  it('uses the yellow cue to call gas', () => {
    expect(classifyPipe(22, { yellowness: 0.8 }).type).toBe('gas');
  });

  it('calls a low horizontal small-bore run gas', () => {
    expect(classifyPipe(28, { vertical: false, heightMm: 200 }).type).toBe('gas');
  });
});

describe('fixtures on the floor plan', () => {
  const square = [
    { x: 0, z: 0 },
    { x: 4000, z: 0 },
    { x: 4000, z: 3000 },
    { x: 0, z: 3000 },
  ];

  it('places a fixture at the right point on its wall, with a label', () => {
    const fp = buildFloorplan({
      polygon: square,
      height: 2700,
      unitSystem: 'metric',
      fixtures: [fixture({ wall: 0, offset: 1000 })],
    });
    expect(fp.fixtures).toHaveLength(1);
    const f = fp.fixtures[0];
    expect(f.point.x).toBeCloseTo(1000, 3);
    expect(f.point.z).toBeCloseTo(0, 3);
    expect(f.text).toBe('Socket');
    // Inward normal points into the room (positive z for the bottom edge).
    expect(f.inward.z).toBeGreaterThan(0.5);
  });

  it('keeps fixtures on the correct wall when the polygon is wound clockwise', () => {
    // Clockwise input — buildFloorplan re-winds it CCW, which reorders walls.
    const cw = [
      { x: 0, z: 0 },
      { x: 0, z: 3000 },
      { x: 4000, z: 3000 },
      { x: 4000, z: 0 },
    ];
    // Wall 0 of THIS polygon is the left edge (0,0)→(0,3000).
    const fp = buildFloorplan({
      polygon: cw,
      height: 2700,
      unitSystem: 'metric',
      fixtures: [fixture({ wall: 0, offset: 1200 })],
    });
    expect(fp.fixtures).toHaveLength(1);
    const f = fp.fixtures[0];
    // It must still sit at (0, 1200) — on the left wall, not somewhere else.
    expect(f.point.x).toBeCloseTo(0, 3);
    expect(f.point.z).toBeCloseTo(1200, 3);
    // And it must name a wall that actually exists on the rebuilt plan.
    expect(fp.walls[f.wall]).toBeDefined();
  });

  it('keeps openings on the correct wall for a clockwise polygon too', () => {
    const cw = [
      { x: 0, z: 0 },
      { x: 0, z: 3000 },
      { x: 4000, z: 3000 },
      { x: 4000, z: 0 },
    ];
    const fp = buildFloorplan({
      polygon: cw,
      height: 2700,
      unitSystem: 'metric',
      openings: [{ type: 'door', wall: 0, offset: 1000, width: 800, height: 2000, sill: 0 }],
    });
    const op = fp.openings[0];
    const wall = fp.walls[op.wall];
    expect(wall).toBeDefined();
    // The door's midpoint should land at (0, 1400) on the left wall.
    const dir = {
      x: (wall.end.x - wall.start.x) / wall.length,
      z: (wall.end.z - wall.start.z) / wall.length,
    };
    const midOffset = op.offset + op.width / 2;
    const midX = wall.start.x + dir.x * midOffset;
    const midZ = wall.start.z + dir.z * midOffset;
    expect(midX).toBeCloseTo(0, 3);
    expect(midZ).toBeCloseTo(1400, 3);
  });

  it('drops a fixture that names a wall the scan does not have', () => {
    const fp = buildFloorplan({
      polygon: square,
      height: 2700,
      unitSystem: 'metric',
      fixtures: [fixture({ wall: 99 })],
    });
    expect(fp.fixtures).toHaveLength(0);
  });

  it('renders fixture markers and labels into the SVG', () => {
    const fp = buildFloorplan({
      polygon: square,
      height: 2700,
      unitSystem: 'metric',
      fixtures: [
        fixture({ wall: 0, offset: 1000 }),
        fixture({ wall: 1, offset: 800, type: 'waste', diameterMm: 110 }),
      ],
    });
    const svg = floorplanToSvg(fp);
    expect(svg).toContain('Socket');
    expect(svg).toContain('Waste ⌀110');
    expect(svg).toContain('<circle');
  });

  it('omits fixtures when asked', () => {
    const fp = buildFloorplan({
      polygon: square,
      height: 2700,
      unitSystem: 'metric',
      fixtures: [fixture()],
    });
    expect(floorplanToSvg(fp, { showFixtures: false })).not.toContain('Socket');
  });
});

describe('room → scan → floorplan carries detected fixtures', () => {
  const detected: WallFixture = {
    id: 'f1',
    type: 'waste',
    offset: 1500,
    height: 250,
    source: 'detected',
    confidence: 0.85,
    diameterMm: 110,
  };

  it('lifts wall fixtures into the scan payload', () => {
    const room = createDefaultRoom();
    room.walls[0].fixtures = [detected];
    const scan = roomToScan(room);
    expect(scan.fixtures).toHaveLength(1);
    expect(scan.fixtures![0]).toMatchObject({ type: 'waste', wall: 0, diameterMm: 110 });
  });

  it('shows them on the room floorplan, labelled', () => {
    const room = createDefaultRoom();
    room.walls[0].fixtures = [detected];
    const fp = roomToFloorplan(room);
    expect(fp.fixtures).toHaveLength(1);
    expect(fp.fixtures[0].text).toBe('Waste ⌀110');
  });

  it('survives the wire format round-trip', () => {
    const room = createDefaultRoom();
    room.walls[0].fixtures = [detected];
    const back = parseScan(serializeScan(roomToScan(room)));
    expect(back).not.toBeNull();
    expect(back!.fixtures).toHaveLength(1);
    expect(back!.fixtures![0].type).toBe('waste');
  });

  it('still parses a legacy payload with no fixtures field', () => {
    const legacy = JSON.stringify({
      schema: 'mozu.roomscan/1',
      polygon: [
        { x: 0, z: 0 },
        { x: 1000, z: 0 },
        { x: 1000, z: 1000 },
      ],
      height: 2400,
      openings: [],
      objects: [],
      source: 'manual',
      unitSystem: 'metric',
      confidence: 1,
      capturedAt: new Date(0).toISOString(),
    });
    const back = parseScan(legacy);
    expect(back).not.toBeNull();
    expect(back!.fixtures).toEqual([]);
  });
});
