// Loads a furniture `FurnitureItem` into a RealityKit `ModelEntity`, normalised so
// the model matches its real-world `size` (metres), its base sits at y = 0, and it
// is centred on its footprint in X/Z — exactly the contract `PlacedFurniture`
// expects (position = floor point under the footprint centre, base at the floor).
//
// Conventions (see Design/README.md): metres; floor plane X (right) / Z (forward),
// Y up. A loaded USDZ may be authored at any scale, off-origin, or with its pivot
// anywhere; we measure its `visualBounds` and apply a per-axis scale to make it the
// item's real dimensions, then a translation so its min-Y is 0 and its X/Z centre
// is the origin. The box fallback is built the same way so the two are drop-in
// interchangeable for the scene.
//
// A `SurfaceFinish`, when supplied, overrides *every* material on the model (the
// per-instance "Change Color" override). Otherwise the USDZ keeps its own authored
// materials. Collision shapes are always generated so the scene can hit-test for
// tap-to-select and drag-to-move.
//
// RealityKit entity creation is main-actor isolated on iOS 17, so both entry points
// run on the `@MainActor`. The base (unscaled) load of each USDZ is cached by
// `item.id`; every instance is a `clone(recursive:)` of that base so concurrent
// placements never share mutable entity state.

import Foundation
import RealityKit
import simd

@MainActor
enum ModelLoader {

    // MARK: - Base-model cache

    /// Freshly loaded, un-normalised base models keyed by `FurnitureItem.id`. We
    /// clone these per instance rather than re-loading the USDZ each time. Access is
    /// safe without locking because the whole enum is `@MainActor`-isolated.
    private static var baseCache: [String: ModelEntity] = [:]

    // MARK: - Async entry point (USDZ, with box fallback)

    /// Build a placement-ready `ModelEntity` for `item`, normalised to `item.size`
    /// with its base at y = 0 and centred in X/Z. If `item.usdzName` is set and the
    /// USDZ loads, that model is used; otherwise a generated box stands in. When
    /// `finish` is non-nil it overrides all of the model's materials; collision
    /// shapes are generated for hit-testing.
    static func makeEntity(for item: FurnitureItem,
                           finish: SurfaceFinish?,
                           swatches: [Swatch]) async -> ModelEntity {
        guard let name = item.usdzName,
              let base = await loadBase(named: name, cacheKey: item.id) else {
            // No model name, or the load failed → generated box (already normalised).
            return boxEntity(for: item, finish: finish, swatches: swatches)
        }

        // Clone so per-instance edits (scale/translate/materials) never mutate the
        // shared cached base.
        let model = base.clone(recursive: true)

        // Wrap the loaded model in a fresh container that becomes the placement
        // entity. We normalise the *child* (scale + recentre) and measure it relative
        // to the wrapper, so the wrapper's own origin is exactly the footprint centre
        // with the model's base at y = 0 — the contract the scene relies on. (Measuring
        // an entity relative to itself would ignore its own transform, so the wrapper
        // gives us a stable reference frame.)
        let entity = ModelEntity()
        entity.name = "item_model_\(item.id)"
        entity.addChild(model)

        normalize(model, within: entity, to: item.size)

        if let finish {
            recolor(entity, finish: finish, swatches: swatches)
        }

        entity.generateCollisionShapes(recursive: true)
        return entity
    }

    // MARK: - Sync fallback (generated box)

    /// A box of exactly `item.size`, base at y = 0, centred in X/Z. Used as the
    /// fallback when there's no USDZ (or it fails to load), and directly by callers
    /// that want a guaranteed-synchronous placeholder. Honours `finish` if provided,
    /// otherwise a neutral default material; collision shapes are generated.
    static func boxEntity(for item: FurnitureItem,
                          finish: SurfaceFinish?,
                          swatches: [Swatch]) -> ModelEntity {
        let size = SIMD3<Float>(max(item.size.x, 0.001),
                                max(item.size.y, 0.001),
                                max(item.size.z, 0.001))

        let mesh = MeshResource.generateBox(size: size, cornerRadius: 0.01)
        let material = boxMaterial(for: item, finish: finish, swatches: swatches)

        let entity = ModelEntity(mesh: mesh, materials: [material])
        entity.name = "item_box_\(item.id)"

        // `generateBox` centres the box on the origin, so lift it by half its height
        // to put the base at y = 0; X/Z are already centred on the footprint.
        entity.position = SIMD3<Float>(0, size.y * 0.5, 0)

        entity.generateCollisionShapes(recursive: true)
        return entity
    }

    // MARK: - Loading

    /// Load (and cache) the un-normalised base model for a USDZ resource name.
    /// Returns nil if the resource is missing or fails to decode.
    private static func loadBase(named name: String, cacheKey: String) async -> ModelEntity? {
        if let cached = baseCache[cacheKey] {
            return cached
        }

        let model: ModelEntity?
        if #available(iOS 18.0, *) {
            // Modern async loader: decodes off the main actor, so it never blocks the
            // UI. Like the classic loader it flattens the USDZ into a single model
            // entity (merged mesh/materials), which is what we scale + recolour.
            model = try? await ModelEntity(named: name)
        } else {
            // iOS 17: the only option is the classic synchronous loader. We call it
            // through a non-async helper so the compiler doesn't flag "synchronous
            // Entity loading is unavailable from asynchronous contexts" — the brief
            // main-actor block is acceptable since each base is loaded once and cached.
            model = loadModelSync(named: name)
        }

