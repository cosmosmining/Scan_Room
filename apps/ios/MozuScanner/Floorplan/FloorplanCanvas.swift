// Draws the dimensioned floorplan (the "2 Floorplan" step) with SwiftUI Canvas —
// the native equivalent of the SDK's `floorplanToSvg`: walls, per-wall captured
// lengths, floor area, door swings, and detected objects, all at real scale.

import SwiftUI

struct FloorplanCanvas: View {
    let floorplan: Floorplan
    var theme: Theme = .light

    struct Theme {
        var paper: Color
        var floor: Color
        var wall: Color
        var dimension: Color
        var label: Color
        var labelText: Color
        var object: Color
        /// Highlight for the fixture being edited.
        var selection: Color
        static let light = Theme(
            paper: .white,
            floor: Color(red: 0.957, green: 0.949, blue: 0.933),
            wall: Color(red: 0.12, green: 0.16, blue: 0.22),
            dimension: Color(red: 0.42, green: 0.45, blue: 0.50),
            label: Color(red: 0.07, green: 0.09, blue: 0.11),
            labelText: .white,
            object: Color(red: 0.90, green: 0.88, blue: 0.85),
            selection: Color(red: 0.00, green: 0.48, blue: 1.00)
        )
    }

    /// A finger on the plan, reported live so a fixture can be dragged rather than
    /// only tapped. `.changed` fires from touch-down onwards (the gesture has no
    /// minimum distance), `.ended` once on lift.
    enum EditPhase { case changed, ended }

    /// Fixture id (its index in the scan) drawn as selected, if any.
    var selectedFixture: Int? = nil

    /// Editing callback: phase, where the finger went down, where it is now —
    /// both in millimetres. Nil disables editing entirely.
    var onEdit: ((EditPhase, Vec2, Vec2) -> Void)? = nil

