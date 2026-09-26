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
    }

    // MARK: Tuning (kept identical to the TypeScript mirror)

    /// Shorter than this is not a wall — it is a fragment or a piece of clutter.
    static let minSegmentMm = 250.0
    /// Fragments differing by less than this in heading may be the same wall.
    static let parallelDeg = 8.0
    /// …and by less than this in perpendicular offset.
    ///
    /// Wide enough to absorb an occluded fragment's error (the observed case was
    /// 150mm), narrow enough not to swallow a genuine 400mm recess.
    static let coplanarMm = 300.0
    /// A chain step longer than this is a teleport across the room, not a corner.
    static let maxJumpMm = 900.0
    /// Below this angle two walls are parallel and are not given a corner.
    static let minCornerDeg = 15.0

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

    // MARK: Entry point

    /// Wall segments → an ordered closed outline.
    ///
    /// Returns the segments' own endpoints when there is nothing sensible to
    /// build, so a degenerate scan degrades to what RoomPlan said rather than to
    /// nothing.
    static func outline(_ segments: [Segment]) -> [Vec2] {
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

    // MARK: Merge the fragments of one wall

    /// Take the OUTERMOST offset rather than an average — see the note above.
    private static func mergeCoplanar(_ lines: [Line]) -> [Line] {
        let cosLimit = cos(parallelDeg * .pi / 180)
        var merged: [Line] = []

        for line in lines {
            var joined = false
            for i in merged.indices {
                let host = merged[i]
                // Same heading? Allow either direction — a fragment can be
                // reported running the other way along the same wall.
                if abs(dot(host.dir, line.dir)) < cosLimit { continue }
                // Same plane? Measure the fragment's offset across the host's normal.
                let offset = dot(Geo.sub(line.origin, host.origin), host.inward)
                if abs(offset) > coplanarMm { continue }

                // Same wall. Keep whichever is further OUT: a negative inward
                // offset is further from the room centre, which occlusion
                // cannot manufacture.
                let origin = offset < 0
                    ? Vec2(x: host.origin.x + host.inward.x * offset,
                           z: host.origin.z + host.inward.z * offset)
                    : host.origin
                let dir = host.dir

                // Union the observed extents, re-projected onto the kept line.
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

    // MARK: Order them into a loop

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

    // MARK: Corners by intersection

    /// A corner hidden behind a bin is still exactly where its two walls meet,
    /// and no amount of occlusion moves that.
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
                // endpoints so the jog is visible and correctable, rather than
                // fusing it into a chord.
                out.append(here.end)
                if Geo.distance(here.end, next.start) > 1 { out.append(next.start) }
            }
        }
        return out
    }

    /// Where two lines cross, or nil when they are too near parallel to say.
    private static func intersect(_ a: Line, _ b: Line) -> Vec2? {
        let cross = a.dir.x * b.dir.z - a.dir.z * b.dir.x
        guard abs(cross) >= sin(minCornerDeg * .pi / 180) else { return nil }
        let d = Geo.sub(b.origin, a.origin)
        let t = (d.x * b.dir.z - d.z * b.dir.x) / cross
        return Vec2(x: a.origin.x + a.dir.x * t, z: a.origin.z + a.dir.z * t)
    }

    private static func dot(_ a: Vec2, _ b: Vec2) -> Double { a.x * b.x + a.z * b.z }
}
