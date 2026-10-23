# Design module — place & style furniture in the scanned room (iOS / RealityKit)

After RoomPlan produces a `RoomScan` and the dimensioned floorplan, the **Design**
module recreates the room as a realistic 3D space and lets the user **add, drag,
rotate and re-colour furniture** — in a 3D view and a 2D floor-plan view that stay
in sync. Everything runs on-device (SwiftUI + RealityKit), no web app.

## Conventions (read before writing any file)

- **Units: metres.** Floor plane is X (right) / Z (forward), Y up. The source
  `RoomScan` is millimetres; `DesignRoom(scan:)` converts.
- A placed item's `position` is the floor point under its footprint centre; its
  **base sits at y = 0**. `rotationY` is yaw in radians.
- **Target iOS 17+.** Use **RealityKit**. For the non-AR "virtual showroom", use
  `ARView(frame:..., cameraMode: .nonAR, automaticallyConfigureSession: false)`
  inside a `UIViewRepresentable`, with a `PerspectiveCamera` and orbit/pan/zoom
  gestures. No third-party packages.
- Textures live in `Resources/Textures/<name>.png`; models in
  `Resources/Models/<name>.usdz`. Reference by bundle name (no extension where the
  API allows).

## Data model (already written — do not redefine)

- `Model/DesignTypes.swift` — `SurfaceMaterialKind`, `SwatchCategory`, `Swatch`,
  `SurfaceFinish`, `FinishTarget`, `FurnitureItem`, `PlacedFurniture`,
  `WallSegment`, `DesignOpening`, `DesignRoom`, `DesignViewMode`.
- `Model/DesignState.swift` — `@MainActor final class DesignState: ObservableObject`
  (room, items, selection, viewMode, finishTarget; add/remove/duplicate/move/
  rotate/select/applyFinish/currentFinish). Source of truth.
- `Model/Catalog.swift` — `FurnitureCatalog.items`, `SwatchCatalog.swatches`.

## Modules to build (exact signatures — all parts code against these)

```swift
// Render/MaterialFactory.swift
enum MaterialFactory {
    static func material(for finish: SurfaceFinish, swatches: [Swatch]) -> RealityKit.Material
    static func uiColor(for finish: SurfaceFinish, swatches: [Swatch]) -> SwiftUI.Color   // for 2D
}

// Render/Room3DBuilder.swift  — floor + walls + ceiling from the polygon, textured
enum Room3DBuilder {
    static func build(_ room: DesignRoom, swatches: [Swatch]) -> Entity
}

// Render/ModelLoader.swift — load USDZ (or generate a box) normalised to item.size,
// base at y=0, recentred on footprint; apply finish if provided. Cache by item id.
enum ModelLoader {
    static func makeEntity(for item: FurnitureItem, finish: SurfaceFinish?, swatches: [Swatch]) async -> ModelEntity
    static func boxEntity(for item: FurnitureItem, finish: SurfaceFinish?, swatches: [Swatch]) -> ModelEntity // sync fallback
}

// Scene/DesignScene3DView.swift — RealityKit view: builds room + items from state,
// orbit camera, tap-to-select, drag-on-floor to move, two-finger/handle rotate,
// selection highlight, and the floating action toolbar (duplicate/delete/rotate/
// replace-material). Writes back to DesignState.
struct DesignScene3DView: View { @ObservedObject var state: DesignState; init(state: DesignState) }

// Scene/FloorPlan2DView.swift — top-down SwiftUI Canvas: textured room polygon with
// dimensions, draggable/rotatable furniture footprints, selection, Edit Walls.
struct FloorPlan2DView: View { @ObservedObject var state: DesignState; init(state: DesignState) }

// Editor/MaterialEditorView.swift — the "Change Color" sheet: category tabs
// (Color/Tile/Marble/Wood/Granite/Finishes), swatch grid, material row
// (Default/Plastic/Fabric/Metal/Mirror/Glass/Polished), Texture Scale + Rotation
// sliders. Applies via state.applyFinish(_:to:).
struct MaterialEditorView: View { @ObservedObject var state: DesignState; let target: FinishTarget }

// Editor/AddFurnitureSheet.swift — catalogue browser grouped by category; tap adds.
struct AddFurnitureSheet: View { @ObservedObject var state: DesignState; var onClose: () -> Void }

// DesignContainerView.swift — top-level. 2D⇄3D toggle, bottom bar (Open 2D/3D plan,
// Add Furniture, Change Color), hosts the sheets. Owns the DesignState.
struct DesignContainerView: View { init(scan: RoomScan) }
```

## Realism checklist

- Walls: marble (`marble_white`/`marble_cream`) `.polished`; floor: `marble_cream`
  polished; ceiling: `plaster` matte. Never flat untextured white.
- Image-based lighting: add an `ImageBasedLight`/environment or a soft key + fill +
  ambient so PBR reads correctly; subtle shadows.
- Furniture uses its USDZ materials unless a `SurfaceFinish` override is set.

## Integration

`Views/FloorplanResultView.swift` gains a primary button **“Design room”** →
`DesignContainerView(scan: scan)`. Keep the existing scan → floorplan flow intact.
