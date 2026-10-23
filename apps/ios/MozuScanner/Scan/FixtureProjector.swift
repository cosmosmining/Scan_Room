// Put the sockets on the walls.
//
// `FixtureCapture` has already worked out WHERE each socket is: a measured point
// in ARKit world metres, averaged over every frame that saw it. All that is left
// is to express it the way a `RoomScan` does — {which wall, how far along it,
// how high above the floor} — against the polygon RoomPlan hands back at the end.
//
// This used to be much more than that. Sockets were banked as image points and,
// at the end of the scan, a ray was cast from each stored camera pose through
// the finished polygon. It worked in a straight line but compounded every error
// it touched: a pixel of detection error at 4m is centimetres on the wall, pose
// drift adds more, and a ray that grazes a corner can land on the wrong wall
// entirely. Sockets came out near where they belonged rather than where they
// were. Measuring the point when it is seen, and only converting coordinates
// here, removes that whole error chain.
//
// The ray-cast remains as a fallback for a session with no scene depth, where
// there is nothing better to be had.

import Foundation
import simd

enum FixtureProjector {

    /// A track further than this from every wall is not on a wall we captured —
    /// a mirror, a reflection, or a plate on a piece of furniture. Generous
    /// enough to absorb depth noise and RoomPlan's own wall-plane tolerance.
    static let maxWallDistanceMm = 350.0
    /// A socket sitting outside this band above the floor is not a socket.
    static let minHeightMm = -120.0
    static let maxHeightMm = 2100.0
    /// Weight applied to normal disagreement when choosing which wall a track
    /// belongs to. Near a corner two walls are almost equidistant, and the wall
    /// a plate FACES is the wall it is on.
    static let normalPenaltyMm = 900.0

    /// Place confirmed tracks onto the finished floor polygon.
    ///
    /// - Parameters:
    ///   - tracks: everything `FixtureCapture` accumulated during the scan.
    ///   - polygon: the ordered floor polygon (millimetres) — edge i → i+1 is wall i.
    ///   - ceilingMm: room height, used to clamp.
    ///   - floorYMm: the floor plane in ARKit world coordinates (millimetres).
    ///     ARKit's origin is wherever the session started — usually about chest
    ///     height — so without this every socket lands a metre and a half out.
    static func fixtures(
        from tracks: [SocketTrack],
        polygon: [Vec2],
        ceilingMm: Double,
        floorYMm: Double
    ) -> [ScanFixture] {
        guard polygon.count >= 3 else { return [] }

        var placed: [ScanFixture] = []
        for track in tracks where track.confirmed {
            let point = Vec2(x: track.world.x * 1000, z: track.world.z * 1000)
            let height = track.world.y * 1000 - floorYMm
            guard height >= minHeightMm, height <= min(maxHeightMm, ceilingMm + 120) else { continue }
            guard let anchor = wall(for: point, normal: track.normal, in: polygon) else { continue }
            guard anchor.distance <= maxWallDistanceMm else { continue }

            placed.append(ScanFixture(
                // A coax or ethernet plate is labelled as what it is rather
                // than claiming to be a power socket. It still lands on the
                // plan: a cabinet must not seal that either.
                type: track.kind.fixtureKind,
                wall: anchor.wall,
                offset: anchor.offset.rounded(),
                height: min(max(height, 0), ceilingMm).rounded(),
                source: track.manual ? .manual : .detected,
                confidence: track.confidence
            ))
        }
        return placed
    }

    /// Which wall a measured point belongs to.
    ///
    /// Nearest edge, but with a penalty for edges facing the wrong way: a socket
    /// 100mm from a corner is nearly equidistant from both walls, and only its
    /// normal says which one it is mounted on.
    private static func wall(
        for point: Vec2,
        normal: SIMD3<Double>,
        in polygon: [Vec2]
    ) -> (wall: Int, offset: Double, distance: Double)? {
        var best: (wall: Int, offset: Double, distance: Double)?
        var bestCost = Double.greatestFiniteMagnitude
        let facing = simd_normalize(SIMD3<Double>(normal.x, 0, normal.z))
        let hasFacing = simd_length(SIMD3<Double>(normal.x, 0, normal.z)) > 1e-6

        for i in 0..<polygon.count {
            let start = polygon[i]
            let end = polygon[(i + 1) % polygon.count]
            guard Geo.distance(start, end) > 1 else { continue }
            let hit = Geo.project(point, onto: start, end)

            var cost = hit.distance
            if hasFacing {
                // Either horizontal normal of this edge; the plate's normal
                // should line up with one of them.
                let along = Geo.normalize(Geo.sub(end, start))
                let edgeNormal = SIMD3<Double>(along.z, 0, -along.x)
                let alignment = abs(simd_dot(facing, edgeNormal))   // 1 = parallel
                cost += (1 - alignment) * normalPenaltyMm
            }
            if cost < bestCost {
                bestCost = cost
                best = (i, hit.offset, hit.distance)
            }
        }
        return best
    }

    // MARK: Fallback — no scene depth

    /// Sightings closer together than this on the same wall are the same socket.
    static let mergeMm = 150.0
    /// A sighting whose ray misses every wall by more than this is discarded.
    static let wallSlackMm = 150.0

