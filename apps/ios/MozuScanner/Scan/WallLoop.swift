// Build a room outline from RoomPlan's wall surfaces — the step that decides
// what the floor plan actually says the room is.
//
// WHY THIS EXISTS. The previous chaining in FloorplanBuilder had three faults,
// and together they are why a pile of shoes moved a wall:
//
//   1. It discarded the NEAR endpoint of every segment it chained. Only the far
//      end was appended, so each polygon edge was a chord fusing the gap between
//      two walls with the wall itself. Measured on a 4x3 m room whose z = 0 wall
//      was split by occlusion, with the second fragment fitted 150mm into the
//      room: the chord ran diagonally from (1500, 0) to (4000, 150), tilting a
//      wall that is straight in reality along its entire length. Shoes occupying
//      500mm of one wall put the far corner 150mm out.
//
//   2. It had no maximum jump, so the nearest remaining endpoint could be across
//      the room and the loop would happily go there and come back.
//
//   3. It never merged the fragments RoomPlan splits one wall into. Occlusion
//      routinely breaks a hallway wall into two or three surfaces, each fitted
//      separately, so a clear fragment and an occluded one end up at different
//      offsets and the join between them is a jog.
//
// THE ONE ASYMMETRY THAT MATTERS. Clutter sits BETWEEN the camera and the wall.
// It can hide a wall; it can never put a surface behind one. So when fragments
// of the same wall disagree about where that wall is, the answer is not their
// mean, their median or a least-squares fit — every one of those is dragged
// inward by whichever fragment was occluded. It is the OUTERMOST of them. That
// makes the estimate insensitive to how much clutter there is: one shoe and a
// hundred shoes give the same wall, because neither can produce evidence
// further out than the wall itself.
//
// Corners then come from intersecting the wall LINES rather than from joining
// endpoints, so a corner hidden behind a bin still lands where the two walls
// actually meet.
//
// Millimetres throughout. Pure geometry — no sensor data, no platform — and an
// exact mirror of src/systems/scan/wallLoop.ts, which carries the tests.

import Foundation

enum WallLoop {

    /// A wall as RoomPlan reported it: two endpoints on the floor plane.
    struct Segment {
        var a: Vec2
        var b: Vec2
        /// The surface's own height, mm, when known.
        var heightMm: Double? = nil
        /// How far its top edge sits above the FLOOR, mm, when known.
        var topMm: Double? = nil
    }

    /// A column the scan found standing in the room — round or square,
    /// freestanding or engaged against a wall. It is STRUCTURE: it cannot be
    /// moved and a cabinet cannot go through it, so it is reported beside the
    /// outline rather than being woven into it.
    struct Pillar {
        enum Shape: String { case round, box }
        var center: Vec2
        var shape: Shape
        /// Across, mm. For a round pillar width == depth == diameter.
        var width: Double
        var depth: Double
        /// Yaw of the box's width axis, radians, in the same convention as
        /// `ScanObject.rotation` (0 for round).
        var rotation: Double
    }

    struct Analysis {
        var outline: [Vec2]
        var pillars: [Pillar]
        /// Surfaces discarded as too low to be walls — shoe racks, boxes.
        var clutterRejected: Int
    }

    // MARK: Tuning (kept identical to the TypeScript mirror)

    /// Shorter than this is not a wall — it is a fragment or a piece of clutter.
    static let minSegmentMm = 250.0
    /// Fragments differing by less than this in heading may be the same wall.
    static let parallelDeg = 8.0
    /// …and by less than this in perpendicular offset. Wide enough to absorb an
    /// occluded fragment's error (the observed case was 150mm); deliberately NOT
    /// wide enough to reach a genuine 250-300mm return or boxed pipework.
    /// Perpendicular distance alone cannot tell those from clutter, which is why
    /// clutter is removed by HEIGHT first.
    static let coplanarMm = 200.0
    /// A doorway is ~900mm; an occluded patch of wall can be wider than that.
    static let maxJumpMm = 1500.0
    /// Below this angle two walls are parallel and are not given a corner.
    static let minCornerDeg = 15.0
    /// HEIGHT is the one physical property that separates a wall from clutter
    /// standing against it. RoomPlan fits a wall plane to any large flat
    /// vertical face, so the front of a shoe rack or a stack of boxes arrives as
    /// a "wall" in front of the real one. A wall runs most of the room's height.
    static let minWallHeightMm = 900.0
    static let minWallTopMm = 1000.0
    /// A round column is approximated by short facets at many headings.
    static let pillarMaxFacetMm = 1000.0
    static let pillarMaxSpanMm = 1300.0
    static let pillarLinkMm = 350.0
    /// A wall ending within this of another wall's end meets it at a corner.
    static let cornerReachMm = 200.0

