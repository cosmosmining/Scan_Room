// Socket detection, on device.
//
// A faithful Swift port of the detector in `src/systems/scan/fixtureDetector.ts`
// — same pipeline, same constants, same rejections — so the iPad finds exactly
// what the web app finds.
//
// What it looks for was learned the hard way on device. The first version keyed
// on "a cluster of dark pin slots" and drowned in the real world: cable
// shadows, scuffs and dark trim make slot-sized dark specks everywhere (157
// phantom sockets in 50 frames on one wall) while the real outlet sat unboxed.
// The reliable signature is the one a person uses: a socket is a WHITE LITTLE
// BLOCK on the wall — a bright, solid, plate-sized rectangle — with a few small
// dark features inside it (pin slots, a ground hole, a rocker seam). The plate
// is the detection; the dark features only confirm the bright rectangle is
// electrical rather than a sticker.
//
// Pure Foundation: no ARKit, no Vision, no model download. It runs on the
// camera frames RoomPlan is already producing, and it is a CANDIDATE detector —
// wrong boxes are deleted with a tap on the plan.

import Foundation

/// A detected socket. The box frames the faceplate, normalised (0…1) against
/// the image it came from, origin top-left — matching the web detector.
struct SocketDetection: Equatable {
    var cx: Double
    var cy: Double
    var w: Double
    var h: Double
    /// Confidence, 0…1.
    var score: Double
    /// Dark features (slots / holes / seams) confirming the plate.
    var holes: Int
    /// Shorter side of the plate box in ANALYSIS pixels. Carried because it is
    /// the honest measure of whether those features could have been resolved at
    /// all — which is what makes `holes` usable for telling a power outlet from
    /// a coax plate, and useless beyond a couple of metres.
    var platePx: Double
}

/// What the dark features say a plate is.
///
/// Slot counting only means something when the slots are RESOLVABLE. A 4mm slot
/// on an 86mm plate is under 5% of the plate's width, so below roughly 42
/// analysis pixels there is nothing to count and any classification would be
/// invention. Then the answer is `.unknown`, and the caller treats it as power —
/// the conservative choice, because under-reporting a power socket is the
/// failure that puts a cabinet over live wiring.
enum PlateKind {
    case power
    case data
    case blank
    case unknown

    /// Analysis-pixel plate size below which pin slots cannot be resolved.
    static let resolvablePx = 42.0

    static func classify(features: Int, platePx: Double) -> PlateKind {
        guard platePx >= resolvablePx else { return .unknown }
        if features >= 3 { return .power }
        if features >= 1 { return .data }
        return .blank
    }

    /// How this lands in the shared `RoomScan` contract. A data or switch plate
    /// is labelled as such rather than discarded: a cabinet must not seal that
    /// either, so losing it would trade one wrong answer for another.
    var fixtureKind: ScanFixture.Kind {
        switch self {
        case .data: return .switch
        case .power, .blank, .unknown: return .socket
        }
    }
}

/// A single-channel image (luminance), the form every detector input takes.
struct GrayImage {
    var pixels: [Float]
    var width: Int
    var height: Int

    init(pixels: [Float], width: Int, height: Int) {
        self.pixels = pixels
        self.width = width
        self.height = height
    }
}

enum SocketDetector {

    // MARK: Tuning (kept identical to the TypeScript detector)

    /// Mask threshold — deliberately inclusive; the per-candidate tiers below
    /// make the real decision.
    static let brightDelta: Float = 8
    /// At this contrast a plate needs only one confirming feature.
    static let strongContrast = 12.0
    /// Below strongContrast, this many features are required instead.
    static let weakMinFeatures = 2
    /// Blank SEALED covers — junction lids, blanking plates, sealed outlets —
    /// are white blocks with no dark features, and they matter exactly like
    /// sockets. Accepted without features under stricter rules, because a
    /// featureless bright rectangle is also what paper looks like.
    static let blankMinContrast = 16.0
    static let blankMinSolidity = 0.78
    static let blankMaxSideFrac = 0.28
    static let blankMinAspect = 0.5
    static let blankMaxAspect = 2.0
    /// Local-mean window radius as a fraction of the short image side. Must stay
    /// comfortably larger than a plate, or the plate dominates its own reference
    /// and cancels the very contrast being measured.
    static let wallWindow = 0.3
    /// Non-max suppression overlap. Deliberately NOT lowered — see the note at
    /// the suppression loop.
    static let nmsIoU = 0.3
    /// Structuring-element radius for the opening that separates plates from
    /// whatever is attached to them, as a fraction of the SMALLEST acceptable
    /// plate. Tied to plate size rather than image size because the question is
    /// physical: "is this narrower than any faceplate could be?"
    static let openRadiusFrac = 0.28
    /// Plate size limits relative to the short image side.
    static let minPlateSideFrac = 0.02
    static let maxPlateSideFrac = 0.42
    /// Bounding-box aspect (w/h): single-gang portrait ~0.6 through double-gang
    /// landscape ~1.7, with margin for perspective.
    static let minAspect = 0.28
    static let maxAspect = 3.0
    /// A faceplate fills its bounding box; a cable curve or an outline does not.
    static let minSolidity = 0.55
    /// Interior features must be clearly darker than the plate.
    static let darkFeatureDelta = 28.0
    /// Feature blobs of at least this many pixels count (screws, slots, seams).
    static let minFeatureArea = 2
    /// More dark blobs than this is printed matter or a vent, not a socket.
    static let maxFeatures = 24
    /// Dark interior beyond this fraction is a picture frame, not a faceplate.
    static let maxDarkFraction = 0.42

