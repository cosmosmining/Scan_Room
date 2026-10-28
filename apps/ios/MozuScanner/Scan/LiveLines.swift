// The lines the scan screen draws over the camera, worked out from the room so
// far instead of taken from RoomPlan's own overlay.
//
// RoomPlan redraws its lines every time it re-fits a surface, several times a
// second, so they flicker and jump; a door it fits short of the floor is drawn
// floating; and where the ceiling steps down to a bulkhead its walls run on to
// whichever height it saw last. Here the lines come from the model the floor
// plan is built from — WallLoop's outline, the ceiling finder's height and
// bulkheads, openings stood on the floor — after `SurfaceTracker` has held each
// surface still until a change in it has lasted.
//
// Two parts, both pure:
//
//   * `LiveLines.build` — a room (outline, ceiling, bulkheads, openings,
//     columns) → the line segments to draw. The top of each wall follows the
//     ceiling over it, stepping down under a bulkhead and back up after it,
//     whatever shape the bulkhead's edge has; doors stand on the floor.
//   * `SurfaceTracker` — the room's surfaces as they arrive, update after
//     update → the ones worth drawing, where to draw them. A surface is drawn
//     once it has been seen twice, outlives a missed update or four, ignores
//     wobble, and once it has held still it only moves for a change that lasts.
//
// Millimetres. Plan (x, z); y is height above the floor. The TypeScript twin,
// `src/systems/scan/liveLines.ts`, carries the tests; the parity harness holds
// the two together.

import Foundation

enum LiveLines {
    struct P3: Codable, Equatable {
        var x: Double
        var y: Double
        var z: Double
    }

    enum Kind: String, Codable {
        case floor, ceiling, corner, door, window, glass, bulkhead, pillar
    }

    struct Line: Codable, Equatable {
        var a: P3
        var b: P3
        var kind: Kind
    }

    /// A door, window or opening, placed by its centre — it is put on
    /// whichever wall it is at.
    struct Opening: Codable {
        var center: Vec2
        var width: Double
        /// Bottom and top of the box it was measured as, mm above the floor.
        var bottom: Double
        var top: Double
        /// "door", "window" or "archway".
        var type: String
        /// Suggested from readings that went through the wall.
        var glass: Bool?
    }

    struct Pillar: Codable {
        var center: Vec2
        /// "round" or "box".
        var shape: String
        var width: Double
        var depth: Double
        /// Yaw of the width axis, radians, plan sense.
        var rotation: Double
    }

    /// Part of the ceiling at another height — a bulkhead (lower) or a recess.
    struct Zone: Codable {
        var polygon: [Vec2]
        var height: Double
    }

    struct Room: Codable {
        /// The outline, either winding.
        var polygon: [Vec2]
        /// The main ceiling, mm above the floor.
        var ceiling: Double
        var zones: [Zone]
        var openings: [Opening]
        var pillars: [Pillar]
    }

    /// A bulkhead's corner this close to a room corner, or edge this close to
    /// a wall, is put on it.
    static let snapMm = 150.0
    /// How far inside a wall to look for the ceiling over it.
    static let probeMm = 30.0
    /// Heights closer than this are one height, not a step.
    static let minStepMm = 40.0
    /// A stretch of wall top shorter than this joins its neighbour.
    static let minRunMm = 150.0
    /// A point this close to a wall is on it.
    static let onWallMm = 1.0
    /// An opening further than this from every wall is not drawn.
    static let openingReachMm = 600.0
    /// Narrower or shorter than this is not an opening worth drawing.
    static let minOpeningMm = 100.0
    /// A door's box is run down to the floor by at most this.
    static let doorReachMm = 600.0
    /// Sides of the circle a round column is drawn with.
    static let circleSegments = 16

    private static func dist(_ a: Vec2, _ b: Vec2) -> Double {
        ((a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z)).squareRoot()
    }

    private static func nearestOnSegment(_ p: Vec2, _ a: Vec2, _ b: Vec2) -> (q: Vec2, d: Double, t: Double) {
        let abx = b.x - a.x
        let abz = b.z - a.z
        let len2 = abx * abx + abz * abz
        var t = len2 > 0 ? ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2 : 0
        t = max(0, min(1, t))
        let q = Vec2(x: a.x + abx * t, z: a.z + abz * t)
        return (q, dist(p, q), t)
    }

