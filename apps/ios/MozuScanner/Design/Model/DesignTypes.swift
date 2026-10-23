// Shared data model for the MOZU room-design experience (Phase: place & style
// furniture inside the scanned room). Everything here is framework-agnostic value
// types — the RealityKit 3D scene, the 2D floor plan, and the material editor all
// project from this model.
//
// UNITS: the design layer works in METRES (RealityKit-native). The source
// `RoomScan` is millimetres; conversions happen in `DesignRoom(scan:)`. Floor
// plane is X (right) / Z (forward); Y is up. A placed item's `position` is the
// point on the floor under its footprint centre (its base sits at y = 0).

import Foundation
import SwiftUI
import simd

let MM_TO_M: Float = 0.001

// MARK: - Materials ("Change Color")

/// The finish/material type from the editor — maps to PBR roughness/metalness.
enum SurfaceMaterialKind: String, CaseIterable, Identifiable, Codable {
    case matte = "Default"
    case plastic = "Plastic"
    case fabric = "Fabric"
    case metal = "Metal"
    case mirror = "Mirror"
    case glass = "Glass"
    case polished = "Polished"

    var id: String { rawValue }

    /// PBR preset (roughness, metalness).
    var pbr: (roughness: Float, metalness: Float) {
        switch self {
        case .matte: return (0.85, 0.0)
        case .plastic: return (0.45, 0.0)
        case .fabric: return (0.95, 0.0)
        case .metal: return (0.30, 1.0)
        case .mirror: return (0.02, 1.0)
        case .glass: return (0.05, 0.0)
        case .polished: return (0.12, 0.2)
        }
    }

    var isTranslucent: Bool { self == .glass }
    var opacity: Float { self == .glass ? 0.35 : 1.0 }
}

/// Swatch category tabs in the "Change Color" sheet.
enum SwatchCategory: String, CaseIterable, Identifiable, Codable {
    case color = "Color"
    case wood = "Wood"
    case hue = "Hue"
    case glossy = "Glossy"
    case touch = "Touch"
    case fabric = "Fabric"
    case real = "Real"
    case marble = "Marble"
    case granite = "Granite"
    case tile = "Tile"
    case finishes = "Finishes"

    var id: String { rawValue }
}

/// One selectable swatch — a bundled texture or a solid colour.
struct Swatch: Identifiable, Hashable, Codable {
    let id: String
    let name: String
    let category: SwatchCategory
    /// Bundled texture image (no extension) under Resources/Textures, or nil for a solid colour.
    let textureName: String?
    /// sRGB tint (the colour itself when `textureName == nil`, otherwise a multiply tint).
    var rgba: SIMD4<Float> = SIMD4<Float>(1, 1, 1, 1)
    /// Representative flat tone for a *textured* swatch, used by the 2D plan so it
    /// needn't sample the bitmap. nil for solid-colour swatches (use `rgba`).
    var avgColor: SIMD4<Float>? = nil

    var color: Color {
        Color(.sRGB, red: Double(rgba.x), green: Double(rgba.y), blue: Double(rgba.z), opacity: Double(rgba.w))
    }
}

/// Full material state of a surface or model — the editor's output.
struct SurfaceFinish: Hashable, Codable {
    var swatchID: String
    var kind: SurfaceMaterialKind = .matte
    /// Texture tiling repeats across the surface (the "Texture Scale" control).
    var textureScale: Float = 1.0
    /// Texture rotation in radians (the "Rotation" slider).
    var rotation: Float = 0.0
    /// Optional colour tint applied on top of the swatch.
    var tint: SIMD4<Float>? = nil
}

/// Where a finish is being applied.
enum FinishTarget: Hashable {
    case item(UUID)
    case wall
    case floor
    case ceiling
}

// MARK: - Furniture catalogue

struct FurnitureItem: Identifiable, Hashable, Codable {
    let id: String
    let name: String
    /// Display grouping: "Cabinet", "Table", "Sofa", "Bed", "Lighting"…
    let category: String
    /// Bundled `.usdz` resource name (no extension), or nil to render a generated box.
    let usdzName: String?
    /// Real-world size in metres (width x height x depth). Drives scaling + the box fallback.
    let size: SIMD3<Float>
    /// Optional bundled thumbnail asset name.
    var thumbnail: String? = nil
    /// Default material when first placed.
    var defaultFinish: SurfaceFinish? = nil
}

/// A furniture instance placed in the room.
struct PlacedFurniture: Identifiable, Hashable, Codable {
    let id: UUID
    let itemID: String
    /// Floor point under the footprint centre (metres); base sits at y = 0.
    var position: SIMD3<Float>
    /// Yaw around +Y (radians).
    var rotationY: Float
    /// Per-instance material override; nil = the item's default.
    var finish: SurfaceFinish?

