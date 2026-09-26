// Find the glass RoomPlan missed — from what the depth sensor saw THROUGH it.
//
// WHY THIS EXISTS. RoomPlan finds a window by recognising a window. A sliding
// glass door, a floor-to-ceiling pane or a frameless partition does not look
// like one, so it comes back as plain wall and the plan says there is a wall
// where there is a view. Testers hit this first ("有玻璃偵測不到").
//
// THE ONE PHYSICAL FACT USED. LiDAR does not stop at clear glass. A reading
// taken through a pane lands on whatever is BEHIND it — the balcony rail, the
// building opposite — so it arrives well beyond the wall the room says is
// there. Solid wall can never do that: a reading on it lands ON it. So each
// depth reading gathered during the walk is kept as a ray from the camera;
// after the scan, every ray that leaves the room through a wall and ends
// clearly beyond it is a vote that the wall is see-through where it crossed.
// Readings that end ON the wall vote the other way. Patches where see-through
// wins, over an area the size of a window, are the glass.
//
// WHAT IT CANNOT TELL APART. A mirror returns depth from the reflected room,
// which also lands "behind" the wall — to a depth sensor a mirror IS a window
// into a second room. So are a doorway RoomPlan missed and a deep alcove.
// Everything found here is therefore marked `glass = true`, drawn dashed as a
// suggestion, and removable with one tap.
//
// Millimetres, y = height above the floor. Pure, and an exact mirror of
// src/systems/scan/glassFinder.ts, which carries the tests.

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
    static let endMarginMm = 150.0
    static let minThrough = 2
    static let throughRatio = 2
    static let minSideMm = 400.0
    static let minFill = 0.6
    static let minVotes = 12
    static let doorSillMm = 300.0

    private final class Grid {
        let a: Vec2
        let length: Double
        let d: Vec2
        let inward: Vec2
        let cols: Int
        let rows: Int
        var through: [Int]
        var solid: [Int]

        init(a: Vec2, length: Double, d: Vec2, inward: Vec2, cols: Int, rows: Int) {
            self.a = a; self.length = length; self.d = d; self.inward = inward
            self.cols = cols; self.rows = rows
            through = Array(repeating: 0, count: cols * rows)
            solid = Array(repeating: 0, count: cols * rows)
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

        for ray in rays {
            let eye = ray.eye, hit = ray.hit
            var exit: (wall: Int, f: Double)?
            for (wi, w) in walls.enumerated() where w.length > 0 {
                let sEye = (eye.x - w.a.x) * w.inward.x + (eye.z - w.a.z) * w.inward.z
                let sHit = (hit.x - w.a.x) * w.inward.x + (hit.z - w.a.z) * w.inward.z
                let tHit = (hit.x - w.a.x) * w.d.x + (hit.z - w.a.z) * w.d.z

                // Landed ON this wall: a vote that it is solid there.
                if abs(sHit) <= onWallMm, tHit >= 0, tHit <= w.length, hit.y >= 0, hit.y <= ceilingMm {
                    w.solid[w.cell(tHit, hit.y)] += 1
                }

                guard sEye > 0, sHit < -beyondMm else { continue }
                let f = sEye / (sEye - sHit)
                let cx = eye.x + (hit.x - eye.x) * f
                let cz = eye.z + (hit.z - eye.z) * f
                let t = (cx - w.a.x) * w.d.x + (cz - w.a.z) * w.d.z
                guard t >= endMarginMm, t <= w.length - endMarginMm else { continue }
                if exit == nil || f < exit!.f { exit = (wi, f) }
            }
            guard let exit else { continue }
            let w = walls[exit.wall]
            let y = eye.y + (hit.y - eye.y) * exit.f
            guard y >= 0, y <= ceilingMm else { continue }
            let cx = eye.x + (hit.x - eye.x) * exit.f
            let cz = eye.z + (hit.z - eye.z) * exit.f
            w.through[w.cell((cx - w.a.x) * w.d.x + (cz - w.a.z) * w.d.z, y)] += 1
        }

        var found: [(opening: ScanOpening, votes: Int)] = []
        for (wi, w) in walls.enumerated() {
            let cells = w.cols * w.rows
            let glassy = (0..<cells).map {
                w.through[$0] >= minThrough && w.through[$0] >= throughRatio * w.solid[$0]
            }

            // Patches: glass cells within two cells of each other belong
            // together. Rays are sparse, so a pane is seen as a speckle.
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
                    for dr in -2...2 {
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
                next += 1

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
                guard seen > 0, Double(clear) / Double(seen) >= minFill else { continue }

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
