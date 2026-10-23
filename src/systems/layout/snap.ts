import type { ModuleInstance, Room } from '@/lib/types';
import {
  add,
  distance,
  dot,
  scale,
  sub,
  type Vec2,
} from './geometry2d';
import { placementToInstance } from './pack';
import { buildRuns } from './runs';
import {
  DEFAULT_RULES,
  type LayoutRules,
  type Placement,
  type PlacementModule,
  type WallRun,
} from './types';

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(Math.max(v, lo), hi);

export interface SnapOptions {
  snapThreshold?: number; // mm; snap to neighbour edges within this distance
  rules?: Partial<LayoutRules>;
  id?: string; // preserve an existing instance id when re-snapping
}

/**
 * Snap a free-dragged module to the nearest active wall: project onto the run,
 * clamp into the usable interval, and snap to a neighbouring module's edge when
 * within `snapThreshold`. Returns a placed ModuleInstance, or null if no run.
 *
 * Supports interactive placement; the auto-layout path snaps by construction.
 */
export function snapToWall(
  room: Room,
  point: Vec2,
  module: PlacementModule,
  existing: ModuleInstance[] = [],
  options: SnapOptions = {},
): ModuleInstance | null {
  const rules: LayoutRules = { ...DEFAULT_RULES, ...options.rules };
  const snapThreshold = options.snapThreshold ?? 100;
  const runs = [...buildRuns(room, room.walls.map((w) => w.id), rules).values()];
  if (runs.length === 0) return null;

  // Nearest run by perpendicular distance to the (clamped) segment.
  let best: { run: WallRun; t: number; dist: number } | null = null;
  for (const run of runs) {
    const t = clamp(dot(sub(point, run.origin), run.dir), 0, run.length);
    const proj = add(run.origin, scale(run.dir, t));
    const dist = distance(point, proj);
    if (!best || dist < best.dist) best = { run, t, dist };
  }
  if (!best) return null;

  const { run } = best;
  const maxOffset = run.usableEnd - module.width;
  let offset = clamp(best.t - module.width / 2, run.usableStart, maxOffset);

  // Snap to neighbouring module edges on the same wall.
  for (const inst of existing) {
    if (inst.wallId !== run.wallId || inst.width == null) continue;
    const neighbour = offsetAlongRun(run, inst);
    const rightEdge = neighbour + inst.width; // place to the right of neighbour
    const leftEdge = neighbour - module.width; // place to the left of neighbour
    if (Math.abs(offset - rightEdge) <= snapThreshold) offset = rightEdge;
    else if (Math.abs(offset - leftEdge) <= snapThreshold) offset = leftEdge;
  }

  offset = clamp(offset, run.usableStart, maxOffset);
  const placement: Placement = { module, run, offset };
  return placementToInstance(placement, options.id);
}

/** Recover a placed instance's along-run start offset (inverse of placement). */
function offsetAlongRun(run: WallRun, inst: ModuleInstance): number {
  const center: Vec2 = { x: inst.position.x, z: inst.position.z };
  const along = dot(sub(center, run.origin), run.dir);
  return along - (inst.width ?? 0) / 2;
}
