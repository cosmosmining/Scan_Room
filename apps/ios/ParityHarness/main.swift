// Swift ⇄ TypeScript parity harness.
//
// The iPad's scan geometry (WallLoop, GlassFinder, SocketDetector) has a
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
struct InRay: Codable { var eye: InP3; var hit: InP3 }
struct InKnown: Codable { var wall: Int; var offset: Double; var width: Double }
struct GlassCase: Codable { var rays: [InRay]; var polygon: [Vec2]; var ceilingMm: Double; var existing: [InKnown] }
struct GrayCase: Codable { var width: Int; var height: Int; var pixels: [Float] }
struct Input: Codable { var walls: [[InSeg]]?; var glass: [GlassCase]?; var images: [GrayCase]? }

struct OutPillar: Codable { var center: Vec2; var shape: String; var width: Double; var depth: Double; var rotation: Double }
struct OutWall: Codable { var outline: [Vec2]; var pillars: [OutPillar]; var clutterRejected: Int }
struct OutDet: Codable { var cx: Double; var cy: Double; var w: Double; var h: Double; var holes: Int; var score: Double }
struct Output: Codable { var walls: [OutWall]; var glass: [[ScanOpening]]; var detections: [[OutDet]] }

let input = try JSONDecoder().decode(Input.self, from: FileHandle.standardInput.readDataToEndOfFile())

let walls: [OutWall] = (input.walls ?? []).map { segs in
    let r = WallLoop.analyse(segs.map { WallLoop.Segment(a: $0.a, b: $0.b, heightMm: $0.heightMm, topMm: $0.topMm) })
    return OutWall(
        outline: r.outline,
        pillars: r.pillars.map {
            OutPillar(center: $0.center, shape: $0.shape.rawValue, width: $0.width, depth: $0.depth, rotation: $0.rotation)
        },
        clutterRejected: r.clutterRejected
    )
}

let glass: [[ScanOpening]] = (input.glass ?? []).map { g in
    GlassFinder.openings(
        rays: g.rays.map {
            GlassFinder.Ray(eye: .init(x: $0.eye.x, y: $0.eye.y, z: $0.eye.z), hit: .init(x: $0.hit.x, y: $0.hit.y, z: $0.hit.z))
        },
        polygon: g.polygon,
        ceilingMm: g.ceilingMm,
        existing: g.existing.map { GlassFinder.Known(wall: $0.wall, offset: $0.offset, width: $0.width) }
    )
}

let detections: [[OutDet]] = (input.images ?? []).map { i in
    SocketDetector.detect(GrayImage(pixels: i.pixels, width: i.width, height: i.height), maxDim: 256, minScore: 0.35)
        .map { OutDet(cx: $0.cx, cy: $0.cy, w: $0.w, h: $0.h, holes: $0.holes, score: $0.score) }
}

FileHandle.standardOutput.write(try JSONEncoder().encode(Output(walls: walls, glass: glass, detections: detections)))
