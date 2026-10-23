# MOZU Room Scanner — Safari Web Extension

The **same** web extension as the Chrome build (one `@mozu/scan-sdk`, one UI),
packaged for Safari on macOS and iOS/iPadOS. The web assets in `Resources/` are
mirrored from `extensions/chrome` by `node extensions/build.mjs`, so the two
plugins never drift.

> Safari extensions must be wrapped in an Xcode app project and code-signed —
> that part needs **Xcode on a Mac** and can't be produced in this Linux
> container. The web assets and the native handler are ready; the steps below
> generate the project around them.

## Contents

- `Resources/` — the web extension (`manifest.json`, popup, scanner, styles,
  `vendor/mozu-scan-sdk.js`, icons). Generated — do not hand-edit; edit the
  Chrome sources and re-run the build.
- `SafariWebExtensionHandler.swift` — the native messaging bridge.
- `Info.plist` — reference keys for the extension target.

## Build (Xcode on macOS)

The quickest path is Apple's converter, which scaffolds the macOS + iOS app and
extension targets around the shared resources:

```bash
node extensions/build.mjs    # refresh Resources/ from the Chrome assets + SDK

xcrun safari-web-extension-converter extensions/safari/Resources \
  --app-name "MOZU Room Scanner" \
  --bundle-identifier example.mozu.roomscanner \
  --swift --macos --ios
```

Then in the generated project: replace the generated handler with
[`SafariWebExtensionHandler.swift`](./SafariWebExtensionHandler.swift), select
the app target, and Run. Enable the extension in **Safari → Settings →
Extensions** (macOS) or **Settings → Safari → Extensions** (iOS).

Manifest V3, `storage`, `tabs.create`, and `optional_host_permissions` are all
supported by Safari 17+. The code already uses `globalThis.browser ?? chrome`,
so no source changes are needed.

## Platform notes

- iOS Safari has **no WebXR**, so the AR tab won't appear there — Trace, Camera
  estimate, and Manual do work. For true LiDAR scanning on iPhone, use the
  native **`apps/ios`** RoomPlan app; it hands off through the same `/scan` link.
