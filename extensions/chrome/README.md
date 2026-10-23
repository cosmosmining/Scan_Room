# MOZU Room Scanner — Chrome extension (MV3)

A toolbar plugin that turns a room into a **dimensioned floorplan** and opens it
in the MOZU configurator. It's a thin shell over [`@mozu/scan-sdk`](../../packages/scan-sdk) —
the same engine the web app and the iOS app use, so the plan is identical
everywhere.

## What it does

- **Popup** — shows the device's best capture path, a quick manual floorplan
  preview, the MOZU host setting, and a button to open the full scanner.
- **Scanner page** (`scanner.html`) — four capture modes, all producing the same
  `RoomScan`:
  - **Trace** — tap the room's corners; width sets the real scale → any L/U shape.
  - **Camera** — turn-around sweep → a vision model estimates W×D×H.
  - **Manual** — type W×D×H.
  - **AR** — WebXR metric corner-tap (only shown where `immersive-ar` exists).
- Every result renders a floorplan you can **Download as SVG** or **Open in MOZU**
  (a `/scan?poly=…` deep link).

## Build & load

```bash
# from the repo root — vendors the SDK bundle + generates icons
node extensions/build.mjs
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load
unpacked** → select `extensions/chrome`.

## Platform notes (honest)

- Chrome **desktop** has no depth/AR sensors, so Trace / Camera / Manual are the
  realistic paths there; the floorplan + hand-off still work fully.
- Chrome **for Android has no extensions**, so the AR path is effectively for XR
  browsers. True phone AR scanning is the **iOS app** (`apps/ios`, Apple RoomPlan)
  and the **web app's** WebXR measure on Android Chrome — both ship in this repo.
- The camera estimate POSTs to `‹MOZU host›/api/estimate-room`; the scanner asks
  for that host's permission first (declared as `optional_host_permissions`).

## Settings

The MOZU web address (used for hand-off links and the estimate endpoint) is set
in the popup and stored via `storage.sync`. Default: `https://app.mozu.example`.
