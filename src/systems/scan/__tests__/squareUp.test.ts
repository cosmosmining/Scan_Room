import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseScan, type RoomScan } from '@mozu/scan-sdk';
import { dominantWallAngle, squareUp } from '@/systems/scan/squareUp';

const GOLDEN = parseScan(readFileSync('fixtures/scans/synthetic-l-room.scan.json', 'utf8'))!;

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
  };
};

const close = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z) < 1e-6;

describe('squaring a scanned room up with the page', () => {
  it('leaves a room already square at the origin exactly as it is', () => {
    expect(squareUp(GOLDEN)).toEqual(GOLDEN);
  });

  it('turns a room scanned at a small angle back to how it was drawn', () => {
    for (const deg of [3, 23, -31, 44]) {
      const back = squareUp(turned(GOLDEN, deg, -2400, 7100));
      back.polygon.forEach((p, i) => expect(close(p, GOLDEN.polygon[i]), `${deg}° corner ${i}`).toBe(true));
      back.objects.forEach((o, i) => {
        expect(close(o.center, GOLDEN.objects[i].center), `${deg}° object ${i}`).toBe(true);
        expect(o.rotation).toBeCloseTo(GOLDEN.objects[i].rotation, 9);
      });
    }
  });

  it('keeps every opening and fixture on its wall, where it was along it', () => {
    const back = squareUp(turned(GOLDEN, 23, 500, 500));
    expect(back.openings).toEqual(GOLDEN.openings);
    expect(back.fixtures).toEqual(GOLDEN.fixtures);
  });

  it('squares a larger turn by the smallest angle, keeping the walls in order', () => {
    const back = squareUp(turned(GOLDEN, 113, 0, 0)); // 113° = 90° + 23°
    for (let i = 0; i < back.polygon.length; i++) {
      const a = back.polygon[i];
      const b = back.polygon[(i + 1) % back.polygon.length];
      // Every wall now runs along an axis…
      expect(Math.min(Math.abs(a.x - b.x), Math.abs(a.z - b.z))).toBeLessThan(1e-6);
      // …and is as long as it was.
      const g0 = GOLDEN.polygon[i];
      const g1 = GOLDEN.polygon[(i + 1) % GOLDEN.polygon.length];
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeCloseTo(Math.hypot(g1.x - g0.x, g1.z - g0.z), 6);
    }
    expect(Math.min(...back.polygon.map((p) => p.x))).toBeCloseTo(0, 6);
    expect(Math.min(...back.polygon.map((p) => p.z))).toBeCloseTo(0, 6);
  });

  it('follows the long walls, not a short angled one', () => {
    // A rectangle with one corner cut off at 45°.
    const cut = [
      { x: 0, z: 0 }, { x: 5000, z: 0 }, { x: 5000, z: 3500 },
      { x: 4500, z: 4000 }, { x: 0, z: 4000 },
    ];
    expect(dominantWallAngle(cut)).toBeCloseTo(0, 9);
  });
});
