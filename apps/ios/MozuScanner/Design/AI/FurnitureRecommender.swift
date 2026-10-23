// "Need advice" — the on-device AI furniture recommender.
//
// Given the scanned room and the catalogue, this produces a handful of ready-to-
// place furniture sets, each laid out ALONG the room's longest wall. The output
// is pure and deterministic: same room + catalogue in, same recommendations out.
// No network, no randomness, no global state — so it's trivially testable and
// safe to call from the @MainActor UI on every "Need advice" tap.
//
// COORDINATE SYSTEM (see Design/README.md). Metres; floor plane is X (right) /
// Z (forward), Y up. A `PlacedFurniture.position` is the floor point under the
// item's footprint centre, base at y = 0; `rotationY` is yaw radians about +Y.
//
// LAYOUT MODEL. We pick the longest wall segment as the "primary run" and pack
// items left-to-right along it (start endpoint → end endpoint), each pushed
// inward (away from the wall, toward the room interior) by half its depth so the
// item's back sits against the wall. Each item is yawed so its FRONT (its local
// -Z face) points into the room along the wall's inward normal. Packing stops
// when the next item would overshoot the run length, so we never spill past the
// wall.

import Foundation
import simd

// MARK: - Recommendation

/// One ready-to-place furniture set the user can accept wholesale.
struct FurnitureRecommendation: Identifiable {
    let id: String
    let title: String
    let rationale: String
    /// Fully positioned instances, base at y = 0, laid out along the primary wall.
    let items: [PlacedFurniture]
    /// Estimated price for the whole set, in the catalogue's minor currency units.
    let estimatedTotal: Int
}

// MARK: - Recommender

enum FurnitureRecommender {

    /// Up to three furniture sets laid out along the room's longest wall.
    /// Recommendations whose layout would place nothing (e.g. no matching
    /// catalogue items, or a degenerate room) are omitted.
    static func recommend(for room: DesignRoom, catalog: [FurnitureItem]) -> [FurnitureRecommendation] {
        guard let run = primaryRun(of: room) else { return [] }

        let builders: [(String, String, String, (PrimaryRun, [FurnitureItem]) -> [PlacedFurniture])] = [
            ("rec_kitchen", "MOZU Kitchen",
             "Base cabinets run the length of your longest wall, finished with a tall larder unit. Wall units sit above and are added in the editor.",
             kitchenLayout),
            ("rec_wardrobe", "MOZU Wardrobe",
             "Full-height wardrobe modules fill the wall, with a low side cabinet to finish the run.",
             wardrobeLayout),
            ("rec_living", "Living",
             "A sofa against the wall, a coffee table in front, a rug to anchor the zone and a plant in the corner.",
             livingLayout),
        ]

        var out: [FurnitureRecommendation] = []
        for (id, title, rationale, build) in builders {
            let items = build(run, catalog)
            guard !items.isEmpty else { continue }
            let total = Pricing.breakdown(items: items, catalog: catalog, currency: "EUR").total
            out.append(FurnitureRecommendation(id: id, title: title, rationale: rationale,
                                               items: items, estimatedTotal: total))
        }
        return out
    }

    // MARK: - Primary run geometry

    /// The room's longest wall, captured as the geometry the layouts need: the
    /// start point, the unit direction along the wall (start → end), the unit
    /// inward normal (pointing into the room), and the run length.
    struct PrimaryRun {
        let start: SIMD2<Float>
        /// Unit vector along the wall, from `start` toward the wall's far end.
        let along: SIMD2<Float>
        /// Unit vector pointing into the room interior (opposite the wall's outward normal).
        let inward: SIMD2<Float>
        let length: Float
    }

    /// Find the longest wall segment and derive its run geometry. Returns nil if
    /// the room has no usable walls (degenerate footprint).
    private static func primaryRun(of room: DesignRoom) -> PrimaryRun? {
        let walls = room.walls
        guard let wall = walls.max(by: { $0.length < $1.length }), wall.length > 1e-3 else {
            return nil
        }
        let along = simd_normalize(wall.b - wall.a)
        let inward = -wall.outward   // outward points away from the interior
        return PrimaryRun(start: wall.a, along: along, inward: inward, length: wall.length)
    }

