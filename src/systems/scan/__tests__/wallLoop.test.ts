import { describe, expect, it } from 'vitest';
import { analyseWalls, wallLoop, type LoopPoint, type LoopSegment } from '../wallLoop';

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

describe('shoes against a wall of an L-shaped room', () => {
  // (0,0)-(6000,0)-(6000,2000)-(2000,2000)-(2000,6000)-(0,6000). The middle of
  // its walls, (2667, 2667), is OUTSIDE the room — which is what used to flip
  // the reflex wall's idea of "outward", so the fragment clutter pushed into
  // the room won.
  const L: LoopSegment[] = [
    { a: { x: 0, z: 0 }, b: { x: 6000, z: 0 } },
    { a: { x: 6000, z: 0 }, b: { x: 6000, z: 2000 } },
    { a: { x: 6000, z: 2000 }, b: { x: 4200, z: 2000 } },
    // Shoes along x 2000..3800: RoomPlan fitted that stretch 150mm into the room.
    { a: { x: 3800, z: 1850 }, b: { x: 2000, z: 1850 } },
    { a: { x: 2000, z: 2000 }, b: { x: 2000, z: 6000 } },
    { a: { x: 2000, z: 6000 }, b: { x: 0, z: 6000 } },
    { a: { x: 0, z: 6000 }, b: { x: 0, z: 0 } },
  ];

  it('keeps the reflex wall where it is, not where the shoes are', () => {
    const outline = wallLoop(L);
    expect(outline).toHaveLength(6);
    expect(maxDeviationFromZ(outline, 2000, 2000, 6000)).toBeLessThanOrEqual(1);
    // 6 x 6 m minus the 4 x 4 m bite.
    expect(area(outline)).toBeCloseTo(20_000_000, -4);
  });

  it('still takes the outermost fragment on the ordinary walls of the same room', () => {
    const shoesOnOuterWall = [...L];
    shoesOnOuterWall.splice(0, 1,
      { a: { x: 0, z: 0 }, b: { x: 2500, z: 0 } },
      { a: { x: 2600, z: 150 }, b: { x: 6000, z: 150 } },
    );
    const outline = wallLoop(shoesOnOuterWall);
    expect(maxDeviationFromZ(outline, 0, 0, 6000)).toBeLessThanOrEqual(1);
    expect(area(outline)).toBeCloseTo(20_000_000, -4);
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

/** A column approximated by `n` flat facets, the way a planar scanner sees it. */
const roundColumn = (cx: number, cz: number, r: number, n = 8, from = 0, to = 2 * Math.PI) => {
  const out: LoopSegment[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = from + ((to - from) * i) / n;
    const t1 = from + ((to - from) * (i + 1)) / n;
    out.push({
      a: { x: cx + r * Math.cos(t0), z: cz + r * Math.sin(t0) },
      b: { x: cx + r * Math.cos(t1), z: cz + r * Math.sin(t1) },
      heightMm: 2600,
      topMm: 2600,
    });
  }
  return out;
};

describe('round pillars', () => {
  it('pulls a freestanding round column out of the outline', () => {
    // Woven into the loop, its facets made a spike across the plan: greedy
    // chaining visited the column and came back.
    const { outline, pillars } = analyseWalls([...rect(4000, 3000), ...roundColumn(2000, 1500, 300)]);
    expect(outline).toHaveLength(4);
    expect(area(outline)).toBeCloseTo(12_000_000, -5);
    expect(pillars).toHaveLength(1);
    expect(pillars[0].shape).toBe('round');
    expect(pillars[0].center.x).toBeCloseTo(2000, -1);
    expect(pillars[0].center.z).toBeCloseTo(1500, -1);
    // A polygon inscribed in a 600mm circle fits a slightly smaller one.
    expect(pillars[0].width).toBeGreaterThan(540);
    expect(pillars[0].width).toBeLessThan(620);
  });

  it('recognises a column iOS reports as ONE curved surface, sampled at 15° steps', () => {
    // RoomPlan on iOS 17 describes a round column as a curved surface (a radius
    // and two angles). Read as a flat wall it was a line through the middle of
    // the column; FloorplanBuilder.facets samples the arc every 15° instead,
    // which gives exactly this: 24 facets, each far shorter than any wall.
    const { outline, pillars } = analyseWalls([...rect(4000, 3000), ...roundColumn(1500, 1200, 200, 24)]);
    expect(outline).toHaveLength(4);
    expect(pillars).toHaveLength(1);
    expect(pillars[0].shape).toBe('round');
    expect(pillars[0].center.x).toBeCloseTo(1500, -1);
    expect(pillars[0].center.z).toBeCloseTo(1200, -1);
    expect(pillars[0].width).toBeGreaterThan(390);
    expect(pillars[0].width).toBeLessThan(410);
  });

  it('follows a large curved wall instead of mistaking it for a pillar', () => {
    // A quarter circle of radius 2m rounding off one corner of a 4 x 3 m room,
    // sampled the same way. Its span rules it out as a column, so it stays in
    // the boundary — as a curve, not a chord.
    const walls: LoopSegment[] = [
      { a: { x: 0, z: 0 }, b: { x: 2000, z: 0 } },
      ...roundColumn(2000, 2000, 2000, 6, -Math.PI / 2, 0),
      { a: { x: 4000, z: 2000 }, b: { x: 4000, z: 3000 } },
      { a: { x: 4000, z: 3000 }, b: { x: 0, z: 3000 } },
      { a: { x: 0, z: 3000 }, b: { x: 0, z: 0 } },
    ];
    const { outline, pillars } = analyseWalls(walls);
    expect(pillars).toHaveLength(0);
    expect(outline.length).toBeGreaterThanOrEqual(8);
    const truth = 12_000_000 - (4_000_000 - Math.PI * 1_000_000);
    expect(Math.abs(area(outline) - truth) / truth).toBeLessThan(0.01);
  });

  it('pulls out a half-round column engaged against a wall, and keeps the wall straight', () => {
    // Half a 500mm column standing proud of the z = 0 wall; the wall either
    // side of it is two fragments.
    const walls: LoopSegment[] = [
      { a: { x: 0, z: 0 }, b: { x: 1750, z: 0 } },
      ...roundColumn(2000, 0, 250, 6, 0, Math.PI),
      { a: { x: 2250, z: 0 }, b: { x: 4000, z: 0 } },
      { a: { x: 4000, z: 0 }, b: { x: 4000, z: 3000 } },
      { a: { x: 4000, z: 3000 }, b: { x: 0, z: 3000 } },
      { a: { x: 0, z: 3000 }, b: { x: 0, z: 0 } },
    ];
    const { outline, pillars } = analyseWalls(walls);
    expect(pillars).toHaveLength(1);
    expect(pillars[0].shape).toBe('round');
    expect(maxDeviationFromZ(outline, 0, 0, 4000)).toBeLessThanOrEqual(30);
    expect(area(outline)).toBeCloseTo(12_000_000, -5);
  });

  it('reports a square column as a box, not a circle', () => {
    const sq: LoopSegment[] = [
      { a: { x: 1800, z: 1300 }, b: { x: 2200, z: 1300 } },
      { a: { x: 2200, z: 1300 }, b: { x: 2200, z: 1700 } },
      { a: { x: 2200, z: 1700 }, b: { x: 1800, z: 1700 } },
      { a: { x: 1800, z: 1700 }, b: { x: 1800, z: 1300 } },
    ];
    const { outline, pillars } = analyseWalls([...rect(4000, 3000), ...sq]);
    expect(outline).toHaveLength(4);
    expect(pillars).toHaveLength(1);
    expect(pillars[0].shape).toBe('box');
    expect(pillars[0].width).toBeCloseTo(400, -1);
    expect(pillars[0].depth).toBeCloseTo(400, -1);
  });

  it('does NOT turn a rounded corner into a pillar', () => {
    // A 5 x 4 m room whose (0,0) corner is rounded at R = 900mm, sampled every
    // 15° the way FloorplanBuilder samples a curved surface.
    const arc = roundColumn(900, 900, 900, 6, Math.PI, 1.5 * Math.PI);
    const walls: LoopSegment[] = [
      { a: { x: 900, z: 0 }, b: { x: 5000, z: 0 } },
      { a: { x: 5000, z: 0 }, b: { x: 5000, z: 4000 } },
      { a: { x: 5000, z: 4000 }, b: { x: 0, z: 4000 } },
      { a: { x: 0, z: 4000 }, b: { x: 0, z: 900 } },
      ...arc,
    ];
    const { outline, pillars } = analyseWalls(walls);
    expect(pillars).toHaveLength(0);
    // The facets are shorter than any wall, so the corner is squared off —
    // within the 0.17 m² the rounding takes away, and never a column.
    expect(Math.abs(area(outline) - 20_000_000)).toBeLessThan(200_000);
  });

  it('draws a column built into a corner as a notch in the walls', () => {
    const walls: LoopSegment[] = [
      { a: { x: 400, z: 0 }, b: { x: 4000, z: 0 } },
      { a: { x: 4000, z: 0 }, b: { x: 4000, z: 3000 } },
      { a: { x: 4000, z: 3000 }, b: { x: 0, z: 3000 } },
      { a: { x: 0, z: 3000 }, b: { x: 0, z: 400 } },
      // The column's two exposed faces.
      { a: { x: 0, z: 400 }, b: { x: 400, z: 400 } },
      { a: { x: 400, z: 400 }, b: { x: 400, z: 0 } },
    ];
    const { outline, pillars } = analyseWalls(walls);
    expect(pillars).toHaveLength(0);
    expect(outline).toHaveLength(6);
    expect(area(outline)).toBeCloseTo(12_000_000 - 160_000, -3);
  });

  it('does NOT turn a small alcove into a pillar', () => {
    // An alcove is part of the boundary — it opens the room outward. Its short
    // facets look like a column until you ask which side of them the room is.
    const walls: LoopSegment[] = [
      { a: { x: 0, z: 0 }, b: { x: 1600, z: 0 } },
      { a: { x: 1600, z: 0 }, b: { x: 1600, z: -600 } },
      { a: { x: 1600, z: -600 }, b: { x: 2400, z: -600 } },
      { a: { x: 2400, z: -600 }, b: { x: 2400, z: 0 } },
      { a: { x: 2400, z: 0 }, b: { x: 4000, z: 0 } },
      { a: { x: 4000, z: 0 }, b: { x: 4000, z: 3000 } },
      { a: { x: 4000, z: 3000 }, b: { x: 0, z: 3000 } },
      { a: { x: 0, z: 3000 }, b: { x: 0, z: 0 } },
    ];
    const { pillars, outline } = analyseWalls(walls);
    expect(pillars).toHaveLength(0);
    // …and it is still in the outline, adding its 0.48 m².
    expect(area(outline)).toBeCloseTo(12_000_000 + 800 * 600, -5);
  });
});

describe('clutter by height', () => {
  it('drops a shoe rack that RoomPlan reported as a wall', () => {
    // RoomPlan fits a wall to any large flat vertical face. The front of a
    // shoe rack arrives 300mm in front of the real wall, 450mm tall.
    const rack: LoopSegment = { a: { x: 1500, z: 300 }, b: { x: 2400, z: 300 }, heightMm: 450, topMm: 450 };
    const tallRect = rect(4000, 3000).map((s) => ({ ...s, heightMm: 2600, topMm: 2600 }));
    const { outline, clutterRejected } = analyseWalls([...tallRect, rack]);
    expect(clutterRejected).toBe(1);
    expect(outline).toHaveLength(4);
    expect(area(outline)).toBeCloseTo(12_000_000, -5);
  });

  it('keeps a low wall that IS the room’s edge — an attic knee wall', () => {
    // 700mm high under a sloping roof, with nothing behind it: not clutter.
    const walls = rect(4000, 3000).map((s, i) =>
      i === 2 ? { ...s, heightMm: 700, topMm: 700 } : { ...s, heightMm: 2600, topMm: 2600 },
    );
    const { outline, clutterRejected } = analyseWalls(walls);
    expect(clutterRejected).toBe(0);
    expect(outline).toHaveLength(4);
    expect(area(outline)).toBeCloseTo(12_000_000, -5);
  });

  it('keeps a genuinely low wall when heights say the whole room is low', () => {
    // If every surface fails the height test, the heights are what is wrong.
    const low = rect(4000, 3000).map((s) => ({ ...s, heightMm: 500, topMm: 500 }));
    expect(analyseWalls(low).outline).toHaveLength(4);
  });

  it('leaves a trace with no height information alone', () => {
    expect(analyseWalls(rect(4000, 3000)).clutterRejected).toBe(0);
  });
});

describe('a column RoomPlan only partly saw', () => {
  const H = { heightMm: 2600, topMm: 2600 };
  const tallRect = (w: number, d: number): LoopSegment[] => rect(w, d).map((s) => ({ ...s, ...H }));

  it('takes ONE face of a freestanding column as a column, instead of drawing a spike out to it', () => {
    // All RoomPlan saw of a column in the middle of an open-plan room: one
    // flat face. Chained into the outline it ran (0,2500) → (3250,2500) → (0,0).
    const { outline, pillars } = analyseWalls([
      ...tallRect(6000, 5000),
      { a: { x: 2750, z: 2500 }, b: { x: 3250, z: 2500 }, ...H },
    ]);
    expect(outline).toHaveLength(4);
    expect(area(outline)).toBeCloseTo(30_000_000, -5);
    expect(pillars).toHaveLength(1);
    expect(pillars[0]).toMatchObject({ shape: 'box', partial: true });
    expect(pillars[0].center).toEqual({ x: 3000, z: 2500 });
  });

  it('drops a lone LOW surface in the room (an island side) rather than spiking to it', () => {
    const { outline, pillars, clutterRejected } = analyseWalls([
      ...tallRect(6000, 5000),
      { a: { x: 2000, z: 2500 }, b: { x: 3000, z: 2500 }, heightMm: 900, topMm: 900 },
    ]);
    expect(outline).toHaveLength(4);
    expect(pillars).toHaveLength(0);
    expect(clutterRejected).toBe(1);
  });

  it('leaves the short wall at the back of a U-shaped room’s notch in the walls', () => {
    // Seen only as a fragment with gaps either side, it stands alone too —
    // but its ends run on into the notch's two sides, so it is boundary.
    const { outline, pillars } = analyseWalls([
      { a: { x: 0, z: 0 }, b: { x: 6000, z: 0 }, ...H }, { a: { x: 6000, z: 0 }, b: { x: 6000, z: 5000 }, ...H },
      { a: { x: 6000, z: 5000 }, b: { x: 4000, z: 5000 }, ...H }, { a: { x: 4000, z: 5000 }, b: { x: 4000, z: 3000 }, ...H },
      { a: { x: 3450, z: 3000 }, b: { x: 2550, z: 3000 }, ...H },
      { a: { x: 2000, z: 3000 }, b: { x: 2000, z: 5000 }, ...H }, { a: { x: 2000, z: 5000 }, b: { x: 0, z: 5000 }, ...H },
      { a: { x: 0, z: 5000 }, b: { x: 0, z: 0 }, ...H },
    ]);
    expect(pillars).toHaveLength(0);
    expect(outline).toHaveLength(8);
    expect(area(outline)).toBeCloseTo(30_000_000 - 4_000_000, -5);
  });

  it('a quarter of a round column (iOS 17 curve, 15° steps) is round, centred where the column is', () => {
    // Boxed round the visible arc, its centre sat on the near face.
    const { pillars } = analyseWalls([...tallRect(6000, 5000), ...roundColumn(3000, 2500, 250, 6, Math.PI / 4, (3 * Math.PI) / 4)]);
    expect(pillars).toHaveLength(1);
    expect(pillars[0].shape).toBe('round');
    expect(pillars[0].center.x).toBeCloseTo(3000, -1);
    expect(pillars[0].center.z).toBeCloseTo(2500, -1);
    expect(pillars[0].width).toBeCloseTo(500, -1);
  });

  it('…and so is a sixth of one', () => {
    const { pillars } = analyseWalls([...tallRect(6000, 5000), ...roundColumn(3000, 2500, 250, 4, Math.PI / 3, (2 * Math.PI) / 3)]);
    expect(pillars).toHaveLength(1);
    expect(pillars[0].shape).toBe('round');
    expect(pillars[0].center.z).toBeCloseTo(2500, -1);
  });

  it('two faces of a square column are still a box, not an arc', () => {
    const { pillars } = analyseWalls([
      ...tallRect(6000, 5000),
      { a: { x: 2800, z: 2300 }, b: { x: 3200, z: 2300 }, ...H },
      { a: { x: 3200, z: 2300 }, b: { x: 3200, z: 2700 }, ...H },
    ]);
    expect(pillars).toHaveLength(1);
    expect(pillars[0].shape).toBe('box');
  });
});
