// Find the sockets while the room is being scanned, and pin them in 3D.
//
// RoomPlan already runs an ARSession with the camera open, so this takes frames
// from that same session — no second camera, no extra permission, no separate
// screen. Each sampled frame goes through `SocketDetector` for candidates and
// `DepthGate` for geometry, and what survives is merged into a small set of
// world-space TRACKS.
//
// Tracks, rather than a bag of per-frame boxes, because that is what makes the
// answer trustworthy. A shadow, a highlight or a bright patch of drywall can
// pass a single-frame image test; it cannot survive being looked at from a
// different place, because it does not live at a fixed point in the room. So a
// candidate is a *hypothesis* until it has been seen several times from
// meaningfully different positions, and only confirmed tracks are ever shown or
// placed. That is the "confirm it exists, then locate it" split, done with
// geometry instead of trust.
//
// It also fixes placement. Positions come out of the depth map at the moment of
// seeing — measured, in world coordinates — instead of being reconstructed at
// the end by intersecting a stored image ray with the finished floor polygon,
// where every degree of pose error became centimetres of drift on the plan.

import ARKit
import CoreVideo
import Foundation
import simd

/// One socket seen in one frame, banked with everything needed to place it by
/// ray-casting later. Only used when the session gives us no scene depth — with
/// depth, a sighting is measured on the spot and never needs storing.
struct FixtureSighting {
    /// Detection centre, normalised 0…1 in the captured image.
    var cx: Double
    var cy: Double
    var score: Double
    /// Camera pose at capture (ARKit metres).
    var cameraTransform: simd_float4x4
    /// Camera intrinsics for the captured image.
    var intrinsics: simd_float3x3
    var imageWidth: Int
    var imageHeight: Int
}

/// One depth reading banked for `GlassFinder` and `PillarFinder`, in ARKit
/// world metres: where the camera was, where the reading landed, how sure ARKit
/// was of it, and how bright the camera saw that spot.
struct DepthSample {
    var eye: SIMD3<Float>
    var hit: SIMD3<Float>
    /// ARKit's confidence: 0 low, 1 medium, 2 high. A pixel with no depth at all
    /// is 0, with `hit` far along its line of sight.
    var confidence: UInt8
    /// Full-range luma at the reading, 0–255. A window in daylight is ~255.
    var luma: UInt8
}

/// One socket, accumulated across the frames that saw it.
struct SocketTrack: Identifiable, Equatable {
    var id: Int
    /// Plate centre in ARKit world coordinates (metres).
    var world: SIMD3<Double>
    /// Wall normal, pointing into the room.
    var normal: SIMD3<Double>
    var widthMm: Double
    var heightMm: Double
    /// Best single-frame detector score.
    var score: Double
    /// How many frames have landed on this track.
    var hits: Int
    /// Widest separation between the camera positions that saw it (metres).
    var baselineM: Double
    /// Camera positions kept for the baseline calculation (capped).
    var viewpoints: [SIMD3<Double>]
    /// Dark features counted in the CLOSEST view of this plate, with the plate
    /// size that view had. Kept from the best look rather than averaged: slot
    /// counting degrades with distance, so one good look settles what a run of
    /// distant ones cannot.
    var bestFeatures: Int
    var bestPlatePx: Double
    /// Placed by the user pointing at it. A person who taps a socket has
    /// settled the question; nothing downstream gets to second-guess it — and
    /// no later detection gets to move it.
    var manual: Bool = false
    /// Total weight of the looks averaged into `world`. Each look counts
    /// 1/range²: a reading's error grows with distance, so a close look settles
    /// the position and a distant one only nudges it. With a plain mean, one
    /// far-off sighting could drag a confirmed marker off its socket.
    var weight: Double = 0
    /// The number shown beside the marker, fixed the moment the track first
    /// confirms (0 until then). Numbering by list position renumbered every
    /// later socket whenever an earlier-created one confirmed late — labels
    /// hopping from socket to socket mid-scan.
    var number: Int = 0

    /// Power outlet, data/switch plate, blank cover — or unknown when it was
    /// never seen close enough for the slots to resolve.
    var kind: PlateKind { PlateKind.classify(features: bestFeatures, platePx: bestPlatePx) }

