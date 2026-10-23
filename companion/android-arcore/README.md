# Google ARCore companion (Android)

Native AR measure → hands the room to MOZU web via `/scan?poly=…&h=…`.

> ARCore needs a camera + GL renderer scaffold. Rather than re-ship all of that,
> build on Google's official sample and drop in [`RoomMeasure.kt`](./RoomMeasure.kt)
> for the measurement + hand-off. This is a scaffold, built in Android Studio.

## Requirements
- Android Studio, an **ARCore-supported** Android device.
- ARCore SDK (the sample pulls it via Gradle).

## Build
1. Clone the ARCore samples and open the Kotlin Hello AR sample:
   ```
   git clone https://github.com/google-ar/arcore-android-sdk
   # open samples/hello_ar_kotlin in Android Studio
   ```
2. Add [`RoomMeasure.kt`](./RoomMeasure.kt) to the app package; set `WEB_BASE` to
   your MOZU host.
3. In the sample's tap handler, instead of placing the demo anchor, call
   `roomMeasure.onTap(frame, e.x, e.y)` and render a marker at each corner using
   the sample's existing anchor rendering.
4. Add **Undo / Clear / Done** buttons; **Done** calls `roomMeasure.handOff(context)`.

## Flow
Point at the floor, tap each room corner (metric hit-tests), tap **Done** → it
opens `WEB_BASE/scan?poly=…&h=…` and the MOZU configurator loads your real room
shape.

## Notes
- For a faster Kotlin path with less GL boilerplate, **SceneView for Android**
  (`io.github.sceneview:arsceneview`) wraps ARCore — the same `RoomMeasure` logic
  applies to its hit-test results.
- WebXR (the web app's `📐 AR measure`) is the no-install Android alternative —
  same metric hit-test approach, straight in Chrome.
