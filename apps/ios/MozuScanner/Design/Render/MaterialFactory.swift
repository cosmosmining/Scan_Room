// Turns a `SurfaceFinish` (the "Change Color" editor's output) into a concrete
// RealityKit `PhysicallyBasedMaterial`, and into a representative SwiftUI `Color`
// for the 2D floor-plan fills.
//
// A finish references a `Swatch` by id. A swatch is either a bundled PBR texture
// (`Resources/Textures/<textureName>.png`) or a solid sRGB colour. On top of that
// the finish carries a `SurfaceMaterialKind` (matte/plastic/fabric/metal/mirror/
// glass/polished → roughness/metalness/opacity), an optional `tint`, and the
// `textureScale` / `rotation` UV controls.
//
// Everything degrades gracefully: a missing texture, a missing swatch, or an
// unavailable texture-transform API all fall back to a plausible solid colour so
// the scene never renders flat untextured white by accident.

import Foundation
import SwiftUI
import RealityKit
import simd

enum MaterialFactory {

    // MARK: - Texture cache

    /// Loaded textures keyed by bundle resource name. RealityKit `TextureResource`
    /// loads are comparatively expensive, and the same swatch (floor marble, wall
    /// marble, …) is requested for many entities, so we keep a process-wide cache.
    /// `NSNull` marks names we already tried and failed to load, so we don't retry
    /// a missing asset on every rebuild.
    private static var textureCache: [String: Any] = [:]

    /// Load (and cache) a bundled texture by name. Returns nil if it can't be found
    /// or decoded; the failure is cached so we only log/attempt once.
    private static func texture(named name: String) -> TextureResource? {
        if let cached = textureCache[name] {
            return cached as? TextureResource   // NSNull -> nil
        }
        do {
            let resource = try TextureResource.load(named: name, in: .main)
            textureCache[name] = resource
            return resource
        } catch {
            // Cache the miss so we don't hammer the loader; fall back to a colour.
            textureCache[name] = NSNull()
            return nil
        }
    }

    // MARK: - RealityKit material

    /// Build a `PhysicallyBasedMaterial` for the given finish. Resolves the swatch
    /// from `swatches`, applies the texture or solid base colour, the PBR preset,
    /// glass/mirror/metal/polished specialisations, an optional tint and the UV
    /// scale/rotation. Always returns a usable material.
    static func material(for finish: SurfaceFinish, swatches: [Swatch]) -> RealityKit.Material {
        var material = PhysicallyBasedMaterial()

        let swatch = swatches.first { $0.id == finish.swatchID }
        let kind = finish.kind
        let (roughness, metalness) = kind.pbr

        // --- Base colour: texture (if any & loadable) or solid colour ---
        let baseRGBA = resolvedTint(finish: finish, swatch: swatch)

        if let textureName = swatch?.textureName, let resource = texture(named: textureName) {
            // Tinted texture. The tint multiplies the texels (white = untinted),
            // which is exactly how `Swatch.rgba` is documented to behave for
            // textured swatches, and how `finish.tint` should layer on top.
            material.baseColor = PhysicallyBasedMaterial.BaseColor(
                tint: uiColor(from: baseRGBA),
                texture: PhysicallyBasedMaterial.Texture(resource)
            )
            applyUVTransform(to: &material, finish: finish)
        } else {
            // Solid colour (no texture, or texture failed to load). For a *textured*
            // swatch whose bitmap is missing, `rgba` is only a white multiply-tint —
            // using it here would render flat white, so fall back to the swatch's
            // representative wood/fabric tone (mirrors the 2D `uiColor(for:)` path).
            material.baseColor = PhysicallyBasedMaterial.BaseColor(tint: uiColor(from: solidFallbackRGBA(finish: finish, swatch: swatch)))
        }

        // --- PBR preset (roughness / metalness) ---
        material.roughness = .init(floatLiteral: roughness)
        material.metallic = .init(floatLiteral: metalness)

        // --- Material-kind specialisations ---
        switch kind {
        case .glass:
            // Translucent: low-roughness (from the preset), non-metal, blended at the
            // kind's opacity (~0.35) so it's not driven by the tint's alpha alone.
            material.blending = .transparent(opacity: .init(floatLiteral: kind.opacity))
            material.metallic = .init(floatLiteral: 0.0)
            // A bright specular sheen reads as glass under IBL.
            material.specular = .init(floatLiteral: 1.0)
            material.faceCulling = .none   // see through to back faces
        case .mirror, .metal:
            material.metallic = .init(floatLiteral: 1.0)
        case .polished:
            // Low roughness already set by the preset; nothing extra.
            break
        case .matte, .plastic, .fabric:
            break
        }

        // Honour a sub-1 alpha coming from the swatch/tint itself (e.g. a colour
        // swatch authored translucent) for non-glass kinds, which haven't already
        // set their own blending above.
        if kind.isTranslucent == false, baseRGBA.w < 1 {
            material.blending = .transparent(opacity: .init(floatLiteral: clamp01(baseRGBA.w)))
        }

        return material
    }

