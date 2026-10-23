# MOZU native scanner companions

> **Superseded by [`apps/ios`](../apps/ios) and [`extensions/`](../extensions).**
> These remain as the minimal reference scaffolds. The full scan → floorplan
> implementation — RoomPlan app, Chrome/Safari plugins, and the shared
> [`@mozu/scan-sdk`](../packages/scan-sdk) — lives there.


True metric room scanning needs depth/AR sensors that **a website cannot reach
on iOS Safari**. These two native apps do the real scan on-device, then hand the
measured room to the MOZU web app via a deep link.

> ⚠️ **These are native source scaffolds, not part of the web build.** They live
> outside `src/` and must be built in **Xcode** (iOS) / **Android Studio**
> (Android) — they cannot be compiled or run from the web project, and I have not
> been able to build/test them here. Treat them as starting points.

## The hand-off contract

Both apps, when a scan finishes, open this URL in the phone browser:

```
https://<your-mozu-host>/scan?w=<widthMm>&d=<depthMm>&h=<heightMm>
# or, for a non-rectangular room, a polygon (x,z pairs in mm, top-down):
https://<your-mozu-host>/scan?poly=0,0;4000,0;4000,3000;0,3000&h=2700
```

The web app's `/scan` route reads those params, builds the 3D room, and opens the
configurator on it. (`src/app/scan/page.tsx`.) Set `<your-mozu-host>` to wherever
the web app is served (your Vercel URL, the cloudflared tunnel, your LAN IP).

| App | Folder | Tech | Accuracy |
| --- | --- | --- | --- |
| Apple RoomPlan | `ios-roomplan/` | Swift + RoomPlan (iOS 17+, LiDAR device) | metric, cm-level |
| Google ARCore | `android-arcore/` | Kotlin + ARCore (ARCore-supported device) | metric |

Both are the genuinely-accurate path; the web app's `📐 AR measure` (WebXR) is the
in-browser equivalent for Android only.
