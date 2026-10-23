# systems/ai/ — AI Layout Generation (Phase 2)

Turn a captured room boundary into a **functional, ready-to-use layout** the user
can then modify — the reference app's "Kitchen Sets" with a RECOMMENDED badge and
its "Need advice" answer. Pure TypeScript, deterministic, no React/Three.

## What it does

```
Room (scanned boundary) + Catalog + DesignIntent
        │
        ▼  analyzeRuns()        walls → usable runs (longest first, corner-aware)
        ▼  compose*()           script's kit → ordered modules per run, scaled to fit
        ▼  generateLayout()     the existing layout engine validates (pack/clearance)
        ▼  score + rank
LayoutRecommendation[]  (each: request + result + rationale + applyable modules)
```

- **`generateBaseline(room, catalog, intent)`** — the instant starting point. For a
  kitchen it composes the worked example from the brief: a **sink**, **drawers**,
  **refrigeration (scaled)**, a **hood**, a **stove**, and **three overhead
  cabinets**, fitted to the longest wall. Drops the fridge / trims drawers in tight
  runs so it always fits.
- **`recommendLayouts(room, catalog, intent)`** — ranks every shape the room can
  support (**single-wall / galley / L / U**), each scored by placement success and
  geometric fit. The top one is flagged `recommended`.

## Key ideas

- **Shape emerges from geometry**, not special cases: `analyzeRuns` measures each
  wall's usable run and detects adjacency (corner) vs. opposition (galley); a shape
  is realised only if the runs support it.
- **Real SKUs only** — everything is composed from catalog definitions and
  validated by `systems/layout` (1D packing, clearances, collisions). A
  recommendation carries its pre-computed `LayoutResult`, so the UI previews fit and
  flags without re-running.
- **Applyable** — each recommendation exposes an ordered `PlannedModule[]`
  (`definitionId` · `wallId` · `width`) the store turns into the live module tree
  via `applyPlannedModules`.

## Wall-band packing

A base cabinet and the wall cabinet above it must each start at the wall origin,
not queue after one another. The layout strategy packs **floor** and **wall**
bands independently along the same run (vertical-band gating then stops them
false-colliding), which is what lets the baseline put three uppers + a hood over
the base run.

## Try it

`recommendLayouts(createDefaultRoom(), defaultCatalog)` → four ranked sets for the
4 × 3 m room (L-shaped recommended). See `__tests__/autolayout.test.ts`.
