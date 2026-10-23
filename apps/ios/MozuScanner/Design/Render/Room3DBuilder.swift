// Builds the realistic 3D shell of the scanned room — floor, walls and ceiling —
// from the `DesignRoom` polygon. The floor and ceiling are triangulated with a
// simple ear-clipping pass so non-convex (e.g. L-shaped) footprints render
// correctly; walls are thin extruded boxes that follow each polygon edge and face
// inward. Surfaces are textured via `MaterialFactory` so marble/plaster read as
// real PBR materials rather than flat white.
//
// Conventions (see Design/README.md): metres; floor plane X (right) / Z (forward),
// Y up; floor sits at y = 0, ceiling at y = room.height. Floor/ceiling UVs are the
// world (x, z) coordinates so the texture tiles by the metre. Walls use a texture
// scale derived from their real size so the same marble tiles at the same density.

import Foundation
import RealityKit
import UIKit
import simd

enum Room3DBuilder {

    // MARK: - Entry point

    /// Build the room shell (floor + walls + ceiling) as a single parent entity.
    /// The parent sits at the world origin; all geometry is expressed in the floor
    /// plane's metric coordinates so placed furniture shares the same space.
    static func build(_ room: DesignRoom, swatches: [Swatch]) -> Entity {
        let root = Entity()
        root.name = "room"

        // Ensure a consistent (counter-clockwise) winding so generated normals and
        // ear-clipping behave deterministically regardless of the source polygon.
        let footprint = normalizedCCW(room.footprint)

        if let floor = buildFloor(footprint, finish: room.floorFinish, swatches: swatches) {
            floor.name = "floor"
            root.addChild(floor)
        }

        for (i, wall) in room.walls.enumerated() {
            let entity = buildWall(wall,
                                   height: room.height,
                                   openings: room.openings.filter { $0.wall == i },
                                   finish: room.wallFinish,
                                   swatches: swatches)
            entity.name = "wall_\(i)"
            root.addChild(entity)
        }

        // Sockets, on the inward face of their wall.
        for socket in room.sockets where socket.wall >= 0 && socket.wall < room.walls.count {
            let entity = buildSocket(socket, on: room.walls[socket.wall], thickness: room.wallThickness)
            entity.name = "socket_\(socket.id)"
            root.addChild(entity)
        }

        if let ceiling = buildCeiling(footprint,
                                      height: room.height,
                                      finish: room.ceilingFinish,
                                      swatches: swatches) {
            ceiling.name = "ceiling"
            root.addChild(ceiling)
        }

        return root
    }

    // MARK: - Sockets

    /// A socket faceplate: a thin plate sitting proud of the wall's inward face,
    /// with two darker slots so it reads as an outlet rather than a blank tile.
    private static func buildSocket(_ socket: DesignSocket,
                                    on wall: WallSegment,
                                    thickness: Float) -> Entity {
        let container = Entity()
        let plateW: Float = 0.086      // a single faceplate, ~86mm
        let plateH: Float = 0.086
        let plateD: Float = 0.011

        var plateMaterial = PhysicallyBasedMaterial()
        plateMaterial.baseColor = PhysicallyBasedMaterial.BaseColor(
            tint: UIColor(white: socket.manual ? 0.82 : 0.96, alpha: 1.0))
        plateMaterial.roughness = .init(floatLiteral: 0.45)
        plateMaterial.metallic = .init(floatLiteral: 0.0)
        let plate = ModelEntity(
            mesh: .generateBox(width: plateW, height: plateH, depth: plateD, cornerRadius: 0.006),
            materials: [plateMaterial]
        )
        container.addChild(plate)

        var slotMaterial = PhysicallyBasedMaterial()
        slotMaterial.baseColor = PhysicallyBasedMaterial.BaseColor(
            tint: UIColor(white: 0.09, alpha: 1.0))
        slotMaterial.roughness = .init(floatLiteral: 0.9)
        slotMaterial.metallic = .init(floatLiteral: 0.0)
        for dx in [-0.017, 0.017] as [Float] {
            let slot = ModelEntity(
                mesh: .generateBox(width: 0.006, height: 0.017, depth: 0.004),
                materials: [slotMaterial]
            )
            slot.position = SIMD3<Float>(dx, 0, plateD / 2)
            plate.addChild(slot)
        }

        // Place it along the wall, on the face that looks into the room.
        let along = simd_normalize(wall.b - wall.a)
        let t = min(max(socket.offset, 0), wall.length)
        let base = wall.a + along * t
        let inward = -wall.outward
        let surface = base + inward * (thickness / 2 + plateD / 2)
        container.position = SIMD3<Float>(surface.x, socket.height, surface.y)
        // Face into the room.
        container.orientation = simd_quatf(angle: atan2(inward.x, inward.y), axis: SIMD3<Float>(0, 1, 0))
        return container
    }

