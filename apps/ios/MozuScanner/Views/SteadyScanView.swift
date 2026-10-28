// The scan screen's steady lines: RoomPlan's session shown through an
// ARSCNView, with the room drawn over it from `RoomCaptureController`'s
// `steadyLines` instead of RoomPlan's own overlay.
//
// The lines are 3D nodes in the AR scene, so they are drawn in the same frame
// as the camera image and stay on the walls as the iPad moves, where a 2D
// overlay trails a frame behind. A line keeps its node from one update to the
// next (`LineIdentity`), so a correction glides it to its new place over a
// third of a second; a new line fades in and a vanished one fades out. Nothing
// blinks.

import ARKit
import SceneKit
import SwiftUI
import UIKit
import simd

/// One line of the room, in world metres, with an identity that lasts.
struct SteadyLine: Equatable {
    struct Segment {
        var kind: LiveLines.Kind
        var a: SIMD3<Float>
        var b: SIMD3<Float>
    }

    let id: Int
    let kind: LiveLines.Kind
    let a: SIMD3<Float>
    let b: SIMD3<Float>
}

/// Gives each line the identity of the line it was last time: the same kind,
/// ends within 30 cm on average, nearest first. A line is rebuilt from the
/// tracked room on every update, so without this the view could not tell a
/// line that moved 2 cm from a new one.
struct LineIdentity {
    private var last: [SteadyLine] = []
    private var nextId = 1

    mutating func assign(_ segments: [SteadyLine.Segment]) -> [SteadyLine] {
        var pairs: [(cost: Float, old: Int, new: Int)] = []
        for (i, o) in last.enumerated() {
            for (j, s) in segments.enumerated() where s.kind == o.kind {
                let straight = (simd_distance(o.a, s.a) + simd_distance(o.b, s.b)) / 2
                let crossed = (simd_distance(o.a, s.b) + simd_distance(o.b, s.a)) / 2
                let cost = min(straight, crossed)
                if cost <= 0.3 { pairs.append((cost, i, j)) }
            }
        }
        pairs.sort { ($0.cost, $0.old, $0.new) < ($1.cost, $1.old, $1.new) }
        var takenOld = [Bool](repeating: false, count: last.count)
        var idFor = [Int?](repeating: nil, count: segments.count)
        for p in pairs where !takenOld[p.old] && idFor[p.new] == nil {
            takenOld[p.old] = true
            idFor[p.new] = last[p.old].id
        }
        var out: [SteadyLine] = []
        out.reserveCapacity(segments.count)
        for (j, s) in segments.enumerated() {
            let id: Int
            if let known = idFor[j] {
                id = known
            } else {
                id = nextId
                nextId += 1
            }
            out.append(SteadyLine(id: id, kind: s.kind, a: s.a, b: s.b))
        }
        last = out
        return out
    }
}

/// The SceneKit side: one thin cylinder per line.
final class SteadyLineRenderer {
    let root = SCNNode()
    private var nodes: [Int: SCNNode] = [:]
    private var drawn: [Int: SteadyLine] = [:]
    private var materials: [LiveLines.Kind: SCNMaterial] = [:]

    func sync(_ lines: [SteadyLine]) {
        var keep = Set<Int>()
        var fresh: [(SCNNode, SteadyLine)] = []
        var moved: [(SCNNode, SteadyLine)] = []
        for line in lines {
            keep.insert(line.id)
            if let node = nodes[line.id] {
                if drawn[line.id] != line { moved.append((node, line)) }
            } else {
                let cylinder = SCNCylinder(radius: Self.radius(line.kind), height: 1)
                cylinder.radialSegmentCount = 8
                cylinder.heightSegmentCount = 1
                cylinder.materials = [material(line.kind)]
                let node = SCNNode(geometry: cylinder)
                node.renderingOrder = 100
                node.opacity = 0
                nodes[line.id] = node
                fresh.append((node, line))
            }
            drawn[line.id] = line
        }
        guard !fresh.isEmpty || !moved.isEmpty || nodes.count != keep.count else { return }

        // New lines are put where they belong at once — not animated in from
        // the origin — then faded in; moved lines glide to their new place.
        SCNTransaction.begin()
        SCNTransaction.disableActions = true
        for (node, line) in fresh {
            Self.place(node, line)
            root.addChildNode(node)
        }
        SCNTransaction.commit()

        SCNTransaction.begin()
        SCNTransaction.animationDuration = 0.3
        for (node, _) in fresh { node.opacity = 1 }
        for (node, line) in moved { Self.place(node, line) }
        SCNTransaction.commit()

        let gone = nodes.keys.filter { !keep.contains($0) }
        for id in gone {
            nodes[id]?.runAction(.sequence([.fadeOut(duration: 0.3), .removeFromParentNode()]))
            nodes[id] = nil
            drawn[id] = nil
        }
    }

    private func material(_ kind: LiveLines.Kind) -> SCNMaterial {
        if let m = materials[kind] { return m }
        let m = SCNMaterial()
        m.lightingModel = .constant
        m.diffuse.contents = Self.color(kind)
        // Drawn over the camera image whatever is in front of it: the lines
        // are a guide, and one hidden behind a chair is no guide at all.
        m.readsFromDepthBuffer = false
        m.writesToDepthBuffer = false
        materials[kind] = m
        return m
    }