    // MARK: A wall reduced to a line

    private struct Line {
        var origin: Vec2
        /// Unit direction along the wall.
        var dir: Vec2
        /// Unit normal pointing INTO the room.
        var inward: Vec2
        /// Signed offsets along `dir` from `origin` covering what was seen.
        var t0: Double
        var t1: Double
        /// Total observed length, for weighting.
        var support: Double

        var start: Vec2 { Vec2(x: origin.x + dir.x * t0, z: origin.z + dir.z * t0) }
        var end: Vec2 { Vec2(x: origin.x + dir.x * t1, z: origin.z + dir.z * t1) }
    }

    // MARK: Entry points

    /// Wall segments → an ordered closed outline.
    static func outline(_ segments: [Segment]) -> [Vec2] {
        analyse(segments).outline
    }

    /// Clutter out by height, pillars out as structure, the outline from the rest.
    static func analyse(_ segments: [Segment]) -> Analysis {
        // 1 — CLUTTER BY HEIGHT. Only surfaces that report a height are judged.
        let tall = segments.filter { s in
            (s.heightMm.map { $0 >= minWallHeightMm } ?? true)
                && (s.topMm.map { $0 >= minWallTopMm } ?? true)
        }
        // If that leaves no room at all, the heights are what is wrong.
        let walls = tall.count >= 3 ? tall : segments
        let clutterRejected = segments.count - walls.count

        // 2 — PILLARS. A column's facets, woven into the outline, are what turned
        // a round pillar into a spike across the plan. Pulled out first, then
        // confirmed against the room.
        let clusters = pillarClusters(walls)
        let inCluster = Set(clusters.flatMap { $0 })
        var outline = buildOutline(walls.indices.filter { !inCluster.contains($0) }.map { walls[$0] })

        // A true pillar stands INSIDE the room it was taken out of. A cluster
        // that does not — an alcove, a small bay, two short walls at a corner —
        // was part of the boundary, so it goes back and the outline is rebuilt.
        var accepted: [[Int]] = []
        var rejected = Set<Int>()
        for idx in clusters {
            let pts = idx.flatMap { [walls[$0].a, walls[$0].b] }
            let c = Vec2(
                x: pts.reduce(0) { $0 + $1.x } / Double(pts.count),
                z: pts.reduce(0) { $0 + $1.z } / Double(pts.count)
            )
            let clear = outline.count >= 3
                && inside(c, outline)
                && outline.indices.allSatisfy {
                    Geo.distanceToSegment(c, outline[$0], outline[($0 + 1) % outline.count]) >= 50
                }
            if clear { accepted.append(idx) } else { rejected.formUnion(idx) }
        }
        if !rejected.isEmpty {
            outline = buildOutline(walls.indices
                .filter { !inCluster.contains($0) || rejected.contains($0) }
                .map { walls[$0] })
        }

        return Analysis(
            outline: outline,
            pillars: accepted.map { fitPillar($0.map { walls[$0] }) },
            clutterRejected: clutterRejected
        )
    }

    // MARK: The outline

    /// Returns the segments' own endpoints when there is nothing sensible to
    /// build, so a degenerate scan degrades to what RoomPlan said.
    private static func buildOutline(_ segments: [Segment]) -> [Vec2] {
        let usable = segments.filter { Geo.distance($0.a, $0.b) >= minSegmentMm }
        guard usable.count >= 3 else { return segments.flatMap { [$0.a, $0.b] } }

        // The room's rough middle, used only to decide which way is "in".
        let mids = usable.map { Vec2(x: ($0.a.x + $0.b.x) / 2, z: ($0.a.z + $0.b.z) / 2) }
        let centre = Vec2(
            x: mids.reduce(0) { $0 + $1.x } / Double(mids.count),
            z: mids.reduce(0) { $0 + $1.z } / Double(mids.count)
        )

        let lines: [Line] = usable.map { s in
            let dir = Geo.normalize(Geo.sub(s.b, s.a))
            var inward = Vec2(x: -dir.z, z: dir.x)
            let mid = Vec2(x: (s.a.x + s.b.x) / 2, z: (s.a.z + s.b.z) / 2)
            if dot(inward, Geo.sub(centre, mid)) < 0 { inward = Vec2(x: -inward.x, z: -inward.z) }
            let support = Geo.distance(s.a, s.b)
            return Line(origin: s.a, dir: dir, inward: inward, t0: 0, t1: support, support: support)
        }

        let walls = mergeCoplanar(lines)
        guard walls.count >= 3 else { return usable.flatMap { [$0.a, $0.b] } }
        guard let ordered = chain(walls), ordered.count >= 3 else {
            return usable.flatMap { [$0.a, $0.b] }
        }
        return corners(of: ordered)
    }