    /// Project banked image sightings by ray-casting, for a session that gave us
    /// no depth to measure with. Strictly the weaker path — it is here so a
    /// device without scene depth still finds something rather than nothing.
    static func fixtures(
        fromSightings sightings: [FixtureSighting],
        polygon: [Vec2],
        ceilingMm: Double,
        floorYMm: Double
    ) -> [ScanFixture] {
        guard polygon.count >= 3, !sightings.isEmpty else { return [] }

        struct Hit { var wall: Int; var offset: Double; var height: Double; var score: Double }
        var hits: [Hit] = []
        for s in sightings {
            guard let hit = cast(s, polygon: polygon, ceilingMm: ceilingMm, floorYMm: floorYMm) else { continue }
            hits.append(Hit(wall: hit.wall, offset: hit.offset, height: hit.height, score: s.score))
        }
        guard !hits.isEmpty else { return [] }

        struct Merged { var wall: Int; var offset: Double; var height: Double; var score: Double; var count: Int }
        var merged: [Merged] = []
        for hit in hits {
            if let idx = merged.firstIndex(where: {
                $0.wall == hit.wall
                    && abs($0.offset - hit.offset) < mergeMm
                    && abs($0.height - hit.height) < mergeMm
            }) {
                let n = Double(merged[idx].count)
                merged[idx].offset = (merged[idx].offset * n + hit.offset) / (n + 1)
                merged[idx].height = (merged[idx].height * n + hit.height) / (n + 1)
                merged[idx].score = max(merged[idx].score, hit.score)
                merged[idx].count += 1
            } else {
                merged.append(Merged(wall: hit.wall, offset: hit.offset, height: hit.height, score: hit.score, count: 1))
            }
        }

        // Without depth there is no geometric check at all, so corroboration is
        // the only evidence there is: demand it.
        return merged
            .filter { $0.count >= 3 }
            .map { m in
                ScanFixture(
                    type: .socket,
                    wall: m.wall,
                    offset: m.offset.rounded(),
                    height: m.height.rounded(),
                    source: .detected,
                    confidence: min(0.8, m.score * (0.4 + 0.1 * Double(m.count)))
                )
            }
    }

    private struct WallHit { var wall: Int; var offset: Double; var height: Double }

    /// Cast one sighting into the room and return the nearest wall it lands on.
    private static func cast(
        _ s: FixtureSighting, polygon: [Vec2], ceilingMm: Double, floorYMm: Double
    ) -> WallHit? {
        let fx = Double(s.intrinsics.columns.0.x)
        let fy = Double(s.intrinsics.columns.1.y)
        let cxIntr = Double(s.intrinsics.columns.2.x)
        let cyIntr = Double(s.intrinsics.columns.2.y)
        guard fx != 0, fy != 0 else { return nil }

        let u = s.cx * Double(s.imageWidth)
        let v = s.cy * Double(s.imageHeight)
        let dirCamera = simd_normalize(SIMD3<Double>(
            (u - cxIntr) / fx,
            -(v - cyIntr) / fy,
            -1
        ))

        let t = s.cameraTransform
        let rotation = simd_double3x3(
            SIMD3<Double>(Double(t.columns.0.x), Double(t.columns.0.y), Double(t.columns.0.z)),
            SIMD3<Double>(Double(t.columns.1.x), Double(t.columns.1.y), Double(t.columns.1.z)),
            SIMD3<Double>(Double(t.columns.2.x), Double(t.columns.2.y), Double(t.columns.2.z))
        )
        let dir = simd_normalize(rotation * dirCamera)
        let origin = SIMD3<Double>(
            Double(t.columns.3.x) * 1000,
            Double(t.columns.3.y) * 1000,
            Double(t.columns.3.z) * 1000
        )

        var best: (hit: WallHit, distance: Double)?
        for i in 0..<polygon.count {
            let start = polygon[i]
            let end = polygon[(i + 1) % polygon.count]
            let along = Geo.sub(end, start)
            // `Vec2.hypot` is file-private to Floorplan.swift; `Geo.distance` is
            // the cross-file way to ask the same question.
            let length = Geo.distance(start, end)
            guard length > 1 else { continue }
            let unit = Geo.normalize(along)
            let normal = SIMD3<Double>(unit.z, 0, -unit.x)

            let denominator = simd_dot(dir, normal)
            guard abs(denominator) > 1e-6 else { continue }   // ray parallel to the wall
            let toWall = SIMD3<Double>(start.x - origin.x, 0, start.z - origin.z)
            let distance = simd_dot(toWall, normal) / denominator
            guard distance > 0 else { continue }              // behind the camera

            let point = origin + dir * distance
            let offset = (point.x - start.x) * unit.x + (point.z - start.z) * unit.z
            guard offset >= -wallSlackMm, offset <= length + wallSlackMm else { continue }
            let height = point.y - floorYMm
            guard height >= -wallSlackMm, height <= ceilingMm + wallSlackMm else { continue }

            if best == nil || distance < best!.distance {
                best = (
                    WallHit(
                        wall: i,
                        offset: min(max(offset, 0), length),
                        height: max(height, 0)
                    ),
                    distance
                )
            }
        }
        return best?.hit
    }
}
