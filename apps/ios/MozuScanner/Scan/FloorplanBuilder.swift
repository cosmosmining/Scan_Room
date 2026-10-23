// Turn Apple RoomPlan's `CapturedRoom` into a MOZU `RoomScan`: an ordered floor
// polygon (cm-level), doors/windows mapped onto the right walls, and detected
// objects. This is the native side of "scan → floorplan" — RoomPlan supplies the
// geometry; this derives the plan the rest of MOZU understands.

import Foundation
import RoomPlan
import simd

enum FloorplanBuilder {
    static let defaultCeilingMm = 2700.0

    /// `CapturedRoom` → `RoomScan` (millimetres).
    ///
    /// `tracks` are the sockets `FixtureCapture` measured in world space while
    /// the room was being walked. Their positions are already known; this only
    /// converts them into the plan's {wall, offset, height} form, which needs the
    /// finished polygon — hence the last step of building the scan.
    ///
    /// `sightings` is the depth-free fallback: raw image points to ray-cast when
    /// the session gave us nothing to measure with.
    static func roomScan(
        from room: CapturedRoom,
        tracks: [SocketTrack] = [],
        sightings: [FixtureSighting] = []
    ) -> RoomScan {
        let polygon = orderedFloorPolygon(room.walls)
        let cleaned = Geo.ensureCCW(Geo.simplify(polygon))
        let height = ceilingHeightMm(room.walls)
        let floorY = floorYMm(room.walls)
        let openings = mapOpenings(room, to: cleaned)
        let objects = room.objects.map(scanObject(from:))
        let finalPolygon = cleaned.isEmpty ? boundingBox(room.walls) : cleaned
        // Measured tracks when there were any; the ray-cast fallback only for a
        // session that never gave us depth.
        let fixtures: [ScanFixture]
        if tracks.isEmpty {
            fixtures = FixtureProjector.fixtures(
                fromSightings: sightings,
                polygon: finalPolygon,
                ceilingMm: height,
                floorYMm: floorY
            )
        } else {
            fixtures = FixtureProjector.fixtures(
                from: tracks,
                polygon: finalPolygon,
                ceilingMm: height,
                floorYMm: floorY
            )
        }
        return RoomScan(
            polygon: finalPolygon,
            height: height,
            openings: openings,
            objects: objects,
            fixtures: fixtures,
            source: .roomplan,
            confidence: 0.92
        )
    }

    // MARK: Wall endpoints → ordered loop

    private static func segment(_ wall: CapturedRoom.Surface) -> (a: Vec2, b: Vec2) {
        let t = wall.transform
        let center = SIMD3<Float>(t.columns.3.x, t.columns.3.y, t.columns.3.z)
        let axisX = SIMD3<Float>(t.columns.0.x, t.columns.0.y, t.columns.0.z) // length axis
        let half = wall.dimensions.x / 2
        let p0 = center + axisX * half
        let p1 = center - axisX * half
        return (mm(p0), mm(p1))
    }

    /// Greedy nearest-endpoint chaining of wall segments into a closed loop.
    private static func orderedFloorPolygon(_ walls: [CapturedRoom.Surface]) -> [Vec2] {
        var remaining = walls.map(segment)
        guard let first = remaining.first else { return [] }
        remaining.removeFirst()

        var ordered = [first.a, first.b]
        var tail = first.b
        while !remaining.isEmpty {
            var bestIdx = 0
            var flip = false
            var bestDist = Double.greatestFiniteMagnitude
            for (i, seg) in remaining.enumerated() {
                let da = Geo.distance(tail, seg.a)
                let db = Geo.distance(tail, seg.b)
                if da < bestDist { bestDist = da; bestIdx = i; flip = false }
                if db < bestDist { bestDist = db; bestIdx = i; flip = true }
            }
            let seg = remaining.remove(at: bestIdx)
            let next = flip ? seg.a : seg.b
            ordered.append(next)
            tail = next
        }
        return ordered
    }

    private static func boundingBox(_ walls: [CapturedRoom.Surface]) -> [Vec2] {
        let pts = walls.flatMap { [segment($0).a, segment($0).b] }
        guard !pts.isEmpty else {
            return [Vec2(x: 0, z: 0), Vec2(x: 4000, z: 0), Vec2(x: 4000, z: 3000), Vec2(x: 0, z: 3000)]
        }
        let minX = pts.map(\.x).min()!, maxX = pts.map(\.x).max()!
        let minZ = pts.map(\.z).min()!, maxZ = pts.map(\.z).max()!
        return [Vec2(x: minX, z: minZ), Vec2(x: maxX, z: minZ), Vec2(x: maxX, z: maxZ), Vec2(x: minX, z: maxZ)]
    }