    /// Merge the fragments of one wall, taking the OUTERMOST offset — see the
    /// note above. Two collinear fragments are only bridged across an EMPTY gap
    /// (occlusion, a doorway). If other walls turn off the line at both ends of
    /// the gap, it is the mouth of an alcove or a chimney breast, and bridging
    /// it would delete real architecture from the plan.
    private static func mergeCoplanar(_ lines: [Line]) -> [Line] {
        let cosLimit = cos(parallelDeg * .pi / 180)

        func turnsOff(at p: Vec2, from dir: Vec2) -> Bool {
            lines.contains { l in
                abs(dot(l.dir, dir)) < cosLimit
                    && (Geo.distance(p, l.start) <= cornerReachMm || Geo.distance(p, l.end) <= cornerReachMm)
            }
        }

        var merged: [Line] = []
        for line in lines {
            var joined = false
            for i in merged.indices {
                let host = merged[i]
                if abs(dot(host.dir, line.dir)) < cosLimit { continue }
                let offset = dot(Geo.sub(line.origin, host.origin), host.inward)
                if abs(offset) > coplanarMm { continue }

                // Where is the gap between them, if there is one?
                let ta = dot(Geo.sub(line.start, host.origin), host.dir)
                let tb = dot(Geo.sub(line.end, host.origin), host.dir)
                var gap: (Vec2, Vec2)?
                if min(ta, tb) > host.t1 {
                    gap = (host.end, ta < tb ? line.start : line.end)
                } else if max(ta, tb) < host.t0 {
                    gap = (host.start, ta > tb ? line.start : line.end)
                }
                if let g = gap, turnsOff(at: g.0, from: host.dir), turnsOff(at: g.1, from: host.dir) {
                    continue
                }

                // Same wall. Keep whichever is further OUT: a negative inward
                // offset is further from the room centre, which occlusion
                // cannot manufacture.
                let origin = offset < 0
                    ? Vec2(x: host.origin.x + host.inward.x * offset,
                           z: host.origin.z + host.inward.z * offset)
                    : host.origin
                let dir = host.dir
                let ts = [host.start, host.end, line.start, line.end]
                    .map { dot(Geo.sub($0, origin), dir) }
                merged[i] = Line(
                    origin: origin, dir: dir, inward: host.inward,
                    t0: ts.min() ?? 0, t1: ts.max() ?? 0,
                    support: host.support + line.support
                )
                joined = true
                break
            }
            if !joined { merged.append(line) }
        }
        return merged
    }

    private static func chain(_ walls: [Line]) -> [Line]? {
        var remaining = walls.sorted { $0.support > $1.support }
        guard !remaining.isEmpty else { return nil }
        var ordered: [Line] = [remaining.removeFirst()]

        while !remaining.isEmpty {
            let tail = ordered[ordered.count - 1].end
            var best = -1
            var bestFlip = false
            var bestDist = Double.greatestFiniteMagnitude
            for (i, candidate) in remaining.enumerated() {
                let dp = Geo.distance(tail, candidate.start)
                let dq = Geo.distance(tail, candidate.end)
                if dp < bestDist { bestDist = dp; best = i; bestFlip = false }
                if dq < bestDist { bestDist = dq; best = i; bestFlip = true }
            }
            guard best >= 0 else { break }

            // A gap wider than a doorway is not a corner — unless the two wall
            // lines genuinely cross nearby, which is what an occluded corner
            // looks like.
            if bestDist > maxJumpMm {
                let candidate = remaining[best]
                guard let meeting = intersect(ordered[ordered.count - 1], candidate),
                      Geo.distance(meeting, tail) <= maxJumpMm * 2,
                      min(Geo.distance(meeting, candidate.start),
                          Geo.distance(meeting, candidate.end)) <= maxJumpMm * 2
                else { break }
            }

            var picked = remaining.remove(at: best)
            if bestFlip {
                picked = Line(
                    origin: picked.origin,
                    dir: Vec2(x: -picked.dir.x, z: -picked.dir.z),
                    inward: picked.inward,
                    t0: -picked.t1, t1: -picked.t0,
                    support: picked.support
                )
            }
            ordered.append(picked)
        }
        return ordered
    }

