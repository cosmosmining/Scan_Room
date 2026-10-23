// MOZU — Apple RoomPlan companion (iOS 17+, LiDAR device required)
//
// A minimal SwiftUI app: scan the room with RoomPlan, then hand the measured
// dimensions to the MOZU web app via /scan?w=&d=&h=.
//
// Build in Xcode:
//   1. New iOS App (SwiftUI). Replace ContentView with this file's contents.
//   2. Info.plist → add "Privacy - Camera Usage Description".
//   3. Deployment target iOS 17+. Run on a LiDAR device (iPhone 12 Pro+/iPad Pro).
//   4. Set WEB_BASE below to your MOZU host (Vercel URL, tunnel, or LAN IP).

import RoomPlan
import SwiftUI
import simd

let WEB_BASE = "https://your-mozu-host" // ← set this

struct ContentView: View {
    @StateObject private var model = ScanModel()

    var body: some View {
        ZStack(alignment: .bottom) {
            RoomCaptureViewRep(model: model).ignoresSafeArea()
            VStack(spacing: 12) {
                if let dims = model.result {
                    Text(String(format: "≈ %.0f × %.0f × %.0f mm", dims.w, dims.d, dims.h))
                        .font(.headline).foregroundStyle(.white)
                    Button("Open in MOZU") { model.handOff() }
                        .buttonStyle(.borderedProminent)
                } else {
                    Button(model.scanning ? "Finish scan" : "Start scan") {
                        model.scanning ? model.stop() : model.start()
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
            .padding(24)
        }
    }
}

final class ScanModel: ObservableObject, RoomCaptureSessionDelegate {
    @Published var scanning = false
    @Published var result: (w: Float, d: Float, h: Float)?

    let captureView = RoomCaptureView(frame: .zero)
    private var builder = RoomBuilder(options: [.beautifyObjects])

    init() { captureView.captureSession.delegate = self }

    func start() {
        result = nil
        scanning = true
        captureView.captureSession.run(configuration: RoomCaptureSession.Configuration())
    }

    func stop() {
        scanning = false
        captureView.captureSession.stop()
    }

    // Called when the session finishes processing raw scan data.
    func captureSession(_ session: RoomCaptureSession, didEndWith data: CapturedRoomData, error: Error?) {
        Task { @MainActor in
            guard let room = try? await builder.capturedRoom(from: data) else { return }
            result = Self.dimensions(of: room)
        }
    }

    func handOff() {
        guard let d = result,
              let url = URL(string: "\(WEB_BASE)/scan?w=\(Int(d.w))&d=\(Int(d.d))&h=\(Int(d.h))")
        else { return }
        UIApplication.shared.open(url)
    }

    /// Bounding dimensions (mm) of the room from its wall surfaces.
    static func dimensions(of room: CapturedRoom) -> (w: Float, d: Float, h: Float) {
        var minX = Float.greatestFiniteMagnitude, maxX = -Float.greatestFiniteMagnitude
        var minZ = Float.greatestFiniteMagnitude, maxZ = -Float.greatestFiniteMagnitude
        var height: Float = 0

        for wall in room.walls {
            let t = wall.transform
            let center = SIMD3(t.columns.3.x, t.columns.3.y, t.columns.3.z)
            let axisX = SIMD3(t.columns.0.x, t.columns.0.y, t.columns.0.z) // wall's length axis
            let half = wall.dimensions.x / 2
            for end in [center + axisX * half, center - axisX * half] {
                minX = min(minX, end.x); maxX = max(maxX, end.x)
                minZ = min(minZ, end.z); maxZ = max(maxZ, end.z)
            }
            height = max(height, wall.dimensions.y)
        }

        let mm: (Float) -> Float = { $0 * 1000 }
        return (mm(maxX - minX), mm(maxZ - minZ), mm(height == 0 ? 2.7 : height))
    }
}

struct RoomCaptureViewRep: UIViewRepresentable {
    let model: ScanModel
    func makeUIView(context: Context) -> RoomCaptureView { model.captureView }
    func updateUIView(_ uiView: RoomCaptureView, context: Context) {}
}
