// Top-down 2D floor plan of the scanned room and the placed furniture, kept in
// sync with the 3D scene through the shared `DesignState`.
//
// COORDINATE SYSTEM. The design model works in metres on the floor plane: world
// X is right, world Z is forward, Y is up. The room `footprint` is a list of
// `SIMD2<Float>` whose `.x` is world X and whose `.y` is world Z (this is how the
// rest of the model treats it — see `DesignState.clampToRoom`, which maps a
// footprint point's `.y` back to a 3D `position.z`). A placed item's plan
// footprint is therefore `(position.x, position.z)`.
//
// SCREEN MAPPING. We fit the room's metre-space bounding box into the available
// view rectangle with a uniform scale (so the plan keeps its real aspect ratio)
// and a fixed padding, then centre it. The single `PlanTransform` value owns the
// metres<->points conversion in both directions so gestures (which arrive in
// points) and drawing (which starts in metres) stay perfectly consistent. World
// +Z (forward) is drawn *down* the screen (screen +Y), matching a conventional
// architectural plan where you look down onto the floor.

import SwiftUI
import simd

// MARK: - Metres <-> points transform

/// A uniform, aspect-preserving mapping between metre-space floor coordinates
/// `(worldX, worldZ)` and view points `(x, y)`. World +X -> screen +X, world +Z
/// (forward) -> screen +Y (down). Scale is metres-to-points; it is identical on
/// both axes so the plan is never distorted.
private struct PlanTransform {
    let scale: CGFloat           // points per metre
    let originMetres: SIMD2<Float>   // metre-space point drawn at `originPoints`
    let originPoints: CGPoint        // view point that `originMetres` maps to

    /// Build a transform fitting `boundsMin...boundsMax` (metres) into `size`
    /// (points) with `padding` points of margin on every side. Falls back to a
    /// sane identity-ish transform for a degenerate (zero-area) room.
    init(metresMin: SIMD2<Float>, metresMax: SIMD2<Float>, size: CGSize, padding: CGFloat) {
        let spanX = CGFloat(metresMax.x - metresMin.x)
        let spanZ = CGFloat(metresMax.y - metresMin.y)
        let availW = max(size.width - 2 * padding, 1)
        let availH = max(size.height - 2 * padding, 1)

        let sx = spanX > 0 ? availW / spanX : .greatestFiniteMagnitude
        let sz = spanZ > 0 ? availH / spanZ : .greatestFiniteMagnitude
        var s = min(sx, sz)
        if !s.isFinite || s <= 0 { s = 50 }   // ~50 pt/m default for an empty room
        self.scale = s

        // Centre the scaled room inside the view.
        let drawnW = spanX * s
        let drawnH = spanZ * s
        self.originMetres = metresMin
        self.originPoints = CGPoint(
            x: (size.width - drawnW) / 2,
            y: (size.height - drawnH) / 2
        )
    }

    /// Metre-space floor point `(worldX, worldZ)` -> view point.
    func point(_ m: SIMD2<Float>) -> CGPoint {
        CGPoint(
            x: originPoints.x + CGFloat(m.x - originMetres.x) * scale,
            y: originPoints.y + CGFloat(m.y - originMetres.y) * scale
        )
    }

    /// View point -> metre-space floor point `(worldX, worldZ)`.
    func metres(_ p: CGPoint) -> SIMD2<Float> {
        SIMD2<Float>(
            originMetres.x + Float((p.x - originPoints.x) / scale),
            originMetres.y + Float((p.y - originPoints.y) / scale)
        )
    }

    /// Convert a drag *translation* in points to a delta in metres (no origin).
    func metresDelta(_ t: CGSize) -> SIMD2<Float> {
        SIMD2<Float>(Float(t.width / scale), Float(t.height / scale))
    }
}

// MARK: - FloorPlan2DView

struct FloorPlan2DView: View {
    @ObservedObject var state: DesignState

    init(state: DesignState) {
        self.state = state
    }

    // Wall-editing mode: when on, footprint vertices become draggable handles.
    @State private var editWalls = false

