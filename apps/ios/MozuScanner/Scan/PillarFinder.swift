// Find the columns standing in a room from the depth readings themselves — for
// when RoomPlan reports them badly or not at all.
//
// WHY THIS EXISTS. RoomPlan has no category for a column. A round pillar in the
// middle of an open-plan flat comes back as a curved wall (iOS 17), as one or
// two flat "walls" for the faces it happened to see, or as nothing. `WallLoop`
// makes the most of the first two; this covers the rest, from evidence that
// does not depend on RoomPlan recognising anything.
//
// THE ONE PHYSICAL FACT USED. A column runs from the floor to the ceiling.
// Nothing else standing clear of the walls does: a sofa stops below a metre, a
// table at 750mm, a fridge or a bookcase short of the ceiling, and a pendant
// lamp starts well below it and never reaches the floor. So the readings that
// land in the room — clear of the walls, off the floor and below the ceiling —
// are binned into a floor-plan grid, each cell remembering which heights it was
// seen at. A patch of cells seen over most of the height, right up to just
// under the ceiling, is a column. A circle fit through its readings gives a
// round column's centre and diameter even from one side; otherwise the box
// whose faces the readings lie on is a square column.
//
// WHAT IT CANNOT TELL APART. A freestanding floor-to-ceiling cupboard is, to a
// depth sensor, a box column. Columns found here can be removed with one tap.
//
// Millimetres, y = height above the floor. Pure, and an exact mirror of
// src/systems/scan/pillarFinder.ts, which carries the tests.

import Foundation

enum PillarFinder {

    /// Something already known to stand there — a RoomPlan object.
    struct Footprint {
        var center: Vec2
        var width: Double
        var depth: Double
        /// Yaw of the width axis, plan convention: (cos r, sin r).
        var rotation: Double
    }

    // MARK: Tuning (kept identical to the TypeScript mirror)

    static let cellMm = 100.0
    static let wallClearMm = 250.0
    static let surfaceBandMm = 150.0
    static let bands = 8
    static let minBands = 6
    /// Nothing standing clear of the walls in a home reaches 3 m except a
    /// column, and in a tall room the sensor may never reach the ceiling — in
    /// sunlight it stops near 4 m.
    static let columnMm = 3000.0
    static let minCellHits = 2
    static let minHits = 40
    static let minSpanMm = 120.0
    static let maxSpanMm = 1300.0
    static let maxAspect = 2.5
    /// More than `wallClearMm`: readings in that band are never looked at, so
    /// something that seems to stop at its edge may run on to the wall.
    static let footprintClearMm = 300.0
    /// A round column may reach this far into the wall line.
    static let wallTouchMm = 100.0

    private final class Cell {
        let key: Int
        let ix: Int
        let iz: Int
        var bands = 0
        var pts: [Int] = []
        init(key: Int, ix: Int, iz: Int) { self.key = key; self.ix = ix; self.iz = iz }
    }