    static func color(_ kind: LiveLines.Kind) -> UIColor {
        switch kind {
        case .floor, .ceiling, .corner, .pillar: return .white
        case .door: return UIColor(red: 1.0, green: 0.82, blue: 0.30, alpha: 1)
        case .window: return UIColor(red: 0.55, green: 0.85, blue: 1.0, alpha: 1)
        case .glass: return UIColor(red: 0.30, green: 0.65, blue: 1.0, alpha: 1)
        case .bulkhead: return UIColor(red: 0.96, green: 0.62, blue: 0.04, alpha: 1)
        }
    }

    private static func radius(_ kind: LiveLines.Kind) -> CGFloat {
        switch kind {
        case .floor, .ceiling, .corner: return 0.007
        default: return 0.005
        }
    }

    /// A unit cylinder stood along the line: its middle at the line's middle,
    /// its axis (SceneKit's +Y) turned onto the line.
    private static func place(_ node: SCNNode, _ line: SteadyLine) {
        let d = line.b - line.a
        let length = simd_length(d)
        guard length > 1e-4, let cylinder = node.geometry as? SCNCylinder else {
            node.isHidden = true
            return
        }
        node.isHidden = false
        var dir = d / length
        if dir.y < 0 { dir = -dir }
        cylinder.height = CGFloat(length)
        node.simdPosition = (line.a + line.b) / 2
        node.simdOrientation = simd_quatf(from: SIMD3<Float>(0, 1, 0), to: dir)
    }
}

/// RoomPlan's session through an ARSCNView, with the steady lines in it.
struct SteadyScanView: UIViewRepresentable {
    @ObservedObject var controller: RoomCaptureController
    let arSession: ARSession

    func makeCoordinator() -> SteadyLineRenderer { SteadyLineRenderer() }

    func makeUIView(context: Context) -> ARSCNView {
        let view = ARSCNView(frame: .zero)
        // RoomPlan runs and owns this session; the view only shows it.
        view.session = arSession
        view.scene = SCNScene()
        view.automaticallyUpdatesLighting = false
        view.autoenablesDefaultLighting = false
        view.rendersCameraGrain = false
        view.rendersMotionBlur = false
        view.antialiasingMode = .multisampling4X
        view.scene.rootNode.addChildNode(context.coordinator.root)
        context.coordinator.sync(controller.steadyLines)
        return view
    }

    func updateUIView(_ view: ARSCNView, context: Context) {
        if view.session !== arSession { view.session = arSession }
        context.coordinator.sync(controller.steadyLines)
    }
}

/// The room from above as the lines establish it — floor outline, doors,
/// windows, bulkheads and columns — with where you are standing, so you can
/// see the plan close as you walk round.
struct SteadyPlanInset: View {
    @ObservedObject var controller: RoomCaptureController

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.25)) { _ in
            Canvas { context, size in draw(in: &context, size: size) }
        }
        .frame(width: 150, height: 150)
        .background(Color.black.opacity(0.45), in: RoundedRectangle(cornerRadius: 12))
        .allowsHitTesting(false)
    }

    private func draw(in context: inout GraphicsContext, size: CGSize) {
        let lines = controller.steadyLines.filter {
            $0.kind != .ceiling && $0.kind != .corner && abs($0.a.x - $0.b.x) + abs($0.a.z - $0.b.z) > 0.01
        }
        guard !lines.isEmpty else { return }
        var minX = Float.infinity, maxX = -Float.infinity, minZ = Float.infinity, maxZ = -Float.infinity
        for l in lines {
            minX = min(minX, l.a.x, l.b.x)
            maxX = max(maxX, l.a.x, l.b.x)
            minZ = min(minZ, l.a.z, l.b.z)
            maxZ = max(maxZ, l.a.z, l.b.z)
        }
        let camera = controller.session?.arSession.currentFrame?.camera.transform
        if let t = camera {
            minX = min(minX, t.columns.3.x)
            maxX = max(maxX, t.columns.3.x)
            minZ = min(minZ, t.columns.3.z)
            maxZ = max(maxZ, t.columns.3.z)
        }
        let pad: CGFloat = 12
        let span = CGFloat(max(maxX - minX, maxZ - minZ, 0.5))
        let scale = (min(size.width, size.height) - pad * 2) / span
        let ox = (size.width - CGFloat(maxX - minX) * scale) / 2
        let oy = (size.height - CGFloat(maxZ - minZ) * scale) / 2
        func p(_ x: Float, _ z: Float) -> CGPoint {
            CGPoint(x: ox + CGFloat(x - minX) * scale, y: oy + CGFloat(z - minZ) * scale)
        }
        for l in lines {
            var path = Path()
            path.move(to: p(l.a.x, l.a.z))
            path.addLine(to: p(l.b.x, l.b.z))
            let width: CGFloat = l.kind == .floor ? 2 : 1.5
            context.stroke(path, with: .color(Color(SteadyLineRenderer.color(l.kind))), lineWidth: width)
        }
        if let t = camera {
            let at = p(t.columns.3.x, t.columns.3.z)
            // ARKit's camera looks down its own −Z.
            let fx = -t.columns.2.x, fz = -t.columns.2.z
            let n = max((fx * fx + fz * fz).squareRoot(), 1e-4)
            let tip = CGPoint(x: at.x + CGFloat(fx / n) * 12, y: at.y + CGFloat(fz / n) * 12)
            var heading = Path()
            heading.move(to: at)
            heading.addLine(to: tip)
            context.stroke(heading, with: .color(.green), lineWidth: 2)
            context.fill(Path(ellipseIn: CGRect(x: at.x - 4, y: at.y - 4, width: 8, height: 8)), with: .color(.green))
        }
    }
}
