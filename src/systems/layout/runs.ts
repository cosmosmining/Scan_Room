import type { Room, Wall } from '@/lib/types';
import {
  distance,
  inwardNormal,
  length as vlen,
  normalize,
  sub,
  type Vec2,
} from './geometry2d';
import type { Interval, LayoutRules, WallRun } from './types';

const CORNER_EPS = 1; // mm tolerance for shared-corner detection

const toVec2 = (p: { x: number; z: number }): Vec2 => ({ x: p.x, z: p.z });

/**
 * Derive packing runs from a room's walls.
 *
 * The shape of the kitchen (straight / L / U / galley / wardrobe wall) is NOT
 * special-cased here — it emerges from which walls are active and how they meet.
 * Inside corners (where two active walls share an endpoint) reserve space on the
 * run whose START sits at the corner, so adjacent runs never collide.
 */
export function buildRuns(
  room: Room,
  activeWallIds: string[],
  rules: LayoutRules,
): Map<string, WallRun> {
  const footprint = room.footprint.map(toVec2);
  const active = room.walls.filter((w) => activeWallIds.includes(w.id));
  const runs = new Map<string, WallRun>();

  for (const wall of active) {
    const start = toVec2(wall.start);
    const end = toVec2(wall.end);
    const dir = normalize(sub(end, start));
    const normal = inwardNormal(start, end, footprint);
    const len = vlen(sub(end, start));

    // Reserve a corner at the start when another active wall ends there.
    const sharedAtStart = active.some(
      (o) => o.id !== wall.id && distance(toVec2(o.end), start) < CORNER_EPS,
    );

    runs.set(wall.id, {
      id: `run_${wall.id}`,
      wallId: wall.id,
      origin: start,
      dir,
      normal,
      length: len,
      usableStart: rules.wallGap + (sharedAtStart ? rules.cornerReserve : 0),
      usableEnd: len - rules.wallGap,
      blocked: blockedIntervals(wall, rules),
    });
  }

  return runs;
}

/** Openings that reach below the sill threshold block floor-standing units. */
function blockedIntervals(wall: Wall, rules: LayoutRules): Interval[] {
  return wall.openings
    .filter((o) => o.sillHeight < rules.openingSillThreshold)
    .map((o) => ({ start: o.offset, end: o.offset + o.width }))
    .sort((a, b) => a.start - b.start);
}
