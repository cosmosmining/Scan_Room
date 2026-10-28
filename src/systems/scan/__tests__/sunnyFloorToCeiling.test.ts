import { describe, expect, it } from 'vitest';
import { findGlass } from '@/systems/scan/glassFinder';
import { findPillars } from '@/systems/scan/pillarFinder';
import { simulateScan, type Patch, type SimRoom } from './helpers/sensorSim';
import { mulberry32 } from './helpers/roomGen';

// ---------------------------------------------------------------------------
// 落地窗 in the sun, and a round column in the middle of the room.
//
// Floor-to-ceiling glass on a sunny day: the sun blinds the depth sensor
// through the pane, so the finder has only "nothing measured here" and the
// blown-out camera to go on — and the sun on the solid wall beside the pane
// makes that wall hard to measure too, from far off. These hold the edges of
// the glass (left, right, floor, ceiling) and the column's shape, place and
// size to what the scanning walk (helpers/sensorSim) would really show.
// ---------------------------------------------------------------------------

const ROOM = [{ x: 0, z: 0 }, { x: 6000, z: 0 }, { x: 6000, z: 5000 }, { x: 0, z: 5000 }];
const COLUMN = { x: 3000, z: 2500, shape: 'round' as const, width: 450 };

const glass = (wall: number, t0: number, t1: number, ceiling: number): Patch => ({
  wall, t0, t1, y0: 0, y1: ceiling, surface: 'glass',
});

const scenes = (ceiling: number): Record<string, Patch[]> => ({
  'a 3 m pane in the middle of the wall': [glass(0, 1500, 4500, ceiling)],
  'the whole wall, corner to corner': [glass(0, 0, 6000, ceiling)],
  'two panes with a wall between': [glass(0, 800, 2800, ceiling), glass(0, 3200, 5200, ceiling)],
  'panes on two walls': [glass(0, 1500, 4500, ceiling), glass(1, 500, 4500, ceiling)],
});

/** Each pane found once, every edge within `tol` mm, nothing else found. */
function expectPanes(found: ReturnType<typeof findGlass>, want: Patch[], tol: number, what: string) {
  expect(found, what).toHaveLength(want.length);
  for (const p of want) {
    const o = found.find((f) => f.wall === p.wall && f.offset < p.t1 && f.offset + f.width > p.t0);
    expect(o, `${what}: pane ${p.t0}–${p.t1}`).toBeDefined();
    expect(Math.abs(o!.offset - p.t0), `${what}: left edge`).toBeLessThanOrEqual(tol);
    expect(Math.abs(o!.offset + o!.width - p.t1), `${what}: right edge`).toBeLessThanOrEqual(tol);
    expect(o!.sill, `${what}: from the floor`).toBe(0);
    expect(Math.abs(o!.height - p.y1), `${what}: to the ceiling`).toBeLessThanOrEqual(tol);
    expect(o!.type).toBe('door');
  }
}

function expectColumn(found: ReturnType<typeof findPillars>, what: string) {
  expect(found, what).toHaveLength(1);
  expect(found[0].shape, what).toBe('round');
  expect(Math.hypot(found[0].center.x - COLUMN.x, found[0].center.z - COLUMN.z), `${what}: centre`).toBeLessThanOrEqual(30);
  expect(Math.abs(found[0].width - COLUMN.width), `${what}: diameter`).toBeLessThanOrEqual(30);
}

describe('落地窗 on a sunny day, with a round column in the middle', () => {
  for (const ceiling of [2600, 3000]) {
    for (const [name, panes] of Object.entries(scenes(ceiling))) {
      it(`${name}, ${ceiling / 1000} m ceiling — in sun and in harsh sun`, () => {
        const room: SimRoom = { polygon: ROOM, ceiling, patches: panes, pillars: [COLUMN] };
        for (const harsh of [false, true]) {
          for (const fill of ['wall', 'none'] as const) {
            const what = `${harsh ? 'harsh sun' : 'sun'}, ARKit fill ${fill}`;
            const rays = simulateScan(room, { daylight: true, harsh, fill, seed: harsh ? 2 : 1 });
            expectPanes(findGlass(rays, ROOM, ceiling), panes, 0, what);
            expectColumn(findPillars(rays, ROOM, ceiling), what);
          }
        }
      });
    }
  }

  it('across 20 rooms of every size, pane and column: edges within 100 mm, column to 30 mm', () => {
    const rnd = mulberry32(2026);
    for (let k = 0; k < 20; k++) {
      const W = 5000 + Math.round(rnd() * 3000), D = 4500 + Math.round(rnd() * 2000);
      const ceiling = [2500, 2600, 2800, 3000, 3200][k % 5];
      const poly = [{ x: 0, z: 0 }, { x: W, z: 0 }, { x: W, z: D }, { x: 0, z: D }];
      const wall = k % 2 ? 0 : 1;
      const along = wall === 0 ? W : D;
      const pane = glass(wall, Math.round(rnd() * 150) * 10, along - Math.round(rnd() * 150) * 10, ceiling);
      const column = { x: W / 2 + (rnd() - 0.5) * 1200, z: D / 2 + (rnd() - 0.5) * 800, shape: 'round' as const, width: 300 + Math.round(rnd() * 500) };
      const room: SimRoom = { polygon: poly, ceiling, patches: [pane], pillars: [column] };
      const rays = simulateScan(room, { daylight: true, harsh: k % 3 === 0, fill: (['wall', 'beyond', 'none'] as const)[k % 3], seed: k + 1 });
      expectPanes(findGlass(rays, poly, ceiling), [pane], 100, `room ${k}`);
      const [c, ...more] = findPillars(rays, poly, ceiling);
      expect(more, `room ${k}`).toEqual([]);
      expect(c.shape, `room ${k}`).toBe('round');
      expect(Math.hypot(c.center.x - column.x, c.center.z - column.z), `room ${k}: centre`).toBeLessThanOrEqual(30);
      expect(Math.abs(c.width - column.width), `room ${k}: diameter`).toBeLessThanOrEqual(30);
    }
  });

  it('a sunlit solid wall where the glass would be is not glass', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const room: SimRoom = {
        polygon: ROOM, ceiling: 3000, pillars: [COLUMN],
        patches: [{ wall: 0, t0: 800, t1: 5200, y0: 0, y1: 1500, surface: 'sunlit' }],
      };
      const rays = simulateScan(room, { daylight: true, harsh: seed % 2 === 0, fill: 'wall', seed });
      expect(findGlass(rays, ROOM, 3000), `seed ${seed}`).toEqual([]);
    }
  });
});
