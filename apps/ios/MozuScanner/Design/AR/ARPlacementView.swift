// The AR ("place it in your real room") mode of the design experience. Where
// `DesignScene3DView` is a NON-AR virtual showroom that mirrors `DesignState`,
// this view is a live AR session: the user points their device at the real world
// and drops MULTIPLE furniture models onto detected floors and walls, then drags,
// rotates and scales them in place.
//
// COORDINATE SYSTEM. Unlike the showroom (which is anchored to the scanned-room's
// world origin), AR placements are anchored to *real-world surfaces* discovered by
// ARKit. Each placement gets its own `AnchorEntity(world:)` at the raycast hit's
// world transform, so it stays pinned to the physical spot as the user walks
// around. Item normalisation is unchanged: `ModelLoader.makeEntity` returns an
// entity whose base sits at y = 0 and is centred on its footprint, so anchoring it
// at the hit transform plants it flush on the surface.
//
// STATE RELATIONSHIP (documented per the brief). These placements are **AR-LOCAL**:
// they are tracked in the coordinator's own `[Placement]` array and are NOT written
// back into `DesignState.items`. Reasons:
//   • `PlacedFurniture.position` is defined as a floor point in the *scanned-room*
//     coordinate space (origin at the room model), which has no meaningful relation
//     to ARKit's session world origin — pushing AR world transforms into it would
//     corrupt the 2D plan / non-AR showroom that read the same field.
//   • AR placement also allows free SCALE (via `installGestures`), which the data
//     model has no field for.
// We DO read `state.catalog` / `state.swatches` (and honour an item's
// `defaultFinish`) so the AR catalogue matches the rest of the app. A future
// "import AR layout into the plan" step could project these anchors back into the
// room frame, but that is intentionally out of scope here.
//
// iOS 17 NOTES. Uses `ARView(frame:)` in its default `.ar` camera mode with an
// `ARWorldTrackingConfiguration` (horizontal + vertical plane detection,
// `.automatic` environment texturing for realistic reflections). Tapping
// raycasts via `arView.makeRaycastQuery(...)` + `session.raycast(...)` against
// `.existingPlaneGeometry`. Per-object move/rotate/scale come from RealityKit's
// built-in `installGestures(_:for:)`. An `ARCoachingOverlayView` guides the user
// to find a plane before placing. See the returned `risks` for the APIs whose
// exact iOS 17 spelling should be confirmed against the SDK.

import SwiftUI
import RealityKit
import ARKit
import Combine
import simd

// MARK: - ARPlacementView

struct ARPlacementView: View {
    @ObservedObject var state: DesignState

    /// The catalogue item the next tap will place. Defaults to the first catalogue
    /// entry; the catalogue strip rebinds it.
    @State private var activeItemID: String

    /// Mirror of the coordinator's "is a placement currently selected" flag so the
    /// SwiftUI Delete button can show/hide. Updated via the coordinator callback.
    @State private var hasSelection = false

    /// Bridges SwiftUI button taps to the AR coordinator (delete the selected model).
    /// Boxed in a reference type so the value-type `View` can hand it to the
    /// `UIViewRepresentable` and have the coordinator fill it in.
    @StateObject private var bridge = ARPlacementBridge()

    init(state: DesignState) {
        self.state = state
        _activeItemID = State(initialValue: state.catalog.first?.id ?? "")
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            ARPlacementContainer(state: state,
                                 activeItemID: activeItemID,
                                 bridge: bridge,
                                 onSelectionChange: { hasSelection = $0 })
                .ignoresSafeArea()

            VStack(spacing: 12) {
                if hasSelection {
                    deleteButton
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
                catalogueStrip
            }
            .padding(.bottom, 16)
            .animation(.easeInOut(duration: 0.2), value: hasSelection)
        }
    }

    // MARK: Delete button

    private var deleteButton: some View {
        Button(role: .destructive) {
            bridge.deleteSelected()
        } label: {
            Label("Delete", systemImage: "trash")
                .font(.system(size: 15, weight: .semibold))
                .padding(.horizontal, 18)
                .padding(.vertical, 10)
                .background(.regularMaterial, in: Capsule())
                .foregroundStyle(Color.red)
                .overlay(Capsule().strokeBorder(Color.white.opacity(0.12)))
        }
        .buttonStyle(.plain)
        .shadow(color: .black.opacity(0.25), radius: 8, y: 3)
        .accessibilityLabel("Delete selected model")
    }

    // MARK: Catalogue strip

