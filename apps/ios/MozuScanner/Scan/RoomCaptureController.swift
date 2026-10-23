// Drives the RoomPlan capture session and turns finished scans into `RoomScan`s.
// Supports MULTI-ROOM capture: after each room the session is stopped with
// `pauseARSession: false`, which keeps the underlying ARSession (and therefore the
// world coordinate origin) alive — so every subsequent room lands in the SAME
// coordinate space and the scans compose into a whole-house floorplan with no
// manual alignment. The SwiftUI layer observes `phase` to move between the live
// scan, the "room saved — scan another?" interstitial, and the final result.

import ARKit
import Foundation
import UIKit
import AVFoundation
import RoomPlan
import simd

@MainActor
final class RoomCaptureController: ObservableObject {
    enum Phase: Equatable {
        case idle
        case scanning
        case processing
        /// A room was captured and the AR session is still alive; the user chooses
        /// to scan the next room (same coordinate space) or build the house.
        case roomSaved(count: Int)
        /// All captured rooms, in one shared coordinate space. One element = the
        /// classic single-room flow; several = a whole house.
        case done([RoomScan])
        case failed(String)
    }

    /// Where the scan is within the `.scanning` phase.
    ///
    /// The three states the workflow asks for, made explicit:
    ///
    ///   1 `.mapping`   — walk the room. RoomPlan builds the surfaces; socket
    ///                    detection banks candidates but nothing is committed.
    ///   2 `.marking`   — the map is good enough to anchor against, so the user
    ///                    points at the sockets. Taps land immediately, on the
    ///                    surfaces already established.
    ///   3 anchoring    — `finishRoom()` onwards: every socket, tapped or
    ///                    detected, is expressed against the finished polygon.
    ///
    /// Automatic detection keeps running in `.marking`. The stages are about
    /// what a TAP means, not about switching the detector off — a user who
    /// wants to point at every socket can, and one who does not still gets them.
    enum Stage: Equatable { case mapping, marking }

    @Published private(set) var phase: Phase = .idle
    @Published private(set) var stage: Stage = .mapping

    /// Rooms captured so far in this session (shared world origin).
    private(set) var savedScans: [RoomScan] = []

    /// RoomPlan's `RoomCaptureView` spins up ARKit + Metal + the camera pipeline —
    /// the bulk of the launch-to-scan lag — so it is created lazily on the first
    /// `start()` instead of in `init()` (i.e. at app launch). `nil` until then, and
    /// reused across rooms so every room shares one ARSession / world origin.
    private(set) var captureView: RoomCaptureView?
    private let builder = RoomBuilder(options: [.beautifyObjects])
    private var delegateBox: SessionDelegate?

    /// Socket detection rides along with the room scan: RoomPlan already has the
    /// camera open, so frames are sampled from its ARSession rather than opening
    /// a second capture or asking the user to do a separate pass.
    private let fixtureCapture = FixtureCapture()
    private var fixtureTimer: Timer?

    /// Sockets confirmed so far in the room being scanned — surfaced live.
    @Published private(set) var fixturesFound = 0
    /// Candidates still being corroborated. Shown separately from the confirmed
    /// count so "looking at something" reads differently from "found something".
    @Published private(set) var fixturesPending = 0
    /// Camera frames the socket detector has actually examined. Shown so a scan
    /// that finds nothing can be told apart from one that never looked.
    @Published private(set) var fixtureFramesAnalysed = 0
    /// Bright plate-like candidates the image stage produced, before geometry.
    /// Surfaced only when nothing has confirmed, because then it is the single
    /// most useful thing to know on site: "the camera sees nothing plate-like"
    /// and "it sees plenty but none of them are on a wall" need opposite fixes.
    @Published private(set) var fixtureCandidates = 0
    /// Confirmed sockets, in world space — the label points drawn over the camera.
    @Published private(set) var liveTracks: [SocketTrack] = []
    /// How many confirmed sockets are on the wall currently being pointed at.
    /// Drives the "Socket detected on this wall" banner.
    @Published private(set) var socketsOnFacingWall = 0
    /// How long the last detection pass took. Surfaced because "the scan feels
    /// slow" and "detection is slow" are different problems, and this is the
    /// number that separates them without a cable and a profiler.
    @Published private(set) var analysisMs = 0.0
    /// False when the AR session provides no scene depth, so sockets are being
    /// found by the weaker image-only fallback.
    @Published private(set) var depthAvailable = true

    init() {
        delegateBox = SessionDelegate(controller: self)
    }

    /// Build the capture view on first use and wire up its delegate; hand back the
    /// existing instance on later rooms so the AR world origin is preserved.
    private func makeCaptureViewIfNeeded() -> RoomCaptureView {
        if let captureView { return captureView }
        let view = RoomCaptureView(frame: .zero)
        view.captureSession.delegate = delegateBox
        captureView = view
        return view
    }

