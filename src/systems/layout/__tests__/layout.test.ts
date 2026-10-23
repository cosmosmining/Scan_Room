import { describe, expect, it } from 'vitest';
import { createDefaultRoom } from '@/lib/defaults';
import {
  generateLayout,
  rectsOverlap,
  type PlacementModule,
  type Rect,
} from '@/systems/layout';

const base = (definitionId: string, width: number): PlacementModule => ({
  definitionId,
  category: 'kitchen-base',
  mount: 'floor',
  width,
  depth: 600,
  height: 900,
});

const box = (cx: number, cz: number, half = 100): Rect => ({
  center: { x: cx, z: cz },
  axisX: { x: 1, z: 0 },
  axisZ: { x: 0, z: 1 },
  halfX: half,
  halfZ: half,
});

describe('layout engine', () => {
  it('packs a single wall without collisions or unplaced units', () => {
    const room = createDefaultRoom();
    const res = generateLayout({
      room,
      assignments: [
        { wallId: 'wall_0', modules: [base('a', 600), base('b', 800), base('c', 600)] },
      ],
    });
    expect(res.instances).toHaveLength(3);
    expect(res.unplaced).toHaveLength(0);
    expect(res.violations.filter((v) => v.kind === 'collision')).toHaveLength(0);
  });

  it('handles an L-shape: corner reserve prevents overlap', () => {
    const room = createDefaultRoom();
    const res = generateLayout({
      room,
      assignments: [
        { wallId: 'wall_0', modules: [base('a', 800), base('b', 800)] },
        { wallId: 'wall_1', modules: [base('c', 600)] },
      ],
    });
    expect(res.instances).toHaveLength(3);
    expect(res.violations.filter((v) => v.kind === 'collision')).toHaveLength(0);
  });

  it('reports unplaced units when a wall is too short', () => {
    const room = createDefaultRoom(); // wall_0 is 4000mm
    const res = generateLayout({
      room,
      assignments: [{ wallId: 'wall_0', modules: [base('huge', 5000)] }],
    });
    expect(res.instances).toHaveLength(0);
    expect(res.unplaced).toHaveLength(1);
  });

  it('SAT: overlapping boxes collide, separated boxes do not', () => {
    expect(rectsOverlap(box(0, 0), box(150, 0))).toBe(true); // 50mm overlap
    expect(rectsOverlap(box(0, 0), box(500, 0))).toBe(false); // clear gap
    expect(rectsOverlap(box(0, 0), box(200, 0))).toBe(false); // flush-touching
  });
});