    init(id: UUID = UUID(), itemID: String, position: SIMD3<Float>, rotationY: Float = 0, finish: SurfaceFinish? = nil) {
        self.id = id
        self.itemID = itemID
        self.position = position
        self.rotationY = rotationY
        self.finish = finish
    }
}

// MARK: - Room

struct WallSegment: Identifiable, Hashable {
    let id: Int
    /// Endpoints on the floor plane (metres).
    var a: SIMD2<Float>
    var b: SIMD2<Float>

    var length: Float { simd_length(b - a) }
    /// Outward-pointing 2D normal (set by `DesignRoom`).
    var outward: SIMD2<Float>
}

struct DesignOpening: Identifiable, Hashable {
    let id: Int
    let kind: String        // "door" | "window" | "archway"
    let wall: Int           // index into walls
    let offset: Float       // metres along the wall from its start
    let width: Float
    let height: Float
    let sill: Float
}

enum DesignViewMode: String { case threeD, twoD }

/// The scanned room, in metres, ready to build into a realistic 3D scene.
/// A socket on a wall, in the design scene's units (metres).
struct DesignSocket: Identifiable, Hashable {
    let id: Int
    /// Index into `walls`.
    let wall: Int
    /// Distance along the wall from its start (metres).
    var offset: Float
    /// Height of the socket centre above the floor (metres).
    var height: Float
    /// True when a person placed it rather than the scan detecting it.
    var manual: Bool
}

struct DesignRoom {
    /// Closed floor polygon (metres), CCW.
    var footprint: [SIMD2<Float>]
    var height: Float
    var wallThickness: Float
    var openings: [DesignOpening]
    /// Sockets on the walls — detected during the scan or added by hand.
    var sockets: [DesignSocket] = []

    var wallFinish: SurfaceFinish
    var floorFinish: SurfaceFinish
    var ceilingFinish: SurfaceFinish

    /// Polygon edges as wall segments with outward normals.
    var walls: [WallSegment] {
        guard footprint.count >= 3 else { return [] }
        let c = centroid
        return footprint.indices.map { i in
            let a = footprint[i]
            let b = footprint[(i + 1) % footprint.count]
            let dir = simd_normalize(b - a)
            var n = SIMD2<Float>(dir.y, -dir.x)   // perpendicular
            let mid = (a + b) * 0.5
            if simd_dot(n, c - mid) > 0 { n = -n } // point away from interior
            return WallSegment(id: i, a: a, b: b, outward: n)
        }
    }

    var centroid: SIMD2<Float> {
        guard !footprint.isEmpty else { return .zero }
        return footprint.reduce(SIMD2<Float>.zero, +) / Float(footprint.count)
    }

    /// Floor area (m²).
    var area: Float {
        guard footprint.count >= 3 else { return 0 }
        var s: Float = 0
        for i in footprint.indices {
            let p = footprint[i]
            let q = footprint[(i + 1) % footprint.count]
            s += p.x * q.y - q.x * p.y
        }
        return abs(s) / 2
    }

    init(scan: RoomScan,
         // A real-home palette (matches the reference walkthroughs): soft matte
         // plaster walls, a real light-oak floor, and a matte plaster ceiling —
         // not the showroom's old polished-marble-everywhere look.
         wallFinish: SurfaceFinish = SurfaceFinish(swatchID: "plaster", kind: .matte),
         floorFinish: SurfaceFinish = SurfaceFinish(swatchID: "oak", kind: .matte),
         ceilingFinish: SurfaceFinish = SurfaceFinish(swatchID: "plaster", kind: .matte)) {
        self.footprint = scan.polygon.map { SIMD2<Float>(Float($0.x) * MM_TO_M, Float($0.z) * MM_TO_M) }
        self.height = Float(scan.height) * MM_TO_M
        self.wallThickness = 0.1
        self.openings = scan.openings.enumerated().map { idx, o in
            DesignOpening(id: idx, kind: o.type.rawValue, wall: o.wall,
                          offset: Float(o.offset) * MM_TO_M, width: Float(o.width) * MM_TO_M,
                          height: Float(o.height) * MM_TO_M, sill: Float(o.sill ?? 0) * MM_TO_M)
        }
        // Sockets ride along so the room you walk through shows the same
        // outlets as the plan you approved.
        self.sockets = scan.fixtures.enumerated().compactMap { idx, f in
            guard f.type == .socket else { return nil }
            return DesignSocket(
                id: idx, wall: f.wall,
                offset: Float(f.offset) * MM_TO_M,
                height: Float(f.height) * MM_TO_M,
                manual: f.source == .manual
            )
        }
        self.wallFinish = wallFinish
        self.floorFinish = floorFinish
        self.ceilingFinish = ceilingFinish
    }
}
