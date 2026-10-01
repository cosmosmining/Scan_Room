// Linux only: Floorplan.swift imports CoreGraphics, which Linux does not have.
// Foundation on Linux already defines CGFloat, CGPoint, CGSize and CGRect, so
// re-exporting it is all the "module" needs to be. Never used on macOS.
@_exported import Foundation
