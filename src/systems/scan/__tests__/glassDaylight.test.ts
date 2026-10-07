import { describe, expect, it } from 'vitest';
import { findGlass, type DepthRay } from '@/systems/scan/glassFinder';
import { asFirstVersionBanked, simulateScan, type Patch, type SimRoom } from './helpers/sensorSim';

// ---------------------------------------------------------------------------
// Glass, judged on what an iPad's depth sensor would actually report on a
// scanning walk (helpers/sensorSim.ts) — in daylight, at night, from a high
// floor and over a balcony.
//
// The field report was "有玻璃偵測不到", worst in the daytime. The first version
// only listened to confident readings that landed on something behind the
// glass. In daylight the sun blinds the LiDAR through the pane, and from a high
// floor there is nothing behind it within reach, so it was given no evidence
// at all. These tests reproduce that, and hold the fix to it.
// ---------------------------------------------------------------------------

const ROOM = [{ x: 0, z: 0 }, { x: 6000, z: 0 }, { x: 6000, z: 5000 }, { x: 0, z: 5000 }];
const CEILING = 2600;
/** A sliding glass door, floor to 2.3 m, in the z = 0 wall. */
const DOOR: Patch = { wall: 0, t0: 1800, t1: 4200, y0: 0, y1: 2300, surface: 'glass' };
/** A window in the x = 6000 wall, 900 → 2100. */
const WINDOW: Patch = { wall: 1, t0: 1000, t1: 2600, y0: 900, y1: 2100, surface: 'glass' };

const glassRoom = (patches: Patch[], balconyMm: number | null = null): SimRoom => ({
  polygon: ROOM, ceiling: CEILING, patches, balconyMm,
});

/** A room with nothing see-through in it, and the things that try to look it. */
const SOLID: SimRoom = {
  polygon: ROOM,
  ceiling: CEILING,
  patches: [
    // Sun falling on the far wall: blown out, and harder to measure.
    { wall: 2, t0: 1500, t1: 3500, y0: 0, y1: 1500, surface: 'sunlit' },
    // A dark feature wall panel: low reflectance, weak returns.
    { wall: 3, t0: 1000, t1: 2500, y0: 800, y1: 2000, surface: 'dark' },
  ],
  furniture: [{ x0: 1500, x1: 3700, z0: 4100, z1: 5000, y0: 0, y1: 850 }],
};

const expectDoor = (found: ReturnType<typeof findGlass>) => {
  const door = found.find((o) => o.wall === 0);
  expect(door, JSON.stringify(found)).toBeDefined();
  expect(door!.type).toBe('door');
  expect(door!.sill).toBe(0);
  expect(Math.abs(door!.offset - 1800)).toBeLessThanOrEqual(100);
  expect(Math.abs(door!.width - 2400)).toBeLessThanOrEqual(200);
  expect(Math.abs(door!.height - 2300)).toBeLessThanOrEqual(100);
};

describe('glass in daylight — the field bug', () => {
  it('the first version found nothing; this finds the sliding door', () => {
    // Daylight, and ARKit painting its guess for the pane at the depth of the
    // wall around it — the worst case, and the common one.
    const rays = simulateScan(glassRoom([DOOR], 1500), { daylight: true, fill: 'wall' });
    expect(findGlass(asFirstVersionBanked(rays), ROOM, CEILING)).toEqual([]);
    expectDoor(findGlass(rays, ROOM, CEILING));
  });

  it('whatever ARKit guesses for the pane — far beyond it, or no depth at all', () => {
    for (const fill of ['beyond', 'none'] as const) {
      const rays = simulateScan(glassRoom([DOOR]), { daylight: true, fill });
      expect(findGlass(asFirstVersionBanked(rays), ROOM, CEILING)).toEqual([]);
      expectDoor(findGlass(rays, ROOM, CEILING));
    }
  });

  it('finds a window and measures its sill', () => {
    const found = findGlass(simulateScan(glassRoom([WINDOW]), { daylight: true, fill: 'wall' }), ROOM, CEILING);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ wall: 1, type: 'window' });
    expect(Math.abs(found[0].offset - 1000)).toBeLessThanOrEqual(100);
    expect(Math.abs(found[0].width - 1600)).toBeLessThanOrEqual(200);
    expect(Math.abs(found[0].sill - 900)).toBeLessThanOrEqual(100);
    expect(Math.abs(found[0].height - 1200)).toBeLessThanOrEqual(200);
  });

  it('holds up under harsher sun and a hurried, sparse walk', () => {
    const rays = simulateScan(glassRoom([DOOR, WINDOW]), { daylight: true, fill: 'wall', harsh: true, laps: 1, stepMm: 450 });
    const found = findGlass(rays, ROOM, CEILING);
    expect(found.map((o) => o.wall)).toEqual([0, 1]);
  });

  it('does not need the camera brightness to find it', () => {
    const rays = simulateScan(glassRoom([DOOR]), { daylight: true, fill: 'wall' })
      .map(({ eye, hit, confidence }): DepthRay => ({ eye, hit, confidence }));
    expectDoor(findGlass(rays, ROOM, CEILING));
  });
});

