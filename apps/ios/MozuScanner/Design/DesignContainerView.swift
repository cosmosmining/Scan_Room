// The top-level Design screen. Owns the `DesignState` (the single source of truth
// for the design session) and hosts the two interchangeable main views — the
// RealityKit 3D "virtual showroom" and the 2D floor plan — plus the bottom action
// bar (Open 2D/3D plan • room area • Add Furniture • Change Color) and the two
// modal sheets (Add Furniture, Change Color).
//
// State ownership: `DesignContainerView` is the only place that constructs the
// `DesignState` (`@StateObject`, so it survives view-identity churn). Every child
// view receives it as an `@ObservedObject` and mutates it through its API, so the
// 3D scene and 2D plan stay in sync. The container itself only owns ephemeral UI
// flags: which sheet is presented.

import SwiftUI
import simd

struct DesignContainerView: View {
    @StateObject private var state: DesignState

    @Environment(\.dismiss) private var dismiss

    // Ephemeral presentation flags for the bottom-bar sheets + the AR cover.
    @State private var showAdd = false
    @State private var showMaterial = false
    @State private var showRecommend = false
    @State private var showPricing = false
    @State private var showAR = false

    init(scan: RoomScan, extraScans: [RoomScan] = []) {
        _state = StateObject(wrappedValue: DesignState(scan: scan, extraScans: extraScans))
    }

    /// What the "Change Color" sheet edits: an explicit finish target if one is set
    /// (e.g. the user tapped a wall/floor in 3D), else the selected furniture item,
    /// else the floor as a sensible default so the button always does something.
    private var materialTarget: FinishTarget {
        state.finishTarget ?? state.selection.map(FinishTarget.item) ?? .floor
    }

    var body: some View {
        ZStack {
            Color(.systemBackground).ignoresSafeArea()

            // Main area: 3D showroom or 2D plan, with the bars overlaid.
            mainArea
                .ignoresSafeArea(edges: .bottom)

            VStack(spacing: 0) {
                topBar
                Spacer(minLength: 0)
                bottomBar
            }
        }
        .sheet(isPresented: $showAdd) {
            AddFurnitureSheet(state: state, onClose: { showAdd = false })
                .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showMaterial) {
            MaterialEditorView(state: state, target: materialTarget)
                .presentationDetents([.medium])
        }
        .sheet(isPresented: $showRecommend) {
            RecommendPanel(state: state)
                .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showPricing) {
            PricingPanel(state: state)
                .presentationDetents([.medium, .large])
        }
        .fullScreenCover(isPresented: $showAR) {
            ARPlacementView(state: state)
        }
    }

    // MARK: - Main area (3D ⇄ 2D)

    @ViewBuilder
    private var mainArea: some View {
        if state.viewMode == .threeD {
            DesignScene3DView(state: state, onRequestMaterialEditor: { showMaterial = true })
        } else {
            FloorPlan2DView(state: state)
        }
    }

    // MARK: - Top bar (dismiss • share)