    // MARK: Entry point

    /// Detect socket faceplates in one frame.
    ///
    /// Pipeline: downscale → bright mask (pixels notably brighter than the broad
    /// local wall) → connected components → keep solid, plate-sized, plate-shaped
    /// rectangles away from the frame border → confirm with a few small dark
    /// interior features → score → non-max suppress.
    static func detect(_ image: GrayImage, maxDim: Int = 640, minScore: Double = 0.35) -> [SocketDetection] {
        let scaled = downscale(image, maxDim: maxDim)
        let w = scaled.width, h = scaled.height
        guard w >= 16, h >= 16 else { return [] }
        let g = scaled.pixels

        let integral = makeIntegral(g, w, h)
        let minDim = min(w, h)
        let rWall = max(8, Int((Double(minDim) * wallWindow).rounded()))

        // The faceplate is a light block against the wall.
        var bright = [Bool](repeating: false, count: w * h)
        for y in 0..<h {
            for x in 0..<w {
                let i = y * w + x
                if g[i] > boxMean(integral, w, h, x, y, rWall) + brightDelta { bright[i] = true }
            }
        }

        let minSide = max(6, Int((Double(minDim) * minPlateSideFrac).rounded()))
        let maxSide = Int((Double(minDim) * maxPlateSideFrac).rounded())

        // Sever everything thinner than a plate before segmenting.
        //
        // This is the fix for the socket that is IN USE. A white plug in a white
        // outlet, and the cord running away from it, are all "brighter than the
        // wall", so they join the faceplate into one connected component that
        // snakes off across the room. Its bounding box is then far too big to be
        // a plate and the socket is thrown away — while the untouched coax plate
        // beside it is found perfectly. That is exactly the field failure: a
        // marker on the data plate and nothing on the outlet next to it.
        //
        // An opening (erode, then dilate) with an element a fraction of the
        // smallest acceptable plate deletes anything narrower and restores
        // everything wider, so the cord vanishes and the plate returns its own
        // size. Bright cables and highlight streaks on trim go the same way.
        let openR = max(1, Int((Double(minSide) * openRadiusFrac).rounded()))
        let segmentation = opened(bright, w, h, openR)

        var detections: [SocketDetection] = []
        for p in components(segmentation, w, h) {
            let bw = p.maxx - p.minx + 1
            let bh = p.maxy - p.miny + 1
            if min(bw, bh) < minSide || max(bw, bh) > maxSide { continue }
            // A plate cut by the frame edge reads as a strip; it will be seen
            // whole in another frame of the walk, so skip rather than misjudge.
            if p.minx == 0 || p.miny == 0 || p.maxx == w - 1 || p.maxy == h - 1 { continue }
            let aspect = Double(bw) / Double(bh)
            if aspect < minAspect || aspect > maxAspect { continue }
            // Fill measured on the ORIGINAL mask: the opening is for cutting the
            // region out, not for deciding how solid it is. Judging solidity on
            // the opened mask would penalise a plate for having pin slots.
            let solidity = maskFill(bright, w, p.minx, p.miny, p.maxx, p.maxy)
            if solidity < minSolidity { continue }

            let plateMean = rectMean(integral, w, p.minx, p.miny, p.maxx + 1, p.maxy + 1)
            // Contrast against the wall well beyond the plate.
            let cx = (p.minx + p.maxx) / 2
            let cy = (p.miny + p.maxy) / 2
            let wallMean = Double(boxMean(integral, w, h, cx, cy, max(bw, bh) * 2))
            let contrast = plateMean - wallMean

            // Confirmation, in tiers. A faceplate usually carries a few SMALL
            // dark features; one that is mostly dark inside is a frame or a
            // screen either way.
            let insetX = max(1, Int((Double(bw) * 0.08).rounded()))
            let insetY = max(1, Int((Double(bh) * 0.08).rounded()))
            let feats = darkFeatures(
                g, w,
                p.minx + insetX, p.miny + insetY,
                p.maxx + 1 - insetX, p.maxy + 1 - insetY,
                threshold: Float(plateMean - darkFeatureDelta)
            )
            if feats.blobs > maxFeatures { continue }
            if feats.darkFraction > maxDarkFraction { continue }
            if feats.blobs == 0 {
                // A blank SEALED cover, or a far socket whose slots are below
                // pixel resolution: no features to lean on, so everything else
                // must be unmistakable. (Known cost, accepted deliberately: a
                // plate-sized featureless white rectangle — a sticky note —
                // can box; one tap on the plan removes it.)
                if contrast < blankMinContrast { continue }
                if solidity < blankMinSolidity { continue }
                if aspect < blankMinAspect || aspect > blankMaxAspect { continue }
                if Double(max(bw, bh)) > Double(minDim) * blankMaxSideFrac { continue }
            } else if contrast < strongContrast && feats.blobs < weakMinFeatures {
                // Weak brightness needs more corroboration than one dot.
                continue
            }

            let aspectFit = (aspect >= 0.45 && aspect <= 2.2) ? 1.0 : 0.4
            // Feature term saturates at THREE, not two: a power outlet shows a
            // pair of pin slots plus a ground, a coax barrel or an RJ45 gate
            // shows one. Scoring to three is what makes an outlet outrank a data
            // plate when the two ever compete, without rejecting the data plate.
            let score = 0.4 * min(1, solidity)
                + 0.2 * aspectFit
                + 0.2 * min(1, max(0, contrast) / 30)
                + 0.2 * min(1, Double(feats.blobs) / 3)

            detections.append(SocketDetection(
                cx: (Double(p.minx) + Double(bw) / 2) / Double(w),
                cy: (Double(p.miny) + Double(bh) / 2) / Double(h),
                w: Double(bw) / Double(w),
                h: Double(bh) / Double(h),
                score: score,
                holes: feats.blobs,
                platePx: Double(min(bw, bh))
            ))
        }

        // Non-max suppression, strongest first.
        //
        // The threshold stays where it is. Two plates side by side overlap by
        // NOTHING, so no IoU threshold has ever suppressed one of them —
        // lowering it would only make suppression more aggressive and start
        // losing sockets that currently survive. What actually merged adjacent
        // plates was the segmentation stage, fixed above by the opening. Every
        // surviving box is kept and tracked independently; nothing selects a
        // single best per frame.
        detections.sort { $0.score > $1.score }
        var kept: [SocketDetection] = []
        for d in detections {
            guard d.score >= minScore else { continue }
            if kept.contains(where: { iou($0, d) > nmsIoU }) { continue }
            kept.append(d)
        }
        return kept
    }