    // MARK: - Floor

    private static func buildFloor(_ polygon: [SIMD2<Float>],
                                   finish: SurfaceFinish,
                                   swatches: [Swatch]) -> ModelEntity? {
        guard polygon.count >= 3 else { return nil }
        let triangles = earClip(polygon)
        guard !triangles.isEmpty else { return nil }

        // Positions at y = 0. Planar UVs use world (x, z) so the marble tiles by the
        // metre. The floor faces up (+Y), so we keep the CCW winding (front face up).
        var positions: [SIMD3<Float>] = []
        var uvs: [SIMD2<Float>] = []
        var indices: [UInt32] = []
        positions.reserveCapacity(polygon.count)
        uvs.reserveCapacity(polygon.count)

        for p in polygon {
            positions.append(SIMD3<Float>(p.x, 0, p.y))
            uvs.append(SIMD2<Float>(p.x, p.y))
        }
        for tri in triangles {
            // CCW in the X/Z floor plane gives a downward facing normal under
            // RealityKit's right-handed convention; reverse so the front face is up.
            indices.append(UInt32(tri.0))
            indices.append(UInt32(tri.2))
            indices.append(UInt32(tri.1))
        }

        guard let mesh = makeMesh(positions: positions,
                                  uvs: uvs,
                                  indices: indices,
                                  normal: SIMD3<Float>(0, 1, 0)) else { return nil }

        let material = MaterialFactory.material(for: finish, swatches: swatches)
        return ModelEntity(mesh: mesh, materials: [material])
    }

    // MARK: - Ceiling

    private static func buildCeiling(_ polygon: [SIMD2<Float>],
                                     height: Float,
                                     finish: SurfaceFinish,
                                     swatches: [Swatch]) -> ModelEntity? {
        guard polygon.count >= 3 else { return nil }
        let triangles = earClip(polygon)
        guard !triangles.isEmpty else { return nil }

        var positions: [SIMD3<Float>] = []
        var uvs: [SIMD2<Float>] = []
        var indices: [UInt32] = []
        positions.reserveCapacity(polygon.count)
        uvs.reserveCapacity(polygon.count)

        for p in polygon {
            positions.append(SIMD3<Float>(p.x, height, p.y))
            uvs.append(SIMD2<Float>(p.x, p.y))
        }
        // The ceiling faces down (−Y) into the room, so keep the floor-plane CCW
        // winding (which yields a downward normal) without the reversal we applied
        // to the floor.
        for tri in triangles {
            indices.append(UInt32(tri.0))
            indices.append(UInt32(tri.1))
            indices.append(UInt32(tri.2))
        }

        guard let mesh = makeMesh(positions: positions,
                                  uvs: uvs,
                                  indices: indices,
                                  normal: SIMD3<Float>(0, -1, 0)) else { return nil }

        let material = MaterialFactory.material(for: finish, swatches: swatches)
        return ModelEntity(mesh: mesh, materials: [material])
    }

    // MARK: - Walls

    /// A solid stretch of wall in the wall's local (t, y) space — t metres along the
    /// edge from its start vertex, y metres above the floor.
    private struct WallRect {
        var t0: Float, t1: Float, y0: Float, y1: Float
    }

    /// An opening span resolved onto a wall: horizontal range along the edge plus
    /// the vertical hole range (doors reach the floor, windows sit above a sill).
    private struct OpeningSpan {
        var t0: Float, t1: Float, y0: Float, y1: Float
        var isWindow: Bool
        var isArchway: Bool
        /// Doors and archways reach the floor (they break the baseboard run).
        var reachesFloor: Bool { !isWindow }
    }

