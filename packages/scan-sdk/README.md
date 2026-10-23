# @mozu/scan-sdk

Framework-agnostic **phone scanning → floorplan** SDK. One contract
(`RoomScan`) and one engine (`buildFloorplan` + `floorplanToSvg`) shared by the
MOZU web app, the Chrome/Safari extensions, and — through the same JSON — the
native iOS RoomPlan app.

```
scan (sensor/AI/manual)  ──▶  RoomScan  ──▶  buildFloorplan  ──▶  Floorplan
                                                                     │
                                            floorplanToSvg ◀─────────┤
                                            handoffUrl     ◀─────────┘
```

## Capture paths (progressive enhancement)

| Path | Where | Accuracy | API |
| --- | --- | --- | --- |
| **Apple RoomPlan** | iOS 17+ LiDAR (native app, `apps/ios`) | cm-level, detects walls/doors | RoomPlan |
| **WebXR hit-test** | Android Chrome / headset browsers | metric (tapped corners) | `scanRoomWithWebXR()` |
| **Camera estimate** | any phone incl. iOS Safari | coarse, user-confirmed | `estimateRoomFromImages()` |
| **Manual** | everywhere | user-asserted | `rectangleScan()` |

No single web API scans rooms across all devices (iOS Safari ships no WebXR), so
the SDK picks the best available path per device and falls back gracefully.

## Quick start

```ts
import { MozuScanner } from '@mozu/scan-sdk';

const scanner = new MozuScanner({ webBase: 'https://app.mozu.example' });

switch (await scanner.capability()) {
  case 'webxr': {
    const scan = await scanner.scanWithAR();          // metric corner tap
    if (scan) document.body.innerHTML = scanner.toSvg(scan, { theme: 'light' });
    break;
  }
  case 'camera': {
    // feed a playing <video> (rear camera) — captures a turn-around sweep
    const scan = await scanner.scanWithCamera(videoEl);
    location.href = scanner.handoff(scan);            // open MOZU on this room
    break;
  }
  default:
    scanner.manual(4000, 3000, 2700);
}
```

## The `RoomScan` contract (`mozu.roomscan/1`)

```jsonc
{
  "schema": "mozu.roomscan/1",
  "polygon": [{ "x": 0, "z": 0 }, { "x": 4000, "z": 0 }, … ], // mm, ordered, closed
  "height": 2700,                                             // mm
  "openings": [{ "type": "door", "wall": 0, "offset": 500, "width": 900, "height": 2030 }],
  "objects":  [{ "category": "refrigerator", "center": { "x": 0, "z": 0 }, "width": 600, "depth": 650, "rotation": 0 }],
  "source": "roomplan" | "webxr" | "camera" | "manual",
  "unitSystem": "metric" | "imperial",
  "confidence": 0.9,
  "capturedAt": "2026-06-05T12:00:00.000Z"
}
```

`handoffUrl()` serializes a scan into the web app's `/scan` deep link
(`?poly=…&h=…`, plus `&scan=<base64>` when openings/objects are present), so any
scanner can drop the user into the configurator on their real room.

## Build the bundles (for the extensions)

```bash
cd packages/scan-sdk
npm install        # esbuild
npm run build      # → dist/mozu-scan-sdk.js (esm) + .global.js (iife)
npm run typecheck  # tsc --noEmit
```

The committed `dist/` lets the extensions load the SDK with no build step.

## Modules

- `types.ts` — `RoomScan`, `Floorplan`, openings/objects, the schema tag.
- `geometry.ts` — pure floor-plane math (area, perimeter, simplify, winding).
- `floorplan.ts` — `buildFloorplan`, `rectangleScan`.
- `massing.ts` — `buildMassing` (scan → white **box massing** model: wall slabs +
  floor + detected objects). The same model the web app and iOS RoomPlan render.
- `svg.ts` — `floorplanToSvg` (dimensioned plan, doors, area; light/dark).
- `format.ts` — metric/imperial length + area formatting.
- `serialize.ts` — `serializeScan`/`parseScan`, `handoffUrl`, `scanFromParams`.
- `webxr.ts` — `scanRoomWithWebXR` (Android in-browser metric scan).
- `camera.ts` — `captureRotationFrames`, `estimateRoomFromImages`.
- `scanner.ts` — `MozuScanner` facade.
