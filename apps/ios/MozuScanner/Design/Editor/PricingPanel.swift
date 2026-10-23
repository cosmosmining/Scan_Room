// The pricing sheet — an itemised quote for everything placed in the room. Reads
// `state.items` + `state.catalog` and renders `Pricing.breakdown(...)`: one row per
// furniture type (name, qty × unit, line total), then the subtotal, the install fee
// and the grand total, all formatted via `Pricing.format`.
//
// Pure projection from `DesignState`: it never mutates the design. The breakdown is
// recomputed from the published `items`, so the quote stays live as the user adds,
// removes or duplicates furniture while the sheet is open.

import SwiftUI

struct PricingPanel: View {
    @ObservedObject var state: DesignState

    @Environment(\.dismiss) private var dismiss

    /// Currency the quote is denominated in. Matches the brief's "USD".
    private let currency = "USD"

    /// Live quote for the current placement list.
    private var breakdown: PriceBreakdown {
        Pricing.breakdown(items: state.items, catalog: state.catalog, currency: currency)
    }

    var body: some View {
        NavigationStack {
            Group {
                if breakdown.lines.isEmpty {
                    emptyState
                } else {
                    quote
                }
            }
            .navigationTitle("Pricing")
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
    }

    // MARK: - Quote

    private var quote: some View {
        // Snapshot once per render so the line items and the totals are guaranteed
        // consistent (and we don't recompute the breakdown for every row).
        let b = breakdown
        return ScrollView {
            VStack(spacing: 0) {
                ForEach(b.lines) { line in
                    lineRow(line)
                    Divider().opacity(0.4)
                }

                totalsRow(label: "Subtotal", amount: b.subtotal)
                totalsRow(label: "Installation", amount: b.install)

                Divider().padding(.vertical, 4)

                totalsRow(label: "Total", amount: b.total, emphasised: true)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
    }

    private func lineRow(_ line: PriceLine) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(line.name)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                Text("\(line.qty) × \(Pricing.format(line.unit, currency: currency))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            Text(Pricing.format(line.total, currency: currency))
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(.primary)
        }
        .padding(.vertical, 10)
    }

    private func totalsRow(label: String, amount: Int, emphasised: Bool = false) -> some View {
        HStack {
            Text(label)
                .font(emphasised ? .headline : .subheadline)
                .foregroundStyle(emphasised ? .primary : .secondary)
            Spacer()
            Text(Pricing.format(amount, currency: currency))
                .font((emphasised ? Font.headline : Font.subheadline).monospacedDigit())
                .foregroundStyle(.primary)
        }
        .padding(.vertical, emphasised ? 8 : 6)
    }

    // MARK: - Empty state

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "cart")
                .font(.largeTitle)
                .foregroundStyle(.secondary)
            Text("Add furniture to see a price.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, 32)
    }
}