    /// Apply `textureScale` (UV tiling) and `rotation` to every texture map on the
    /// material, when the running SDK exposes a UV transform. iOS 17's
    /// `PhysicallyBasedMaterial` does not expose a public per-map UV-tiling/rotation
    /// setter, so this is best-effort and currently a no-op placeholder kept in one
    /// place; see `risks`. Tiling that *can* be honoured is folded into the texture's
    /// own sampling where possible by callers that bake UVs into geometry (the room
    /// builder maps wall/floor UVs by metres).
    private static func applyUVTransform(to material: inout PhysicallyBasedMaterial, finish: SurfaceFinish) {
        // Intentionally minimal: there is no stable public API on
        // `PhysicallyBasedMaterial.Texture` in iOS 17 to set UV scale/rotation
        // without a custom Metal sampler. We leave the texture sampling at its
        // default and rely on geometry-side UV generation (Room3DBuilder) plus
        // `finish.textureScale` being consumed there. Recorded as a limitation.
        _ = finish.textureScale
        _ = finish.rotation
        _ = material   // no mutation available on this OS target
    }

    // MARK: - Tint resolution

    /// The effective base tint as raw sRGB rgba: starts from the swatch (its solid
    /// colour, or its multiply tint for a texture — white means "untinted"), then
    /// multiplies in `finish.tint` if present.
    private static func resolvedTint(finish: SurfaceFinish, swatch: Swatch?) -> SIMD4<Float> {
        // For both textured and solid swatches the swatch's own rgba is the base:
        // documented as the colour itself when there's no texture, and a multiply
        // tint (white = no tint) when there is one.
        var rgba = swatch?.rgba ?? SIMD4<Float>(0.8, 0.8, 0.8, 1)   // neutral grey if unknown

        if let tint = finish.tint {
            rgba = SIMD4<Float>(rgba.x * tint.x, rgba.y * tint.y, rgba.z * tint.z, rgba.w * tint.w)
        }
        return rgba
    }

    /// The base-colour parameter (tint + optional texture) for a finish, so a model's
    /// existing PBR materials can be re-tinted IN PLACE — keeping their authored
    /// normal / roughness / AO maps — rather than being replaced by one flat material
    /// (which is what made recoloured furniture look like plastic). See `ModelLoader`.
    static func baseColor(for finish: SurfaceFinish, swatches: [Swatch]) -> PhysicallyBasedMaterial.BaseColor {
        let swatch = swatches.first { $0.id == finish.swatchID }
        let baseRGBA = resolvedTint(finish: finish, swatch: swatch)
        if let textureName = swatch?.textureName, let resource = texture(named: textureName) {
            return PhysicallyBasedMaterial.BaseColor(
                tint: uiColor(from: baseRGBA),
                texture: PhysicallyBasedMaterial.Texture(resource)
            )
        }
        return PhysicallyBasedMaterial.BaseColor(tint: uiColor(from: solidFallbackRGBA(finish: finish, swatch: swatch)))
    }