    var body: some View {
        GeometryReader { geo in
            Canvas { context, size in draw(in: &context, size: size) }
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { value in
                            guard let onEdit else { return }
                            let t = FloorplanTransform(floorplan: floorplan, size: geo.size)
                            onEdit(.changed, t.millimetres(value.startLocation), t.millimetres(value.location))
                        }
                        .onEnded { value in
                            guard let onEdit else { return }
                            let t = FloorplanTransform(floorplan: floorplan, size: geo.size)
                            onEdit(.ended, t.millimetres(value.startLocation), t.millimetres(value.location))
                        }
                )
        }
        .background(theme.paper)
    }

    private func draw(in context: inout GraphicsContext, size: CGSize) {
        let fp = floorplan
        guard fp.points.count >= 3 else { return }
        let span = max(fp.bounds.width, fp.bounds.depth, 1)
        let transform = FloorplanTransform(floorplan: fp, size: size)
        let scale = CGFloat(transform.scale)
        func p(_ v: Vec2) -> CGPoint { transform.point(v) }

        let wallPx = min(max(span / 45, 60), 140) * scale
        let thin = max(wallPx * 0.16, 1.5)
        let fontMm = min(max(span / 20, 130), 360)
        let fontPx = fontMm * scale

        // Floor + walls.
        var poly = Path()
        poly.addLines(fp.points.map(p))
        poly.closeSubpath()
        context.fill(poly, with: .color(theme.floor))
        context.stroke(poly, with: .color(theme.wall), style: StrokeStyle(lineWidth: wallPx, lineJoin: .miter))

        // Objects (furniture).
        for o in fp.objects {
            let path = objectPath(o, transform: p)
            context.fill(path, with: .color(theme.object))
            context.stroke(path, with: .color(theme.dimension), lineWidth: thin)
            context.draw(
                Text(o.category).font(.system(size: fontPx * 0.5)).foregroundColor(theme.dimension),
                at: p(o.center)
            )
        }

        // Openings (door swing / window bar).
        for op in fp.openings where op.wall < fp.walls.count {
            drawOpening(op, wall: fp.walls[op.wall], in: &context, transform: p, wallPx: wallPx, thin: thin)
        }

        // Sockets — a marker just inside the wall with its label beside it. A
        // manually-added one is drawn hollow so it reads as user-asserted rather
        // than measured. The height is drawn under the label because it is an
        // editable property here, and a number you cannot see is a number you
        // cannot check.
        for f in fp.fixtures {
            let r = max(wallPx * 0.62, fontPx * 0.34)
            let anchor = p(f.point)
            let centre = CGPoint(
                x: anchor.x + CGFloat(f.inward.x) * r * 1.15,
                y: anchor.y + CGFloat(f.inward.z) * r * 1.15
            )
            var stem = Path()
            stem.move(to: anchor)
            stem.addLine(to: centre)
            context.stroke(stem, with: .color(theme.wall), lineWidth: thin)

            // Selection ring first, so the marker sits on top of it.
            if f.id == selectedFixture {
                let halo = Path(ellipseIn: CGRect(
                    x: centre.x - r * 1.9, y: centre.y - r * 1.9, width: r * 3.8, height: r * 3.8
                ))
                context.fill(halo, with: .color(theme.selection.opacity(0.22)))
                context.stroke(halo, with: .color(theme.selection), lineWidth: thin * 1.6)
            }

            let disc = Path(ellipseIn: CGRect(
                x: centre.x - r, y: centre.y - r, width: r * 2, height: r * 2
            ))
            let detected = f.fixture.source == .detected
            context.fill(disc, with: .color(detected ? theme.wall : theme.paper))
            context.stroke(disc, with: .color(theme.wall), lineWidth: thin * 1.2)
            context.draw(
                Text("S").font(.system(size: r * 1.1, weight: .bold))
                    .foregroundColor(detected ? theme.paper : theme.wall),
                at: centre
            )
            let label = CGPoint(
                x: centre.x + CGFloat(f.inward.x) * r * 2.2,
                y: centre.y + CGFloat(f.inward.z) * r * 2.2
            )
            context.draw(
                Text(f.text).font(.system(size: fontPx * 0.52)).foregroundColor(theme.wall),
                at: label
            )
            context.draw(
                Text(Units.length(f.fixture.height, fp.unitSystem))
                    .font(.system(size: fontPx * 0.44))
                    .foregroundColor(f.id == selectedFixture ? theme.selection : theme.dimension),
                at: CGPoint(x: label.x, y: label.y + fontPx * 0.58)
            )
        }

        // Dimension labels (auto-captured wall lengths).
        for wall in fp.walls where wall.length >= 1 {
            let mid = Vec2(x: (wall.start.x + wall.end.x) / 2, z: (wall.start.z + wall.end.z) / 2)
            let labelPos = Vec2(x: mid.x + wall.outward.x * fontMm * 1.4, z: mid.z + wall.outward.z * fontMm * 1.4)
            let text = Units.length(wall.length, fp.unitSystem)
            let at = p(labelPos)
            let w = CGFloat(text.count) * fontPx * 0.55 + fontPx * 0.5
            let chip = Path(roundedRect: CGRect(x: at.x - w / 2, y: at.y - fontPx * 0.7, width: w, height: fontPx * 1.4), cornerRadius: fontPx * 0.35)
            context.fill(chip, with: .color(theme.label))
            context.draw(Text(text).font(.system(size: fontPx * 0.8, weight: .semibold)).foregroundColor(theme.labelText), at: at)
        }

        // Area + ceiling.
        let c = p(fp.center)
        context.draw(
            Text(Units.area(fp.areaMm2, fp.unitSystem)).font(.system(size: fontPx * 1.05, weight: .semibold)).foregroundColor(theme.wall),
            at: c
        )
        context.draw(
            Text("ceiling \(Units.length(fp.height, fp.unitSystem))").font(.system(size: fontPx * 0.6)).foregroundColor(theme.dimension),
            at: CGPoint(x: c.x, y: c.y + fontPx * 1.3)
        )
    }

    private func objectPath(_ o: ScanObject, transform p: (Vec2) -> CGPoint) -> Path {
        let hw = o.width / 2, hd = o.depth / 2
        let cosr = cos(o.rotation), sinr = sin(o.rotation)
        let locals = [(-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd)]
        let corners = locals.map { lx, lz -> CGPoint in
            p(Vec2(x: o.center.x + lx * cosr - lz * sinr, z: o.center.z + lx * sinr + lz * cosr))
        }
        var path = Path()
        path.addLines(corners)
        path.closeSubpath()
        return path
    }

    private func drawOpening(
        _ op: ScanOpening, wall: FloorplanWall,
        in context: inout GraphicsContext, transform p: (Vec2) -> CGPoint,
        wallPx: CGFloat, thin: CGFloat
    ) {
        let dir = Geo.normalize(Geo.sub(wall.end, wall.start))
        let total = Geo.distance(wall.start, wall.end)
        // `offset` is the opening's LEADING edge (the shared RoomScan contract),
        // so it spans [offset, offset + width] along the wall.
        let o = min(max(op.offset, 0), max(0, total - op.width))
        let a = Vec2(x: wall.start.x + dir.x * o, z: wall.start.z + dir.z * o)
        let b = Vec2(x: wall.start.x + dir.x * (o + op.width), z: wall.start.z + dir.z * (o + op.width))

        // Cut the wall (paint the gap with floor colour).
        var cut = Path()
        cut.move(to: p(a))
        cut.addLine(to: p(b))
        context.stroke(cut, with: .color(theme.floor), lineWidth: wallPx * 1.25)

        if op.type == .window {
            var bar = Path()
            bar.move(to: p(a))
            bar.addLine(to: p(b))
            context.stroke(bar, with: .color(theme.wall), lineWidth: thin * 1.4)
            return
        }
        // Door: leaf + swing arc.
        let inward = Vec2(x: -dir.z, z: dir.x)
        let leafEnd = Vec2(x: a.x + inward.x * op.width, z: a.z + inward.z * op.width)
        var leaf = Path()
        leaf.move(to: p(a))
        leaf.addLine(to: p(leafEnd))
        context.stroke(leaf, with: .color(theme.wall), lineWidth: thin * 1.4)

        let hinge = p(a)
        let radius = hypot(p(leafEnd).x - hinge.x, p(leafEnd).y - hinge.y)
        let startAngle = Angle(radians: atan2(p(b).y - hinge.y, p(b).x - hinge.x))
        let endAngle = Angle(radians: atan2(p(leafEnd).y - hinge.y, p(leafEnd).x - hinge.x))
        var arc = Path()
        arc.addArc(center: hinge, radius: radius, startAngle: startAngle, endAngle: endAngle, clockwise: false)
        context.stroke(arc, with: .color(theme.dimension), style: StrokeStyle(lineWidth: thin, dash: [thin * 3, thin * 2]))
    }
}
