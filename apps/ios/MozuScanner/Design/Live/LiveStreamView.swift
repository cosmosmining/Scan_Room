// MOZU LIVE mode — walk the room rendered in near-photoreal EEVEE, streamed live
// from the Mac. Displays the incoming frames full-screen; drag to look, thumb
// joystick to move. The camera is integrated locally and pushed to the Mac each
// tick; the Mac renders and streams the frame back.
//
// This is the "rendered-picture quality, real time, on iPad" path: the heavy
// rendering runs on the Mac's GPU and only pixels come over the wire.

import SwiftUI
import simd

struct LiveStreamView: View {
    let state: DesignState
    let startPose: CameraPose

    @Environment(\.dismiss) private var dismiss
    @StateObject private var client = LiveStreamClient()

    /// Mac engine address, e.g. 192.168.1.20:8080 (printed by server/run-live.sh).
    @AppStorage("mozuLiveHost") private var host = ""
    @AppStorage("mozuLivePort") private var portString = "8080"

    // Local first-person camera (metres; X/Z floor, Y up).
    @State private var eye = SIMD3<Float>(0, 1.5, 0)
    @State private var yaw: Float = 0
    @State private var pitch: Float = -0.05
    @State private var move = SIMD2<Float>(0, 0)   // joystick: x = strafe, y = forward
    @State private var connected = false
    @State private var lastTick = Date()

    private let tick = Timer.publish(every: 1.0 / 30.0, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if let frame = client.frame {
                Image(uiImage: frame)
                    .resizable()
                    .scaledToFill()
                    .ignoresSafeArea()
                    .gesture(lookGesture)
            }

            if connected {
                overlay
            } else {
                connectForm
            }
        }
        .onAppear(perform: setup)
        .onDisappear { client.disconnect() }
        .onReceive(tick) { _ in stepAndPush() }
    }

    // MARK: Setup

    private func setup() {
        eye = SIMD3<Float>(state.room.centroid.x, 1.5, state.room.centroid.y)
        yaw = startPose.fovDeg == 0 ? 0 : atan2f(startPose.target.x - startPose.pos.x,
                                                 -(startPose.target.z - startPose.pos.z))
    }

    private func connect() {
        guard let port = UInt16(portString.trimmingCharacters(in: .whitespaces)),
              !host.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        let design = PhotorealRenderer.buildRequest(state: state, camera: startPose, quality: .preview)
        client.connect(host: host.trimmingCharacters(in: .whitespaces), port: port,
                       design: design, pose: pose())
        connected = true
    }

    // MARK: Per-frame

    private func stepAndPush() {
        guard connected else { return }
        let now = Date()
        let dt = Float(min(now.timeIntervalSince(lastTick), 0.05))
        lastTick = now
        if move.x != 0 || move.y != 0 {
            let cp = cos(pitch)
            let fwd = simd_normalize(SIMD2<Float>(-sin(yaw) * cp, -cos(yaw) * cp))
            let right = SIMD2<Float>(-fwd.y, fwd.x)
            let d = (fwd * move.y + right * move.x) * (1.7 * dt)
            eye.x += d.x; eye.z += d.y
        }
        client.updatePose(pose())
    }

    private func pose() -> PoseMessage {
        let cp = cos(pitch)
        let dir = SIMD3<Float>(-sin(yaw) * cp, sin(pitch), -cos(yaw) * cp)
        let t = eye + dir
        return PoseMessage(pos: [eye.x, eye.y, eye.z], target: [t.x, t.y, t.z], fov: 62, w: 960, h: 600)
    }

    // MARK: Gestures / overlays

    private var lookGesture: some Gesture {
        DragGesture()
            .onChanged { v in
                yaw -= Float(v.translation.width) * 0.0008
                pitch = min(1.4, max(-1.4, pitch - Float(v.translation.height) * 0.0008))
            }
    }

    private var overlay: some View {
        VStack {
            HStack {
                Button { dismiss() } label: {
                    Image(systemName: "xmark").font(.system(size: 15, weight: .bold))
                        .frame(width: 38, height: 38).background(.ultraThinMaterial, in: Circle())
                }
                Spacer()
                Text(statusText).font(.caption.monospacedDigit())
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(.ultraThinMaterial, in: Capsule())
            }
            .padding(.horizontal, 16).padding(.top, 12)
            Spacer()
            HStack {
                LiveJoystick { move = $0 }
                Spacer()
            }
            .padding(.leading, 26).padding(.bottom, 34)
        }
        .foregroundStyle(.white)
    }

    private var statusText: String {
        switch client.status {
        case .idle: return "idle"
        case .connecting: return "connecting…"
        case .streaming: return String(format: "LIVE · %.0f fps", client.fps)
        case .failed(let m): return "error: \(m)"
        }
    }

    private var connectForm: some View {
        VStack(spacing: 16) {
            Label("Live render from your Mac", systemImage: "bolt.horizontal.circle")
                .font(.headline)
            Text("Run  server/run-live.sh  on your Mac, then enter the address it prints (e.g. 192.168.1.20).")
                .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
            HStack {
                TextField("Mac IP", text: $host)
                    .textFieldStyle(.roundedBorder).textInputAutocapitalization(.never)
                    .autocorrectionDisabled().keyboardType(.numbersAndPunctuation)
                TextField("Port", text: $portString)
                    .textFieldStyle(.roundedBorder).frame(width: 80).keyboardType(.numberPad)
            }
            Button {
                connect()
            } label: {
                Label("Go Live", systemImage: "play.fill").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent).controlSize(.large)
            .disabled(host.trimmingCharacters(in: .whitespaces).isEmpty)

            Button("Close") { dismiss() }.padding(.top, 4)
        }
        .padding(24)
        .frame(maxWidth: 420)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .padding(24)
    }
}

/// A thumb joystick reporting a normalised vector (x = strafe, y = forward).
private struct LiveJoystick: View {
    var onChange: (SIMD2<Float>) -> Void
    @State private var knob: CGSize = .zero
    private let base: CGFloat = 62, kr: CGFloat = 28

    var body: some View {
        ZStack {
            Circle().fill(.ultraThinMaterial)
            Circle().strokeBorder(.white.opacity(0.25), lineWidth: 1)
            Circle().fill(.white.opacity(0.9)).frame(width: kr * 2, height: kr * 2).offset(knob)
        }
        .frame(width: base * 2, height: base * 2)
        .contentShape(Circle())
        .gesture(DragGesture(minimumDistance: 0)
            .onChanged { v in
                let maxD = base - kr
                var off = v.translation
                let d = hypot(off.width, off.height)
                if d > maxD, d > 0 { off.width = off.width / d * maxD; off.height = off.height / d * maxD }
                knob = off
                onChange(SIMD2<Float>(Float(off.width / maxD), Float(-off.height / maxD)))
            }
            .onEnded { _ in knob = .zero; onChange(.zero) })
    }
}
