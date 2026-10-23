# three/ — 3D Visualization Engine

React Three Fiber viewport. A pure projection of the store: it reads `room`,
`instances`, `catalog`, and viewer settings and renders them — it never owns
domain state.

## Scene architecture

```
SceneCanvas              client-only host: <Canvas> (perf settings) | <Plan2D> fallback
  └─ Scene               metre-space rig + mm-space content
       ├─ Lighting       preset: studio | daylight | evening (1 shadow light each)
       ├─ gridHelper     ground reference
       ├─ <group scale={MM_TO_M}>   ← author in mm, render in m
       │    ├─ RoomShell        floor + walls from room geometry
       │    ├─ ModuleInstances  instanced cabinets (1 draw call)
       │    ├─ SnapGuides       wall-snap rails (reuses layout engine buildRuns)
       │    └─ HumanAvatar      real-scale proxy, 140–200 cm
       └─ OrbitControls
  └─ ViewerControls      DOM overlay: view mode · lighting · avatar slider · snap · AR
```

## Units

Domain is millimetres; Three renders in metres. Content is authored in mm inside
a `MM_TO_M` group; camera / lights / controls live in metre space and convert
via `units.ts`. Keeps coordinates small for shadow/lighting precision.

## Performance-first

- `frameloop="demand"` — renders only on change (configurators are static most
  of the time); OrbitControls invalidates on interaction.
- `dpr={[1, 2]}` clamp; `powerPreference: 'high-performance'`.
- **Instanced** modules: one `InstancedMesh` (unit box, per-instance
  matrix + color) for every cabinet, regardless of count or size.
- One shadow-casting light per lighting preset.
- Canvas mounts client-side only (no SSR WebGL).
- *Later:* GLB models + LOD, BVH raycasting, frustum culling, `<AdaptiveDpr>`.

## Mobile

- **WebXR AR** — `useARSupport()` detects `immersive-ar`; `ARButton` shows only
  where supported (Android/headset; never iOS Safari). The immersive session
  wires via `@react-three/xr` (`createXRStore().enterAR()`) — deferred to keep
  the install lean. The button is the seam + capability gate.
- **2D fallback** — `Plan2D`, a pure-SVG top-down plan (no WebGL/AR), the
  universal view; toggle via the view-mode control.

## Deferred

Real GLB module models, drag-to-place (uses `snapToWall` from the layout
engine), selection highlighting, AR session, material PBR maps.
