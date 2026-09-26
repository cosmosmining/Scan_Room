import { describe, expect, it } from 'vitest';
import { findGlass, type DepthRay } from '@/systems/scan/glassFinder';

// A 4 x 3 m room, 2.6 m ceiling. Wall 0 is z = 0, x 0 → 4000.
const ROOM = [
  { x: 0, z: 0 }, { x: 4000, z: 0 }, { x: 4000, z: 3000 }, { x: 0, z: 3000 },
];
const CEILING = 2600;

interface Pane { x0: number; x1: number; y0: number; y1: number }

/** Deterministic 0…1 noise, so a test is the same test every run. */
const noise = (i: number) => {
  const s = Math.sin(i * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * What the depth sensor reports looking at wall 0 from a few places in the
 * room: readings on the wall where it is solid, and readings 2 m beyond it
 * (the balcony, the street) where it is glass. Only ~40% of the grid is kept,
 * because real rays are sparse and a pane is seen as a speckle.
 */
function lookAtWall0(panes: Pane[], keep = 0.4): DepthRay[] {
  const eyes = [
    { x: 1000, y: 1400, z: 2200 },
    { x: 2000, y: 1500, z: 2500 },
    { x: 3000, y: 1300, z: 1800 },
  ];
  const rays: DepthRay[] = [];
  let i = 0;
  for (const eye of eyes) {
    for (let x = 60; x < 4000; x += 45) {
      for (let y = 40; y < CEILING; y += 45) {
        i++;
        if (noise(i) > keep) continue;
        const glass = panes.some((p) => x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1);
        if (!glass) {
          rays.push({ eye, hit: { x, y, z: (noise(i + 7) - 0.5) * 40 } });
          continue;
        }
        // Continue the ray 2 m past the wall.
        const dx = x - eye.x, dy = y - eye.y, dz = 0 - eye.z;
        const f = (eye.z + 2000) / eye.z;
        rays.push({ eye, hit: { x: eye.x + dx * f, y: eye.y + dy * f, z: eye.z + dz * f } });
      }
    }
  }
  return rays;
}

describe('glass RoomPlan missed', () => {
  it('finds a window from the readings that went through it', () => {
    const found = findGlass(lookAtWall0([{ x0: 1000, x1: 2600, y0: 900, y1: 2100 }]), ROOM, CEILING);
    expect(found).toHaveLength(1);
    const [w] = found;
    expect(w.wall).toBe(0);
    expect(w.type).toBe('window');
    expect(Math.abs(w.offset - 1000)).toBeLessThanOrEqual(150);
    expect(Math.abs(w.width - 1600)).toBeLessThanOrEqual(250);
    expect(Math.abs(w.sill - 900)).toBeLessThanOrEqual(150);
    expect(Math.abs(w.height - 1200)).toBeLessThanOrEqual(250);
  });

  it('calls floor-to-ceiling glass a door, from the floor', () => {
    const found = findGlass(lookAtWall0([{ x0: 1500, x1: 3300, y0: 0, y1: 2300 }]), ROOM, CEILING);
    expect(found).toHaveLength(1);
    expect(found[0].type).toBe('door');
    expect(found[0].sill).toBe(0);
    expect(found[0].height).toBeGreaterThanOrEqual(2200);
  });

  it('finds two separate panes as two', () => {
    const found = findGlass(
      lookAtWall0([
        { x0: 400, x1: 1300, y0: 900, y1: 2000 },
        { x0: 2600, x1: 3500, y0: 900, y1: 2000 },
      ]),
      ROOM,
      CEILING,
    );
    expect(found).toHaveLength(2);
    expect(found[0].offset).toBeLessThan(found[1].offset);
  });

  it('reports nothing for a solid room', () => {
    expect(findGlass(lookAtWall0([]), ROOM, CEILING)).toEqual([]);
  });

  it('does not report a window RoomPlan already found', () => {
    const rays = lookAtWall0([{ x0: 1000, x1: 2600, y0: 900, y1: 2100 }]);
    expect(findGlass(rays, ROOM, CEILING, [{ wall: 0, offset: 1050, width: 1500 }])).toEqual([]);
  });

  it('ignores a handful of stray readings', () => {
    // Depth noise and the odd flyaway pixel are not a window.
    const rays = lookAtWall0([]);
    for (let i = 0; i < 6; i++) {
      rays.push({ eye: { x: 2000, y: 1400, z: 2000 }, hit: { x: 1800 + i * 90, y: 1500, z: -2500 } });
    }
    expect(findGlass(rays, ROOM, CEILING)).toEqual([]);
  });

  it('is not fooled by furniture in front of the wall', () => {
    // Readings landing on a sofa never reach the wall, let alone pass it.
    const rays = lookAtWall0([]).map((r, i) =>
      i % 3 === 0 ? { eye: r.eye, hit: { x: r.hit.x, y: Math.min(r.hit.y, 800), z: 600 } } : r,
    );
    expect(findGlass(rays, ROOM, CEILING)).toEqual([]);
  });

  it('works the same whichever way round the polygon is wound', () => {
    const rays = lookAtWall0([{ x0: 1000, x1: 2600, y0: 900, y1: 2100 }]);
    // Clockwise: wall 3 is now (0,0) → (4000,0)… reversed, so check by position.
    const cw = [ROOM[0], ROOM[3], ROOM[2], ROOM[1]];
    const found = findGlass(rays, cw, CEILING);
    expect(found).toHaveLength(1);
    expect(found[0].wall).toBe(3); // edge (4000,0) → (0,0)
    // Measured from x = 4000 now: the pane's leading edge is its far end.
    expect(Math.abs(found[0].offset - (4000 - 2600))).toBeLessThanOrEqual(150);
  });

  it('degrades to nothing on empty or broken input', () => {
    expect(findGlass([], ROOM, CEILING)).toEqual([]);
    expect(findGlass(lookAtWall0([]), ROOM.slice(0, 2), CEILING)).toEqual([]);
    expect(findGlass(lookAtWall0([]), ROOM, 0)).toEqual([]);
  });
});