    /// Build one wall as a container entity: the wall surface with the scanned
    /// door/window/archway openings actually CUT OUT of it (piers between openings,
    /// headers above them, aprons below windows), plus glass panes in the windows,
    /// simple painted trim around doors/windows, and a baseboard along the floor —
    /// the details that make the shell read as a real room instead of solid slabs.
    private static func buildWall(_ wall: WallSegment,
                                  height: Float,
                                  openings: [DesignOpening],
                                  finish: SurfaceFinish,
                                  swatches: [Swatch]) -> Entity {
        let container = Entity()
        let h = max(height, 0.001)
        let length = max(wall.length, 0.001)
        let a = wall.a, b = wall.b
        let inward = -wall.outward
        let normal = SIMD3<Float>(inward.x, 0, inward.y)

        let spans = resolveSpans(openings, wallLength: length, wallHeight: h)
        let rects = solidRects(spans: spans, wallLength: length, wallHeight: h)

        // --- Wall surface: one mesh from all solid rectangles. UVs are METRES so
        // the texture tiles at real-world density (never smeared across the wall).
        var positions: [SIMD3<Float>] = []
        var uvs: [SIMD2<Float>] = []
        var indices: [UInt32] = []
        let dir = (b - a) / length

        // Wind the front face toward the interior so the wall shows from inside and
        // is back-face culled from outside — preserving the dollhouse cutaway view.
        // The 0-1-2 winding has geometric normal (−Δz, Δx); flip if it faces out.
        let g = SIMD2<Float>(-(b.y - a.y), b.x - a.x)
        let flip = simd_dot(g, inward) < 0

        for r in rects {
            let p0 = a + dir * r.t0
            let p1 = a + dir * r.t1
            let base = UInt32(positions.count)
            positions.append(SIMD3<Float>(p0.x, r.y0, p0.y))
            positions.append(SIMD3<Float>(p1.x, r.y0, p1.y))
            positions.append(SIMD3<Float>(p1.x, r.y1, p1.y))
            positions.append(SIMD3<Float>(p0.x, r.y1, p0.y))
            uvs.append(SIMD2<Float>(r.t0, r.y0))
            uvs.append(SIMD2<Float>(r.t1, r.y0))
            uvs.append(SIMD2<Float>(r.t1, r.y1))
            uvs.append(SIMD2<Float>(r.t0, r.y1))
            if flip {
                indices.append(contentsOf: [base, base + 2, base + 1, base, base + 3, base + 2])
            } else {
                indices.append(contentsOf: [base, base + 1, base + 2, base, base + 2, base + 3])
            }
        }

        if let mesh = makeMesh(positions: positions, uvs: uvs, indices: indices, normal: normal) {
            let material = MaterialFactory.material(for: finish, swatches: swatches)
            let surface = ModelEntity(mesh: mesh, materials: [material])
            surface.name = "wall_surface"
            container.addChild(surface)
        }

        // --- Opening details: glass + frames + sills.
        for span in spans {
            if span.isWindow {
                addWindowDetails(to: container, wall: wall, span: span)
            } else if !span.isArchway {
                addDoorTrim(to: container, wall: wall, span: span)
            }
            // Archways stay clean cut-throughs.
        }

        // --- Baseboard along the floor, broken at door/archway openings.
        addBaseboard(to: container, wall: wall, spans: spans, wallLength: length)

        return container
    }

    /// Clamp openings onto the wall, sort them, and drop/merge degenerate overlaps.
    /// `DesignOpening.offset` is the distance from the wall's start vertex to the
    /// opening's CENTRE (that is what `FloorplanBuilder` records).
    private static func resolveSpans(_ openings: [DesignOpening],
                                     wallLength: Float,
                                     wallHeight: Float) -> [OpeningSpan] {
        var spans: [OpeningSpan] = []
        for o in openings {
            // `offset` is the opening's leading edge along the wall (the shared
            // RoomScan contract), so the span is [offset, offset + width].
            var t0 = o.offset
            var t1 = o.offset + o.width
            t0 = max(t0, 0.02)
            t1 = min(t1, wallLength - 0.02)
            guard t1 - t0 > 0.05 else { continue }

            let isWindow = o.kind == "window"
            let y0 = isWindow ? max(o.sill, 0.05) : 0
            let y1 = min(y0 + max(o.height, 0.1), wallHeight - 0.05)
            guard y1 - y0 > 0.05 else { continue }

            spans.append(OpeningSpan(t0: t0, t1: t1, y0: y0, y1: y1,
                                     isWindow: isWindow,
                                     isArchway: o.kind == "archway"))
        }
        spans.sort { $0.t0 < $1.t0 }

        // Nudge overlapping spans apart so the rectangle decomposition stays simple.
        var merged: [OpeningSpan] = []
        for var s in spans {
            if let last = merged.last, s.t0 < last.t1 + 0.01 {
                s.t0 = last.t1 + 0.02
                guard s.t1 - s.t0 > 0.05 else { continue }
            }
            merged.append(s)
        }
        return merged
    }

