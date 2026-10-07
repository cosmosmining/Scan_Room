import { describe, expect, it } from 'vitest';
import { findPillars, mergePillars } from '@/systems/scan/pillarFinder';
import type { Pillar } from '@/systems/scan/wallLoop';
import { simulateScan, type SimBox, type SimRoom } from './helpers/sensorSim';

// ---------------------------------------------------------------------------
// Columns found from the depth readings of a scanning walk (helpers/sensorSim)
// — for the column RoomPlan reported badly or not at all. "If there is a round
// pillar in the middle of the house, from the floor to the ceiling, it must be
// scanned."
// ---------------------------------------------------------------------------

const ROOM = [{ x: 0, z: 0 }, { x: 6000, z: 0 }, { x: 6000, z: 5000 }, { x: 0, z: 5000 }];
const CEILING = 2600;

/** Everything in a living room that stands clear of the walls but is not a column. */
const FURNITURE: SimBox[] = [
  { x0: 1500, x1: 3700, z0: 4100, z1: 5000, y0: 0, y1: 850 },     // sofa
  { x0: 2000, x1: 3400, z0: 1500, z1: 2400, y0: 0, y1: 750 },     // dining table
  { x0: 5300, x1: 6000, z0: 300, z1: 1000, y0: 0, y1: 1800 },     // fridge
  { x0: 800, x1: 1800, z0: 2400, z1: 2750, y0: 0, y1: 2000 },     // freestanding bookcase, 2 m
  { x0: 2600, x1: 2800, z0: 1850, z1: 2050, y0: 1900, y1: 2600 }, // pendant lamp
  { x0: 0, x1: 600, z0: 2000, z1: 3200, y0: 0, y1: 2450 },        // pantry, nearly to the ceiling, against a wall
  { x0: 4600, x1: 4640, z0: 3500, z1: 3540, y0: 0, y1: 1800 },    // floor lamp
  { x0: 3800, x1: 4200, z0: 2800, z1: 3050, y0: 0, y1: 1700 },    // someone standing there
];

const room = (pillars: SimRoom['pillars'], extra: Partial<SimRoom> = {}): SimRoom => ({
  polygon: ROOM, ceiling: CEILING, pillars, ...extra,
});

describe('a column in the middle of the room', () => {
  it('finds a round pillar, floor to ceiling, day or night', () => {
    for (const daylight of [false, true]) {
      const found = findPillars(simulateScan(room([{ x: 3000, z: 2500, shape: 'round', width: 450 }]), { daylight, fill: 'wall' }), ROOM, CEILING);
      expect(found).toHaveLength(1);
      expect(found[0].shape).toBe('round');
      expect(Math.hypot(found[0].center.x - 3000, found[0].center.z - 2500)).toBeLessThanOrEqual(30);
      expect(Math.abs(found[0].width - 450)).toBeLessThanOrEqual(30);
    }
  });

  it('thin or fat', () => {
    for (const width of [300, 800]) {
      const [p] = findPillars(simulateScan(room([{ x: 3000, z: 2500, shape: 'round', width }]), { daylight: false, fill: 'wall' }), ROOM, CEILING);
      expect(p.shape).toBe('round');
      expect(Math.abs(p.width - width)).toBeLessThanOrEqual(30);
    }
  });

  it('finds a square one as a box, and a rectangular one the right way round', () => {
    const [sq] = findPillars(simulateScan(room([{ x: 2500, z: 2000, shape: 'box', width: 500 }]), { daylight: false, fill: 'wall' }), ROOM, CEILING);
    expect(sq.shape).toBe('box');
    expect(Math.hypot(sq.center.x - 2500, sq.center.z - 2000)).toBeLessThanOrEqual(30);
    expect(Math.abs(sq.width - 500)).toBeLessThanOrEqual(40);
    expect(Math.abs(sq.depth - 500)).toBeLessThanOrEqual(40);

    const [rect] = findPillars(simulateScan(room([{ x: 3500, z: 2600, shape: 'box', width: 400, depth: 600 }]), { daylight: false, fill: 'wall' }), ROOM, CEILING);
    expect(rect.shape).toBe('box');
    const across = [rect.width, rect.depth].sort((a, b) => a - b);
    expect(Math.abs(across[0] - 400)).toBeLessThanOrEqual(40);
    expect(Math.abs(across[1] - 600)).toBeLessThanOrEqual(40);
  });

  it('finds two, each as what it is', () => {
    const found = findPillars(simulateScan(room([
      { x: 2200, z: 2500, shape: 'round', width: 400 },
      { x: 4000, z: 2500, shape: 'box', width: 450 },
    ]), { daylight: true, fill: 'wall' }), ROOM, CEILING);
    expect(found.map((p) => p.shape)).toEqual(['round', 'box']);
  });

  it('from one side only, and on a hurried walk', () => {
    const oneSide = { path: [{ x: 900, z: 1000 }, { x: 5100, z: 1000 }, { x: 5100, z: 1300 }, { x: 900, z: 1300 }] };
    for (const shape of ['round', 'box'] as const) {
      const [a] = findPillars(simulateScan(room([{ x: 3000, z: 3000, shape, width: 500 }], oneSide), { daylight: false, fill: 'wall', seed: 5 }), ROOM, CEILING);
      expect(a.shape).toBe(shape);
      expect(Math.hypot(a.center.x - 3000, a.center.z - 3000)).toBeLessThanOrEqual(40);
      const [b] = findPillars(simulateScan(room([{ x: 3000, z: 2500, shape, width: 450 }]), { daylight: true, fill: 'wall', seed: 5, laps: 1, stepMm: 450 }), ROOM, CEILING);
      expect(b.shape).toBe(shape);
      expect(Math.hypot(b.center.x - 3000, b.center.z - 2500)).toBeLessThanOrEqual(40);
    }
  });

  it('in a 4.5 m room in sunlight, where the sensor never reaches the top of it', () => {
    const big = [{ x: 0, z: 0 }, { x: 8000, z: 0 }, { x: 8000, z: 6000 }, { x: 0, z: 6000 }];
    const r: SimRoom = { polygon: big, ceiling: 4500, pillars: [{ x: 4000, z: 3000, shape: 'round', width: 500 }] };
    const [p] = findPillars(simulateScan(r, { daylight: true, fill: 'wall' }), big, 4500);
    expect(p.shape).toBe('round');
    expect(Math.abs(p.width - 500)).toBeLessThanOrEqual(30);
  });

  it('350mm off a wall', () => {
    const [p] = findPillars(simulateScan(room([{ x: 3000, z: 575, shape: 'round', width: 450 }]), { daylight: false, fill: 'wall' }), ROOM, CEILING);
    expect(Math.abs(p.center.z - 575)).toBeLessThanOrEqual(30);
  });
});