    // MARK: Internals

    struct Blob {
        var minx = 0, miny = 0, maxx = 0, maxy = 0
        var area = 0
        var cx = 0.0, cy = 0.0
    }

    /// Nearest-neighbour downscale so analysis cost is independent of capture size.
    static func downscale(_ image: GrayImage, maxDim: Int) -> GrayImage {
        let longest = max(image.width, image.height)
        guard longest > maxDim, maxDim > 0 else { return image }
        let scale = Double(maxDim) / Double(longest)
        let w = max(1, Int((Double(image.width) * scale).rounded()))
        let h = max(1, Int((Double(image.height) * scale).rounded()))
        var out = [Float](repeating: 0, count: w * h)
        for y in 0..<h {
            let sy = min(image.height - 1, Int(Double(y) / scale))
            for x in 0..<w {
                let sx = min(image.width - 1, Int(Double(x) / scale))
                out[y * w + x] = image.pixels[sy * image.width + sx]
            }
        }
        return GrayImage(pixels: out, width: w, height: h)
    }

    /// Summed-area table over the 8-bit luminance.
    ///
    /// `Int32` rather than `Double`: luminance is 0...255, so even a 4K frame
    /// sums to far less than Int32's range, and this halves the per-frame
    /// allocation while replacing dependent floating-point adds with integer
    /// ones. The allocation happens on every analysed frame, so it matters.
    private static func makeIntegral(_ g: [Float], _ w: Int, _ h: Int) -> [Int32] {
        var s = [Int32](repeating: 0, count: (w + 1) * (h + 1))
        for y in 1...h {
            var row: Int32 = 0
            for x in 1...w {
                row &+= Int32(g[(y - 1) * w + (x - 1)])
                s[y * (w + 1) + x] = s[(y - 1) * (w + 1) + x] &+ row
            }
        }
        return s
    }

