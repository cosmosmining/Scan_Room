# systems/scan/ — Space Scanning

Capture abstraction for turning a physical room into `RoomGeometry`. Every path
implements one interface — `SpaceScanner` — so the UI/store never depend on a
concrete provider.

## Decision (2026)

**No single API does accurate in-browser room scanning across devices.** iOS
Safari ships no WebXR at all; true in-browser depth is Android/headset only.
So MOZU uses a **tiered, progressive-enhancement capture strategy** behind
`SpaceScanner`, not one vendor:

| Tier | Path | Why |
| --- | --- | --- |
| **Baseline (MVP, universal)** | Manual dimensions + floorplan sketch | Pure web, every device, zero deps. Confidence 1.0 / 0.95. |
| **Enhance — Android web** | WebXR Depth Sensing | Only true in-browser scan; no install. Coarse → user corrects. |
| **Enhance — iOS** | Apple RoomPlan via companion App Clip | Most accurate (≈25–50 mm), detects openings, free. App Clip = no full install. |
| **Premium (later)** | Polycam / Matterport / Twindo import | Pro/AEC fidelity; app+cloud, costlier, higher latency. Not MVP. |

For kitchens/wardrobes we mostly need accurate **wall lengths + opening
positions** — RoomPlan nails exactly that; manual entry of a few walls is often
enough. Photoreal dollhouses (Matterport) and survey CAD (Twindo) are overkill.

See the per-provider comparison and latency/accuracy tradeoffs in the project
design notes (Step 3).

## What's implemented

- `types.ts` — `RoomGeometry`, `SpaceScanner`, capability/option types, fallback
  input types (`ManualDimensions`, `FloorplanSketch`).
- `geometry.ts` — pure converters: manual → geometry, floorplan → geometry,
  geometry → domain `Room`.
- `manualScanner.ts` — `ManualScanner`, the always-available fallback.
- `lidarScanner.ts` — `LidarScanner` (`webxr-depth`): depth-sensor / RoomPlan-class
  provider; `isAvailable()` feature-detects an immersive-AR session, `scan()`
  drives the accumulator and reports live progress.
- `registry.ts` — `resolveScanner()` tries `LidarScanner` first, then manual.

## LiDAR scan: lines + box massing (Phase 1)

The signature capture experience — boundary **lines** lighting up and a white
**box massing** model building — is two pure pieces, driven identically by a live
depth sensor or by a no-sensor *replay* (so it works on any device):

- `massing.ts` — `buildMassing(geometry, objects?)` → `MassingModel`: a slab per
  wall, a floor slab, and a labelled box per detected object (the closet). Matches
  `RoomShell`'s wall convention so it renders flush with the live room.
- `lidarSession.ts` — `createScanAccumulator()`: ingest detected wall planes
  (`addPlane`) and objects (`addObject`); each returns a `ScanSnapshot` of glowing
  `ScanEdge`s + the growing `MassingModel` + `progress`. `finish()` closes the
  loop into a `RoomGeometry`. `planesFromGeometry()` is the replay source.

The same `MassingModel` is mirrored in `@mozu/scan-sdk` (`buildMassing` over a
`RoomScan`), so the iOS RoomPlan app and the browser extensions draw the same
boxes. RoomPlan already exports detected objects (incl. height) through the
shared `RoomScan` contract.

## Fixtures: the scan finds the services (Phase 1)

A layout is only buildable if it respects what is already on the walls — sockets,
switches, and the pipework (water / waste / gas). **In a normal room all of these
are exposed on the wall surface**, which is exactly what a camera can see, so
finding them is part of scanning. Hand entry exists to correct a miss, and is
never a required step:

- `fixtureDetector.ts` — sockets, by their giveaway cluster of dark pin slots on
  a lighter faceplate.
- `pipeDetector.ts` — exposed pipe runs, by the one signature that separates a
  pipe from every other long mark on a wall: a **long run of near-constant
  width**. Two details carry it. The background is estimated from pixels a first
  pass did *not* flag (a plain local mean blooms a halo beside a strong feature
  and a 32 px pipe measures 39 px — and the width *is* the measurement).
  Comparison is per-channel rather than grayscale, because yellow gas pipework
  can sit at the wall's exact luminance while being nothing like its colour.
  Hairlines (cable/shadow edges), stubs, blobs and wandering widths are rejected.
- `fixtureProjection.ts` — casts each detection through the camera pose onto the
  scanned walls to get `{wall, offset, height}` **and the distance**, which turns
  apparent pixels into real millimetres. The bore then names the service: waste
  is unmistakable by size; water and gas overlap and are separated by the yellow
  convention or a low horizontal run. Anything sized outside 8–130 mm is not
  pipework (that is what rejects trunking and architrave). Repeats seen across
  frames merge into one fixture, and every one carries the `reason` it was
  called that.
- `lidarScanner.ts` — runs the pass as part of `scan()` (`ScanOptions.detectFixtures`,
  default **on**), reports a `detecting` progress phase, and returns a
  `FixtureScanSummary` so the UI can say *"6 found — add anything it missed"*
  rather than demand input.

Fixtures ride on `Wall.fixtures`, so they reach the floor plan (`ScanFixture` →
`buildFloorplan` → labelled `Waste ⌀110` markers in `floorplanToSvg`) and the
layout engine (`systems/layout/fixtures.ts`) without any extra plumbing.

## Deferred (next step)

- The device frame source. `captureCameraFrames()` in `lidarScanner.ts` is the
  one remaining hardware seam: the detection engine above is real and tested, but
  until an immersive-AR camera session (or a RoomPlan companion) streams frames
  with poses into it, a live `scan()` returns geometry with an honest empty
  `fixtureScan` summary rather than invented fixtures.
- Live WebXR depth/plane session wiring into `LidarScanner.scan()` (the
  accumulator pipeline is ready); Polycam / Matterport / Twindo import adapters.
