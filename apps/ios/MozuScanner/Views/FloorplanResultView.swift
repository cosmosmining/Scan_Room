// The "2 Floorplan" step: the auto-generated dimensioned plan, summary stats,
// and the actions — open the room straight in MOZU, share the scan JSON, or
// scan again.

import SwiftUI

struct FloorplanResultView: View {
    var onRescan: () -> Void
    @AppStorage("mozuWebBase") private var webBase = "https://app.mozu.example"

    /// The scan, editable — sockets the detector missed can be added by hand
    /// right here, so correcting a plan never means leaving the app.
    @State private var scan: RoomScan
    /// While on, the plan is an editor: drag a socket along the walls, tap bare
    /// wall to drop a new one, and set the selected one's height.
    @State private var editingSockets = false
    /// Index into `scan.fixtures` of the socket being edited.
    @State private var selectedSocket: Int?
    /// Index picked up by the current drag (nil when the finger went down on
    /// empty plan, which is what turns a lift into "place a new socket here").
    @State private var draggingSocket: Int?
    /// Whether the in-flight gesture has already been claimed.
    @State private var dragClaimed = false
    /// Height applied to the next hand-placed socket — carries the last value the
    /// user chose, so placing a row of sockets is one tap each.
    @State private var newSocketHeight = FloorplanResultView.defaultSocketHeightMm

    /// Presents the on-device 3D/2D design experience (place & style furniture).
    @State private var showDesign = false

    /// The handoff to the web platform: upload state and the code to read out.
    @State private var sending = false
    @State private var ticket: ScanHandoff.Ticket?
    @State private var sendError: String?

    init(scan: RoomScan, onRescan: @escaping () -> Void) {
        _scan = State(initialValue: scan)
        self.onRescan = onRescan
    }

    private var floorplan: Floorplan { Floorplan.build(from: scan) }
    private var socketCount: Int { scan.fixtures.count }