    /// Decompose the wall face minus its openings into solid rectangles:
    /// full-height piers between openings, headers above every opening, and
    /// aprons below windows.
    private static func solidRects(spans: [OpeningSpan],
                                   wallLength: Float,
                                   wallHeight: Float) -> [WallRect] {
        var rects: [WallRect] = []
        var cursor: Float = 0
        for s in spans {
            if s.t0 > cursor + 0.005 {
                rects.append(WallRect(t0: cursor, t1: s.t0, y0: 0, y1: wallHeight))
            }
            if s.y1 < wallHeight - 0.005 {                      // header above
                rects.append(WallRect(t0: s.t0, t1: s.t1, y0: s.y1, y1: wallHeight))
            }
            if s.y0 > 0.005 {                                   // apron below (window)
                rects.append(WallRect(t0: s.t0, t1: s.t1, y0: 0, y1: s.y0))
            }
            cursor = s.t1
        }
        if cursor < wallLength - 0.005 {
            rects.append(WallRect(t0: cursor, t1: wallLength, y0: 0, y1: wallHeight))
        }
        if rects.isEmpty {
            rects.append(WallRect(t0: 0, t1: wallLength, y0: 0, y1: wallHeight))
        }
        return rects
    }

    // MARK: - Wall details (trim, glass, baseboard)

    /// Painted-white satin trim, matching real interior casing/baseboards.
    private static func trimMaterial() -> PhysicallyBasedMaterial {
        var m = PhysicallyBasedMaterial()
        m.baseColor = PhysicallyBasedMaterial.BaseColor(
            tint: UIColor(red: 0.94, green: 0.94, blue: 0.92, alpha: 1.0))
        m.roughness = .init(floatLiteral: 0.45)
        m.metallic = .init(floatLiteral: 0.0)
        return m
    }

    /// Slightly blue-tinted, highly transparent glass for window panes.
    private static func glassMaterial() -> PhysicallyBasedMaterial {
        var m = PhysicallyBasedMaterial()
        m.baseColor = PhysicallyBasedMaterial.BaseColor(
            tint: UIColor(red: 0.78, green: 0.86, blue: 0.94, alpha: 1.0))
        m.roughness = .init(floatLiteral: 0.03)
        m.metallic = .init(floatLiteral: 0.0)
        m.blending = .transparent(opacity: .init(floatLiteral: 0.18))
        m.faceCulling = .none
        return m
    }

    /// A box aligned to the wall: local +X runs along the edge (start → end),
    /// centred `tCenter` metres along it and `yCenter` above the floor, pushed
    /// `inset` metres toward the room interior (0 = centred on the wall plane).
    private static func wallBox(wall: WallSegment,
                                tCenter: Float, yCenter: Float,
                                width: Float, boxHeight: Float, depth: Float,
                                inset: Float,
                                material: RealityKit.Material,
                                name: String) -> ModelEntity {
        let mesh = MeshResource.generateBox(width: width, height: boxHeight, depth: depth)
        let entity = ModelEntity(mesh: mesh, materials: [material])
        entity.name = name

        let length = max(wall.length, 0.001)
        let dir = (wall.b - wall.a) / length
        // Rotating about +Y by −yaw maps local +X onto (dir.x, 0, dir.y) — the
        // same proven orientation the old box walls used.
        let yaw = atan2f(dir.y, dir.x)
        entity.orientation = simd_quatf(angle: -yaw, axis: SIMD3<Float>(0, 1, 0))

        let inward = -wall.outward
        let mid = wall.a + dir * tCenter + inward * inset
        entity.position = SIMD3<Float>(mid.x, yCenter, mid.y)
        return entity
    }

