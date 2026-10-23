import type { Room } from '@/lib/types';
import type { Catalog } from '@/systems/catalog';
import {
  DEFAULT_RULES,
  buildRuns,
  generateLayout,
  type LayoutRequest,
  type PlacementModule,
  type RunAssignment,
  type WallRun,
} from '@/systems/layout';
import type {
  BaselineLayout,
  DesignIntent,
  LayoutRecommendation,
  LayoutShape,
  PlannableRun,
  PlannedModule,
} from './types';

/**
 * The MOZU AI layout generator. Given a captured room boundary it composes a
 * functional baseline (the script's worked example: sink · drawers · fridge ·
 * hood · stove · three overhead cabinets) and a ranked set of alternatives —
 * the "Kitchen Sets" the reference app surfaces with a RECOMMENDED badge.
 *
 * Pure and deterministic: same room + catalog → same recommendations. It never
 * invents geometry; everything is composed from real catalog definitions and
 * validated by the existing layout engine (packing, clearances, collisions).
 */

// ── Run analysis ─────────────────────────────────────────────────────────────

interface RunGeom extends PlannableRun {
  run: WallRun;
}

const CORNER_EPS = 1;
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);
const runEnd = (r: WallRun) => ({
  x: r.origin.x + r.dir.x * r.length,
  z: r.origin.z + r.dir.z * r.length,
});

/** Usable runs for every wall, longest first. */
export function analyzeRuns(room: Room): RunGeom[] {
  const allWallIds = room.walls.map((w) => w.id);
  const runs = buildRuns(room, allWallIds, DEFAULT_RULES);
  const out: RunGeom[] = [];
  for (const wall of room.walls) {
    const run = runs.get(wall.id);
    if (!run) continue;
    out.push({
      run,
      wallId: wall.id,
      length: run.length,
      usableLength: Math.max(0, run.usableEnd - run.usableStart),
      startsAtCorner: run.usableStart > DEFAULT_RULES.wallGap + CORNER_EPS,
    });
  }
  return out.sort((a, b) => b.usableLength - a.usableLength);
}

/** Two runs are adjacent when they share a wall endpoint (an inside corner). */
function adjacent(a: WallRun, b: WallRun): boolean {
  const ends = [a.origin, runEnd(a)];
  const bEnds = [b.origin, runEnd(b)];
  return ends.some((p) => bEnds.some((q) => dist(p, q) < CORNER_EPS * 100));
}

/** Two runs oppose when (near-)parallel and not sharing a corner (a galley). */
function opposing(a: WallRun, b: WallRun): boolean {
  const dot = a.dir.x * b.dir.x + a.dir.z * b.dir.z;
  return Math.abs(dot) > 0.92 && !adjacent(a, b);
}

// ── Module kit (the script's baseline ingredients) ───────────────────────────

interface Spec {
  definitionId: string;
  width: number;
}

const KIT = {
  fridge: { definitionId: 'fridge-600', width: 600 },
  sink: { definitionId: 'sink-base-800', width: 800 },
  drawer: { definitionId: 'drawer-base-600', width: 600 },
  cooker: { definitionId: 'cooker-600', width: 600 },
  upper: { definitionId: 'wall-600', width: 600 },
  hood: { definitionId: 'hood-600', width: 600 },
  baseWide: { definitionId: 'base-800', width: 800 },
  base: { definitionId: 'base-600', width: 600 },
  tall: { definitionId: 'tall-600', width: 600 },
  wardrobe: { definitionId: 'wardrobe-1000', width: 1000 },
} as const satisfies Record<string, Spec>;

/** Turn a catalog definition + chosen width into an engine PlacementModule. */
function toPlacement(
  catalog: Catalog,
  spec: Spec,
  ref: string,
): PlacementModule | null {
  const def = catalog.definitions[spec.definitionId];
  if (!def) return null;
  return {
    ref,
    definitionId: def.id,
    category: def.category,
    mount: def.constraints.mount,
    width: spec.width,
    depth: def.dimensions.depth,
    height: def.dimensions.height,
    elevation: def.constraints.defaultElevation,
    frontClearance: def.constraints.frontClearance,
  };
}

const isWall = (catalog: Catalog, spec: Spec): boolean =>
  catalog.definitions[spec.definitionId]?.constraints.mount === 'wall';

// ── Composition ──────────────────────────────────────────────────────────────

/**
 * Compose the primary cooking run: fridge at one end, then sink + drawers +
 * cooker, with three overhead cabinets and a hood above (the worked example).
 * Scales to the usable length — drops the fridge in tight runs, fills the slack
 * with drawer bases.
 */
