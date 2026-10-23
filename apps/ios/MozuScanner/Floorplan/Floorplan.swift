// Pure floorplan model + dimensioning — the Swift twin of @mozu/scan-sdk's
// floorplan engine. Given a `RoomScan` it computes each wall's auto-captured
// length, the floor area, perimeter, and outward normals (for placing dimension
// labels). No UIKit/RoomPlan here, so it's unit-testable in isolation.

import CoreGraphics
import Foundation

struct FloorplanWall: Identifiable {
    let id: Int
    let start: Vec2
    let end: Vec2
    /// Auto-captured wall length (millimetres).
    let length: Double
    /// Unit normal pointing OUT of the room.
    let outward: Vec2
}

struct FloorplanBounds {
    let minX, minZ, maxX, maxZ: Double
    var width: Double { maxX - minX }
    var depth: Double { maxZ - minZ }
}

/// Maps the plan between millimetres and screen points.
///
/// The canvas draws with it and tap handling inverts it, so a finger on the plan
/// lands exactly where the drawing says it should.
struct FloorplanTransform {
    let scale: Double
    let offsetX: Double
    let offsetY: Double
    let pad: Double
    let minX: Double
    let minZ: Double

    init(floorplan fp: Floorplan, size: CGSize) {
        let span = max(fp.bounds.width, fp.bounds.depth, 1)
        pad = max(span * 0.18, 700)
        let contentW = fp.bounds.width + pad * 2
        let contentH = fp.bounds.depth + pad * 2
        scale = min(Double(size.width) / contentW, Double(size.height) / contentH)
        offsetX = (Double(size.width) - contentW * scale) / 2
        offsetY = (Double(size.height) - contentH * scale) / 2
        minX = fp.bounds.minX
        minZ = fp.bounds.minZ
    }

    func point(_ v: Vec2) -> CGPoint {
        CGPoint(
            x: offsetX + ((v.x - minX) + pad) * scale,
            y: offsetY + ((v.z - minZ) + pad) * scale
        )
    }

    /// Screen point → millimetres.
    func millimetres(_ p: CGPoint) -> Vec2 {
        guard scale > 0 else { return Vec2(x: 0, z: 0) }
        return Vec2(
            x: (Double(p.x) - offsetX) / scale - pad + minX,
            z: (Double(p.y) - offsetY) / scale - pad + minZ
        )
    }
}

/// A fixture resolved onto the plan: where it actually sits in floor coordinates
/// and the text to draw beside it.
struct FloorplanFixture: Identifiable {
    let id: Int
    let fixture: ScanFixture
    /// Position on the floor plane (millimetres) — the point on the wall line.
    let point: Vec2
    /// Unit normal pointing INTO the room, for offsetting the marker and label.
    let inward: Vec2
    /// Display label, e.g. `Socket`.
    let text: String
}

struct Floorplan {
    let points: [Vec2]
    let walls: [FloorplanWall]
    let openings: [ScanOpening]
    let objects: [ScanObject]
    let fixtures: [FloorplanFixture]
    let areaMm2: Double
    let perimeterMm: Double
    let height: Double
    let bounds: FloorplanBounds
    let unitSystem: String
    let source: ScanSource

    /// Build a dimensioned floorplan from a scan (cleans + orients the polygon).
    static func build(from scan: RoomScan) -> Floorplan {
        var pts = Geo.simplify(scan.polygon)
        pts = Geo.ensureCCW(pts)
        let ccw = Geo.signedArea(pts) > 0

        let walls: [FloorplanWall] = pts.enumerated().map { i, start in
            let end = pts[(i + 1) % pts.count]
            let dir = Geo.normalize(Geo.sub(end, start))
            let cw = Vec2(x: dir.z, z: -dir.x) // clockwise perpendicular
            let outward = ccw ? cw : Vec2(x: -cw.x, z: -cw.z)
            return FloorplanWall(
                id: i, start: start, end: end,
                length: Geo.distance(start, end), outward: outward
            )
        }

        let xs = pts.map(\.x), zs = pts.map(\.z)
        let bounds = FloorplanBounds(
            minX: xs.min() ?? 0, minZ: zs.min() ?? 0,
            maxX: xs.max() ?? 0, maxZ: zs.max() ?? 0
        )
        return Floorplan(
            points: pts, walls: walls, openings: scan.openings, objects: scan.objects,
            fixtures: Floorplan.place(scan.fixtures, from: scan.polygon, onto: walls),
            areaMm2: Geo.area(pts), perimeterMm: Geo.perimeter(pts),
            height: scan.height, bounds: bounds,
            unitSystem: scan.unitSystem, source: scan.source
        )
    }