    private static func signedArea(_ poly: [Vec2]) -> Double {
        var s = 0.0
        for i in 0..<poly.count {
            let a = poly[i]
            let b = poly[(i + 1) % poly.count]
            s += a.x * b.z - b.x * a.z
        }
        return s / 2
    }

    private static func inside(_ p: Vec2, _ poly: [Vec2]) -> Bool {
        var hit = false
        var j = poly.count - 1
        for i in 0..<poly.count {
            let a = poly[i]
            let b = poly[j]
            if (a.z > p.z) != (b.z > p.z) {
                let x: Double = (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x
                if p.x < x { hit.toggle() }
            }
            j = i
        }
        return hit
    }

    /// Drop repeated points (within 1 mm), the closing repeat included.
    private static func dedupe(_ poly: [Vec2]) -> [Vec2] {
        var out: [Vec2] = []
        for p in poly {
            if let last = out.last, abs(last.x - p.x) <= 1, abs(last.z - p.z) <= 1 { continue }
            out.append(Vec2(x: p.x, z: p.z))
        }
        if out.count > 1, let a = out.first, let b = out.last, abs(a.x - b.x) <= 1, abs(a.z - b.z) <= 1 {
            out.removeLast()
        }
        return out
    }

    /// A bulkhead's outline put onto the room as it is now: corners near a room
    /// corner into it, edges near a wall onto it. The finder snapped it to the
    /// room it saw; the walls have moved a little since.
    private static func snapZone(_ zone: [Vec2], _ room: [Vec2]) -> [Vec2] {
        let n = room.count
        let snapped = zone.map { p -> Vec2 in
            var corner: Vec2?
            var cornerD = Double.infinity
            for c in room {
                let d = dist(p, c)
                if d < cornerD {
                    cornerD = d
                    corner = c
                }
            }
            if let corner, cornerD <= snapMm { return Vec2(x: corner.x, z: corner.z) }
            var wallQ = p
            var wallD = Double.infinity
            for i in 0..<n {
                let hit = nearestOnSegment(p, room[i], room[(i + 1) % n])
                if hit.d < wallD {
                    wallD = hit.d
                    wallQ = hit.q
                }
            }
            return wallD <= snapMm || !inside(p, room) ? Vec2(x: wallQ.x, z: wallQ.z) : Vec2(x: p.x, z: p.z)
        }
        let clean = dedupe(snapped)
        return clean.count >= 3 && abs(signedArea(clean)) >= 1000 ? clean : []
    }

    private struct Run {
        var t0: Double
        var t1: Double
        var h: Double
    }

    /// Neighbouring stretches at the same height become one, at the longer
    /// one's height.
    private static func joinEqual(_ runs: [Run]) -> [Run] {
        var out: [Run] = []
        for r in runs {
            if let last = out.last, abs(last.h - r.h) < minStepMm {
                let k = out.count - 1
                if r.t1 - r.t0 > last.t1 - last.t0 { out[k].h = r.h }
                out[k].t1 = r.t1
            } else {
                out.append(r)
            }
        }
        return out
    }

    /// …and a stretch too short to be a step of its own goes to the neighbour
    /// nearest its height.
    private static func mergeRuns(_ runs: [Run]) -> [Run] {
        var out = joinEqual(runs)
        while out.count > 1 {
            var k = -1
            var shortest = Double.infinity
            for i in 0..<out.count {
                let len = out[i].t1 - out[i].t0
                if len < minRunMm && len < shortest {
                    shortest = len
                    k = i
                }
            }
            if k < 0 { break }
            let hasPrev = k > 0
            let hasNext = k + 1 < out.count
            let toPrev = !hasNext || (hasPrev && abs(out[k - 1].h - out[k].h) <= abs(out[k + 1].h - out[k].h))
            if toPrev && hasPrev {
                out[k - 1].t1 = out[k].t1
            } else if hasNext {
                out[k + 1].t0 = out[k].t0
            }
            out.remove(at: k)
            out = joinEqual(out)
        }
        return out
    }

    static func build(_ room: Room) -> [Line] {
        let poly = dedupe(room.polygon)
        let n = poly.count
        guard n >= 3 else { return [] }
        let sign: Double = signedArea(poly) >= 0 ? 1 : -1
        let H = room.ceiling
        func at(_ p: Vec2, _ y: Double) -> P3 { P3(x: p.x, y: y, z: p.z) }

        let zones: [Zone] = room.zones
            .map { Zone(polygon: snapZone($0.polygon, poly), height: $0.height) }
            .filter { $0.polygon.count >= 3 && abs($0.height - H) >= minStepMm }

        /// The ceiling over a point: the lowest bulkhead it is under, else the ceiling.
        func heightAt(_ p: Vec2) -> Double {
            var h = Double.infinity
            for z in zones where z.height < h && inside(p, z.polygon) { h = z.height }
            return h == Double.infinity ? H : h
        }
        func onWall(_ p: Vec2) -> Int {
            for i in 0..<n where nearestOnSegment(p, poly[i], poly[(i + 1) % n]).d <= onWallMm { return i }
            return -1
        }

        var lines: [Line] = []
        var runsOf: [[Run]] = []

        // Each wall: its floor line, and its top following the ceiling over it.
        for i in 0..<n {
            let a = poly[i]
            let b = poly[(i + 1) % n]
            let L = dist(a, b)
            let dir = Vec2(x: (b.x - a.x) / L, z: (b.z - a.z) / L)
            let inward = Vec2(x: -dir.z * sign, z: dir.x * sign)
            lines.append(Line(a: at(a, 0), b: at(b, 0), kind: .floor))

            // Where a bulkhead's outline meets this wall, its top may step.
            var ts: [Double] = [0, L]
            for z in zones {
                for v in z.polygon {
                    let hit = nearestOnSegment(v, a, b)
                    if hit.d <= onWallMm { ts.append(hit.t * L) }
                }
            }
            ts.sort()
            var cuts: [Double] = []
            for t in ts where cuts.isEmpty || t - cuts[cuts.count - 1] > 1 { cuts.append(t) }
            cuts[0] = 0
            if cuts.count == 1 { cuts.append(L) } else { cuts[cuts.count - 1] = L }

            var raw: [Run] = []
            for k in 0..<(cuts.count - 1) {
                let tm = (cuts[k] + cuts[k + 1]) / 2
                let probe = Vec2(
                    x: a.x + dir.x * tm + inward.x * probeMm,
                    z: a.z + dir.z * tm + inward.z * probeMm
                )
                raw.append(Run(t0: cuts[k], t1: cuts[k + 1], h: heightAt(probe)))
            }
            let runs = mergeRuns(raw)
            runsOf.append(runs)
            func along(_ t: Double) -> Vec2 { Vec2(x: a.x + dir.x * t, z: a.z + dir.z * t) }
            for (k, r) in runs.enumerated() {
                lines.append(Line(a: at(along(r.t0), r.h), b: at(along(r.t1), r.h), kind: .ceiling))
                if k + 1 < runs.count {
                    let next = runs[k + 1]
                    let p = along(r.t1)
                    lines.append(Line(a: at(p, min(r.h, next.h)), b: at(p, max(r.h, next.h)), kind: .ceiling))
                }
            }
        }

        // Corners, floor to wherever the walls meet the ceiling.
        for i in 0..<n {
            let before = runsOf[(i - 1 + n) % n]
            let top = max(before[before.count - 1].h, runsOf[i][0].h)
            lines.append(Line(a: at(poly[i], 0), b: at(poly[i], top), kind: .corner))
        }

        // Bulkheads: the edges that are not on a wall, at the bulkhead's
        // underside and where its face meets the ceiling, and its corners out
        // in the room.
        let minTurn = sin(10 * Double.pi / 180)
        for z in zones {
            let zp = z.polygon
            let m = zp.count
            let lo = min(z.height, H)
            let hi = max(z.height, H)
            for j in 0..<m {
                let p = zp[j]
                let q = zp[(j + 1) % m]
                var alongWall = false
                var i = 0
                while i < n && !alongWall {
                    let a = poly[i]
                    let b = poly[(i + 1) % n]
                    alongWall = nearestOnSegment(p, a, b).d <= onWallMm && nearestOnSegment(q, a, b).d <= onWallMm
                    i += 1
                }
                if alongWall { continue }
                lines.append(Line(a: at(p, z.height), b: at(q, z.height), kind: .bulkhead))
                lines.append(Line(a: at(p, H), b: at(q, H), kind: .bulkhead))
            }
            for j in 0..<m {
                let v = zp[j]
                if onWall(v) >= 0 { continue }
                let u = zp[(j - 1 + m) % m]
                let w = zp[(j + 1) % m]
                let e1 = Vec2(x: v.x - u.x, z: v.z - u.z)
                let e2 = Vec2(x: w.x - v.x, z: w.z - v.z)
                let cross = e1.x * e2.z - e1.z * e2.x
                let lens = (e1.x * e1.x + e1.z * e1.z).squareRoot() * (e2.x * e2.x + e2.z * e2.z).squareRoot()
                if lens <= 0 || abs(cross) / lens < minTurn { continue }
                lines.append(Line(a: at(v, lo), b: at(v, hi), kind: .bulkhead))
            }
        }

        // Openings, on the wall they are at. A door stands on the floor.
        for op in room.openings {
            var wall = -1
            var best = Double.infinity
            for i in 0..<n {
                let d = nearestOnSegment(op.center, poly[i], poly[(i + 1) % n]).d
                if d < best {
                    best = d
                    wall = i
                }
            }
            if wall < 0 || best > openingReachMm { continue }
            let a = poly[wall]
            let b = poly[(wall + 1) % n]
            let L = dist(a, b)
            let dir = Vec2(x: (b.x - a.x) / L, z: (b.z - a.z) / L)
            let t = (op.center.x - a.x) * dir.x + (op.center.z - a.z) * dir.z
            let s0 = max(0, min(L, t - op.width / 2))
            let s1 = max(0, min(L, t + op.width / 2))
            if s1 - s0 < minOpeningMm { continue }
            let runs = runsOf[wall]
            let tc = max(0, min(L, t))
            var border = runs[runs.count - 1].h
            for r in runs where tc >= r.t0 && tc <= r.t1 {
                border = r.h
                break
            }
            let boxH = op.top - op.bottom
            let y0: Double
            let y1: Double
            if op.type == "window" {
                y0 = max(0, op.bottom)
                y1 = min(op.top, border)
            } else {
                y0 = 0
                y1 = min(min(max(boxH, op.top), boxH + doorReachMm), border)
            }
            if y1 - y0 < minOpeningMm { continue }
            let kind: Kind = op.glass == true ? .glass : op.type == "window" ? .window : .door
            let p0 = Vec2(x: a.x + dir.x * s0, z: a.z + dir.z * s0)
            let p1 = Vec2(x: a.x + dir.x * s1, z: a.z + dir.z * s1)
            lines.append(Line(a: at(p0, y0), b: at(p0, y1), kind: kind))
            lines.append(Line(a: at(p0, y1), b: at(p1, y1), kind: kind))
            lines.append(Line(a: at(p1, y1), b: at(p1, y0), kind: kind))
            if y0 >= 1 { lines.append(Line(a: at(p1, y0), b: at(p0, y0), kind: kind)) }
        }

        // Columns, at the floor and where they meet the ceiling over them.
        for c in room.pillars {
            let top = heightAt(c.center)
            var ring: [Vec2]
            if c.shape == "round" {
                let r = c.width / 2
                let k = circleSegments
                ring = (0..<k).map { j -> Vec2 in
                    let th = (2 * Double.pi * Double(j)) / Double(k)
                    return Vec2(x: c.center.x + r * cos(th), z: c.center.z + r * sin(th))
                }
            } else {
                let cs = cos(c.rotation)
                let sn = sin(c.rotation)
                let hw = c.width / 2
                let hd = c.depth / 2
                ring = [(-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd)].map { l -> Vec2 in
                    Vec2(x: c.center.x + l.0 * cs - l.1 * sn, z: c.center.z + l.0 * sn + l.1 * cs)
                }
            }
            let k = ring.count
            for j in 0..<k { lines.append(Line(a: at(ring[j], 0), b: at(ring[(j + 1) % k], 0), kind: .pillar)) }
            for j in 0..<k { lines.append(Line(a: at(ring[j], top), b: at(ring[(j + 1) % k], top), kind: .pillar)) }
            if c.shape == "box" {
                for p in ring { lines.append(Line(a: at(p, 0), b: at(p, top), kind: .pillar)) }
            }
        }

        return lines.filter { l in
            let dx = l.b.x - l.a.x
            let dy = l.b.y - l.a.y
            let dz = l.b.z - l.a.z
            return (dx * dx + dy * dy + dz * dz).squareRoot() >= 1
        }
    }
}

// MARK: - Holding the surfaces still

/// The room's surfaces as they arrive, update after update → the ones worth
/// drawing, and where. See the file header; the numbers are the TypeScript
/// twin's `TRACKER_DEFAULTS`.
final class SurfaceTracker {
    /// A surface as it arrives: its kind, RoomPlan's identifier for it when it
    /// has one, and its numbers — millimetres (angles in milliradians), the
    /// first `anchor` of them placing it on the plan.
    struct Item: Codable {
        var kind: String
        var key: String?
        var values: [Double]
    }

