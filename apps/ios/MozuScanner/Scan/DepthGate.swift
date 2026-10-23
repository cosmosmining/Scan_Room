// Ask the LiDAR whether a bright rectangle is actually a socket.
//
// The image detector answers "is there a plate-shaped bright block here?" — a
// question a shadow, a poster, a laundry bottle and a patch of sunlit drywall
// can all answer yes to. This asks the questions only geometry can settle:
//
//   * How BIG is it, in millimetres? A faceplate is 45–260mm. Nothing else on
//     this list is.
//   * Is it ON a wall? Fit the surrounding surface and check the candidate sits
//     in that plane rather than a metre in front of it (a box on a dresser) or
//     across a depth cliff (empty space beyond a corner).
//   * Is that surface FLAT and VERTICAL? Floors, worktops and crumpled fabric
//     are excluded by construction, not by luck.
//   * WHERE is it, in world coordinates? A metric 3D point, taken straight from
//     the depth map — not a ray guessed at a polygon that will not exist until
//     the scan ends.
//
// That last one is why placement drifted before: sockets were stored as image
// points and re-derived at the end by intersecting a ray with the finished
// floor polygon, so every degree of pose error became centimetres on the plan.
// A depth sample is the position, measured once, at the moment of seeing.
//
// The plane fit exploits a small piece of projective geometry: for any planar
// surface, 1/depth is EXACTLY linear in image coordinates. So the wall around a
// candidate is a plain 3-unknown least squares on 1/d — no iteration, no
// eigenvectors, and the residual comes out in millimetres of real deviation.

import ARKit
import CoreGraphics
import CoreVideo
import Foundation
import simd

/// A depth map copied out of ARKit, with low-confidence samples already dropped.
///
/// Copied rather than referenced because ARKit recycles its buffers: holding an
/// `ARDepthData` across an async hop starves the capture pool. At 256x192 this
/// is under 200KB, so the copy costs nothing worth measuring.
struct DepthFrame {
    /// Metres; 0 means "no usable reading here".
    var depth: [Float]
    var width: Int
    var height: Int

    @inline(__always)
    func at(_ x: Int, _ y: Int) -> Float {
        guard x >= 0, y >= 0, x < width, y < height else { return 0 }
        return depth[y * width + x]
    }
}

/// What the depth map says about one candidate faceplate.
struct PlateGeometry {
    /// Plate centre in ARKit world coordinates (metres).
    var world: SIMD3<Double>
    /// Wall normal in world coordinates, pointing into the room.
    var normal: SIMD3<Double>
    var widthMm: Double
    var heightMm: Double
    /// How far the candidate sits off the plane of the wall around it (mm).
    var standoffMm: Double
    /// RMS deviation of that surrounding wall from a perfect plane (mm).
    var flatnessMm: Double
    /// Distance from the camera (metres).
    var rangeM: Double
}

enum DepthGate {

    // MARK: Physical limits

    /// A faceplate's smaller side. UK single gang is 86mm, US duplex ~70mm;
    /// below 45mm nothing electrical exists, and blur only ever inflates.
    static let minSideMm = 45.0
    /// The larger side. Quad-gang plates reach ~220mm; 260 leaves margin for
    /// the bright halo around a white plate on a dim wall.
    static let maxSideMm = 260.0
    /// How far off the surrounding wall plane a real plate can read. LiDAR at
    /// this resolution cannot see a 6mm proudness, so this is not measuring the
    /// plate — it is rejecting candidates that are not on the wall at all.
    static let maxStandoffMm = 120.0
    /// RMS flatness of the wall around the candidate. Drywall at 3m reads
    /// ~10-20mm of noise; beyond this it is clutter, fabric or a depth cliff.
    static let maxFlatnessMm = 35.0
    /// |normal.y| — a wall is vertical. 0.42 is ~25° of tolerance, which covers
    /// pose noise without admitting a worktop or a floor.
    static let maxVerticalComponent = 0.42
    static let minRangeM = 0.22
    static let maxRangeM = 6.5
    /// Fewer wall samples than this and there is nothing to call a plane.
    static let minWallSamples = 12
    /// …and they must be most of what was actually there.
    ///
    /// The ±600mm filter that keeps the fit on one surface has a sharp edge: a
    /// candidate at a depth CLIFF has its far side removed entirely, leaving a
    /// clean near-side plane that fits beautifully and means nothing. Requiring
    /// the survivors to be a majority of the readings turns "I discarded most of
    /// this patch" from a silent success into the rejection it should be.
    static let minWallCoverage = 0.55