    /// Seen often enough, from far enough apart, to be a thing in the room
    /// rather than a trick of one viewpoint's light.
    var confirmed: Bool {
        if manual { return true }
        return hits >= FixtureCapture.confirmHits
            && (baselineM >= FixtureCapture.confirmBaselineM || hits >= FixtureCapture.confirmHitsStatic)
    }

    /// Confidence for the placed fixture: corroboration first, image score second.
    var confidence: Double {
        if manual { return 1 }
        let corroboration = min(1.0, Double(hits) / 6.0)
        let parallax = min(1.0, baselineM / 0.6)
        return min(0.98, 0.45 * score + 0.35 * corroboration + 0.20 * parallax)
    }
}

/// Collects socket tracks across a scan.
final class FixtureCapture {

    // MARK: Confirmation policy

    /// Frames that must agree before a candidate is called a socket.
    static let confirmHits = 3
    /// …and the camera must have moved this far between the extremes, so the
    /// agreement means "same point in the room", not "same pixel on the sensor".
    static let confirmBaselineM = 0.14
    /// Unless it has simply been seen this many times: a user who stands still
    /// and stares at a real socket should still get it.
    static let confirmHitsStatic = 7
    /// Detections within this of a track's world position are the same socket.
    /// Tighter than the ~200mm gap between two outlets side by side, so a double
    /// outlet stays two sockets.
    static let mergeM = 0.11
    /// …and their wall normals must agree to within this (cosine), so sockets on
    /// two walls meeting at a corner never merge.
    static let mergeNormalDot = 0.72

    /// Floor on the gap between analysed frames. A socket is not going
    /// anywhere, so a few looks a second is plenty.
    private let minInterval: TimeInterval = 0.25
    /// Ceiling, so a slow device still checks occasionally rather than giving up.
    private let maxInterval: TimeInterval = 1.5
    /// Share of wall-clock time detection is allowed to occupy.
    ///
    /// This is the real fix for "scanning is slow". RoomPlan is holding a frame
    /// rate on the same chip, and a fixed interval means a device that takes
    /// 200ms per frame runs detection 80% of the time and the scan judders. So
    /// the interval is derived from how long the last frame ACTUALLY took:
    /// spend at most a fifth of the time analysing, whatever the hardware, and
    /// let the scan have the rest.
    private let dutyCycle = 0.2
    /// Detections below this are not worth measuring. Deliberately permissive:
    /// the geometry gate and the multi-view confirmation do the rejecting now,
    /// and they reject for reasons that are true rather than photogenic. The
    /// image stage's job is recall — miss a socket here and no amount of
    /// geometry downstream can recover it.
    private let minScore = 0.30
    /// Analysis resolution. ARKit hands us ~1920x1440; a socket's pin slots are
    /// only a few pixels wide at room distance, so shrinking too aggressively
    /// erases the very feature the detector keys on. Cost is quadratic in this
    /// number, and 1024 is where the balance sits now that the depth gate
    /// verifies size independently — a distant plate no longer has to be
    /// resolved well enough to count its slots in order to be trusted.
    private let maxDim = 1024

    private var lastSample: TimeInterval = 0
    private var nextTrackID = 1
    /// Bumped by `reset()`. An analysis carries the generation it started in and
    /// is discarded if that has moved on — otherwise a pass begun in one room
    /// lands its sockets in the next one, which shares neither its walls nor its
    /// coordinates in any way the user would accept.
    private var generation = 0
    /// Gap currently required between frames, adapted to what this device is
    /// actually managing.
    private var interval: TimeInterval = 0.25
    /// How long the last analysis took, surfaced so a slow scan is diagnosable
    /// on site rather than by guesswork.
    private(set) var lastAnalysisMs = 0.0

    /// Detection runs here, never on the main thread.
    ///
    /// RoomPlan is rendering an AR session on the main thread; a few tens of
    /// milliseconds of image processing per frame there is the difference
    /// between a smooth scan and a juddering one. Only the (tiny) result is
    /// handed back to the main thread.
    private let queue = DispatchQueue(label: "com.mozu.socket-detection", qos: .userInitiated)
    /// One frame in flight at a time. Falling behind the camera would pile up
    /// pixel buffers and starve ARKit's pool, which is worse than missing frames.
    private var busy = false