function composePrimary(usable: number): Spec[] {
  const wantFridge = usable >= 2400;
  const reserved = KIT.sink.width + KIT.cooker.width + (wantFridge ? KIT.fridge.width : 0);
  const drawerCount = Math.max(0, Math.min(4, Math.floor((usable - reserved) / KIT.drawer.width)));

  // Base band — fridge is placed last so it never sits under the uppers.
  const base: Spec[] = [KIT.sink];
  for (let i = 0; i < drawerCount; i++) base.push(KIT.drawer);
  base.push(KIT.cooker);
  if (wantFridge) base.push(KIT.fridge);

  // Wall band — uppers over the sink/cooker zone (excluding the fridge column),
  // capped at three plus a hood, so the wall band never reaches the fridge.
  const upperZone = usable - (wantFridge ? KIT.fridge.width : 0);
  const upperCount = Math.max(0, Math.min(3, Math.floor(upperZone / KIT.upper.width) - 1));
  const wall: Spec[] = [];
  for (let i = 0; i < upperCount; i++) wall.push(KIT.upper);
  if (upperCount > 0) wall.push(KIT.hood);

  return [...base, ...wall];
}

/** Compose a storage run: base cabinets to fill, with matching uppers. */
function composeStorage(usable: number, withLarder: boolean): Spec[] {
  const out: Spec[] = [];
  let remaining = usable;
  if (withLarder && remaining >= KIT.tall.width) {
    out.push(KIT.tall);
    remaining -= KIT.tall.width;
  }
  // Greedy wide-then-narrow base cabinets.
  while (remaining >= KIT.base.width) {
    const spec = remaining >= KIT.baseWide.width ? KIT.baseWide : KIT.base;
    out.push(spec);
    remaining -= spec.width;
  }
  // One upper per base cabinet, capped to the run.
  const upperCount = Math.min(
    out.filter((s) => s === KIT.base || s === KIT.baseWide).length,
    Math.floor(usable / KIT.upper.width),
  );
  for (let i = 0; i < upperCount; i++) out.push(KIT.upper);
  return out;
}

/** Wardrobe run: full-height frames packed across the wall. */
function composeWardrobe(usable: number): Spec[] {
  const out: Spec[] = [];
  let remaining = usable;
  while (remaining >= KIT.wardrobe.width) {
    out.push(KIT.wardrobe);
    remaining -= KIT.wardrobe.width;
  }
  if (remaining >= KIT.base.width) out.push({ definitionId: 'wardrobe-1000', width: remaining });
  return out;
}

// ── Recommendation assembly ──────────────────────────────────────────────────

function assignmentsFor(
  catalog: Catalog,
  shape: LayoutShape,
  runsForShape: { run: RunGeom; specs: Spec[] }[],
): { assignments: RunAssignment[]; planned: PlannedModule[] } {
  const assignments: RunAssignment[] = [];
  const planned: PlannedModule[] = [];
  runsForShape.forEach(({ run, specs }, runIdx) => {
    const modules: PlacementModule[] = [];
    specs.forEach((spec, i) => {
      const placement = toPlacement(catalog, spec, `${shape}-${runIdx}-${i}`);
      if (!placement) return;
      modules.push(placement);
      planned.push({ definitionId: spec.definitionId, wallId: run.wallId, width: spec.width });
    });
    if (modules.length > 0) assignments.push({ wallId: run.wallId, modules });
  });
  return { assignments, planned };
}

const SHAPE_LABEL: Record<LayoutShape, string> = {
  'single-wall': 'Single-wall kitchen',
  galley: 'Galley kitchen',
  'l-shaped': 'L-shaped kitchen',
  'u-shaped': 'U-shaped kitchen',
};

/** Pick the runs that realise a shape, or null if the geometry can't support it. */
function runsForShape(shape: LayoutShape, runs: RunGeom[]): RunGeom[] | null {
  const [longest, ...rest] = runs;
  if (!longest || longest.usableLength < 1500) return null;
  switch (shape) {
    case 'single-wall':
      return [longest];
    case 'galley': {
      const opp = rest.find((r) => opposing(r.run, longest.run) && r.usableLength >= 1500);
      return opp ? [longest, opp] : null;
    }
    case 'l-shaped': {
      const adj = rest.find((r) => adjacent(r.run, longest.run) && r.usableLength >= 1200);
      return adj ? [longest, adj] : null;
    }
    case 'u-shaped': {
      const adj = rest.filter((r) => adjacent(r.run, longest.run) && r.usableLength >= 1200);
      return adj.length >= 2 ? [longest, adj[0], adj[1]] : null;
    }
  }
}