    /// Resolve fixtures onto the plan.
    ///
    /// `build` may simplify and re-wind the polygon, so a fixture's stored wall
    /// index no longer necessarily refers to the same edge. Each one is therefore
    /// re-anchored by its REAL position: walk the original polygon to find where
    /// it sits, then attach it to whichever rebuilt wall is nearest.
    static func place(
        _ fixtures: [ScanFixture],
        from sourcePolygon: [Vec2],
        onto walls: [FloorplanWall]
    ) -> [FloorplanFixture] {
        guard !fixtures.isEmpty, !walls.isEmpty, sourcePolygon.count >= 3 else { return [] }
        var out: [FloorplanFixture] = []
        for (i, f) in fixtures.enumerated() {
            guard f.wall >= 0, f.wall < sourcePolygon.count else { continue }
            let start = sourcePolygon[f.wall]
            let end = sourcePolygon[(f.wall + 1) % sourcePolygon.count]
            let length = Geo.distance(start, end)
            guard length > 1 else { continue }
            let dir = Geo.normalize(Geo.sub(end, start))
            let t = min(max(f.offset, 0), length)
            let point = Vec2(x: start.x + dir.x * t, z: start.z + dir.z * t)

            guard let wall = nearestWall(to: point, in: walls) else { continue }
            out.append(FloorplanFixture(
                id: i,
                fixture: f,
                point: point,
                inward: Vec2(x: -wall.outward.x, z: -wall.outward.z),
                text: FixtureLabel.text(for: f)
            ))
        }
        return out
    }

    /// The plan wall whose segment lies closest to a point.
    static func nearestWall(to p: Vec2, in walls: [FloorplanWall]) -> FloorplanWall? {
        var best: FloorplanWall?
        var bestDistance = Double.greatestFiniteMagnitude
        for wall in walls {
            let d = Geo.distanceToSegment(p, wall.start, wall.end)
            if d < bestDistance { bestDistance = d; best = wall }
        }
        return best
    }

    var center: Vec2 { Geo.centroid(points) }
}

/// One place decides what a fixture is CALLED, so the plan, the handoff and the
/// web app all say the same thing.
enum FixtureLabel {
    static func text(for fixture: ScanFixture) -> String {
        switch fixture.type {
        case .socket: return "Socket"
        case .switch: return "Switch"
        case .water: return diameterText("Water", fixture)
        case .waste: return diameterText("Waste", fixture)
        case .gas: return diameterText("Gas", fixture)
        case .vent: return "Vent"
        case .radiator: return "Radiator"
        }
    }

    private static func diameterText(_ base: String, _ fixture: ScanFixture) -> String {
        guard let d = fixture.diameterMm, d > 0 else { return base }
        return "\(base) ⌀\(Int(d.rounded()))"
    }
}

// MARK: - Pure 2D geometry (millimetres)

enum Geo {
    static func sub(_ a: Vec2, _ b: Vec2) -> Vec2 { Vec2(x: a.x - b.x, z: a.z - b.z) }
    static func distance(_ a: Vec2, _ b: Vec2) -> Double { (sub(a, b)).hypot }
    static func normalize(_ a: Vec2) -> Vec2 {
        let l = a.hypot
        return l > 1e-9 ? Vec2(x: a.x / l, z: a.z / l) : Vec2(x: 0, z: 0)
    }

