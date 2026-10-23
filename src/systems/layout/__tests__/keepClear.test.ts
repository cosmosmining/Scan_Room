import { describe, expect, it } from 'vitest';
import type { ModuleInstance, Room, WallOpening } from '@/lib/types';
import { createDefaultRoom } from '@/lib/defaults';
import {
  DEFAULT_RULES,
  buildRuns,
  detectOpeningObstruction,
  generateLayout,
  inwardNormal,
  type LayoutFixture,
  type LayoutObstacle,
  type Placement,
  type PlacementModule,
} from '@/systems/layout';

// ---------------------------------------------------------------------------
// Cabinets are packed clear of what the scan found on and by the walls:
// windows, sockets and pipes, columns — and of each other across the bands.
// The default room is 4000 × 3000; wall_0 runs (0,0) → (4000,0).
// ---------------------------------------------------------------------------

const unit = (id: string, width: number, extra: Partial<PlacementModule> = {}): PlacementModule => ({
  definitionId: id,
  category: 'kitchen-base',
  mount: 'floor',
  width,
  depth: 600,
  height: 900,
  ...extra,
});
const wallCab = (id: string, width = 600) =>
  unit(id, width, { category: 'kitchen-wall', mount: 'wall', elevation: 1500, height: 720, depth: 350 });

const roomWith = (openings: WallOpening[]): Room => {
  const room = createDefaultRoom();
  room.walls[0].openings = openings;
  return room;
};
const window_ = (offset: number, width: number, sill = 900, height = 1200): WallOpening => ({
  id: `win${offset}`, type: 'window', offset, width, height, sillHeight: sill,
});

/** [start, end] along the wall of each placed unit, by id. */
const spans = (res: ReturnType<typeof generateLayout>) =>
  Object.fromEntries(res.placements.map((p) => [p.module.definitionId, [p.offset, p.offset + p.module.width]]));
const overlaps = ([a0, a1]: number[], b0: number, b1: number) => a0 < b1 && b0 < a1;

describe('windows', () => {
  it('base units run under a window; wall cabinets and the hood are hung either side of it', () => {
    const res = generateLayout({
      room: roomWith([window_(1200, 1400)]),
      assignments: [{
        wallId: 'wall_0',
        modules: [
          unit('b1', 600), unit('b2', 600), unit('b3', 600), unit('b4', 600),
          wallCab('w1'), wallCab('w2'), wallCab('w3'),
          unit('hood', 600, { category: 'appliance', mount: 'wall', elevation: 1500, height: 400, depth: 350 }),
        ],
      }],
    });
    const at = spans(res);
    expect(at.b1).toEqual([0, 600]);
    expect(at.b3).toEqual([1200, 1800]); // straight under the glass
    for (const id of ['w1', 'w2', 'w3', 'hood']) expect(overlaps(at[id], 1200, 2600), id).toBe(false);
    expect(res.unplaced).toEqual([]);
    expect(res.violations.filter((v) => v.severity === 'error')).toEqual([]);
  });

  it('a tall unit or a fridge does not stand in front of the glass either', () => {
    const res = generateLayout({
      room: roomWith([window_(0, 1000)]),
      assignments: [{ wallId: 'wall_0', modules: [unit('tall', 600, { height: 2100 })] }],
    });
    expect(res.placements[0].offset).toBeGreaterThanOrEqual(1000);
  });

  it('a low window still stops the base units, as before', () => {
    const res = generateLayout({
      room: roomWith([window_(0, 1000, 500)]),
      assignments: [{ wallId: 'wall_0', modules: [unit('b', 600)] }],
    });
    expect(res.placements[0].offset).toBeGreaterThanOrEqual(1000);
  });

  it('a wall cabinet dragged over a window by hand is reported', () => {
    const run = buildRuns(roomWith([window_(1200, 1400)]), ['wall_0'], DEFAULT_RULES).get('wall_0')!;
    const placement: Placement = { module: wallCab('w'), run, offset: 1500 };
    const inst = { id: 'i', definitionId: 'w', position: { x: 0, y: 0, z: 0 }, rotationY: 0, selectedOptionIds: [] } as ModuleInstance;
    expect(detectOpeningObstruction([placement], [inst]).map((v) => v.kind)).toEqual(['obstruction']);
    // …but a base unit under the same window is not.
    expect(detectOpeningObstruction([{ ...placement, module: unit('b', 600) }], [inst])).toEqual([]);
  });
});

describe('sockets and pipes', () => {
  const socket = (offset: number, height: number): LayoutFixture => ({
    id: `s${offset}`, type: 'socket', wallId: 'wall_0', offset, height,
  });

  it('a low socket keeps base units off it and its access gap', () => {
    const res = generateLayout({
      room: createDefaultRoom(),
      assignments: [{ wallId: 'wall_0', modules: [unit('b1', 600), unit('b2', 600)] }],
      fixtures: [socket(900, 300)],
    });
    const at = spans(res);
    for (const id of ['b1', 'b2']) expect(overlaps(at[id], 750, 1050), id).toBe(false);
    expect(res.violations).toEqual([]);
  });

  it('a socket above the worktop leaves both bands alone', () => {
    const res = generateLayout({
      room: createDefaultRoom(),
      assignments: [{ wallId: 'wall_0', modules: [unit('b', 600), wallCab('w')] }],
      fixtures: [socket(300, 1100)],
    });
    expect(spans(res)).toEqual({ b: [0, 600], w: [0, 600] });
  });

  it('a sink base still goes over its water and waste', () => {
    const res = generateLayout({
      room: createDefaultRoom(),
      assignments: [{ wallId: 'wall_0', modules: [unit('sink', 800, { connectsUtilities: ['water', 'waste'] })] }],
      fixtures: [
        { id: 'w', type: 'water', wallId: 'wall_0', offset: 300, height: 400 },
        { id: 'd', type: 'waste', wallId: 'wall_0', offset: 500, height: 300 },
      ],
    });
    expect(res.placements[0].offset).toBe(0);
    expect(res.violations).toEqual([]);
  });
});