function compose(
  domain: DesignIntent['domain'],
  shape: LayoutShape,
  shapeRuns: RunGeom[],
): { run: RunGeom; specs: Spec[] }[] {
  if (domain === 'wardrobe') {
    return shapeRuns.map((run) => ({ run, specs: composeWardrobe(run.usableLength) }));
  }
  return shapeRuns.map((run, i) => ({
    run,
    specs:
      i === 0
        ? composePrimary(run.usableLength)
        : composeStorage(run.usableLength, shape !== 'galley'),
  }));
}

function buildRecommendation(
  room: Room,
  catalog: Catalog,
  intent: DesignIntent,
  shape: LayoutShape,
  shapeRuns: RunGeom[],
): LayoutRecommendation {
  const composed = compose(intent.domain, shape, shapeRuns);
  const { assignments, planned } = assignmentsFor(catalog, shape, composed);
  const request: LayoutRequest = { room, assignments };
  const result = generateLayout(request);

  const requested = planned.length || 1;
  const placedRatio = result.instances.length / requested;
  const hasErrors = result.violations.some((v) => v.severity === 'error');
  const shapeFit = shapeFitness(shape, shapeRuns);
  const score = clamp01(
    0.45 + 0.3 * placedRatio + 0.2 * shapeFit - (hasErrors ? 0.25 : 0) - 0.05 * result.unplaced.length,
  );

  const baseCount = planned.filter((p) => !isWall(catalog, p)).length;
  const wallCount = planned.filter((p) => isWall(catalog, p)).length;
  const rationale =
    intent.domain === 'wardrobe'
      ? `${planned.length} full-height wardrobe sections across ${shapeRuns.length} wall${shapeRuns.length > 1 ? 's' : ''} (${Math.round(shapeRuns[0].usableLength)} mm primary run).`
      : `${baseCount} base units + ${wallCount} wall units across ${shapeRuns.length} wall${shapeRuns.length > 1 ? 's' : ''}. ` +
        `${result.unplaced.length === 0 ? 'Everything fits' : `${result.unplaced.length} unit(s) trimmed to fit`} the ${Math.round(shapeRuns[0].usableLength)} mm run.`;

  return {
    id: `rec-${shape}`,
    name: SHAPE_LABEL[shape],
    shape,
    score,
    recommended: false,
    rationale,
    request,
    result,
    modules: planned,
  };
}

/** Geometric suitability of a shape for the available runs (0..1). */
function shapeFitness(shape: LayoutShape, runs: RunGeom[]): number {
  const primary = runs[0]?.usableLength ?? 0;
  switch (shape) {
    case 'single-wall':
      return primary >= 3000 ? 0.9 : 0.6;
    case 'galley':
      return runs.length === 2 && runs[1].usableLength >= 1800 ? 0.85 : 0.5;
    case 'l-shaped':
      return runs.length === 2 && runs[1].usableLength >= 1500 ? 1 : 0.6;
    case 'u-shaped':
      return runs.length === 3 ? 0.95 : 0.5;
  }
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// ── Public API ───────────────────────────────────────────────────────────────

const ALL_SHAPES: LayoutShape[] = ['single-wall', 'galley', 'l-shaped', 'u-shaped'];

/**
 * Rank every layout the room can support. The top-scoring one is flagged
 * `recommended` — the app's RECOMMENDED badge / "Need advice" answer.
 */
export function recommendLayouts(
  room: Room,
  catalog: Catalog,
  intent: DesignIntent = { domain: 'kitchen' },
): LayoutRecommendation[] {
  const runs = analyzeRuns(room);
  const recs: LayoutRecommendation[] = [];
  for (const shape of ALL_SHAPES) {
    const shapeRuns = runsForShape(shape, runs);
    if (!shapeRuns) continue;
    recs.push(buildRecommendation(room, catalog, intent, shape, shapeRuns));
  }
  recs.sort((a, b) => b.score - a.score);
  if (recs[0]) recs[0].recommended = true;
  return recs;
}

/**
 * The instant, functional baseline for the space — the highest-ranked
 * recommendation, presented as a ready-to-use starting point. This is what the
 * AI drops the user into after a scan, before any manual modification.
 */
export function generateBaseline(
  room: Room,
  catalog: Catalog,
  intent: DesignIntent = { domain: 'kitchen' },
): BaselineLayout {
  const recommendations = recommendLayouts(room, catalog, intent);
  const recommendation =
    recommendations[0] ??
    buildRecommendation(room, catalog, intent, 'single-wall', analyzeRuns(room).slice(0, 1));

  const placed = recommendation.modules.length - recommendation.result.unplaced.length;
  const summary =
    `${recommendation.name}: ${recommendation.result.instances.length} units placed` +
    `${placed !== recommendation.modules.length ? '' : ''}. ${recommendation.rationale}`;

  return { recommendation, summary };
}
