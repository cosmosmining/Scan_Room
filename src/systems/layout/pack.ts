import type { ModuleInstance } from '@/lib/types';
import { createId } from '@/lib/utils';
import {
  add,
  rotationYFromNormal,
  scale,
  type Rect,
  type Vec2,
} from './geometry2d';
import type {
  Interval,
  LayoutRules,
  Placement,
  PlacementModule,
  WallRun,
} from './types';

export interface PackResult {
  placements: Placement[];
  unplaced: PlacementModule[];
}

/**
 * Greedy left-to-right 1D packing along a run. Modules keep their given order;
 * each is placed at the first free offset that fits without crossing a blocked
 * interval. Anything that no longer fits is returned as `unplaced`.
 */
export function packRun(
  run: WallRun,
  modules: PlacementModule[],
  _rules: LayoutRules,
): PackResult {
  const placements: Placement[] = [];
  const unplaced: PlacementModule[] = [];
  let cursor = run.usableStart;

  for (const module of modules) {
    const offset = nextFreeOffset(cursor, module.width, run);
    if (offset === null) {
      unplaced.push(module);
      continue;
    }
    placements.push({ module, run, offset });
    cursor = offset + module.width;
  }

  return { placements, unplaced };
}

/** First offset ≥ cursor where [offset, offset+width] fits and clears blocks. */
function nextFreeOffset(
  cursor: number,
  width: number,
  run: WallRun,
): number | null {
  let candidate = Math.max(cursor, run.usableStart);
  let moved = true;
  while (moved) {
    moved = false;
    for (const b of run.blocked) {
      if (candidate < b.end && candidate + width > b.start) {
        candidate = b.end;
        moved = true;
      }
    }
  }
  return candidate + width > run.usableEnd ? null : candidate;
}

/** Footprint centre of a placement in the floor plane. */
function centerOf(placement: Placement): Vec2 {
  const { module, run, offset } = placement;
  const along = scale(run.dir, offset + module.width / 2);
  const inward = scale(run.normal, module.depth / 2);
  return add(add(run.origin, along), inward);
}

/** Convert a placement into a world-space ModuleInstance. */
export function placementToInstance(
  placement: Placement,
  id: string = placement.module.ref ?? createId('mi'),
): ModuleInstance {
  const { module, run } = placement;
  const center = centerOf(placement);
  return {
    id,
    definitionId: module.definitionId,
    position: { x: center.x, y: module.elevation ?? 0, z: center.z },
    rotationY: rotationYFromNormal(run.normal),
    width: module.width,
    finishId: module.finishId,
    selectedOptionIds: [],
    wallId: run.wallId,
    valid: true,
  };
}

/** Solid footprint rectangle (OBB) of a placement, for collision tests. */
export function placementToRect(placement: Placement): Rect {
  const { module, run } = placement;
  return {
    center: centerOf(placement),
    axisX: run.dir,
    axisZ: run.normal,
    halfX: module.width / 2,
    halfZ: module.depth / 2,
  };
}

/** Clearance zone rectangle extending in front (inward) of a placement. */
export function placementToClearanceRect(
  placement: Placement,
  rules: LayoutRules,
): { rect: Rect; depth: number } {
  const { module, run, offset } = placement;
  const depth = Math.max(module.frontClearance ?? 0, rules.walkwayClearance);
  const along = scale(run.dir, offset + module.width / 2);
  const inward = scale(run.normal, module.depth + depth / 2);
  return {
    rect: {
      center: add(add(run.origin, along), inward),
      axisX: run.dir,
      axisZ: run.normal,
      halfX: module.width / 2,
      halfZ: depth / 2,
    },
    depth,
  };
}

/** Vertical [bottom, top] band of a module. */
export function yBand(module: PlacementModule): Interval {
  const bottom = module.elevation ?? 0;
  return { start: bottom, end: bottom + module.height };
}

export function bandsOverlap(a: Interval, b: Interval, eps = 1): boolean {
  return a.start < b.end - eps && b.start < a.end - eps;
}