    // Live gesture state (kept here so drawing reflects the in-flight drag and we
    // only commit on change/end). Stored in metres / radians as appropriate.
    @State private var dragItemID: UUID?
    @State private var dragItemStart: SIMD3<Float>?
    @State private var rotateItemID: UUID?
    @State private var dragVertexIndex: Int?
    @State private var dragVertexStart: SIMD2<Float>?

    private let padding: CGFloat = 32
    private let vertexHitRadius: CGFloat = 22
    private let rotateHandleRadius: CGFloat = 9

    var body: some View {
        VStack(spacing: 0) {
            toolbar
            GeometryReader { proxy in
                let transform = makeTransform(for: proxy.size)
                ZStack {
                    Color(.secondarySystemBackground)
                    planCanvas(transform: transform)
                        .contentShape(Rectangle())
                        .gesture(planDragGesture(transform: transform))
                        .simultaneousGesture(tapGesture(transform: transform))
                }
            }
        }
    }

    // MARK: Toolbar

    private var toolbar: some View {
        HStack(spacing: 12) {
            Toggle(isOn: $editWalls) {
                Label("Edit Walls", systemImage: "ruler")
                    .font(.subheadline.weight(.semibold))
            }
            .toggleStyle(.button)
            .tint(.blue)

            // Delete the selected item (the 2D plan previously had no delete at all).
            // Capture the id in the `if let` so the action never depends on a live
            // selection a later tap could clear.
            if let selectedID = state.selection {
                Button(role: .destructive) {
                    state.remove(selectedID)
                } label: {
                    Label("Delete", systemImage: "trash")
                        .font(.subheadline.weight(.semibold))
                }
                .buttonStyle(.bordered)
                .tint(.red)
                .transition(.opacity)
                .accessibilityLabel("Delete selected furniture")
            }

            Spacer()

            Text(String(format: "%.1f m²", state.room.area))
                .font(.footnote.monospacedDigit())
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.bar)
        .animation(.easeInOut(duration: 0.2), value: state.selection)
    }

    // MARK: Transform

    /// Bounds cover the footprint with a little slack so wall strokes / vertex
    /// handles near the edge are never clipped.
    private func makeTransform(for size: CGSize) -> PlanTransform {
        // Fit every room in the house (primary + context rooms), not just one.
        let points = state.allFootprints.flatMap { $0 }
        guard !points.isEmpty else {
            return PlanTransform(metresMin: SIMD2<Float>(-2, -2),
                                 metresMax: SIMD2<Float>(2, 2),
                                 size: size, padding: padding)
        }
        var lo = points[0], hi = points[0]
        for p in points {
            lo = simd_min(lo, p)
            hi = simd_max(hi, p)
        }
        return PlanTransform(metresMin: lo, metresMax: hi, size: size, padding: padding)
    }

    // MARK: Canvas

    private func planCanvas(transform t: PlanTransform) -> some View {
        Canvas { ctx, _ in
            let room = state.room
            let footprint = room.footprint
            guard footprint.count >= 3 else { return }

            // --- Context rooms (whole-house mode): floor fill + wall stroke + dims ---
            for extra in state.extraRooms where extra.footprint.count >= 3 {
                var path = Path()
                path.move(to: t.point(extra.footprint[0]))
                for v in extra.footprint.dropFirst() { path.addLine(to: t.point(v)) }
                path.closeSubpath()
                let tone = MaterialFactory.uiColor(for: extra.floorFinish, swatches: state.swatches)
                ctx.fill(path, with: .color(tone.opacity(0.8)))
                ctx.stroke(path, with: .color(Color(white: 0.15)),
                           style: StrokeStyle(lineWidth: 6, lineJoin: .round))
                for wall in extra.walls {
                    drawDimension(wall, ctx: &ctx, transform: t)
                }
            }

            // --- Floor polygon (filled with the floor finish's flat tone) ---
            var floorPath = Path()
            floorPath.move(to: t.point(footprint[0]))
            for v in footprint.dropFirst() { floorPath.addLine(to: t.point(v)) }
            floorPath.closeSubpath()
            let floorColor = MaterialFactory.uiColor(for: room.floorFinish, swatches: state.swatches)
            ctx.fill(floorPath, with: .color(floorColor))

            // --- Furniture footprints (under the wall stroke so walls read on top) ---
            for placed in state.items {
                drawFurniture(placed, ctx: &ctx, transform: t)
            }

            // --- Thick dark wall stroke along the footprint ---
            ctx.stroke(floorPath, with: .color(Color(white: 0.15)),
                       style: StrokeStyle(lineWidth: 6, lineJoin: .round))

            // --- Per-wall dimension labels (length in cm, e.g. "244") ---
            for wall in room.walls {
                drawDimension(wall, ctx: &ctx, transform: t)
            }

            // --- Wall-edit vertex handles ---
            if editWalls {
                for (i, v) in footprint.enumerated() {
                    let p = t.point(v)
                    let r: CGFloat = 7
                    let rect = CGRect(x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r)
                    let active = (i == dragVertexIndex)
                    ctx.fill(Path(ellipseIn: rect), with: .color(.white))
                    ctx.stroke(Path(ellipseIn: rect),
                               with: .color(active ? .orange : .blue),
                               lineWidth: active ? 3 : 2)
                }
            }
        }
    }