    func start() {
        // The UI gates on `RoomCaptureSession.isSupported`, but that does NOT cover
        // camera authorization — ARKit aborts the process if it opens the camera
        // while unauthorized. Request access first, then run the capture session.
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            runSession()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                Task { @MainActor in
                    guard let self else { return }
                    if granted {
                        self.runSession()
                    } else {
                        self.fail("Camera access is needed to scan your room. Enable it in Settings → MOZU Scanner → Camera.")
                    }
                }
            }
        case .denied, .restricted:
            fail("Camera access is needed to scan your room. Enable it in Settings → MOZU Scanner → Camera.")
        @unknown default:
            runSession()
        }
    }

    /// Move to pointing at sockets.
    ///
    /// Automatic detection PAUSES here, and that is the point: it hands the
    /// whole chip back to RoomPlan, so the view is as smooth as it can be while
    /// you are aiming at something small. Tapping works in either stage — this
    /// is the stage for when you would rather point than wait.
    func beginMarking() { stage = .marking }
    /// Back to walking the room, with detection running again.
    func resumeMapping() { stage = .mapping }

    private func runSession() {
        let view = makeCaptureViewIfNeeded()
        phase = .scanning
        stage = .mapping
        view.captureSession.run(configuration: RoomCaptureSession.Configuration())
        startFixtureSampling()
    }

    /// Poll the live ARSession for frames to run socket detection on.
    ///
    /// Polling rather than becoming the ARSession delegate: RoomPlan owns that
    /// delegate, and taking it would break the room capture itself. `consider`
    /// throttles internally, so a modest timer is enough.
    private func startFixtureSampling() {
        fixtureCapture.reset()
        fixturesFound = 0
        fixturesPending = 0
        fixtureFramesAnalysed = 0
        fixtureCandidates = 0
        liveTracks = []
        socketsOnFacingWall = 0
        fixtureTimer?.invalidate()
        fixtureTimer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, let frame = self.captureView?.captureSession.arSession.currentFrame else { return }
                // Detection stands down while the user is pointing, so the scan
                // gets the CPU it needs to stay smooth.
                if self.stage != .marking { self.fixtureCapture.consider(frame: frame) }

                let confirmed = self.fixtureCapture.confirmed
                self.fixturesFound = confirmed.count
                self.fixturesPending = self.fixtureCapture.tracks.count - confirmed.count
                self.fixtureFramesAnalysed = self.fixtureCapture.framesAnalysed
                self.fixtureCandidates = self.fixtureCapture.rawDetections
                self.analysisMs = self.fixtureCapture.lastAnalysisMs
                self.depthAvailable = self.fixtureCapture.depthAvailable
                if self.liveTracks != confirmed { self.liveTracks = confirmed }
                self.socketsOnFacingWall = RoomCaptureController.countFacing(confirmed, frame: frame)
            }
        }
    }

    /// Confirmed sockets on the wall the camera is pointed at right now.
    ///
    /// "This wall" is decided by facing, not by the floor polygon, because the
    /// polygon does not exist until the scan ends — and by then the message is
    /// no use. A socket counts if its wall faces back at the camera and it lies
    /// ahead rather than behind.
    private static func countFacing(_ tracks: [SocketTrack], frame: ARFrame) -> Int {
        let t = frame.camera.transform
        // ARKit's camera looks down its own −Z.
        let forwardRaw = SIMD3<Double>(-Double(t.columns.2.x), 0, -Double(t.columns.2.z))
        guard simd_length(forwardRaw) > 1e-6 else { return 0 }
        let forward = simd_normalize(forwardRaw)
        let eye = SIMD3<Double>(
            Double(t.columns.3.x), Double(t.columns.3.y), Double(t.columns.3.z)
        )
        return tracks.filter { track in
            let normalRaw = SIMD3<Double>(track.normal.x, 0, track.normal.z)
            guard simd_length(normalRaw) > 1e-6 else { return false }
            guard simd_dot(simd_normalize(normalRaw), -forward) > 0.5 else { return false }
            let toTrack = SIMD3<Double>(track.world.x - eye.x, 0, track.world.z - eye.z)
            guard simd_length(toTrack) > 1e-6 else { return true }
            return simd_dot(simd_normalize(toTrack), forward) > 0.3
        }.count
    }

    private func stopFixtureSampling() {
        fixtureTimer?.invalidate()
        fixtureTimer = nil
        socketsOnFacingWall = 0
    }

    /// Finish scanning the current room. The AR session is kept alive
    /// (`pauseARSession: false`) so a follow-up room shares the same world origin;
    /// the delegate then delivers the room data and we move to `.roomSaved`.
    func finishRoom() {
        phase = .processing
        stopFixtureSampling()
        captureView?.captureSession.stop(pauseARSession: false)
    }

    /// From `.roomSaved`: walk to the next room and continue scanning in the same
    /// coordinate space.
    func scanNextRoom() {
        runSession()
    }

    /// From `.roomSaved`: stop here and hand all captured rooms to the result flow.
    func buildHouse() {
        stopFixtureSampling()
        captureView?.captureSession.arSession.pause()
        phase = .done(savedScans)
    }

    // MARK: Tap to place

    /// What a tap on the camera view did.
    enum TapResult { case placed, removed, missed }

    /// Pin a socket where the user pointed — or, while editing, remove one.
    ///
    /// What a tap MEANS depends on the stage, and it has to:
    ///
    ///   * `.mapping` you are walking the room and pointing things out, so a tap
    ///     always ADDS. Landing on a socket the detector already found promotes
    ///     it to a certainty rather than deleting it — which is what a tap did
    ///     while the on-screen hint was inviting you to "tap a socket to pin it
    ///     yourself", and is exactly backwards.
    ///   * `.marking` you are editing, so a tap on a pin takes it away. Every
    ///     mistake the gesture can make is then undone by repeating it.
    @discardableResult
    func handleTap(
        at point: CGPoint,
        viewportSize: CGSize,
        orientation: UIInterfaceOrientation
    ) -> TapResult {
        guard let session = captureView?.captureSession.arSession,
              let frame = session.currentFrame else { return .missed }

        if stage == .marking,
           let hit = nearestMarker(to: point, viewportSize: viewportSize, orientation: orientation, frame: frame) {
            fixtureCapture.remove(id: hit)
            refreshTracks(frame: frame)
            return .removed
        }

        guard let placement = TapToPlace.place(
            at: point, viewportSize: viewportSize, orientation: orientation,
            frame: frame, session: session
        ) else { return .missed }

        fixtureCapture.addManual(world: placement.world, normal: placement.normal)
        refreshTracks(frame: frame)
        return .placed
    }

    /// Screen-space hit test against the markers currently drawn.
    private func nearestMarker(
        to point: CGPoint,
        viewportSize: CGSize,
        orientation: UIInterfaceOrientation,
        frame: ARFrame,
        radius: CGFloat = 44
    ) -> Int? {
        var best: (id: Int, distance: CGFloat)?
        let toCamera = frame.camera.transform.inverse
        for track in liveTracks {
            let world = SIMD3<Float>(
                Float(track.world.x), Float(track.world.y), Float(track.world.z)
            )
            let local = toCamera * SIMD4<Float>(world.x, world.y, world.z, 1)
            guard local.z < -0.05 else { continue }
            let screen = frame.camera.projectPoint(
                world, orientation: orientation, viewportSize: viewportSize
            )
            guard screen.x.isFinite, screen.y.isFinite else { continue }
            let d = hypot(screen.x - point.x, screen.y - point.y)
            if d <= radius, best == nil || d < best!.distance { best = (track.id, d) }
        }
        return best?.id
    }

    /// Republish what the overlay draws, right now rather than on the next tick,
    /// so a tap feels like it landed the instant it did.
    private func refreshTracks(frame: ARFrame) {
        let confirmed = fixtureCapture.confirmed
        liveTracks = confirmed
        fixturesFound = confirmed.count
        fixturesPending = fixtureCapture.tracks.count - confirmed.count
        socketsOnFacingWall = RoomCaptureController.countFacing(confirmed, frame: frame)
    }

    func reset() {
        stopFixtureSampling()
        stage = .mapping
        fixtureCapture.reset()
        fixturesFound = 0
        fixturesPending = 0
        fixtureFramesAnalysed = 0
        fixtureCandidates = 0
        liveTracks = []
        captureView?.captureSession.arSession.pause()   // no-op if never created
        savedScans = []
        phase = .idle
    }

    fileprivate func finish(with data: CapturedRoomData) {
        Task {
            do {
                let room = try await builder.capturedRoom(from: data)
                // The sockets were measured in world space while walking; this
                // expresses them against the finished walls.
                let scan = FloorplanBuilder.roomScan(
                    from: room,
                    tracks: fixtureCapture.confirmed,
                    sightings: fixtureCapture.sightings
                )
                savedScans.append(scan)
                phase = .roomSaved(count: savedScans.count)
            } catch {
                fail(error.localizedDescription)
            }
        }
    }

    fileprivate func fail(_ message: String) {
        // Never throw away rooms already captured because a later room failed —
        // fall back to the interstitial so the user can rescan or build with what
        // they have.
        phase = savedScans.isEmpty ? .failed(message) : .roomSaved(count: savedScans.count)
    }

    /// Separate delegate object so the controller stays `@MainActor`-clean.
    private final class SessionDelegate: NSObject, RoomCaptureSessionDelegate {
        weak var controller: RoomCaptureController?
        init(controller: RoomCaptureController) { self.controller = controller }

        func captureSession(
            _ session: RoomCaptureSession,
            didEndWith data: CapturedRoomData,
            error: Error?
        ) {
            Task { @MainActor in
                if let error { controller?.fail(error.localizedDescription); return }
                controller?.finish(with: data)
            }
        }
    }
}
