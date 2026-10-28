import Foundation

/// The ceiling, from the depth readings banked on the scan — the Swift twin of
/// `src/systems/scan/ceilingFinder.ts`. Keep them in step: the Swift ⇄
/// TypeScript parity test holds them to the same answers.
///
/// RoomPlan gives one height for the whole room. A real ceiling is not one
/// height — a bulkhead along the windows, a boxed-in beam, edges that run at an
/// angle — and an open ceiling (expanded metal mesh) is not even one surface to
/// the sensor: its dots pass through to the slab above. So the readings that
/// landed overhead are binned on a floor-plan grid, each cell takes the LOWEST
/// surface seen there, the height present over most of the room is the
/// ceiling, and the areas lower or higher are traced into outlines.
enum CeilingFinder {

    struct Zone {
        /// Counter-clockwise in (x, z), millimetres.
        var polygon: [Vec2]
        /// Height of the ceiling over this area, mm off the floor.
        var height: Double
    }

    struct Analysis {
        /// The ceiling over most of the room, mm off the floor.
        var height: Double
        /// For a see-through ceiling: the slab seen through it.
        var seeThroughTo: Double?
        /// Bulkheads and soffits (lower), recesses (higher).
        var zones: [Zone]
    }

    // MARK: Tuning (kept identical to the TypeScript mirror)

    static let cellMm = 100.0
    static let wallClearMm = 80.0
    static let minHeightMm = 1950.0
    static let minRiseMm = 300.0
    static let minHits = 4
    static let surfaceMm = 60.0
    static let surfaceShare = 0.15
    static let pooledShare = 0.04
    static let ceilingPresence = 0.5
    static let upMaxShare = 0.03
    static let excludeMarginMm = 150.0
    static let fillPasses = 4
    static let flatShare = 0.6
    static let plenumGapMm = 150.0
    static let seeThroughShare = 0.3
    static let stepMm = 100.0
    static let minZoneAreaMm2 = 200_000.0
    static let minZoneSideMm = 200.0
    static let simplifyMm = 70.0
    static let snapMm = 150.0
    /// After tracing, a corner whose triangle with its neighbours is smaller
    /// than this is grid noise and is dropped (smallest first), mm². Never more
    /// than a tenth of the bulkhead's own area, so a small one keeps its corners.
    static let cornerAreaMm2 = 150_000.0
    static let minCells = 30

    private static let unknown: Int8 = 9

    // MARK: Geometry helpers

