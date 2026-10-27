import { describe, expect, it } from 'vitest';
import { findCeiling } from '@/systems/scan/ceilingFinder';
import { simulateScan, type SimRoom } from './helpers/sensorSim';

// ---------------------------------------------------------------------------
// The ceiling from the depth readings: an expanded-metal mesh ceiling (the
// sensor sees through it to the slab), bulkheads along the windows, their
// edges at an angle or round a corner. Not wired into the scan yet.
// ---------------------------------------------------------------------------

type P = { x: number; z: number };
const W = 6000, D = 5000, H = 2700;
const ROOM: P[] = [{ x: 0, z: 0 }, { x: W, z: 0 }, { x: W, z: D }, { x: 0, z: D }];
const MESH = { open: 0.6, slab: 3400 };
const BULKHEAD = { polygon: [{ x: 0, z: 0 }, { x: W, z: 0 }, { x: W, z: 450 }, { x: 0, z: 450 }], bottom: 2350 };
const ANGLED = { polygon: [{ x: 0, z: 0 }, { x: W, z: 0 }, { x: W, z: 1100 }, { x: 0, z: 400 }], bottom: 2400 };
const ELL = { polygon: [{ x: 0, z: 0 }, { x: W, z: 0 }, { x: W, z: 500 }, { x: 600, z: 500 }, { x: 600, z: D }, { x: 0, z: D }], bottom: 2300 };

const rot = (p: P, deg: number, dx: number, dz: number): P => {
  const a = (deg * Math.PI) / 180;
  return { x: p.x * Math.cos(a) - p.z * Math.sin(a) + dx, z: p.x * Math.sin(a) + p.z * Math.cos(a) + dz };
};
/** The room as a real scan arrives: turned to wherever the iPad faced. */
const turned = (r: SimRoom, deg: number, dx: number, dz: number): SimRoom => ({
  ...r,
  polygon: r.polygon.map((p) => rot(p, deg, dx, dz)),
  soffits: r.soffits?.map((s) => ({ ...s, polygon: s.polygon.map((p) => rot(p, deg, dx, dz)) })),
});

/** Mean distance between two outlines' boundaries, both ways, mm. */
function edgeError(a: P[], b: P[]): number {
  const seg = (p: P, u: P, v: P) => {
    const dx = v.x - u.x, dz = v.z - u.z, l2 = dx * dx + dz * dz;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - u.x) * dx + (p.z - u.z) * dz) / l2)) : 0;
    return Math.hypot(p.x - u.x - dx * t, p.z - u.z - dz * t);
  };
  const toPoly = (p: P, poly: P[]) => Math.min(...poly.map((u, i) => seg(p, u, poly[(i + 1) % poly.length])));
  const samples = (poly: P[]) => poly.flatMap((u, i) => {
    const v = poly[(i + 1) % poly.length];
    const n = Math.max(1, Math.ceil(Math.hypot(v.x - u.x, v.z - u.z) / 20));
    return Array.from({ length: n }, (_, k) => ({ x: u.x + ((v.x - u.x) * k) / n, z: u.z + ((v.z - u.z) * k) / n }));
  });
  const d = [...samples(a).map((p) => toPoly(p, b)), ...samples(b).map((p) => toPoly(p, a))];
  return d.reduce((x, y) => x + y, 0) / d.length;
}

describe('the ceiling height', () => {
  it('a plain ceiling: its height, nothing else', () => {
    for (const daylight of [false, true]) {
      const f = findCeiling(simulateScan({ polygon: ROOM, ceiling: H }, { daylight, fill: 'wall', seed: 3 }), ROOM)!;
      expect(Math.abs(f.height - H)).toBeLessThanOrEqual(10);
      expect(f.seeThroughTo).toBeNull();
      expect(f.zones).toEqual([]);
    }
  });

  it('a mesh ceiling is the mesh, not the slab seen through it — 60% and 70% open, by day and night', () => {
    for (const open of [0.6, 0.7]) {
      for (const daylight of [false, true]) {
        const f = findCeiling(simulateScan({ polygon: ROOM, ceiling: H, ceilingMesh: { open, slab: 3400 } }, { daylight, fill: 'wall', seed: 3 }), ROOM)!;
        expect(Math.abs(f.height - H), `${open} open`).toBeLessThanOrEqual(10);
        expect(f.zones, `${open} open: no false recesses through the mesh`).toEqual([]);
      }
    }
  });

  it('…and says it is see-through, and how high the slab is', () => {
    const f = findCeiling(simulateScan({ polygon: ROOM, ceiling: H, ceilingMesh: MESH }, { daylight: false, fill: 'wall', seed: 3 }), ROOM)!;
    expect(Math.abs(f.seeThroughTo! - 3400)).toBeLessThanOrEqual(20);
  });
});

describe('bulkheads and their borders', () => {
  const cases: [string, SimRoom, P[], number][] = [
    ['a bulkhead along the window, under a mesh ceiling', { polygon: ROOM, ceiling: H, ceilingMesh: MESH, soffits: [BULKHEAD] }, BULKHEAD.polygon, 2350],
    ['a bulkhead whose edge runs at an angle', { polygon: ROOM, ceiling: H, soffits: [ANGLED] }, ANGLED.polygon, 2400],
    ['…under a mesh ceiling', { polygon: ROOM, ceiling: H, ceilingMesh: MESH, soffits: [ANGLED] }, ANGLED.polygon, 2400],
    ['an L-shaped bulkhead round a corner', { polygon: ROOM, ceiling: H, soffits: [ELL] }, ELL.polygon, 2300],
  ];
  for (const [name, room, outline, bottom] of cases) {
    it(`${name}: its height, and its outline to 80 mm`, () => {
      for (const [deg, dx, dz] of [[0, 0, 0], [23, -2400, 1800]] as const) {
        const r = deg ? turned(room, deg, dx, dz) : room;
        const f = findCeiling(simulateScan(r, { daylight: false, fill: 'wall', seed: 3 }), r.polygon)!;
        expect(Math.abs(f.height - H), `${deg}°`).toBeLessThanOrEqual(10);
        expect(f.zones, `${deg}°`).toHaveLength(1);
        expect(Math.abs(f.zones[0].height - bottom), `${deg}°`).toBeLessThanOrEqual(10);
        const truth = deg ? outline.map((p) => rot(p, deg, dx, dz)) : outline;
        expect(edgeError(truth, f.zones[0].polygon), `${deg}°`).toBeLessThanOrEqual(80);
      }
    });
  }
});
