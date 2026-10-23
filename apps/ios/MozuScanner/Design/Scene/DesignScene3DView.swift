// The realistic 3D "virtual showroom" — a non-AR RealityKit scene that projects
// the shared `DesignState` (the scanned room + the placed furniture) into a
// lit, textured, navigable 3D space, and writes user edits straight back to the
// state so the 2D floor plan stays in sync.
//
// COORDINATE SYSTEM (see Design/README.md). Metres. Floor plane is X (right) /
// Z (forward); Y is up. A placed item's `position` is the floor point under its
// footprint centre with the base at y = 0; `rotationY` is yaw radians about +Y.
// The room shell is built by `Room3DBuilder` at the world origin in this exact
// space, so a furniture entity placed at `SIMD3(position)` with orientation
// `simd_quatf(angle: rotationY, axis: [0,1,0])` lands correctly.
//
// ARCHITECTURE. The view is a ZStack of:
//   (a) `ARViewContainer` — a `UIViewRepresentable` wrapping a `.nonAR` `ARView`.
//       Its `Coordinator` owns the scene graph (room entity, a `[UUID: Entity]`
//       map of placed furniture, a selection-highlight box), the orbit camera
//       rig, the gesture recognisers, and a Combine subscription that reconciles
//       the scene whenever `DesignState` publishes.
//   (b) A floating action toolbar overlay, shown only when something is selected:
//       rotate 45°, duplicate, delete, and "Change material" (which sets
//       `state.finishTarget` and calls the injected `onRequestMaterialEditor`
//       closure — the container owns the editor sheet because this view may not
//       mutate `DesignState`'s shape).
//
// LIGHTING. A soft warm environment background plus an ambient/IBL-style light,
// a directional key light with shadows, and a fill light so the PBR marble /
// plaster / furniture materials read realistically rather than flat.
//
// GESTURES (all on the ARView, mediated by the Coordinator):
//   • tap                     → hit-test → map entity to UUID → `state.select`
//   • one-finger pan on empty → orbit the camera (azimuth / elevation)
//   • one-finger pan on the SELECTED item → raycast onto y = 0 → `state.move`
//   • pinch                   → zoom (camera orbit distance)
//   • two-finger rotation on the selected item → `state.rotate`
//
// iOS 17 NOTES. `ARView` (RealityKit) is used for its built-in render loop,
// gesture-friendly `UIView` surface and `unproject`/`ray(through:)` helpers —
// `RealityView` exists on iOS 18 but is avoided for the iOS 17 target. We use a
// classic `PerspectiveCamera` rather than iOS 18's `RealityView` camera. See the
// returned `risks` for the texture-UV transform limitation inherited from
// `MaterialFactory`.

import SwiftUI
import RealityKit
import ARKit
import Combine
import simd

// MARK: - DesignScene3DView

struct DesignScene3DView: View {
    @ObservedObject var state: DesignState

    /// Called when the user taps "Change material" on the selected item. The
    /// container observes this to present the `MaterialEditorView` sheet. We set
    /// `state.finishTarget` first so the editor targets the right item.
    var onRequestMaterialEditor: () -> Void = {}

    /// Bridges the SwiftUI overlay (walk/dollhouse toggle + movement joystick) to
    /// the RealityKit scene coordinator so the value-type `View` can drive the live
    /// camera without owning the coordinator.
    @StateObject private var control = SceneControlBridge()

    @State private var showPhotoreal = false
    @State private var showLive = false
    @State private var capturedPose: CameraPose?

    init(state: DesignState, onRequestMaterialEditor: @escaping () -> Void = {}) {
        self.state = state
        self.onRequestMaterialEditor = onRequestMaterialEditor
    }