    static func pillars(
        rays: [GlassFinder.Ray],
        polygon: [Vec2],
        ceilingMm: Double,
        exclude: [Footprint] = []
    ) -> [WallLoop.Pillar] {
        let lo = surfaceBandMm
        let hi = ceilingMm - surfaceBandMm
        guard polygon.count >= 3, !rays.isEmpty, hi - lo >= 500 else { return [] }
        let bandMm = (hi - lo) / Double(bands)

        var minX = Double.infinity, minZ = Double.infinity, maxX = -Double.infinity
        for p in polygon {
            minX = min(minX, p.x); maxX = max(maxX, p.x); minZ = min(minZ, p.z)
        }
        let cols = Int(((maxX - minX) / cellMm).rounded(.down)) + 1

        // 1 — Bin the readings that are in the room, clear of walls, floor and ceiling.
        var xs: [Double] = [], zs: [Double] = [], ex: [Double] = [], ez: [Double] = []
        var cells: [Int: Cell] = [:]
        for ray in rays {
            guard ray.confidence >= 1 else { continue }
            let hit = ray.hit, eye = ray.eye
            guard hit.y > lo, hit.y < hi else { continue }
            let p = Vec2(x: hit.x, z: hit.z)
            guard inside(p, polygon), edgeClearance(p, polygon) >= wallClearMm else { continue }
            let ix = Int(((hit.x - minX) / cellMm).rounded(.down))
            let iz = Int(((hit.z - minZ) / cellMm).rounded(.down))
            let key = iz * cols + ix
            let cell: Cell
            if let existing = cells[key] {
                cell = existing
            } else {
                cell = Cell(key: key, ix: ix, iz: iz)
                cells[key] = cell
            }
            let band: Int = min(bands - 1, Int(((hit.y - lo) / bandMm).rounded(.down)))
            cell.bands |= 1 << band
            cell.pts.append(xs.count)
            xs.append(hit.x); zs.append(hit.z); ex.append(eye.x); ez.append(eye.z)
        }

        // The band a column must be seen in (or above): the top one, or the one
        // holding `columnMm` in a room taller than that.
        let columnBand: Int = Int(((columnMm - lo) / bandMm).rounded(.down))
        let topBand: Int = min(bands - 1, max(0, columnBand))

        // 2 — Patches of well-seen cells seen that HIGH UP, a one-cell gap
        // allowed. Only cells seen that high link up, so a person, a chair or a
        // bookcase beside a column never joins it. Key order, as the twin does.
        let live = cells.values
            .filter { $0.pts.count >= minCellHits && ($0.bands >> topBand) != 0 }
            .sorted { $0.key < $1.key }
        var byKey: [Int: Cell] = [:]
        for c in live { byKey[c.key] = c }
        var seen = Set<Int>()
        var found: [WallLoop.Pillar] = []
        for start in live {
            guard !seen.contains(start.key) else { continue }
            var patch: [Cell] = []
            var stack = [start]
            seen.insert(start.key)
            while let c = stack.popLast() {
                patch.append(c)
                for dz in -2...2 {
                    for dx in -2...2 {
                        let ix = c.ix + dx, iz = c.iz + dz
                        guard ix >= 0, ix < cols else { continue }
                        if let n = byKey[iz * cols + ix], !seen.contains(n.key) {
                            seen.insert(n.key)
                            stack.append(n)
                        }
                    }
                }
            }

            // 3 — Floor to ceiling? Most of the height, right up under the
            // ceiling (or above `columnMm`), and at least one cell seen over
            // most of it on its own (a lamp above a table is two things).
            var mask = 0, best = 0
            for c in patch {
                mask |= c.bands
                best = max(best, c.bands.nonzeroBitCount)
            }
            guard mask.nonzeroBitCount >= minBands, (mask >> topBand) != 0, best >= minBands - 2 else { continue }

            // Fit on the patch AND the cells right next to it seen nearly as
            // high: the test that found the column leaves only scraps of each
            // face in a sparse scan, while a person beside it never gets that high.
            var near = Set<Int>()
            for c in patch {
                for dz in -1...1 {
                    for dx in -1...1 {
                        let ix = c.ix + dx
                        guard ix >= 0, ix < cols else { continue }
                        let k = (c.iz + dz) * cols + ix
                        if let m = cells[k], (m.bands >> max(0, topBand - 1)) != 0 { near.insert(k) }
                    }
                }
            }
            let idx = near.flatMap { cells[$0]!.pts }.sorted()
            guard idx.count >= minHits else { continue }

            guard let pillar = fit(
                px: idx.map { xs[$0] }, pz: idx.map { zs[$0] },
                ex: idx.map { ex[$0] }, ez: idx.map { ez[$0] }
            ) else { continue }

            // 4 — Where it stands: inside the room, clear of the walls, not
            // already known as furniture, not found twice.
            let clear: Bool
            if pillar.shape == .round {
                // A round one may stand right against a wall — the concrete
                // column at a glass wall — since nothing that only looks like a
                // column there (a tall cupboard) is round. A box must stand clear.
                let reach: Double = edgeClearance(pillar.center, polygon)
                clear = inside(pillar.center, polygon) && reach >= pillar.width / 2 - wallTouchMm
            } else {
                clear = corners(pillar).allSatisfy {
                    inside($0, polygon) && edgeClearance($0, polygon) >= footprintClearMm
                }
            }
            guard clear else { continue }
            if exclude.contains(where: { within(pillar.center, $0, grow: 150) }) { continue }
            if found.contains(where: { overlaps($0, pillar) }) { continue }
            found.append(pillar)
        }
        return found.sorted { ($0.center.x, $0.center.z) < ($1.center.x, $1.center.z) }
    }

    /// Columns from both sources, each once. RoomPlan's surfaces measure a
    /// column best when it saw several faces, so those stand; one it saw a
    /// single face of (`partial`) gives way to what the depth readings found
    /// there; and the depth readings add the columns RoomPlan did not report.
    static func merge(fromWalls: [WallLoop.Pillar], fromDepth: [WallLoop.Pillar]) -> [WallLoop.Pillar] {
        let kept = fromWalls.filter { p in !p.partial || !fromDepth.contains { overlaps(p, $0) } }
        return kept + fromDepth.filter { d in !kept.contains { overlaps($0, d) } }
    }

