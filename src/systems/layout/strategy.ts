import type { MountType, ModuleInstance } from '@/lib/types';
import { checkClearances, detectCollisions } from './constraints';
import { detectFixtureConflicts, detectOpeningObstruction } from './fixtures';
import { packRun, placementToInstance } from './pack';
import { buildRuns } from './runs';
import {
  DEFAULT_RULES,
  type LayoutFixture,
  type LayoutRequest,
  type LayoutResult,
  type LayoutRules,
  type Placement,
  type PlacementModule,
  type Violation,
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
    const runs = buildRuns(request.room, activeWallIds, rules);

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
      for (const band of [floorBand, wallBand]) {
        if (band.length === 0) continue;
        const packed = packRun(run, band, rules);
        placements.push(...packed.placements);
        unplaced.push(...packed.unplaced);
      }
    }

    const instances: ModuleInstance[] = placements.map((p) =>
      placementToInstance(p),
    );

    const fixtures = resolveFixtures(request);
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
