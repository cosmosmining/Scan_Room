import { describe, expect, it } from 'vitest';
import { bulkheadGeometry } from '../bulkhead';

type P = { x: number; z: number };

function inside(poly: P[], x: number, z: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) hit = !hit;
  }
  return hit;
}

/** Each triangle's face normal and centre, from the geometry's own winding. */
function faces(poly: P[], bottom: number, top: number) {
  const pos = bulkheadGeometry(poly, bottom, top).getAttribute('position');
  const out: { n: [number, number, number]; c: [number, number, number] }[] = [];
  for (let i = 0; i < pos.count; i += 3) {
    const [a, b, c] = [i, i + 1, i + 2].map((k) => [pos.getX(k), pos.getY(k), pos.getZ(k)]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n: [number, number, number] = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(...n);
    out.push({
      n: [n[0] / len, n[1] / len, n[2] / len],
      c: [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3],
    });
  }
  return out;
}

const straight: P[] = [{ x: 0, z: 0 }, { x: 6000, z: 0 }, { x: 6000, z: 600 }, { x: 0, z: 600 }];
const angled: P[] = [{ x: 0, z: 0 }, { x: 6000, z: 0 }, { x: 6000, z: 400 }, { x: 0, z: 1200 }];
const lShape: P[] = [
  { x: 0, z: 0 }, { x: 6000, z: 0 }, { x: 6000, z: 600 }, { x: 700, z: 600 }, { x: 700, z: 5000 }, { x: 0, z: 5000 },
];

describe('bulkheadGeometry', () => {
  for (const [name, poly] of [['straight', straight], ['angled', angled], ['L-shaped', lShape]] as const) {
    for (const wind of ['ccw', 'cw'] as const) {
      it(`${name}, ${wind}: underside faces down at its height, every side faces out`, () => {
        const outline = wind === 'cw' ? [...poly].reverse() : poly;
        const all = faces(outline, 2350, 2700);
        const under = all.filter((f) => Math.abs(f.n[1]) > 0.99);
        const sides = all.filter((f) => Math.abs(f.n[1]) < 0.01);
        expect(under.length + sides.length).toBe(all.length);
        expect(sides.length).toBe(outline.length * 2);
        for (const f of under) {
          expect(f.n[1]).toBeLessThan(0);
          expect(f.c[1]).toBeCloseTo(2350, 6);
        }
        // Step 5 mm off each side along its normal: that must leave the outline.
        for (const f of sides) {
          expect(inside(outline, f.c[0] + f.n[0] * 5, f.c[2] + f.n[2] * 5)).toBe(false);
          expect(inside(outline, f.c[0] - f.n[0] * 5, f.c[2] - f.n[2] * 5)).toBe(true);
        }
        // The underside covers the outline's whole area.
        let area = 0;
        const pos = bulkheadGeometry(outline, 2350, 2700).getAttribute('position');
        for (let i = 0; i < under.length * 3; i += 3) {
          const ax = pos.getX(i), az = pos.getZ(i);
          const bx = pos.getX(i + 1), bz = pos.getZ(i + 1);
          const cx = pos.getX(i + 2), cz = pos.getZ(i + 2);
          area += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
        }
        let shoelace = 0;
        for (let i = 0; i < outline.length; i++) {
          const a = outline[i];
          const b = outline[(i + 1) % outline.length];
          shoelace += a.x * b.z - b.x * a.z;
        }
        expect(area).toBeCloseTo(Math.abs(shoelace) / 2, 0);
      });
    }
  }

  it('draws nothing for a bad outline or no drop', () => {
    expect(bulkheadGeometry(straight.slice(0, 2), 2350, 2700).getAttribute('position')).toBeUndefined();
    expect(bulkheadGeometry(straight, 2700, 2700).getAttribute('position')).toBeUndefined();
  });
});