describe('glass at night', () => {
  it('from a high floor, with nothing behind the glass in reach', () => {
    const rays = simulateScan(glassRoom([DOOR]), { daylight: false, fill: 'wall' });
    expect(findGlass(asFirstVersionBanked(rays), ROOM, CEILING)).toEqual([]);
    expectDoor(findGlass(rays, ROOM, CEILING));
  });

  it('over a balcony: the first version saw only the part above the parapet; this sees all of it', () => {
    const rays = simulateScan(glassRoom([DOOR], 1500), { daylight: false, fill: 'wall' });
    const first = findGlass(asFirstVersionBanked(rays), ROOM, CEILING);
    expect(first).toHaveLength(1);
    expect(first[0].height).toBeLessThan(2000);
    expectDoor(findGlass(rays, ROOM, CEILING));
  });
});

describe('no glass where there is none', () => {
  it('a sunlit wall, a dark panel and a sofa are not glass — day or night, five walks each', () => {
    for (let seed = 1; seed <= 5; seed++) {
      for (const daylight of [true, false]) {
        const rays = simulateScan(SOLID, { daylight, fill: 'wall', seed });
        expect(findGlass(rays, ROOM, CEILING), `seed ${seed}, daylight ${daylight}`).toEqual([]);
      }
    }
  });

  it('…nor on a hurried walk under harsh sun', () => {
    const rays = simulateScan(SOLID, { daylight: true, fill: 'wall', harsh: true, laps: 1, stepMm: 450 });
    expect(findGlass(rays, ROOM, CEILING)).toEqual([]);
  });

  it('a column standing in front of the glass hides some of it, and is not glass itself', () => {
    const room: SimRoom = { ...glassRoom([DOOR]), pillars: [{ x: 3000, z: 2000, shape: 'round', width: 450 }] };
    const found = findGlass(simulateScan(room, { daylight: true, fill: 'wall' }), ROOM, CEILING);
    expect(found).toHaveLength(1);
    expectDoor(found);
  });

  it('a television RoomPlan recognised is not suggested as a window', () => {
    // On, it is bright and glossy — to the sensor, a pane of daylight. The
    // iPad passes RoomPlan's televisions in as already accounted for.
    const tv: Patch = { wall: 2, t0: 2000, t1: 3200, y0: 900, y1: 1600, surface: 'tv' };
    const rays = simulateScan(glassRoom([tv]), { daylight: true, fill: 'wall' });
    expect(findGlass(rays, ROOM, CEILING).some((o) => o.wall === 2)).toBe(true);
    expect(findGlass(rays, ROOM, CEILING, [{ wall: 2, offset: 2000, width: 1200 }])).toEqual([]);
  });

  it('a mirror IS suggested — the sensor cannot tell it from a window, which is why it is a suggestion', () => {
    const mirror: Patch = { wall: 3, t0: 1500, t1: 2500, y0: 900, y1: 2000, surface: 'mirror' };
    const found = findGlass(simulateScan(glassRoom([mirror]), { daylight: false, fill: 'wall' }), ROOM, CEILING);
    expect(found).toHaveLength(1);
    expect(found[0].wall).toBe(3);
  });
});

describe('what a no-return reading may and may not count for', () => {
  // Wall 0 is z = 0. A low-confidence reading is ARKit saying "nothing here
  // that I could measure"; it only counts against a wall that should have
  // been measurable.
  const pane = (eyeZ: number, eyeX: (x: number) => number, confidence: number): DepthRay[] => {
    const rays: DepthRay[] = [];
    for (let x = 1500; x <= 2500; x += 40) {
      for (let y = 900; y <= 1900; y += 40) {
        const eye = { x: eyeX(x), y: 1400, z: eyeZ };
        rays.push({ eye, hit: { x, y, z: 0 }, confidence, luma: 250 });
      }
    }
    return rays;
  };

  it('looked at squarely from 2 m, it is evidence of glass', () => {
    expect(findGlass(pane(2000, (x) => x, 0), ROOM, CEILING)).toHaveLength(1);
  });

  it('the same readings with confidence are a solid wall', () => {
    expect(findGlass(pane(2000, (x) => x, 2), ROOM, CEILING)).toEqual([]);
    expect(findGlass(pane(2000, (x) => x, 1), ROOM, CEILING)).toEqual([]);
  });

  it('from across a big room, nothing — a solid wall that far off returns little either', () => {
    expect(findGlass(pane(4800, (x) => x, 0), [
      { x: 0, z: 0 }, { x: 6000, z: 0 }, { x: 6000, z: 6000 }, { x: 0, z: 6000 },
    ], CEILING)).toEqual([]);
  });

  it('seen edge-on while walking past, nothing — a wall at a grazing angle returns nothing even when solid', () => {
    expect(findGlass(pane(500, (x) => x + 3000, 0), ROOM, CEILING)).toEqual([]);
  });
});