    private static func boxMean(_ s: [Int32], _ w: Int, _ h: Int, _ x: Int, _ y: Int, _ r: Int) -> Float {
        let x0 = max(0, x - r), y0 = max(0, y - r)
        let x1 = min(w, x + r + 1), y1 = min(h, y + r + 1)
        let stride = w + 1
        let sum = Int(s[y1 * stride + x1]) - Int(s[y0 * stride + x1])
            - Int(s[y1 * stride + x0]) + Int(s[y0 * stride + x0])
        let n = (x1 - x0) * (y1 - y0)
        return n > 0 ? Float(sum) / Float(n) : 0
    }

    /// Mean over a pixel rectangle [x0,x1) x [y0,y1) via the summed-area table.
    private static func rectMean(_ s: [Int32], _ w: Int, _ x0: Int, _ y0: Int, _ x1: Int, _ y1: Int) -> Double {
        let stride = w + 1
        let sum = Int(s[y1 * stride + x1]) - Int(s[y0 * stride + x1])
            - Int(s[y1 * stride + x0]) + Int(s[y0 * stride + x0])
        let n = (x1 - x0) * (y1 - y0)
        return n > 0 ? Double(sum) / Double(n) : 0
    }

    /// Count dark feature blobs (>= minFeatureArea px) inside a plate's box.
    private static func darkFeatures(
        _ g: [Float], _ w: Int,
        _ x0: Int, _ y0: Int, _ x1: Int, _ y1: Int,
        threshold: Float
    ) -> (blobs: Int, darkFraction: Double) {
        let bw = x1 - x0, bh = y1 - y0
        guard bw > 0, bh > 0 else { return (0, 0) }
        var mask = [Bool](repeating: false, count: bw * bh)
        var dark = 0
        for y in 0..<bh {
            for x in 0..<bw {
                if g[(y0 + y) * w + (x0 + x)] < threshold {
                    mask[y * bw + x] = true
                    dark += 1
                }
            }
        }
        var blobs = 0
        var seen = [Bool](repeating: false, count: bw * bh)
        var stack: [Int] = []
        for start in 0..<(bw * bh) {
            guard mask[start], !seen[start] else { continue }
            var area = 0
            stack.removeAll(keepingCapacity: true)
            stack.append(start)
            seen[start] = true
            while let q = stack.popLast() {
                area += 1
                let qx = q % bw, qy = q / bw
                for dy in -1...1 {
                    for dx in -1...1 {
                        if dx == 0 && dy == 0 { continue }
                        let nx = qx + dx, ny = qy + dy
                        guard nx >= 0, ny >= 0, nx < bw, ny < bh else { continue }
                        let r = ny * bw + nx
                        if mask[r] && !seen[r] { seen[r] = true; stack.append(r) }
                    }
                }
            }
            if area >= minFeatureArea { blobs += 1 }
        }
        return (blobs, Double(dark) / Double(bw * bh))
    }

    /// Morphological opening with a square element of radius `r`: erode, then
    /// dilate. Removes structure thinner than the element, leaves wider
    /// structure essentially unchanged.
    ///
    /// Done SEPARABLY — a horizontal pass then a vertical one — which is exact
    /// for a square element and turns the cost from "two summed-area tables and
    /// two windowed lookups per pixel" into four running-sum sweeps with no
    /// extra allocation. This runs on every analysed frame while ARKit is trying
    /// to hold a frame rate, so the constant factor is not a detail.
    ///
    /// The border replicates: an edge pixel is judged only on its IN-BOUNDS
    /// neighbours, so a plate at the frame edge stays intact and still trips the
    /// border rule that skips it, rather than being eaten into a new shape.
    static func opened(_ mask: [Bool], _ w: Int, _ h: Int, _ r: Int) -> [Bool] {
        sweep(sweep(mask, w, h, r, erodePass: true), w, h, r, erodePass: false)
    }

