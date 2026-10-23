# Apple RoomPlan companion (iOS)

Native LiDAR room scan → hands the room to MOZU web via `/scan?w=&d=&h=`.

## Requirements
- Xcode 15+, **iOS 17+** deployment target.
- A **LiDAR** device (iPhone 12 Pro or later Pro / iPad Pro). RoomPlan does not run in the simulator.

## Build
1. Xcode → New → App (SwiftUI, Swift). Replace the generated `ContentView.swift` with [`RoomScan.swift`](./RoomScan.swift).
2. In `RoomScan.swift`, set `WEB_BASE` to your MOZU host (Vercel URL / cloudflared tunnel / `http://<lan-ip>:3000`).
3. Target → Info → add **Privacy – Camera Usage Description**.
4. Run on a real LiDAR device.

## Flow
Start scan → walk the room → Finish → it computes the bounding W×D×H (cm-level) →
**Open in MOZU** launches `WEB_BASE/scan?w=…&d=…&h=…` and the configurator opens
on your real room.

## Notes
- Uses the room's bounding box (rectangular). RoomPlan also returns the full wall
  set — to send a true polygon, build a `poly=` param from the ordered wall
  endpoints instead (see the web `/scan` route for the format).
- This is the **accurate** path on iPhone; the web app's WebXR `AR measure` is
  Android-only.
