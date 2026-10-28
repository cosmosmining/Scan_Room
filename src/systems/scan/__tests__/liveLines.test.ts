import { describe, expect, it } from 'vitest';
import {
  buildLiveLines,
  SurfaceTracker,
  type LineKind,
  type LiveLine,
  type LiveRoom,
  type P3,
  type TrackItem,
} from '@/systems/scan/liveLines';
import { analyseWalls, type LoopSegment } from '@/systems/scan/wallLoop';
import { findCeiling } from '@/systems/scan/ceilingFinder';
import { mulberry32 } from './helpers/roomGen';
import { simulateScan, type SimRoom } from './helpers/sensorSim';

type P = { x: number; z: number };
const W = 6000;
const D = 5000;
const RECT: P[] = [{ x: 0, z: 0 }, { x: W, z: 0 }, { x: W, z: D }, { x: 0, z: D }];
const room = (over: Partial<LiveRoom> = {}): LiveRoom => ({
  polygon: RECT, ceiling: 2700, zones: [], openings: [], pillars: [], ...over,
});

const near = (p: P3, q: P3, tol = 1) => Math.abs(p.x - q.x) <= tol && Math.abs(p.y - q.y) <= tol && Math.abs(p.z - q.z) <= tol;
/** Is there a line of this kind between these two points (either way round)? */
const has = (lines: LiveLine[], kind: LineKind, a: P3, b: P3, tol = 1) =>
  lines.some((l) => l.kind === kind && ((near(l.a, a, tol) && near(l.b, b, tol)) || (near(l.a, b, tol) && near(l.b, a, tol))));
const of = (lines: LiveLine[], kind: LineKind) => lines.filter((l) => l.kind === kind);
const p3 = (x: number, y: number, z: number): P3 => ({ x, y, z });

/** The L of bulkhead in the field photos: along the windows and round the corner. */
const L_BULKHEAD: P[] = [
  { x: 0, z: 0 }, { x: W, z: 0 }, { x: W, z: 600 }, { x: 1100, z: 600 },
  { x: 700, z: 1000 }, { x: 700, z: D }, { x: 0, z: D },
];

