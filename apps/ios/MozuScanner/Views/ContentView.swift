// App flow, mirroring the product's two steps: "1 Scan" (RoomPlan) → "2
// Floorplan" (auto-generated plan + hand-off). RoomPlan needs a LiDAR device;
// unsupported devices get a clear message.

import RoomPlan
import SwiftUI

struct ContentView: View {
    @StateObject private var controller = RoomCaptureController()

    var body: some View {
        NavigationStack {
            Group {
                if !RoomCaptureSession.isSupported {
                    UnsupportedView()
                } else {
                    switch controller.phase {
                    case .done(let scans) where scans.count == 1:
                        FloorplanResultView(scan: scans[0]) { controller.reset() }
                    case .done(let scans) where scans.count > 1:
                        HouseResultView(scans: scans) { controller.reset() }
                    case .done:
                        // Zero rooms captured (shouldn't happen) — back to scanning.
                        ScanView(controller: controller)
                    case .failed(let message):
                        FailureView(message: message) { controller.reset() }
                    default:
                        ScanView(controller: controller)
                    }
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private var title: String {
        switch controller.phase {
        case .done: return "2 · Floorplan"
        default: return "1 · Scan"
        }
    }
}

private struct UnsupportedView: View {
    var body: some View {
        ContentUnavailableView(
            "LiDAR required",
            systemImage: "ruler",
            description: Text("RoomPlan needs a LiDAR device (iPhone Pro / iPad Pro). Use the MOZU web app's camera or AR measure on other devices.")
        )
    }
}

private struct FailureView: View {
    let message: String
    var onRetry: () -> Void
    var body: some View {
        ContentUnavailableView {
            Label("Scan failed", systemImage: "exclamationmark.triangle")
        } description: {
            Text(message)
        } actions: {
            Button("Try again", action: onRetry).buttonStyle(.borderedProminent)
        }
    }
}
