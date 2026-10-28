// Swift ⇄ TypeScript parity harness.
//
// The iPad's scan geometry (WallLoop, GlassFinder, PillarFinder, CeilingFinder, SocketDetector) has a
// TypeScript twin that carries the tests. This tiny command-line tool runs the
// SWIFT versions on whatever the TypeScript test feeds it on stdin and prints
// the results as JSON, so `src/systems/scan/__tests__/swiftParity.test.ts` can
// demand that the two agree to the micron.
//
// It compiles the app's own source files unchanged — see
// scripts/swift-parity.sh — so a drift between the twins fails CI instead of
// surfacing as a floor plan that differs between the iPad and the web.

import Foundation

struct InSeg: Codable { var a: Vec2; var b: Vec2; var heightMm: Double?; var topMm: Double? }
struct InP3: Codable { var x: Double; var y: Double; var z: Double }
struct InRay: Codable { var eye: InP3; var hit: InP3; var confidence: Int?; var luma: Double? }
struct InKnown: Codable { var wall: Int; var offset: Double; var width: Double }
struct GlassCase: Codable { var rays: [InRay]; var polygon: [Vec2]; var ceilingMm: Double; var existing: [InKnown] }
struct InFoot: Codable { var center: Vec2; var width: Double; var depth: Double; var rotation: Double }
struct PillarCase: Codable { var rays: [InRay]; var polygon: [Vec2]; var ceilingMm: Double; var exclude: [InFoot] }
struct GrayCase: Codable { var width: Int; var height: Int; var pixels: [Float] }
struct CeilingCase: Codable { var rays: [InRay]; var polygon: [Vec2]; var exclude: [InFoot] }
struct Input: Codable {
    var walls: [[InSeg]]?; var glass: [GlassCase]?; var pillars: [PillarCase]?; var images: [GrayCase]?
    var ceilings: [CeilingCase]?
}

struct OutPillar: Codable {
    var center: Vec2; var shape: String; var width: Double; var depth: Double; var rotation: Double; var partial: Bool
}
struct OutWall: Codable { var outline: [Vec2]; var pillars: [OutPillar]; var clutterRejected: Int }
struct OutDet: Codable { var cx: Double; var cy: Double; var w: Double; var h: Double; var holes: Int; var score: Double }
struct OutZone: Codable { var polygon: [Vec2]; var height: Double }
struct OutCeiling: Codable { var height: Double; var seeThroughTo: Double?; var zones: [OutZone] }
struct Output: Codable {
    var walls: [OutWall]; var glass: [[ScanOpening]]; var pillars: [[OutPillar]]; var detections: [[OutDet]]
    var ceilings: [OutCeiling?]
}

func ray(_ r: InRay) -> GlassFinder.Ray {
    GlassFinder.Ray(
        eye: .init(x: r.eye.x, y: r.eye.y, z: r.eye.z),
        hit: .init(x: r.hit.x, y: r.hit.y, z: r.hit.z),
        confidence: r.confidence ?? 2,
        luma: r.luma ?? -1
    )
}

func out(_ p: WallLoop.Pillar) -> OutPillar {
    OutPillar(center: p.center, shape: p.shape.rawValue, width: p.width, depth: p.depth, rotation: p.rotation, partial: p.partial)
}

let input = try JSONDecoder().decode(Input.self, from: FileHandle.standardInput.readDataToEndOfFile())

let walls: [OutWall] = (input.walls ?? []).map { segs in
    let r = WallLoop.analyse(segs.map { WallLoop.Segment(a: $0.a, b: $0.b, heightMm: $0.heightMm, topMm: $0.topMm) })
    return OutWall(
        outline: r.outline,
        pillars: r.pillars.map(out),
        clutterRejected: r.clutterRejected
    )
}

let glass: [[ScanOpening]] = (input.glass ?? []).map { g in
    GlassFinder.openings(
        rays: g.rays.map(ray),
        polygon: g.polygon,
        ceilingMm: g.ceilingMm,
        existing: g.existing.map { GlassFinder.Known(wall: $0.wall, offset: $0.offset, width: $0.width) }
    )
}

let pillars: [[OutPillar]] = (input.pillars ?? []).map { c in
    PillarFinder.pillars(
        rays: c.rays.map(ray),
        polygon: c.polygon,
        ceilingMm: c.ceilingMm,
        exclude: c.exclude.map { PillarFinder.Footprint(center: $0.center, width: $0.width, depth: $0.depth, rotation: $0.rotation) }
    ).map(out)
}

let detections: [[OutDet]] = (input.images ?? []).map { i in
    SocketDetector.detect(GrayImage(pixels: i.pixels, width: i.width, height: i.height), maxDim: 256, minScore: 0.35)
        .map { OutDet(cx: $0.cx, cy: $0.cy, w: $0.w, h: $0.h, holes: $0.holes, score: $0.score) }
}

let ceilings: [OutCeiling?] = (input.ceilings ?? []).map { c in
    CeilingFinder.ceiling(
        rays: c.rays.map(ray),
        polygon: c.polygon,
        exclude: c.exclude.map { PillarFinder.Footprint(center: $0.center, width: $0.width, depth: $0.depth, rotation: $0.rotation) }
    ).map { a in
        OutCeiling(height: a.height, seeThroughTo: a.seeThroughTo, zones: a.zones.map { OutZone(polygon: $0.polygon, height: $0.height) })
    }
}

FileHandle.standardOutput.write(try JSONEncoder().encode(Output(
    walls: walls, glass: glass, pillars: pillars, detections: detections, ceilings: ceilings
)))