    static func signedArea(_ p: [Vec2]) -> Double {
        var a = 0.0
        for i in 0..<p.count {
            let q = p[(i + 1) % p.count]
            a += p[i].x * q.z - q.x * p[i].z
        }
        return a / 2
    }

    static func area(_ p: [Vec2]) -> Double { abs(signedArea(p)) }

    static func perimeter(_ p: [Vec2]) -> Double {
        var s = 0.0
        for i in 0..<p.count { s += distance(p[i], p[(i + 1) % p.count]) }
        return s
    }

    static func centroid(_ p: [Vec2]) -> Vec2 {
        guard !p.isEmpty else { return Vec2(x: 0, z: 0) }
        let sx = p.reduce(0) { $0 + $1.x }, sz = p.reduce(0) { $0 + $1.z }
        return Vec2(x: sx / Double(p.count), z: sz / Double(p.count))
    }

    static func ensureCCW(_ p: [Vec2]) -> [Vec2] { signedArea(p) < 0 ? p.reversed() : p }

    /// How far a point sits from a segment, and how far along that segment its
    /// closest point lies. Used to anchor anything wall-mounted — a detected
    /// socket, or a tap on the plan — to the right wall at the right offset.
    static func project(_ p: Vec2, onto a: Vec2, _ b: Vec2) -> (distance: Double, offset: Double) {
        let ab = sub(b, a)
        let lengthSquared = ab.x * ab.x + ab.z * ab.z
        guard lengthSquared > 1e-9 else { return (distance(p, a), 0) }
        let raw = ((p.x - a.x) * ab.x + (p.z - a.z) * ab.z) / lengthSquared
        let t = min(max(raw, 0), 1)
        let closest = Vec2(x: a.x + ab.x * t, z: a.z + ab.z * t)
        return (distance(p, closest), t * lengthSquared.squareRoot())
    }

    static func distanceToSegment(_ p: Vec2, _ a: Vec2, _ b: Vec2) -> Double {
        project(p, onto: a, b).distance
    }

    /// Drop near-duplicate and collinear vertices (mirror of the SDK).
    static func simplify(_ points: [Vec2], epsilon: Double = 30, straightness: Double = 6000) -> [Vec2] {
        var merged: [Vec2] = []
        for p in points where merged.last.map({ distance($0, p) > epsilon }) ?? true {
            merged.append(p)
        }
        if merged.count > 1, distance(merged[0], merged[merged.count - 1]) <= epsilon { merged.removeLast() }
        guard merged.count >= 4 else { return merged }

        var out: [Vec2] = []
        let n = merged.count
        for i in 0..<n {
            let prev = merged[(i - 1 + n) % n], cur = merged[i], next = merged[(i + 1) % n]
            let a = sub(cur, prev), b = sub(next, cur)
            if abs(a.x * b.z - a.z * b.x) > straightness { out.append(cur) }
        }
        return out.count >= 3 ? out : merged
    }
}

private extension Vec2 {
    var hypot: Double { (x * x + z * z).squareRoot() }
}

// MARK: - Formatting (metric / imperial)

enum Units {
    static func length(_ mm: Double, _ unit: String) -> String {
        if unit == "imperial" {
            let inches = mm / 25.4
            var feet = Int(inches / 12)
            var inch = Int((inches - Double(feet) * 12).rounded())
            if inch == 12 { feet += 1; inch = 0 }
            return "\(feet)′ \(inch)″"
        }
        return mm >= 1000 ? String(format: "%.2f m", mm / 1000) : "\(Int(mm.rounded())) mm"
    }

    static func area(_ mm2: Double, _ unit: String) -> String {
        unit == "imperial"
            ? String(format: "%.0f ft²", mm2 / 92_903.04)
            : String(format: "%.1f m²", mm2 / 1_000_000)
    }
}