    // MARK: Fitting

    /// Round if the readings sit on an arc seen from outside — the circle behind
    /// them, and fitting them more tightly than any box does; else the box whose
    /// faces they lie on, squared up when only one face was seen and set back
    /// from it, away from where it was seen from.
    private static func fit(px: [Double], pz: [Double], ex: [Double], ez: [Double]) -> WallLoop.Pillar? {
        let n = px.count
        let count = Double(n)

        // The box whose faces the readings lie on, a degree apart, first on a
        // tie. Not the smallest box: two faces seen round a corner make an L,
        // and an L's smallest box can sit at 45° to it.
        func sides(_ deg: Int) -> (a: Double, c: Double, s: Double, u0: Double, u1: Double, v0: Double, v1: Double, e2: Double) {
            let a: Double = Double(deg) * Double.pi / 180
            let c: Double = cos(a), s: Double = sin(a)
            var us = [Double](repeating: 0, count: n), vs = [Double](repeating: 0, count: n)
            var u0 = Double.infinity, u1 = -Double.infinity, v0 = Double.infinity, v1 = -Double.infinity
            for i in 0..<n {
                us[i] = px[i] * c + pz[i] * s
                vs[i] = -px[i] * s + pz[i] * c
            }
            for i in 0..<n {
                u0 = min(u0, us[i]); u1 = max(u1, us[i]); v0 = min(v0, vs[i]); v1 = max(v1, vs[i])
            }
            var e2 = 0.0
            for i in 0..<n {
                let eu: Double = min(us[i] - u0, u1 - us[i])
                let ev: Double = min(vs[i] - v0, v1 - vs[i])
                let e: Double = min(eu, ev)
                e2 += e * e
            }
            return (a, c, s, u0, u1, v0, v1, e2)
        }
        var box = sides(0)
        for deg in 1..<90 {
            let b = sides(deg)
            if b.e2 < box.e2 - 1e-6 { box = b }
        }
        let a = box.a, c = box.c, s = box.s
        // How far the readings sit from the box's faces: noise for a square
        // column, the bulge of the arc for a round one.
        let boxRms = (box.e2 / count).squareRoot()
        var eu = 0.0, ev = 0.0
        for i in 0..<n {
            eu += ex[i] * c + ez[i] * s
            ev += -ex[i] * s + ez[i] * c
        }
        eu /= count; ev /= count

        let fullTurn: Double = 2 * Double.pi
        let minArc: Double = 70 * Double.pi / 180
        if let circle = fitCircle(px, pz) {
            let across: Double = circle.r * 2
            let tolerance: Double = max(15, 0.1 * circle.r)
            if across >= minSpanMm, across <= maxSpanMm, circle.rms <= tolerance, circle.rms < boxRms {
                // How much of the circle the readings cover, and whether its
                // centre lies BEHIND them as seen — the outside of a column, not
                // the inside of a curved wall.
                var angles: [Double] = []
                angles.reserveCapacity(n)
                for i in 0..<n { angles.append(atan2(pz[i] - circle.cz, px[i] - circle.cx)) }
                angles.sort()
                var gap: Double = fullTurn - angles[n - 1] + angles[0]
                for i in 1..<n { gap = max(gap, angles[i] - angles[i - 1]) }
                var behind = 0
                for i in 0..<n {
                    let alongX: Double = (circle.cx - px[i]) * (px[i] - ex[i])
                    let alongZ: Double = (circle.cz - pz[i]) * (pz[i] - ez[i])
                    if alongX + alongZ > 0 { behind += 1 }
                }
                if fullTurn - gap >= minArc, Double(behind) >= 0.8 * count {
                    return WallLoop.Pillar(
                        center: Vec2(x: circle.cx, z: circle.cz), shape: .round, width: across, depth: across, rotation: 0
                    )
                }
            }
        }

        var w = box.u1 - box.u0, d = box.v1 - box.v0
        var uc = (box.u0 + box.u1) / 2, vc = (box.v0 + box.v1) / 2
        // One face seen: a square column whose far side was never in view.
        if d < 0.3 * w {
            let away: Double = ev > vc ? -1 : 1
            vc += away * (w - d) / 2
            d = w
        } else if w < 0.3 * d {
            let away: Double = eu > uc ? -1 : 1
            uc += away * (d - w) / 2
            w = d
        }
        // A tall cupboard's front, or a stub of wall, is long and thin; a column is not.
        let short: Double = min(w, d), long: Double = max(w, d)
        guard short >= minSpanMm, long <= maxSpanMm, long <= maxAspect * short else { return nil }
        return WallLoop.Pillar(
            center: Vec2(x: uc * c - vc * s, z: uc * s + vc * c),
            shape: .box, width: w, depth: d, rotation: a
        )
    }