describe('the lines the scan draws: the room as it really is', () => {
  it('a plain room: floor, ceiling and corners, nothing else', () => {
    const lines = buildLiveLines(room());
    expect(of(lines, 'floor')).toHaveLength(4);
    expect(of(lines, 'ceiling')).toHaveLength(4);
    expect(of(lines, 'corner')).toHaveLength(4);
    expect(lines).toHaveLength(12);
    expect(has(lines, 'ceiling', p3(0, 2700, 0), p3(W, 2700, 0))).toBe(true);
    expect(has(lines, 'corner', p3(W, 0, D), p3(W, 2700, D))).toBe(true);
  });

  it('the wall tops step down under an L-shaped bulkhead with an angled corner, and back up after it', () => {
    const lines = buildLiveLines(room({ zones: [{ polygon: L_BULKHEAD, height: 2350 }] }));
    // Window wall and the wall round the corner: all under the bulkhead.
    expect(has(lines, 'ceiling', p3(0, 2350, 0), p3(W, 2350, 0))).toBe(true);
    expect(has(lines, 'ceiling', p3(0, 2350, D), p3(0, 2350, 0))).toBe(true);
    // Side wall: under it for 600, a step, then the ceiling.
    expect(has(lines, 'ceiling', p3(W, 2350, 0), p3(W, 2350, 600))).toBe(true);
    expect(has(lines, 'ceiling', p3(W, 2350, 600), p3(W, 2700, 600))).toBe(true);
    expect(has(lines, 'ceiling', p3(W, 2700, 600), p3(W, 2700, D))).toBe(true);
    // Back wall: the ceiling, then down at 700 from the corner.
    expect(has(lines, 'ceiling', p3(W, 2700, D), p3(700, 2700, D))).toBe(true);
    expect(has(lines, 'ceiling', p3(700, 2350, D), p3(700, 2700, D))).toBe(true);
    expect(has(lines, 'ceiling', p3(700, 2350, D), p3(0, 2350, D))).toBe(true);
    // No wall top at the ceiling where the bulkhead is.
    expect(has(lines, 'ceiling', p3(0, 2700, 0), p3(W, 2700, 0))).toBe(false);
    // The bulkhead's own edges out in the room — the angled one included —
    // at its underside and where it meets the ceiling, and its two corners.
    for (const [a, b] of [[L_BULKHEAD[2], L_BULKHEAD[3]], [L_BULKHEAD[3], L_BULKHEAD[4]], [L_BULKHEAD[4], L_BULKHEAD[5]]]) {
      expect(has(lines, 'bulkhead', p3(a.x, 2350, a.z), p3(b.x, 2350, b.z))).toBe(true);
      expect(has(lines, 'bulkhead', p3(a.x, 2700, a.z), p3(b.x, 2700, b.z))).toBe(true);
    }
    expect(has(lines, 'bulkhead', p3(1100, 2350, 600), p3(1100, 2700, 600))).toBe(true);
    expect(has(lines, 'bulkhead', p3(700, 2350, 1000), p3(700, 2700, 1000))).toBe(true);
    expect(of(lines, 'bulkhead')).toHaveLength(8);
    // Corners stop where the walls meet the bulkhead.
    expect(has(lines, 'corner', p3(0, 0, 0), p3(0, 2350, 0))).toBe(true);
    expect(has(lines, 'corner', p3(W, 0, D), p3(W, 2700, D))).toBe(true);
  });

  it('…the same when the bulkhead comes as the finder traces it: 80 mm short of the walls and corners', () => {
    const traced: P[] = [
      { x: 80, z: 80 }, { x: 5920, z: 80 }, { x: 5920, z: 600 }, { x: 1100, z: 600 },
      { x: 700, z: 1000 }, { x: 700, z: 4920 }, { x: 80, z: 4920 },
    ];
    const exact = buildLiveLines(room({ zones: [{ polygon: L_BULKHEAD, height: 2350 }] }));
    const lines = buildLiveLines(room({ zones: [{ polygon: traced, height: 2350 }] }));
    expect(lines).toHaveLength(exact.length);
    for (const l of exact) expect(has(lines, l.kind, l.a, l.b), JSON.stringify(l)).toBe(true);
  });

  it('a bulkhead whose edge runs at an angle across the room', () => {
    const zone = [{ x: 0, z: 0 }, { x: W, z: 0 }, { x: W, z: 1100 }, { x: 0, z: 400 }];
    const lines = buildLiveLines(room({ zones: [{ polygon: zone, height: 2400 }] }));
    expect(has(lines, 'ceiling', p3(W, 2400, 1100), p3(W, 2700, 1100))).toBe(true);
    expect(has(lines, 'ceiling', p3(0, 2400, 400), p3(0, 2700, 400))).toBe(true);
    expect(has(lines, 'bulkhead', p3(W, 2400, 1100), p3(0, 2400, 400))).toBe(true);
    expect(has(lines, 'bulkhead', p3(W, 2700, 1100), p3(0, 2700, 400))).toBe(true);
  });

  it('a recess steps the wall top up', () => {
    const zone = [{ x: 2000, z: 0 }, { x: 4000, z: 0 }, { x: 4000, z: 1500 }, { x: 2000, z: 1500 }];
    const lines = buildLiveLines(room({ zones: [{ polygon: zone, height: 3000 }] }));
    expect(has(lines, 'ceiling', p3(2000, 3000, 0), p3(4000, 3000, 0))).toBe(true);
    expect(has(lines, 'ceiling', p3(2000, 2700, 0), p3(2000, 3000, 0))).toBe(true);
    expect(has(lines, 'bulkhead', p3(4000, 2700, 1500), p3(4000, 3000, 1500))).toBe(true);
  });

  it('a door stands on the floor even when it was measured floating, and stops under a bulkhead', () => {
    const lines = buildLiveLines(room({
      zones: [{ polygon: L_BULKHEAD, height: 2350 }],
      openings: [
        // RoomPlan's box 150 mm short of the floor, on the open back wall.
        { center: { x: 3000, z: D - 40 }, width: 900, bottom: 150, top: 2150, type: 'door' },
        // A tall door under the bulkhead.
        { center: { x: 3000, z: 30 }, width: 1000, bottom: 0, top: 2500, type: 'door' },
      ],
    }));
    expect(has(lines, 'door', p3(3450, 0, D), p3(3450, 2150, D))).toBe(true);
    expect(has(lines, 'door', p3(3450, 2150, D), p3(2550, 2150, D))).toBe(true);
    expect(has(lines, 'door', p3(2550, 2150, D), p3(2550, 0, D))).toBe(true);
    expect(has(lines, 'door', p3(2500, 0, 0), p3(2500, 2350, 0))).toBe(true);
    expect(of(lines, 'door')).toHaveLength(6); // no line across the floor
  });

  it('windows are boxes on the wall; glass is told apart; an opening at no wall is not drawn', () => {
    const lines = buildLiveLines(room({
      openings: [
        { center: { x: W, z: 2500 }, width: 1200, bottom: 900, top: 2100, type: 'window' },
        { center: { x: 2000, z: 0 }, width: 2000, bottom: 0, top: 2700, type: 'door', glass: true },
        { center: { x: 3000, z: 2500 }, width: 800, bottom: 0, top: 2000, type: 'door' },
      ],
    }));
    expect(of(lines, 'window')).toHaveLength(4);
    expect(has(lines, 'window', p3(W, 900, 1900), p3(W, 900, 3100))).toBe(true);
    expect(of(lines, 'glass')).toHaveLength(3);
    expect(has(lines, 'glass', p3(1000, 2700, 0), p3(3000, 2700, 0))).toBe(true);
    expect(of(lines, 'door')).toHaveLength(0);
  });

  it('columns: a round one at the floor and under the bulkhead it stands in, a square one boxed', () => {
    const lines = buildLiveLines(room({
      zones: [{ polygon: L_BULKHEAD, height: 2350 }],
      pillars: [
        { center: { x: 3000, z: 300 }, shape: 'round', width: 600, depth: 600, rotation: 0 },
        { center: { x: 3000, z: 3000 }, shape: 'box', width: 400, depth: 400, rotation: Math.PI / 6 },
      ],
    }));
    const pillar = of(lines, 'pillar');
    expect(pillar).toHaveLength(16 + 16 + 4 + 4 + 4);
    const round = pillar.slice(0, 32);
    expect(round.slice(0, 16).every((l) => l.a.y === 0 && Math.abs(Math.hypot(l.a.x - 3000, l.a.z - 300) - 300) < 1e-6)).toBe(true);
    expect(round.slice(16).every((l) => l.a.y === 2350)).toBe(true);
    expect(pillar.slice(32 + 4, 32 + 8).every((l) => l.a.y === 2700)).toBe(true);
  });

  it('either winding draws the same room', () => {
    const r = room({
      zones: [{ polygon: L_BULKHEAD, height: 2350 }],
      openings: [{ center: { x: 3000, z: D }, width: 900, bottom: 0, top: 2100, type: 'door' }],
    });
    const ccw = buildLiveLines(r);
    const cw = buildLiveLines({ ...r, polygon: [...RECT].reverse() });
    expect(cw).toHaveLength(ccw.length);
    for (const l of ccw) expect(has(cw, l.kind, l.a, l.b), JSON.stringify(l)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Flashing: a stream of updates as RoomPlan gives them
// ---------------------------------------------------------------------------

/** A wall as RoomPlan names it, with its numbers: ends, height and top. */
const WALLS = RECT.map((a, i) => ({ key: `w${i}`, a, b: RECT[(i + 1) % 4] }));

function gauss(rnd: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(1e-12, rnd()))) * Math.cos(2 * Math.PI * rnd());
}

/**
 * One update: every wall a little off where it is (σ 15 mm), now and then one
 * badly off (200 mm) or missing; the door and window found and lost again.
 */
function roomPlanUpdate(rnd: () => number, k: number): TrackItem[] {
  const j = (s: number) => gauss(rnd) * s + (rnd() < 0.03 ? (rnd() < 0.5 ? -200 : 200) : 0);
  const items: TrackItem[] = [];
  for (const w of WALLS) {
    if (rnd() < 0.05) continue;
    items.push({ kind: 'wall', key: w.key, values: [w.a.x + j(15), w.a.z + j(15), w.b.x + j(15), w.b.z + j(15), 2700 + j(20), 2700 + j(20)] });
  }
  if (rnd() > 0.3) items.push({ kind: 'door', key: 'd0', values: [3000 + j(20), D + j(15), 900 + j(20), 120 + j(40), 2120 + j(40)] });
  if (k >= 10 && rnd() > 0.1) items.push({ kind: 'window', key: 'g0', values: [W + j(15), 2500 + j(20), 1200 + j(20), 900 + j(30), 2100 + j(30)] });
  return items;
}

/** Tracked (or raw) surfaces → the lines, the way the iPad does it. */
function linesFrom(items: { kind: string; values: number[] }[]): LiveLine[] {
  const segs: LoopSegment[] = items.filter((i) => i.kind === 'wall').map((i) => ({
    a: { x: i.values[0], z: i.values[1] }, b: { x: i.values[2], z: i.values[3] }, heightMm: i.values[4], topMm: i.values[5],
  }));
  if (segs.length < 3) return [];
  const outline = analyseWalls(segs).outline;
  if (outline.length < 3) return [];
  return buildLiveLines({
    polygon: outline,
    ceiling: 2700,
    zones: [],
    pillars: [],
    openings: items.filter((i) => i.kind === 'door' || i.kind === 'window').map((i) => ({
      center: { x: i.values[0], z: i.values[1] }, width: i.values[2], bottom: i.values[3], top: i.values[4],
      type: i.kind as 'door' | 'window',
    })),
  });
}

/** Lines appearing or vanishing between two updates, and lines that moved. */
function changes(before: LiveLine[], after: LiveLine[]) {
  const mid = (l: LiveLine) => ({ x: (l.a.x + l.b.x) / 2, y: (l.a.y + l.b.y) / 2, z: (l.a.z + l.b.z) / 2 });
  const closest = (l: LiveLine, set: LiveLine[]) => {
    let best = Infinity;
    for (const m of set) {
      if (m.kind !== l.kind) continue;
      const d = Math.min(
        Math.max(Math.hypot(l.a.x - m.a.x, l.a.y - m.a.y, l.a.z - m.a.z), Math.hypot(l.b.x - m.b.x, l.b.y - m.b.y, l.b.z - m.b.z)),
        Math.max(Math.hypot(l.a.x - m.b.x, l.a.y - m.b.y, l.a.z - m.b.z), Math.hypot(l.b.x - m.a.x, l.b.y - m.a.y, l.b.z - m.a.z)),
      );
      best = Math.min(best, d);
    }
    return best;
  };
  void mid;
  let flashes = 0;
  let moves = 0;
  for (const l of after) {
    const d = closest(l, before);
    if (d > 150) flashes++;
    else if (d > 1) moves++;
  }
  for (const l of before) if (closest(l, after) > 150) flashes++;
  return { flashes, moves };
}

describe('the lines hold still: no flashing', () => {
  it('RoomPlan’s jitter, dropouts and a door found and lost: raw lines flash, steady ones do not', () => {
    const rnd = mulberry32(77);
    const tracker = new SurfaceTracker();
    let raw: LiveLine[] = [];
    let steady: LiveLine[] = [];
    let rawFlashes = 0, rawMoves = 0, steadyFlashes = 0, steadyMoves = 0;
    for (let k = 0; k < 120; k++) {
      const items = roomPlanUpdate(rnd, k);
      const nextRaw = linesFrom(items);
      const nextSteady = linesFrom(tracker.update(items));
      if (k >= 15) {
        const r = changes(raw, nextRaw);
        const s = changes(steady, nextSteady);
        rawFlashes += r.flashes; rawMoves += r.moves;
        steadyFlashes += s.flashes; steadyMoves += s.moves;
      }
      raw = nextRaw;
      steady = nextSteady;
    }
    // RoomPlan's own lines: the door comes and goes, walls jump.
    expect(rawFlashes).toBeGreaterThan(50);
    expect(rawMoves).toBeGreaterThan(500);
    // Steady: nothing appears or vanishes, and once settled nothing moves.
    console.log({ rawFlashes, rawMoves, steadyFlashes, steadyMoves });
    expect(steadyFlashes).toBe(0);
    expect(steadyMoves).toBeLessThanOrEqual(10);
    // …and it is the real room: every line within 30 mm of the truth.
    const truth = buildLiveLines({
      polygon: RECT, ceiling: 2700, zones: [], pillars: [],
      openings: [
        { center: { x: 3000, z: D }, width: 900, bottom: 120, top: 2120, type: 'door' },
        { center: { x: W, z: 2500 }, width: 1200, bottom: 900, top: 2100, type: 'window' },
      ],
    });
    expect(steady).toHaveLength(truth.length);
    const { flashes } = changes(truth, steady);
    expect(flashes).toBe(0);
    for (const l of truth) expect(has(steady, l.kind, l.a, l.b, 30), JSON.stringify(l)).toBe(true);
    // The door is drawn standing on the floor although RoomPlan had it 120 mm up.
    expect(of(steady, 'door').filter((l) => l.a.y === 0 || l.b.y === 0)).toHaveLength(2);
  });

  it('a real change shows within about a second (6 updates at 5 a second) and stays', () => {
    const tracker = new SurfaceTracker();
    const wall = (dz: number): TrackItem => ({ kind: 'wall', key: 'w', values: [0, dz, 6000, dz, 2700, 2700] });
    for (let k = 0; k < 10; k++) tracker.update([wall(0)]);
    let shown = tracker.update([wall(150)]);
    expect(shown[0].values[1]).toBe(0); // one reading is not a move
    let k = 1;
    while (shown[0].values[1] !== 150 && k < 10) {
      shown = tracker.update([wall(150)]);
      k++;
    }
    expect(k).toBeLessThanOrEqual(6);
    for (let i = 0; i < 20; i++) expect(tracker.update([wall(150)])[0].values[1]).toBe(150);
  });

  it('a surface is drawn on its second sighting, kept through misses, dropped after a run of them', () => {
    const tracker = new SurfaceTracker();
    const door: TrackItem = { kind: 'door', key: 'd', values: [100, 200, 900, 0, 2100] };
    expect(tracker.update([door])).toHaveLength(0);
    expect(tracker.update([door])).toHaveLength(1);
    for (let i = 0; i < 4; i++) {
      const shown = tracker.update([]);
      expect(shown).toHaveLength(1);
      expect(shown[0].seen).toBe(false);
    }
    expect(tracker.update([])).toHaveLength(0);
    // Seen only every other update: drawn, and never dropped.
    const blinking = new SurfaceTracker();
    let drawn = 0;
    for (let i = 0; i < 40; i++) drawn = blinking.update(i % 2 === 0 ? [door] : []).length;
    expect(drawn).toBe(1);
  });

  it('wobble under 25 mm never moves a line, and a single wild reading is ignored', () => {
    const tracker = new SurfaceTracker();
    const rnd = mulberry32(3);
    let first: number[] | null = null;
    for (let i = 0; i < 200; i++) {
      const wild = i === 100 ? 300 : 0;
      const v = [1000 + (rnd() - 0.5) * 40 + wild, 2000 + (rnd() - 0.5) * 40];
      const shown = tracker.update([{ kind: 'pillar', values: v }]);
      if (first) expect(shown[0].values).toEqual(first);
      else if (shown[0]?.locked) first = shown[0].values;
    }
    expect(first).not.toBeNull();
  });

  it('things without RoomPlan’s names are followed by where they are, whatever order they come in', () => {
    const tracker = new SurfaceTracker();
    const a = { kind: 'zone', values: [1000, 1000, 2350] };
    const b = { kind: 'zone', values: [4000, 1000, 2350] };
    tracker.update([a, b]);
    const one = tracker.update([b, a]);
    const two = tracker.update([a, b]);
    const id = (s: typeof one, x: number) => s.find((t) => t.values[0] === x)!.id;
    expect(id(one, 1000)).toBe(id(two, 1000));
    expect(id(one, 4000)).toBe(id(two, 4000));
    // A bulkhead re-traced with more corners keeps its place and takes the new shape.
    const more = tracker.update([{ kind: 'zone', values: [1010, 1000, 2350, 1, 2] }, b]);
    expect(more.find((t) => t.id === id(two, 1000))!.values).toEqual([1010, 1000, 2350, 1, 2]);
  });
});

// ---------------------------------------------------------------------------
// End to end: the bulkhead as the iPad measures it, through the ceiling finder
// ---------------------------------------------------------------------------

describe('the stepped wall top from a simulated walk', () => {
  const cases: [string, SimRoom, { wall: number; t: number; lo: number }[]][] = [
    [
      'an L of bulkhead under a mesh ceiling, a column at the glass',
      {
        polygon: RECT, ceiling: 2700, ceilingMesh: { open: 0.6, slab: 3400 },
        soffits: [{ polygon: [{ x: 0, z: 0 }, { x: W, z: 0 }, { x: W, z: 500 }, { x: 600, z: 500 }, { x: 600, z: D }, { x: 0, z: D }], bottom: 2300 }],
        pillars: [{ x: 3000, z: 820, shape: 'round', width: 600 }],
      },
      [{ wall: 1, t: 500, lo: 2300 }, { wall: 2, t: W - 600, lo: 2300 }],
    ],
    [
      'a bulkhead with an angled edge',
      { polygon: RECT, ceiling: 2700, soffits: [{ polygon: [{ x: 0, z: 0 }, { x: W, z: 0 }, { x: W, z: 1100 }, { x: 0, z: 400 }], bottom: 2400 }] },
      [{ wall: 1, t: 1100, lo: 2400 }, { wall: 3, t: D - 400, lo: 2400 }],
    ],
  ];
  for (const [name, sim, steps] of cases) {
    it(name, () => {
      const rays = simulateScan(sim, { daylight: false, fill: "wall", seed: 3 });
      const exclude = (sim.pillars ?? []).map((c) => ({ center: { x: c.x, z: c.z }, width: c.width, depth: c.width, rotation: 0 }));
      const ceiling = findCeiling(rays, RECT, exclude)!;
      expect(Math.abs(ceiling.height - 2700)).toBeLessThanOrEqual(15);
      const lines = buildLiveLines({ polygon: RECT, ceiling: ceiling.height, zones: ceiling.zones, openings: [], pillars: [] });
      for (const s of steps) {
        const a = RECT[s.wall];
        const b = RECT[(s.wall + 1) % 4];
        const L = Math.hypot(b.x - a.x, b.z - a.z);
        const at = { x: a.x + ((b.x - a.x) / L) * s.t, z: a.z + ((b.z - a.z) / L) * s.t };
        // A step on that wall, within 150 mm of where the bulkhead ends, from
        // its underside (±30 mm) up to the ceiling.
        const step = of(lines, 'ceiling').find((l) =>
          Math.abs(l.a.x - l.b.x) < 1e-6 && Math.abs(l.a.z - l.b.z) < 1e-6 &&
          Math.hypot(l.a.x - at.x, l.a.z - at.z) <= 150 &&
          Math.abs(Math.min(l.a.y, l.b.y) - s.lo) <= 30 && Math.abs(Math.max(l.a.y, l.b.y) - ceiling.height) <= 1);
        expect(step, `${name}: step on wall ${s.wall} at ${s.t}`).toBeDefined();
      }
    });
  }
});
