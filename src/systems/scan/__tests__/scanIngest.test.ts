import { describe, expect, it } from 'vitest';
import { parseScan, buildFloorplan } from '@mozu/scan-sdk';
import { floorplanSketchToRoomGeometry, roomGeometryToRoom } from '@/systems/scan';
import { roomToFloorplan } from '@/systems/scan/floorplan';
import { execFileSync } from 'node:child_process';

/** The /scan deep link must carry fixtures all the way to a labelled plan. */
describe('scan deep link → fixtures on the floor plan', () => {
  const url = execFileSync('node', ['scripts/demo-scan-link.mjs'], { encoding: 'utf8' })
    .split('\n').find((l) => l.startsWith('http'))!;
  const payload = new URL(url).searchParams.get('scan')!;

  it('the generated link parses back with its fixtures', () => {
    const scan = parseScan(payload);
    expect(scan).not.toBeNull();
    expect(scan!.fixtures!.length).toBe(6);
    expect(scan!.fixtures!.some((f) => f.type === 'waste' && f.diameterMm === 110)).toBe(true);
  });

  it('those fixtures reach the floor plan with labels', () => {
    const scan = parseScan(payload)!;
    const fp = buildFloorplan(scan);
    expect(fp.fixtures.length).toBe(6);
    expect(fp.fixtures.map((f) => f.text)).toContain('Waste ⌀110');
    expect(fp.fixtures.map((f) => f.text)).toContain('Socket');
    // every marker sits somewhere on the plan, not at the origin by default
    for (const f of fp.fixtures) expect(Number.isFinite(f.point.x)).toBe(true);
  });

  it('a room built the ScanIngest way keeps them through to its plan', () => {
    const scan = parseScan(payload)!;
    const geom = floorplanSketchToRoomGeometry({
      vertices: scan.polygon, height: scan.height, unitSystem: scan.unitSystem,
    });
    geom.walls = geom.walls.map((wall, i) => ({
      ...wall,
      fixtures: scan.fixtures!.filter((f) => f.wall === i).map((f, j) => ({
        id: `fx_${i}_${j}`, type: f.type, offset: f.offset, height: f.height,
        source: f.source, confidence: f.confidence,
        ...(f.diameterMm !== undefined ? { diameterMm: f.diameterMm } : {}),
      })),
    }));
    const plan = roomToFloorplan(roomGeometryToRoom(geom));
    expect(plan.fixtures.length).toBe(6);
    expect(plan.fixtures.map((f) => f.text)).toContain('Water ⌀22');
  });
});