    /// Least-squares circle (Kåsa), points centred first.
    private static func fitCircle(_ xs: [Double], _ zs: [Double]) -> (cx: Double, cz: Double, r: Double, rms: Double)? {
        let n = xs.count
        guard n >= 3 else { return nil }
        var mx = 0.0, mz = 0.0
        for i in 0..<n { mx += xs[i]; mz += zs[i] }
        mx /= Double(n); mz /= Double(n)
        var sxx = 0.0, sxz = 0.0, szz = 0.0, sx = 0.0, sz = 0.0, bx = 0.0, bz = 0.0, b1 = 0.0
        for i in 0..<n {
            let x = xs[i] - mx, z = zs[i] - mz, r2 = x * x + z * z
            sxx += x * x; sxz += x * z; szz += z * z; sx += x; sz += z
            bx -= r2 * x; bz -= r2 * z; b1 -= r2
        }
        func det3(_ a: [[Double]]) -> Double {
            a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1])
                - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
                + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
        }
        let m = [[sxx, sxz, sx], [sxz, szz, sz], [sx, sz, Double(n)]]
        let rhs = [bx, bz, b1]
        let det = det3(m)
        guard abs(det) >= 1e-9 else { return nil }
        func solved(_ c: Int) -> Double {
            det3(m.enumerated().map { i, row in
                row.enumerated().map { j, v in j == c ? rhs[i] : v }
            }) / det
        }
        let cx = -solved(0) / 2, cz = -solved(1) / 2
        let r2 = cx * cx + cz * cz - solved(2)
        guard r2 > 0 else { return nil }
        let r = r2.squareRoot()
        var e2 = 0.0
        for i in 0..<n {
            let e = length(xs[i] - mx - cx, zs[i] - mz - cz) - r
            e2 += e * e
        }
        return (cx + mx, cz + mz, r, (e2 / Double(n)).squareRoot())
    }

    // MARK: Geometry (square roots, not hypot: the twin must get the same bits)

    private static func length(_ x: Double, _ z: Double) -> Double { (x * x + z * z).squareRoot() }

    private static func distToSegment(_ p: Vec2, _ a: Vec2, _ b: Vec2) -> Double {
        let abx: Double = b.x - a.x, abz: Double = b.z - a.z
        let l2: Double = abx * abx + abz * abz
        if l2 < 1e-9 { return length(p.x - a.x, p.z - a.z) }
        let along: Double = (p.x - a.x) * abx + (p.z - a.z) * abz
        let t: Double = max(0, min(1, along / l2))
        return length(p.x - a.x - abx * t, p.z - a.z - abz * t)
    }

    private static func edgeClearance(_ p: Vec2, _ poly: [Vec2]) -> Double {
        var d = Double.infinity
        for k in poly.indices { d = min(d, distToSegment(p, poly[k], poly[(k + 1) % poly.count])) }
        return d
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

    private static func within(_ p: Vec2, _ f: Footprint, grow: Double) -> Bool {
        let c: Double = cos(f.rotation), s: Double = sin(f.rotation)
        let dx: Double = p.x - f.center.x, dz: Double = p.z - f.center.z
        let u: Double = dx * c + dz * s
        let v: Double = dz * c - dx * s
        return abs(u) <= f.width / 2 + grow && abs(v) <= f.depth / 2 + grow
    }

    /// Two columns closer than their half-sizes summed are the same column.
    private static func overlaps(_ a: WallLoop.Pillar, _ b: WallLoop.Pillar) -> Bool {
        let gap: Double = length(a.center.x - b.center.x, a.center.z - b.center.z)
        let reach: Double = (max(a.width, a.depth) + max(b.width, b.depth)) / 2
        return gap < reach
    }

    private static func corners(_ p: WallLoop.Pillar) -> [Vec2] {
        let c: Double = cos(p.rotation), s: Double = sin(p.rotation)
        let hw: Double = p.width / 2, hd: Double = p.depth / 2
        let signs: [(u: Double, v: Double)] = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
        return signs.map { k -> Vec2 in
            let along: Double = k.u * hw, across: Double = k.v * hd
            return Vec2(x: p.center.x + along * c - across * s, z: p.center.z + along * s + across * c)
        }
    }
}
