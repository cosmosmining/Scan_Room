// Client for the MOZU photoreal render server (server/render-server.mjs).
//
// Turns the live `DesignState` (the scanned room + placed furniture) plus the
// current camera into a `mozu.render/1` request, POSTs it to the user's render
// server, and returns the path-traced PNG as a `UIImage`. The server runs Blender
// Cycles (scripts/ios/blender_render_design.py) on that exact design.
//
// Coordinates are sent in the iOS design space (metres; floor plane X/Z, Y up);
// the Blender worker converts to its own Z-up space. Finishes are resolved here to
// raw rgba + texture name + roughness/metalness so the server needs no swatch table.

import Foundation
import UIKit
import simd

// MARK: - Request payload (mirrors blender_render_design.py's mozu.render/1)

struct RenderRequest: Encodable {
    struct Finish: Encodable {
        let rgba: [Float]
        let texture: String?
        let rough: Float
        let metal: Float
        let tile: Float
    }
    struct Opening: Encodable {
        let wall: Int              // footprint edge index
        let kind: String           // "door" | "window" | "archway"
        let offset: Float          // metres from the wall start to the opening CENTRE
        let width: Float
        let height: Float
        let sill: Float
    }
    struct Room: Encodable {
        let footprint: [[Float]]   // [[x, z], …] metres
        let height: Float
        let wall: Finish
        let floor: Finish
        let ceiling: Finish
        let openings: [Opening]
    }
    /// A context room shell (whole-house mode): geometry only, default finishes.
    struct Shell: Encodable {
        let footprint: [[Float]]
        let height: Float
        let openings: [Opening]
    }
    struct Item: Encodable {
        let model: String?         // USDZ resource name, or nil for a box
        let x: Float
        let z: Float
        let rotationY: Float
        let size: [Float]          // [w, h, d] metres
        let finish: Finish?        // nil = keep the model's authored materials
    }
    struct Camera: Encodable {
        let pos: [Float]
        let target: [Float]
        let fovDeg: Float
    }
    struct Render: Encodable {
        let width: Int
        let height: Int
        let samples: Int
    }

    let schema = "mozu.render/1"
    let room: Room
    let extraRooms: [Shell]
    let items: [Item]
    let camera: Camera
    let render: Render
}

// MARK: - Quality presets

enum RenderQuality {
    case preview   // fast, for a quick look
    case final     // slower, hero-shot quality

    var dimensions: (Int, Int) { self == .final ? (1920, 1200) : (1100, 700) }
    var samples: Int { self == .final ? 400 : 96 }
}

// MARK: - Renderer

enum PhotorealRenderer {

