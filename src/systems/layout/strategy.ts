import type { MountType, ModuleInstance } from '@/lib/types';
import { checkClearances, detectCollisions } from './constraints';
import { detectFixtureConflicts, detectOpeningObstruction } from './fixtures';
import { packRun, placementToInstance, yBand } from './pack';
import { buildRuns } from './runs';
import {
  DEFAULT_RULES,
  type Blocker,
  type LayoutFixture,
  type LayoutRequest,
  type LayoutResult,
  type LayoutRules,
  type Placement,
  type PlacementModule,
  type Violation,
  type WallRun,
} from './types';

/** Fixtures to validate against: an explicit list, else the room's wall fixtures. */
function resolveFixtures(request: LayoutRequest): LayoutFixture[] {
  if (request.fixtures) return request.fixtures;
  const out: LayoutFixture[] = [];
  for (const wall of request.room.walls) {
    for (const f of wall.fixtures ?? []) {
      out.push({
        id: f.id,
        type: f.type,
        wallId: wall.id,
        offset: f.offset,
        height: f.height,
      });
    }
  }
  return out;
}

/**
 * Modules on the same wall pack along the wall's 1D coordinate — but a base
 * cabinet and a wall cabinet stacked above it must each start at the wall's
 * origin, not in sequence. So packing runs once per vertical band: floor-resting
 * units (floor / countertop) and wall-hung units (wall / ceiling) get
 * independent cursors over the same run. Vertical-band gating in collision
 * detection then keeps the two layers from false-colliding.
 */
const FLOOR_BAND: MountType[] = ['floor', 'countertop'];
const bandOf = (mount: MountType): 'floor' | 'wall' =>
  FLOOR_BAND.includes(mount) ? 'floor' : 'wall';

/**
 * Where two active walls meet, the run starting at the corner keeps clear of
 * the units on the run ending there. The flat corner reserve assumes those are
 * no deeper than it is; a 650 mm fridge against a 600 mm reserve reached 50 mm
 * into the next run, and every U-shaped plan collided at that corner.
 */
function reserveCornersForDepth(
  runs: Map<string, WallRun>,
  request: LayoutRequest,
  rules: LayoutRules,
): void {
  for (const assignment of request.assignments) {
    const run = runs.get(assignment.wallId);
    if (!run) continue;
    for (const other of request.assignments) {
      const o = other.wallId === assignment.wallId ? undefined : runs.get(other.wallId);
      if (!o) continue;
      const oEnd = { x: o.origin.x + o.dir.x * o.length, z: o.origin.z + o.dir.z * o.length };
      if (Math.hypot(oEnd.x - run.origin.x, oEnd.z - run.origin.z) >= 1) continue;
      const deepest = Math.max(0, ...other.modules.map((m) => m.depth));
      run.usableStart = Math.max(run.usableStart, rules.wallGap + deepest);
    }
  }
}

export interface LayoutStrategy {
  generate(request: LayoutRequest): LayoutResult;
}

/**
 * Deterministic greedy strategy: pack each assigned run left-to-right, then
 * validate (collisions + clearance). Predictable and fast — the MVP default.
 *
 * A search-based strategy (e.g. simulated annealing over module order and
 * run assignment, scored by packed-width / clearance violations) can implement
 * this same `LayoutStrategy` interface later without touching any caller.
 */
export class GreedyStrategy implements LayoutStrategy {
  generate(request: LayoutRequest): LayoutResult {
    const rules: LayoutRules = { ...DEFAULT_RULES, ...request.rules };
    const activeWallIds = request.assignments.map((a) => a.wallId);
    const fixtures = resolveFixtures(request);
    const runs = buildRuns(request.room, activeWallIds, rules, {
      fixtures,
      obstacles: request.obstacles,
    });
    reserveCornersForDepth(runs, request, rules);

    const placements: Placement[] = [];
    const unplaced: PlacementModule[] = [];

    for (const assignment of request.assignments) {
      const run = runs.get(assignment.wallId);
      if (!run) {
        unplaced.push(...assignment.modules);
        continue;
      }
      // Pack each vertical band independently so wall units stack above base
      // units rather than queueing after them along the wall.
      const floorBand = assignment.modules.filter((m) => bandOf(m.mount) === 'floor');
      const wallBand = assignment.modules.filter((m) => bandOf(m.mount) === 'wall');
      const floorPacked = packRun(run, floorBand, rules);
      placements.push(...floorPacked.placements);
      unplaced.push(...floorPacked.unplaced);
      // The bands share the wall, so what the floor band put there stands in
      // the wall band's way where it reaches up into it: a tall unit or a
      // fridge. Without this a wall cabinet was hung straight into the larder.
      const wallRun: WallRun = {
        ...run,
        blocked: [
          ...run.blocked,
          ...floorPacked.placements.map((p): Blocker => {
            const band = yBand(p.module);
            return {
              kind: 'unit',
              start: p.offset,
              end: p.offset + p.module.width,
              bottom: band.start,
              top: band.end,
            };
          }),
        ],
      };
      const wallPacked = packRun(wallRun, wallBand, rules);
      placements.push(...wallPacked.placements);
      unplaced.push(...wallPacked.unplaced);
    }

    const instances: ModuleInstance[] = placements.map((p) =>
      placementToInstance(p),
    );

    const violations: Violation[] = [
      ...detectCollisions(placements, instances),
      ...checkClearances(placements, instances, rules),
      ...detectFixtureConflicts(placements, instances, fixtures, rules),
      ...detectOpeningObstruction(placements, instances),
    ];

    for (const module of unplaced) {
      violations.push({
        kind: 'unplaced',
        severity: 'warning',
        message: `Could not place ${module.definitionId} (width ${module.width}mm) — run full or blocked`,
        instanceIds: [],
      });
    }

    // Flag instances participating in any hard (error) violation as invalid —
    // a collision, a sealed socket / pipe, or a unit across an opening.
    const invalid = new Set(
      violations
        .filter((v) => v.severity === 'error')
        .flatMap((v) => v.instanceIds),
    );
    for (const instance of instances) {
      if (invalid.has(instance.id)) instance.valid = false;
    }

    return { instances, placements, violations, unplaced };
  }
}

const defaultStrategy = new GreedyStrategy();

/** Convenience entry point using the default (greedy) strategy. */
export function generateLayout(request: LayoutRequest): LayoutResult {
  return defaultStrategy.generate(request);
}