    /// Window: glass pane in the hole, painted frame (jambs + head) and a sill board.
    private static func addWindowDetails(to container: Entity, wall: WallSegment, span: OpeningSpan) {
        let trim = trimMaterial()
        let w = span.t1 - span.t0
        let hgt = span.y1 - span.y0
        let tMid = (span.t0 + span.t1) / 2
        let yMid = (span.y0 + span.y1) / 2

        container.addChild(wallBox(wall: wall, tCenter: tMid, yCenter: yMid,
                                   width: w, boxHeight: hgt, depth: 0.012,
                                   inset: 0, material: glassMaterial(), name: "window_glass"))

        let jamb: Float = 0.05, casingDepth: Float = 0.10
        container.addChild(wallBox(wall: wall, tCenter: span.t0, yCenter: yMid,
                                   width: jamb, boxHeight: hgt + jamb, depth: casingDepth,
                                   inset: 0, material: trim, name: "window_jamb_l"))
        container.addChild(wallBox(wall: wall, tCenter: span.t1, yCenter: yMid,
                                   width: jamb, boxHeight: hgt + jamb, depth: casingDepth,
                                   inset: 0, material: trim, name: "window_jamb_r"))
        container.addChild(wallBox(wall: wall, tCenter: tMid, yCenter: span.y1,
                                   width: w + jamb, boxHeight: jamb, depth: casingDepth,
                                   inset: 0, material: trim, name: "window_head"))
        // Sill board: a little wider and deeper, protruding into the room.
        container.addChild(wallBox(wall: wall, tCenter: tMid, yCenter: span.y0,
                                   width: w + 0.08, boxHeight: 0.04, depth: 0.16,
                                   inset: 0.02, material: trim, name: "window_sill"))
    }

    /// Door / open doorway: painted jambs and a head casing around the cut.
    private static func addDoorTrim(to container: Entity, wall: WallSegment, span: OpeningSpan) {
        let trim = trimMaterial()
        let w = span.t1 - span.t0
        let tMid = (span.t0 + span.t1) / 2
        let yMid = span.y1 / 2
        let jamb: Float = 0.055, casingDepth: Float = 0.11

        container.addChild(wallBox(wall: wall, tCenter: span.t0, yCenter: yMid,
                                   width: jamb, boxHeight: span.y1, depth: casingDepth,
                                   inset: 0, material: trim, name: "door_jamb_l"))
        container.addChild(wallBox(wall: wall, tCenter: span.t1, yCenter: yMid,
                                   width: jamb, boxHeight: span.y1, depth: casingDepth,
                                   inset: 0, material: trim, name: "door_jamb_r"))
        container.addChild(wallBox(wall: wall, tCenter: tMid, yCenter: span.y1,
                                   width: w + jamb, boxHeight: jamb, depth: casingDepth,
                                   inset: 0, material: trim, name: "door_head"))
    }

    /// Baseboard (skirting) along the wall's floor line, broken where doors and
    /// archways cut through. Windows keep their baseboard (the wall apron remains).
    private static func addBaseboard(to container: Entity,
                                     wall: WallSegment,
                                     spans: [OpeningSpan],
                                     wallLength: Float) {
        let boardH: Float = 0.09
        let boardD: Float = 0.016
        let trim = trimMaterial()

        var runs: [(Float, Float)] = []
        var cursor: Float = 0
        for s in spans where s.reachesFloor {
            if s.t0 > cursor + 0.03 { runs.append((cursor, s.t0)) }
            cursor = max(cursor, s.t1)
        }
        if cursor < wallLength - 0.03 { runs.append((cursor, wallLength)) }

        for (r0, r1) in runs {
            container.addChild(wallBox(wall: wall,
                                       tCenter: (r0 + r1) / 2, yCenter: boardH / 2,
                                       width: r1 - r0, boxHeight: boardH, depth: boardD,
                                       inset: boardD / 2 + 0.001,
                                       material: trim, name: "baseboard"))
        }
    }

    // MARK: - Mesh assembly