    /// World-space yaw (radians about +Y) so an item placed along the run has its
    /// FRONT facing into the room. Item entities front the -Z local axis; rotating
    /// by `yaw` maps -Z to the world direction `inward`. With floor coordinates
    /// (x, z) and yaw about +Y, the local -Z axis maps to (sin yaw, cos yaw) in
    /// (x, z), so yaw = atan2(inward.x, inward.y) aims -Z at the inward normal.
    private static func facingYaw(_ inward: SIMD2<Float>) -> Float {
        atan2(inward.x, inward.y)
    }

    /// Place `item` so its footprint centre sits `alongOffset` metres from the run
    /// start (measured to the item's centre, i.e. start + half-width already
    /// folded in by the caller) and `depthOffset` metres inward from the wall.
    private static func place(_ item: FurnitureItem,
                              run: PrimaryRun,
                              centreAlong: Float,
                              finish: SurfaceFinish? = nil) -> PlacedFurniture {
        let depthOffset = item.size.z * 0.5
        let p2 = run.start + run.along * centreAlong + run.inward * depthOffset
        return PlacedFurniture(itemID: item.id,
                               position: SIMD3<Float>(p2.x, 0, p2.y),
                               rotationY: facingYaw(run.inward),
                               finish: finish)
    }

    // MARK: - Packing

    /// Greedily pack a repeating set of `fillers` left-to-right along the run,
    /// optionally finishing with a single `terminator` if it still fits. Returns
    /// the placed items in left-to-right order. `fillers` are cycled in order so a
    /// caller can pass one item (uniform run) or several (alternating run).
    private static func pack(run: PrimaryRun,
                             fillers: [FurnitureItem],
                             terminator: FurnitureItem? = nil,
                             gap: Float = 0,
                             fillerFinish: SurfaceFinish? = nil,
                             terminatorFinish: SurfaceFinish? = nil) -> [PlacedFurniture] {
        guard !fillers.isEmpty else { return [] }

        var placed: [PlacedFurniture] = []
        var cursor: Float = 0          // metres consumed from the run start
        var fillerIndex = 0

        // Reserve space for the terminator so we don't pack fillers into the spot
        // the terminator needs; if it won't fit at all we just skip it.
        let termWidth = terminator?.size.x ?? 0
        let reserve = terminator != nil ? termWidth + gap : 0

        while true {
            let item = fillers[fillerIndex % fillers.count]
            let w = item.size.x
            // Does this filler (plus the reserved terminator slot) still fit?
            if cursor + w + reserve > run.length + 1e-4 { break }
            placed.append(place(item, run: run, centreAlong: cursor + w * 0.5, finish: fillerFinish))
            cursor += w + gap
            fillerIndex += 1
        }

        if let terminator, cursor + termWidth <= run.length + 1e-4 {
            placed.append(place(terminator, run: run,
                                centreAlong: cursor + termWidth * 0.5,
                                finish: terminatorFinish))
        }
        return placed
    }

    // MARK: - (1) Kitchen

    /// Base cabinets filling the run, then a tall larder at the end if it fits.
    /// Wall (upper) cabinets are intentionally left out of v1 — see risks.
    private static func kitchenLayout(run: PrimaryRun, catalog: [FurnitureItem]) -> [PlacedFurniture] {
        let bases = items(in: "Kitchen · Base", from: catalog)
        guard !bases.isEmpty else { return [] }
        // Prefer the widest base cabinet as the repeating filler for a clean run.
        let filler = bases.max(by: { $0.size.x < $1.size.x })!
        let tall = items(in: "Kitchen · Tall", from: catalog).min(by: { $0.size.x < $1.size.x })
        return pack(run: run, fillers: [filler], terminator: tall)
    }

    // MARK: - (2) Wardrobe

