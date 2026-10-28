// Find the glass RoomPlan missed — from what the depth sensor saw THROUGH it,
// and from what it could not see at all.
//
// WHY THIS EXISTS. RoomPlan finds a window by recognising a window. A sliding
// glass door, a floor-to-ceiling pane or a frameless partition does not look
// like one, so it comes back as plain wall and the plan says there is a wall
// where there is a view. Testers hit this first ("有玻璃偵測不到").
//
// THREE KINDS OF EVIDENCE, because no single one survives every condition.
//
//   1. THROUGH. LiDAR does not stop at clear glass. A confident reading taken
//      through a pane lands on whatever is BEHIND it, well beyond the wall.
//      Solid wall can never do that. It needs something within the sensor's
//      ~5 m reach behind the glass and a sensor that is not blinded — a
//      balcony, at night. This was the only cue the first version used.
//
//   2. NO RETURN. In daylight the sun floods the LiDAR's 940 nm band, and from
//      a high floor there is nothing within 5 m behind the glass at all. ARKit
//      fills the hole with a guess (often painted at the depth of the wall
//      around the pane) and marks it LOW confidence. The first version threw
//      every low-confidence reading away, so in daylight a window produced no
//      evidence whatsoever — the field bug. A painted wall within 4 m, looked
//      at squarely, always returns a confident reading, so a low-confidence
//      reading that reaches the wall IS evidence: of nothing there to measure.
//
//   3. LIGHT. In daylight a window is blown out in the camera. A see-through or
//      no-return reading on a blown-out pixel, taken from close, counts twice.
//      Brightness never creates evidence on its own: a sunlit patch of wall is
//      blown out too, and from close the sensor still measures it.
//
// Readings that land ON the wall with confidence vote the other way. Patches
// where the see-through evidence wins, seen densely enough, over an area the
// size of a window, are the glass.
//
// WHAT IT CANNOT TELL APART. A mirror returns depth from the reflected room —
// to a depth sensor a mirror IS a window into a second room. A television that
// is on is bright and glossy. So are a doorway RoomPlan missed and a deep
// alcove. Everything found here is therefore marked `glass = true`, drawn
// dashed as a suggestion, and removable with one tap.
//
// Millimetres, y = height above the floor. Pure, and an exact mirror of
// src/systems/scan/glassFinder.ts, which carries the tests (including a
// simulated daytime walk: __tests__/glassDaylight.test.ts).

import Foundation

enum GlassFinder {

    struct Point3 {
        var x: Double
        var y: Double
        var z: Double
    }

    /// One depth reading: where the camera was, and where the reading landed.
    struct Ray {
        var eye: Point3
        var hit: Point3
        /// ARKit's confidence: 0 low, 1 medium, 2 high. A pixel with no depth
        /// at all is 0, with `hit` far along its line of sight.
        var confidence: Int = 2
        /// Camera brightness at the reading, 0–255; negative means unknown.
        var luma: Double = -1
    }

    struct Known {
        var wall: Int
        var offset: Double
        var width: Double
    }

    // MARK: Tuning (kept identical to the TypeScript mirror)

    static let cellMm = 100.0
    static let beyondMm = 300.0
    static let onWallMm = 120.0
    static let endMarginMm = 50.0
    static let minThrough = 2
    static let throughRatio = 2
    static let minSideMm = 400.0
    static let minFill = 0.6
    static let edgeFill = 0.5
    static let minVotes = 24
    static let minDensity = 2.0
    static let doorSillMm = 300.0
    static let brightLuma = 235.0
    static let brightRangeMm = 2500.0
    static let voidRangeMm = 4000.0
    static let voidMinCos = 0.4

    private final class Grid {
        let a: Vec2
        let length: Double
        let d: Vec2
        let inward: Vec2
        let cols: Int
        let rows: Int
        var through: [Int]
        var solid: [Int]
        /// The two nearest ranges each cell was measured solid from.
        var near1: [Double]
        var near2: [Double]

        init(a: Vec2, length: Double, d: Vec2, inward: Vec2, cols: Int, rows: Int) {
            self.a = a; self.length = length; self.d = d; self.inward = inward
            self.cols = cols; self.rows = rows
            through = Array(repeating: 0, count: cols * rows)
            solid = Array(repeating: 0, count: cols * rows)
            near1 = Array(repeating: Double.infinity, count: cols * rows)
            near2 = Array(repeating: Double.infinity, count: cols * rows)
        }

        func cell(_ t: Double, _ y: Double) -> Int {
            let c = min(cols - 1, max(0, Int((t / GlassFinder.cellMm).rounded(.down))))
            let r = min(rows - 1, max(0, Int((y / GlassFinder.cellMm).rounded(.down))))
            return r * cols + c
        }
    }

