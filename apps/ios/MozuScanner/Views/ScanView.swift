// The "1 Scan" step: live RoomPlan capture with Start / Finish controls layered
// over the camera passthrough. Supports multi-room capture: finish a room, then
// either scan the next room (the AR session stays alive so all rooms share one
// coordinate space) or build the house from the rooms captured so far.

import ARKit
import RoomPlan
import simd
import SwiftUI
import UIKit

struct ScanView: View {
    @ObservedObject var controller: RoomCaptureController
    /// Brief feedback for the last tap, so a miss is distinguishable from a
    /// gesture that never registered.
    @State private var tapNotice: String?

    var body: some View {
        ZStack(alignment: .bottom) {
            // Mount the RoomPlan view only once it exists (created on first
            // `start()`), so the idle "Start scan" screen appears instantly and the
            // ARKit start-up cost is paid only when the user actually scans.
            if let captureView = controller.captureView {
                GeometryReader { geo in
                    RoomCaptureViewRep(captureView: captureView)
                        .overlay(SocketMarkersOverlay(controller: controller))
                        // Tapping works throughout the scan, not only in the
                        // marking stage. Pointing at a socket is a manual
                        // override, and an override you have to switch modes to
                        // reach is one you will not use when it matters.
                        // RoomPlan's view takes no touches of its own, so
                        // nothing is being stolen from it.
                        .contentShape(Rectangle())
                        .gesture(markingTap(in: geo.size))
                }
                .overlay(alignment: .top) { wallBanner }
                .ignoresSafeArea()
            }

            VStack(spacing: 12) {
                Text(hint)
                    .font(.subheadline)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(.black.opacity(0.55), in: Capsule())

                controls
            }
            .padding(.bottom, 28)
        }
    }

    /// A tap in the marking stage: place a socket, or remove the one tapped.
    private func markingTap(in size: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onEnded { value in
                guard controller.phase == .scanning else { return }
                switch controller.handleTap(
                    at: value.location,
                    viewportSize: size,
                    orientation: ScanView.interfaceOrientation()
                ) {
                case .placed:  note("Socket pinned")
                case .removed: note("Socket removed")
                case .missed:  note("No wall there — point at the wall the socket is on")
                }
            }
    }