    private static func inside(_ p: Vec2, _ poly: [Vec2]) -> Bool {
        var result = false
        var j = poly.count - 1
        for i in 0..<poly.count {
            let a = poly[i], b = poly[j]
            if (a.z > p.z) != (b.z > p.z) {
                let x: Double = (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x
                if p.x < x { result.toggle() }
            }
            j = i
        }
        return result
    }

    private static func nearestOnSegment(_ p: Vec2, _ a: Vec2, _ b: Vec2) -> (q: Vec2, d: Double) {
        let abx = b.x - a.x
        let abz = b.z - a.z
        let len2: Double = abx * abx + abz * abz
        var t: Double = len2 > 0 ? ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2 : 0
        t = max(0, min(1, t))
        let q = Vec2(x: a.x + abx * t, z: a.z + abz * t)
        let dx = p.x - q.x
        let dz = p.z - q.z
        return (q, (dx * dx + dz * dz).squareRoot())
    }

    /// The room corner nearest p, and how far it is.
    private static func nearestCorner(_ p: Vec2, _ poly: [Vec2]) -> (q: Vec2, d: Double) {
        var best: (q: Vec2, d: Double) = (p, Double.infinity)
        for c in poly {
            let d = ((p.x - c.x) * (p.x - c.x) + (p.z - c.z) * (p.z - c.z)).squareRoot()
            if d < best.d { best = (c, d) }
        }
        return best
    }

    /// Drop the corners that are only grid noise: repeatedly the one whose
    /// triangle with its two neighbours is smallest, while that is under
    /// `minArea`. Where it meets a wall is where the wall's top steps, so those
    /// corners stay, unless they are only a point along the wall.
    private static func pruneByArea(_ loop: [Vec2], _ minArea: Double, _ polygon: [Vec2]) -> [Vec2] {
        var pts = loop
        while pts.count > 3 {
            let n = pts.count
            var k = -1
            var best = Double.infinity
            for i in 0..<n {
                let a = pts[(i - 1 + n) % n]
                let b = pts[i]
                let c = pts[(i + 1) % n]
                let cross: Double = (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)
                let area = abs(cross) / 2
                if area >= 1000 && nearestWall(b, polygon).d <= 1 { continue }
                if area < best {
                    best = area
                    k = i
                }
            }
            if k < 0 || best >= minArea { break }
            pts.remove(at: k)
        }
        return pts
    }

    private static func nearestWall(_ p: Vec2, _ poly: [Vec2]) -> (q: Vec2, d: Double) {
        var best: (q: Vec2, d: Double) = (p, Double.infinity)
        for i in 0..<poly.count {
            let hit = nearestOnSegment(p, poly[i], poly[(i + 1) % poly.count])
            if hit.d < best.d { best = hit }
        }
        return best
    }

    private static func median(_ sorted: [Double]) -> Double {
        let n = sorted.count
        return n % 2 == 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    }

    /// The lowest window of `surfaceMm` holding `need` readings, as its median.
    private static func lowestSurface(_ hs: [Double], from: Int, need: Int) -> Double? {
        var j = from
        var i = from
        while i < hs.count {
            while hs[i] - hs[j] > surfaceMm { j += 1 }
            if i - j + 1 >= need {
                let lo = hs[j]
                var run: [Double] = []
                var k = j
                while k < hs.count && hs[k] - lo <= surfaceMm {
                    run.append(hs[k])
                    k += 1
                }
                return median(run)
            }
            i += 1
        }
        return nil
    }

    private static func signedArea(_ poly: [Vec2]) -> Double {
        var a = 0.0
        for i in 0..<poly.count {
            let p = poly[i], q = poly[(i + 1) % poly.count]
            a += p.x * q.z - q.x * p.z
        }
        return a / 2
    }

    /// Douglas–Peucker on an open chain, keeping both ends.
    private static func simplifyChain(_ pts: [Vec2], _ tol: Double) -> [Vec2] {
        if pts.count <= 2 { return pts }
        let a = pts[0], b = pts[pts.count - 1]
        var worst = -1
        var worstD = -1.0
        for i in 1..<(pts.count - 1) {
            let d = nearestOnSegment(pts[i], a, b).d
            if d > worstD {
                worstD = d
                worst = i
            }
        }
        if worstD <= tol { return [a, b] }
        let left = simplifyChain(Array(pts[0...worst]), tol)
        let right = simplifyChain(Array(pts[worst...]), tol)
        return Array(left.dropLast()) + right
    }

    /// Douglas–Peucker on a closed outline: split at the vertex farthest from the first.
    private static func simplifyLoop(_ loop: [Vec2], _ tol: Double) -> [Vec2] {
        if loop.count <= 3 { return loop }
        var far = 0
        var farD = -1.0
        for i in 1..<loop.count {
            let dx = loop[i].x - loop[0].x
            let dz = loop[i].z - loop[0].z
            let d: Double = dx * dx + dz * dz
            if d > farD {
                farD = d
                far = i
            }
        }
        let one = simplifyChain(Array(loop[0...far]), tol)
        let two = simplifyChain(Array(loop[far...]) + [loop[0]], tol)
        return Array(one.dropLast()) + Array(two.dropLast())
    }

    /// The outer outline of a set of grid cells, as grid corners, counter-clockwise.
    private static func traceOutline(_ member: (Int, Int) -> Bool, _ cells: [Int], _ cols: Int) -> [(Int, Int)] {
        var out: [Int: [(Int, Int)]] = [:]
        func key(_ x: Int, _ y: Int) -> Int { y * (cols + 1) + x }
        func addEdge(_ x0: Int, _ y0: Int, _ x1: Int, _ y1: Int) {
            out[key(x0, y0), default: []].append((x1, y1))
        }
        for i in cells {
            let c = i % cols
            let r = i / cols
            if !member(c, r - 1) { addEdge(c, r, c + 1, r) }
            if !member(c + 1, r) { addEdge(c + 1, r, c + 1, r + 1) }
            if !member(c, r + 1) { addEdge(c + 1, r + 1, c, r + 1) }
            if !member(c - 1, r) { addEdge(c, r + 1, c, r) }
        }
        var best: [(Int, Int)] = []
        var bestArea = 0
        for s in out.keys.sorted() {
            while !(out[s]?.isEmpty ?? true) {
                var loop: [(Int, Int)] = []
                var x = s % (cols + 1)
                var y = s / (cols + 1)
                var px = x
                var py = y - 1
                while let list = out[key(x, y)], !list.isEmpty {
                    let inx = x - px
                    let iny = y - py
                    var pick = 0
                    var pickRank = 9
                    for k in 0..<list.count {
                        let ox = list[k].0 - x
                        let oy = list[k].1 - y
                        let cross: Int = inx * oy - iny * ox
                        let dotp: Int = inx * ox + iny * oy
                        let rank: Int = cross > 0 ? 0 : dotp > 0 ? 1 : cross < 0 ? 2 : 3
                        if rank < pickRank {
                            pickRank = rank
                            pick = k
                        }
                    }
                    let next = out[key(x, y)]!.remove(at: pick)
                    loop.append((x, y))
                    px = x
                    py = y
                    x = next.0
                    y = next.1
                    if key(x, y) == s { break }
                }
                var area = 0
                for k in 0..<loop.count {
                    let a = loop[k], b = loop[(k + 1) % loop.count]
                    area += a.0 * b.1 - b.0 * a.1
                }
                if area > bestArea {
                    bestArea = area
                    best = loop
                }
            }
        }
        return best
    }

    /// The walls' common direction, folded into a quarter turn.
    private static func wallAngle(_ polygon: [Vec2]) -> Double {
        var c = 0.0, s = 0.0
        for i in 0..<polygon.count {
            let a = polygon[i], b = polygon[(i + 1) % polygon.count]
            let dx = b.x - a.x, dz = b.z - a.z
            let len: Double = (dx * dx + dz * dz).squareRoot()
            let angle = atan2(dz, dx)
            c += len * cos(4 * angle)
            s += len * sin(4 * angle)
        }
        return (c * c + s * s).squareRoot() < 1e-9 ? 0 : atan2(s, c) / 4
    }

    private static func turn(_ p: Vec2, _ c: Double, _ s: Double) -> Vec2 {
        Vec2(x: p.x * c - p.z * s, z: p.x * s + p.z * c)
    }

    // MARK: Entry point

    static func ceiling(
        rays: [GlassFinder.Ray],
        polygon: [Vec2],
        exclude: [PillarFinder.Footprint] = []
    ) -> Analysis? {
        guard polygon.count >= 3, !rays.isEmpty else { return nil }
        // The grid runs along the walls, so a bulkhead's straight edge stays straight.
        let angle = wallAngle(polygon)
        let c = cos(-angle), s = sin(-angle)
        let square = polygon.map { turn($0, c, s) }
        let squareRays: [GlassFinder.Ray] = rays.map { r in
            let e = turn(Vec2(x: r.eye.x, z: r.eye.z), c, s)
            let h = turn(Vec2(x: r.hit.x, z: r.hit.z), c, s)
            var out = r
            out.eye = GlassFinder.Point3(x: e.x, y: r.eye.y, z: e.z)
            out.hit = GlassFinder.Point3(x: h.x, y: r.hit.y, z: h.z)
            return out
        }
        let squareExclude: [PillarFinder.Footprint] = exclude.map { f in
            var out = f
            out.center = turn(f.center, c, s)
            out.rotation = f.rotation - angle
            return out
        }
        guard let found = findSquare(squareRays, square, squareExclude) else { return nil }
        let bc = cos(angle), bs = sin(angle)
        return Analysis(
            height: found.height,
            seeThroughTo: found.seeThroughTo,
            zones: found.zones.map { Zone(polygon: $0.polygon.map { turn($0, bc, bs) }, height: $0.height) }
        )
    }

    private static func findSquare(
        _ rays: [GlassFinder.Ray],
        _ polygon: [Vec2],
        _ exclude: [PillarFinder.Footprint]
    ) -> Analysis? {
        var minX = Double.infinity, maxX = -Double.infinity, minZ = Double.infinity, maxZ = -Double.infinity
        for p in polygon {
            minX = min(minX, p.x); maxX = max(maxX, p.x)
            minZ = min(minZ, p.z); maxZ = max(maxZ, p.z)
        }
        let cols = max(1, Int(((maxX - minX) / cellMm).rounded(.up)))
        let rows = max(1, Int(((maxZ - minZ) / cellMm).rounded(.up)))
        let cells = cols * rows
        func centre(_ i: Int) -> Vec2 {
            let c = i % cols, r = i / cols
            return Vec2(x: minX + (Double(c) + 0.5) * cellMm, z: minZ + (Double(r) + 0.5) * cellMm)
        }
        var inRoom = [Bool](repeating: false, count: cells)
        for i in 0..<cells { inRoom[i] = inside(centre(i), polygon) }
        // The sides of a column or a tall cupboard are hit high up too.
        func excluded(_ p: Vec2) -> Bool {
            exclude.contains { e in
                let dx = p.x - e.center.x, dz = p.z - e.center.z
                let along: Double = dx * cos(e.rotation) + dz * sin(e.rotation)
                let across: Double = -dx * sin(e.rotation) + dz * cos(e.rotation)
                let halfW: Double = e.width / 2 + excludeMarginMm
                let halfD: Double = e.depth / 2 + excludeMarginMm
                return abs(along) <= halfW && abs(across) <= halfD
            }
        }
        for i in 0..<cells where inRoom[i] && excluded(centre(i)) { inRoom[i] = false }

        // What landed overhead, by cell.
        var heights = [[Double]](repeating: [], count: cells)
        for ray in rays {
            guard ray.confidence >= 1 else { continue }
            let eye = ray.eye, hit = ray.hit
            guard hit.y >= minHeightMm, hit.y - eye.y >= minRiseMm else { continue }
            let p = Vec2(x: hit.x, z: hit.z)
            guard inside(p, polygon), nearestWall(p, polygon).d >= wallClearMm else { continue }
            let c = min(cols - 1, max(0, Int(((hit.x - minX) / cellMm).rounded(.down))))
            let r = min(rows - 1, max(0, Int(((hit.z - minZ) / cellMm).rounded(.down))))
            heights[r * cols + c].append(hit.y)
        }
        for i in 0..<cells { heights[i].sort() }

        // Each cell's neighbourhood, pooled.
        var pooled = [[Double]](repeating: [], count: cells)
        for i in 0..<cells where inRoom[i] {
            let c = i % cols, r = i / cols
            var into: [Double] = []
            for dr in -1...1 {
                for dc in -1...1 {
                    let rr = r + dr, cc = c + dc
                    guard rr >= 0, cc >= 0, rr < rows, cc < cols else { continue }
                    into.append(contentsOf: heights[rr * cols + cc])
                }
            }
            into.sort()
            pooled[i] = into
        }
        func pooledNeed(_ n: Int) -> Int { max(3, Int((pooledShare * Double(n)).rounded(.up))) }
        func ownNeed(_ n: Int) -> Int { max(2, Int((surfaceShare * Double(n)).rounded(.up))) }

        // The ceiling: the lowest surface present over most of the room.
        var found: [Double] = []
        var neighbourhoods = 0
        for i in 0..<cells {
            let hs = pooled[i]
            guard inRoom[i], hs.count >= minHits else { continue }
            neighbourhoods += 1
            guard let low = lowestSurface(hs, from: 0, need: pooledNeed(hs.count)) else { continue }
            found.append(low)
            var k = 0
            while k < hs.count && hs[k] < low + plenumGapMm { k += 1 }
            if let high = lowestSurface(hs, from: k, need: pooledNeed(hs.count)) { found.append(high) }
        }
        guard neighbourhoods >= minCells, !found.isEmpty else { return nil }
        found.sort()
        var candidates: [Double] = []
        var i0 = 0
        while i0 < found.count {
            var j = i0
            while j + 1 < found.count && found[j + 1] - found[j] <= stepMm / 2 { j += 1 }
            if Double(j - i0 + 1) >= Double(minCells) / 3 { candidates.append(median(Array(found[i0...j]))) }
            i0 = j + 1
        }
        func presence(_ level: Double) -> Double {
            var n = 0
            for i in 0..<cells {
                let hs = pooled[i]
                guard inRoom[i], hs.count >= minHits else { continue }
                var near = 0
                for y in hs where abs(y - level) <= surfaceMm { near += 1 }
                if near >= 2 { n += 1 }
            }
            return Double(n) / Double(neighbourhoods)
        }
        var chosen: Double?
        var widest = -1.0
        var widestLevel: Double?
        for cand in candidates {
            let share = presence(cand)
            if share >= ceilingPresence {
                chosen = cand
                break
            }
            if share > widest {
                widest = share
                widestLevel = cand
            }
        }
        guard let height = chosen ?? widestLevel else { return nil }
        func atCeiling(_ hs: [Double]) -> Int {
            var n = 0
            for y in hs where abs(y - height) <= surfaceMm { n += 1 }
            return n
        }

        // Each cell: lower, level or higher (see the TypeScript for the why).
        var cls = [Int8](repeating: unknown, count: cells)
        var level = [Double](repeating: .nan, count: cells)
        var upward = [Bool](repeating: false, count: cells)
        for i in 0..<cells where inRoom[i] {
            let own = heights[i]
            if own.isEmpty { continue }
            if let under = lowestSurface(own, from: 0, need: 2), under < height - stepMm {
                cls[i] = -1
                level[i] = under
                continue
            }
            if atCeiling(own) > 0 {
                cls[i] = 0
                level[i] = height
                continue
            }
            let low = lowestSurface(own, from: 0, need: ownNeed(own.count))
            if let low, low > height + stepMm {
                level[i] = low
                let pooledShareAt: Double = Double(atCeiling(pooled[i]))
                if own.count >= minHits && pooledShareAt < upMaxShare * Double(pooled[i].count) {
                    cls[i] = 1
                } else {
                    upward[i] = true
                }
            } else if own.count < minHits {
                continue
            } else {
                cls[i] = 0
                level[i] = height
            }
        }

        // Fill what was not seen from its neighbours; then majority smoothing.
        func neighbourVotes(_ from: [Int8], _ i: Int) -> [Int] {
            let c = i % cols, r = i / cols
            var votes = [0, 0, 0, 0]
            for dr in -1...1 {
                for dc in -1...1 {
                    let rr = r + dr, cc = c + dc
                    if (dr == 0 && dc == 0) || rr < 0 || cc < 0 || rr >= rows || cc >= cols { continue }
                    let j = rr * cols + cc
                    guard inRoom[j] else { continue }
                    votes[3] += 1
                    let v = from[j]
                    if v != unknown { votes[Int(v) + 1] += 1 }
                }
            }
            return votes
        }
        var filled = cls
        for _ in 0..<fillPasses {
            var next = filled
            var changed = false
            for i in 0..<cells where inRoom[i] && filled[i] == unknown {
                let votes = neighbourVotes(filled, i)
                let top = max(votes[0], votes[1], votes[2])
                if top == 0 { continue }
                next[i] = votes[1] == top ? 0 : votes[0] == top ? -1 : 1
                changed = true
            }
            filled = next
            if !changed { break }
        }
        for i in 0..<cells where filled[i] == unknown { filled[i] = 0 }
        var smooth = filled
        for i in 0..<cells where inRoom[i] {
            let votes = neighbourVotes(filled, i)
            for v in 0..<3 where Int8(v - 1) != filled[i] && votes[v] >= 5 { smooth[i] = Int8(v - 1) }
        }

        // Close one-cell gaps in each kind.
        for kind: Int8 in [-1, 1] {
            var grown = [Bool](repeating: false, count: cells)
            for i in 0..<cells where inRoom[i] {
                let c = i % cols, r = i / cols
                let a: Bool = smooth[i] == kind
                let l: Bool = c > 0 && smooth[i - 1] == kind
                let rt: Bool = c < cols - 1 && smooth[i + 1] == kind
                let u: Bool = r > 0 && smooth[i - cols] == kind
                let d: Bool = r < rows - 1 && smooth[i + cols] == kind
                grown[i] = a || l || rt || u || d
            }
            for i in 0..<cells where inRoom[i] && smooth[i] == 0 && grown[i] {
                let c = i % cols, r = i / cols
                func keep(_ j: Int, _ ok: Bool) -> Bool { !ok || !inRoom[j] || grown[j] }
                if keep(i - 1, c > 0) && keep(i + 1, c < cols - 1) && keep(i - cols, r > 0) && keep(i + cols, r < rows - 1) {
                    smooth[i] = kind
                }
            }
        }

        // See-through: the slab shows above most of the ceiling.
        var slabs: [Double] = []
        var level0 = 0
        for i in 0..<cells {
            let hs = heights[i]
            guard cls[i] == 0, hs.count >= minHits else { continue }
            level0 += 1
            var k = 0
            while k < hs.count && hs[k] < height + plenumGapMm { k += 1 }
            if let high = lowestSurface(hs, from: k, need: ownNeed(hs.count)) { slabs.append(high) }
        }
        slabs.sort()
        let enoughSlab: Bool = level0 > 0 && Double(slabs.count) >= seeThroughShare * Double(level0)
        let seeThroughTo: Double? = enoughSlab ? median(slabs) : nil

        // Zones: connected areas lower or higher than the ceiling.
        var zones: [Zone] = []
        var seen = [Bool](repeating: false, count: cells)
        for start in 0..<cells {
            let kind = smooth[start]
            guard inRoom[start], !seen[start], kind == -1 || kind == 1 else { continue }
            var members: [Int] = []
            var stack = [start]
            seen[start] = true
            while let i = stack.popLast() {
                members.append(i)
                let c = i % cols, r = i / cols
                for (cc, rr) in [(c + 1, r), (c - 1, r), (c, r + 1), (c, r - 1)] {
                    guard rr >= 0, cc >= 0, rr < rows, cc < cols else { continue }
                    let j = rr * cols + cc
                    let joins: Bool = smooth[j] == kind || (kind == 1 && upward[j] && smooth[j] != -1)
                    if !seen[j] && inRoom[j] && joins {
                        seen[j] = true
                        stack.append(j)
                    }
                }
            }
            if Double(members.count) * cellMm * cellMm < minZoneAreaMm2 { continue }
            var c0 = cols, c1 = -1, r0 = rows, r1 = -1
            for i in members {
                let c = i % cols, r = i / cols
                c0 = min(c0, c); c1 = max(c1, c)
                r0 = min(r0, r); r1 = max(r1, r)
            }
            if Double(min(c1 - c0 + 1, r1 - r0 + 1)) * cellMm < minZoneSideMm { continue }
            let levels: [Double] = members
                .filter { cls[$0] == kind || (kind == 1 && upward[$0]) }
                .map { level[$0] }
                .sorted()
            if Double(levels.count) * cellMm * cellMm < minZoneAreaMm2 / 2 { continue }
            let zoneHeight = median(levels)
            var flat = 0
            for v in levels where abs(v - zoneHeight) <= surfaceMm { flat += 1 }
            if Double(flat) < flatShare * Double(levels.count) { continue }

            members.sort()
            let set = Set(members)
            let corners = traceOutline({ c, r in
                c >= 0 && r >= 0 && c < cols && r < rows && set.contains(r * cols + c)
            }, members, cols)
            var outline: [Vec2] = corners.map { Vec2(x: minX + Double($0.0) * cellMm, z: minZ + Double($0.1) * cellMm) }
            outline = simplifyLoop(outline, simplifyMm)
            // Onto the walls it meets — into the corner when it is that close
            // to one, so a bulkhead round a corner does not stop short of it.
            outline = outline.map { p in
                let c = nearestCorner(p, polygon)
                if c.d <= snapMm { return c.q }
                let w = nearestWall(p, polygon)
                return w.d <= snapMm || !inside(p, polygon) ? w.q : p
            }
            var clean: [Vec2] = []
            for p in outline {
                if let last = clean.last, abs(last.x - p.x) <= 1, abs(last.z - p.z) <= 1 { continue }
                clean.append(p)
            }
            if clean.count > 1, let a = clean.first, let b = clean.last, abs(a.x - b.x) <= 1, abs(a.z - b.z) <= 1 {
                clean.removeLast()
            }
            if clean.count < 3 || abs(signedArea(clean)) < minZoneAreaMm2 / 2 { continue }
            var pruned = cornerAreaMm2 > 0
                ? pruneByArea(clean, min(cornerAreaMm2, abs(signedArea(clean)) / 10), polygon)
                : clean
            if abs(signedArea(pruned)) < minZoneAreaMm2 / 2 { continue }
            if signedArea(pruned) < 0 { pruned.reverse() }
            zones.append(Zone(polygon: pruned, height: zoneHeight))
        }

        return Analysis(height: height, seeThroughTo: seeThroughTo, zones: zones)
    }
}
