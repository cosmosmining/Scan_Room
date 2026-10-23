// Tap a socket on screen and pin it to the wall.
//
// The detector is good but it is not you. When it misses one, or marks one that
// is not there, pointing at the thing is faster and more certain than any
// threshold — so this turns a finger on the camera view into a measured world
// position on a real wall, using the same depth geometry the automatic path is
// verified against.
//
// The hard part is not the ray. It is the coordinate space of the tap.
//
// A tap arrives in VIEW points. The camera image is landscape sensor space, the
// screen usually is not, and the feed is drawn aspect-filled, so the two differ
// by a rotation, a scale and a crop. Apple's `displayTransform(for:viewportSize:)`
// describes exactly that relationship — but its DIRECTION is famously ambiguous
// in practice, and a mapping applied the wrong way round still produces a
// perfectly plausible point somewhere else on the wall. That class of bug is
// invisible in code review and obvious only on site, which is the worst place
// to find it.
//
// So this does not trust either direction. It computes the world point BOTH
// ways, projects each answer back to the screen with ARKit's own camera model,
// and keeps whichever one lands back under the finger. The round trip is two
// matrix multiplications and it settles the question at runtime, on the device,
// every time.

import ARKit
import CoreGraphics
import Foundation
import simd
import UIKit

enum TapToPlace {

    /// How near the round trip must land to the original tap to be believed.
    /// Generous: this is separating "correct" from "rotated ninety degrees",
    /// not measuring precision.
    static let roundTripTolerance: CGFloat = 60

    /// Widest a tapped surface can be off vertical and still be a wall.
    static let maxVerticalComponent = 0.5

    /// A placement the user made by pointing at it.
    struct Placement {
        /// World position on the wall (ARKit metres).
        var world: SIMD3<Double>
        /// Wall normal, pointing into the room.
        var normal: SIMD3<Double>
        /// Distance from the camera (metres).
        var rangeM: Double
        /// True when the depth map settled it; false when ARKit's plane raycast
        /// had to. Surfaced so the UI can say how sure it is.
        var fromDepth: Bool
    }

    /// Turn a tap into a point on a wall.
    ///
    /// - Parameters:
    ///   - point: tap location in VIEW coordinates (points).
    ///   - viewportSize: the size of the view that was tapped.
    ///   - orientation: current interface orientation.
    ///   - frame: the live ARFrame.
    ///   - session: the running session, for the plane-raycast fallback.
    static func place(
        at point: CGPoint,
        viewportSize: CGSize,
        orientation: UIInterfaceOrientation,
        frame: ARFrame,
        session: ARSession
    ) -> Placement? {
        guard viewportSize.width > 1, viewportSize.height > 1 else { return nil }

        // Which way round is the display transform? Ask, don't assume.
        guard let imagePoint = normalisedImagePoint(
            for: point, viewportSize: viewportSize, orientation: orientation, frame: frame
        ) else { return nil }

        // Preferred: the depth map. It gives a measured distance and, with the
        // surrounding plane fit, a real wall normal — the same machinery the
        // automatic detections are placed with, so both agree by construction.
        if let depthData = DepthGate.depthData(for: frame),
           let depth = DepthGate.snapshot(depthData),
           let surface = DepthGate.surface(
               atNormalised: imagePoint,
               depth: depth,
               intrinsics: frame.camera.intrinsics,
               imageSize: (
                   width: CVPixelBufferGetWidth(frame.capturedImage),
                   height: CVPixelBufferGetHeight(frame.capturedImage)
               ),
               cameraTransform: frame.camera.transform
           ),
           abs(surface.normal.y) <= maxVerticalComponent,
           // The fit already measured how flat the surface is; ignoring that
           // would accept a probe straddling a door reveal or a cabinet edge,
           // whose plane is tilted enough to put the socket a hand's width off
           // the wall — far enough that the finished plan silently drops it.
           surface.flatnessMm <= DepthGate.maxFlatnessMm {
            return Placement(
                world: surface.world, normal: surface.normal,
                rangeM: surface.rangeM, fromDepth: true
            )
        }

        // Fallback: ARKit's own raycast against the vertical planes it has
        // found. Less precise than depth on a bare wall, but it is the right
        // answer when depth is missing or full of holes.
        let query = frame.raycastQuery(
            from: imagePoint, allowing: .estimatedPlane, alignment: .vertical
        )
        guard let hit = session.raycast(query).first else { return nil }
        let t = hit.worldTransform
        let world = SIMD3<Double>(
            Double(t.columns.3.x), Double(t.columns.3.y), Double(t.columns.3.z)
        )
        // A vertical-plane raycast result has its Y axis along the plane's
        // normal; point it back towards the camera.
        var normal = SIMD3<Double>(
            Double(t.columns.1.x), Double(t.columns.1.y), Double(t.columns.1.z)
        )
        let eye = SIMD3<Double>(
            Double(frame.camera.transform.columns.3.x),
            Double(frame.camera.transform.columns.3.y),
            Double(frame.camera.transform.columns.3.z)
        )
        if simd_dot(normal, eye - world) < 0 { normal = -normal }
        guard abs(normal.y) <= maxVerticalComponent else { return nil }

        return Placement(
            world: world,
            normal: simd_normalize(normal),
            rangeM: simd_distance(world, eye),
            fromDepth: false
        )
    }