    /// Build a `MeshResource` from explicit positions / UVs / indices, with a single
    /// shared normal (all our surfaces here are planar). Returns nil on failure.
    private static func makeMesh(positions: [SIMD3<Float>],
                                 uvs: [SIMD2<Float>],
                                 indices: [UInt32],
                                 normal: SIMD3<Float>) -> MeshResource? {
        var descriptor = MeshDescriptor(name: "surface")
        descriptor.positions = MeshBuffers.Positions(positions)
        descriptor.textureCoordinates = MeshBuffers.TextureCoordinates(uvs)
        descriptor.normals = MeshBuffers.Normals(Array(repeating: normal, count: positions.count))
        descriptor.primitives = .triangles(indices)
        return try? MeshResource.generate(from: [descriptor])
    }

    // MARK: - Polygon helpers

    /// Signed area (shoelace) in the X/Z floor plane. Positive ⇒ CCW.
    private static func signedArea(_ poly: [SIMD2<Float>]) -> Float {
        var s: Float = 0
        for i in poly.indices {
            let p = poly[i]
            let q = poly[(i + 1) % poly.count]
            s += p.x * q.y - q.x * p.y
        }
        return s / 2
    }

    /// Return the polygon wound counter-clockwise, with any duplicate trailing
    /// vertex (a repeated closing point) removed.
    private static func normalizedCCW(_ poly: [SIMD2<Float>]) -> [SIMD2<Float>] {
        var p = poly
        if let first = p.first, let last = p.last,
           p.count > 1, simd_distance(first, last) < 1e-5 {
            p.removeLast()
        }
        guard p.count >= 3 else { return p }
        if signedArea(p) < 0 { p.reverse() }
        return p
    }

    // MARK: - Ear-clipping triangulation

    /// Triangulate a simple polygon (convex or non-convex, e.g. L-shaped) by
    /// ear-clipping. Input is assumed CCW (see `normalizedCCW`). Returns triangles
    /// as index triples into the original `polygon`, each wound CCW in the X/Z
    /// plane.
    private static func earClip(_ polygon: [SIMD2<Float>]) -> [(Int, Int, Int)] {
        let n = polygon.count
        guard n >= 3 else { return [] }
        if n == 3 { return [(0, 1, 2)] }

        // Working list of vertex indices into `polygon`.
        var remaining = Array(0..<n)
        var triangles: [(Int, Int, Int)] = []
        triangles.reserveCapacity(n - 2)

        var guardCounter = 0
        let maxIterations = n * n + 1   // safety against degenerate input

        while remaining.count > 3 {
            guardCounter += 1
            if guardCounter > maxIterations { break }

            var earFound = false
            let count = remaining.count

            for i in 0..<count {
                let iPrev = remaining[(i + count - 1) % count]
                let iCurr = remaining[i]
                let iNext = remaining[(i + 1) % count]

                let a = polygon[iPrev]
                let b = polygon[iCurr]
                let c = polygon[iNext]

                // Convex corner? (CCW polygon ⇒ ears turn left.)
                if cross(b - a, c - b) <= 0 { continue }

                // No other vertex inside triangle a-b-c?
                var contains = false
                for j in remaining where j != iPrev && j != iCurr && j != iNext {
                    if pointInTriangle(polygon[j], a, b, c) { contains = true; break }
                }
                if contains { continue }

                triangles.append((iPrev, iCurr, iNext))
                remaining.remove(at: i)
                earFound = true
                break
            }

            // Degenerate / self-touching polygon: bail out rather than loop forever.
            if !earFound { break }
        }

        if remaining.count == 3 {
            triangles.append((remaining[0], remaining[1], remaining[2]))
        }
        return triangles
    }

    /// 2D cross product (z-component) of edge vectors.
    private static func cross(_ u: SIMD2<Float>, _ v: SIMD2<Float>) -> Float {
        u.x * v.y - u.y * v.x
    }

    /// Barycentric point-in-triangle test (inclusive of edges).
    private static func pointInTriangle(_ p: SIMD2<Float>,
                                        _ a: SIMD2<Float>,
                                        _ b: SIMD2<Float>,
                                        _ c: SIMD2<Float>) -> Bool {
        let d1 = cross(b - a, p - a)
        let d2 = cross(c - b, p - b)
        let d3 = cross(a - c, p - c)
        let hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0)
        let hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0)
        return !(hasNeg && hasPos)
    }
}
