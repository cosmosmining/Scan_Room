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
    /// Only made when the scan shows RoomPlan's own lines (`steady` false).
    private(set) var captureView: RoomCaptureView?

    /// Draw the scan's own steady lines over the camera instead of RoomPlan's.
    ///
    /// RoomPlan's view redraws its lines every time it re-fits a surface, so
    /// they flash and jump, doors float, and a stepped ceiling is a guess. The
    /// steady view runs RoomPlan's session without its view and draws the room
    /// the floor plan is built from, held still by `SurfaceTracker`. Chosen on
    /// the Start screen (`steadyLinesKey`), and fixed for a house: its rooms
    /// share one session.
    static let steadyLinesKey = "scanSteadyLines"
    @Published private(set) var steady = true
    /// RoomPlan's session when the scan draws its own lines — no RoomCaptureView.
    private(set) var ownSession: RoomCaptureSession?
    /// The session, whichever view is showing it.
    var session: RoomCaptureSession? { ownSession ?? captureView?.captureSession }

    /// What the steady view draws, in world metres.
    @Published private(set) var steadyLines: [SteadyLine] = []
    /// RoomPlan's coaching — "move closer to the wall" and the like. RoomPlan's
    /// own view shows it itself; the steady view shows it in the hint.
    @Published private(set) var coaching: String?
    /// RoomPlan's surfaces, updated whenever it sends a new room…
    private let roomTracker = SurfaceTracker()
    /// …and what the finders add every few seconds, drawn as soon as found:
    /// the finders already pool every reading so far.
    private let previewTracker: SurfaceTracker = {
        var o = SurfaceTracker.Options()
        o.showAfter = 1
        o.keepFor = 1
        return SurfaceTracker(options: o)
    }()
    private var tracked: [SurfaceTracker.Tracked] = []
    private var trackedPreview: [SurfaceTracker.Tracked] = []
    private var lineIds = LineIdentity()
    /// Bumped per room RoomPlan sends, so each is tracked once.
    private var roomGeneration = 0
    private var trackedGeneration = 0
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
    /// Glass found so far in the room being scanned — RoomPlan's own windows
    /// plus the panes the depth readings saw through — refreshed every couple
    /// of seconds, so you know the glass was seen before you walk away from it.
    @Published private(set) var glassFound = 0
    /// Columns found so far, the same way.
    @Published private(set) var pillarsFound = 0
    /// RoomPlan's latest idea of the room, for the live glass and column count.
    private var latestRoom: CapturedRoom?
    private var previewRunning = false
    private var lastPreview: TimeInterval = 0
    /// Bumped per room, so a count worked out for the last room is not shown
    /// for this one.
    private var previewGeneration = 0

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

    /// The session for this scan: RoomPlan's own view's, or a bare one the
    /// steady view draws over. The choice is read when a house starts — later
    /// rooms reuse the session, so they land in the same coordinates.
    private func makeSessionIfNeeded() -> RoomCaptureSession {
        let wanted = UserDefaults.standard.object(forKey: Self.steadyLinesKey) as? Bool ?? true
        if savedScans.isEmpty, session == nil || wanted != steady {
            captureView?.captureSession.arSession.pause()
            ownSession?.arSession.pause()
            captureView = nil
            ownSession = nil
            steady = wanted
        }
        if !steady { return makeCaptureViewIfNeeded().captureSession }
        if let ownSession { return ownSession }
        let made = RoomCaptureSession()
        made.delegate = delegateBox
        ownSession = made
        return made
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
        let session = makeSessionIfNeeded()
        phase = .scanning
        stage = .mapping
        coaching = nil
        session.run(configuration: RoomCaptureSession.Configuration())
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
        resetPreview()
        fixtureTimer?.invalidate()
        fixtureTimer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, let frame = self.session?.arSession.currentFrame else { return }
                // Depth for the glass and column finders is banked on every
                // tick: it is a few hundred reads, and the more looks at a pane
                // the surer the answer.
                self.fixtureCapture.bankDepth(frame: frame)
                self.refreshPreview(now: frame.timestamp)
                if self.steady { self.refreshSteadyLines() }
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

    // MARK: Live glass and column count

    /// Seconds between live glass and column counts.
    private static let previewEvery: TimeInterval = 5
    /// Readings the live count looks at; the finished scan uses all of them.
    private static let previewSamples = 30_000

    /// Re-run the glass and column finders on the room so far, off the main
    /// thread, every few seconds, on a thinned copy of the readings: the count
    /// on screen does not need all of them, and running the finders over
    /// 120,000 readings every two seconds kept the iPad busy and hot for the
    /// whole scan — slow, and RoomPlan can stop on a hot device.
    private func refreshPreview(now: TimeInterval) {
        guard !previewRunning, now - lastPreview >= Self.previewEvery, let room = latestRoom,
              let input = FloorplanBuilder.previewInput(from: room) else { return }
        lastPreview = now
        previewRunning = true
        let all = fixtureCapture.rays
        let cap = Self.previewSamples
        let generation = previewGeneration
        // The steady lines draw the ceiling's steps, so the ceiling finder
        // runs too — on the readings that went up near the ceiling.
        let wantCeiling = steady
        Task.detached(priority: .utility) { [weak self] in
            let step = max(1, all.count / cap)
            let samples = step == 1 ? all : stride(from: 0, to: all.count, by: step).map { all[$0] }
            var overhead: [DepthSample] = []
            if wantCeiling {
                let floorY = Float(input.floorYMm / 1000)
                let up = all.filter { $0.hit.y - floorY >= 1.9 }
                let k = max(1, up.count / cap)
                overhead = k == 1 ? up : stride(from: 0, to: up.count, by: k).map { up[$0] }
            }
            let result = FloorplanBuilder.preview(input, samples: samples, overhead: overhead)
            await self?.applyPreview(result, generation: generation)
        }
    }

    private func applyPreview(_ result: FloorplanBuilder.Preview, generation: Int) {
        previewRunning = false
        guard generation == previewGeneration, phase == .scanning else { return }
        glassFound = result.glass
        pillarsFound = result.pillars
        if steady {
            trackPreview(result)
            refreshSteadyLines(force: true)
        }
    }

    private func resetPreview() {
        previewGeneration += 1
        latestRoom = nil
        lastPreview = 0
        glassFound = 0
        pillarsFound = 0
        roomTracker.reset()
        previewTracker.reset()
        tracked = []
        trackedPreview = []
        lineIds = LineIdentity()
        roomGeneration = 0
        trackedGeneration = 0
        steadyLines = []
    }

    fileprivate func roomUpdated(_ room: CapturedRoom) {
        guard phase == .scanning else { return }
        latestRoom = room
        roomGeneration += 1
    }

    // MARK: Steady lines

    /// RoomPlan's newest room into the tracker — once per room it sends, at
    /// most once per tick — and the lines rebuilt from what the tracker holds.
    private func refreshSteadyLines(force: Bool = false) {
        guard phase == .scanning, let room = latestRoom else { return }
        if roomGeneration != trackedGeneration {
            trackedGeneration = roomGeneration
            trackRoom(room)
        } else if !force {
            return
        }
        rebuildSteadyLines()
    }

    private func trackRoom(_ room: CapturedRoom) {
        var items: [SurfaceTracker.Item] = []
        for w in FloorplanBuilder.liveWalls(room.walls) {
            var v = [w.a.x, w.a.z, w.b.x, w.b.z, w.heightMm, w.topWorldMm]
            // Its two ends the same way round as last time, or the median of
            // its readings would mix one end with the other.
            if let last = roomTracker.lastReading(kind: "wall", key: w.key), last.count == 6 {
                let sameA: Double = hypot(v[0] - last[0], v[1] - last[1])
                let sameB: Double = hypot(v[2] - last[2], v[3] - last[3])
                let swapA: Double = hypot(v[2] - last[0], v[3] - last[1])
                let swapB: Double = hypot(v[0] - last[2], v[1] - last[3])
                let same: Double = sameA + sameB
                let swapped: Double = swapA + swapB
                if swapped < same { v = [w.b.x, w.b.z, w.a.x, w.a.z, w.heightMm, w.topWorldMm] }
            }
            items.append(SurfaceTracker.Item(kind: "wall", key: w.key, values: v))
        }
        for o in FloorplanBuilder.liveOpenings(room) {
            items.append(SurfaceTracker.Item(
                kind: o.type, key: o.key,
                values: [o.center.x, o.center.z, o.width, o.bottomWorldMm, o.topWorldMm]
            ))
        }
        if !room.walls.isEmpty {
            items.append(SurfaceTracker.Item(kind: "floor", key: "floor", values: [FloorplanBuilder.floorYMm(room.walls)]))
        }
        tracked = roomTracker.update(items)
    }

    private func trackPreview(_ p: FloorplanBuilder.Preview) {
        var items: [SurfaceTracker.Item] = []
        if let c = p.ceiling {
            items.append(SurfaceTracker.Item(kind: "ceiling", key: "ceiling", values: [c.height]))
            for z in c.zones where z.polygon.count >= 3 {
                let n = Double(z.polygon.count)
                let cx: Double = z.polygon.map(\.x).reduce(0, +) / n
                let cz: Double = z.polygon.map(\.z).reduce(0, +) / n
                var v: [Double] = [cx, cz, z.height]
                for q in z.polygon {
                    v.append(q.x)
                    v.append(q.z)
                }
                items.append(SurfaceTracker.Item(kind: "zone", key: nil, values: v))
            }
        }
        let poly = p.polygon
        for o in p.glassOpenings where o.wall < poly.count {
            let a = poly[o.wall]
            let b = poly[(o.wall + 1) % poly.count]
            let len = Geo.distance(a, b)
            guard len > 0 else { continue }
            let t: Double = o.offset + o.width / 2
            let cx: Double = a.x + (b.x - a.x) / len * t
            let cz: Double = a.z + (b.z - a.z) / len * t
            let c = Vec2(x: cx, z: cz)
            let sill = o.sill ?? 0
            items.append(SurfaceTracker.Item(kind: "glass", key: nil, values: [c.x, c.z, o.width, sill, sill + o.height]))
        }
        for pl in p.depthPillars {
            items.append(SurfaceTracker.Item(
                kind: pl.shape == .round ? "pillar-round" : "pillar-box", key: nil,
                values: [pl.center.x, pl.center.z, pl.width, pl.depth, pl.rotation * 1000]
            ))
        }
        trackedPreview = previewTracker.update(items)
    }

    /// The tracked surfaces → the room the floor plan would be → its lines.
    private func rebuildSteadyLines() {
        guard let floorY = tracked.first(where: { $0.kind == "floor" })?.values.first else {
            publishSteadyLines([], floorY: 0)
            return
        }
        let segments: [WallLoop.Segment] = tracked
            .filter { $0.kind == "wall" && $0.values.count == 6 }
            .map { w in
                WallLoop.Segment(
                    a: Vec2(x: w.values[0], z: w.values[1]), b: Vec2(x: w.values[2], z: w.values[3]),
                    heightMm: w.values[4], topMm: w.values[5] - floorY
                )
            }
        guard segments.count >= 2 else {
            publishSteadyLines([], floorY: floorY)
            return
        }
        let analysis = WallLoop.analyse(segments)
        let polygon = Geo.ensureCCW(Geo.simplify(analysis.outline))
        guard polygon.count >= 3 else {
            publishSteadyLines([], floorY: floorY)
            return
        }
        let wallTop: Double = segments.compactMap(\.topMm).max() ?? FloorplanBuilder.defaultCeilingMm
        let ceiling: Double = trackedPreview.first(where: { $0.kind == "ceiling" })?.values.first ?? wallTop

        var openings: [LiveLines.Opening] = tracked
            .filter { ($0.kind == "door" || $0.kind == "window" || $0.kind == "archway") && $0.values.count == 5 }
            .map { o in
                LiveLines.Opening(
                    center: Vec2(x: o.values[0], z: o.values[1]), width: o.values[2],
                    bottom: o.values[3] - floorY, top: o.values[4] - floorY, type: o.kind, glass: nil
                )
            }
        openings += trackedPreview
            .filter { $0.kind == "glass" && $0.values.count == 5 }
            .map { g in
                LiveLines.Opening(
                    center: Vec2(x: g.values[0], z: g.values[1]), width: g.values[2],
                    bottom: g.values[3], top: g.values[4], type: g.values[3] < 1 ? "door" : "window", glass: true
                )
            }
        let depthPillars: [WallLoop.Pillar] = trackedPreview
            .filter { $0.kind.hasPrefix("pillar-") && $0.values.count == 5 }
            .map { c in
                WallLoop.Pillar(
                    center: Vec2(x: c.values[0], z: c.values[1]), shape: c.kind == "pillar-round" ? .round : .box,
                    width: c.values[2], depth: c.values[3], rotation: c.values[4] / 1000
                )
            }
        let pillars: [LiveLines.Pillar] = PillarFinder.merge(fromWalls: analysis.pillars, fromDepth: depthPillars).map {
            LiveLines.Pillar(center: $0.center, shape: $0.shape.rawValue, width: $0.width, depth: $0.depth, rotation: $0.rotation)
        }
        let zones: [LiveLines.Zone] = trackedPreview
            .filter { $0.kind == "zone" && $0.values.count >= 9 }
            .map { z in
                var outline: [Vec2] = []
                var k = 3
                while k + 1 < z.values.count {
                    outline.append(Vec2(x: z.values[k], z: z.values[k + 1]))
                    k += 2
                }
                return LiveLines.Zone(polygon: outline, height: z.values[2])
            }
        // Only the walls RoomPlan has actually seen are drawn: until the room
        // is walked round, the outline closes across the gap with a guess.
        let seenWalls: [LiveLines.Seen] = segments.map { LiveLines.Seen(a: $0.a, b: $0.b) }
        let lines = LiveLines.build(LiveLines.Room(
            polygon: polygon, walls: seenWalls, ceiling: ceiling, zones: zones, openings: openings, pillars: pillars
        ))
        publishSteadyLines(lines, floorY: floorY)
    }

    /// Plan millimetres over the floor → world metres, each line keeping its
    /// identity from the last time so the view moves it rather than redraws it.
    private func publishSteadyLines(_ lines: [LiveLines.Line], floorY: Double) {
        let world: [SteadyLine.Segment] = lines.map { l in
            SteadyLine.Segment(
                kind: l.kind,
                a: SIMD3<Float>(Float(l.a.x / 1000), Float((l.a.y + floorY) / 1000), Float(l.a.z / 1000)),
                b: SIMD3<Float>(Float(l.b.x / 1000), Float((l.b.y + floorY) / 1000), Float(l.b.z / 1000))
            )
        }
        let next = lineIds.assign(world)
        if next != steadyLines { steadyLines = next }
    }

    fileprivate func instructionChanged(_ instruction: RoomCaptureSession.Instruction) {
        let text: String?
        switch instruction {
        case .moveCloseToWall: text = "Move closer to the wall"
        case .moveAwayFromWall: text = "Step back from the wall"
        case .slowDown: text = "Slow down"
        case .turnOnLight: text = "Turn on more light"
        case .lowTexture: text = "Point at a part of the room with more detail"
        case .normal: text = nil
        @unknown default: text = nil
        }
        if coaching != text { coaching = text }
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
        coaching = nil
        stopFixtureSampling()
        session?.stop(pauseARSession: false)
    }

    /// From `.roomSaved`: walk to the next room and continue scanning in the same
    /// coordinate space.
    func scanNextRoom() {
        runSession()
    }

    /// From `.roomSaved`: stop here and hand all captured rooms to the result flow.
    func buildHouse() {
        stopFixtureSampling()
        session?.arSession.pause()
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
        guard let session = session?.arSession,
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
        resetPreview()
        coaching = nil
        session?.arSession.pause()   // no-op if never created
        savedScans = []
        phase = .idle
    }

    fileprivate func finish(with data: CapturedRoomData) {
        let tracks = fixtureCapture.confirmed
        let sightings = fixtureCapture.sightings
        let rays = fixtureCapture.rays
        Task {
            do {
                let room = try await builder.capturedRoom(from: data)
                // The sockets were measured in world space while walking; this
                // expresses them against the finished walls. Off the main
                // thread: the glass and column finders work through every
                // reading of the walk, and on the main thread that froze the
                // screen after "Done".
                let scan = await Task.detached(priority: .userInitiated) {
                    FloorplanBuilder.roomScan(from: room, tracks: tracks, sightings: sightings, rays: rays)
                }.value
                savedScans.append(scan)
                steadyLines = []
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

        /// RoomPlan's room so far, several times a second while scanning.
        func captureSession(_ session: RoomCaptureSession, didUpdate room: CapturedRoom) {
            Task { @MainActor in controller?.roomUpdated(room) }
        }

        /// RoomPlan's coaching for the person scanning.
        func captureSession(_ session: RoomCaptureSession, didProvide instruction: RoomCaptureSession.Instruction) {
            Task { @MainActor in controller?.instructionChanged(instruction) }
        }

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