    private var catalogueStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(state.catalog) { item in
                    catalogueCell(item)
                }
            }
            .padding(.horizontal, 14)
        }
        .frame(height: 92)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .padding(.horizontal, 12)
    }

    private func catalogueCell(_ item: FurnitureItem) -> some View {
        let selected = (item.id == activeItemID)
        return Button {
            activeItemID = item.id
        } label: {
            VStack(spacing: 4) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(Color(.secondarySystemFill))
                    if let thumb = item.thumbnail {
                        Image(thumb)
                            .resizable()
                            .scaledToFit()
                            .padding(6)
                    } else {
                        Image(systemName: "cube.box")
                            .font(.system(size: 22, weight: .regular))
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(width: 58, height: 50)
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(selected ? Color.accentColor : Color.clear, lineWidth: 2.5)
                )

                Text(item.name)
                    .font(.system(size: 10, weight: selected ? .semibold : .regular))
                    .lineLimit(1)
                    .foregroundStyle(selected ? Color.primary : Color.secondary)
                    .frame(width: 64)
            }
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Bridge (SwiftUI ⇄ Coordinator)

/// A tiny reference type the SwiftUI layer owns and the coordinator wires into, so
/// the Delete button can reach the live AR coordinator without the View holding it.
@MainActor
final class ARPlacementBridge: ObservableObject {
    /// Set by the coordinator in `makeUIView`.
    fileprivate var deleteSelectedHandler: (() -> Void)?
    func deleteSelected() { deleteSelectedHandler?() }
}

// MARK: - ARPlacementContainer (UIViewRepresentable)

private struct ARPlacementContainer: UIViewRepresentable {
    let state: DesignState
    /// The currently chosen catalogue item id; the coordinator reads the latest via
    /// `updateUIView` so taps always place the freshest selection.
    let activeItemID: String
    let bridge: ARPlacementBridge
    let onSelectionChange: (Bool) -> Void

    func makeCoordinator() -> ARPlacementCoordinator {
        ARPlacementCoordinator(state: state, onSelectionChange: onSelectionChange)
    }

    func makeUIView(context: Context) -> ARView {
        // Default initialiser → `.ar` camera mode with an automatically managed
        // session, which is what we want for live AR.
        let arView = ARView(frame: .zero)
        context.coordinator.attach(to: arView)

        // Wire the SwiftUI Delete button to the coordinator.
        let coordinator = context.coordinator
        bridge.deleteSelectedHandler = { [weak coordinator] in
            coordinator?.deleteSelected()
        }

        return arView
    }

    func updateUIView(_ uiView: ARView, context: Context) {
        // Keep the coordinator's "what to place next" in sync with the SwiftUI strip.
        context.coordinator.activeItemID = activeItemID
    }

    static func dismantleUIView(_ uiView: ARView, coordinator: ARPlacementCoordinator) {
        coordinator.detach()
    }
}

// MARK: - ARPlacementCoordinator

/// Owns the AR session, the per-placement anchors, selection, and gestures.
/// `@MainActor` because every ARKit/RealityKit touch and `DesignState` read must
/// happen on the main actor (iOS 17).
@MainActor
private final class ARPlacementCoordinator: NSObject {

    /// What the next tap will place. Pushed in from SwiftUI via `updateUIView`.
    var activeItemID: String

    private let state: DesignState
    private let onSelectionChange: (Bool) -> Void

    private weak var arView: ARView?
    private let coachingOverlay = ARCoachingOverlayView()

    /// One placed model: its anchor in the AR world, the catalogue item it came from
    /// (for sizing the highlight), and the entity gestures act on.
    private struct Placement {
        let id: UUID
        let itemID: String
        let anchor: AnchorEntity
        let entity: ModelEntity
    }

    /// All AR-local placements (the brief's "keep an array of anchors"). NOT mirrored
    /// into `DesignState.items` — see the file header for why.
    private var placements: [Placement] = []

    /// The currently selected placement id (drives the highlight + Delete button).
    private var selection: UUID? {
        didSet {
            updateHighlight()
            onSelectionChange(selection != nil)
        }
    }
    private var highlightEntity: ModelEntity?

    init(state: DesignState, onSelectionChange: @escaping (Bool) -> Void) {
        self.state = state
        self.onSelectionChange = onSelectionChange
        self.activeItemID = state.catalog.first?.id ?? ""
        super.init()
    }

    // MARK: Lifecycle

    func attach(to arView: ARView) {
        self.arView = arView

        configureSession(arView)
        installCoaching(on: arView)
        installTap(on: arView)
    }

    func detach() {
        arView?.session.pause()
        coachingOverlay.delegate = nil
        coachingOverlay.removeFromSuperview()
        arView = nil
    }

    // MARK: Session

    private func configureSession(_ arView: ARView) {
        let config = ARWorldTrackingConfiguration()
        config.planeDetection = [.horizontal, .vertical]
        // Realistic lighting: probe the surroundings so PBR materials reflect the
        // real environment. `.automatic` lets ARKit place/refresh environment probes.
        config.environmentTexturing = .automatic
        if ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
            // Better occlusion / raycast surfaces on LiDAR devices; harmless elsewhere
            // because we gate on the capability check.
            config.sceneReconstruction = .mesh
        }
        arView.session.run(config, options: [.resetTracking, .removeExistingAnchors])
        // Lighting realism comes from `environmentTexturing = .automatic` above:
        // RealityKit feeds ARKit's environment probes into image-based lighting, so
        // placed PBR materials pick up real-world reflections automatically.
    }

    // MARK: Coaching overlay

    private func installCoaching(on arView: ARView) {
        coachingOverlay.session = arView.session
        coachingOverlay.activatesAutomatically = true
        // We want a horizontal surface (floor) before the user starts dropping items.
        coachingOverlay.goal = .horizontalPlane
        coachingOverlay.translatesAutoresizingMaskIntoConstraints = false
        coachingOverlay.delegate = self
        arView.addSubview(coachingOverlay)
        NSLayoutConstraint.activate([
            coachingOverlay.leadingAnchor.constraint(equalTo: arView.leadingAnchor),
            coachingOverlay.trailingAnchor.constraint(equalTo: arView.trailingAnchor),
            coachingOverlay.topAnchor.constraint(equalTo: arView.topAnchor),
            coachingOverlay.bottomAnchor.constraint(equalTo: arView.bottomAnchor),
        ])
    }

    // MARK: Gestures

    private func installTap(on arView: ARView) {
        let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
        arView.addGestureRecognizer(tap)
    }

    /// A tap either selects an existing placement (if one is under the finger) or
    /// places the active catalogue item on the surface the user tapped.
    @objc private func handleTap(_ gr: UITapGestureRecognizer) {
        guard let arView else { return }
        let point = gr.location(in: arView)

        // Selecting an already-placed model takes priority over placing a new one.
        if let id = hitTestPlacement(at: point, in: arView) {
            selection = id
            return
        }

        // Otherwise raycast the real world and place the active item there.
        guard let transform = raycastSurfaceTransform(at: point, in: arView) else {
            // No surface under the tap → ignore (the coaching overlay nudges the user).
            return
        }
        placeActiveItem(at: transform)
    }

    // MARK: Raycasting

    /// Raycast a screen point against detected plane geometry and return the hit's
    /// world transform (4x4). Prefers existing plane geometry (the actual detected
    /// extent); the `.estimatedPlane` target is used as a fallback so a tap on a
    /// not-yet-fully-resolved surface still places something reasonable.
    private func raycastSurfaceTransform(at point: CGPoint, in arView: ARView) -> simd_float4x4? {
        // Allow both horizontal and vertical surfaces (wall art, etc.).
        if let query = arView.makeRaycastQuery(from: point,
                                               allowing: .existingPlaneGeometry,
                                               alignment: .any),
           let result = arView.session.raycast(query).first {
            return result.worldTransform
        }
        if let query = arView.makeRaycastQuery(from: point,
                                               allowing: .estimatedPlane,
                                               alignment: .any),
           let result = arView.session.raycast(query).first {
            return result.worldTransform
        }
        return nil
    }

    // MARK: Placement

    private func placeActiveItem(at transform: simd_float4x4) {
        guard let item = state.item(id: activeItemID) ?? state.catalog.first else { return }
        let arView = self.arView

        // Anchor pinned to the real-world hit. Position comes from the transform;
        // we keep orientation upright (yaw only) so models stand naturally on the
        // floor regardless of the plane's reported basis.
        let position = SIMD3<Float>(transform.columns.3.x,
                                    transform.columns.3.y,
                                    transform.columns.3.z)
        let anchor = AnchorEntity(world: position)

        let placementID = UUID()
        let finish = item.defaultFinish

        // Synchronous placeholder so the model appears instantly, then swap in the
        // real USDZ when it finishes loading (mirrors the showroom's approach).
        let placeholder = ModelLoader.boxEntity(for: item, finish: finish, swatches: state.swatches)
        placeholder.name = placementID.uuidString
        anchor.addChild(placeholder)
        arView?.scene.addAnchor(anchor)

        var record = Placement(id: placementID, itemID: item.id, anchor: anchor, entity: placeholder)
        placements.append(record)
        enableGestures(on: placeholder)
        selection = placementID

        Task { @MainActor in
            let entity = await ModelLoader.makeEntity(for: item, finish: finish, swatches: state.swatches)
            // Drop the result if this placement was deleted while loading.
            guard let idx = placements.firstIndex(where: { $0.id == placementID }) else { return }
            entity.name = placementID.uuidString
            // Preserve any transform the user applied to the placeholder (drag/rotate
            // /scale) by copying it onto the real entity before the swap.
            entity.transform = placeholder.transform
            placeholder.removeFromParent()
            anchor.addChild(entity)
            enableGestures(on: entity)
            record = Placement(id: placementID, itemID: item.id, anchor: anchor, entity: entity)
            placements[idx] = record
            if selection == placementID { updateHighlight() }
        }
    }

    /// Install RealityKit's built-in translation/rotation/scale gestures so each
    /// placed model can be dragged, spun and resized directly.
    private func enableGestures(on entity: ModelEntity) {
        guard let arView else { return }
        // Collision shapes are required for `installGestures` to hit-test the entity;
        // `ModelLoader` already generates them, but regenerate defensively in case the
        // entity was rebuilt without them.
        if entity.collision == nil {
            entity.generateCollisionShapes(recursive: true)
        }
        arView.installGestures([.translation, .rotation, .scale], for: entity)
    }

    // MARK: Selection / delete

    func deleteSelected() {
        guard let id = selection,
              let idx = placements.firstIndex(where: { $0.id == id }) else { return }
        let placement = placements.remove(at: idx)
        placement.anchor.removeFromParent()   // removes the anchor + its model subtree
        selection = nil
    }

    /// Walk up from the hit entity to find which placement (by UUID name) it belongs
    /// to, if any.
    private func hitTestPlacement(at point: CGPoint, in arView: ARView) -> UUID? {
        let hits = arView.hitTest(point, query: .nearest, mask: .all)
        for hit in hits {
            var node: Entity? = hit.entity
            while let n = node {
                if let uuid = UUID(uuidString: n.name),
                   placements.contains(where: { $0.id == uuid }) {
                    return uuid
                }
                node = n.parent
            }
        }
        return nil
    }

    // MARK: Highlight

    /// A faint translucent box around the selected placement so the user can see what
    /// the Delete button (and the move/rotate/scale gestures) will act on.
    private func updateHighlight() {
        highlightEntity?.removeFromParent()
        highlightEntity = nil

        guard let id = selection,
              let placement = placements.first(where: { $0.id == id }) else { return }

        if let item = state.item(id: placement.itemID) {
            let pad: Float = 0.04
            let size = SIMD3<Float>(max(item.size.x, 0.02) + pad,
                                    max(item.size.y, 0.02) + pad,
                                    max(item.size.z, 0.02) + pad)
            addHighlightBox(size: size, on: placement.entity)
        } else {
            // Catalogue lookup failed → fall back to the entity's visual bounds.
            addHighlightBox(sizedFromBoundsOf: placement.entity)
        }
    }

    private func addHighlightBox(size: SIMD3<Float>, on entity: ModelEntity) {
        let material = UnlitMaterial(color: UIColor(red: 0.20, green: 0.55, blue: 1.0, alpha: 0.18))
        let box = ModelEntity(mesh: .generateBox(size: size, cornerRadius: 0.02),
                              materials: [material])
        box.name = "ar_selection_highlight"
        // Entities are normalised base-at-y=0, footprint-centred, so the halo centre
        // sits at half-height.
        box.position = SIMD3<Float>(0, size.y * 0.5, 0)
        box.components.remove(CollisionComponent.self)   // never intercept hit-tests
        entity.addChild(box)
        highlightEntity = box
    }

    private func addHighlightBox(sizedFromBoundsOf entity: ModelEntity) {
        let bounds = entity.visualBounds(relativeTo: entity)
        let pad: Float = 0.04
        let size = SIMD3<Float>(max(bounds.extents.x, 0.02) + pad,
                                max(bounds.extents.y, 0.02) + pad,
                                max(bounds.extents.z, 0.02) + pad)
        let material = UnlitMaterial(color: UIColor(red: 0.20, green: 0.55, blue: 1.0, alpha: 0.18))
        let box = ModelEntity(mesh: .generateBox(size: size, cornerRadius: 0.02),
                              materials: [material])
        box.name = "ar_selection_highlight"
        box.position = SIMD3<Float>(0, size.y * 0.5, 0)
        box.components.remove(CollisionComponent.self)
        entity.addChild(box)
        highlightEntity = box
    }
}

// MARK: - Coaching overlay delegate

extension ARPlacementCoordinator: ARCoachingOverlayViewDelegate {
    nonisolated func coachingOverlayViewDidDeactivate(_ overlay: ARCoachingOverlayView) {
        // Coaching finished (a plane was found). Nothing required — placement is
        // tap-driven — but this is where a "tap a surface to place" hint could show.
    }
}
