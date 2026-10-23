// The `RoomScan` contract — the Swift mirror of @mozu/scan-sdk's `mozu.roomscan/1`.
// A scan serializes to the exact same JSON the web app and extensions speak, so
// the iOS RoomPlan scan drops straight into the MOZU configurator via /scan.
//
// Units: millimetres. Floor plane is X (right) / Z (forward); Y is up.

import Foundation

/// A point on the top-down floor plane (millimetres).
struct Vec2: Codable, Hashable {
    var x: Double
    var z: Double
}

enum ScanSource: String, Codable {
    case roomplan, webxr, camera, manual
}

/// A door / window / opening detected on a wall.
struct ScanOpening: Codable, Equatable {
    enum Kind: String, Codable { case door, window, archway }
    var type: Kind
    /// Index of the wall (edge i → i+1) this opening sits on.
    var wall: Int
    /// Distance from the wall's start vertex to the opening's LEADING edge
    /// (millimetres) — the opening spans [offset, offset + width]. This matches
    /// @mozu/scan-sdk exactly; emitting the centre here shifts everything by
    /// half a width on the web side.
    var offset: Double
    var width: Double
    var height: Double
    /// Bottom of the opening above the floor (0 for doors).
    var sill: Double?
}

/// A detected object (furniture / appliance) from the scan.
struct ScanObject: Codable, Equatable {
    var category: String
    var center: Vec2
    var width: Double
    var depth: Double
    /// Y rotation, radians.
    var rotation: Double
    /// Height (millimetres), when RoomPlan reports it — drives the box massing.
    var height: Double? = nil
}

/// A mechanical/electrical/plumbing point found on a wall — a socket, a switch,
/// or exposed pipework. Mirrors `ScanFixture` in @mozu/scan-sdk, so a fixture
/// detected on the iPad arrives in the web configurator unchanged.
struct ScanFixture: Codable, Equatable {
    enum Kind: String, Codable { case socket, `switch`, water, waste, gas, vent, radiator }
    /// How it got onto the plan. Detection is the default path; `manual` is the
    /// optional correction.
    enum Source: String, Codable { case detected, manual }

    var type: Kind
    /// Index of the wall (edge i → i+1) this fixture sits on.
    var wall: Int
    /// Distance along the wall from its start vertex (millimetres).
    var offset: Double
    /// Height of the fixture centre above the floor (millimetres).
    var height: Double
    var source: Source
    /// Detector confidence 0…1 (1 for a user-asserted fixture).
    var confidence: Double
    /// Measured outside diameter for pipework (millimetres), when sized.
    var diameterMm: Double? = nil
}

/// The normalized capture, identical in shape to the SDK's `RoomScan`.
struct RoomScan: Codable, Equatable {
    var schema: String = "mozu.roomscan/1"
    /// Ordered, closed floor polygon (millimetres). 3+ vertices.
    var polygon: [Vec2]
    /// Ceiling height (millimetres).
    var height: Double
    var openings: [ScanOpening]
    var objects: [ScanObject]
    /// Sockets and pipework found on the walls during this scan.
    var fixtures: [ScanFixture]
    var source: ScanSource
    var unitSystem: String
    var confidence: Double
    var capturedAt: String

    init(
        polygon: [Vec2],
        height: Double,
        openings: [ScanOpening] = [],
        objects: [ScanObject] = [],
        fixtures: [ScanFixture] = [],
        source: ScanSource = .roomplan,
        unitSystem: String = "metric",
        confidence: Double = 0.92,
        capturedAt: String = ISO8601DateFormatter().string(from: Date())
    ) {
        self.polygon = polygon
        self.height = height
        self.openings = openings
        self.objects = objects
        self.fixtures = fixtures
        self.source = source
        self.unitSystem = unitSystem
        self.confidence = confidence
        self.capturedAt = capturedAt
    }

    /// Compact JSON (matches `serializeScan` in the SDK).
    func jsonData() -> Data? {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        return try? encoder.encode(self)
    }
}