    private static func ceilingHeightMm(_ walls: [CapturedRoom.Surface]) -> Double {
        let h = walls.map { Double($0.dimensions.y) * 1000 }.max() ?? 0
        return h > 0 ? h : defaultCeilingMm
    }

    /// The floor plane, in ARKit world coordinates (millimetres).
    ///
    /// ARKit's origin is wherever the session started — normally about chest
    /// height, not the floor — so a world Y is not a height above the floor
    /// until this is subtracted. Each wall gives an estimate (its centre minus
    /// half its height); the median is taken because one mis-measured wall
    /// should not move the floor, and a mean would let it.
    static func floorYMm(_ walls: [CapturedRoom.Surface]) -> Double {
        let bases = walls
            .map { Double($0.transform.columns.3.y) * 1000 - Double($0.dimensions.y) * 500 }
            .sorted()
        guard !bases.isEmpty else { return 0 }
        return bases[bases.count / 2]
    }

    // MARK: Openings → nearest edge of the ordered polygon

    private static func mapOpenings(_ room: CapturedRoom, to polygon: [Vec2]) -> [ScanOpening] {
        guard polygon.count >= 3 else { return [] }
        var result: [ScanOpening] = []
        let tagged: [(ScanOpening.Kind, [CapturedRoom.Surface])] = [
            (.door, room.doors), (.window, room.windows), (.archway, room.openings),
        ]
        for (kind, surfaces) in tagged {
            for s in surfaces {
                let t = s.transform
                let center = mm(SIMD3<Float>(t.columns.3.x, t.columns.3.y, t.columns.3.z))
                guard let edge = nearestEdge(to: center, in: polygon) else { continue }
                let start = polygon[edge]
                let end = polygon[(edge + 1) % polygon.count]
                let dir = Geo.normalize(Geo.sub(end, start))
                let width = Double(s.dimensions.x) * 1000
                // The shared RoomScan contract (and the web app consuming the
                // handoff) define `offset` as the opening's LEADING EDGE, not its
                // centre — RoomPlan gives us the centre, so shift back half a
                // width. Emitting the centre here shifted every door and window
                // by half its width once the scan reached the web floorplan.
                let offset = max(0, dot(Geo.sub(center, start), dir) - width / 2)
                let height = Double(s.dimensions.y) * 1000
                let sill = kind == .window
                    ? max(0, Double(t.columns.3.y) * 1000 - height / 2)
                    : 0
                result.append(ScanOpening(
                    type: kind, wall: edge,
                    offset: offset, width: width, height: height, sill: sill
                ))
            }
        }
        return result
    }

    private static func nearestEdge(to p: Vec2, in polygon: [Vec2]) -> Int? {
        var best: Int?
        var bestDist = Double.greatestFiniteMagnitude
        for i in 0..<polygon.count {
            let d = distanceToSegment(p, polygon[i], polygon[(i + 1) % polygon.count])
            if d < bestDist { bestDist = d; best = i }
        }
        return best
    }

    private static func distanceToSegment(_ p: Vec2, _ a: Vec2, _ b: Vec2) -> Double {
        let ab = Geo.sub(b, a)
        let len2 = ab.x * ab.x + ab.z * ab.z
        guard len2 > 1e-9 else { return Geo.distance(p, a) }
        let t = max(0, min(1, dot(Geo.sub(p, a), ab) / len2))
        return Geo.distance(p, Vec2(x: a.x + ab.x * t, z: a.z + ab.z * t))
    }

    // MARK: Objects

    private static func scanObject(from object: CapturedRoom.Object) -> ScanObject {
        let t = object.transform
        let center = mm(SIMD3<Float>(t.columns.3.x, t.columns.3.y, t.columns.3.z))
        let yaw = atan2(Double(t.columns.0.z), Double(t.columns.0.x))
        return ScanObject(
            category: String(describing: object.category),
            center: center,
            width: Double(object.dimensions.x) * 1000,
            depth: Double(object.dimensions.z) * 1000,
            rotation: yaw,
            height: Double(object.dimensions.y) * 1000
        )
    }

    // MARK: Helpers

    private static func mm(_ v: SIMD3<Float>) -> Vec2 { Vec2(x: Double(v.x) * 1000, z: Double(v.z) * 1000) }
    private static func dot(_ a: Vec2, _ b: Vec2) -> Double { a.x * b.x + a.z * b.z }
}