    struct Tracked: Codable, Equatable {
        var id: Int
        var kind: String
        var key: String?
        var values: [Double]
        /// Has held still: it only moves now for a change that lasts.
        var locked: Bool
        /// Was in the latest update (false while it is kept through a miss).
        var seen: Bool
    }

    struct Options {
        /// An item with no identifier this close to a tracked one (by its
        /// anchor) is the same item.
        var matchMm = 400.0
        /// Leading values that place an item without an identifier — its x, z.
        var anchor = 2
        /// Changes smaller than this are wobble, not movement — or than
        /// `spread` times how much the item's own readings wobble, if more.
        var deadbandMm = 25.0
        var spread = 2.0
        /// Updates an item must be seen in before it is drawn.
        var showAfter = 2
        /// Updates a drawn item outlives without being seen.
        var keepFor = 4
        /// Updates a drawn item must hold still to lock.
        var lockAfter = 4
        /// Updates a locked item's change must last before it moves.
        var settle = 2
        /// Recent readings a drawn item's position is the median of…
        var window = 5
        /// …and, once it has locked, the longer run it is the median of.
        var history = 9
    }

    private struct Track {
        var id: Int
        var kind: String
        var key: String?
        var shown: [Double]
        var history: [[Double]]
        var hits: Int
        var misses: Int
        var visible: Bool
        var locked: Bool
        var still: Int
        var away: Int
    }

