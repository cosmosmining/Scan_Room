// The "Add Furniture" catalogue browser. A searchable, category-grouped grid of
// the bundled `FurnitureCatalog`; tapping a card places the item via
// `DesignState.add(_:)` and dismisses. Pure SwiftUI — it projects from the shared
// state and never touches RealityKit directly.
//
// Each card shows an SF Symbol placeholder thumbnail (chosen by category), the
// item name, and its footprint formatted as "W × D cm" (item.size is metres:
// .x = width, .z = depth).

import SwiftUI
import simd

struct AddFurnitureSheet: View {
    @ObservedObject var state: DesignState
    var onClose: () -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var query: String = ""

    // Two flexible columns for the card grid.
    private let columns = [
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12),
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 24, pinnedViews: [.sectionHeaders]) {
                    ForEach(visibleSections, id: \.category) { section in
                        Section {
                            LazyVGrid(columns: columns, spacing: 12) {
                                ForEach(section.items) { item in
                                    FurnitureCard(
                                        item: item,
                                        symbol: Self.symbol(for: item.category)
                                    ) {
                                        place(item)
                                    }
                                }
                            }
                            .padding(.horizontal)
                        } header: {
                            sectionHeader(section.category)
                        }
                    }

                    if visibleSections.isEmpty {
                        emptyState
                    }
                }
                .padding(.vertical, 8)
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always),
                        prompt: "Search furniture")
            .navigationTitle("Add Furniture")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        close()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .symbolRenderingMode(.hierarchical)
                            .accessibilityLabel("Done")
                    }
                }
            }
        }
    }

    // MARK: - Sections

    /// A category section with its matching items, after applying the search filter.
    private struct CatalogSection {
        let category: String
        let items: [FurnitureItem]
    }

    /// Catalogue grouped by `FurnitureCatalog.categories`, filtered by the current
    /// query (case/diacritic-insensitive substring on the item name). Empty
    /// sections are dropped so the list only shows categories with matches.
    private var visibleSections: [CatalogSection] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return FurnitureCatalog.categories.compactMap { category in
            var items = FurnitureCatalog.items(in: category)
            if !trimmed.isEmpty {
                items = items.filter {
                    $0.name.range(of: trimmed, options: [.caseInsensitive, .diacriticInsensitive]) != nil
                }
            }
            return items.isEmpty ? nil : CatalogSection(category: category, items: items)
        }
    }

    // MARK: - Subviews

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .font(.headline)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal)
            .padding(.vertical, 6)
            .background(.bar)
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.largeTitle)
                .foregroundStyle(.secondary)
            Text("No furniture matches “\(query)”.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 48)
        .padding(.horizontal)
    }

    // MARK: - Actions

    private func place(_ item: FurnitureItem) {
        state.add(item)
        close()
    }

    private func close() {
        onClose()
        dismiss()
    }

    // MARK: - Category iconography

    /// SF Symbol used as the placeholder thumbnail for a category. Covers the
    /// catalogue's real categories (Seating/Tables/Storage/Bedroom/Decor) and the
    /// README's example names; unknown categories fall back to a generic glyph.
    static func symbol(for category: String) -> String {
        switch category {
        case "Seating", "Sofa": return "sofa"
        case "Bedroom", "Bed": return "bed.double"
        case "Tables", "Table": return "table.furniture"
        case "Storage", "Cabinet": return "cabinet"
        case "Decor", "Lighting": return "leaf"
        default: return "shippingbox"
        }
    }
}

// MARK: - Card

/// One tappable catalogue card: a category SF Symbol thumbnail, the item name, and
/// the footprint size rendered as "W × D cm".
private struct FurnitureCard: View {
    let item: FurnitureItem
    let symbol: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 8) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(Color(.secondarySystemBackground))
                    Image(systemName: symbol)
                        .font(.system(size: 40, weight: .regular))
                        .symbolRenderingMode(.hierarchical)
                        .foregroundStyle(.tint)
                }
                .frame(height: 96)
                .frame(maxWidth: .infinity)

                Text(item.name)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.primary)
                    .lineLimit(1)

                Text(Self.sizeLabel(for: item.size))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(10)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color(.systemBackground))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(Color(.separator).opacity(0.5), lineWidth: 0.5)
            )
            .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(item.name), \(Self.sizeLabel(for: item.size))")
        .accessibilityAddTraits(.isButton)
    }

    /// Footprint "width × depth" in centimetres, e.g. "212 × 95 cm". Uses the
    /// item's metre size (.x width, .z depth), rounded to whole centimetres.
    static func sizeLabel(for size: SIMD3<Float>) -> String {
        let w = Int((size.x * 100).rounded())
        let d = Int((size.z * 100).rounded())
        return "\(w) × \(d) cm"
    }
}
