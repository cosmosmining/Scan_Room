// Client for MOZU LIVE — the Mac-side EEVEE pixel-streaming engine
// (scripts/ios/blender_stream_server.py). Opens a raw TCP connection to the Mac,
// pushes the current design once, then streams: send the latest camera pose → the
// Mac renders a near-photoreal EEVEE frame → we display it → send the next pose.
// That lockstep loop is what lets you WALK the rendered space in real time on iPad.
//
// WIRE PROTOCOL (matches the server): every message is [4-byte big-endian length]
// + JSON; every reply is [4-byte big-endian length] + JPEG.
//
// Threading: all socket work runs on a serial `queue`; only the published `frame`
// and `state` are hopped to the main queue for SwiftUI. (Not `@MainActor` — the
// NWConnection receive callbacks are delivered on `queue`, and buffer parsing must
// stay there.)

import Foundation
import Network
import UIKit

// MARK: - Wire messages

private struct SceneMessage: Encodable {
    let t = "scene"
    let design: RenderRequest
    let cam: PoseMessage
}

struct PoseMessage: Encodable {
    var t = "pose"
    var pos: [Float]
    var target: [Float]
    var fov: Float
    var w: Int
    var h: Int
}

// MARK: - Client

final class LiveStreamClient: ObservableObject {

    enum Status: Equatable {
        case idle, connecting, streaming, failed(String)
    }

    @Published private(set) var status: Status = .idle
    @Published private(set) var frame: UIImage?
    /// Rolling frames-per-second, for the on-screen HUD.
    @Published private(set) var fps: Double = 0

    private var connection: NWConnection?
    private let queue = DispatchQueue(label: "com.mozu.live", qos: .userInteractive)

    // All of the following are touched only on `queue`.
    private var rxBuffer = Data()
    private var expecting = 0
    private var latestPose: PoseMessage?
    private var awaitingFrame = false
    private var lastFrameTime = CFAbsoluteTimeGetCurrent()

    // MARK: Connect / disconnect

    /// Connect to the Mac engine and start streaming the `design` from `pose`.
    func connect(host: String, port: UInt16, design: RenderRequest, pose: PoseMessage) {
        setStatus(.connecting)
        let conn = NWConnection(host: NWEndpoint.Host(host),
                                port: NWEndpoint.Port(rawValue: port) ?? 8080,
                                using: .tcp)
        connection = conn
        conn.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                self.queue.async {
                    self.latestPose = pose
                    self.awaitingFrame = true
                    self.sendJSON(SceneMessage(design: design, cam: pose))  // push scene → first frame
                    self.receiveLoop()
                }
                self.setStatus(.streaming)
            case .failed(let error):
                self.setStatus(.failed(error.localizedDescription))
            case .cancelled:
                self.setStatus(.idle)
            default:
                break
            }
        }
        conn.start(queue: queue)
    }

    func disconnect() {
        connection?.cancel()
        connection = nil
        setStatus(.idle)
    }

    // MARK: Camera input (called from the UI, any thread)

    /// Update the camera the next frame will be rendered from. Cheap; the streaming
    /// loop always renders the most recent pose, so fast camera motion never queues.
    func updatePose(_ pose: PoseMessage) {
        queue.async {
            self.latestPose = pose
            // If the loop is idle (waiting for input), kick it.
            if !self.awaitingFrame, self.connection != nil {
                self.awaitingFrame = true
                self.sendJSON(pose)
            }
        }
    }

    // MARK: Send

    private func sendJSON<T: Encodable>(_ message: T) {
        guard let json = try? JSONEncoder().encode(message) else { return }
        var length = UInt32(json.count).bigEndian
        var packet = Data(bytes: &length, count: 4)
        packet.append(json)
        connection?.send(content: packet, completion: .contentProcessed { _ in })
    }

    // MARK: Receive

    private func receiveLoop() {
        connection?.receive(minimumIncompleteLength: 1, maximumLength: 262_144) { [weak self] data, _, isDone, error in
            guard let self else { return }
            if let data, !data.isEmpty { self.ingest(data) }
            if let error { self.setStatus(.failed(error.localizedDescription)); return }
            if isDone { self.setStatus(.idle); return }
            self.receiveLoop()
        }
    }

    /// Parse as many complete [length][JPEG] frames as the buffer holds; publish each
    /// and, once a frame lands, send the newest pose so the stream keeps flowing.
    private func ingest(_ data: Data) {
        rxBuffer.append(data)
        while true {
            if expecting == 0 {
                guard rxBuffer.count >= 4 else { return }
                let n = rxBuffer.prefix(4).reduce(0) { ($0 << 8) | Int($1) }   // big-endian
                rxBuffer.removeFirst(4)
                guard n > 0, n < 32_000_000 else { rxBuffer.removeAll(); expecting = 0; return }
                expecting = n
            }
            guard rxBuffer.count >= expecting else { return }
            let jpeg = rxBuffer.prefix(expecting)
            rxBuffer.removeFirst(expecting)
            expecting = 0

            if let image = UIImage(data: jpeg) {
                let now = CFAbsoluteTimeGetCurrent()
                let dt = now - lastFrameTime
                lastFrameTime = now
                DispatchQueue.main.async {
                    self.frame = image
                    if dt > 0 { self.fps = self.fps * 0.8 + (1.0 / dt) * 0.2 }
                }
            }
            // Request the next frame from the freshest pose.
            if let pose = latestPose {
                awaitingFrame = true
                sendJSON(pose)
            } else {
                awaitingFrame = false
            }
        }
    }

    // MARK: Helpers

    private func setStatus(_ s: Status) {
        DispatchQueue.main.async { self.status = s }
    }
}
