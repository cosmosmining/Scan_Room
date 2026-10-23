import type { FixtureType, ModuleInstance } from '@/lib/types';
import { bandsOverlap, yBand } from './pack';
import type {
  LayoutFixture,
  LayoutRules,
  Placement,
  PlacementModule,
  Violation,
} from './types';

/**
 * Furniture-vs-fixture conflict detection: the layer that stops a design from
 * sealing a socket behind a cabinet or blocking a pipe. Runs in the same 1D
 * along-wall coordinate the packer uses, gated by vertical band so a base unit
 * only clashes with a low fixture and a wall unit only with a high one.
 */

const COVER_PAD = 20; // mm overhang tolerance when deciding "covers"

const FIX_LABEL: Record<FixtureType, string> = {
  socket: 'socket',
  switch: 'switch',
  water: 'water supply',
  waste: 'waste pipe',
  gas: 'gas point',
  vent: 'vent',
  radiator: 'radiator',
};

/** A fixture is in a unit's way only if its height falls inside the unit's band. */
function fixtureInBand(fixture: LayoutFixture, module: PlacementModule): boolean {
  return bandsOverlap(yBand(module), {
    start: fixture.height - 1,
    end: fixture.height + 1,
  });
}

function clearanceFor(type: FixtureType, rules: LayoutRules): number {
  return type === 'gas' ? rules.gasClearance : rules.fixtureClearance;
}

/**
 * Errors where a unit seals a fixture that must stay reachable, and warnings
 * where it merely crowds one or an appliance can't reach a required utility.
 * `placements[i]` and `instances[i]` are the same unit (parallel arrays, as in
 * {@link detectCollisions}).
 */
export function detectFixtureConflicts(
  placements: Placement[],
  instances: ModuleInstance[],
  fixtures: LayoutFixture[],
  rules: LayoutRules,
): Violation[] {
  const out: Violation[] = [];

  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    const inst = instances[i];
    const m = p.module;
    const wallId = p.run.wallId;
    const start = p.offset;
    const end = p.offset + m.width;

    for (const f of fixtures) {
      if (f.wallId !== wallId) continue;
      if (!fixtureInBand(f, m)) continue;

      const covered = f.offset >= start - COVER_PAD && f.offset <= end + COVER_PAD;
      if (covered) {
        // A unit designed to sit over this utility (a sink base over water/waste)
        // is the intended connection, not a conflict.
        if (m.connectsUtilities?.includes(f.type)) continue;
        out.push({
          kind: 'fixture-blocked',
          severity: 'error',
          message: `${m.definitionId} seals the ${FIX_LABEL[f.type]} at ${Math.round(
            f.offset,
          )}mm on ${wallId} — it must stay accessible`,
          instanceIds: [inst.id],
          fixtureId: f.id,
        });
      } else {
        const clr = clearanceFor(f.type, rules);
        if (f.offset >= start - clr && f.offset <= end + clr) {
          out.push({
            kind: 'fixture-clearance',
            severity: 'warning',
            message: `${m.definitionId} sits inside the ${clr}mm access zone of the ${FIX_LABEL[f.type]} on ${wallId}`,
            instanceIds: [inst.id],
            fixtureId: f.id,
            shortfallMm: clr,
          });
        }
      }
    }

    // Appliances that need power / gas must have it within reach on the same wall.
    for (const need of m.needsUtilities ?? []) {
      const reachable = fixtures.some(
        (f) =>
          f.type === need &&
          f.wallId === wallId &&
          f.offset >= start - rules.utilityReach &&
          f.offset <= end + rules.utilityReach,
      );
      if (!reachable) {
        out.push({
          kind: 'utility-reach',
          severity: 'warning',
          message: `${m.definitionId} needs a ${FIX_LABEL[need]} within reach — none on ${wallId}`,
          instanceIds: [inst.id],
        });
      }
    }
  }

  return out;
}

/**
 * Floor-standing units that stand across a door / low window. The packer already
 * routes around a run's `blocked` intervals, so this is a no-op for generated
 * layouts — its job is to catch a MANUALLY dragged / snapped unit that lands over
 * an opening.
 */
export function detectOpeningObstruction(
  placements: Placement[],
  instances: ModuleInstance[],
): Violation[] {
  const out: Violation[] = [];
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    if ((p.module.elevation ?? 0) >= 100) continue; // wall units clear the doorway
    const start = p.offset;
    const end = p.offset + p.module.width;
    for (const b of p.run.blocked) {
      if (start < b.end && end > b.start) {
        out.push({
          kind: 'obstruction',
          severity: 'error',
          message: `${p.module.definitionId} stands across an opening on ${p.run.wallId}`,
          instanceIds: [instances[i].id],
        });
        break;
      }
    }
  }
  return out;
}