    /// Wardrobe main cabinets filling the run, finished with a side cabinet.
    private static func wardrobeLayout(run: PrimaryRun, catalog: [FurnitureItem]) -> [PlacedFurniture] {
        let mains = items(in: "Wardrobe · Main", from: catalog)
        guard !mains.isEmpty else { return [] }
        let filler = mains.max(by: { $0.size.x < $1.size.x })!
        let side = items(in: "Wardrobe · Side", from: catalog).min(by: { $0.size.x < $1.size.x })
        return pack(run: run, fillers: [filler], terminator: side)
    }

    // MARK: - (3) Living

    /// A sofa against the wall, a coffee table centred in front of it, a rug under
    /// the pair, and a plant tucked into the nearest run corner.
    private static func livingLayout(run: PrimaryRun, catalog: [FurnitureItem]) -> [PlacedFurniture] {
        guard let sofa = firstItem(category: "Seating", from: catalog,
                                   preferringNameContaining: "Sofa")
                ?? firstItem(category: "Seating", from: catalog) else {
            return []
        }

        var out: [PlacedFurniture] = []

        // Sofa: centred along the run if it fits, otherwise hard against the start.
        let sofaW = sofa.size.x
        let sofaCentre = sofaW <= run.length ? run.length * 0.5 : sofaW * 0.5
        let sofaPlaced = place(sofa, run: run, centreAlong: sofaCentre)
        out.append(sofaPlaced)

        let yaw = facingYaw(run.inward)
        let sofaPos = SIMD2<Float>(sofaPlaced.position.x, sofaPlaced.position.z)

        // Rug: under the seating zone, a little further into the room than the sofa.
        if let rug = firstItem(category: "Decor", from: catalog, preferringNameContaining: "Rug") {
            let rugCentre = sofaPos + run.inward * (sofa.size.z * 0.5 + rug.size.z * 0.5 + 0.05)
            out.append(PlacedFurniture(itemID: rug.id,
                                       position: SIMD3<Float>(rugCentre.x, 0, rugCentre.y),
                                       rotationY: yaw))
        }

        // Coffee table: in front of the sofa, centred on it, on top of the rug.
        if let coffee = firstItem(category: "Tables", from: catalog, preferringNameContaining: "Coffee")
            ?? firstItem(category: "Tables", from: catalog) {
            let gap: Float = 0.45   // walking room between sofa front and table
            let coffeeCentre = sofaPos + run.inward * (sofa.size.z * 0.5 + gap + coffee.size.z * 0.5)
            out.append(PlacedFurniture(itemID: coffee.id,
                                       position: SIMD3<Float>(coffeeCentre.x, 0, coffeeCentre.y),
                                       rotationY: yaw))
        }

        // Plant: in the corner at the far end of the run, against the wall.
        if let plant = firstItem(category: "Decor", from: catalog, preferringNameContaining: "Plant") {
            let cornerAlong = max(run.length - plant.size.x * 0.5, plant.size.x * 0.5)
            out.append(place(plant, run: run, centreAlong: cornerAlong))
        }

        return out
    }

    // MARK: - Catalogue helpers

    private static func items(in category: String, from catalog: [FurnitureItem]) -> [FurnitureItem] {
        catalog.filter { $0.category == category }
    }

    /// The first item in `category`, preferring one whose name contains `needle`
    /// (case-insensitive) when supplied, else the first of the category.
    private static func firstItem(category: String,
                                  from catalog: [FurnitureItem],
                                  preferringNameContaining needle: String? = nil) -> FurnitureItem? {
        let pool = items(in: category, from: catalog)
        if let needle {
            if let match = pool.first(where: { $0.name.range(of: needle, options: .caseInsensitive) != nil }) {
                return match
            }
            return nil
        }
        return pool.first
    }
}

// MARK: - Apply to state

extension DesignState {
    /// Drop a whole recommendation into the room and select its first item.
    func apply(_ rec: FurnitureRecommendation) {
        items.append(contentsOf: rec.items)
        selection = rec.items.first?.id
    }
}
