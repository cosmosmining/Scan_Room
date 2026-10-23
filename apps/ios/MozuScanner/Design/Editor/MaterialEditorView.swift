// The "Change Color" bottom sheet — the editor that turns a tap on a surface or a
// piece of furniture into a `SurfaceFinish` and writes it back to `DesignState`.
//
// Layout (top → bottom):
//   • Title row "Change Color" + a "Done" button (dismisses the sheet).
//   • A horizontal row of category chips (Color/Tile/Marble/Wood/Granite/Finishes),
//     each with a representative thumbnail (a texture for textured categories, or a
//     colour circle for the solid-colour category).
//   • A grid of swatches for the selected category — texture thumbnails or filled
//     colour circles, the active swatch outlined.
//   • A "Material" label + a horizontal row of material-kind chips
//     (Default/Plastic/Fabric/Metal/Mirror/Glass/Polished).
//   • A "Texture Scale" slider (0.25…4) and a "Rotation" slider (0…2π, shown in °).
//
// The editor keeps its own local @State (seeded from the target's current finish,
// or a sensible default) and, on *any* change, rebuilds a `SurfaceFinish` and calls
// `state.applyFinish(_:to:)` so the 3D scene and 2D plan update live.
//
// Textures live at `Resources/Textures/<name>.png` — they are *not* guaranteed to be
// in an asset catalog, so `SwatchThumbnail` loads via `Image(name)` and falls back to
// `Image(uiImage: UIImage(named:))` (which finds loose bundle resources) and finally
// to a neutral placeholder, so a missing asset never crashes or renders blank.

import SwiftUI
import simd

struct MaterialEditorView: View {
    @ObservedObject var state: DesignState
    let target: FinishTarget

    @Environment(\.dismiss) private var dismiss

    // MARK: Local editing state (seeded from the current finish in `onAppear`).
    @State private var category: SwatchCategory
    @State private var swatchID: String
    @State private var kind: SurfaceMaterialKind
    @State private var textureScale: Float
    @State private var rotation: Float        // radians, 0…2π
    /// Which surface/item the editor currently writes to (switchable via the chips).
    @State private var activeTarget: FinishTarget

    // Grid metrics.
    private let cellSize: CGFloat = 64
    private var gridColumns: [GridItem] {
        [GridItem(.adaptive(minimum: cellSize, maximum: cellSize + 16), spacing: 12)]
    }

