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
        /// Only one face of it was seen, so where the rest of it stands is a
        /// guess. The depth readings (`PillarFinder`) replace it when they found it.
        var partial: Bool = false
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
    /// A wall turning off a gap may stop this short of the line (occlusion).
    static let mouthReachMm = 1200.0
    /// The two sides of a mouth are at least this far apart.
    static let mouthMinWidthMm = 300.0
    /// Shorter than this is noise, even as evidence of a mouth.
    static let stubMm = 60.0
    /// What connecting two walls without a corner between them costs the chain.
    static let jogPenaltyMm = 500.0
    /// How much of a wall occlusion may hide at a corner and still be a corner.
    static let occludedCornerMm = 600.0

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
        // Low is not enough on its own: an attic's knee wall is low and is still
        // the room's edge. Clutter is low AND stands in front of a real wall —
        // so a low surface is only dropped when a tall wall runs parallel right
        // behind it.
        func tallEnough(_ s: Segment) -> Bool {
            (s.heightMm.map { $0 >= minWallHeightMm } ?? true)
                && (s.topMm.map { $0 >= minWallTopMm } ?? true)
        }
        let tall = segments.filter(tallEnough)
        func clutter(_ s: Segment) -> Bool {
            !tallEnough(s) && standsInFront(s, of: tall)
        }
        // If that leaves no room at all, the heights are what is wrong.
        let walls = tall.count >= 3 ? segments.filter { !clutter($0) } : segments
        let clutterRejected = segments.count - walls.count

        // 2 — PILLARS. A column's facets, woven into the outline, are what turned
        // a round pillar into a spike across the plan. So they are pulled out
        // first — but only after the clusters that are plainly part of the room
        // (see `clusterIsBoundary`) have been put back. The outline the rest are
        // judged against has to be the room's: built without one of its own
        // corners it can stop short, and a real column then looks as if it
        // stands outside the room.
        let clusters = pillarClusters(walls).filter { !clusterIsBoundary($0, walls) }
        let clustered = Set(clusters.flatMap { $0 })
        // …and single surfaces standing on their own: one face of a column (all
        // RoomPlan saw of it), or the side of a kitchen island. Chained into the
        // outline, a lone face in the middle of the room drew a spike out to it
        // and back — the floor plan of an open-plan flat with a column in it.
        let lone = loneSurfaces(walls, taken: clustered)
        let inCluster = clustered.union(lone)
        var outline = buildOutline(walls.indices.filter { !inCluster.contains($0) }.map { walls[$0] })

        // A true pillar stands INSIDE the room it was taken out of, clear of its
        // walls and not wedged into a corner. A cluster that does not — an
        // alcove, a small bay, a rounded corner — was part of the boundary after
        // all, so it goes back and the outline is rebuilt.
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
            // A column stands free or against ONE wall. Something reaching two
            // walls that meet at a corner is the corner itself — a rounded
            // corner, or a column built into it — and belongs in the boundary.
            if clear && !touchesCorner(pts, outline) {
                accepted.append(idx)
            } else {
                rejected.formUnion(idx)
            }
        }
        // A lone surface is only off the boundary if it stands well clear of
        // every wall: closer, it is a fragment of one. Clear of them, a surface
        // reaching the ceiling is a column; anything lower (an island, a
        // half-height partition) is in the room, not round it, and is dropped
        // like clutter.
        let ceiling = walls.reduce(0.0) { max($0, $1.topMm ?? 0) }
        var faces: [Int] = []
        var interior = 0
        for i in lone {
            let s = walls[i]
            let mid = Vec2(x: (s.a.x + s.b.x) / 2, z: (s.a.z + s.b.z) / 2)
            var clear = outline.count >= 3
            for p in [s.a, s.b, mid] where clear {
                if !inside(p, outline) { clear = false; break }
                for k in outline.indices {
                    let edge = Geo.distanceToSegment(p, outline[k], outline[(k + 1) % outline.count])
                    if edge < loneClearMm { clear = false; break }
                }
            }
            if !clear {
                rejected.insert(i)
            } else if let top = s.topMm, let height = s.heightMm,
                      top >= ceiling - loneCeilingGapMm, height >= ceiling * 0.75 {
                faces.append(i)
            } else {
                interior += 1
            }
        }
        if !rejected.isEmpty {
            outline = buildOutline(walls.indices
                .filter { !inCluster.contains($0) || rejected.contains($0) }
                .map { walls[$0] })
        }

        var pillars: [Pillar] = accepted.map { idx in fitPillar(idx.map { walls[$0] }) }
        for i in faces { pillars.append(facePillar(walls[i])) }
        return Analysis(outline: outline, pillars: pillars, clutterRejected: clutterRejected + interior)
    }

    /// A lone surface stands at least this clear of every wall of the room…
    static let loneClearMm = 500.0
    /// …is at least this wide (narrower is noise)…
    static let loneMinMm = 150.0
    /// …and, to be a column, tops out within this of the ceiling.
    static let loneCeilingGapMm = 300.0

    /// Surfaces with nothing else near them: no other surface within linking
    /// distance, short enough to be a column face, carrying the heights that
    /// tell a column from an island, and not a piece of the boundary (its ends
    /// do not run on into walls on two different lines).
    private static func loneSurfaces(_ walls: [Segment], taken: Set<Int>) -> [Int] {
        walls.indices.filter { i in
            let s = walls[i]
            guard !taken.contains(i), s.heightMm != nil, s.topMm != nil else { return false }
            let len = Geo.distance(s.a, s.b)
            guard len >= loneMinMm, len <= pillarMaxFacetMm else { return false }
            guard !walls.indices.contains(where: { $0 != i && segmentGap(s, walls[$0]) <= pillarLinkMm }) else { return false }
            return !clusterIsBoundary([i], walls)
        }
    }

    /// The one face RoomPlan saw of a column. Which side of it the column is on
    /// is not known from the face alone, so it is drawn as a square on the
    /// face — the depth readings (`PillarFinder`) place it properly when they
    /// saw it.
    private static func facePillar(_ s: Segment) -> Pillar {
        let len = Geo.distance(s.a, s.b)
        return Pillar(
            center: Vec2(x: (s.a.x + s.b.x) / 2, z: (s.a.z + s.b.z) / 2),
            shape: .box, width: len, depth: len,
            rotation: atan2(s.b.z - s.a.z, s.b.x - s.a.x),
            partial: true
        )
    }

    // MARK: The outline

    /// Returns the segments' own endpoints when there is nothing sensible to
    /// build, so a degenerate scan degrades to what RoomPlan said.
    ///
    /// TWO PASSES, because "keep the OUTERMOST fragment" needs to know which
    /// side of each wall the room is on. The first pass guesses it from the
    /// middle of the walls — exact for a convex room, but in an L-shaped room
    /// that middle can fall OUTSIDE the room, and then the reflex wall's
    /// "outermost" fragment is the one clutter pushed INTO the room: the shoes
    /// bug again, in every non-convex room. So the first pass's outline is
    /// asked instead, and the outline is rebuilt with its answers.
    private static func buildOutline(_ segments: [Segment]) -> [Vec2] {
        let usable = segments.filter { Geo.distance($0.a, $0.b) >= minSegmentMm }
        guard usable.count >= 3 else { return segments.flatMap { [$0.a, $0.b] } }

        // Pass 1 — which way is "in", judged from the room's rough middle.
        let mids = usable.map { Vec2(x: ($0.a.x + $0.b.x) / 2, z: ($0.a.z + $0.b.z) / 2) }
        let centre = Vec2(
            x: mids.reduce(0) { $0 + $1.x } / Double(mids.count),
            z: mids.reduce(0) { $0 + $1.z } / Double(mids.count)
        )
        let guessed: [Vec2] = usable.indices.map { i in
            let dir = Geo.normalize(Geo.sub(usable[i].b, usable[i].a))
            let left = Vec2(x: -dir.z, z: dir.x)
            return dot(left, Geo.sub(centre, mids[i])) >= 0 ? left : Vec2(x: -left.x, z: -left.z)
        }
        guard let first = outlineFrom(usable, inwards: guessed, context: segments) else {
            return usable.flatMap { [$0.a, $0.b] }
        }

        // Pass 2 — which way is "in", asked of the room pass 1 found.
        var changed = false
        let asked: [Vec2] = usable.indices.map { i in
            guard let side = roomSide(usable[i], mid: mids[i], room: first),
                  dot(side, guessed[i]) <= 0 else { return guessed[i] }
            changed = true
            return side
        }
        guard changed else { return first }
        return outlineFrom(usable, inwards: asked, context: segments) ?? first
    }

    /// The unit normal of `s` that points into `room`, or nil when it cannot be
    /// told. Several distances, because the first outline can be off by a
    /// fragment's width near the wall and a small room is narrow far from it.
    private static func roomSide(_ s: Segment, mid: Vec2, room: [Vec2]) -> Vec2? {
        let dir = Geo.normalize(Geo.sub(s.b, s.a))
        let left = Vec2(x: -dir.z, z: dir.x)
        for d in [250.0, 500, 1000] {
            let l = inside(Vec2(x: mid.x + left.x * d, z: mid.z + left.z * d), room)
            let r = inside(Vec2(x: mid.x - left.x * d, z: mid.z - left.z * d), room)
            if l != r { return l ? left : Vec2(x: -left.x, z: -left.z) }
        }
        return nil
    }

    /// One pass: merge, chain, corner. Nil when no loop can be made.
    private static func outlineFrom(_ usable: [Segment], inwards: [Vec2], context: [Segment]) -> [Vec2]? {
        let lines: [Line] = usable.indices.map { i in
            let s = usable[i]
            let support = Geo.distance(s.a, s.b)
            return Line(
                origin: s.a, dir: Geo.normalize(Geo.sub(s.b, s.a)), inward: inwards[i],
                t0: 0, t1: support, support: support
            )
        }
        let walls = mergeCoplanar(lines, context: context)
        guard walls.count >= 3, let ordered = chain(walls), ordered.count >= 3 else { return nil }
        return corners(of: ordered, context: context)
    }

    /// A low surface this far or less in front of a wall is standing against it.
    static let clutterReachMm = 1200.0

    /// Does low surface `s` stand in front of a tall wall: one running parallel
    /// within reach of it, whose extent covers most of it?
    ///
    /// The extent is the whole wall line — every tall piece on it AND the gaps
    /// between them — because clutter hides exactly the stretch of wall behind
    /// it: a shoe rack arrives with the wall behind it missing, and measured
    /// against the pieces alone it covered nothing and survived as a "wall".
    private static func standsInFront(_ s: Segment, of tall: [Segment]) -> Bool {
        let sLen = Geo.distance(s.a, s.b)
        guard sLen >= 1 else { return false }
        let d = Geo.normalize(Geo.sub(s.b, s.a))
        let cosLimit = cos(parallelDeg * .pi / 180)
        let mid = Vec2(x: (s.a.x + s.b.x) / 2, z: (s.a.z + s.b.z) / 2)
        var lo = Double.infinity, hi = -Double.infinity
        for t in tall {
            guard Geo.distance(t.a, t.b) >= 1 else { continue }
            let td = Geo.normalize(Geo.sub(t.b, t.a))
            guard abs(dot(td, d)) >= cosLimit else { continue }
            let across = abs(-td.z * (mid.x - t.a.x) + td.x * (mid.z - t.a.z))
            guard across <= clutterReachMm else { continue }
            // The tall piece's extent, measured along the low surface.
            let ta = dot(Geo.sub(t.a, s.a), d), tb = dot(Geo.sub(t.b, s.a), d)
            lo = min(lo, ta, tb)
            hi = max(hi, ta, tb)
        }
        // …and on past its last visible piece, for the same reason: the stretch
        // the clutter hides can be the wall's end.
        let overlap = min(hi + maxJumpMm, sLen) - max(lo - maxJumpMm, 0)
        return overlap >= 0.5 * sLen
    }

    /// Is this cluster of short pieces part of the room's BOUNDARY rather than
    /// a column standing in it?
    ///
    /// Seen locally the two cannot be told apart — two wall pieces meeting at
    /// an inside corner look exactly like two faces of a square column. What
    /// differs is how they connect. A column's faces close into a ring, or leave
    /// loose ends that touch nothing (it stands free) or one wall (it is built
    /// into it). A corner of the room carries on into the rest of it: its loose
    /// ends meet walls on two DIFFERENT lines. Taken for a column, such a corner
    /// was cut out of the outline — the notch of a U-shaped room went with it,
    /// and a column appeared where the notch should have been.
    private static func clusterIsBoundary(_ idx: [Int], _ walls: [Segment]) -> Bool {
        let cosLimit = cos(parallelDeg * .pi / 180)
        let facets = idx.map { walls[$0] }
        struct End { var k: Int; var p: Vec2; var q: Vec2 }
        let ends = facets.enumerated().flatMap { k, f in
            [End(k: k, p: f.a, q: f.b), End(k: k, p: f.b, q: f.a)]
        }

        // Pair up the ends that meet (closest first); the rest are loose.
        var pairs: [(d: Double, i: Int, j: Int)] = []
        for i in ends.indices {
            for j in ends.indices where j > i && ends[i].k != ends[j].k {
                pairs.append((Geo.distance(ends[i].p, ends[j].p), i, j))
            }
        }
        // Stable on ties, as the TypeScript sort is.
        pairs = pairs.enumerated()
            .sorted { $0.element.d < $1.element.d || ($0.element.d == $1.element.d && $0.offset < $1.offset) }
            .map(\.element)
        var joined = Array(repeating: false, count: ends.count)
        for pair in pairs {
            if pair.d > pillarLinkMm { break }
            if !joined[pair.i] && !joined[pair.j] { joined[pair.i] = true; joined[pair.j] = true }
        }
        let loose = ends.indices.filter { !joined[$0] }.map { ends[$0] }
        // A closed ring — or one closed but for a small gap — is a column.
        if loose.isEmpty { return false }
        if loose.count == 2 && Geo.distance(loose[0].p, loose[1].p) <= pillarLinkMm { return false }

        let inCluster = Set(idx)
        let others = walls.indices
            .filter { !inCluster.contains($0) && Geo.distance(walls[$0].a, walls[$0].b) >= stubMm }
            .map { walls[$0] }

        /// The walls a loose end runs into: one ending near it; one its own
        /// piece carries straight on into; or one its piece would meet at a
        /// corner hidden behind clutter — carried on, it crosses that wall's
        /// line close to where that wall stops.
        func meets(_ end: End) -> [Segment] {
            let out = Geo.normalize(Geo.sub(end.p, end.q))
            return others.filter { s in
                if min(Geo.distance(end.p, s.a), Geo.distance(end.p, s.b)) <= cornerReachMm { return true }
                let d = Geo.normalize(Geo.sub(s.b, s.a))
                let cross = out.x * d.z - out.z * d.x
                if abs(cross) >= sin(minCornerDeg * .pi / 180) {
                    let w = Geo.sub(s.a, end.p)
                    let u = (w.x * d.z - w.z * d.x) / cross
                    guard u >= -cornerReachMm, u <= maxJumpMm else { return false }
                    let x = Vec2(x: end.p.x + out.x * u, z: end.p.z + out.z * u)
                    return min(Geo.distance(x, s.a), Geo.distance(x, s.b)) <= occludedCornerMm
                }
                guard abs(dot(d, out)) >= cosLimit else { return false }
                guard abs(dot(Geo.sub(s.a, end.p), Vec2(x: -out.z, z: out.x))) <= coplanarMm else { return false }
                let ta = dot(Geo.sub(s.a, end.p), out), tb = dot(Geo.sub(s.b, end.p), out)
                return min(ta, tb) >= -cornerReachMm && min(ta, tb) <= maxJumpMm
            }
        }
        func sameLine(_ s: Segment, _ t: Segment) -> Bool {
            let d = Geo.normalize(Geo.sub(s.b, s.a))
            guard abs(dot(d, Geo.normalize(Geo.sub(t.b, t.a)))) >= cosLimit else { return false }
            let mid = Vec2(x: (t.a.x + t.b.x) / 2, z: (t.a.z + t.b.z) / 2)
            return abs(dot(Geo.sub(mid, s.a), Vec2(x: -d.z, z: d.x))) <= coplanarMm
        }
        let met = loose.map(meets)
        for i in met.indices {
            for j in met.indices where j > i {
                if met[i].contains(where: { s in met[j].contains { t in !sameLine(s, t) } }) { return true }
            }
        }
        return false
    }

    /// A pillar within this of a wall is touching it.
    static let touchMm = 100.0

    /// Do these points touch two outline edges that are not parallel?
    private static func touchesCorner(_ pts: [Vec2], _ outline: [Vec2]) -> Bool {
        let cosLimit = cos(parallelDeg * .pi / 180)
        var touched: [Vec2] = []
        for k in outline.indices {
            let a = outline[k], b = outline[(k + 1) % outline.count]
            guard Geo.distance(a, b) >= 1 else { continue }
            if pts.contains(where: { Geo.distanceToSegment($0, a, b) <= touchMm }) {
                touched.append(Geo.normalize(Geo.sub(b, a)))
            }
        }
        for i in touched.indices {
            for j in touched.indices where j > i {
                if abs(dot(touched[i], touched[j])) < cosLimit { return true }
            }
        }
        return false
    }

    /// Merge the fragments of one wall, taking the OUTERMOST offset — see the
    /// note above. Two collinear fragments are only bridged across an EMPTY gap
    /// (occlusion, a doorway). If walls turn off the line within the gap, it is
    /// the mouth of an alcove, a chimney breast or the notch of a U-shaped
    /// room, and bridging it would delete real architecture from the plan.
    private static func mergeCoplanar(_ lines: [Line], context: [Segment]) -> [Line] {
        let cosLimit = cos(parallelDeg * .pi / 180)

        /// Is the gap [lo, hi] along `host` the MOUTH of something — an alcove,
        /// a chimney breast, the notch of a U-shaped room — rather than an empty
        /// stretch hidden behind clutter? It is when two different full-height
        /// walls turn off the host's line inside it.
        ///
        /// Measured to survive occlusion, which is what a gap is made of: a wall
        /// counts when its LINE crosses the host line within the gap and it comes
        /// within reach, not only when its endpoint touches — the last piece of a
        /// notch wall is often a stub too short to be a wall, or missing. Stubs
        /// count here for the same reason; low surfaces do not; and the two
        /// crossings must be apart, so one wall in two pieces is one.
        func isMouth(_ host: Line, _ lo: Double, _ hi: Double) -> Bool {
            var crossings: [Double] = []
            for s in context {
                guard Geo.distance(s.a, s.b) >= stubMm else { continue }
                if let h = s.heightMm, h < minWallHeightMm { continue }
                if let top = s.topMm, top < minWallTopMm { continue }
                let d = Geo.normalize(Geo.sub(s.b, s.a))
                let cross = host.dir.x * d.z - host.dir.z * d.x
                guard abs(cross) >= sin(minCornerDeg * .pi / 180) else { continue }
                let near = min(
                    abs(dot(Geo.sub(s.a, host.origin), host.inward)),
                    abs(dot(Geo.sub(s.b, host.origin), host.inward))
                )
                guard near <= mouthReachMm else { continue }
                // Where the wall's line meets the host's line, along the host.
                let w = Geo.sub(s.a, host.origin)
                let t = (w.x * d.z - w.z * d.x) / cross
                if t >= lo - cornerReachMm && t <= hi + cornerReachMm { crossings.append(t) }
            }
            guard crossings.count >= 2, let first = crossings.min(), let last = crossings.max() else { return false }
            return last - first >= mouthMinWidthMm
        }

        var merged: [Line] = []
        for line in lines {
            // Of the walls this fragment could belong to, the one it is closest
            // to along its length — so the result does not depend on the order
            // RoomPlan happened to list the fragments in.
            var bestHost = -1
            var bestGap = Double.infinity
            for (i, host) in merged.enumerated() {
                if abs(dot(host.dir, line.dir)) < cosLimit { continue }
                let offset = dot(Geo.sub(line.origin, host.origin), host.inward)
                if abs(offset) > coplanarMm { continue }

                let ta = dot(Geo.sub(line.start, host.origin), host.dir)
                let tb = dot(Geo.sub(line.end, host.origin), host.dir)
                let lineLo = min(ta, tb), lineHi = max(ta, tb)
                // The empty stretch between them along the host, if any.
                let gapLo = lineLo > host.t1 ? host.t1 : lineHi < host.t0 ? lineHi : 0
                let gapHi = lineLo > host.t1 ? lineLo : lineHi < host.t0 ? host.t0 : 0
                let gap = gapHi - gapLo
                if gap > 0 && isMouth(host, gapLo, gapHi) { continue }
                if gap < bestGap {
                    bestGap = gap
                    bestHost = i
                }
            }

            guard bestHost >= 0 else {
                merged.append(line)
                continue
            }

            // Same wall. Keep whichever is further OUT: a negative inward offset
            // is further from the room, which occlusion cannot manufacture.
            let host = merged[bestHost]
            let offset = dot(Geo.sub(line.origin, host.origin), host.inward)
            let origin = offset < 0
                ? Vec2(x: host.origin.x + host.inward.x * offset,
                       z: host.origin.z + host.inward.z * offset)
                : host.origin
            let dir = host.dir
            let ts = [host.start, host.end, line.start, line.end].map { dot(Geo.sub($0, origin), dir) }
            merged[bestHost] = Line(
                origin: origin, dir: dir, inward: host.inward,
                t0: ts.min() ?? 0, t1: ts.max() ?? 0,
                support: host.support + line.support
            )
        }
        return merged
    }

    private static func chain(_ walls: [Line]) -> [Line]? {
        // Ties (a rectangle's opposite walls) break by list order, and support
        // is compared to the micron so this starts from the same wall as the
        // TypeScript twin, whose arithmetic differs in the last bits.
        let key = { (w: Line) -> Double in (w.support * 1000).rounded() }
        var remaining = walls.indices
            .sorted { key(walls[$0]) > key(walls[$1]) || (key(walls[$0]) == key(walls[$1]) && $0 < $1) }
            .map { walls[$0] }
        guard !remaining.isEmpty else { return nil }
        var ordered: [Line] = [remaining.removeFirst()]

        while !remaining.isEmpty {
            let current = ordered[ordered.count - 1]
            let tail = current.end
            // The next wall is the one reached by the shortest path THROUGH THE
            // CORNER the two would form — where their lines meet — not simply
            // the nearest loose end. When clutter hides the end of a wall, the
            // nearest end can belong to a wall running parallel to it across a
            // notch; two parallel walls cannot meet at a corner, so such a wall
            // only wins when nothing forms a corner at all.
            var best = -1
            var bestFlip = false
            var bestCost = Double.greatestFiniteMagnitude
            for (i, candidate) in remaining.enumerated() {
                let p = candidate.start, q = candidate.end
                var cost = min(Geo.distance(tail, p), Geo.distance(tail, q)) + jogPenaltyMm
                var flip = Geo.distance(tail, q) < Geo.distance(tail, p)
                if let corner = intersect(current, candidate),
                   dot(Geo.sub(corner, tail), current.dir) >= -cornerReachMm {
                    let viaCorner = Geo.distance(tail, corner)
                        + min(Geo.distance(corner, p), Geo.distance(corner, q))
                    if viaCorner < cost {
                        cost = viaCorner
                        flip = Geo.distance(corner, q) < Geo.distance(corner, p)
                    }
                }
                if cost < bestCost { bestCost = cost; best = i; bestFlip = flip }
            }
            guard best >= 0 else { break }

            // A gap wider than a doorway is not a corner — unless the two wall
            // lines genuinely cross nearby, which is what an occluded corner
            // looks like.
            let candidate = remaining[best]
            let bestDist = min(Geo.distance(tail, candidate.start), Geo.distance(tail, candidate.end))
            if bestDist > maxJumpMm {
                guard let meeting = intersect(current, candidate),
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
    private static func corners(of ordered: [Line], context: [Segment]) -> [Vec2] {
        var out: [Vec2] = []
        for i in ordered.indices {
            let here = ordered[i]
            let next = ordered[(i + 1) % ordered.count]
            if let corner = intersect(here, next),
               Geo.distance(corner, here.end) <= maxJumpMm * 3 {
                out.append(corner)
                continue
            }
            // Two walls with no corner between them are a step, and a step has
            // a return. A short return is often seen only as a stub too short to
            // be a wall — but its LINE is known, and it gives the step both of
            // its real corners instead of a diagonal.
            if let step = returnBetween(here, next, context: context) {
                out.append(contentsOf: step)
                continue
            }
            // Nothing to go on: keep BOTH endpoints so the jog is visible and
            // correctable, rather than fusing it into a chord.
            out.append(here.end)
            if Geo.distance(here.end, next.start) > 1 { out.append(next.start) }
        }
        return out
    }

    /// The two corners of a step between `here` and `next`, from a surface seen
    /// between them that crosses both — the step's return — or nil.
    private static func returnBetween(_ here: Line, _ next: Line, context: [Segment]) -> [Vec2]? {
        let hereEnd = here.end, nextStart = next.start
        var best: [Vec2]?
        var bestD = Double.greatestFiniteMagnitude
        for s in context {
            let len = Geo.distance(s.a, s.b)
            guard len >= stubMm else { continue }
            let line = Line(origin: s.a, dir: Geo.normalize(Geo.sub(s.b, s.a)), inward: Vec2(x: 0, z: 0),
                            t0: 0, t1: len, support: len)
            guard let c1 = intersect(here, line), let c2 = intersect(line, next) else { continue }
            // It must be part of THIS step: near both ends, and its corners too.
            guard Geo.distance(c1, hereEnd) <= maxJumpMm, Geo.distance(c2, nextStart) <= maxJumpMm else { continue }
            let mid = Vec2(x: (s.a.x + s.b.x) / 2, z: (s.a.z + s.b.z) / 2)
            let d = Geo.distance(mid, hereEnd) + Geo.distance(mid, nextStart)
            if d <= 2 * maxJumpMm && d < bestD {
                bestD = d
                best = [c1, c2]
            }
        }
        return best
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
            return headingSpread(facets) >= 60 * .pi / 180 || smoothArc(facets)
        }.map { $0.sorted() }.sorted { ($0.first ?? 0) < ($1.first ?? 0) }
    }

    /// Round if the facets sit on a circle, otherwise the box that holds them.
    private static func fitPillar(_ facets: [Segment]) -> Pillar {
        let pts = facets.flatMap { f in
            [f.a, f.b, Vec2(x: (f.a.x + f.b.x) / 2, z: (f.a.z + f.b.z) / 2)]
        }
        if let circle = fitCircle(pts),
           facets.count >= 3,
           headingSpread(facets) >= 100 * .pi / 180 || smoothArc(facets),
           circle.rms <= circle.radius * 0.12 {
            let d = circle.radius * 2
            return Pillar(center: circle.center, shape: .round, width: d, depth: d, rotation: 0)
        }
        // Longest face, to the micron, first one on a tie — a square column's
        // four faces tie, and the TypeScript twin picks the first.
        let mm = { (f: Segment) -> Double in (Geo.distance(f.a, f.b) * 1000).rounded() }
        var longest = facets[0]
        for f in facets.dropFirst() where mm(f) > mm(longest) { longest = f }
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

    /// Do these facets bend round smoothly — an arc, not a corner? Three or
    /// more facets turning through at least 40° with no single turn wider than
    /// 30°. A column RoomPlan only saw part of arrives as a partial arc; judged
    /// by spread alone it was boxed round the visible arc, its centre on the
    /// near face. A square has two face directions a right angle apart; an arc
    /// has many, close together.
    private static func smoothArc(_ segs: [Segment]) -> Bool {
        guard segs.count >= 3, headingSpread(segs) >= 40 * .pi / 180 else { return false }
        let hs = segs.map { s -> Double in
            let h = atan2(s.b.z - s.a.z, s.b.x - s.a.x)
            return (h.truncatingRemainder(dividingBy: .pi) + .pi).truncatingRemainder(dividingBy: .pi)
        }.sorted()
        var gaps = [Double.pi - hs[hs.count - 1] + hs[0]]
        for i in 1..<hs.count { gaps.append(hs[i] - hs[i - 1]) }
        gaps.sort(by: >)
        // The widest gap is the part of the compass the arc does not cover.
        return gaps[1] <= 30 * .pi / 180
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