    var body: some View {
        ZStack {
            ARViewContainer(state: state, control: control)
                .ignoresSafeArea()

            // Photoreal render + Walk ⇄ Dollhouse camera toggle (top-right).
            VStack {
                HStack(spacing: 10) {
                    Spacer()
                    liveButton
                    photorealButton
                    modeToggle
                }
                Spacer()
            }
            .padding(.top, 64)
            .padding(.horizontal, 16)

            // First-person movement joystick — walk mode only, bottom-left.
            if control.mode == .walk {
                VStack {
                    Spacer()
                    HStack {
                        WalkJoystick { control.move($0) }
                        Spacer()
                    }
                }
                .padding(.leading, 26)
                .padding(.bottom, 40)
                .transition(.opacity)
            }

            // Selected-item action toolbar (bottom-centre). Capture the selected id
            // at build time so a stray deselect — the same tap falling through to the
            // ARView's `handleTap`, which hit-tests empty space and calls
            // `state.select(nil)` — can't turn Delete into a no-op.
            if let selectedID = state.selection {
                VStack {
                    Spacer()
                    selectionToolbar(for: selectedID)
                        .padding(.bottom, 24)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
        }
        .animation(.easeInOut(duration: 0.2), value: state.selection)
        .animation(.easeInOut(duration: 0.2), value: control.mode)
        .sheet(isPresented: $showPhotoreal) {
            if let pose = capturedPose {
                PhotorealRenderView(state: state, pose: pose)
            }
        }
        .fullScreenCover(isPresented: $showLive) {
            // `captureCamera()` is optional (the scene coordinator may not be
            // wired yet), so the coalesce still yields an optional — unwrap it
            // the same way the photoreal sheet above does.
            if let pose = capturedPose ?? control.captureCamera() {
                LiveStreamView(state: state, startPose: pose)
            }
        }
    }

    // MARK: Walk / Dollhouse toggle

    private var modeToggle: some View {
        Button {
            control.toggle()
        } label: {
            HStack(spacing: 6) {
                Image(systemName: control.mode == .walk ? "figure.walk" : "cube.transparent")
                    .font(.system(size: 15, weight: .semibold))
                Text(control.mode == .walk ? "Walking" : "Dollhouse")
                    .font(.subheadline.weight(.semibold))
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(.regularMaterial, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.15)))
            .foregroundStyle(Color.primary)
        }
        .buttonStyle(.plain)
        .shadow(color: .black.opacity(0.2), radius: 8, y: 3)
        .accessibilityLabel(control.mode == .walk ? "Switch to dollhouse view" : "Walk inside the room")
    }

    /// LIVE: stream near-photoreal EEVEE frames from the Mac and walk the room in
    /// real time. Captures the current camera as the starting pose.
    private var liveButton: some View {
        Button {
            capturedPose = control.captureCamera()
            showLive = true
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "bolt.horizontal.circle.fill")
                    .font(.system(size: 15, weight: .semibold))
                Text("Live")
                    .font(.subheadline.weight(.semibold))
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(.regularMaterial, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.15)))
            .foregroundStyle(Color.primary)
        }
        .buttonStyle(.plain)
        .shadow(color: .black.opacity(0.2), radius: 8, y: 3)
        .accessibilityLabel("Stream a photoreal live walkthrough from your Mac")
    }

    private var photorealButton: some View {
        Button {
            capturedPose = control.captureCamera()
            showPhotoreal = true
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "camera.aperture")
                    .font(.system(size: 15, weight: .semibold))
                Text("Photoreal")
                    .font(.subheadline.weight(.semibold))
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(.regularMaterial, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.15)))
            .foregroundStyle(Color.primary)
        }
        .buttonStyle(.plain)
        .shadow(color: .black.opacity(0.2), radius: 8, y: 3)
        .accessibilityLabel("Render this view photoreal")
    }

    // MARK: Floating action toolbar

    private func selectionToolbar(for id: UUID) -> some View {
        HStack(spacing: 18) {
            toolbarButton(system: "rotate.right", label: "Rotate") {
                guard let placed = state.items.first(where: { $0.id == id }) else { return }
                state.rotate(id, to: placed.rotationY + .pi / 4)   // +45°
            }

            toolbarButton(system: "plus.square.on.square", label: "Duplicate") {
                state.duplicate(id)
            }

            toolbarButton(system: "paintpalette", label: "Material") {
                state.finishTarget = .item(id)
                onRequestMaterialEditor()
            }

            toolbarButton(system: "trash", label: "Delete", role: .destructive) {
                state.remove(id)
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 12)
        .background(.regularMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.white.opacity(0.12)))
        .shadow(color: .black.opacity(0.25), radius: 10, y: 4)
    }

    @ViewBuilder
    private func toolbarButton(system: String,
                               label: String,
                               role: ButtonRole? = nil,
                               action: @escaping () -> Void) -> some View {
        Button(role: role, action: action) {
            VStack(spacing: 4) {
                Image(systemName: system)
                    .font(.system(size: 20, weight: .semibold))
                Text(label)
                    .font(.system(size: 10, weight: .medium))
            }
            .frame(minWidth: 52)
            .foregroundStyle(role == .destructive ? Color.red : Color.primary)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - ARViewContainer (UIViewRepresentable)

private struct ARViewContainer: UIViewRepresentable {
    let state: DesignState
    let control: SceneControlBridge

    func makeCoordinator() -> SceneCoordinator {
        SceneCoordinator(state: state)
    }

    func makeUIView(context: Context) -> ARView {
        let arView = ARView(frame: .zero,
                            cameraMode: .nonAR,
                            automaticallyConfigureSession: false)
        let coordinator = context.coordinator
        coordinator.attach(to: arView)
        // Wire the SwiftUI overlay (mode toggle + joystick) to the live coordinator.
        control.onSetMode = { [weak coordinator] mode in coordinator?.setCameraMode(mode) }
        control.onMove = { [weak coordinator] vector in coordinator?.setMoveInput(vector) }
        control.captureCameraHandler = { [weak coordinator] in coordinator?.currentCameraPose() }
        return arView
    }

    func updateUIView(_ uiView: ARView, context: Context) {
        // SwiftUI re-renders push through here; the Coordinator's Combine
        // subscription already drives scene reconciliation, but we run a
        // reconcile pass too so external mutations (e.g. a value change that
        // didn't fire `objectWillChange` ordering) are never missed.
        context.coordinator.reconcile()
    }

    static func dismantleUIView(_ uiView: ARView, coordinator: SceneCoordinator) {
        coordinator.detach()
    }
}

// MARK: - SceneCoordinator

/// Owns the RealityKit scene graph and bridges gestures + Combine to `DesignState`.
/// Marked `@MainActor` because every RealityKit entity/`ARView` touch and every
/// `DesignState` mutation must happen on the main actor (iOS 17).
@MainActor
private final class SceneCoordinator: NSObject {

    private let state: DesignState
    private weak var arView: ARView?

    // Scene graph
    private let worldAnchor = AnchorEntity(world: .zero)
    private var roomEntity: Entity?
    /// Context shells for the other scanned rooms (whole-house mode).
    private var extraRoomEntities: [Entity] = []
    private var itemEntities: [UUID: Entity] = [:]
    private var highlightEntity: ModelEntity?

    // Camera orbit rig: an anchor at the room centre with a child holder that the
    // PerspectiveCamera hangs off, pulled back by `cameraDistance` along -Z and
    // tilted by elevation. Azimuth spins the whole rig about +Y.
    private let cameraPivot = Entity()
    private let camera = PerspectiveCamera()
    private var cameraAzimuth: Float = .pi * 0.85     // start looking from a front corner
    private var cameraElevation: Float = 0.55         // radians above the horizon
    private var cameraDistance: Float = 6
    private var minDistance: Float = 1.5
    private var maxDistance: Float = 30

    // First-person "walk" camera. In walk mode the camera sits at eye height inside
    // the room; a one-finger drag looks around (yaw/pitch) and the on-screen joystick
    // feeds `moveInput`, which is integrated every frame in `integrateWalk`.
    private var cameraMode: ShowroomCameraMode = .dollhouse
    private var walkEye = SIMD3<Float>(0, 1.55, 0)
    private var walkYaw: Float = 0
    private var walkPitch: Float = 0
    private let eyeHeight: Float = 1.55
    private var moveInput = SIMD2<Float>(0, 0)   // x = strafe, y = forward, each −1…1
    private var frameSub: Cancellable?

    // Reconcile bookkeeping
    private var lastFootprint: [SIMD2<Float>] = []

    // Gesture transient state
    private var pinchStartDistance: Float = 6
    private var rotateStartYaw: Float = 0
    private var draggingSelectedItem = false

    private var cancellable: AnyCancellable?

    init(state: DesignState) {
        self.state = state
        super.init()
    }

    // MARK: Lifecycle

    func attach(to arView: ARView) {
        self.arView = arView
        configureEnvironment(arView)
        buildLighting()
        buildCameraRig(arView)

        arView.scene.addAnchor(worldAnchor)

        installGestures(on: arView)

        // Initial build from the current state.
        rebuildRoom()
        reconcile()
        recenterCameraOnRoom()

        // Observe DesignState. `objectWillChange` fires *before* the change is
        // applied, so hop to the next runloop tick to read post-mutation values.
        // Delivery is on `RunLoop.main` (the main thread), so we can safely assume
        // main-actor isolation to call the `@MainActor`-isolated `reconcile()` — this
        // keeps the bridge correct under Swift strict concurrency without spawning a
        // detached `Task` per publish.
        cancellable = state.objectWillChange
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                MainActor.assumeIsolated {
                    self?.reconcile()
                }
            }

        // Per-frame tick (delivered on the main thread for an ARView): integrate
        // first-person movement while the joystick is held.
        frameSub = arView.scene.subscribe(to: SceneEvents.Update.self) { [weak self] event in
            MainActor.assumeIsolated {
                self?.integrateWalk(dt: Float(event.deltaTime))
            }
        }
    }

    func detach() {
        cancellable?.cancel()
        cancellable = nil
        frameSub?.cancel()
        frameSub = nil
        arView = nil
    }

    // MARK: Environment & lighting

    private func configureEnvironment(_ arView: ARView) {
        // IMAGE-BASED LIGHTING. PBR materials need an environment to REFLECT, or they
        // read as flat plastic no matter how many lights you add — this is the real
        // cause of the "plastic furniture" look. Load the bundled studio environment
        // (compiled from Studio.skybox at build time) and use it for reflections +
        // diffuse IBL, and as the visible backdrop so reflections stay coherent.
        // `intensityExponent` is the one brightness knob (log scale, 0 = 1×).
        if let env = try? EnvironmentResource.load(named: "Studio") {
            arView.environment.lighting.resource = env
            arView.environment.lighting.intensityExponent = 0.0
            arView.environment.background = .skybox(env)
        } else {
            // Asset didn't compile in → keep working with a warm flat ground (no
            // reflections, but no crash). See project.yml for the .skybox wiring.
            let warm = UIColor(red: 0.96, green: 0.95, blue: 0.93, alpha: 1.0)
            arView.environment.background = .color(warm)
            arView.environment.lighting.intensityExponent = 1.0
        }
        arView.renderOptions.remove(.disableGroundingShadows)
    }

    private func buildLighting() {
        // Ambient fill via a soft point light high overhead is unnecessary — we
        // use directional key + fill + a low ambient-like directional from below.

        // Key light: warm "sun" from a high front-side angle, casts soft shadows.
        // Intensities are tuned so matte plaster/oak (~0.85 albedo) reads as a sunlit
        // room without clipping to white under RealityKit's tonemap.
        let key = DirectionalLight()
        key.light.intensity = 2000
        key.light.color = UIColor(red: 1.0, green: 0.97, blue: 0.92, alpha: 1.0)
        key.shadow = DirectionalLightComponent.Shadow(maximumDistance: 30, depthBias: 2.0)
        let keyAnchor = AnchorEntity(world: .zero)
        keyAnchor.addChild(key)
        key.look(at: .zero,
                 from: SIMD3<Float>(4, 7, 5),
                 relativeTo: nil)
        worldAnchor.addChild(keyAnchor)

        // Sky fill: cool, broad, from the opposite side, no shadow — lifts the
        // shadows so the room reads like daylight, not a single hard spotlight.
        let fill = DirectionalLight()
        fill.light.intensity = 700    // reduced: image-based lighting now provides fill
        fill.light.color = UIColor(red: 0.86, green: 0.91, blue: 1.0, alpha: 1.0)
        fill.shadow = nil
        let fillAnchor = AnchorEntity(world: .zero)
        fillAnchor.addChild(fill)
        fill.look(at: .zero,
                  from: SIMD3<Float>(-5, 4, -4),
                  relativeTo: nil)
        worldAnchor.addChild(fillAnchor)

        // Overhead skylight: straight down, simulating ceiling/sky bounce so floors
        // and worktops aren't flat-lit.
        let sky = DirectionalLight()
        sky.light.intensity = 450    // reduced: IBL now supplies the sky/ceiling bounce
        sky.light.color = UIColor(white: 1.0, alpha: 1.0)
        sky.shadow = nil
        let skyAnchor = AnchorEntity(world: .zero)
        skyAnchor.addChild(sky)
        sky.look(at: .zero,
                 from: SIMD3<Float>(0.5, 9, 0.5),
                 relativeTo: nil)
        worldAnchor.addChild(skyAnchor)

        // Up-fill: a faint warm light from below to lift undersides / mimic bounced
        // ambient so shadowed faces never crush to black.
        let ambient = DirectionalLight()
        ambient.light.intensity = 500
        ambient.light.color = UIColor(red: 1.0, green: 0.98, blue: 0.95, alpha: 1.0)
        ambient.shadow = nil
        let ambientAnchor = AnchorEntity(world: .zero)
        ambientAnchor.addChild(ambient)
        ambient.look(at: SIMD3<Float>(0, 3, 0),
                     from: SIMD3<Float>(0, -2, 0),
                     relativeTo: nil)
        worldAnchor.addChild(ambientAnchor)
    }

    private func buildCameraRig(_ arView: ARView) {
        camera.camera.fieldOfViewInDegrees = 55
        cameraPivot.addChild(camera)
        worldAnchor.addChild(cameraPivot)
        updateCameraTransform()
    }

    /// Place the orbit pivot at the house centre and pick a sensible starting
    /// distance from the combined footprint of every room.
    private func recenterCameraOnRoom() {
        let points = state.allFootprints.flatMap { $0 }
        let centreY = max(state.room.height * 0.45, 1.0)

        if points.count >= 2 {
            var lo = points[0], hi = points[0]
            for p in points { lo = simd_min(lo, p); hi = simd_max(hi, p) }
            let mid = (lo + hi) * 0.5
            cameraPivot.position = SIMD3<Float>(mid.x, centreY, mid.y)   // .y is world Z
            let diag = simd_length(hi - lo)
            cameraDistance = max(minDistance, min(maxDistance, diag * 1.1 + 1.5))
            maxDistance = max(maxDistance, diag * 2.0 + 5)
        } else {
            let c = state.room.centroid
            cameraPivot.position = SIMD3<Float>(c.x, centreY, c.y)
        }
        updateCameraTransform()
    }

    /// Recompute the camera's local transform from azimuth / elevation / distance.
    /// The pivot sits at the room centre; the camera orbits it and always looks
    /// back toward the pivot origin.
    private func updateCameraTransform() {
        let ce = cos(cameraElevation)
        let se = sin(cameraElevation)
        let ca = cos(cameraAzimuth)
        let sa = sin(cameraAzimuth)

        // Spherical offset around the pivot (camera position in the pivot's frame).
        let offset = SIMD3<Float>(
            cameraDistance * ce * sa,
            cameraDistance * se,
            cameraDistance * ce * ca
        )
        camera.position = offset
        // Look back at the pivot's origin (the room centre), in the pivot frame.
        camera.look(at: .zero, from: offset, relativeTo: cameraPivot)
    }

    // MARK: First-person walk camera

    /// Switch between the orbit "dollhouse" camera and the first-person "walk" camera.
    func setCameraMode(_ mode: ShowroomCameraMode) {
        guard mode != cameraMode else { return }
        cameraMode = mode
        moveInput = .zero
        if mode == .walk {
            enterWalk()
        } else {
            recenterCameraOnRoom()
        }
    }

    /// Joystick input from the SwiftUI overlay: x = strafe, y = forward, each −1…1.
    func setMoveInput(_ vector: SIMD2<Float>) {
        moveInput = vector
    }

    /// The current camera pose in world space, for the photoreal renderer to frame
    /// the server-side shot exactly as the user sees it.
    func currentCameraPose() -> CameraPose {
        let pos = camera.position(relativeTo: nil)
        let forward = camera.orientation(relativeTo: nil).act(SIMD3<Float>(0, 0, -1))
        return CameraPose(pos: pos,
                          target: pos + forward,
                          fovDeg: camera.camera.fieldOfViewInDegrees)
    }

    /// Drop the eye into the room centre at standing height, keeping the current
    /// heading so entering walk mode doesn't snap to a random direction.
    private func enterWalk() {
        let p = clampInsideRoom(interiorPoint())
        walkEye = SIMD3<Float>(p.x, eyeHeight, p.y)
        walkYaw = cameraAzimuth
        walkPitch = -0.05
        updateWalkCamera()
    }

    /// Recompute the walk camera from `walkEye` / `walkYaw` / `walkPitch`. The camera
    /// looks down its local −Z, so yaw about +Y then pitch about +X aims it.
    private func updateWalkCamera() {
        cameraPivot.position = walkEye
        let yawQ = simd_quatf(angle: walkYaw, axis: SIMD3<Float>(0, 1, 0))
        let pitchQ = simd_quatf(angle: walkPitch, axis: SIMD3<Float>(1, 0, 0))
        camera.position = .zero
        camera.orientation = yawQ * pitchQ
    }

    /// Integrate joystick movement each frame (from the scene-update tick). Forward
    /// and right are taken from the camera's actual orientation so you always move
    /// where you look; the eye is kept inside the footprint so you can't walk out.
    private func integrateWalk(dt rawDt: Float) {
        guard cameraMode == .walk, rawDt > 0 else { return }
        guard moveInput.x != 0 || moveInput.y != 0 else { return }

        // Cap the step so a frame hitch can't teleport the eye ~1 m in one tick
        // past the endpoint-only wall clamp.
        let dt = min(rawDt, 1.0 / 30.0)
        let speed: Float = 1.6   // metres / second — a natural walking pace
        let fwd3 = camera.orientation.act(SIMD3<Float>(0, 0, -1))
        var fwd = SIMD2<Float>(fwd3.x, fwd3.z)
        guard simd_length(fwd) > 1e-4 else { return }
        fwd = simd_normalize(fwd)
        let right = SIMD2<Float>(-fwd.y, fwd.x)   // camera's right in the floor plane

        var delta = fwd * moveInput.y + right * moveInput.x
        let mag = simd_length(delta)
        if mag > 1 { delta /= mag }        // cap diagonal speed
        delta *= speed * dt

        let target = SIMD2<Float>(walkEye.x + delta.x, walkEye.z + delta.y)
        let inside = clampInsideRoom(target)
        walkEye = SIMD3<Float>(inside.x, eyeHeight, inside.y)
        updateWalkCamera()
    }

    /// Keep the walking eye inside the house. Single-room: a body-radius margin off
    /// every wall (so you can't press your face through a wall and see out) using
    /// the true nearest boundary point — correct for concave footprints too.
    /// Whole-house: any room's interior is valid, and margins are NOT enforced
    /// while inside (otherwise you could never pass through a doorway from one
    /// room's polygon into the next); outside every room you're re-seated into the
    /// nearest one.
    private func clampInsideRoom(_ p: SIMD2<Float>) -> SIMD2<Float> {
        let polys = state.allFootprints.filter { $0.count >= 3 }
        guard let primary = polys.first else { return p }

        if polys.count > 1 {
            for poly in polys where pointInPolygon(p, poly) { return p }

            // Doorway tunnel: adjacent scanned rooms are separated by the physical
            // wall thickness (10–25 cm), so the first step out of a room lands in
            // that gap. If another room lies just ahead along the motion, step
            // through into it instead of snapping back.
            let from = SIMD2<Float>(walkEye.x, walkEye.z)
            var dir = p - from
            let dlen = simd_length(dir)
            if dlen > 1e-5 {
                dir /= dlen
                var s: Float = 0.06
                while s <= 0.6 {
                    let q = p + dir * s
                    if polys.contains(where: { pointInPolygon(q, $0) }) { return q + dir * 0.05 }
                    s += 0.06
                }
            }

            // Outside every room with nothing ahead: re-seat just inside the
            // nearest room boundary, along that edge's inward normal (footprints
            // are CCW, so (-(Δz), Δx) points into the room — robust for concave
            // rooms where the vertex-average centroid can lie outside).
            var bestPoly = primary
            var bestPoint = primary[0]
            var bestEdge = (a: primary[0], b: primary[0])
            var bestDist = Float.greatestFiniteMagnitude
            for poly in polys {
                let (q, d, edge) = nearestBoundaryPoint(to: p, poly: poly)
                if d < bestDist { bestDist = d; bestPoint = q; bestPoly = poly; bestEdge = edge }
            }
            let e = bestEdge.b - bestEdge.a
            let elen = simd_length(e)
            let g = elen > 1e-5 ? SIMD2<Float>(-e.y, e.x) / elen : SIMD2<Float>(0, 1)
            let candidate = bestPoint + g * 0.15
            return pointInPolygon(candidate, bestPoly) ? candidate : bestPoint - g * 0.15
        }

        let poly = primary
        let margin: Float = 0.28

        let (nearest, dist, _) = nearestBoundaryPoint(to: p, poly: poly)
        let inside = pointInPolygon(p, poly)
        if inside && dist >= margin { return p }

        // Too close to a wall, or outside: re-seat `margin` metres inside, measured
        // from the nearest wall point toward the room interior.
        let intoRoom: SIMD2<Float>
        if inside && dist > 1e-4 {
            intoRoom = (p - nearest) / dist                 // boundary → interior
        } else {
            let toCentre = state.room.centroid - nearest
            let len = simd_length(toCentre)
            intoRoom = len > 1e-4 ? toCentre / len : SIMD2<Float>(0, 1)
        }
        return nearest + intoRoom * margin
    }

    /// The closest point on the room's boundary to `p`, its distance, and the
    /// polygon edge it lies on (for deriving an inward normal).
    private func nearestBoundaryPoint(to p: SIMD2<Float>,
                                      poly: [SIMD2<Float>]) -> (point: SIMD2<Float>, dist: Float, edge: (a: SIMD2<Float>, b: SIMD2<Float>)) {
        var best = poly[0]
        var bestD = Float.greatestFiniteMagnitude
        var bestEdge = (a: poly[0], b: poly[0])
        for i in poly.indices {
            let a = poly[i]
            let b = poly[(i + 1) % poly.count]
            let q = closestPointOnSegment(p, a, b)
            let d = simd_length(p - q)
            if d < bestD { bestD = d; best = q; bestEdge = (a, b) }
        }
        return (best, bestD, bestEdge)
    }

    private func closestPointOnSegment(_ p: SIMD2<Float>, _ a: SIMD2<Float>, _ b: SIMD2<Float>) -> SIMD2<Float> {
        let ab = b - a
        let len2 = simd_dot(ab, ab)
        guard len2 > 1e-9 else { return a }
        let t = max(0, min(1, simd_dot(p - a, ab) / len2))
        return a + ab * t
    }

    /// A point guaranteed to sit inside the footprint, near its centre. The plain
    /// vertex-average centroid can fall outside a concave (e.g. L-shaped, 7-wall)
    /// room, so fall back to scanning the bounding box for the interior cell nearest
    /// the centroid.
    private func interiorPoint() -> SIMD2<Float> {
        let poly = state.room.footprint
        let c = state.room.centroid
        guard poly.count >= 3 else { return c }
        if pointInPolygon(c, poly) { return c }

        var lo = poly[0], hi = poly[0]
        for v in poly { lo = simd_min(lo, v); hi = simd_max(hi, v) }

        let steps = 12
        var best = c
        var bestD = Float.greatestFiniteMagnitude
        for i in 0...steps {
            for j in 0...steps {
                let q = SIMD2<Float>(lo.x + (hi.x - lo.x) * Float(i) / Float(steps),
                                     lo.y + (hi.y - lo.y) * Float(j) / Float(steps))
                if pointInPolygon(q, poly) {
                    let d = simd_length(q - c)
                    if d < bestD { bestD = d; best = q }
                }
            }
        }
        return best
    }

    // MARK: Room

    private func rebuildRoom() {
        if let old = roomEntity {
            old.removeFromParent()
            roomEntity = nil
        }
        let entity = Room3DBuilder.build(state.room, swatches: state.swatches)
        worldAnchor.addChild(entity)
        roomEntity = entity

        // Whole-house mode: the other scanned rooms as walkable context shells.
        // They are immutable (finish edits target the primary room only), so build
        // them once — rebuilding per finish change would hitch on slider drags.
        if extraRoomEntities.isEmpty {
            extraRoomEntities = state.extraRooms.map { room in
                let shell = Room3DBuilder.build(room, swatches: state.swatches)
                worldAnchor.addChild(shell)
                return shell
            }
        }

        // Snapshot what the current shell was built from, so `reconcileRoomIfNeeded`
        // only rebuilds when the geometry (footprint) or a surface finish changes.
        lastWallFinish = state.room.wallFinish
        lastFloorFinish = state.room.floorFinish
        lastCeilingFinish = state.room.ceilingFinish
        lastFootprint = state.room.footprint
    }

    /// Rebuild the room shell only when something that affects its geometry or
    /// surfaces changed (footprint edited in 2D, or a wall/floor/ceiling finish —
    /// `SurfaceFinish` is `Equatable`, so this catches swatch, kind, scale, rotation
    /// and tint changes alike).
    private func reconcileRoomIfNeeded() {
        let r = state.room
        let finishChanged =
            r.wallFinish != lastWallFinish ||
            r.floorFinish != lastFloorFinish ||
            r.ceilingFinish != lastCeilingFinish
        let footprintChanged = r.footprint != lastFootprint

        if finishChanged || footprintChanged {
            rebuildRoom()
            if footprintChanged { recenterCameraOnRoom() }
        }
    }

    // Snapshots of what the current room shell was built from.
    private var lastWallFinish: SurfaceFinish = SurfaceFinish(swatchID: "")
    private var lastFloorFinish: SurfaceFinish = SurfaceFinish(swatchID: "")
    private var lastCeilingFinish: SurfaceFinish = SurfaceFinish(swatchID: "")

    // MARK: Reconcile

    /// Bring the scene graph in line with `state`: rebuild the room if needed,
    /// add/remove/update item entities, and refresh the selection highlight.
    func reconcile() {
        guard arView != nil else { return }

        // `reconcileRoomIfNeeded` rebuilds the shell (and updates the finish/footprint
        // snapshots inside `rebuildRoom`) only when the room actually changed.
        reconcileRoomIfNeeded()

        let wanted = Set(state.items.map { $0.id })

        // Remove entities whose items are gone.
        for (id, entity) in itemEntities where !wanted.contains(id) {
            entity.removeFromParent()
            itemEntities.removeValue(forKey: id)
        }

        // Add or update entities for current items.
        for placed in state.items {
            if let entity = itemEntities[placed.id] {
                updateTransform(entity, for: placed)
                // Material changes are handled by a full reload (cheap enough and
                // guarantees correctness), keyed off a stored finish snapshot.
                if itemFinishSnapshots[placed.id] != placed.finish {
                    reloadItem(placed)
                }
            } else {
                addItem(placed)
            }
        }

        updateHighlight()
    }

    // Per-item finish snapshot so we only reload an entity when its finish changes.
    private var itemFinishSnapshots: [UUID: SurfaceFinish?] = [:]

    private func addItem(_ placed: PlacedFurniture) {
        guard let item = state.item(for: placed) else { return }

        // Placeholder box immediately (synchronous) so there's no pop-in gap, then
        // swap in the real USDZ when it finishes loading.
        let placeholder = ModelLoader.boxEntity(for: item, finish: placed.finish, swatches: state.swatches)
        placeholder.name = placed.id.uuidString
        updateTransform(placeholder, for: placed)
        worldAnchor.addChild(placeholder)
        itemEntities[placed.id] = placeholder
        itemFinishSnapshots[placed.id] = placed.finish

        let id = placed.id
        Task { @MainActor in
            let entity = await ModelLoader.makeEntity(for: item,
                                                      finish: placed.finish,
                                                      swatches: state.swatches)
            // Drop the result if the item was removed, or if its on-screen entity is
            // no longer the placeholder we put down (a finish change reloaded it, or
            // it was re-added) — in those cases a newer entity already reflects truth.
            guard let current = state.items.first(where: { $0.id == id }),
                  itemEntities[id] === placeholder else { return }
            placeholder.removeFromParent()
            entity.name = id.uuidString
            updateTransform(entity, for: current)
            worldAnchor.addChild(entity)
            itemEntities[id] = entity
            itemFinishSnapshots[id] = current.finish
            if state.selection == id { updateHighlight() }
        }
    }

    /// Reload an item's entity (used when its finish override changed).
    private func reloadItem(_ placed: PlacedFurniture) {
        guard let item = state.item(for: placed) else { return }
        itemFinishSnapshots[placed.id] = placed.finish
        let id = placed.id
        Task { @MainActor in
            let entity = await ModelLoader.makeEntity(for: item,
                                                      finish: placed.finish,
                                                      swatches: state.swatches)
            guard let current = state.items.first(where: { $0.id == id }) else { return }
            itemEntities[id]?.removeFromParent()
            entity.name = id.uuidString
            updateTransform(entity, for: current)
            worldAnchor.addChild(entity)
            itemEntities[id] = entity
            if state.selection == id { updateHighlight() }
        }
    }

    private func updateTransform(_ entity: Entity, for placed: PlacedFurniture) {
        entity.position = SIMD3<Float>(placed.position.x, 0, placed.position.z)
        entity.orientation = simd_quatf(angle: placed.rotationY, axis: SIMD3<Float>(0, 1, 0))
    }

    // MARK: Selection highlight

    /// A semi-transparent box that hugs the selected item's bounds, re-parented
    /// under the selected entity so it tracks its transform automatically.
    private func updateHighlight() {
        let selection = state.selection

        // Always rebuild: cheap, and it picks up a model that just finished loading
        // (so the halo re-parents onto the real entity) as well as selection changes.
        highlightEntity?.removeFromParent()
        highlightEntity = nil

        guard let id = selection,
              let placed = state.items.first(where: { $0.id == id }),
              let item = state.item(for: placed),
              let target = itemEntities[id] else { return }

        // Size the highlight from the item's catalogue size (robust even before the
        // USDZ has loaded), padded slightly so it reads as a halo around the item.
        let pad: Float = 0.04
        let size = SIMD3<Float>(max(item.size.x, 0.02) + pad,
                                max(item.size.y, 0.02) + pad,
                                max(item.size.z, 0.02) + pad)

        // An unlit translucent blue box. `UnlitMaterial(color:)` with a sub-1 alpha
        // renders transparent on its own (no separate blending setter needed), which
        // keeps this on stable iOS 17 API.
        let material = UnlitMaterial(color: UIColor(red: 0.20, green: 0.55, blue: 1.0, alpha: 0.18))

        let box = ModelEntity(mesh: .generateBox(size: size, cornerRadius: 0.02),
                              materials: [material])
        box.name = "selection_highlight"
        // Item entities have their base at y = 0 and X/Z centred on the origin, so
        // the halo's centre sits at half-height.
        box.position = SIMD3<Float>(0, size.y * 0.5, 0)
        // Don't let the halo intercept hit-tests.
        box.components.remove(CollisionComponent.self)

        target.addChild(box)
        highlightEntity = box
    }

    // MARK: Gestures

    private func installGestures(on arView: ARView) {
        let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
        arView.addGestureRecognizer(tap)

        let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
        pan.maximumNumberOfTouches = 1
        arView.addGestureRecognizer(pan)

        let pinch = UIPinchGestureRecognizer(target: self, action: #selector(handlePinch(_:)))
        arView.addGestureRecognizer(pinch)

        let rotate = UIRotationGestureRecognizer(target: self, action: #selector(handleRotation(_:)))
        arView.addGestureRecognizer(rotate)

        // Allow pinch + rotation simultaneously (two-finger zoom while rotating).
        pinch.delegate = self
        rotate.delegate = self
    }

    /// Tap: hit-test the scene; select the owning item or deselect on empty space.
    @objc private func handleTap(_ gr: UITapGestureRecognizer) {
        guard let arView else { return }
        let location = gr.location(in: arView)
        if let id = hitTestItem(at: location, in: arView) {
            state.select(id)
        } else {
            state.select(nil)
        }
    }

    /// One-finger pan. On a selected item it drags the item across the floor
    /// (raycast to y = 0); on empty space it orbits the camera.
    @objc private func handlePan(_ gr: UIPanGestureRecognizer) {
        guard let arView else { return }

        switch gr.state {
        case .began:
            let start = gr.location(in: arView)
            // Drag the item only if the gesture starts on the currently selected one.
            if let sel = state.selection,
               let hit = hitTestItem(at: start, in: arView),
               hit == sel {
                draggingSelectedItem = true
            } else {
                draggingSelectedItem = false
            }

        case .changed:
            if draggingSelectedItem, let id = state.selection {
                let location = gr.location(in: arView)
                if let floor = floorPoint(at: location, in: arView) {
                    state.move(id, to: floor)
                }
            } else {
                let t = gr.translation(in: arView)
                gr.setTranslation(.zero, in: arView)
                if cameraMode == .walk {
                    // First-person look: horizontal drag → yaw, vertical drag → pitch.
                    let lookSpeed: Float = 0.005
                    walkYaw -= Float(t.x) * lookSpeed
                    walkPitch -= Float(t.y) * lookSpeed
                    let lim: Float = .pi / 2 - 0.05
                    walkPitch = min(lim, max(-lim, walkPitch))
                    updateWalkCamera()
                } else {
                    // Orbit: horizontal drag → azimuth, vertical drag → elevation.
                    let azSpeed: Float = 0.01
                    let elSpeed: Float = 0.01
                    cameraAzimuth -= Float(t.x) * azSpeed
                    cameraElevation += Float(t.y) * elSpeed
                    // Clamp elevation just shy of straight up/down.
                    let lo: Float = 0.05, hi: Float = .pi / 2 - 0.05
                    cameraElevation = min(hi, max(lo, cameraElevation))
                    updateCameraTransform()
                }
            }

        case .ended, .cancelled, .failed:
            draggingSelectedItem = false

        default:
            break
        }
    }

    /// Pinch: zoom by changing the camera's orbit distance (dollhouse only).
    @objc private func handlePinch(_ gr: UIPinchGestureRecognizer) {
        guard cameraMode == .dollhouse else { return }
        switch gr.state {
        case .began:
            pinchStartDistance = cameraDistance
        case .changed:
            let scale = Float(gr.scale)
            let d = pinchStartDistance / max(scale, 0.05)
            cameraDistance = min(maxDistance, max(minDistance, d))
            updateCameraTransform()
        default:
            break
        }
    }

    /// Two-finger rotation: rotate the selected item's yaw.
    @objc private func handleRotation(_ gr: UIRotationGestureRecognizer) {
        guard let id = state.selection,
              let placed = state.items.first(where: { $0.id == id }) else { return }
        switch gr.state {
        case .began:
            rotateStartYaw = placed.rotationY
        case .changed:
            // UIRotationGestureRecognizer is clockwise-positive on screen; a
            // clockwise screen turn (viewed from above, +Z down the screen) is a
            // positive yaw about +Y, so add directly.
            state.rotate(id, to: rotateStartYaw + Float(gr.rotation))
        default:
            break
        }
    }

    // MARK: Hit testing & floor raycast

    /// The UUID of the furniture entity under `point`, if any. Walks up from the
    /// hit entity to whichever ancestor carries a known item UUID as its name.
    private func hitTestItem(at point: CGPoint, in arView: ARView) -> UUID? {
        let hits = arView.hitTest(point, query: .nearest, mask: .all)
        for hit in hits {
            var node: Entity? = hit.entity
            while let n = node {
                if let uuid = UUID(uuidString: n.name), itemEntities[uuid] != nil {
                    return uuid
                }
                node = n.parent
            }
        }
        return nil
    }

    /// Project a screen point onto the floor plane (y = 0) and return the floor
    /// point in world metres. Uses the ARView's ray and a ray/plane intersection.
    private func floorPoint(at point: CGPoint, in arView: ARView) -> SIMD3<Float>? {
        guard let ray = arView.ray(through: point) else { return nil }
        let o = ray.origin
        let d = ray.direction
        // Intersect with the plane y = 0: o.y + t*d.y = 0.
        guard abs(d.y) > 1e-6 else { return nil }
        let t = -o.y / d.y
        guard t > 0 else { return nil }     // plane is behind the camera
        let p = o + d * t
        return SIMD3<Float>(p.x, 0, p.z)
    }
}

// MARK: - Simultaneous gesture recognition

extension SceneCoordinator: UIGestureRecognizerDelegate {
    nonisolated func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                                       shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        // Permit pinch (zoom) and rotation (rotate item) to run together.
        let pinchAndRotate =
            (gestureRecognizer is UIPinchGestureRecognizer && other is UIRotationGestureRecognizer) ||
            (gestureRecognizer is UIRotationGestureRecognizer && other is UIPinchGestureRecognizer)
        return pinchAndRotate
    }
}

// MARK: - Showroom camera mode + SwiftUI controls

/// How you view the virtual showroom: an orbiting "dollhouse" camera (outside,
/// looking in), or a first-person "walk" camera you steer around inside the room.
enum ShowroomCameraMode {
    case dollhouse
    case walk
}

/// A snapshot of the showroom camera, handed to the photoreal renderer so the
/// server frames the path-traced shot exactly as the user sees it.
struct CameraPose {
    var pos: SIMD3<Float>
    var target: SIMD3<Float>
    var fovDeg: Float
}

/// Reference type the SwiftUI overlay owns and the scene coordinator wires into, so
/// the walk/dollhouse toggle and the movement joystick can drive the live RealityKit
/// camera without the value-type `View` holding the coordinator.
@MainActor
final class SceneControlBridge: ObservableObject {
    @Published var mode: ShowroomCameraMode = .dollhouse

    fileprivate var onSetMode: ((ShowroomCameraMode) -> Void)?
    fileprivate var onMove: ((SIMD2<Float>) -> Void)?
    fileprivate var captureCameraHandler: (() -> CameraPose?)?

    func captureCamera() -> CameraPose? { captureCameraHandler?() }

    func toggle() {
        let next: ShowroomCameraMode = (mode == .walk) ? .dollhouse : .walk
        mode = next
        onSetMode?(next)
    }

    func move(_ vector: SIMD2<Float>) {
        onMove?(vector)
    }
}

/// A thumb joystick for first-person movement. Reports a normalised vector:
/// x = strafe (−1 left … 1 right), y = forward (−1 back … 1 forward).
private struct WalkJoystick: View {
    var onChange: (SIMD2<Float>) -> Void

    @State private var knob: CGSize = .zero
    private let baseRadius: CGFloat = 72   // wider analog throw (maxD 31 → 45 pt) + bigger thumb target
    private let knobRadius: CGFloat = 27

    var body: some View {
        ZStack {
            Circle().fill(.ultraThinMaterial)
            Circle().strokeBorder(Color.white.opacity(0.25), lineWidth: 1)
            Image(systemName: "move.3d")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(.secondary)
                .opacity(knob == .zero ? 0.45 : 0)
            Circle()
                .fill(Color.white.opacity(0.9))
                .frame(width: knobRadius * 2, height: knobRadius * 2)
                .shadow(color: .black.opacity(0.25), radius: 4, y: 2)
                .offset(knob)
        }
        .frame(width: baseRadius * 2, height: baseRadius * 2)
        .contentShape(Circle())
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { value in
                    let maxD = baseRadius - knobRadius
                    var off = value.translation
                    let dist = hypot(off.width, off.height)
                    if dist > maxD, dist > 0 {
                        off.width = off.width / dist * maxD
                        off.height = off.height / dist * maxD
                    }
                    knob = off
                    // Screen up (−y) is forward.
                    onChange(SIMD2<Float>(Float(off.width / maxD), Float(-off.height / maxD)))
                }
                .onEnded { _ in
                    knob = .zero
                    onChange(SIMD2<Float>(0, 0))
                }
        )
        .accessibilityLabel("Movement joystick")
    }
}