    static func openings(
        rays: [Ray],
        polygon: [Vec2],
        ceilingMm: Double,
        existing: [Known] = []
    ) -> [ScanOpening] {
        let n = polygon.count
        guard n >= 3, !rays.isEmpty, ceilingMm > 0 else { return [] }

        // Positive shoelace area = counter-clockwise in (x, z): the room is then
        // on the LEFT of every edge.
        var twiceArea = 0.0
        for i in 0..<n {
            let p = polygon[i], q = polygon[(i + 1) % n]
            twiceArea += p.x * q.z - q.x * p.z
        }
        let leftIsIn = twiceArea > 0

        let walls: [Grid] = (0..<n).map { i in
            let a = polygon[i], b = polygon[(i + 1) % n]
            let length = Geo.distance(a, b)
            let d = length > 0 ? Vec2(x: (b.x - a.x) / length, z: (b.z - a.z) / length) : Vec2(x: 1, z: 0)
            let inward = leftIsIn ? Vec2(x: -d.z, z: d.x) : Vec2(x: d.z, z: -d.x)
            return Grid(
                a: a, length: length, d: d, inward: inward,
                cols: max(1, Int((length / cellMm).rounded(.up))),
                rows: max(1, Int((ceilingMm / cellMm).rounded(.up)))
            )
        }

        // No-return readings, held until every solid one is in: whether they
        // count depends on how near the same cell was measured solid.
        var voids: [(wall: Int, cell: Int, range: Double, weight: Int)] = []

        for ray in rays {
            let eye = ray.eye, hit = ray.hit
            // Medium or high confidence measured something; low says only that
            // nothing could be measured along this line of sight.
            let measured = ray.confidence >= 1
            let bright = ray.luma >= brightLuma
            let dx = hit.x - eye.x, dy = hit.y - eye.y, dz = hit.z - eye.z
            let length = (dx * dx + dy * dy + dz * dz).squareRoot()

            // Where the ray first LEAVES the room through a wall, if it does —
            // and, for a reading that measured nothing, where it first reaches one.
            var exit: (wall: Int, f: Double)?
            var reach: (wall: Int, f: Double)?
            for (wi, w) in walls.enumerated() where w.length > 0 {
                let sEye = (eye.x - w.a.x) * w.inward.x + (eye.z - w.a.z) * w.inward.z
                let sHit = (hit.x - w.a.x) * w.inward.x + (hit.z - w.a.z) * w.inward.z
                let tHit = (hit.x - w.a.x) * w.d.x + (hit.z - w.a.z) * w.d.z

                // Landed ON this wall: a vote that it is solid there. Not right
                // at its ends, where the walls either side are hit too.
                if measured, abs(sHit) <= onWallMm, tHit >= endMarginMm, tHit <= w.length - endMarginMm,
                   hit.y >= 0, hit.y <= ceilingMm {
                    let cell: Int = w.cell(tHit, hit.y)
                    w.solid[cell] += 1
                    if length < w.near1[cell] {
                        w.near2[cell] = w.near1[cell]
                        w.near1[cell] = length
                    } else if length < w.near2[cell] {
                        w.near2[cell] = length
                    }
                }

                if measured {
                    // Measured, and measured BEYOND the wall.
                    guard sEye > 0, sHit < -beyondMm else { continue }
                    let f = sEye / (sEye - sHit)
                    let cx = eye.x + (hit.x - eye.x) * f
                    let cz = eye.z + (hit.z - eye.z) * f
                    let t = (cx - w.a.x) * w.d.x + (cz - w.a.z) * w.d.z
                    guard t >= endMarginMm, t <= w.length - endMarginMm else { continue }
                    if exit == nil || f < exit!.f { exit = (wi, f) }
                    continue
                }

                // Nothing measured. Where does its line of sight reach this wall?
                guard sEye > 0, sHit <= onWallMm, sEye - sHit > 1e-6, length > 0 else { continue }
                // Squarely enough: a wall seen edge-on returns nothing even when solid.
                let square: Double = (sEye - sHit) / length
                guard square >= voidMinCos else { continue }
                let f: Double = sEye / (sEye - sHit)
                let reachMm: Double = f * length
                guard reachMm <= voidRangeMm else { continue }
                let cx = eye.x + (hit.x - eye.x) * f
                let cz = eye.z + (hit.z - eye.z) * f
                let t = (cx - w.a.x) * w.d.x + (cz - w.a.z) * w.d.z
                guard t >= endMarginMm, t <= w.length - endMarginMm else { continue }
                if reach == nil || f < reach!.f { reach = (wi, f) }
            }
            guard let at = exit ?? reach else { continue }
            let w = walls[at.wall]
            let y = eye.y + (hit.y - eye.y) * at.f
            guard y >= 0, y <= ceilingMm else { continue }
            let cx = eye.x + (hit.x - eye.x) * at.f
            let cz = eye.z + (hit.z - eye.z) * at.f
            let close: Bool = at.f * length <= brightRangeMm
            let weight: Int = bright && close ? 2 : 1
            let along: Double = (cx - w.a.x) * w.d.x + (cz - w.a.z) * w.d.z
            let cell: Int = w.cell(along, y)
            if exit != nil {
                w.through[cell] += weight
            } else {
                voids.append((wall: at.wall, cell: cell, range: at.f * length, weight: weight))
            }
        }

        // Glass in sunlight returns nothing from any distance; a solid wall in
        // strong sun returns nothing only from far off, and is measured from
        // nearer. So a no-return reading does not count against a cell measured
        // solid — twice, so one stray reading cannot do it — from as near or
        // nearer. It used to, and a sunlit wall beside a pane read as more pane.
        for v in voids {
            let w = walls[v.wall]
            if v.range >= w.near2[v.cell] { continue }
            w.through[v.cell] += v.weight
        }

        var found: [(opening: ScanOpening, votes: Int)] = []
        for (wi, w) in walls.enumerated() {
            let cells = w.cols * w.rows
            let glassy = (0..<cells).map {
                w.through[$0] >= minThrough && w.through[$0] >= throughRatio * w.solid[$0]
            }

            // Patches: glass cells within two cells of each other along the
            // wall, or three up it, belong together. Rays are sparse, so a pane
            // is seen as a speckle — and the extra row bridges a transom.
            var label = Array(repeating: -1, count: cells)
            var next = 0
            for start in 0..<cells where glassy[start] && label[start] < 0 {
                var stack = [start]
                label[start] = next
                var c0 = w.cols, c1 = -1, r0 = w.rows, r1 = -1, votes = 0
                while let i = stack.popLast() {
                    let c = i % w.cols, r = i / w.cols
                    c0 = min(c0, c); c1 = max(c1, c)
                    r0 = min(r0, r); r1 = max(r1, r)
                    votes += w.through[i]
                    for dr in -3...3 {
                        for dc in -2...2 {
                            let rr = r + dr, cc = c + dc
                            guard rr >= 0, cc >= 0, rr < w.rows, cc < w.cols else { continue }
                            let j = rr * w.cols + cc
                            if glassy[j] && label[j] < 0 {
                                label[j] = next
                                stack.append(j)
                            }
                        }
                    }
                }
                let id = next
                next += 1

                // Trim the outline back to the pane. Joining across gaps makes a
                // sparse speckle one pane, but also lets a stray see-through cell
                // or two in the solid wall beside it drag an edge out — in strong
                // sun, by half a metre. An edge column or row stays only where,
                // of what was seen in it, most is this pane.
                func lineFill(_ line: [Int]) -> Double {
                    var seenHere = 0, mine = 0
                    for j in line {
                        if w.through[j] + w.solid[j] > 0 { seenHere += 1 }
                        if label[j] == id { mine += 1 }
                    }
                    return seenHere == 0 ? 0 : Double(mine) / Double(seenHere)
                }
                func column(_ c: Int) -> [Int] { (r0...r1).map { r in r * w.cols + c } }
                func row(_ r: Int) -> [Int] { (c0...c1).map { c in r * w.cols + c } }
                while c0 < c1, lineFill(column(c0)) < edgeFill { c0 += 1 }
                while c1 > c0, lineFill(column(c1)) < edgeFill { c1 -= 1 }
                // Not the floor or ceiling row: hits on the floor or ceiling right
                // at the wall land there too, so glass reaching them looks thin.
                while r0 > 0, r0 < r1, lineFill(row(r0)) < edgeFill { r0 += 1 }
                while r1 < w.rows - 1, r1 > r0, lineFill(row(r1)) < edgeFill { r1 -= 1 }

                let width = Double(c1 - c0 + 1) * cellMm
                let height = Double(r1 - r0 + 1) * cellMm
                guard width >= minSideMm, height >= minSideMm, votes >= minVotes else { continue }

                // Of what was actually SEEN inside the patch, most must be
                // see-through. Unobserved cells are not held against it.
                var seen = 0, clear = 0
                for r in r0...r1 {
                    for c in c0...c1 {
                        let j = r * w.cols + c
                        if w.through[j] + w.solid[j] > 0 { seen += 1 }
                        if glassy[j] { clear += 1 }
                    }
                }
                // …and the see-through evidence must be dense where it was
                // seen: glass gives it from every look, a solid wall that is
                // merely hard to measure (sun on it, seen from far off) now and
                // then.
                guard seen > 0, Double(clear) / Double(seen) >= minFill,
                      Double(votes) >= minDensity * Double(seen) else { continue }

                let offset = Double(c0) * cellMm
                let bottom = Double(r0) * cellMm
                let top = min(ceilingMm, Double(r1 + 1) * cellMm)
                let toFloor = bottom <= doorSillMm
                let opening = ScanOpening(
                    type: toFloor ? .door : .window,
                    wall: wi,
                    offset: offset,
                    width: min(width, w.length - offset),
                    height: toFloor ? top : top - bottom,
                    sill: toFloor ? 0 : bottom,
                    glass: true
                )

                // Already on the plan — RoomPlan recognised this one itself.
                let duplicate = existing.contains { e in
                    guard e.wall == wi else { return false }
                    let overlap = min(e.offset + e.width, opening.offset + opening.width)
                        - max(e.offset, opening.offset)
                    return overlap >= 0.5 * min(e.width, opening.width)
                }
                if !duplicate { found.append((opening, votes)) }
            }
        }
        return found
            .sorted { ($0.opening.wall, $0.opening.offset) < ($1.opening.wall, $1.opening.offset) }
            .map(\.opening)
    }
}