    init(state: DesignState, target: FinishTarget) {
        self.state = state
        self.target = target
        _activeTarget = State(initialValue: target)
        // Seed from the target's current finish, falling back to a default swatch so
        // the editor always opens on a valid, selected swatch.
        let seed = state.currentFinish(for: target)
            ?? SurfaceFinish(swatchID: SwatchCatalog.defaultSwatchID)
        _swatchID = State(initialValue: seed.swatchID)
        _kind = State(initialValue: seed.kind)
        _textureScale = State(initialValue: seed.textureScale)
        _rotation = State(initialValue: seed.rotation)
        // Open on the tab that contains the seeded swatch (default to .color).
        let cat = SwatchCatalog.swatches.first { $0.id == seed.swatchID }?.category ?? .color
        _category = State(initialValue: cat)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            titleRow
            Divider()

            targetChips
                .padding(.horizontal, 20)
                .padding(.vertical, 10)
            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    categoryChips
                    swatchGrid
                    materialRow
                    slidersSection
                }
                .padding(.horizontal, 20)
                .padding(.top, 16)
                .padding(.bottom, 28)
            }
        }
        .background(Color(.systemBackground))
    }

    // MARK: - Title row

    private var titleRow: some View {
        HStack {
            Text("Change Color")
                .font(.title3.weight(.semibold))
            Spacer()
            Button("Done") { dismiss() }
                .font(.body.weight(.semibold))
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 16)
    }

    // MARK: - Target chips (what "Change Color" edits: an item, or a surface)

    /// The item option, shown when the editor was opened on an item or one is selected.
    private var itemTargetOption: FinishTarget? {
        if case let .item(id) = activeTarget { return .item(id) }
        if let sel = state.selection { return .item(sel) }
        return nil
    }

    private var targetChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                if let item = itemTargetOption {
                    targetChip(item, label: "Item", icon: "cube.fill")
                }
                targetChip(.floor, label: "Floor", icon: "square.grid.3x3.fill")
                targetChip(.wall, label: "Walls", icon: "rectangle.split.2x1.fill")
                targetChip(.ceiling, label: "Ceiling", icon: "square.dashed")
            }
        }
    }

    private func targetChip(_ t: FinishTarget, label: String, icon: String) -> some View {
        let selected = (t == activeTarget)
        return Button {
            selectTarget(t)
        } label: {
            HStack(spacing: 5) {
                Image(systemName: icon).font(.system(size: 12, weight: .semibold))
                Text(label).font(.caption.weight(selected ? .semibold : .regular))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(Capsule(style: .continuous).fill(selected ? Color.accentColor : Color(.secondarySystemFill)))
            .foregroundStyle(selected ? Color.white : Color.primary)
        }
        .buttonStyle(.plain)
    }

    /// Switch the editor to a different surface/item and load *its* current finish so
    /// the swatch / material / sliders reflect what's already on it.
    private func selectTarget(_ t: FinishTarget) {
        activeTarget = t
        let seed = state.currentFinish(for: t) ?? SurfaceFinish(swatchID: SwatchCatalog.defaultSwatchID)
        swatchID = seed.swatchID
        kind = seed.kind
        textureScale = seed.textureScale
        rotation = seed.rotation
        category = SwatchCatalog.swatches.first { $0.id == seed.swatchID }?.category ?? .color
    }

    // MARK: - Category chips

    private var categoryChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(SwatchCategory.allCases) { cat in
                    categoryChip(cat)
                }
            }
            .padding(.vertical, 2)
        }
    }

    private func categoryChip(_ cat: SwatchCategory) -> some View {
        let selected = (cat == category)
        return Button {
            category = cat
        } label: {
            VStack(spacing: 6) {
                categoryThumbnail(cat)
                    .frame(width: 48, height: 48)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(selected ? Color.accentColor : Color(.separator),
                                          lineWidth: selected ? 2.5 : 1)
                    )
                Text(cat.rawValue)
                    .font(.caption2.weight(selected ? .semibold : .regular))
                    .foregroundStyle(selected ? Color.primary : Color.secondary)
            }
        }
        .buttonStyle(.plain)
    }

    /// A representative thumbnail for a category tab: the first textured swatch's
    /// image, or — for the colour category (or a textureless category) — a colour
    /// circle from the first swatch.
    @ViewBuilder
    private func categoryThumbnail(_ cat: SwatchCategory) -> some View {
        let swatches = SwatchCatalog.swatches(in: cat)
        if let textured = swatches.first(where: { $0.textureName != nil }),
           let name = textured.textureName {
            SwatchThumbnail(textureName: name)
        } else if let first = swatches.first {
            first.color
        } else {
            Color(.secondarySystemFill)
        }
    }

    // MARK: - Swatch grid

    private var swatchGrid: some View {
        let swatches = SwatchCatalog.swatches(in: category)
        return LazyVGrid(columns: gridColumns, spacing: 12) {
            ForEach(swatches) { swatch in
                swatchCell(swatch)
            }
        }
    }

    private func swatchCell(_ swatch: Swatch) -> some View {
        let selected = (swatch.id == swatchID)
        return Button {
            swatchID = swatch.id
            apply()
        } label: {
            VStack(spacing: 5) {
                Group {
                    if let name = swatch.textureName {
                        SwatchThumbnail(textureName: name)
                    } else {
                        swatch.color
                    }
                }
                .frame(width: cellSize, height: cellSize)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(selected ? Color.accentColor : Color(.separator),
                                      lineWidth: selected ? 3 : 1)
                )

                Text(swatch.name)
                    .font(.caption2)
                    .foregroundStyle(selected ? Color.primary : Color.secondary)
                    .lineLimit(1)
                    .frame(maxWidth: cellSize + 14)
            }
        }
        .buttonStyle(.plain)
    }

    // MARK: - Material kind row

    private var materialRow: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Material")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(SurfaceMaterialKind.allCases) { mk in
                        materialChip(mk)
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    private func materialChip(_ mk: SurfaceMaterialKind) -> some View {
        let selected = (mk == kind)
        return Button {
            kind = mk
            apply()
        } label: {
            Text(mk.rawValue)
                .font(.subheadline.weight(selected ? .semibold : .regular))
                .foregroundStyle(selected ? Color.white : Color.primary)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(
                    Capsule(style: .continuous)
                        .fill(selected ? Color.accentColor : Color(.secondarySystemFill))
                )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Sliders

    private var slidersSection: some View {
        VStack(alignment: .leading, spacing: 18) {
            // Texture Scale
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Texture Scale")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(String(format: "%.2f×", textureScale))
                        .font(.footnote.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                Slider(
                    value: Binding(
                        get: { Double(textureScale) },
                        set: { textureScale = Float($0); apply() }
                    ),
                    in: 0.25...4
                )
            }

            // Rotation (stored in radians, displayed in degrees)
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Rotation")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text("\(Int((rotation * 180 / .pi).rounded()))°")
                        .font(.footnote.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                Slider(
                    value: Binding(
                        get: { Double(rotation) },
                        set: { rotation = Float($0); apply() }
                    ),
                    in: 0...Double(2 * Float.pi)
                )
            }
        }
    }

    // MARK: - Apply

    /// Rebuild the finish from the current local state and push it to the model.
    private func apply() {
        let finish = SurfaceFinish(
            swatchID: swatchID,
            kind: kind,
            textureScale: textureScale,
            rotation: rotation
        )
        state.applyFinish(finish, to: activeTarget)
    }
}

// MARK: - Swatch thumbnail

/// Loads a bundled texture by name for use as a thumbnail. Textures ship as loose
/// resources under `Resources/Textures/<name>.png`, so we try the SwiftUI asset
/// catalog first (`Image(name)`), then a `UIImage(named:)` bundle lookup (which finds
/// loose resources), and finally a neutral placeholder — so a missing/renamed asset
/// degrades gracefully instead of crashing or rendering an empty cell.
private struct SwatchThumbnail: View {
    let textureName: String

    var body: some View {
        if let ui = UIImage(named: textureName) {
            Image(uiImage: ui)
                .resizable()
                .interpolation(.medium)
                .aspectRatio(contentMode: .fill)
        } else {
            // Last-resort placeholder (also covers SwiftUI-preview environments
            // where the loose resource isn't on the bundle search path).
            Image(textureName)
                .resizable()
                .interpolation(.medium)
                .aspectRatio(contentMode: .fill)
        }
    }
}