    /// One separable morphology pass. `erodePass` keeps a pixel only if EVERY
    /// in-window neighbour is set; otherwise it keeps it if ANY is.
    private static func sweep(_ mask: [Bool], _ w: Int, _ h: Int, _ r: Int, erodePass: Bool) -> [Bool] {
        var tmp = [Bool](repeating: false, count: w * h)
        for y in 0..<h {
            let row = y * w
            var lo = 0
            var hi = min(w - 1, r)
            var sum = 0
            for x in lo...hi where mask[row + x] { sum += 1 }
            for x in 0..<w {
                tmp[row + x] = erodePass ? (sum == hi - lo + 1) : (sum > 0)
                let nextLo = max(0, x + 1 - r)
                let nextHi = min(w - 1, x + 1 + r)
                if nextLo > lo {
                    if mask[row + lo] { sum -= 1 }
                    lo = nextLo
                }
                if nextHi > hi {
                    hi = nextHi
                    if mask[row + hi] { sum += 1 }
                }
            }
        }

        var out = [Bool](repeating: false, count: w * h)
        for x in 0..<w {
            var lo = 0
            var hi = min(h - 1, r)
            var sum = 0
            for y in lo...hi where tmp[y * w + x] { sum += 1 }
            for y in 0..<h {
                out[y * w + x] = erodePass ? (sum == hi - lo + 1) : (sum > 0)
                let nextLo = max(0, y + 1 - r)
                let nextHi = min(h - 1, y + 1 + r)
                if nextLo > lo {
                    if tmp[lo * w + x] { sum -= 1 }
                    lo = nextLo
                }
                if nextHi > hi {
                    hi = nextHi
                    if tmp[hi * w + x] { sum += 1 }
                }
            }
        }
        return out
    }

    /// Fraction of a bounding box that is set in the mask.
    private static func maskFill(
        _ mask: [Bool], _ w: Int, _ x0: Int, _ y0: Int, _ x1: Int, _ y1: Int
    ) -> Double {
        var set = 0
        for y in y0...y1 {
            for x in x0...x1 where mask[y * w + x] { set += 1 }
        }
        let n = (x1 - x0 + 1) * (y1 - y0 + 1)
        return n > 0 ? Double(set) / Double(n) : 0
    }

    /// 8-connected components of a boolean mask.
    private static func components(_ mask: [Bool], _ w: Int, _ h: Int) -> [Blob] {
        var seen = [Bool](repeating: false, count: w * h)
        var blobs: [Blob] = []
        var stack: [Int] = []
        for start in 0..<(w * h) {
            guard mask[start], !seen[start] else { continue }
            stack.removeAll(keepingCapacity: true)
            stack.append(start)
            seen[start] = true
            var blob = Blob(minx: w, miny: h, maxx: 0, maxy: 0, area: 0, cx: 0, cy: 0)
            var sx = 0, sy = 0
            while let p = stack.popLast() {
                let px = p % w, py = p / w
                blob.area += 1; sx += px; sy += py
                if px < blob.minx { blob.minx = px }
                if px > blob.maxx { blob.maxx = px }
                if py < blob.miny { blob.miny = py }
                if py > blob.maxy { blob.maxy = py }
                for dy in -1...1 {
                    for dx in -1...1 {
                        if dx == 0 && dy == 0 { continue }
                        let nx = px + dx, ny = py + dy
                        guard nx >= 0, ny >= 0, nx < w, ny < h else { continue }
                        let q = ny * w + nx
                        if mask[q] && !seen[q] { seen[q] = true; stack.append(q) }
                    }
                }
            }
            blob.cx = Double(sx) / Double(blob.area)
            blob.cy = Double(sy) / Double(blob.area)
            blobs.append(blob)
        }
        return blobs
    }

    private static func iou(_ a: SocketDetection, _ b: SocketDetection) -> Double {
        let ax0 = a.cx - a.w / 2, ay0 = a.cy - a.h / 2, ax1 = a.cx + a.w / 2, ay1 = a.cy + a.h / 2
        let bx0 = b.cx - b.w / 2, by0 = b.cy - b.h / 2, bx1 = b.cx + b.w / 2, by1 = b.cy + b.h / 2
        let ix = max(0, min(ax1, bx1) - max(ax0, bx0))
        let iy = max(0, min(ay1, by1) - max(ay0, by0))
        let inter = ix * iy
        let union = a.w * a.h + b.w * b.h - inter
        return union > 0 ? inter / union : 0
    }
}