describe('columns', () => {
  const column = (x: number, z: number, size = 400, shape: 'box' | 'round' = 'box'): LayoutObstacle => ({
    id: `c${x}`, center: { x, z }, width: size, depth: size, rotation: 0, shape,
  });

  it('a column against the wall stops every band where it stands', () => {
    const res = generateLayout({
      room: createDefaultRoom(),
      assignments: [{ wallId: 'wall_0', modules: [unit('b1', 600), unit('b2', 600), wallCab('w1'), wallCab('w2')] }],
      obstacles: [column(900, 200)], // x 700–1100, against the wall
    });
    const at = spans(res);
    for (const id of ['b1', 'b2', 'w1', 'w2']) expect(overlaps(at[id], 700, 1100), id).toBe(false);
  });

  it('a round one too', () => {
    const res = generateLayout({
      room: createDefaultRoom(),
      assignments: [{ wallId: 'wall_0', modules: [unit('b1', 600), unit('b2', 600)] }],
      obstacles: [column(900, 225, 450, 'round')],
    });
    for (const id of ['b1', 'b2']) expect(overlaps(spans(res)[id], 675, 1125), id).toBe(false);
  });

  it('one standing 400 mm off the wall stops base units but lets a wall cabinet hang behind it', () => {
    const res = generateLayout({
      room: createDefaultRoom(),
      assignments: [{ wallId: 'wall_0', modules: [unit('b', 600), wallCab('w')] }],
      obstacles: [column(300, 600)], // its near face is 400 mm off the wall
    });
    expect(spans(res).b[0]).toBeGreaterThanOrEqual(500);
    expect(spans(res).w).toEqual([0, 600]);
  });

  it('one out in the room is not in any run’s way', () => {
    const res = generateLayout({
      room: createDefaultRoom(),
      assignments: [{ wallId: 'wall_0', modules: [unit('b', 600)] }],
      obstacles: [column(300, 1500)],
    });
    expect(spans(res).b).toEqual([0, 600]);
  });

  it('a turned box column is measured along its real outline', () => {
    // 1000 × 200, turned 90°: 200 along the wall, 1000 out from it.
    const res = generateLayout({
      room: createDefaultRoom(),
      assignments: [{ wallId: 'wall_0', modules: [unit('b1', 600), unit('b2', 600)] }],
      obstacles: [{ id: 'fin', center: { x: 700, z: 500 }, width: 1000, depth: 200, rotation: Math.PI / 2, shape: 'box' }],
    });
    for (const id of ['b1', 'b2']) expect(overlaps(spans(res)[id], 600, 800), id).toBe(false);
  });
});

describe('the bands and the corners', () => {
  it('a wall cabinet is not hung into the tall unit below it', () => {
    const res = generateLayout({
      room: createDefaultRoom(),
      assignments: [{ wallId: 'wall_0', modules: [unit('tall', 600, { height: 2100 }), unit('b', 600), wallCab('w')] }],
    });
    expect(spans(res).w).toEqual([600, 1200]);
    expect(res.violations.filter((v) => v.kind === 'collision')).toEqual([]);
  });

  it('a unit deeper than the corner reserve does not reach into the next run', () => {
    // wall_0 ends where wall_1 starts. A 650 mm fridge at the end of wall_0.
    const res = generateLayout({
      room: createDefaultRoom(),
      assignments: [
        { wallId: 'wall_0', modules: [unit('b', 3350), unit('fridge', 650, { depth: 650, height: 2000 })] },
        { wallId: 'wall_1', modules: [unit('next', 600)] },
      ],
    });
    expect(res.violations.filter((v) => v.kind === 'collision')).toEqual([]);
    expect(res.placements.find((p) => p.module.definitionId === 'next')!.offset).toBeGreaterThanOrEqual(650);
  });
});

describe('which side of a wall the room is on', () => {
  // An L: the walls around the inside corner have the centroid on their
  // OUTSIDE, which is where the old rule pointed.
  const L = [
    { x: 0, z: 0 }, { x: 6000, z: 0 }, { x: 6000, z: 2500 },
    { x: 3000, z: 2500 }, { x: 3000, z: 5000 }, { x: 0, z: 5000 },
  ];

  it('points into an L-shaped room from every wall, the inside corner included', () => {
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      const b = L[(i + 1) % L.length];
      const n = inwardNormal(a, b, L);
      const probe = { x: (a.x + b.x) / 2 + n.x * 100, z: (a.z + b.z) / 2 + n.z * 100 };
      // 100 mm in from the middle of each wall is inside the L.
      const inside = probe.x > 0 && probe.z > 0 && (probe.x < 3000 ? probe.z < 5000 : probe.x < 6000 && probe.z < 2500);
      expect(inside, `wall ${i}`).toBe(true);
    }
  });

  it('whichever way round the corners are listed', () => {
    const reversed = [...L].reverse();
    expect(inwardNormal(L[2], L[3], reversed)).toEqual(inwardNormal(L[2], L[3], L));
  });
});
