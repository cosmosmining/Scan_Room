# Design module — Xcode setup

How to add the on-device **Design** experience (RealityKit 3D showroom + 2D floor
plan + furniture/material editors) to the MozuScanner app target. There is no
`.xcodeproj` checked in, so these steps assume you create/own the app target in
Xcode and drag in the sources + resources.

> TL;DR: add every `.swift` under `Design/` to the app target, add
> `Resources/Textures/*.png` and `Resources/Models/*.usdz` as **bundle resources**
> (folder reference or individually — *not* an asset catalog), set the deployment
> target to **iOS 17.0**, and make sure RealityKit + ARKit are linked (they are
> system frameworks). Camera usage is already in `Info.plist`.

---

## 1. Add the Design sources to the app target

Add **all** of these to the MozuScanner app target (File ▸ Add Files…, or drag
into the Project navigator with *"Add to targets: MozuScanner"* checked, *"Create
groups"*):

```
Design/DesignContainerView.swift
Design/Model/DesignTypes.swift
Design/Model/DesignState.swift
Design/Model/Catalog.swift
Design/Model/MozuModels.swift
Design/Render/MaterialFactory.swift
Design/Render/ModelLoader.swift
Design/Render/Room3DBuilder.swift
Design/Scene/DesignScene3DView.swift
Design/Scene/FloorPlan2DView.swift
Design/Editor/AddFurnitureSheet.swift
Design/Editor/MaterialEditorView.swift
```

`Design/README.md` and this `SETUP.md` are docs — do **not** add them to the
target. Confirm each `.swift` file shows the MozuScanner target checkbox in the
File inspector (Target Membership).

These sources depend on existing app types that must already be in the target:
`RoomScan` / `Vec2` / `ScanOpening` (`Models/RoomScan.swift`) and the integration
point in `Views/FloorplanResultView.swift` (already edited to present
`DesignContainerView(scan: scan)` via `.fullScreenCover`).

## 2. Add the bundle resources (textures + models)

The Design code references textures and models **by bundle name with no
extension** (e.g. `TextureResource.load(named: "marble_cream")`,
`ModelEntity(named: "KT01")`, `UIImage(named: "marble_cream")`). They must land in
the **app bundle as loose resources**, reachable from `Bundle.main`.

Add both resource folders to the target's **Copy Bundle Resources** build phase:

```
Resources/Textures/   (8 × .png — granite_black, granite_grey, marble_cream,
                       marble_white, oak, plaster, tile_ceramic, walnut)
Resources/Models/     (41 × .usdz — KF/KH/KT/W cabinets + home furnishings)
```

How to add them:

1. Drag `Resources/Textures` and `Resources/Models` into the Project navigator.
2. In the dialog: **"Add to targets: MozuScanner"** checked, and choose
   **"Create folder references"** *or* **"Create groups"** — either works as long
   as the files end up in **Copy Bundle Resources**. Do **not** put them in an
   `.xcassets` asset catalog: the code resolves them as loose bundle resources
   (`Bundle.main` lookups and USDZ-by-name), and the texture loader/thumbnail
   loader degrade gracefully but will fall back to flat colours if the PNGs are
   not loose resources.
3. Verify: target ▸ **Build Phases ▸ Copy Bundle Resources** lists all 8 PNGs and
   all 41 USDZ (plus `manifest.json`, which is harmless to ship).

> Names matter: the resource basenames must match the catalogue exactly
> (`Design/Model/Catalog.swift` swatch `textureName`s, `Design/Model/MozuModels.swift`
> + `Catalog.homeItems` `usdzName`s). A missing/renamed asset will not crash — the
> box fallback / colour fallback kicks in — but the room will look wrong.

## 3. Deployment target

Set **iOS Deployment Target = 17.0** (target ▸ General ▸ Minimum Deployments, and
`IPHONEOS_DEPLOYMENT_TARGET = 17.0` in Build Settings). The module is written for
iOS 17 APIs only — it deliberately uses the classic `ARView` (`cameraMode: .nonAR`)
and `PerspectiveCamera` rather than iOS 18's `RealityView`. See the compile-risk
review in the integration notes before raising/lowering this.

## 4. Frameworks (system — nothing to install)

RealityKit and ARKit are **system frameworks** shipped with iOS; no SwiftPM/CocoaPods
packages are needed (the README mandates "no third-party packages"). They are
auto-linked from the `import RealityKit` / `import ARKit` statements, but if you
prefer explicit linking add them under target ▸ **General ▸ Frameworks, Libraries,
and Embedded Content**:

- `RealityKit.framework`
- `ARKit.framework`

(SwiftUI, Combine, simd, Foundation, UIKit are also system frameworks pulled in by
their `import`s.)

> Note: ARKit only links because `DesignScene3DView` `import`s it for the `ARView`
> ray/hit-test helpers. The 3D scene runs in **non-AR** mode (`PerspectiveCamera`,
> no `ARSession`/world tracking), so it works on the Simulator and on non-LiDAR
> devices — unlike the RoomPlan scan step, which needs LiDAR hardware.

## 5. Info.plist (already covered)

`Info.plist` already declares **`NSCameraUsageDescription`** (added for RoomPlan's
LiDAR scan). The Design module's non-AR `ARView` does **not** start a camera
session, so no additional privacy keys are required for it.

## 6. Sanity check after wiring up

- Build for an iOS 17 simulator or device.
- Scan a room (or reach `FloorplanResultView`), tap **Design room** → the
  `DesignContainerView` should present full-screen, show the textured room shell,
  and let you add furniture / change colours, with the 2D⇄3D toggle staying in
  sync.
- If surfaces render flat white or furniture renders as plain boxes, the
  Textures/Models did not make it into Copy Bundle Resources (step 2).
