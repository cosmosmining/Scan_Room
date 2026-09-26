import { describe, expect, it } from 'vitest';
import { wallLoop, type LoopPoint, type LoopSegment } from '../wallLoop';

const area = (p: LoopPoint[]): number => {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    s += a.x * b.z - b.x * a.z;
  }
  return Math.abs(s) / 2;
};

/**
 * Largest distance from the line z = `value` among the vertices that belong to
 * THAT wall. Vertices more than `band` away are on some other wall of the room
 * and would otherwise swamp the measurement.
 */
const maxDeviationFromZ = (
  p: LoopPoint[],
  value: number,
  xLo: number,
  xHi: number,
  band = 1500,
): number => {
  const onWall = p.filter(
    (q) => q.x >= xLo - 1 && q.x <= xHi + 1 && Math.abs(q.z - value) <= band,
  );
  expect(onWall.length, 'the wall has vertices to measure').toBeGreaterThan(0);
  return Math.max(0, ...onWall.map((q) => Math.abs(q.z - value)));
};

const rect = (w: number, d: number): LoopSegment[] => [
  { a: { x: 0, z: 0 }, b: { x: w, z: 0 } },
  { a: { x: w, z: 0 }, b: { x: w, z: d } },
  { a: { x: w, z: d }, b: { x: 0, z: d } },
  { a: { x: 0, z: d }, b: { x: 0, z: 0 } },
];

describe('a clean room survives untouched', () => {
  it('returns the four corners of a rectangle', () => {
    const loop = wallLoop(rect(4000, 3000));
    expect(loop).toHaveLength(4);
    expect(area(loop)).toBeCloseTo(12_000_000, -2);
  });

  it('keeps a genuinely angled wall', () => {
    // A room must not be forced square. This one has a splayed corner.
    const loop = wallLoop([
      { a: { x: 0, z: 0 }, b: { x: 3000, z: 0 } },
      { a: { x: 3000, z: 0 }, b: { x: 4000, z: 1200 } },
      { a: { x: 4000, z: 1200 }, b: { x: 4000, z: 3000 } },
      { a: { x: 4000, z: 3000 }, b: { x: 0, z: 3000 } },
      { a: { x: 0, z: 3000 }, b: { x: 0, z: 0 } },
    ]);
    expect(loop).toHaveLength(5);
    // The splayed vertex is still there, near where it was reported.
    expect(loop.some((p) => Math.abs(p.x - 3000) < 60 && Math.abs(p.z) < 60)).toBe(true);
  });
});

describe('shoes against a wall', () => {
  // The reported failure: shoes occlude part of the z = 0 wall, the scanner
  // splits it in two, and fits the second fragment 150mm into the room.
  const occluded: LoopSegment[] = [
    { a: { x: 0, z: 0 }, b: { x: 1500, z: 0 } },
    { a: { x: 2000, z: 150 }, b: { x: 4000, z: 150 } },
    { a: { x: 4000, z: 150 }, b: { x: 4000, z: 3000 } },
    { a: { x: 4000, z: 3000 }, b: { x: 0, z: 3000 } },
    { a: { x: 0, z: 3000 }, b: { x: 0, z: 0 } },
  ];

  it('does not tilt the wall across its whole length', () => {
    // The old chaining produced the chord (1500,0)→(4000,150): a wall that is
    // straight in reality, running diagonally across the plan, 150mm out at the
    // far end because of 500mm of shoes.
    const loop = wallLoop(occluded);
    expect(maxDeviationFromZ(loop, 0, 0, 4000)).toBeLessThanOrEqual(30);
  });

  it('takes the OUTERMOST fragment, not the average of the two', () => {
    // An average would land at z = 75 and be wrong everywhere. Occlusion cannot
    // put a surface further out than the wall, so the outer fragment wins.
    const loop = wallLoop(occluded);
    const onThatWall = loop.filter((p) => p.z < 500);
    expect(onThatWall.length).toBeGreaterThan(0);
    for (const p of onThatWall) expect(p.z).toBeLessThan(40);
  });

  it('recovers the room area to within a centimetre of true', () => {
    expect(area(wallLoop(occluded))).toBeCloseTo(12_000_000, -5);
  });

  it('is insensitive to HOW MUCH clutter there is', () => {
    // One shoe or a wall of boxes: the wall is where the outermost evidence is,
    // so adding more occluded fragments must not move it at all.
    const manyFragments: LoopSegment[] = [
      { a: { x: 0, z: 0 }, b: { x: 900, z: 0 } },
      { a: { x: 1000, z: 120 }, b: { x: 1600, z: 120 } },
      { a: { x: 1700, z: 200 }, b: { x: 2400, z: 200 } },
      { a: { x: 2500, z: 90 }, b: { x: 4000, z: 90 } },
      { a: { x: 4000, z: 90 }, b: { x: 4000, z: 3000 } },
      { a: { x: 4000, z: 3000 }, b: { x: 0, z: 3000 } },
      { a: { x: 0, z: 3000 }, b: { x: 0, z: 0 } },
    ];
    expect(maxDeviationFromZ(wallLoop(manyFragments), 0, 0, 4000)).toBeLessThanOrEqual(30);
  });
});

describe('an occluded corner', () => {
  it('lands where the two walls meet, not where the scanner stopped short', () => {
    // A bin in the corner: both walls stop 600mm short of it. The corner is
    // still exactly where their lines cross.
    const loop = wallLoop([
      { a: { x: 0, z: 0 }, b: { x: 3400, z: 0 } },
      { a: { x: 4000, z: 600 }, b: { x: 4000, z: 3000 } },
      { a: { x: 4000, z: 3000 }, b: { x: 0, z: 3000 } },
      { a: { x: 0, z: 3000 }, b: { x: 0, z: 0 } },
    ]);
    expect(loop.some((p) => Math.abs(p.x - 4000) < 30 && Math.abs(p.z) < 30)).toBe(true);
    expect(area(loop)).toBeCloseTo(12_000_000, -5);
  });
});

describe('degenerate input degrades rather than fails', () => {
  it('hands back the endpoints when there are too few walls', () => {
    const two: LoopSegment[] = [
      { a: { x: 0, z: 0 }, b: { x: 1000, z: 0 } },
      { a: { x: 1000, z: 0 }, b: { x: 1000, z: 1000 } },
    ];
    expect(wallLoop(two)).toHaveLength(4);
  });

  it('survives an empty scan', () => {
    expect(wallLoop([])).toEqual([]);
  });

  it('ignores stubs too short to be walls', () => {
    const withStub = [...rect(4000, 3000), { a: { x: 2000, z: 100 }, b: { x: 2120, z: 100 } }];
    expect(wallLoop(withStub)).toHaveLength(4);
  });
});