    private func note(_ text: String) {
        tapNotice = text
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_800_000_000)
            if tapNotice == text { tapNotice = nil }
        }
    }

    static func interfaceOrientation() -> UIInterfaceOrientation {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first?.interfaceOrientation ?? .portrait
    }

    @ViewBuilder
    private var controls: some View {
        switch controller.phase {
        case .scanning:
            VStack(spacing: 10) {
                // Stage 2 of the workflow, made an explicit choice rather than a
                // hidden mode: walking the room and pointing at sockets want
                // different things from a tap, so the app asks which you are
                // doing instead of guessing.
                Button {
                    if controller.stage == .marking {
                        controller.resumeMapping()
                    } else {
                        controller.beginMarking()
                    }
                } label: {
                    Label(
                        controller.stage == .marking ? "Resume auto-detection" : "Pause detection & point",
                        systemImage: controller.stage == .marking ? "checkmark.circle" : "hand.tap"
                    )
                    .frame(maxWidth: 260)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .tint(controller.stage == .marking ? .orange : .gray)

                Button("Finish room", action: controller.finishRoom)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
            }

        case .processing:
            ProgressView("Building floorplan…").tint(.white).foregroundStyle(.white)

        case .roomSaved(let count):
            VStack(spacing: 10) {
                Button {
                    controller.scanNextRoom()
                } label: {
                    Label("Scan next room", systemImage: "plus.viewfinder")
                        .frame(maxWidth: 260)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)

                Button {
                    controller.buildHouse()
                } label: {
                    Label(count == 1 ? "Use this room" : "Build house (\(count) rooms)",
                          systemImage: "house")
                        .frame(maxWidth: 260)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .tint(.white)
            }

        default:
            Button("Start scan", action: controller.start)
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
        }
    }

    /// Wall-level confirmation, at the top of the camera view.
    ///
    /// A wall-level statement rather than a box on the socket itself: what the
    /// detector is genuinely sure of is "there is a socket on the wall you are
    /// looking at", and drawing a tight box implies a precision the per-frame
    /// image geometry does not have. The label points below say how many and
    /// roughly where; the plan says exactly where, once the room is closed.
    @ViewBuilder
    private var wallBanner: some View {
        if controller.phase == .scanning, controller.socketsOnFacingWall > 0 {
            let n = controller.socketsOnFacingWall
            Label(
                n == 1
                    ? "Socket detected on this wall"
                    : "\(n) sockets detected on this wall",
                systemImage: "bolt.fill"
            )
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(Color.orange.opacity(0.92), in: Capsule())
            .shadow(radius: 6, y: 2)
            .padding(.top, 64)
            .transition(.move(edge: .top).combined(with: .opacity))
            .animation(.easeOut(duration: 0.2), value: n)
        }
    }

    private var hint: String {
        if let tapNotice { return tapNotice }
        switch controller.phase {
        case .scanning:
            if controller.stage == .marking {
                return "Detection paused \u{00B7} tap each socket to pin it, tap a pin to remove it"
                    + " \u{00B7} \(controller.fixturesFound) placed."
            }
            let base = "Walk slowly around the room, pointing at every wall, corner, door and window."
            // Sockets are found from the same camera feed as you walk. Report
            // the frames looked at too, so "found none" is distinguishable from
            // "never looked" while you are still standing in the room.
            guard controller.fixtureFramesAnalysed > 0 else { return base }
            var status = " Sockets: \(controller.fixturesFound) confirmed"
            if controller.fixturesPending > 0 {
                // A candidate is not a socket until it has been seen from
                // somewhere else too, so say what is still being checked rather
                // than counting it early.
                status += ", \(controller.fixturesPending) checking"
            }
            status += " (\(controller.fixtureFramesAnalysed) frames"
            if controller.analysisMs > 0 {
                status += ", \(Int(controller.analysisMs.rounded()))ms each"
            }
            status += "). Tap a socket to pin it yourself."
            if controller.fixturesFound == 0, controller.fixturesPending == 0,
               controller.fixtureCandidates > 0 {
                // Nothing has stuck, but the camera IS seeing plate-like blocks.
                // Say so: "sees nothing" and "sees plenty, none on a wall" are
                // different problems with different fixes.
                status += " \(controller.fixtureCandidates) candidates seen, none on a wall."
            }
            if !controller.depthAvailable {
                status += " No depth from this session — socket positions will be approximate."
            }
            return base + status
        case .processing:
            return "Processing the scan…"
        case .roomSaved(let count):
            return "Room \(count) captured. Walk through a doorway and scan the next room — all rooms share one floorplan — or build the house now."
        default:
            return "Stand in a doorway and tap Start. RoomPlan measures the room in 3D."
        }
    }
}

/// One numbered point per CONFIRMED socket, pinned in the room.
///
/// Not boxes. A box asserts an exact outline, and the per-frame image geometry
/// that produced it is the least reliable part of the pipeline — on a dim wall
/// it clings to a halo, a scuff or a shadow edge as readily as to a faceplate,
/// which is exactly what the field screenshots showed. A point asserts only what
/// is actually known: a socket exists, and it is about here.
///
/// The points are ANCHORED IN THE WORLD, not in the image. Each one is a metric
/// 3D position projected with ARKit's own camera model, so it stays on its
/// socket as you move — which is also proof, live and on the device, that the
/// position being stored is the right one.
private struct SocketMarkersOverlay: View {
    @ObservedObject var controller: RoomCaptureController

    private struct Marker: Identifiable {
        let id: Int
        let point: CGPoint
        let number: Int
        /// Pinned by the user rather than found by the detector.
        let manual: Bool
    }

    var body: some View {
        GeometryReader { geo in
            ForEach(markers(in: geo.size)) { m in
                ZStack {
                    // The point itself, on the socket. A pin the user placed is
                    // drawn in a different colour, because "I put that there"
                    // and "the app thinks that is there" are worth telling
                    // apart at a glance.
                    Circle()
                        .fill(m.manual ? Color.green : Color.orange)
                        .frame(width: 14, height: 14)
                        .overlay(Circle().stroke(.white, lineWidth: 2.5))
                        .position(m.point)
                    // A short leader to a number, so the label never covers the
                    // thing it labels — the same idiom RoomPlan uses for walls.
                    Path { p in
                        p.move(to: CGPoint(x: m.point.x, y: m.point.y - 9))
                        p.addLine(to: CGPoint(x: m.point.x, y: max(12, m.point.y - 30)))
                    }
                    .stroke(m.manual ? Color.green : Color.orange, lineWidth: 2)
                    Text("\(m.number)")
                        .font(.caption.weight(.bold))
                        .foregroundColor(.white)
                        .frame(width: 22, height: 22)
                        .background(m.manual ? Color.green : Color.orange, in: Circle())
                        .overlay(Circle().stroke(.white, lineWidth: 1.5))
                        .position(x: m.point.x, y: max(12, m.point.y - 41))
                }
                .shadow(radius: 3)
            }
        }
        .allowsHitTesting(false)
        .animation(.easeOut(duration: 0.15), value: controller.liveTracks.count)
    }

    /// World positions → screen points, using ARKit's own projection.
    ///
    /// `projectPoint` accounts for the interface orientation and the aspect-fill
    /// of the camera feed, which is where hand-rolled image-space mapping goes
    /// wrong: the captured image is landscape sensor space and the screen
    /// usually is not, so a box mapped by hand lands plausibly but incorrectly.
    private func markers(in size: CGSize) -> [Marker] {
        guard size.width > 1, size.height > 1,
              let frame = controller.captureView?.captureSession.arSession.currentFrame
        else { return [] }
        let orientation = interfaceOrientation()
        let toCamera = frame.camera.transform.inverse
        let bounds = CGRect(origin: .zero, size: size).insetBy(dx: -40, dy: -40)

        var out: [Marker] = []
        for (i, track) in controller.liveTracks.enumerated() {
            let world = SIMD3<Float>(
                Float(track.world.x), Float(track.world.y), Float(track.world.z)
            )
            // Behind the camera projects to a perfectly plausible on-screen
            // point, so cull in camera space first (ARKit looks down −Z).
            let local = toCamera * SIMD4<Float>(world.x, world.y, world.z, 1)
            guard local.z < -0.05 else { continue }
            let screen = frame.camera.projectPoint(
                world, orientation: orientation, viewportSize: size
            )
            guard screen.x.isFinite, screen.y.isFinite, bounds.contains(screen) else { continue }
            out.append(Marker(id: track.id, point: screen, number: i + 1, manual: track.manual))
        }
        return out
    }

    private func interfaceOrientation() -> UIInterfaceOrientation {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first?.interfaceOrientation ?? .portrait
    }
}

/// Hosts RoomPlan's `RoomCaptureView` (a UIView) in SwiftUI.
struct RoomCaptureViewRep: UIViewRepresentable {
    let captureView: RoomCaptureView
    func makeUIView(context: Context) -> RoomCaptureView { captureView }
    func updateUIView(_ uiView: RoomCaptureView, context: Context) {}
}