    /// A corner hidden behind a bin is still exactly where its two walls meet.
    private static func corners(of ordered: [Line]) -> [Vec2] {
        var out: [Vec2] = []
        for i in ordered.indices {
            let here = ordered[i]
            let next = ordered[(i + 1) % ordered.count]
            if let corner = intersect(here, next),
               Geo.distance(corner, here.end) <= maxJumpMm * 3 {
                out.append(corner)
            } else {
                // Near-parallel, or a corner implausibly far away: keep BOTH
                // endpoints so the jog is visible, rather than fusing a chord.
                out.append(here.end)
                if Geo.distance(here.end, next.start) > 1 { out.append(next.start) }
            }
        }
        return out
    }

    private static func intersect(_ a: Line, _ b: Line) -> Vec2? {
        let cross = a.dir.x * b.dir.z - a.dir.z * b.dir.x
        guard abs(cross) >= sin(minCornerDeg * .pi / 180) else { return nil }
        let d = Geo.sub(b.origin, a.origin)
        let t = (d.x * b.dir.z - d.z * b.dir.x) / cross
        return Vec2(x: a.origin.x + a.dir.x * t, z: a.origin.z + a.dir.z * t)
    }

    // MARK: Pillars

    /// Groups of short facets, close together, facing many ways, that fit in a
    /// column-sized square. Whether each IS a pillar is decided afterwards.
    private static func pillarClusters(_ segs: [Segment]) -> [[Int]] {
        let short = segs.indices.filter { Geo.distance(segs[$0].a, segs[$0].b) <= pillarMaxFacetMm }
        var parent = Array(short.indices)
        func find(_ k: Int) -> Int {
            var k = k
            while parent[k] != k { parent[k] = parent[parent[k]]; k = parent[k] }
            return k
        }
        for a in short.indices {
            for b in (a + 1)..<short.count {
                if segmentGap(segs[short[a]], segs[short[b]]) <= pillarLinkMm {
                    // Roots first: `find` compresses paths, so it must not run
                    // inside the subscript of the very array it is rewriting.
                    let ra = find(a), rb = find(b)
                    if ra != rb { parent[ra] = rb }
                }
            }
        }
        var groups: [Int: [Int]] = [:]
        for k in short.indices { groups[find(k), default: []].append(short[k]) }

        return groups.values.filter { idx in
            guard idx.count >= 2 else { return false }
            let facets = idx.map { segs[$0] }
            let pts = facets.flatMap { [$0.a, $0.b] }
            let xs = pts.map(\.x), zs = pts.map(\.z)
            let span = max((xs.max() ?? 0) - (xs.min() ?? 0), (zs.max() ?? 0) - (zs.min() ?? 0))
            guard span <= pillarMaxSpanMm else { return false }
            // A straight run of short fragments is a wall, however short.
            return headingSpread(facets) >= 60 * .pi / 180
        }.map { $0.sorted() }.sorted { ($0.first ?? 0) < ($1.first ?? 0) }
    }