    var body: some View {
        VStack(spacing: 0) {
            FloorplanCanvas(
                floorplan: floorplan,
                selectedFixture: editingSockets ? selectedSocket : nil,
                onEdit: editingSockets ? { handleEdit($0, from: $1, to: $2) } : nil
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(alignment: .topLeading) {
                if editingSockets {
                    Text("Tap a wall to add · drag a socket to move it")
                        .font(.caption2)
                        .padding(.horizontal, 8).padding(.vertical, 5)
                        .background(.thinMaterial, in: Capsule())
                        .padding(24)
                }
            }
            .padding(16)

            if editingSockets { socketInspector.padding(.horizontal, 16) }

            stats
                .padding(.horizontal, 16)

            VStack(spacing: 10) {
                Button {
                    showDesign = true
                } label: {
                    Label("Design room", systemImage: "cube.transparent")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)

                Button {
                    editingSockets.toggle()
                    if !editingSockets { selectedSocket = nil }
                } label: {
                    Label(
                        editingSockets ? "Done editing sockets" : "Add / edit sockets",
                        systemImage: editingSockets ? "checkmark.circle" : "bolt.fill"
                    )
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(editingSockets ? .accentColor : .secondary)
                .controlSize(.large)

                // The handoff people actually need: scan here, design on a
                // laptop. A deep link cannot cross that gap and a whole house
                // does not fit in a URL, so the scan is uploaded and comes back
                // as six characters to type on the website.
                Button {
                    Task { await sendToWeb() }
                } label: {
                    Label(
                        sending ? "Sending…" : "Send to MOZU web",
                        systemImage: "arrow.up.forward.app"
                    )
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .disabled(sending)

                if let ticket {
                    handoffTicket(ticket)
                }
                if let sendError {
                    Text(sendError)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                if let url = Handoff.url(webBase: webBase, scan: scan) {
                    Link(destination: url) {
                        Label("Open in MOZU on this iPad", systemImage: "safari")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                }

                HStack(spacing: 10) {
                    ShareLink(
                        item: Handoff.prettyJSON(scan),
                        preview: SharePreview("MOZU room scan")
                    ) {
                        Label("Share scan", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)

                    Button(action: onRescan) {
                        Label("Rescan", systemImage: "arrow.clockwise").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }

                TextField("MOZU web address", text: $webBase)
                    .textFieldStyle(.roundedBorder)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.footnote)
            }
            .padding(16)
        }
        .fullScreenCover(isPresented: $showDesign) {
            DesignContainerView(scan: scan)
        }
    }

    // MARK: Web handoff

    private func sendToWeb() async {
        sending = true
        sendError = nil
        defer { sending = false }
        do {
            ticket = try await ScanHandoff.send(scan, webBase: webBase)
        } catch {
            ticket = nil
            sendError = error.localizedDescription
        }
    }

    /// The code, big enough to read across a room and to photograph.
    @ViewBuilder
    private func handoffTicket(_ ticket: ScanHandoff.Ticket) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Open MOZU on your computer and enter")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(ticket.code)
                .font(.system(size: 40, weight: .bold, design: .monospaced))
                .kerning(6)
                .textSelection(.enabled)
            Text(ticket.url)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
    }

    private var stats: some View {
        HStack(spacing: 8) {
            stat("Area", Units.area(floorplan.areaMm2, scan.unitSystem))
            stat("Perimeter", Units.length(floorplan.perimeterMm, scan.unitSystem))
            stat("Ceiling", Units.length(floorplan.height, scan.unitSystem))
            stat("Walls", "\(floorplan.walls.count)")
            if !floorplan.openings.isEmpty { stat("Openings", "\(floorplan.openings.count)") }
            stat("Sockets", "\(socketCount)")
        }
    }

    // MARK: Manual sockets

    /// How close a touch must land to count as grabbing an existing socket (mm).
    private static let hitRadiusMm = 320.0
    /// A tap further than this from any wall is not placing anything.
    private static let wallReachMm = 900.0
    /// Where a hand-placed socket sits by default — standard above-worktop height.
    static let defaultSocketHeightMm = 1100.0
    /// A gesture that moved less than this is a tap, not a drag.
    private static let tapSlopMm = 120.0
    /// Common mounting heights, so the usual case is one tap rather than a
    /// slider hunt. Values are the norms MOZU quotes kitchens against.
    struct HeightPreset: Identifiable {
        let name: String
        let mm: Double
        var id: String { name }
    }
    private static let heightPresets = [
        HeightPreset(name: "Skirting", mm: 300),
        HeightPreset(name: "Worktop", mm: 1100),
        HeightPreset(name: "Switch", mm: 1350),
    ]

    /// One gesture on the plan, from touch-down to lift.
    ///
    /// Touch-down decides what the gesture MEANS: land on a socket and you are
    /// dragging it; land anywhere else and a lift in the same spot drops a new
    /// socket on the nearest wall. Nothing is destroyed by a stray tap — removal
    /// is an explicit button in the inspector.
    private func handleEdit(_ phase: FloorplanCanvas.EditPhase, from start: Vec2, to current: Vec2) {
        switch phase {
        case .changed:
            if !dragClaimed {
                dragClaimed = true
                draggingSocket = fixtureIndex(near: start)
                if let i = draggingSocket { selectedSocket = i }
            }
            // Follow the finger only once it has genuinely set off; otherwise a
            // tap to select would re-place the socket it was selecting.
            if Geo.distance(start, current) > Self.tapSlopMm {
                moveSocket(draggingSocket, to: current)
            }

        case .ended:
            defer { dragClaimed = false; draggingSocket = nil }
            if !dragClaimed {
                // No `.changed` arrived at all — treat it as a plain tap.
                dragClaimed = true
                draggingSocket = fixtureIndex(near: start)
            }
            let moved = Geo.distance(start, current) > Self.tapSlopMm
            if let i = draggingSocket {
                // A tap on a socket only selects it. Rewriting its position (and
                // its provenance) because a finger wobbled would be worse than
                // useless — it would quietly relabel a measured socket as
                // hand-placed.
                if moved { moveSocket(i, to: current) }
                selectedSocket = i
            } else if !moved {
                addSocket(at: current)
            }
        }
    }

    /// Slide a socket onto whichever wall is now nearest the finger. Re-anchoring
    /// to a different wall mid-drag is deliberate: dragging "around the room"
    /// past a corner is the natural gesture, and the fixture stores {wall,
    /// offset}, so the wall has to change with it.
    private func moveSocket(_ index: Int?, to point: Vec2) {
        guard let i = index, scan.fixtures.indices.contains(i),
              let anchor = wallAnchor(for: point) else { return }
        scan.fixtures[i].wall = anchor.wall
        scan.fixtures[i].offset = anchor.offset
        // Moved by hand, so it is no longer what the detector measured.
        scan.fixtures[i].source = .manual
        scan.fixtures[i].confidence = 1
    }

    private func addSocket(at point: Vec2) {
        guard let placed = wallAnchor(for: point) else {
            selectedSocket = nil   // tap on open floor clears the selection
            return
        }
        scan.fixtures.append(ScanFixture(
            type: .socket,
            wall: placed.wall,
            offset: placed.offset,
            height: newSocketHeight,
            source: .manual,
            confidence: 1
        ))
        selectedSocket = scan.fixtures.count - 1
    }

    /// The scan-index of the socket nearest a point, within grabbing distance.
    private func fixtureIndex(near point: Vec2) -> Int? {
        floorplan.fixtures
            .map { ($0.id, Geo.distance($0.point, point)) }
            .filter { $0.1 <= Self.hitRadiusMm }
            .min { $0.1 < $1.1 }?.0
    }

    // MARK: Inspector

    @ViewBuilder
    private var socketInspector: some View {
        if let i = selectedSocket, scan.fixtures.indices.contains(i) {
            let fixture = scan.fixtures[i]
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Label("Socket on wall \(fixture.wall + 1)", systemImage: "bolt.fill")
                        .font(.subheadline.weight(.semibold))
                    Spacer()
                    Text(Units.length(fixture.height, scan.unitSystem))
                        .font(.subheadline.weight(.semibold))
                        .monospacedDigit()
                }

                HStack(spacing: 10) {
                    Image(systemName: "arrow.up.and.down")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Slider(
                        value: heightBinding(i),
                        in: 0...max(scan.height, 2000),
                        step: 10
                    )
                }

                HStack(spacing: 8) {
                    ForEach(Self.heightPresets) { preset in
                        Button(preset.name) { setHeight(preset.mm, at: i) }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                            .tint(abs(fixture.height - preset.mm) < 1 ? .accentColor : .secondary)
                    }
                    Spacer()
                    Button(role: .destructive) {
                        scan.fixtures.remove(at: i)
                        selectedSocket = nil
                    } label: {
                        Label("Remove", systemImage: "trash")
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
            }
            .padding(12)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
        } else {
            Text("Tap a socket to set its height, or tap a wall to add one.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 4)
        }
    }

    /// Height of one socket, which also becomes the default for the next one
    /// placed — a run of sockets is normally all at the same height.
    private func heightBinding(_ index: Int) -> Binding<Double> {
        Binding(
            get: { scan.fixtures.indices.contains(index) ? scan.fixtures[index].height : 0 },
            set: { setHeight($0, at: index) }
        )
    }

    private func setHeight(_ mm: Double, at index: Int) {
        guard scan.fixtures.indices.contains(index) else { return }
        scan.fixtures[index].height = mm
        newSocketHeight = mm
    }

    /// Nearest edge of the SCAN polygon (the frame fixtures are stored in), with
    /// how far along it the tap landed.
    private func wallAnchor(for point: Vec2) -> (wall: Int, offset: Double)? {
        let polygon = scan.polygon
        guard polygon.count >= 3 else { return nil }
        var best: (wall: Int, offset: Double, distance: Double)?
        for i in 0..<polygon.count {
            let a = polygon[i], b = polygon[(i + 1) % polygon.count]
            let hit = Geo.project(point, onto: a, b)
            if best == nil || hit.distance < best!.distance {
                best = (i, hit.offset, hit.distance)
            }
        }
        guard let found = best, found.distance <= Self.wallReachMm else { return nil }
        return (found.wall, found.offset)
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.subheadline.weight(.semibold)).monospacedDigit()
            Text(label.uppercased()).font(.system(size: 9)).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 8))
    }
}
