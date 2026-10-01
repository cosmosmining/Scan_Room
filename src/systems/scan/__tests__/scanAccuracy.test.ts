import { describe, expect, it } from 'vitest';
import { alignWalls, compareScan } from '../../../../scripts/scan-accuracy.mjs';

const rectScan = (w: number, d: number) => ({
  polygon: [{ x: 0, z: 0 }, { x: w, z: 0 }, { x: w, z: d }, { x: 0, z: d }],
  height: 2600, openings: [], objects: [], fixtures: [],
});

describe('scan-accuracy: scoring a scan against the tape measure', () => {
  it('lines up walls listed from any corner, in either direction', () => {
    const pairs = alignWalls([4000, 3000, 4000, 3000], [3010, 4005, 2995, 3990])!;
    expect(pairs.every((p) => Math.abs(p.scanned - p.measured) <= 15)).toBe(true);
    const reversed = alignWalls([6000, 2500, 3000, 2500, 3000, 5000], [5000, 3000, 2500, 3000, 2500, 6000])!;
    expect(reversed.every((p) => p.scanned === p.measured)).toBe(true);
  });

  it('fails a wall that is off by more than the limit, and only that one', () => {
    const rows = compareScan(rectScan(4000, 3000), { walls: [4100, 3000, 4000, 3000] });
    const failed = rows.filter((r) => !r.pass).map((r) => r.check);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatch(/^wall /);
  });

  it('allows 1.5% on a long wall (90mm on 6m) but holds short walls to 30mm', () => {
    const truth = { walls: [6000, 3000, 6000, 3000] };
    expect(compareScan(rectScan(6085, 3000), truth).every((r) => r.pass)).toBe(true);
    expect(compareScan(rectScan(6095, 3000), truth).filter((r) => !r.pass)).toHaveLength(2);
    const short = { walls: [6000, 1000, 6000, 1000] };
    expect(compareScan(rectScan(6000, 1025), short).every((r) => r.pass)).toBe(true);
    expect(compareScan(rectScan(6000, 1035), short).filter((r) => !r.pass)).toHaveLength(2);
  });

  it('reports a missing wall as a wall-count failure rather than guessing', () => {
    const rows = compareScan(rectScan(4000, 3000), { walls: [4000, 3000, 2000, 2000, 3000] });
    expect(rows.find((r) => r.check === 'wall count')?.pass).toBe(false);
  });

  it('counts sockets, doors and columns', () => {
    const scan = {
      ...rectScan(4000, 3000),
      openings: [{ type: 'door', wall: 0, offset: 0, width: 900, height: 2100 }],
      objects: [{ category: 'column', center: { x: 1, z: 1 }, width: 470, depth: 470, rotation: 0, shape: 'round' }],
      fixtures: [{ type: 'socket' }, { type: 'socket' }, { type: 'switch' }],
    };
    const rows = compareScan(scan, { openings: { door: 1 }, columns: [{ shape: 'round', diameterMm: 450 }], sockets: 3 });
    expect(rows.filter((r) => !r.pass).map((r) => r.check)).toEqual(['sockets']);
  });
});
