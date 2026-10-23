// The single source of truth for the design session. SwiftUI views (3D scene,
// 2D plan, material editor) observe it; the RealityKit scene is a projection of
// `room` + `items`. Mutations go through here so 2D and 3D stay in sync.

import Foundation
import Combine
import simd

@MainActor
final class DesignState: ObservableObject {
    @Published var room: DesignRoom
    @Published var items: [PlacedFurniture] = []
    @Published var selection: UUID?
    @Published var viewMode: DesignViewMode = .threeD
    /// What the material editor is currently targeting.
    @Published var finishTarget: FinishTarget?

    let catalog: [FurnitureItem]
    let swatches: [Swatch]

    /// Additional scanned rooms rendered as walkable context shells (whole-house
    /// mode). They share the primary room's coordinate space — the AR session was
    /// kept alive between scans — so no alignment is needed. Their finishes stay
    /// at the defaults; the "Change Color" targets edit the primary `room`.
    let extraRooms: [DesignRoom]

    init(scan: RoomScan,
         extraScans: [RoomScan] = [],
         catalog: [FurnitureItem] = FurnitureCatalog.items,
         swatches: [Swatch] = SwatchCatalog.swatches) {
        self.room = DesignRoom(scan: scan)
        self.extraRooms = extraScans.map { DesignRoom(scan: $0) }
        self.catalog = catalog
        self.swatches = swatches
    }

    /// Every room footprint in the house (primary first).
    var allFootprints: [[SIMD2<Float>]] { [room.footprint] + extraRooms.map(\.footprint) }

    /// Total floor area across all rooms (m²).
    var totalArea: Float { room.area + extraRooms.reduce(0) { $0 + $1.area } }

    // MARK: Lookup

    func item(id: String) -> FurnitureItem? { catalog.first { $0.id == id } }
    func item(for placed: PlacedFurniture) -> FurnitureItem? { item(id: placed.itemID) }
    func swatch(id: String) -> Swatch? { swatches.first { $0.id == id } }
    var selectedItem: PlacedFurniture? { items.first { $0.id == selection } }

    // MARK: Placement

    /// Add an item near the room centre (nudged so repeated adds don't stack).
    @discardableResult
    func add(_ item: FurnitureItem) -> UUID {
        let c = room.centroid
        let jitter = Float(items.count % 5) * 0.25
        let placed = PlacedFurniture(
            itemID: item.id,
            position: SIMD3<Float>(c.x + jitter, 0, c.y + jitter),
            rotationY: 0,
            // Keep the model's authored USDZ materials on placement. `finish` is a
            // per-instance override that is only set once the user explicitly
            // recolours the item (applyFinish); seeding it from `item.defaultFinish`
            // here would flatten every authored material into one flat swatch. The
            // editor still *shows* `defaultFinish` as its starting swatch via
            // `currentFinish(for:)` without touching the model.
            finish: nil
        )
        items.append(placed)
        selection = placed.id
        finishTarget = .item(placed.id)
        return placed.id
    }

    func remove(_ id: UUID) {
        items.removeAll { $0.id == id }
        if selection == id { selection = nil }
    }

    @discardableResult
    func duplicate(_ id: UUID) -> UUID? {
        guard let src = items.first(where: { $0.id == id }) else { return nil }
        var copy = src
        copy = PlacedFurniture(itemID: src.itemID,
                               position: src.position + SIMD3<Float>(0.3, 0, 0.3),
                               rotationY: src.rotationY,
                               finish: src.finish)
        items.append(copy)
        selection = copy.id
        return copy.id
    }

    func update(_ id: UUID, _ mutate: (inout PlacedFurniture) -> Void) {
        guard let i = items.firstIndex(where: { $0.id == id }) else { return }
        mutate(&items[i])
    }

    func move(_ id: UUID, to position: SIMD3<Float>) {
        update(id) { $0.position = clampToRoom(position) }
    }

    func rotate(_ id: UUID, to yaw: Float) { update(id) { $0.rotationY = yaw } }

    func select(_ id: UUID?) {
        selection = id
        if let id { finishTarget = .item(id) }
    }

    // MARK: Materials ("Change Color")

    func applyFinish(_ finish: SurfaceFinish, to target: FinishTarget) {
        switch target {
        case .item(let id): update(id) { $0.finish = finish }
        case .wall: room.wallFinish = finish
        case .floor: room.floorFinish = finish
        case .ceiling: room.ceilingFinish = finish
        }
    }

    func currentFinish(for target: FinishTarget) -> SurfaceFinish? {
        switch target {
        case .item(let id):
            guard let placed = items.first(where: { $0.id == id }) else { return nil }
            return placed.finish ?? item(for: placed)?.defaultFinish
        case .wall: return room.wallFinish
        case .floor: return room.floorFinish
        case .ceiling: return room.ceilingFinish
        }
    }

    // MARK: Helpers

    /// Keep a footprint point inside the house — any room's polygon counts, so in
    /// whole-house mode furniture can be placed in every scanned room. Outside all
    /// of them, seat the point on the nearest wall, nudged toward that room's
    /// interior (footprints are CCW, so (-(Δz), Δx) is the edge's inward normal) —
    /// never yanked across the house toward the primary room.
    private func clampToRoom(_ p: SIMD3<Float>) -> SIMD3<Float> {
        let pt = SIMD2<Float>(p.x, p.z)
        for footprint in allFootprints where pointInPolygon(pt, footprint) {
            return SIMD3<Float>(p.x, 0, p.z)
        }
        var bestQ = room.centroid
        var bestD = Float.greatestFiniteMagnitude
        var inward = SIMD2<Float>(0, 1)
        for poly in allFootprints where poly.count >= 3 {
            for i in poly.indices {
                let a = poly[i], b = poly[(i + 1) % poly.count]
                let ab = b - a
                let len2 = simd_dot(ab, ab)
                guard len2 > 1e-9 else { continue }
                let t = max(0, min(1, simd_dot(pt - a, ab) / len2))
                let q = a + ab * t
                let d = simd_length(pt - q)
                if d < bestD {
                    bestD = d
                    bestQ = q
                    inward = simd_normalize(SIMD2<Float>(-(b.y - a.y), b.x - a.x))
                }
            }
        }
        let seated = bestQ + inward * 0.05
        return SIMD3<Float>(seated.x, 0, seated.y)
    }
}

/// Even-odd point-in-polygon test on the floor plane.
func pointInPolygon(_ p: SIMD2<Float>, _ poly: [SIMD2<Float>]) -> Bool {
    guard poly.count >= 3 else { return false }
    var inside = false
    var j = poly.count - 1
    for i in poly.indices {
        let a = poly[i]
        let b = poly[j]
        if (a.y > p.y) != (b.y > p.y) {
            let t = (p.y - a.y) / (b.y - a.y)
            if p.x < a.x + t * (b.x - a.x) { inside.toggle() }
        }
        j = i
    }
    return inside
}