    // MARK: View point → normalised image point

    /// Convert a tap in view coordinates to normalised image coordinates,
    /// determining the transform's direction empirically.
    ///
    /// Both candidate mappings are unprojected to a world point at a plausible
    /// distance and projected back with `ARCamera.projectPoint`, which is the
    /// one screen-space mapping in ARKit with no ambiguity. Whichever candidate
    /// returns to the finger is the right one. If neither does, we decline
    /// rather than place a socket somewhere the user did not point.
    static func normalisedImagePoint(
        for point: CGPoint,
        viewportSize: CGSize,
        orientation: UIInterfaceOrientation,
        frame: ARFrame
    ) -> CGPoint? {
        let normalisedView = CGPoint(
            x: point.x / viewportSize.width,
            y: point.y / viewportSize.height
        )
        let display = frame.displayTransform(for: orientation, viewportSize: viewportSize)
        let candidates = [
            normalisedView.applying(display.inverted()),
            normalisedView.applying(display),
        ]

        var best: (point: CGPoint, error: CGFloat)?
        for candidate in candidates {
            guard candidate.x.isFinite, candidate.y.isFinite else { continue }
            guard let back = roundTrip(
                candidate, viewportSize: viewportSize, orientation: orientation, frame: frame
            ) else { continue }
            let error = hypot(back.x - point.x, back.y - point.y)
            if best == nil || error < best!.error { best = (candidate, error) }
        }
        guard let winner = best, winner.error <= roundTripTolerance else { return nil }
        return winner.point
    }

    /// Unproject a normalised image point to a world point 2m out, then project
    /// it back to the screen. A correct mapping returns to where it started.
    private static func roundTrip(
        _ imagePoint: CGPoint,
        viewportSize: CGSize,
        orientation: UIInterfaceOrientation,
        frame: ARFrame
    ) -> CGPoint? {
        let intrinsics = frame.camera.intrinsics
        let fx = Double(intrinsics.columns.0.x)
        let fy = Double(intrinsics.columns.1.y)
        let cx = Double(intrinsics.columns.2.x)
        let cy = Double(intrinsics.columns.2.y)
        guard fx > 1, fy > 1 else { return nil }

        let size = frame.camera.imageResolution
        let u = Double(imagePoint.x) * Double(size.width)
        let v = Double(imagePoint.y) * Double(size.height)
        let probeDistance = 2.0
        let camera = SIMD3<Double>(
            (u - cx) / fx * probeDistance,
            -(v - cy) / fy * probeDistance,
            -probeDistance
        )
        let t = frame.camera.transform
        let rotation = simd_double3x3(
            SIMD3<Double>(Double(t.columns.0.x), Double(t.columns.0.y), Double(t.columns.0.z)),
            SIMD3<Double>(Double(t.columns.1.x), Double(t.columns.1.y), Double(t.columns.1.z)),
            SIMD3<Double>(Double(t.columns.2.x), Double(t.columns.2.y), Double(t.columns.2.z))
        )
        let world = rotation * camera + SIMD3<Double>(
            Double(t.columns.3.x), Double(t.columns.3.y), Double(t.columns.3.z)
        )
        let screen = frame.camera.projectPoint(
            SIMD3<Float>(Float(world.x), Float(world.y), Float(world.z)),
            orientation: orientation,
            viewportSize: viewportSize
        )
        guard screen.x.isFinite, screen.y.isFinite else { return nil }
        return screen
    }
}