    /// Every hypothesis, confirmed or not.
    private(set) var tracks: [SocketTrack] = []
    /// Raw image sightings, banked ONLY while there is no scene depth to measure
    /// with, so such a session still has something to ray-cast at the end.
    private(set) var sightings: [FixtureSighting] = []
    /// Depth readings banked for `GlassFinder` and `PillarFinder`. Walls are not
    /// known until the scan ends, so the readings are kept and judged against
    /// the finished walls then: readings that went THROUGH a wall, or found
    /// nothing to measure where a wall should be, are how glass RoomPlan missed
    /// is found; readings stacked floor to ceiling in the open are a column.
    ///
    /// EVERY reading is kept, low confidence included. The first version kept
    /// only confident ones — and in daylight, through glass, there are none:
    /// the sun blinds the LiDAR there, and ARKit marks its guess low
    /// confidence. Dropping those is why glass went undetected in the daytime.
    private(set) var rays: [DepthSample] = []
    /// A sparse grid per frame: ~400 reads of three buffers, so it is taken on
    /// every tick of the scan rather than only when detection runs.
    static let rayColumns = 24
    static let rayRows = 18
    /// Gap between banked frames.
    static let depthInterval: TimeInterval = 0.2
    /// Where a pixel with no depth at all is put, along its line of sight.
    static let noDepthM: Float = 8
    /// Past this the whole set is thinned by half, keeping the whole walk
    /// represented at lower density rather than only its end. ~5.8MB at the cap.
    static let maxRays = 120_000
    private var lastDepthSample: TimeInterval = 0
    /// Where the user has said "that is not a socket".
    ///
    /// Without this, deleting is theatre: detection keeps running, the same
    /// bright rectangle is seen three more times, and the marker the user just
    /// dismissed is back within a second. A rejection is a judgement about a
    /// PLACE, so it is remembered as one.
    private var rejected: [SIMD3<Double>] = []
    /// How many frames the detector has actually examined.
    private(set) var framesAnalysed = 0
    /// Candidates the image detector produced, before geometry. If this climbs
    /// while `tracks` does not, the image stage is firing on things that are not
    /// on a wall — which is the distinction worth having on site.
    private(set) var rawDetections = 0
    /// Candidates the depth gate threw out (wrong size, off the wall, not flat,
    /// not vertical).
    private(set) var rejectedByGeometry = 0
    /// False when the session gives us no scene depth, so the UI can say why
    /// detection is running in its weaker fallback mode.
    private(set) var depthAvailable = true

    /// Only the tracks worth showing or placing.
    /// Confirmed tracks in the order their numbers were given, so the list —
    /// and every label drawn from it — is stable as more sockets confirm.
    var confirmed: [SocketTrack] { tracks.filter(\.confirmed).sorted { $0.number < $1.number } }

    func reset() {
        tracks.removeAll()
        sightings.removeAll()
        rays.removeAll()
        lastDepthSample = 0
        framesAnalysed = 0
        rawDetections = 0
        rejectedByGeometry = 0
        depthAvailable = true
        nextTrackID = 1
        generation &+= 1
        rejected.removeAll()
        lastSample = 0
        interval = minInterval
        lastAnalysisMs = 0
        busy = false
    }

