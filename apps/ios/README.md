# MOZU Room Scanner — iOS app (Apple RoomPlan)

The native, most-accurate **scan → floorplan**: walk the room with a LiDAR
iPhone/iPad, RoomPlan measures it in 3D (cm-level), and the app generates a
dimensioned floorplan you can open straight in the MOZU configurator.

This is the "1 Scan → 2 Floorplan" flow from the product spec, on-device.

```
RoomPlan scan ─▶ CapturedRoom ─▶ FloorplanBuilder ─▶ RoomScan ─▶ Floorplan
                                                          │            │
                                            Handoff /scan ◀┘   FloorplanCanvas
```

> ⚠️ **Build in Xcode on a Mac.** RoomPlan is iOS-only and needs a LiDAR device;
> it does not run in the Simulator and can't be compiled in this Linux container.
> The sources below are complete and organized as an app target.

## Requirements

- Xcode 15+, **iOS 17+** deployment target.
- A **LiDAR** device: iPhone 12 Pro or later Pro, or iPad Pro.

## Set up the Xcode project

1. Xcode → New → **App** (SwiftUI, Swift). Name it `MozuScanner`.
2. Delete the generated `ContentView.swift` / `…App.swift` and **add the
   `MozuScanner/` folder** from here (App, Models, Scan, Floorplan, Views,
   Export) to the target.
3. Set the target's Info.plist to [`MozuScanner/Info.plist`](./MozuScanner/Info.plist)
   (it has the required **Camera Usage Description**), or copy those keys in.
4. Add the **RoomPlan** framework (it's a system framework — `import RoomPlan`
   resolves once the deployment target is iOS 17+).
5. Run on a real LiDAR device.

## Socket detection (on device)

Sockets are found **during the room scan**, not in a separate pass. RoomPlan
already has the camera open, so `FixtureCapture` samples frames from its
ARSession, `SocketDetector` looks for a socket's giveaway cluster of dark pin
slots, and `FixtureProjector` casts each sighting through the camera intrinsics
onto the finished walls to get {which wall, how far along, how high}.

- `Scan/SocketDetector.swift` — the detector. A faithful Swift port of
  `src/systems/scan/fixtureDetector.ts`, so the iPad finds what the web app
  finds: same thresholds, same solidity and compactness rules, same scoring.
- `Scan/FixtureCapture.swift` — samples the live ARSession (throttled; reads the
  Y plane straight out of ARKit's YCbCr buffer, so there is no colour conversion).
- `Scan/FixtureProjector.swift` — ray-casts sightings onto the room polygon and
  merges repeats. A socket must be seen from **two or more poses** to be kept, so
  a one-frame trick of the light never reaches the plan.

Detected sockets ride the `/scan` handoff to the web configurator as
`RoomScan.fixtures`, where they are drawn on the floorplan and the layout engine
refuses to seal them behind a cabinet.

## Flow

1. **Scan** — tap Start, walk the room; tap Finish. RoomPlan builds a 3D model.
   Sockets are detected as you walk — the hint line shows a running count.
2. **Floorplan** — `FloorplanBuilder` orders the walls into a floor polygon,
   maps doors/windows onto the right walls, and lists detected objects; the app
   draws the dimensioned plan with each wall's measured length, area and ceiling.
3. **Open in MOZU** — opens `‹web host›/scan?poly=…&h=…&scan=…` and the
   configurator loads on your real room (full polygon + openings, not just a
   bounding box). Set the host in the field on the floorplan screen.

## The contract

The app speaks the exact same JSON as [`@mozu/scan-sdk`](../../packages/scan-sdk)
(`mozu.roomscan/1`) — see [`Models/RoomScan.swift`](./MozuScanner/Models/RoomScan.swift)
and [`Export/Handoff.swift`](./MozuScanner/Export/Handoff.swift). That's why the
web app, the browser extensions, and this app all produce an identical floorplan.

## Source layout

| File | Role |
| --- | --- |
| `App/MozuScannerApp.swift` | `@main` app entry |
| `Models/RoomScan.swift` | the `mozu.roomscan/1` contract (Codable) |
| `Scan/RoomCaptureController.swift` | drives `RoomCaptureSession` + `RoomBuilder` |
| `Scan/FloorplanBuilder.swift` | `CapturedRoom` → ordered polygon + openings + objects |
| `Floorplan/Floorplan.swift` | pure dimensioning engine (Swift twin of the SDK) |
| `Floorplan/FloorplanCanvas.swift` | SwiftUI plan renderer (the "2 Floorplan" view) |
| `Views/*` | scan / result / app flow |
| `Export/Handoff.swift` | `/scan` deep link + share |

## Why native on iPhone

iOS Safari ships no WebXR, so true in-browser room scanning isn't possible on
iPhone. RoomPlan is the accurate path (≈25–50 mm, detects walls + openings).
On Android the web app's WebXR `AR measure` is the no-install equivalent.