    let options: Options
    private var tracks: [Track] = []
    private var nextId = 1

    init(options: Options = Options()) {
        self.options = options
    }

    /// The latest reading of a named item — so a wall's two ends can be kept
    /// the same way round from one update to the next.
    func lastReading(kind: String, key: String) -> [Double]? {
        tracks.last { $0.kind == kind && $0.key == key }?.history.last
    }

    private static func median(_ values: [Double]) -> Double {
        let s = values.sorted()
        let n = s.count
        return n % 2 == 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
    }

    func update(_ items: [Item]) -> [Tracked] {
        let o = options
        var used = [Bool](repeating: false, count: items.count)
        var match: [Int: Int] = [:]

        // Items RoomPlan names keep their name.
        var byKey: [String: Int] = [:]
        for (i, t) in tracks.enumerated() {
            if let key = t.key { byKey[t.kind + "\u{0}" + key] = i }
        }
        for (j, it) in items.enumerated() {
            guard let key = it.key, let ti = byKey[it.kind + "\u{0}" + key], match[ti] == nil else { continue }
            match[ti] = j
            used[j] = true
        }

        // The rest are found by where they are: nearest first.
        var pairs: [(d: Double, ti: Int, j: Int)] = []
        for (ti, t) in tracks.enumerated() where t.key == nil {
            let last = t.history[t.history.count - 1]
            for (j, it) in items.enumerated() where !used[j] && it.key == nil && it.kind == t.kind {
                var s = 0.0
                for k in 0..<o.anchor {
                    let v: Double = k < it.values.count ? it.values[k] : 0
                    let w: Double = k < last.count ? last[k] : 0
                    let d = v - w
                    s += d * d
                }
                let d = s.squareRoot()
                if d <= o.matchMm { pairs.append((d, ti, j)) }
            }
        }
        pairs.sort { ($0.d, $0.ti, $0.j) < ($1.d, $1.ti, $1.j) }
        for p in pairs where match[p.ti] == nil && !used[p.j] {
            match[p.ti] = p.j
            used[p.j] = true
        }

        for ti in tracks.indices {
            guard let j = match[ti] else {
                tracks[ti].misses += 1
                tracks[ti].away = 0
                continue
            }
            var t = tracks[ti]
            let raw = items[j].values
            t.hits += 1
            t.misses = 0
            if raw.count != t.shown.count {
                // Another shape altogether (a bulkhead traced with more
                // corners): take it as it is.
                t.history = [raw]
                t.shown = raw
                t.still = 0
                t.away = 0
                t.locked = false
                tracks[ti] = t
                continue
            }
            t.history.append(raw)
            if t.history.count > o.history { t.history.removeFirst() }
            // Recent readings while it is settling; the longer run once it has.
            let span: [[Double]] = t.locked ? t.history : Array(t.history.suffix(o.window))
            let target: [Double] = (0..<raw.count).map { k in Self.median(span.map { $0[k] }) }
            // How far each number may stray before it has moved: the deadband,
            // or more for a number whose readings wobble more (σ from the
            // median absolute deviation).
            let band: [Double] = (0..<raw.count).map { k in
                let m = target[k]
                let mad = Self.median(span.map { abs($0[k] - m) })
                return max(o.deadbandMm, o.spread * 1.4826 * mad)
            }
            var off = false
            for k in 0..<target.count where abs(target[k] - t.shown[k]) > band[k] { off = true }
            /// Take the numbers that have moved; leave the ones still inside
            /// half their band.
            func follow(_ to: [Double], _ shown: [Double]) -> [Double] {
                (0..<shown.count).map { k in abs(to[k] - shown[k]) > band[k] / 2 ? to[k] : shown[k] }
            }
            if !t.visible {
                t.shown = target
                if t.hits >= o.showAfter { t.visible = true }
            } else if !t.locked {
                if off {
                    t.shown = follow(target, t.shown)
                    t.still = 0
                    // What it moved away from is not evidence for where it is now.
                    t.history = Array(t.history.suffix(o.window))
                } else {
                    t.still += 1
                    // Held still, and long enough to know where its middle is.
                    if t.still >= o.lockAfter && t.history.count >= o.history {
                        t.locked = true
                        // Lock onto the middle of everything since it last
                        // moved, not onto whichever reading it was drawn at.
                        let all = t.history
                        t.shown = (0..<raw.count).map { k in Self.median(all.map { $0[k] }) }
                    }
                }
            } else if off {
                t.away += 1
                if t.away >= o.settle {
                    let recent = Array(t.history.suffix(o.window))
                    let to: [Double] = (0..<raw.count).map { k in Self.median(recent.map { $0[k] }) }
                    t.shown = follow(to, t.shown)
                    t.away = 0
                    t.history = recent
                }
            } else {
                t.away = 0
            }
            tracks[ti] = t
        }

        for (j, it) in items.enumerated() where !used[j] {
            tracks.append(Track(
                id: nextId, kind: it.kind, key: it.key, shown: it.values, history: [it.values],
                hits: 1, misses: 0, visible: o.showAfter <= 1, locked: false, still: 0, away: 0
            ))
            nextId += 1
        }

        tracks = tracks.filter { $0.misses == 0 || $0.misses <= ($0.visible ? o.keepFor : 1) }
        return tracks.filter(\.visible).map {
            Tracked(id: $0.id, kind: $0.kind, key: $0.key, values: $0.shown, locked: $0.locked, seen: $0.misses == 0)
        }
    }

    func reset() {
        tracks = []
        nextId = 1
    }
}
