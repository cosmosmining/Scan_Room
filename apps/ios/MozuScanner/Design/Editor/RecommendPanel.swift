// "Need advice" — the recommendation sheet. Lists the furniture sets produced by
// `FurnitureRecommender.recommend(for:catalog:)` for the current room and lets the
// user drop a whole set into the design with one tap (`DesignState.apply(_:)`).
//
// Pure projection from `DesignState`: it reads `state.room` + `state.catalog` to
// build recommendations and writes only via `state.apply(rec)`. Each row shows the
// set's title, its rationale, and the estimated total formatted through
// `Pricing.format`. Recommendations are computed once when the sheet appears (the
// recommender is pure and deterministic, so there's nothing to recompute live) and
// cached in local @State to avoid rebuilding the layout on every redraw.

import SwiftUI

struct RecommendPanel: View {
    @ObservedObject var state: DesignState

    @Environment(\.dismiss) private var dismiss

    /// Recommendations computed from the current room on appear. Empty until the
    /// first `onAppear` (or genuinely empty for a degenerate room / no matches).
    @State private var recommendations: [FurnitureRecommendation] = []

    var body: some View {
        NavigationStack {
            Group {
                if recommendations.isEmpty {
                    emptyState
                } else {
                    list
                }
            }
            .navigationTitle("Need advice")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .symbolRenderingMode(.hierarchical)
                            .accessibilityLabel("Done")
                    }
                }
            }
        }
        .onAppear {
            // Compute once: the recommender is deterministic for a given room/catalog.
            if recommendations.isEmpty {
                recommendations = FurnitureRecommender.recommend(for: state.room, catalog: state.catalog)
            }
        }
    }

    // MARK: - List

    private var list: some View {
        ScrollView {
            LazyVStack(spacing: 14) {
                ForEach(recommendations) { rec in
                    RecommendationCard(rec: rec) {
                        state.apply(rec)
                        dismiss()
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
    }

    // MARK: - Empty state

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "sparkles")
                .font(.largeTitle)
                .foregroundStyle(.secondary)
            Text("No suggestions for this room yet.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, 32)
    }
}

// MARK: - Card

/// One recommendation row: title, rationale, estimated total, and an Apply button.
private struct RecommendationCard: View {
    let rec: FurnitureRecommendation
    let onApply: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(rec.title)
                    .font(.headline)
                    .foregroundStyle(.primary)
                Spacer(minLength: 8)
                Text(Pricing.format(rec.estimatedTotal))
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            Text(rec.rationale)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            HStack {
                Text("\(rec.items.count) item\(rec.items.count == 1 ? "" : "s")")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                Spacer()
                Button(action: onApply) {
                    Text("Apply")
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 18)
                        .padding(.vertical, 8)
                        .background(Color.accentColor, in: Capsule())
                        .foregroundStyle(.white)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Apply \(rec.title)")
            }
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color(.secondarySystemBackground))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(Color(.separator).opacity(0.4), lineWidth: 0.5)
        )
    }
}