    private var topBar: some View {
        HStack {
            topButton(systemImage: "xmark") { dismiss() }

            Spacer()

            topButton(systemImage: "square.and.arrow.up") {
                // Share / capture stub — wired up by the export flow later.
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    private func topButton(systemImage: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.primary)
                .frame(width: 40, height: 40)
                .background(.ultraThinMaterial, in: Circle())
                .overlay(Circle().strokeBorder(Color(.separator).opacity(0.4), lineWidth: 0.5))
        }
        .accessibilityLabel(systemImage == "xmark" ? "Close" : "Share")
    }

    // MARK: - Bottom bar (Open 2D/3D • area • Change Color • Add Furniture)

    private var bottomBar: some View {
        HStack(spacing: 12) {
            viewModeButton

            Spacer(minLength: 8)

            VStack(spacing: 1) {
                Text(String(format: "%.1f m²", state.totalArea))
                    .font(.headline.monospacedDigit())
                    .foregroundStyle(.primary)
                Text(state.extraRooms.isEmpty ? "Room area" : "House · \(state.extraRooms.count + 1) rooms")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 8)

            recommendButton
            pricingButton
            arButton
            changeColorButton
            addFurnitureButton
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(.ultraThinMaterial)
        .overlay(alignment: .top) {
            Divider().opacity(0.5)
        }
    }

    /// Left pill: toggles between the 3D showroom and the 2D plan. Its label/glyph
    /// describe the destination ("Open 2D plan" while you're in 3D, and vice-versa).
    private var viewModeButton: some View {
        let inThreeD = (state.viewMode == .threeD)
        return Button {
            withAnimation(.easeInOut(duration: 0.2)) {
                state.viewMode = inThreeD ? .twoD : .threeD
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: inThreeD ? "square.on.square" : "cube")
                    .font(.system(size: 14, weight: .semibold))
                Text(inThreeD ? "Open 2D plan" : "Open 3D plan")
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(
                Capsule(style: .continuous).fill(Color(.secondarySystemFill))
            )
            .foregroundStyle(.primary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(inThreeD ? "Open 2D plan" : "Open 3D plan")
    }

    /// Grand total of everything currently placed, formatted (e.g. "$2,615"). Drives
    /// the Pricing button's caption so the user sees a live running total.
    private var runningTotal: String {
        let total = Pricing.breakdown(items: state.items, catalog: state.catalog, currency: "USD").total
        return Pricing.format(total, currency: "USD")
    }

    /// "Recommend" — opens the AI furniture-recommendation sheet.
    private var recommendButton: some View {
        Button {
            showRecommend = true
        } label: {
            VStack(spacing: 3) {
                Image(systemName: "sparkles")
                    .font(.system(size: 18, weight: .semibold))
                    .frame(width: 44, height: 44)
                    .background(Color(.secondarySystemFill), in: Circle())
                    .foregroundStyle(.primary)
                Text("Recommend")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Recommend furniture")
    }

    /// "Pricing" — opens the itemised quote. The caption shows the live running total.
    private var pricingButton: some View {
        Button {
            showPricing = true
        } label: {
            VStack(spacing: 3) {
                Image(systemName: "tag.fill")
                    .font(.system(size: 18, weight: .semibold))
                    .frame(width: 44, height: 44)
                    .background(Color(.secondarySystemFill), in: Circle())
                    .foregroundStyle(.primary)
                Text(runningTotal)
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Pricing, total \(runningTotal)")
    }

    /// "AR" — presents the live AR placement experience as a full-screen cover.
    private var arButton: some View {
        Button {
            showAR = true
        } label: {
            VStack(spacing: 3) {
                Image(systemName: "arkit")
                    .font(.system(size: 18, weight: .semibold))
                    .frame(width: 44, height: 44)
                    .background(Color(.secondarySystemFill), in: Circle())
                    .foregroundStyle(.primary)
                Text("AR")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("View in AR")
    }

    /// "Change Color" — opens the material editor. Always enabled; `materialTarget`
    /// supplies a sensible default (the floor) when nothing is selected.
    private var changeColorButton: some View {
        Button {
            showMaterial = true
        } label: {
            VStack(spacing: 3) {
                Image(systemName: "paintpalette.fill")
                    .font(.system(size: 18, weight: .semibold))
                    .frame(width: 44, height: 44)
                    .background(Color(.secondarySystemFill), in: Circle())
                    .foregroundStyle(.primary)
                Text("Change Color")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Change Color")
    }

    /// Large "+" — opens the furniture catalogue.
    private var addFurnitureButton: some View {
        Button {
            showAdd = true
        } label: {
            VStack(spacing: 3) {
                Image(systemName: "plus")
                    .font(.system(size: 22, weight: .bold))
                    .frame(width: 44, height: 44)
                    .background(Color.accentColor, in: Circle())
                    .foregroundStyle(.white)
                Text("Add Furniture")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Add Furniture")
    }
}
