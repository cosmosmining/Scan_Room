import type { ModuleInstance } from '@/lib/types';
import { rectsOverlap } from './geometry2d';
import {
  bandsOverlap,
  placementToClearanceRect,
  placementToRect,
  yBand,
} from './pack';
import type { LayoutRules, Placement, Violation } from './types';

/**
 * Hard overlaps between solid footprints whose vertical bands also overlap.
 * Wall cabinets sitting above base cabinets do NOT collide (disjoint Y bands).
 */
export function detectCollisions(
  placements: Placement[],
  instances: ModuleInstance[],
): Violation[] {
  const violations: Violation[] = [];
  const rects = placements.map(placementToRect);
  const bands = placements.map((p) => yBand(p.module));

  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      if (!bandsOverlap(bands[i], bands[j])) continue;
      if (rectsOverlap(rects[i], rects[j])) {
        violations.push({
          kind: 'collision',
          severity: 'error',
          message: `${instances[i].definitionId} overlaps ${instances[j].definitionId}`,
          instanceIds: [instances[i].id, instances[j].id],
        });
      }
    }
  }
  return violations;
}

/**
 * Circulation / appliance clearance: a module's front zone must not intrude on
 * another module's body. Catches galleys narrower than the walkway rule and
 * appliances lacking their required front space. One warning per pair.
 */
export function checkClearances(
  placements: Placement[],
  instances: ModuleInstance[],
  rules: LayoutRules,
): Violation[] {
  const violations: Violation[] = [];
  const bodies = placements.map(placementToRect);
  const bands = placements.map((p) => yBand(p.module));
  const seen = new Set<string>();

  for (let i = 0; i < placements.length; i++) {
    const { rect: zone, depth } = placementToClearanceRect(placements[i], rules);
    for (let j = 0; j < placements.length; j++) {
      if (i === j) continue;
      if (!bandsOverlap(bands[i], bands[j])) continue;

      const key = [i, j].sort((a, b) => a - b).join(':');
      if (seen.has(key)) continue;

      if (rectsOverlap(zone, bodies[j])) {
        seen.add(key);
        violations.push({
          kind: 'clearance',
          severity: 'warning',
          message: `${instances[i].definitionId} has under ${depth}mm front clearance (blocked by ${instances[j].definitionId})`,
          instanceIds: [instances[i].id, instances[j].id],
          shortfallMm: depth,
        });
      }
    }
  }
  return violations;
}