    /// The rgba for a *solid* base colour when no texture is applied. For a textured
    /// swatch (whose `rgba` is a white multiply-tint) this uses the swatch's baked
    /// `avgColor` — or the built-in hand-picked tone — so a missing/failed texture
    /// reads as its real wood/fabric colour rather than flat white. `finish.tint`
    /// still multiplies on top. Mirrors the 2D `uiColor(for:swatches:)` logic.
    private static func solidFallbackRGBA(finish: SurfaceFinish, swatch: Swatch?) -> SIMD4<Float> {
        var rgba: SIMD4<Float>
        if let swatch, let textureName = swatch.textureName {
            rgba = swatch.avgColor ?? averageTone(for: textureName)
        } else {
            rgba = swatch?.rgba ?? SIMD4<Float>(0.8, 0.8, 0.8, 1)
        }
        if let tint = finish.tint {
            rgba = SIMD4<Float>(rgba.x * tint.x, rgba.y * tint.y, rgba.z * tint.z, rgba.w * tint.w)
        }
        return rgba
    }

    /// Build a `UIColor` (sRGB) from raw rgba, clamped to [0, 1].
    private static func uiColor(from rgba: SIMD4<Float>) -> UIColor {
        UIColor(
            red: CGFloat(clamp01(rgba.x)),
            green: CGFloat(clamp01(rgba.y)),
            blue: CGFloat(clamp01(rgba.z)),
            alpha: CGFloat(clamp01(rgba.w))
        )
    }

    // MARK: - SwiftUI colour (2D fills)

    /// A representative flat colour for the 2D floor plan. Solid swatches use their
    /// own colour; textured swatches map to a hand-picked average tone (so the plan
    /// reads "marble"/"oak"/… without sampling the bitmap). The finish's tint, if
    /// any, is multiplied on top, and glass is shown semi-transparent.
    static func uiColor(for finish: SurfaceFinish, swatches: [Swatch]) -> SwiftUI.Color {
        let swatch = swatches.first { $0.id == finish.swatchID }

        var rgba: SIMD4<Float>
        if let swatch {
            if let textureName = swatch.textureName {
                // Prefer the swatch's baked average tone (set for the imported MOZU
                // finishes); fall back to a hand-picked tone for the built-ins.
                let base = swatch.avgColor ?? averageTone(for: textureName)
                rgba = SIMD4<Float>(base.x * swatch.rgba.x, base.y * swatch.rgba.y,
                                    base.z * swatch.rgba.z, base.w * swatch.rgba.w)
            } else {
                rgba = swatch.rgba
            }
        } else {
            rgba = SIMD4<Float>(0.8, 0.8, 0.8, 1)
        }

        if let tint = finish.tint {
            rgba = SIMD4<Float>(rgba.x * tint.x, rgba.y * tint.y, rgba.z * tint.z, rgba.w * tint.w)
        }

        // Glass reads as translucent in the plan too.
        var alpha = rgba.w
        if finish.kind.isTranslucent { alpha = min(alpha, finish.kind.opacity) }

        return Color(.sRGB,
                     red: Double(clamp01(rgba.x)),
                     green: Double(clamp01(rgba.y)),
                     blue: Double(clamp01(rgba.z)),
                     opacity: Double(clamp01(alpha)))
    }

    /// Hand-picked average tones for each bundled texture, so 2D fills look right
    /// without decoding the bitmap. Unknown names fall back to a warm neutral.
    private static func averageTone(for textureName: String) -> SIMD4<Float> {
        switch textureName {
        case "marble_cream":  return SIMD4<Float>(0.92, 0.89, 0.82, 1)
        case "marble_white":  return SIMD4<Float>(0.80, 0.81, 0.83, 1)   // "grey marble"
        case "oak":           return SIMD4<Float>(0.74, 0.58, 0.39, 1)
        case "walnut":        return SIMD4<Float>(0.40, 0.27, 0.18, 1)
        case "tile_ceramic":  return SIMD4<Float>(0.86, 0.86, 0.84, 1)
        case "granite_grey":  return SIMD4<Float>(0.52, 0.52, 0.53, 1)
        case "granite_black": return SIMD4<Float>(0.18, 0.18, 0.20, 1)
        case "plaster":       return SIMD4<Float>(0.90, 0.88, 0.85, 1)
        default:              return SIMD4<Float>(0.82, 0.78, 0.72, 1)
        }
    }

    // MARK: - Utilities

    private static func clamp01(_ v: Float) -> Float { min(1, max(0, v)) }
}
