# systems/layout/ — Layout Engine

Constraint-based placement of modules into a room. Pure TypeScript, no React /
Three. Input: room geometry + what to place. Output: world-space
`ModuleInstance[]` plus diagnostics.

## Key idea

Cabinet/wardrobe layout is **1D packing along wall runs**, not free 2D bin
packing. So the engine works on *runs* (usable stretches of wall with a local
1D coordinate), and the supported shapes are just run configurations — **not
special-cased**:

| Shape | Runs |
| --- | --- |
| Straight / wardrobe wall | 1 run |
| L-shaped | 2 adjacent runs (share a corner) |
| Galley | 2 opposing runs (face each other) |
| U-shaped | 3 connected runs |

Inside **corners** are handled generically (the run whose *start* sits at a
shared endpoint reserves `cornerReserve`); **opposing** runs are handled by the
clearance check (walkway). Add a wall to the request and the shape follows.

## Pipeline

```
LayoutRequest (room + per-wall module assignments + rules)
      │
      ▼  buildRuns()      walls → WallRun[]  (inward normal, corner reserve, opening blocks)
      ▼  packRun()        greedy 1D packing per run → Placement[]  (+ unplaced)
      ▼  placementTo*()   Placement → world ModuleInstance / OBB rect
      ▼  detectCollisions / checkClearances   OBB + SAT, with vertical bands
      ▼
LayoutResult (instances, placements, violations, unplaced)
```

## Data structures (`types.ts`)

- **`WallRun`** — origin, `dir`, inward `normal`, length, `[usableStart,
  usableEnd]`, blocked intervals.
- **`PlacementModule`** — width/depth/height, mount, elevation, `frontClearance`.
- **`LayoutRules`** — `walkwayClearance`, `cornerReserve`, `wallGap`,
  `openingSillThreshold` (see `DEFAULT_RULES`).
- **`RunAssignment` / `LayoutRequest`** — which wall, what to place.
- **`Placement`** — module + run + along-run offset (pre-transform).
- **`Violation` / `LayoutResult`** — diagnostics + output instances.

## What's included (MVP)

- **Wall snapping** — packing puts each module back-to-wall and sequential by
  construction; `snapToWall()` adds interactive nearest-wall + neighbour-edge
  snapping for drag placement.
- **Collision detection** — oriented bounding boxes + Separating Axis Theorem
  (`rectsOverlap`), gated by vertical band overlap so wall units above base
  units don't false-collide. Works at any wall angle.
- **Clearance rules** — a front "clearance zone" per module tested against other
  bodies; flags narrow galleys and appliances without front space.
- **Greedy packing** — deterministic, `O(modules)` per run.

## Geometry conventions

Millimetres, Y-up. A module's local **+Z is its front**; placed flush to the
wall (back on the wall line) and rotated by `rotationYFromNormal(run.normal)`.

## Extension points

- **Search-based strategy** — implement `LayoutStrategy` (e.g. simulated
  annealing over module order / run assignment). `generateLayout` swaps in
  without caller changes.
- **Corner units, fillers, worktop runs, per-mount opening blocks** — layered on
  later without changing the contracts.

## Try it

`demo.ts` → `demoLShapedKitchen()`, `demoGalleyKitchen()`, `demoWardrobeWall()`.