    /// Offer a live frame. Cheap to call often — it throttles itself, drops the
    /// frame if a previous one is still being analysed, and does the actual work
    /// off the main thread. Call from the main thread.
    func consider(frame: ARFrame) {
        let now = frame.timestamp
        guard !busy, now - lastSample >= interval else { return }
        lastSample = now
        busy = true

        // Snapshot everything needed before leaving the main thread. Buffers are
        // retained (not the ARFrame), so ARKit can recycle the frame at once.
        let buffer = frame.capturedImage
        let depthData = DepthGate.depthData(for: frame)
        let transform = frame.camera.transform
        let intrinsics = frame.camera.intrinsics
        let width = CVPixelBufferGetWidth(buffer)
        let height = CVPixelBufferGetHeight(buffer)
        let maxDim = self.maxDim
        let minScore = self.minScore
        let gen = generation

        queue.async { [weak self] in
            guard let self else { return }
            let startedAt = CFAbsoluteTimeGetCurrent()
            var found: [SocketDetection] = []
            if let gray = FixtureCapture.luminance(from: buffer, maxDim: maxDim) {
                found = SocketDetector.detect(gray, maxDim: maxDim, minScore: minScore)
            }

            // Measure each candidate against the depth map. Everything that
            // matters — is it plate-sized, is it on a wall, is that wall
            // vertical, where exactly is it — is answered here.
            let depth = depthData.flatMap { DepthGate.snapshot($0) }
            var measured: [(SocketDetection, PlateGeometry)] = []
            if let depth {
                // Measure the best few, not all of them. Each measurement fits a
                // plane over a neighbourhood, so the cost is linear in candidate
                // count — and a frame that yields dozens of candidates is a frame
                // looking at something that is not a wall of sockets. A tester's
                // hallway of LED cove lighting produced 33 in one frame and
                // confirmed nothing; measuring all 33 is how a single frame
                // stretches to seconds and the walk stops being looked at.
                let ranked = found.count > SocketDetector.maxMeasuredCandidates
                    ? Array(found.sorted { $0.score > $1.score }
                        .prefix(SocketDetector.maxMeasuredCandidates))
                    : found
                for d in ranked {
                    guard let geometry = DepthGate.measure(
                        d,
                        depth: depth,
                        intrinsics: intrinsics,
                        imageSize: (width: width, height: height),
                        cameraTransform: transform
                    ) else { continue }
                    measured.append((d, geometry))
                }
            }

            // Frozen before the hop to the main queue, so the closure below
            // captures values rather than this pass's mutable working state.
            let seen = found, placed = measured
            let hasDepth = depth != nil
            let candidates = found.count
            let elapsed = CFAbsoluteTimeGetCurrent() - startedAt
            DispatchQueue.main.async {
                // A pass that began before `reset()` belongs to the last room.
                // Drop it whole — its sockets, its stats, AND its `busy = false`,
                // which would otherwise release a newer pass still in flight.
                // (The generation was captured for exactly this and then never
                // compared, so a pass could land its sockets in the next room.)
                guard gen == self.generation else { return }
                // Spend at most `dutyCycle` of the time here, measured rather
                // than assumed, and clamped so neither a fast device hammers the
                // CPU nor a slow one stops looking altogether.
                self.lastAnalysisMs = elapsed * 1000
                self.interval = min(self.maxInterval, max(self.minInterval, elapsed / self.dutyCycle))
                self.framesAnalysed += 1
                self.rawDetections += candidates
                self.depthAvailable = hasDepth
                if hasDepth {
                    self.rejectedByGeometry += candidates - placed.count
                    let eye = SIMD3<Double>(
                        Double(transform.columns.3.x),
                        Double(transform.columns.3.y),
                        Double(transform.columns.3.z)
                    )
                    for (detection, geometry) in placed {
                        self.integrate(detection, geometry, eye: eye)
                    }
                } else {
                    // No depth: nothing can be measured, so bank the image point
                    // and ray-cast it against the polygon at the end.
                    for d in seen {
                        self.sightings.append(FixtureSighting(
                            cx: d.cx, cy: d.cy, score: d.score,
                            cameraTransform: transform, intrinsics: intrinsics,
                            imageWidth: width, imageHeight: height
                        ))
                    }
                }
                self.busy = false
            }
        }
    }

    // MARK: Glass and column evidence

    /// Bank a sparse grid of this frame's depth readings for `GlassFinder` and
    /// `PillarFinder`. Call from the main thread on every tick of the scan —
    /// detection running or not. It throttles itself.
    func bankDepth(frame: ARFrame) {
        guard frame.timestamp - lastDepthSample >= FixtureCapture.depthInterval else { return }
        // Raw depth, not smoothed: temporal smoothing paints over exactly the
        // holes a pane of glass leaves in it.
        guard let data = frame.sceneDepth ?? frame.smoothedSceneDepth else { return }
        lastDepthSample = frame.timestamp
        rays.append(contentsOf: FixtureCapture.sampleDepth(
            data,
            image: frame.capturedImage,
            intrinsics: frame.camera.intrinsics,
            cameraTransform: frame.camera.transform
        ))
        if rays.count > FixtureCapture.maxRays {
            rays = stride(from: 0, to: rays.count, by: 2).map { rays[$0] }
        }
    }