    // MARK: Snapshot

    /// The depth to use for a frame. `smoothedSceneDepth` is preferred: it is
    /// temporally filtered, and a socket is stationary, so the filtering is pure
    /// gain here. Nil on a device (or session) without scene depth.
    static func depthData(for frame: ARFrame) -> ARDepthData? {
        frame.smoothedSceneDepth ?? frame.sceneDepth
    }

    /// Copy ARKit's depth map, keeping only samples ARKit is confident about.
    ///
    /// Takes the `ARDepthData` rather than the frame so the caller can hand off
    /// just the buffers it needs and let ARKit recycle the frame immediately.
    static func snapshot(_ data: ARDepthData) -> DepthFrame? {
        let map = data.depthMap
        CVPixelBufferLockBaseAddress(map, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(map, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(map) else { return nil }

        let w = CVPixelBufferGetWidth(map)
        let h = CVPixelBufferGetHeight(map)
        let rowBytes = CVPixelBufferGetBytesPerRow(map)
        guard w > 0, h > 0 else { return nil }

        // Confidence is a parallel 8-bit map: 0 low, 1 medium, 2 high. Low
        // readings are mostly edges and dark/specular surfaces — exactly where a
        // plane fit goes wrong — so they are dropped rather than weighted.
        var out = [Float](repeating: 0, count: w * h)

        if let cmap = data.confidenceMap {
            CVPixelBufferLockBaseAddress(cmap, .readOnly)
            defer { CVPixelBufferUnlockBaseAddress(cmap, .readOnly) }
            let cw = CVPixelBufferGetWidth(cmap)
            let ch = CVPixelBufferGetHeight(cmap)
            let crow = CVPixelBufferGetBytesPerRow(cmap)
            if let cbase = CVPixelBufferGetBaseAddress(cmap), cw > 0, ch > 0 {
                let confidence = cbase.assumingMemoryBound(to: UInt8.self)
                for y in 0..<h {
                    let row = base.advanced(by: y * rowBytes).assumingMemoryBound(to: Float32.self)
                    let cy = min(ch - 1, y * ch / h)
                    for x in 0..<w {
                        let d = row[x]
                        guard d.isFinite, d > 0 else { continue }
                        let cx = min(cw - 1, x * cw / w)
                        guard confidence[cy * crow + cx] != 0 else { continue }
                        out[y * w + x] = d
                    }
                }
                return DepthFrame(depth: out, width: w, height: h)
            }
        }

        for y in 0..<h {
            let row = base.advanced(by: y * rowBytes).assumingMemoryBound(to: Float32.self)
            for x in 0..<w {
                let d = row[x]
                if d.isFinite, d > 0 { out[y * w + x] = d }
            }
        }
        return DepthFrame(depth: out, width: w, height: h)
    }

    // MARK: Measurement

    /// Measure one detection against the depth map, or reject it.
    ///
    /// - Parameters:
    ///   - detection: box normalised 0…1 against the captured image, origin top-left.
    ///   - depth: the snapshot for the same frame.
    ///   - intrinsics: for the CAPTURED image (scaled internally to depth space).
    ///   - imageSize: captured image size in pixels.
    ///   - cameraTransform: ARKit camera pose for the frame.
    static func measure(
        _ detection: SocketDetection,
        depth: DepthFrame,
        intrinsics: simd_float3x3,
        imageSize: (width: Int, height: Int),
        cameraTransform: simd_float4x4
    ) -> PlateGeometry? {
        guard depth.width > 8, depth.height > 8,
              imageSize.width > 0, imageSize.height > 0 else { return nil }

        let fxImage = Double(intrinsics.columns.0.x)
        let fyImage = Double(intrinsics.columns.1.y)
        guard fxImage > 1, fyImage > 1 else { return nil }

        // Intrinsics scaled from captured-image pixels to depth-map pixels. The
        // depth map covers the same field of view, so this is a pure ratio.
        let sx = Double(depth.width) / Double(imageSize.width)
        let sy = Double(depth.height) / Double(imageSize.height)
        let fx = fxImage * sx
        let fy = fyImage * sy
        let cx = Double(intrinsics.columns.2.x) * sx
        let cy = Double(intrinsics.columns.2.y) * sy

        // The detection box, in depth-map pixels.
        let bcx = detection.cx * Double(depth.width)
        let bcy = detection.cy * Double(depth.height)
        let bw = max(1.0, detection.w * Double(depth.width))
        let bh = max(1.0, detection.h * Double(depth.height))

        // How far away is the plate itself? Median of the inner patch, so a
        // single stray reading on the plate edge cannot move it.
        guard let plateDepth = medianDepth(
            depth,
            cx: bcx, cy: bcy,
            halfW: max(0.5, bw * 0.3), halfH: max(0.5, bh * 0.3)
        ) else { return nil }
        guard plateDepth >= minRangeM, plateDepth <= maxRangeM else { return nil }

        // The wall AROUND the plate: an annulus wide enough to be wall, near
        // enough to be the same wall.
        var samples: [(u: Double, v: Double, r: Double)] = []
        var available = 0
        let inner = (w: bw * 0.75, h: bh * 0.75)
        let outer = (w: max(bw * 2.1, bw + 6), h: max(bh * 2.1, bh + 6))
        let x0 = max(0, Int((bcx - outer.w).rounded(.down)))
        let x1 = min(depth.width - 1, Int((bcx + outer.w).rounded(.up)))
        let y0 = max(0, Int((bcy - outer.h).rounded(.down)))
        let y1 = min(depth.height - 1, Int((bcy + outer.h).rounded(.up)))
        guard x0 <= x1, y0 <= y1 else { return nil }
        for y in y0...y1 {
            for x in x0...x1 {
                let dx = abs(Double(x) - bcx), dy = abs(Double(y) - bcy)
                if dx <= inner.w && dy <= inner.h { continue }      // inside/near the plate
                let d = depth.at(x, y)
                guard d > 0 else { continue }
                available += 1
                // Anything wildly nearer or further is a different surface; it
                // must not be allowed to drag the plane fit.
                guard abs(Double(d) - plateDepth) < 0.6 else { continue }
                samples.append((u: Double(x), v: Double(y), r: 1.0 / Double(d)))
            }
        }
        guard samples.count >= minWallSamples else { return nil }
        guard Double(samples.count) >= Double(available) * minWallCoverage else { return nil }

        // 1/d = A*u + B*v + C, exact for a plane. Ordinary least squares.
        guard let fit = solvePlane(samples) else { return nil }

        // Residuals back in metres, then millimetres — a real physical flatness.
        var sumSq = 0.0
        for s in samples {
            let predicted = fit.a * s.u + fit.b * s.v + fit.c
            guard predicted > 1e-6 else { return nil }
            let error = (1.0 / predicted) - (1.0 / s.r)
            sumSq += error * error
        }
        let flatnessMm = (sumSq / Double(samples.count)).squareRoot() * 1000
        guard flatnessMm <= maxFlatnessMm else { return nil }

        // Is the candidate in that plane, or floating off it?
        let predictedAtPlate = fit.a * bcx + fit.b * bcy + fit.c
        guard predictedAtPlate > 1e-6 else { return nil }
        let wallDepth = 1.0 / predictedAtPlate
        let standoffMm = (wallDepth - plateDepth) * 1000
        guard abs(standoffMm) <= maxStandoffMm else { return nil }

        // Plane normal in camera space, straight from the fit coefficients.
        var normalCamera = SIMD3<Double>(
            fit.a * fx,
            -fit.b * fy,
            -(fit.c + fit.a * cx + fit.b * cy)
        )
        let normalLength = simd_length(normalCamera)
        guard normalLength > 1e-9 else { return nil }
        normalCamera /= normalLength
        // Point it back towards the camera (a surface we can see faces us).
        if normalCamera.z < 0 { normalCamera = -normalCamera }

        // Physical size, measured in CAPTURED-image pixels (far finer than the
        // depth map) at the plate's measured distance.
        let widthMm = detection.w * Double(imageSize.width) * plateDepth / fxImage * 1000
        let heightMm = detection.h * Double(imageSize.height) * plateDepth / fyImage * 1000
        let shortSide = min(widthMm, heightMm), longSide = max(widthMm, heightMm)
        guard shortSide >= minSideMm, longSide <= maxSideMm else { return nil }

        // Camera space → world.
        let pointCamera = SIMD3<Double>(
            (bcx - cx) / fx * plateDepth,
            -(bcy - cy) / fy * plateDepth,
            -plateDepth
        )
        let t = cameraTransform
        let rotation = simd_double3x3(
            SIMD3<Double>(Double(t.columns.0.x), Double(t.columns.0.y), Double(t.columns.0.z)),
            SIMD3<Double>(Double(t.columns.1.x), Double(t.columns.1.y), Double(t.columns.1.z)),
            SIMD3<Double>(Double(t.columns.2.x), Double(t.columns.2.y), Double(t.columns.2.z))
        )
        let world = rotation * pointCamera + SIMD3<Double>(
            Double(t.columns.3.x), Double(t.columns.3.y), Double(t.columns.3.z)
        )
        let normalWorld = simd_normalize(rotation * normalCamera)

        // A socket is on a VERTICAL surface. This is what stops the detector
        // labelling floors, worktops and the tops of boxes.
        guard abs(normalWorld.y) <= maxVerticalComponent else { return nil }

        return PlateGeometry(
            world: world,
            normal: normalWorld,
            widthMm: widthMm,
            heightMm: heightMm,
            standoffMm: standoffMm,
            flatnessMm: flatnessMm,
            rangeM: plateDepth
        )
    }

    // MARK: Probing a point (tap-to-place)

    /// The surface under a single image point: where it is and which way it faces.
    struct SurfacePoint {
        var world: SIMD3<Double>
        var normal: SIMD3<Double>
        var rangeM: Double
        var flatnessMm: Double
    }

    /// Measure whatever surface lies under one normalised image point.
    ///
    /// The same machinery as `measure`, minus the questions that only apply to
    /// a candidate the detector proposed. A user pointing at a socket has
    /// already answered "is this a socket?"; all that is being asked here is
    /// "where is the wall you are pointing at, and which way does it face?", so
    /// there is no size, standoff or verticality test — the caller decides what
    /// to do with the answer.
    static func surface(
        atNormalised point: CGPoint,
        depth: DepthFrame,
        intrinsics: simd_float3x3,
        imageSize: (width: Int, height: Int),
        cameraTransform: simd_float4x4
    ) -> SurfacePoint? {
        guard depth.width > 8, depth.height > 8,
              imageSize.width > 0, imageSize.height > 0,
              point.x.isFinite, point.y.isFinite else { return nil }

        let fxImage = Double(intrinsics.columns.0.x)
        let fyImage = Double(intrinsics.columns.1.y)
        guard fxImage > 1, fyImage > 1 else { return nil }

        let sx = Double(depth.width) / Double(imageSize.width)
        let sy = Double(depth.height) / Double(imageSize.height)
        let fx = fxImage * sx, fy = fyImage * sy
        let cx = Double(intrinsics.columns.2.x) * sx
        let cy = Double(intrinsics.columns.2.y) * sy

        let px = Double(point.x) * Double(depth.width)
        let py = Double(point.y) * Double(depth.height)

        // A patch big enough to fit a plane to, small enough to stay on one wall.
        let probe = max(3.0, Double(min(depth.width, depth.height)) * 0.05)
        guard let centreDepth = medianDepth(depth, cx: px, cy: py, halfW: 2, halfH: 2) else { return nil }
        guard centreDepth >= minRangeM, centreDepth <= maxRangeM else { return nil }

        var samples: [(u: Double, v: Double, r: Double)] = []
        var available = 0
        let x0 = max(0, Int((px - probe).rounded(.down)))
        let x1 = min(depth.width - 1, Int((px + probe).rounded(.up)))
        let y0 = max(0, Int((py - probe).rounded(.down)))
        let y1 = min(depth.height - 1, Int((py + probe).rounded(.up)))
        guard x0 <= x1, y0 <= y1 else { return nil }
        for y in y0...y1 {
            for x in x0...x1 {
                let d = depth.at(x, y)
                guard d > 0 else { continue }
                available += 1
                guard abs(Double(d) - centreDepth) < 0.4 else { continue }
                samples.append((u: Double(x), v: Double(y), r: 1.0 / Double(d)))
            }
        }
        guard samples.count >= minWallSamples,
              Double(samples.count) >= Double(available) * minWallCoverage,
              let fit = solvePlane(samples) else { return nil }

        var sumSq = 0.0
        for s in samples {
            let predicted = fit.a * s.u + fit.b * s.v + fit.c
            guard predicted > 1e-6 else { return nil }
            let error = (1.0 / predicted) - (1.0 / s.r)
            sumSq += error * error
        }
        let flatnessMm = (sumSq / Double(samples.count)).squareRoot() * 1000

        var normalCamera = SIMD3<Double>(
            fit.a * fx,
            -fit.b * fy,
            -(fit.c + fit.a * cx + fit.b * cy)
        )
        let normalLength = simd_length(normalCamera)
        guard normalLength > 1e-9 else { return nil }
        normalCamera /= normalLength
        if normalCamera.z < 0 { normalCamera = -normalCamera }

        let pointCamera = SIMD3<Double>(
            (px - cx) / fx * centreDepth,
            -(py - cy) / fy * centreDepth,
            -centreDepth
        )
        let t = cameraTransform
        let rotation = simd_double3x3(
            SIMD3<Double>(Double(t.columns.0.x), Double(t.columns.0.y), Double(t.columns.0.z)),
            SIMD3<Double>(Double(t.columns.1.x), Double(t.columns.1.y), Double(t.columns.1.z)),
            SIMD3<Double>(Double(t.columns.2.x), Double(t.columns.2.y), Double(t.columns.2.z))
        )
        let world = rotation * pointCamera + SIMD3<Double>(
            Double(t.columns.3.x), Double(t.columns.3.y), Double(t.columns.3.z)
        )
        return SurfacePoint(
            world: world,
            normal: simd_normalize(rotation * normalCamera),
            rangeM: centreDepth,
            flatnessMm: flatnessMm
        )
    }

    // MARK: Internals

    /// Median depth over a small rectangle, ignoring holes.
    private static func medianDepth(
        _ depth: DepthFrame, cx: Double, cy: Double, halfW: Double, halfH: Double
    ) -> Double? {
        let x0 = max(0, Int((cx - halfW).rounded(.down)))
        let x1 = min(depth.width - 1, Int((cx + halfW).rounded(.up)))
        let y0 = max(0, Int((cy - halfH).rounded(.down)))
        let y1 = min(depth.height - 1, Int((cy + halfH).rounded(.up)))
        guard x0 <= x1, y0 <= y1 else { return nil }
        var values: [Double] = []
        for y in y0...y1 {
            for x in x0...x1 {
                let d = depth.at(x, y)
                if d > 0 { values.append(Double(d)) }
            }
        }
        guard !values.isEmpty else { return nil }
        values.sort()
        return values[values.count / 2]
    }

    /// Least-squares solve of r = a*u + b*v + c over the samples.
    private static func solvePlane(
        _ samples: [(u: Double, v: Double, r: Double)]
    ) -> (a: Double, b: Double, c: Double)? {
        var suu = 0.0, suv = 0.0, svv = 0.0, su = 0.0, sv = 0.0
        var sur = 0.0, svr = 0.0, sr = 0.0
        let n = Double(samples.count)
        for s in samples {
            suu += s.u * s.u; suv += s.u * s.v; svv += s.v * s.v
            su += s.u; sv += s.v
            sur += s.u * s.r; svr += s.v * s.r; sr += s.r
        }
        // 3x3 normal equations, solved by Cramer's rule.
        let m = simd_double3x3(
            SIMD3<Double>(suu, suv, su),
            SIMD3<Double>(suv, svv, sv),
            SIMD3<Double>(su, sv, n)
        )
        let det = m.determinant
        // Samples spread over a 2D patch give a well-conditioned system; a
        // degenerate one (all collinear) does not, and must not be trusted.
        guard abs(det) > 1e-9 else { return nil }
        let rhs = SIMD3<Double>(sur, svr, sr)
        let solution = m.inverse * rhs
        guard solution.x.isFinite, solution.y.isFinite, solution.z.isFinite else { return nil }
        return (solution.x, solution.y, solution.z)
    }
}