        guard let model else { return nil }
        baseCache[cacheKey] = model
        return model
    }

    /// Synchronous USDZ load for the iOS 17 path. Isolated in its own non-async
    /// function so the `@_unavailableFromAsync` synchronous loader is never invoked
    /// directly from an `async` context (which Xcode warns against). Returns nil if
    /// the resource is missing or fails to decode.
    private static func loadModelSync(named name: String) -> ModelEntity? {
        try? ModelEntity.loadModel(named: name)
    }

    // MARK: - Normalisation

    /// Scale `model` (per-axis) so its visual bounds equal `targetSize`, then
    /// translate it so — measured in `container`'s frame — its min-Y is 0 (base on
    /// the floor) and its X/Z centre is the container origin (centred on the
    /// footprint). `model` is a child of `container`, so measuring relative to the
    /// container reflects the scale/translation we apply here.
    private static func normalize(_ model: ModelEntity, within container: Entity, to targetSize: SIMD3<Float>) {
        // The bundled USDZ (MOZU products + generated furniture) are authored at
        // real-world metre scale, so we PRESERVE their native size — per-axis
        // fitting would distort a cabinet whose aspect ratio differs slightly from
        // the catalogue figure. We only correct a GROSS mismatch (e.g. an asset
        // mistakenly authored in millimetres), and uniformly so proportions hold.
        let raw = model.visualBounds(relativeTo: container)
        let maxExtent = max(raw.extents.x, raw.extents.y, raw.extents.z)
        let targetMax = max(targetSize.x, targetSize.y, targetSize.z)

        var scale: Float = 1
        if maxExtent > 1e-4, targetMax > 1e-4 {
            let ratio = targetMax / maxExtent
            if ratio > 3 || ratio < 0.34 { scale = ratio } // only fix order-of-magnitude errors
        }
        model.scale = SIMD3<Float>(repeating: scale)

        // Re-measure (reflects the scale) and translate so the base sits at y = 0 and
        // the footprint centre is the origin.
        let scaled = model.visualBounds(relativeTo: container)
        let center = scaled.center
        let minY = center.y - scaled.extents.y * 0.5
        model.position += SIMD3<Float>(-center.x, -minY, -center.z)
    }

    // MARK: - Material override

    /// Replace every material on `entity` (and its descendants) with `material` —
    /// the per-instance finish override. Models loaded via `ModelEntity(named:)` are
    /// flattened, but we still walk children so nested model components are covered.
    private static func overrideMaterials(of entity: Entity, with material: RealityKit.Material) {
        if let model = entity as? ModelEntity, var component = model.model {
            component.materials = Array(repeating: material, count: max(component.materials.count, 1))
            model.model = component
        }
        for child in entity.children {
            overrideMaterials(of: child, with: material)
        }
    }

    /// Apply a finish by RE-TINTING the model's existing PBR materials in place —
    /// changing only their base colour (and the finish's roughness/metalness) while
    /// KEEPING each material's authored normal / roughness / AO maps. That preserves
    /// the surface detail that makes wood/fabric/paint read as real; replacing every
    /// material with one flat material is what made recoloured furniture look plastic.
    /// Glass and mirror need special blending/metalness, so they use a full replace.
    private static func recolor(_ entity: Entity, finish: SurfaceFinish, swatches: [Swatch]) {
        if finish.kind == .glass || finish.kind == .mirror {
            overrideMaterials(of: entity, with: MaterialFactory.material(for: finish, swatches: swatches))
            return
        }
        let base = MaterialFactory.baseColor(for: finish, swatches: swatches)
        let (roughness, metalness) = finish.kind.pbr
        tint(entity, base: base, roughness: roughness, metalness: metalness,
             fallback: { MaterialFactory.material(for: finish, swatches: swatches) })
    }

    /// Recursively set `base` / `roughness` / `metalness` on every existing
    /// `PhysicallyBasedMaterial` (leaving its other maps intact); any non-PBR material
    /// (or an empty material list) is replaced with `fallback()`.
    private static func tint(_ entity: Entity,
                             base: PhysicallyBasedMaterial.BaseColor,
                             roughness: Float, metalness: Float,
                             fallback: () -> RealityKit.Material) {
        if let model = entity as? ModelEntity, var component = model.model {
            if component.materials.isEmpty {
                component.materials = [fallback()]
            } else {
                component.materials = component.materials.map { existing -> RealityKit.Material in
                    guard var pbr = existing as? PhysicallyBasedMaterial else { return fallback() }
                    pbr.baseColor = base
                    pbr.roughness = .init(floatLiteral: roughness)
                    pbr.metallic = .init(floatLiteral: metalness)
                    return pbr
                }
            }
            model.model = component
        }
        for child in entity.children {
            tint(child, base: base, roughness: roughness, metalness: metalness, fallback: fallback)
        }
    }

    // MARK: - Box material

    /// The material for the box fallback: the explicit `finish`, else the item's
    /// `defaultFinish`, else a plausible neutral so it never renders flat white.
    private static func boxMaterial(for item: FurnitureItem,
                                    finish: SurfaceFinish?,
                                    swatches: [Swatch]) -> RealityKit.Material {
        if let finish {
            return MaterialFactory.material(for: finish, swatches: swatches)
        }
        if let defaultFinish = item.defaultFinish {
            return MaterialFactory.material(for: defaultFinish, swatches: swatches)
        }
        // Neutral oak-ish fallback via the catalogue's default swatch.
        let fallback = SurfaceFinish(swatchID: SwatchCatalog.defaultSwatchID, kind: .matte)
        return MaterialFactory.material(for: fallback, swatches: swatches)
    }
}
