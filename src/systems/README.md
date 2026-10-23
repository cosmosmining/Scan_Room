# systems/

Framework-agnostic domain logic. **No React, no Three.js imports** — pure
TypeScript, unit-testable in isolation, runnable on client or server.

Dependency direction: `catalog` → (nothing); `layout` → (nothing); `config` →
`catalog` (+ `layout` types); `pricing` → `config` + `catalog`. Never upward,
never into `state`/`components`.

## `catalog/` — Product catalog

Materials, **style presets** (which lock the per-surface material palette), and
module definitions (cabinets, appliances, accessories, worktops). Seeded in
`data.ts`; hydrates from Supabase later. Selectors: `isMaterialAllowed`,
`materialsForRole`, `getDefinition`, …

## `config/` — Configuration model

The parametric **module tree** (`ConfigNode`), the spatial **layout graph**,
material resolution (`resolveNodeMaterials`, palette-locked), and the bridge to
the layout engine (`nodeToPlacementModule`). The tree is the source of truth;
geometry and price are derived from it.

## `layout/` — Layout engine

Constraint-based placement: walls → runs → greedy 1D packing → OBB/SAT collision
+ clearance. Supports straight / L / U / galley / wardrobe via run configuration.
See `layout/README.md`.

## `pricing/` — Pricing engine

`computePricing(config, catalog, options)` → `PriceBreakdown`. Parametric:
width-scaled base + material area/surcharge + option deltas + tax/delivery. Runs
client-side now; same code can run server-side (Supabase edge function) for the
authoritative quote.

## `scan/` — Space scanning

`SpaceScanner` capture abstraction + manual/floorplan fallback. AR adapters
deferred. See `scan/README.md`.