    /// Unproject a sparse grid of the depth map into world readings, each with
    /// its ARKit confidence and the camera's brightness at that spot.
    static func sampleDepth(
        _ data: ARDepthData,
        image: CVPixelBuffer,
        intrinsics: simd_float3x3,
        cameraTransform t: simd_float4x4
    ) -> [DepthSample] {
        let map = data.depthMap
        CVPixelBufferLockBaseAddress(map, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(map, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(map) else { return [] }
        let dw = CVPixelBufferGetWidth(map), dh = CVPixelBufferGetHeight(map)
        let dRow = CVPixelBufferGetBytesPerRow(map)
        let imageW = CVPixelBufferGetWidth(image), imageH = CVPixelBufferGetHeight(image)
        guard dw > 0, dh > 0, imageW > 0, imageH > 0 else { return [] }

        // Confidence is a parallel 8-bit map: 0 low, 1 medium, 2 high. Without
        // one, every reading is taken as measured.
        let cmap = data.confidenceMap
        if let cmap { CVPixelBufferLockBaseAddress(cmap, .readOnly) }
        defer { if let cmap { CVPixelBufferUnlockBaseAddress(cmap, .readOnly) } }
        let cBase = cmap.flatMap { CVPixelBufferGetBaseAddress($0) }
        let cw = cmap.map { CVPixelBufferGetWidth($0) } ?? 0
        let ch = cmap.map { CVPixelBufferGetHeight($0) } ?? 0
        let cRow = cmap.map { CVPixelBufferGetBytesPerRow($0) } ?? 0

        // Brightness straight from the luma plane of the camera image.
        CVPixelBufferLockBaseAddress(image, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(image, .readOnly) }
        let hasLuma = CVPixelBufferGetPlaneCount(image) >= 1
        let yBase = hasLuma ? CVPixelBufferGetBaseAddressOfPlane(image, 0) : nil
        let yw = hasLuma ? CVPixelBufferGetWidthOfPlane(image, 0) : 0
        let yh = hasLuma ? CVPixelBufferGetHeightOfPlane(image, 0) : 0
        let yRow = hasLuma ? CVPixelBufferGetBytesPerRowOfPlane(image, 0) : 0

        // Intrinsics are for the CAPTURED image; scale them to the depth map.
        let sx = Float(dw) / Float(imageW)
        let sy = Float(dh) / Float(imageH)
        let fx = intrinsics.columns.0.x * sx, fy = intrinsics.columns.1.y * sy
        let cx = intrinsics.columns.2.x * sx, cy = intrinsics.columns.2.y * sy
        guard fx > 0, fy > 0 else { return [] }
        let eye = SIMD3<Float>(t.columns.3.x, t.columns.3.y, t.columns.3.z)

        var out: [DepthSample] = []
        out.reserveCapacity(rayColumns * rayRows)
        for gy in 0..<rayRows {
            let py = (Float(gy) + 0.5) * Float(dh) / Float(rayRows)
            let iy = min(dh - 1, Int(py))
            let row = base.advanced(by: iy * dRow).assumingMemoryBound(to: Float32.self)
            for gx in 0..<rayColumns {
                let px = (Float(gx) + 0.5) * Float(dw) / Float(rayColumns)
                let ix = min(dw - 1, Int(px))
                var range = row[ix]
                var confidence: UInt8 = 2
                if let cBase, cw > 0, ch > 0 {
                    let cxi = min(cw - 1, ix * cw / dw), cyi = min(ch - 1, iy * ch / dh)
                    confidence = min(2, cBase.advanced(by: cyi * cRow).assumingMemoryBound(to: UInt8.self)[cxi])
                }
                if !(range.isFinite && range > 0) {
                    // No depth at all: nothing measurable along this line of sight.
                    range = noDepthM
                    confidence = 0
                } else if range <= 0.3 {
                    // Too close to say anything about a wall.
                    continue
                }
                // Camera space (x right, y up, looking down −z) → world.
                let local = SIMD4<Float>((px - cx) / fx * range, -(py - cy) / fy * range, -range, 1)
                let world = t * local

                // Mean of the 3x3 image pixels at the same spot.
                var luma: UInt8 = 0
                if let yBase, yw > 0, yh > 0 {
                    let ux = min(yw - 1, Int(px / Float(dw) * Float(yw)))
                    let uy = min(yh - 1, Int(py / Float(dh) * Float(yh)))
                    var sum = 0, n = 0
                    for yy in max(0, uy - 1)...min(yh - 1, uy + 1) {
                        let line = yBase.advanced(by: yy * yRow).assumingMemoryBound(to: UInt8.self)
                        for xx in max(0, ux - 1)...min(yw - 1, ux + 1) {
                            sum += Int(line[xx])
                            n += 1
                        }
                    }
                    luma = UInt8(min(255, sum / max(1, n)))
                }
                out.append(DepthSample(
                    eye: eye,
                    hit: SIMD3<Float>(world.x, world.y, world.z),
                    confidence: confidence,
                    luma: luma
                ))
            }
        }
        return out
    }

    // MARK: Tracking

    /// Fold one measured detection into the running set of tracks.
    private func integrate(_ detection: SocketDetection, _ geometry: PlateGeometry, eye: SIMD3<Double>) {
        // The user has already ruled on this spot; do not re-litigate it.
        if rejected.contains(where: { simd_distance($0, geometry.world) < FixtureCapture.mergeM * 2 }) {
            return
        }
        let w = FixtureCapture.lookWeight(geometry.rangeM)
        // Nearest, so a sighting between two sockets side by side joins the one
        // it is actually on rather than whichever was created first.
        if let index = nearestTrack(to: geometry.world, normal: geometry.normal) {
            var track = tracks[index]
            // Weighted running mean (see `SocketTrack.weight`). A hand-placed
            // pin is where the person said it is; a detection only
            // corroborates it.
            if !track.manual {
                let total = track.weight
                let k = 1 / (total + w)
                track.world = (track.world * total + geometry.world * w) * k
                track.normal = simd_normalize(track.normal * total + geometry.normal * w)
                track.widthMm = (track.widthMm * total + geometry.widthMm * w) * k
                track.heightMm = (track.heightMm * total + geometry.heightMm * w) * k
                track.weight = total + w
            }
            track.score = max(track.score, detection.score)
            // Classification comes from the closest look, not the average.
            if detection.platePx > track.bestPlatePx {
                track.bestPlatePx = detection.platePx
                track.bestFeatures = detection.holes
            }
            track.hits += 1
            if track.viewpoints.count < 12 { track.viewpoints.append(eye) }
            track.baselineM = FixtureCapture.spread(track.viewpoints)
            tracks[index] = track
            numberIfConfirmed(index)
            return
        }

        tracks.append(SocketTrack(
            id: nextTrackID,
            world: geometry.world,
            normal: geometry.normal,
            widthMm: geometry.widthMm,
            heightMm: geometry.heightMm,
            score: detection.score,
            hits: 1,
            baselineM: 0,
            viewpoints: [eye],
            bestFeatures: detection.holes,
            bestPlatePx: detection.platePx,
            weight: w
        ))
        nextTrackID += 1
    }

    /// Looks closer than this are weighted as if taken from here.
    private static let minWeightRangeM = 0.3

    /// Inverse-variance weight of one look: its error grows with range.
    static func lookWeight(_ rangeM: Double) -> Double {
        let r = max(rangeM, minWeightRangeM)
        return 1 / (r * r)
    }

    /// Index of the NEAREST track a point could belong to, if any.
    private func nearestTrack(to world: SIMD3<Double>, normal: SIMD3<Double>) -> Int? {
        var best: (index: Int, distance: Double)?
        for (i, t) in tracks.enumerated() {
            let d = simd_distance(t.world, world)
            guard d < FixtureCapture.mergeM, simd_dot(t.normal, normal) > FixtureCapture.mergeNormalDot else { continue }
            if best == nil || d < best!.distance { best = (i, d) }
        }
        return best?.index
    }

    /// Give a track that has just confirmed the next free display number.
    private func numberIfConfirmed(_ index: Int) {
        guard tracks.indices.contains(index), tracks[index].number == 0, tracks[index].confirmed else { return }
        tracks[index].number = (tracks.map(\.number).max() ?? 0) + 1
    }

    // MARK: Manual placement

    /// Pin a socket where the user pointed.
    ///
    /// Confirmed on arrival, and merged with a nearby automatic track rather
    /// than sitting on top of it — tapping a socket the detector had already
    /// half-found should promote that one, not leave a duplicate beside it.
    ///
    /// The merge test is EXACTLY the automatic one, and deliberately so. A
    /// looser radius here would reach the socket next door: two single-gang
    /// outlets sit ~140mm apart, so tapping the right-hand one would find the
    /// left-hand track, drag it across, and leave one socket where there were
    /// two. The same distance separates sockets on the two walls of an internal
    /// corner, which is why the normal has to agree as well.
    @discardableResult
    func addManual(world: SIMD3<Double>, normal: SIMD3<Double>) -> Int {
        rejected.removeAll { simd_distance($0, world) < FixtureCapture.mergeM * 2 }
        if let index = nearestTrack(to: world, normal: normal) {
            tracks[index].world = world
            tracks[index].normal = normal
            tracks[index].manual = true
            numberIfConfirmed(index)
            return tracks[index].id
        }
        let id = nextTrackID
        tracks.append(SocketTrack(
            id: id,
            world: world,
            normal: normal,
            widthMm: 86,
            heightMm: 86,
            score: 1,
            hits: 1,
            baselineM: 0,
            viewpoints: [],
            bestFeatures: 0,
            bestPlatePx: 0,
            manual: true
        ))
        nextTrackID += 1
        numberIfConfirmed(tracks.count - 1)
        return id
    }

    /// Drop a track the user rejected, and remember that they did.
    func remove(id: Int) {
        guard let track = tracks.first(where: { $0.id == id }) else { return }
        tracks.removeAll { $0.id == id }
        rejected.append(track.world)
        // Bounded like `viewpoints`: a scan cannot accumulate rejections without
        // limit, and the oldest matter least.
        if rejected.count > 64 { rejected.removeFirst(rejected.count - 64) }
    }

    /// Widest separation within a set of camera positions.
    private static func spread(_ points: [SIMD3<Double>]) -> Double {
        guard points.count > 1 else { return 0 }
        var best = 0.0
        for i in 0..<(points.count - 1) {
            for j in (i + 1)..<points.count {
                best = max(best, simd_distance(points[i], points[j]))
            }
        }
        return best
    }

    // MARK: Pixel buffer → luminance

    /// Read the Y (luma) plane straight out of ARKit's biplanar YCbCr buffer.
    ///
    /// No colour conversion is needed: plane 0 IS the grayscale image the
    /// detector wants. Sub-sampling happens during the copy so we never allocate
    /// a full-resolution Float array.
    static func luminance(from buffer: CVPixelBuffer, maxDim: Int) -> GrayImage? {
        guard CVPixelBufferGetPlaneCount(buffer) >= 1 else { return nil }
        CVPixelBufferLockBaseAddress(buffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }

        guard let base = CVPixelBufferGetBaseAddressOfPlane(buffer, 0) else { return nil }
        let srcW = CVPixelBufferGetWidthOfPlane(buffer, 0)
        let srcH = CVPixelBufferGetHeightOfPlane(buffer, 0)
        let rowBytes = CVPixelBufferGetBytesPerRowOfPlane(buffer, 0)
        guard srcW > 0, srcH > 0 else { return nil }

        let longest = max(srcW, srcH)
        let scale = longest > maxDim ? Double(maxDim) / Double(longest) : 1.0
        let w = max(1, Int((Double(srcW) * scale).rounded()))
        let h = max(1, Int((Double(srcH) * scale).rounded()))

        let src = base.assumingMemoryBound(to: UInt8.self)
        var pixels = [Float](repeating: 0, count: w * h)

        // Take the DARKEST source pixel each output pixel covers, not the mean.
        //
        // The detector keys on small dark features inside a bright plate.
        // Averaging a block blends a thin pin slot with the faceplate beside it
        // and washes the slot out — precisely the feature we need — while a
        // minimum keeps it at full strength. The wall itself is smooth, so its
        // local mean barely moves; the contrast the threshold sees therefore
        // goes UP, and slots survive at distances where averaging erases them.
        // Block boundaries computed ONCE per axis rather than twice per output
        // pixel. At a megapixel of output that is a couple of million floating
        // point multiplies saved on every analysed frame, for two small arrays.
        var xs = [Int](repeating: 0, count: w + 1)
        for x in 0...w { xs[x] = min(srcW, x * srcW / w) }
        var ys = [Int](repeating: 0, count: h + 1)
        for y in 0...h { ys[y] = min(srcH, y * srcH / h) }

        for y in 0..<h {
            let y0 = min(srcH - 1, ys[y])
            let y1 = max(y0 + 1, ys[y + 1])
            for x in 0..<w {
                let x0 = min(srcW - 1, xs[x])
                let x1 = max(x0 + 1, xs[x + 1])
                var darkest = 255
                for sy in y0..<y1 {
                    let row = src + sy * rowBytes
                    for sx in x0..<x1 {
                        let v = Int(row[sx])
                        if v < darkest { darkest = v }
                    }
                }
                pixels[y * w + x] = Float(darkest)
            }
        }
        return GrayImage(pixels: pixels, width: w, height: h)
    }
}