describe('nothing that is not a column', () => {
  it('a furnished room — sofa, table, fridge, bookcase, lamps, pantry, a person — has no columns, over twelve walks', () => {
    for (let seed = 1; seed <= 12; seed++) {
      for (const daylight of [false, true]) {
        const rays = simulateScan(room([], { furniture: FURNITURE }), { daylight, fill: 'wall', seed });
        expect(findPillars(rays, ROOM, CEILING), `seed ${seed}`).toEqual([]);
      }
    }
  });

  it('…and the column among them is found, and measured without the furniture beside it', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const want = { x: 1800 + seed * 120, z: 3300, shape: seed % 2 ? 'round' as const : 'box' as const, width: 350 + seed * 30 };
      const found = findPillars(simulateScan(room([want], { furniture: FURNITURE }), { daylight: seed % 3 === 0, fill: 'wall', seed }), ROOM, CEILING);
      expect(found, `seed ${seed}`).toHaveLength(1);
      expect(found[0].shape).toBe(want.shape);
      expect(Math.hypot(found[0].center.x - want.x, found[0].center.z - want.z)).toBeLessThanOrEqual(40);
      expect(Math.abs(found[0].width - want.width)).toBeLessThanOrEqual(40);
    }
  });

  it('skips something RoomPlan already reported as furniture there', () => {
    const rays = simulateScan(room([{ x: 3000, z: 2500, shape: 'box', width: 500 }]), { daylight: false, fill: 'wall' });
    expect(findPillars(rays, ROOM, CEILING, [{ center: { x: 3000, z: 2500 }, width: 600, depth: 600, rotation: 0 }])).toEqual([]);
  });

  it('degrades to nothing on empty or broken input', () => {
    const rays = simulateScan(room([{ x: 3000, z: 2500, shape: 'round', width: 450 }]), { daylight: false, fill: 'wall', laps: 1, stepMm: 600 });
    expect(findPillars([], ROOM, CEILING)).toEqual([]);
    expect(findPillars(rays, ROOM.slice(0, 2), CEILING)).toEqual([]);
    expect(findPillars(rays, ROOM, 0)).toEqual([]);
  });
});

describe('merging with the columns RoomPlan reported', () => {
  const at = (x: number, z: number, extra: Partial<Pillar> = {}): Pillar => ({
    center: { x, z }, shape: 'box', width: 500, depth: 500, rotation: 0, ...extra,
  });

  it('keeps RoomPlan’s column, adds the ones only the depth found', () => {
    const merged = mergePillars([at(1000, 1000)], [at(1010, 990, { shape: 'round' }), at(3000, 3000)]);
    expect(merged).toEqual([at(1000, 1000), at(3000, 3000)]);
  });

  it('replaces a column RoomPlan saw one face of with what the depth found there', () => {
    const merged = mergePillars([at(1000, 1000, { partial: true })], [at(1100, 1250, { shape: 'round' })]);
    expect(merged).toEqual([at(1100, 1250, { shape: 'round' })]);
  });

  it('keeps the one-face column when the depth found nothing there', () => {
    expect(mergePillars([at(1000, 1000, { partial: true })], [])).toEqual([at(1000, 1000, { partial: true })]);
  });
});
