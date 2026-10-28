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
        sightings: [FixtureSighting] = [],
        rays: [DepthSample] = []
    ) -> RoomScan {
        let wallHeight = ceilingHeightMm(room.walls)
        let floorY = floorYMm(room.walls)
        // Clutter out by height, pillars out as structure, the outline from the
        // rest — see `WallLoop.analyse`.
        let analysis = WallLoop.analyse(wallSegments(room.walls, floorYMm: floorY))
        let cleaned = Geo.ensureCCW(Geo.simplify(analysis.outline))
        let finalPolygon = cleaned.isEmpty ? boundingBox(room.walls) : cleaned
        let recognised = mapOpenings(room, to: finalPolygon, floorYMm: floorY)
        let scanned = room.objects.map(scanObject(from:))
        let depth = rays.map { ray($0, floorYMm: floorY) }
        // The ceiling from the readings overhead: where it drops (a bulkhead
        // along the windows) or rises, whatever the shape of its edge, and its
        // real height — through an expanded-metal mesh RoomPlan's walls can run
        // on up to the slab. Trusted when it is a height a ceiling can be:
        // not above the walls, not far below them.
        let ceiling = CeilingFinder.ceiling(
            rays: depth, polygon: finalPolygon,
            exclude: scanned.map(footprint) + analysis.pillars.map(pillarFootprint)
        )
        var trusted: CeilingFinder.Analysis?
        if let c = ceiling {
            let h: Double = c.height
            if h >= 1800, h <= wallHeight + 300, h >= wallHeight - 1500 { trusted = c }
        }
        let height: Double = trusted?.height ?? wallHeight
        // Glass RoomPlan did not recognise: readings that went through the
        // finished walls, or found nothing to measure where a wall should be.
        // Suggestions — see `GlassFinder` on mirrors. RoomPlan's televisions go
        // in as already accounted for: on, a screen looks like daylight.
        let glass = GlassFinder.openings(
            rays: depth,
            polygon: finalPolygon,
            ceilingMm: height,
            existing: recognised.map(known) + screens(scanned, polygon: finalPolygon)
        )
        let openings = recognised + glass
        // Columns: RoomPlan's surfaces where it reported them, the depth
        // readings for the ones it saw one face of or missed altogether.
        let fromDepth = PillarFinder.pillars(
            rays: depth,
            polygon: finalPolygon,
            ceilingMm: height,
            exclude: scanned.map(footprint)
        )
        let pillars = PillarFinder.merge(fromWalls: analysis.pillars, fromDepth: fromDepth)
        let objects = scanned + pillars.map { column($0, heightMm: height) }
        // A column only the depth readings found runs up through the ceiling
        // too, and its sides overhead must not read as a bulkhead: look at the
        // ceiling again without it. The height stays the one the glass and the
        // columns were found under.
        if let first = trusted, !fromDepth.isEmpty,
           let again = CeilingFinder.ceiling(
               rays: depth, polygon: finalPolygon,
               exclude: scanned.map(footprint) + (analysis.pillars + fromDepth).map(pillarFootprint)
           ) {
            trusted = CeilingFinder.Analysis(height: first.height, seeThroughTo: again.seeThroughTo, zones: again.zones)
        }
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
        var ceilingDetail: ScanCeiling?
        if let c = trusted, !c.zones.isEmpty || c.seeThroughTo != nil {
            ceilingDetail = ScanCeiling(
                zones: c.zones.map { ScanCeilingZone(polygon: $0.polygon, height: $0.height) },
                seeThroughTo: c.seeThroughTo
            )
        }
        return RoomScan(
            polygon: finalPolygon,
            height: height,
            openings: openings,
            objects: objects,
            fixtures: fixtures,
            source: .roomplan,
            confidence: 0.92,
            ceiling: ceilingDetail
        )
    }

    // MARK: Live preview

    /// What the live preview needs from RoomPlan's room-so-far. Taken on the
    /// main thread (it is a handful of walls), so the part that walks every
    /// depth reading can run elsewhere on plain values.
    struct PreviewInput {
        var polygon: [Vec2]
        var ceilingMm: Double
        var floorYMm: Double
        var known: [GlassFinder.Known]
        var windows: Int
        var footprints: [PillarFinder.Footprint]
        var wallPillars: [WallLoop.Pillar]
    }

    /// Glass and columns found so far, for the scan screen.
    struct Preview {
        var glass: Int
        var pillars: Int
    }

    static func previewInput(from room: CapturedRoom) -> PreviewInput? {
        guard !room.walls.isEmpty else { return nil }
        let floorY = floorYMm(room.walls)
        let analysis = WallLoop.analyse(wallSegments(room.walls, floorYMm: floorY))
        let polygon = Geo.ensureCCW(Geo.simplify(analysis.outline))
        guard polygon.count >= 3 else { return nil }
        let recognised = mapOpenings(room, to: polygon, floorYMm: floorY)
        let scanned = room.objects.map(scanObject(from:))
        return PreviewInput(
            polygon: polygon,
            ceilingMm: ceilingHeightMm(room.walls),
            floorYMm: floorY,
            known: recognised.map(known) + screens(scanned, polygon: polygon),
            windows: recognised.filter { $0.type == .window }.count,
            footprints: scanned.map(footprint),
            wallPillars: analysis.pillars
        )
    }

    /// The same finders `roomScan` runs, on the room so far. Pure: safe off the
    /// main thread.
    static func preview(_ input: PreviewInput, samples: [DepthSample]) -> Preview {
        let depth = samples.map { ray($0, floorYMm: input.floorYMm) }
        let glass = GlassFinder.openings(
            rays: depth, polygon: input.polygon, ceilingMm: input.ceilingMm, existing: input.known
        )
        let pillars = PillarFinder.merge(
            fromWalls: input.wallPillars,
            fromDepth: PillarFinder.pillars(
                rays: depth, polygon: input.polygon, ceilingMm: input.ceilingMm, exclude: input.footprints
            )
        )
        return Preview(glass: input.windows + glass.count, pillars: pillars.count)
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

    /// Wall surfaces → the segments `WallLoop` builds the outline from, each
    /// carrying its height so clutter can be told from wall.
    ///
    /// Outline assembly used to be unbounded greedy nearest-endpoint chaining
    /// that appended only the FAR endpoint of each segment. Discarding the near
    /// endpoint made every edge a chord fusing the gap between two walls with the
    /// wall itself — which is how shoes occupying 500mm of one wall tilted that
    /// wall along its entire length. See `WallLoop.swift` for the measurement and
    /// the reasoning; the geometry lives there because it is pure, and its
    /// TypeScript mirror carries the tests.
    private static func wallSegments(_ walls: [CapturedRoom.Surface], floorYMm: Double) -> [WallLoop.Segment] {
        walls.flatMap { wall -> [WallLoop.Segment] in
            let heightMm = Double(wall.dimensions.y) * 1000
            let topMm = Double(wall.transform.columns.3.y) * 1000 + heightMm / 2 - floorYMm
            return facets(wall).map {
                WallLoop.Segment(a: $0.a, b: $0.b, heightMm: heightMm, topMm: topMm)
            }
        }
    }

    /// A flat wall is one segment. A CURVED one (iOS 17 reports round columns
    /// and curved walls this way) is not: treating it as a flat surface drew a
    /// straight line through the middle of a round pillar. Its arc is sampled
    /// instead — about the surface's own origin, in its horizontal (local XZ)
    /// plane — so a column arrives as the ring of short facets `WallLoop`
    /// recognises as a pillar, and a curved wall as a polyline that follows it.
    /// Steps are 15° apart so neighbouring facets never read as one straight
    /// wall (WallLoop merges anything within 8°).
    private static func facets(_ wall: CapturedRoom.Surface) -> [(a: Vec2, b: Vec2)] {
        guard let curve = wall.curve, curve.radius > 0 else { return [segment(wall)] }
        let start = curve.startAngle.converted(to: .radians).value
        let end = curve.endAngle.converted(to: .radians).value
        let sweep = end - start
        guard abs(sweep) > 0.01 else { return [segment(wall)] }
        let steps = max(2, Int((abs(sweep) / (15 * .pi / 180)).rounded(.up)))
        let r = curve.radius
        let points = (0...steps).map { i -> Vec2 in
            let theta = start + sweep * Double(i) / Double(steps)
            let local = SIMD4<Float>(r * Float(cos(theta)), 0, r * Float(sin(theta)), 1)
            let world = wall.transform * local
            return mm(SIMD3<Float>(world.x, world.y, world.z))
        }
        return (0..<steps).map { (a: points[$0], b: points[$0 + 1]) }
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

    private static func mapOpenings(_ room: CapturedRoom, to polygon: [Vec2], floorYMm: Double) -> [ScanOpening] {
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
                let boxHeight = Double(s.dimensions.y) * 1000
                // World Y is measured from wherever the session started (about
                // chest height), not from the floor, so the floor comes off
                // first. Without it every window's sill was ~1.3m too low —
                // usually clamped to 0, i.e. windows drawn down to the floor.
                let bottom: Double = Double(t.columns.3.y) * 1000 - boxHeight / 2 - floorYMm
                let top: Double = bottom + boxHeight
                let sill = kind == .window ? max(0, bottom) : 0
                // A door or an archway stands on the floor. RoomPlan often
                // fits its box short of the floor, and taking that box's
                // height put the door's head line below the real one once the
                // door was stood on the floor. Keep the head where RoomPlan saw
                // it and run the door down to the floor — by at most 600 mm,
                // in case the floor itself was misjudged.
                let height: Double = kind == .window ? boxHeight : min(max(boxHeight, top), boxHeight + 600)
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

    /// A pillar the wall analysis found, as a scanned object. Floor to ceiling:
    /// it is structure, and the one thing about it that is certain is that it
    /// reaches the ceiling.
    private static func column(_ pillar: WallLoop.Pillar, heightMm: Double) -> ScanObject {
        ScanObject(
            category: ScanObject.column,
            center: pillar.center,
            width: pillar.width,
            depth: pillar.depth,
            rotation: pillar.rotation,
            height: heightMm,
            shape: pillar.shape.rawValue
        )
    }

    /// A scanned object's footprint, for `PillarFinder` to leave alone.
    private static func footprint(_ o: ScanObject) -> PillarFinder.Footprint {
        PillarFinder.Footprint(center: o.center, width: o.width, depth: o.depth, rotation: o.rotation)
    }

    /// A column's footprint, for `CeilingFinder` to leave alone.
    private static func pillarFootprint(_ p: WallLoop.Pillar) -> PillarFinder.Footprint {
        PillarFinder.Footprint(center: p.center, width: p.width, depth: p.depth, rotation: p.rotation)
    }

    private static func known(_ o: ScanOpening) -> GlassFinder.Known {
        GlassFinder.Known(wall: o.wall, offset: o.offset, width: o.width)
    }

    /// Televisions RoomPlan recognised, as spans of the wall they stand
    /// against. Matched on the category's name, which is how the scan records
    /// it (see `scanObject`).
    private static func screens(_ objects: [ScanObject], polygon: [Vec2]) -> [GlassFinder.Known] {
        objects.compactMap { o -> GlassFinder.Known? in
            guard o.category == "television", let edge = nearestEdge(to: o.center, in: polygon) else { return nil }
            let start = polygon[edge]
            let end = polygon[(edge + 1) % polygon.count]
            guard distanceToSegment(o.center, start, end) <= 600 else { return nil }
            let dir = Geo.normalize(Geo.sub(end, start))
            return GlassFinder.Known(wall: edge, offset: dot(Geo.sub(o.center, start), dir) - o.width / 2, width: o.width)
        }
    }

    // MARK: Helpers

    /// A banked depth reading in plan millimetres, y as height above the floor.
    private static func ray(_ s: DepthSample, floorYMm: Double) -> GlassFinder.Ray {
        GlassFinder.Ray(
            eye: point(s.eye, floorYMm: floorYMm),
            hit: point(s.hit, floorYMm: floorYMm),
            confidence: Int(s.confidence),
            luma: Double(s.luma)
        )
    }

    /// World metres → plan millimetres with y as height above the floor.
    private static func point(_ v: SIMD3<Float>, floorYMm: Double) -> GlassFinder.Point3 {
        GlassFinder.Point3(x: Double(v.x) * 1000, y: Double(v.y) * 1000 - floorYMm, z: Double(v.z) * 1000)
    }
    private static func mm(_ v: SIMD3<Float>) -> Vec2 { Vec2(x: Double(v.x) * 1000, z: Double(v.z) * 1000) }
    private static func dot(_ a: Vec2, _ b: Vec2) -> Double { a.x * b.x + a.z * b.z }
}