    /// Round if the facets sit on a circle, otherwise the box that holds them.
    private static func fitPillar(_ facets: [Segment]) -> Pillar {
        let pts = facets.flatMap { f in
            [f.a, f.b, Vec2(x: (f.a.x + f.b.x) / 2, z: (f.a.z + f.b.z) / 2)]
        }
        if let circle = fitCircle(pts),
           facets.count >= 3,
           headingSpread(facets) >= 100 * .pi / 180,
           circle.rms <= circle.radius * 0.12 {
            let d = circle.radius * 2
            return Pillar(center: circle.center, shape: .round, width: d, depth: d, rotation: 0)
        }
        let longest = facets.max { Geo.distance($0.a, $0.b) < Geo.distance($1.a, $1.b) }!
        let dir = Geo.normalize(Geo.sub(longest.b, longest.a))
        let perp = Vec2(x: -dir.z, z: dir.x)
        let us = pts.map { dot($0, dir) }
        let vs = pts.map { dot($0, perp) }
        let u0 = us.min() ?? 0, u1 = us.max() ?? 0
        let v0 = vs.min() ?? 0, v1 = vs.max() ?? 0
        let uc = (u0 + u1) / 2, vc = (v0 + v1) / 2
        return Pillar(
            center: Vec2(x: dir.x * uc + perp.x * vc, z: dir.z * uc + perp.z * vc),
            shape: .box, width: u1 - u0, depth: v1 - v0,
            rotation: atan2(dir.z, dir.x)
        )
    }

    /// Least-squares circle (Kåsa): x² + z² + Dx + Ez + F = 0, points centred
    /// first so the normal equations stay well conditioned in millimetres.
    private static func fitCircle(_ pts: [Vec2]) -> (center: Vec2, radius: Double, rms: Double)? {
        guard pts.count >= 3 else { return nil }
        let n = Double(pts.count)
        let mx = pts.reduce(0) { $0 + $1.x } / n
        let mz = pts.reduce(0) { $0 + $1.z } / n
        var sxx = 0.0, sxz = 0.0, szz = 0.0, sx = 0.0, sz = 0.0, bx = 0.0, bz = 0.0, b1 = 0.0
        for p in pts {
            let x = p.x - mx, z = p.z - mz, r2 = x * x + z * z
            sxx += x * x; sxz += x * z; szz += z * z; sx += x; sz += z
            bx -= r2 * x; bz -= r2 * z; b1 -= r2
        }
        func det3(_ a: [[Double]]) -> Double {
            a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1])
                - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
                + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
        }
        let m = [[sxx, sxz, sx], [sxz, szz, sz], [sx, sz, n]]
        let rhs = [bx, bz, b1]
        let det = det3(m)
        guard abs(det) > 1e-9 else { return nil }
        func solved(_ c: Int) -> Double {
            det3(m.enumerated().map { i, row in
                row.enumerated().map { j, v in j == c ? rhs[i] : v }
            }) / det
        }
        let cx = -solved(0) / 2, cz = -solved(1) / 2
        let r2 = cx * cx + cz * cz - solved(2)
        guard r2 > 0 else { return nil }
        let radius = r2.squareRoot()
        let rms = (pts.reduce(0) { acc, p in
            let e = hypot(p.x - mx - cx, p.z - mz - cz) - radius
            return acc + e * e
        } / n).squareRoot()
        return (Vec2(x: cx + mx, z: cz + mz), radius, rms)
    }

    /// How much of the compass a set of facets covers, radians in [0, π].
    private static func headingSpread(_ segs: [Segment]) -> Double {
        let hs = segs.map { s -> Double in
            let h = atan2(s.b.z - s.a.z, s.b.x - s.a.x)
            return (h.truncatingRemainder(dividingBy: .pi) + .pi).truncatingRemainder(dividingBy: .pi)
        }.sorted()
        guard hs.count >= 2, let first = hs.first, let last = hs.last else { return 0 }
        var gap = .pi - last + first
        for i in 1..<hs.count { gap = max(gap, hs[i] - hs[i - 1]) }
        return .pi - gap
    }

    private static func segmentGap(_ s: Segment, _ t: Segment) -> Double {
        min(Geo.distanceToSegment(s.a, t.a, t.b), Geo.distanceToSegment(s.b, t.a, t.b),
            Geo.distanceToSegment(t.a, s.a, s.b), Geo.distanceToSegment(t.b, s.a, s.b))
    }

    /// Even-odd point-in-polygon.
    private static func inside(_ p: Vec2, _ poly: [Vec2]) -> Bool {
        var hit = false
        var j = poly.count - 1
        for i in poly.indices {
            let a = poly[i], b = poly[j]
            if (a.z > p.z) != (b.z > p.z),
               p.x < a.x + (p.z - a.z) / (b.z - a.z) * (b.x - a.x) {
                hit.toggle()
            }
            j = i
        }
        return hit
    }

    private static func dot(_ a: Vec2, _ b: Vec2) -> Double { a.x * b.x + a.z * b.z }
}