    /// A Final render (400 samples) can path-trace for ~12 min on the server before it
    /// sends a single byte back, so the session must tolerate long, quiet waits.
    /// `URLSession.shared` can't be reconfigured, so use a dedicated session whose
    /// per-request and whole-resource timeouts comfortably exceed a long final render.
    private static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 1800    // 30 min of silence before giving up
        config.timeoutIntervalForResource = 3600   // 1 h hard cap for the whole render
        return URLSession(configuration: config)
    }()

    enum RenderError: LocalizedError {
        case noServer
        case badURL
        case badResponse
        case server(String)
        case decode

        var errorDescription: String? {
            switch self {
            case .noServer:   return "No render server set. Enter your server's address below."
            case .badURL:     return "That render-server address isn't a valid URL."
            case .badResponse: return "The render server gave an unexpected response."
            case .server(let msg): return msg
            case .decode:     return "The render server didn't return a valid image."
            }
        }
    }

    /// Render `state` from `camera` on the server at `serverURLString`, returning the
    /// path-traced image.
    static func render(state: DesignState,
                       camera: CameraPose,
                       serverURLString: String,
                       quality: RenderQuality) async throws -> UIImage {
        let trimmed = serverURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw RenderError.noServer }
        guard let base = URL(string: trimmed) else { throw RenderError.badURL }

        let payload = await buildRequest(state: state, camera: camera, quality: quality)

        var request = URLRequest(url: base.appendingPathComponent("render"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 1800   // 30 min: no data arrives until the render finishes
        request.httpBody = try JSONEncoder().encode(payload)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw RenderError.badResponse }
        guard http.statusCode == 200 else {
            let body = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let msg = (body?.isEmpty == false) ? body! : "Render server error \(http.statusCode)."
            throw RenderError.server(msg)
        }
        guard let image = UIImage(data: data) else { throw RenderError.decode }
        return image
    }

    // MARK: Request building

    /// Build the wire payload for a design. Also used by LIVE mode
    /// (`LiveStreamClient`) to hand the Mac engine the room+furniture once.
    @MainActor
    static func buildRequest(state: DesignState,
                             camera: CameraPose,
                             quality: RenderQuality) -> RenderRequest {
        let room = state.room
        let swatches = state.swatches

        let footprint = room.footprint.map { [$0.x, $0.y] }   // SIMD2 .x=X, .y=Z

        let items: [RenderRequest.Item] = state.items.map { placed in
            let item = state.item(for: placed)
            let size = item?.size ?? SIMD3<Float>(0.5, 0.5, 0.5)
            let finish = placed.finish.map { finishPayload(from: $0, swatches: swatches) }
            return RenderRequest.Item(
                model: item?.usdzName,
                x: placed.position.x,
                z: placed.position.z,
                rotationY: placed.rotationY,
                size: [size.x, size.y, size.z],
                finish: finish
            )
        }

        let (w, h) = quality.dimensions
        return RenderRequest(
            room: RenderRequest.Room(
                footprint: footprint,
                height: room.height,
                wall: finishPayload(from: room.wallFinish, swatches: swatches),
                floor: finishPayload(from: room.floorFinish, swatches: swatches),
                ceiling: finishPayload(from: room.ceilingFinish, swatches: swatches),
                openings: openingPayloads(room.openings)
            ),
            extraRooms: state.extraRooms.map { extra in
                RenderRequest.Shell(
                    footprint: extra.footprint.map { [$0.x, $0.y] },
                    height: extra.height,
                    openings: openingPayloads(extra.openings)
                )
            },
            items: items,
            camera: RenderRequest.Camera(
                pos: [camera.pos.x, camera.pos.y, camera.pos.z],
                target: [camera.target.x, camera.target.y, camera.target.z],
                fovDeg: camera.fovDeg
            ),
            render: RenderRequest.Render(width: w, height: h, samples: quality.samples)
        )
    }

    private static func openingPayloads(_ openings: [DesignOpening]) -> [RenderRequest.Opening] {
        openings.map {
            RenderRequest.Opening(wall: $0.wall, kind: $0.kind, offset: $0.offset,
                                  width: $0.width, height: $0.height, sill: $0.sill)
        }
    }

    /// Resolve a `SurfaceFinish` to raw rgba + texture name + PBR scalars so the
    /// server needs no swatch catalogue. Mirrors `MaterialFactory`'s tint logic.
    private static func finishPayload(from finish: SurfaceFinish, swatches: [Swatch]) -> RenderRequest.Finish {
        let swatch = swatches.first { $0.id == finish.swatchID }
        var rgba = swatch?.rgba ?? SIMD4<Float>(0.8, 0.8, 0.8, 1)
        if let tint = finish.tint {
            rgba = SIMD4<Float>(rgba.x * tint.x, rgba.y * tint.y, rgba.z * tint.z, rgba.w * tint.w)
        }
        let (rough, metal) = finish.kind.pbr
        return RenderRequest.Finish(
            rgba: [rgba.x, rgba.y, rgba.z, rgba.w],
            texture: swatch?.textureName,
            rough: rough,
            metal: metal,
            tile: 1.0
        )
    }
}
