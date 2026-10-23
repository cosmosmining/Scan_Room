# MOZU — Modular Living System Configurator

Web platform for designing kitchens and wardrobes with real-time 3D
visualization, modular layouts, instant pricing, and designer handoff.

## Stack

- **Next.js** (App Router) + **TypeScript**
- **Tailwind CSS v4**
- **Zustand** — state
- **Three.js + React Three Fiber** — added in the 3D step (kept out of the
  initial install so versions get pinned against the React version you land on)
- **Supabase** — added in the backend step

## Prerequisites

Node.js **20+** and npm.

> Not detected on this machine. Install from <https://nodejs.org> or, with
> Homebrew: `brew install node`.

## Getting started

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

## Architecture

```
src/
  app/         Next.js routes (kept thin)
  components/  UI — shell, panels, step navigation
  three/       3D rendering layer (React Three Fiber) — incl. scan massing + edges
  systems/     Framework-agnostic domain logic (pure, unit-tested engines):
                 scan · layout · ai · aesthetic · tenant · catalog · config ·
                 pricing · handoff
  state/       Zustand store, organized as composable slices
  lib/         Canonical data models (types), constants, utilities

packages/
  scan-sdk/    @mozu/scan-sdk — phone scanning → floorplan engine (shared)
extensions/
  chrome/      Chrome MV3 plugin (built on the SDK)
  safari/      Safari Web Extension (same assets, native wrapper)
apps/
  ios/         Apple RoomPlan scanner app (native, most accurate)
```

**Core principle:** state is the single source of truth; the 3D scene is a pure
projection of it. Interactions emit state mutations → the store updates → the
scene re-renders. The Three.js scene never holds authoritative state.

Boundary rule: `lib` → `systems` → (`three` | `components` | `state`). Lower
layers never import upward.

## Scan → Floorplan

Walk a room with your phone → get a dimensioned floorplan → drop straight into
the configurator on that real room. One engine ([`@mozu/scan-sdk`](./packages/scan-sdk))
and one wire contract (`mozu.roomscan/1`) are shared across every surface:

| Surface | Capture | Notes |
| --- | --- | --- |
| **Web app** | WebXR AR measure (Android), camera estimate, trace, manual | the `Plan` view mode renders the floorplan; `/scan` ingests a measured room |
| **iOS app** ([`apps/ios`](./apps/ios)) | Apple **RoomPlan** (LiDAR) | most accurate — real polygon + doors/windows + objects |
| **Chrome / Safari** ([`extensions/`](./extensions)) | trace · camera · manual · AR | toolbar plugin → floorplan → "Open in MOZU" |

```bash
# build the SDK + the two browser extensions
npm --prefix packages/scan-sdk install && node extensions/build.mjs
npm test            # includes the floorplan engine unit tests
```

The floorplan engine (area, perimeter, per-wall auto-dimensioning, SVG) is pure
and unit-tested; the web app, the extensions, and the iOS app all produce an
identical plan. See [`packages/scan-sdk/README.md`](./packages/scan-sdk/README.md).

## The MOZU AI-Driven Design System

Three phases take a user from a physical room to a styled, priced configuration —
the pipeline the configurator implements end to end:

| Phase | What the user does | Engine |
| --- | --- | --- |
| **1 · Spatial Capture** | Scan the room — boundary **lines** light up and a white **box massing** builds (the closet included), then *Go to planning* | [`systems/scan`](./src/systems/scan) (`buildMassing`, `createScanAccumulator`, `LidarScanner`) |
| **2 · AI Layout** | A functional baseline is generated (sink · drawers · fridge · hood · stove · 3 overhead cabinets, scaled to the boundary) + ranked **Kitchen Sets** to swap in, then modify | [`systems/ai`](./src/systems/ai) (`generateBaseline`, `recommendLayouts`) |
| **3 · Curated Aesthetic** | Type a directive — **"Japandi"** — and a curated palette locks with a few optimised variations | [`systems/aesthetic`](./src/systems/aesthetic) (`matchTheme`, `generateThemeVariations`) |

The LiDAR scan runs from a live depth sensor **or** a no-sensor *replay*, so the
"lines + box" experience works on any device — including phones without a LiDAR
sensor. It surfaces in the configurator's **Room → Layout → Style** steps.

### Multi-tenant platform (the partnership architecture)

[`systems/tenant`](./src/systems/tenant) encodes the three-layer model: **Core**
(RoomMuse — scanning/AR/storage, shared), **White-label** (catalog/2D/booking,
licensable), and **Brand** (Mozu-exclusive workflow, AI logic, curated themes).
Competitors can ride the core tech but never Mozu's branded experience —
`accessibleFeatures(MOZU, competitor)` proves the isolation.

## Roadmap

- [x] **Step 1** — System architecture & core data models
- [x] **Step 2** — Scaffold, clean architecture, UI shell
- [x] **Step 3** — Scan → floorplan: shared SDK, iOS RoomPlan app, browser plugins
- [x] **Step 4** — AI-Driven Design System: LiDAR box-massing scan, AI layout
      generation + recommendations, curated themes (Japandi), multi-tenant model