    /// Draw one placed item's plan footprint: an oriented rectangle of
    /// `size.x` (width) by `size.z` (depth), centred at `(position.x, position.z)`,
    /// rotated by `rotationY`, filled with its finish tone at low opacity, with a
    /// thin border and the item name. The selected item additionally gets a blue
    /// highlight, corner handles and a rotate handle.
    private func drawFurniture(_ placed: PlacedFurniture, ctx: inout GraphicsContext, transform t: PlanTransform) {
        guard let item = state.item(for: placed) else { return }

        let centreM = SIMD2<Float>(placed.position.x, placed.position.z)
        let halfW = item.size.x / 2
        let halfD = item.size.z / 2
        let yaw = placed.rotationY

        // Local-space rectangle corners (metres), rotated into world then to points.
        let localCorners: [SIMD2<Float>] = [
            SIMD2<Float>(-halfW, -halfD),
            SIMD2<Float>( halfW, -halfD),
            SIMD2<Float>( halfW,  halfD),
            SIMD2<Float>(-halfW,  halfD),
        ]
        let worldCorners = localCorners.map { rotate($0, by: yaw) + centreM }
        let screenCorners = worldCorners.map { t.point($0) }

        var rect = Path()
        rect.move(to: screenCorners[0])
        for c in screenCorners.dropFirst() { rect.addLine(to: c) }
        rect.closeSubpath()

        let isSelected = (placed.id == state.selection)

        // Fill (low opacity) + border.
        var fill = MaterialFactory.uiColor(for: finish(for: placed, item: item), swatches: state.swatches)
        fill = fill.opacity(0.55)
        ctx.fill(rect, with: .color(fill))
        ctx.stroke(rect, with: .color(isSelected ? .blue : Color(white: 0.3)),
                   style: StrokeStyle(lineWidth: isSelected ? 2.5 : 1.2))

        // A short "front" tick on the +Z (depth) edge so orientation is legible.
        let frontMid = t.point(rotate(SIMD2<Float>(0, halfD), by: yaw) + centreM)
        let centrePt = t.point(centreM)
        var tick = Path()
        tick.move(to: centrePt)
        tick.addLine(to: frontMid)
        ctx.stroke(tick, with: .color(isSelected ? .blue.opacity(0.7) : Color(white: 0.4).opacity(0.6)),
                   lineWidth: 1)

        // Item name centred in the footprint (skip if the rect is tiny).
        let widthPts = hypot(screenCorners[1].x - screenCorners[0].x,
                             screenCorners[1].y - screenCorners[0].y)
        if widthPts > 34 {
            let text = Text(item.name)
                .font(.system(size: 9, weight: .medium))
                .foregroundColor(Color(white: 0.12))
            ctx.draw(text, at: centrePt, anchor: .center)
        }

        // Selection extras: corner handles + a rotate handle.
        if isSelected {
            for c in screenCorners {
                let r: CGFloat = 4
                let hr = CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r)
                ctx.fill(Path(ellipseIn: hr), with: .color(.white))
                ctx.stroke(Path(ellipseIn: hr), with: .color(.blue), lineWidth: 1.5)
            }
            let rp = rotateHandlePoint(for: placed, item: item, transform: t)
            // Stem from the footprint corner to the rotate handle.
            var stem = Path()
            stem.move(to: screenCorners[1])
            stem.addLine(to: rp)
            ctx.stroke(stem, with: .color(.blue.opacity(0.6)), lineWidth: 1)
            let hr = CGRect(x: rp.x - rotateHandleRadius, y: rp.y - rotateHandleRadius,
                            width: 2 * rotateHandleRadius, height: 2 * rotateHandleRadius)
            ctx.fill(Path(ellipseIn: hr), with: .color(.blue))
            ctx.stroke(Path(ellipseIn: hr), with: .color(.white), lineWidth: 1.5)
        }
    }

    /// Per-wall dimension label: the wall length in centimetres ("244"), drawn at
    /// the wall midpoint, nudged slightly outward along the wall's outward normal.
    private func drawDimension(_ wall: WallSegment, ctx: inout GraphicsContext, transform t: PlanTransform) {
        let lengthCM = Int((wall.length * 100).rounded())
        guard lengthCM > 0 else { return }
        let midM = (wall.a + wall.b) * 0.5
        // Nudge outward by a fixed point distance, converted to metres so it tracks zoom.
        let nudgeMetres = Float(16 / t.scale)
        let labelM = midM + wall.outward * nudgeMetres
        let at = t.point(labelM)

        let text = Text("\(lengthCM)")
            .font(.system(size: 11, weight: .semibold).monospacedDigit())
            .foregroundColor(.primary)
        // Plate behind the text for legibility over the floor fill.
        ctx.draw(text, at: at, anchor: .center)
    }

    // MARK: Finish helpers

    private func finish(for placed: PlacedFurniture, item: FurnitureItem) -> SurfaceFinish {
        if let f = placed.finish { return f }
        if let d = item.defaultFinish { return d }
        // No finish set: a neutral wood-ish swatch so the rectangle is never invisible.
        return SurfaceFinish(swatchID: SwatchCatalog.defaultSwatchID)
    }

    // MARK: Rotate handle geometry

    /// The rotate handle sits just beyond the item's front-right corner, offset
    /// outward along the item's local +X/+Z diagonal so it never overlaps the body.
    private func rotateHandlePoint(for placed: PlacedFurniture, item: FurnitureItem, transform t: PlanTransform) -> CGPoint {
        let centreM = SIMD2<Float>(placed.position.x, placed.position.z)
        let halfW = item.size.x / 2
        let halfD = item.size.z / 2
        let corner = rotate(SIMD2<Float>(halfW, halfD), by: placed.rotationY) + centreM
        let cornerPt = t.point(corner)
        // Push outward from the centre by a fixed point distance.
        let centrePt = t.point(centreM)
        let dir = CGVector(dx: cornerPt.x - centrePt.x, dy: cornerPt.y - centrePt.y)
        let len = max(hypot(dir.dx, dir.dy), 0.0001)
        let push: CGFloat = 18
        return CGPoint(x: cornerPt.x + dir.dx / len * push,
                       y: cornerPt.y + dir.dy / len * push)
    }

    // MARK: Gestures

    /// Tap: hit-test furniture footprints (front to back). A hit selects; empty
    /// space deselects. Disabled mid-drag.
    private func tapGesture(transform t: PlanTransform) -> some Gesture {
        SpatialTapGesture()
            .onEnded { value in
                if editWalls { return }
                if let id = hitTestItem(at: value.location, transform: t) {
                    state.select(id)
                } else {
                    state.select(nil)
                }
            }
    }

    /// Unified drag gesture. On first change we classify the drag against the
    /// current state (vertex handle in Edit Walls, rotate handle, item body) and
    /// then keep applying it until the gesture ends.
    private func planDragGesture(transform t: PlanTransform) -> some Gesture {
        DragGesture(minimumDistance: 2)
            .onChanged { value in
                if editWalls {
                    handleVertexDrag(value, transform: t)
                } else {
                    handleItemDrag(value, transform: t)
                }
            }
            .onEnded { _ in
                dragItemID = nil
                dragItemStart = nil
                rotateItemID = nil
                dragVertexIndex = nil
                dragVertexStart = nil
            }
    }

    // MARK: Drag — furniture move & rotate

    private func handleItemDrag(_ value: DragGesture.Value, transform t: PlanTransform) {
        // Classify on the first change of this gesture.
        if dragItemID == nil && rotateItemID == nil {
            // 1) Rotate handle of the selected item?
            if let sel = state.selectedItem, let item = state.item(for: sel) {
                let rp = rotateHandlePoint(for: sel, item: item, transform: t)
                if distance(value.startLocation, rp) <= rotateHandleRadius + 14 {
                    rotateItemID = sel.id
                }
            }
            // 2) Otherwise a footprint body drag (select it first).
            if rotateItemID == nil, let id = hitTestItem(at: value.startLocation, transform: t) {
                if state.selection != id { state.select(id) }
                dragItemID = id
                dragItemStart = state.items.first { $0.id == id }?.position
            }
        }

        if let id = rotateItemID,
           let placed = state.items.first(where: { $0.id == id }) {
            // Yaw = angle from the item centre to the current pointer. The handle
            // sits on the local +X/+Z diagonal, so subtract that 45° bias to keep
            // the visual handle under the finger.
            let centrePt = t.point(SIMD2<Float>(placed.position.x, placed.position.z))
            let dx = value.location.x - centrePt.x
            let dy = value.location.y - centrePt.y
            // Screen +Y is world +Z; atan2(dy, dx) is the angle in the (X, Z) plane.
            let angle = Float(atan2(Double(dy), Double(dx)))
            let yaw = angle - (.pi / 4)   // remove the diagonal handle offset
            state.rotate(id, to: yaw)
        } else if let id = dragItemID, let start = dragItemStart {
            let dM = t.metresDelta(value.translation)   // (dX, dZ) in metres
            let newPos = SIMD3<Float>(start.x + dM.x, 0, start.z + dM.y)
            state.move(id, to: newPos)
        }
    }

    // MARK: Drag — wall vertices (Edit Walls)

    private func handleVertexDrag(_ value: DragGesture.Value, transform t: PlanTransform) {
        if dragVertexIndex == nil {
            // Pick the nearest footprint vertex within the hit radius.
            var best: (idx: Int, d: CGFloat)?
            for (i, v) in state.room.footprint.enumerated() {
                let d = distance(value.startLocation, t.point(v))
                if d <= vertexHitRadius, best == nil || d < best!.d {
                    best = (i, d)
                }
            }
            guard let pick = best else { return }
            dragVertexIndex = pick.idx
            dragVertexStart = state.room.footprint[pick.idx]
        }

        guard let idx = dragVertexIndex, let start = dragVertexStart,
              idx < state.room.footprint.count else { return }
        let dM = t.metresDelta(value.translation)
        state.room.footprint[idx] = SIMD2<Float>(start.x + dM.x, start.y + dM.y)
    }

    // MARK: Hit testing

    /// Topmost furniture whose oriented footprint contains `point` (points).
    private func hitTestItem(at point: CGPoint, transform t: PlanTransform) -> UUID? {
        for placed in state.items.reversed() {
            guard let item = state.item(for: placed) else { continue }
            // Map the point into the item's local (un-rotated, centred) frame, in metres.
            let worldM = t.metres(point)
            let rel = worldM - SIMD2<Float>(placed.position.x, placed.position.z)
            let local = rotate(rel, by: -placed.rotationY)
            let halfW = item.size.x / 2
            let halfD = item.size.z / 2
            // Small slop so thin items (e.g. the rug edge) stay tappable.
            let slopX = max(halfW, 0.12)
            let slopD = max(halfD, 0.12)
            if abs(local.x) <= slopX && abs(local.y) <= slopD {
                return placed.id
            }
        }
        return nil
    }

    // MARK: Math utilities

    /// Rotate a 2D vector by `angle` radians in the floor plane. Screen +Y maps to
    /// world +Z, so a positive `rotationY` (yaw about +Y) reads as a clockwise turn
    /// on screen, which matches the 3D scene's apparent rotation from above.
    private func rotate(_ v: SIMD2<Float>, by angle: Float) -> SIMD2<Float> {
        let c = cos(angle), s = sin(angle)
        return SIMD2<Float>(v.x * c - v.y * s, v.x * s + v.y * c)
    }

    private func distance(_ a: CGPoint, _ b: CGPoint) -> CGFloat {
        hypot(a.x - b.x, a.y - b.y)
    }
}
