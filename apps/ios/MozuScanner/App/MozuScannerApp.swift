// MOZU Room Scanner — iOS app entry point.
//
// Apple RoomPlan scan → dimensioned floorplan → hand off to the MOZU web app.
// Requires iOS 17+ and a LiDAR device. See ../README.md for the Xcode setup.

import SwiftUI

@main
struct MozuScannerApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
