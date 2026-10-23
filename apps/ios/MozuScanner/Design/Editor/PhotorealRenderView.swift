// The "Photoreal" result sheet. Presented from the 3D showroom with the current
// camera; it sends the live design to the render server and shows the path-traced
// image. Falls back to a server-address field when no server is configured (or a
// render fails), so the feature is self-explanatory on first use.

import SwiftUI

struct PhotorealRenderView: View {
    let state: DesignState
    let pose: CameraPose

    @Environment(\.dismiss) private var dismiss

    /// The render server base URL (e.g. https://my-box.example or http://192.168.1.20:8787).
    @AppStorage("mozuRenderServer") private var serverURLString = ""

    @State private var phase: Phase = .idle
    @State private var quality: RenderQuality = .preview

    enum Phase {
        case idle
        case rendering
        case done(UIImage)
        case failed(String)
    }

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Photoreal")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                    }
                }
        }
        .onAppear {
            if case .idle = phase, !serverURLString.isEmpty { start() }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .idle:
            setupForm
        case .rendering:
            VStack(spacing: 16) {
                ProgressView()
                    .controlSize(.large)
                Text("Path-tracing your room…")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text("Blender Cycles is rendering on your server. This can take a little while.")
                    .font(.footnote)
                    .foregroundStyle(.tertiary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .done(let image):
            resultView(image)
        case .failed(let message):
            failureView(message)
        }
    }

    // MARK: - Setup (no server yet)

    private var setupForm: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Label("Render this view photoreal", systemImage: "camera.aperture")
                    .font(.headline)
                Text("MOZU sends your room and furniture to your render server, which path-traces it with Blender Cycles and sends back a film-quality image.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                serverField
                qualityPicker

                Button {
                    start()
                } label: {
                    Label("Render", systemImage: "wand.and.stars")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(serverURLString.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .padding(20)
        }
    }

    private var serverField: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Render server address")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.secondary)
            TextField("http://192.168.1.20:8787", text: $serverURLString)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .font(.callout.monospaced())
        }
    }

    private var qualityPicker: some View {
        Picker("Quality", selection: $quality) {
            Text("Preview (fast)").tag(RenderQuality.preview)
            Text("Final (slow)").tag(RenderQuality.final)
        }
        .pickerStyle(.segmented)
    }

    // MARK: - Result

    private func resultView(_ image: UIImage) -> some View {
        VStack(spacing: 0) {
            ScrollView([.horizontal, .vertical]) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: .infinity)
            }
            .background(Color(.secondarySystemBackground))

            HStack(spacing: 12) {
                ShareLink(
                    item: Image(uiImage: image),
                    preview: SharePreview("MOZU photoreal render", image: Image(uiImage: image))
                ) {
                    Label("Share / Save", systemImage: "square.and.arrow.up")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)

                Button {
                    start()
                } label: {
                    Label("Re-render", systemImage: "arrow.clockwise")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }
            .controlSize(.large)
            .padding(16)
        }
    }

    // MARK: - Failure

    private func failureView(_ message: String) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Label("Render failed", systemImage: "exclamationmark.triangle")
                    .font(.headline)
                    .foregroundStyle(.orange)
                Text(message)
                    .font(.footnote.monospaced())
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)

                serverField
                qualityPicker

                Button {
                    start()
                } label: {
                    Label("Try again", systemImage: "arrow.clockwise")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            }
            .padding(20)
        }
    }

    // MARK: - Render

    private func start() {
        phase = .rendering
        let urlString = serverURLString
        let chosen = quality
        Task {
            do {
                let image = try await PhotorealRenderer.render(
                    state: state, camera: pose, serverURLString: urlString, quality: chosen
                )
                await MainActor.run { phase = .done(image) }
            } catch {
                await MainActor.run { phase = .failed(error.localizedDescription) }
            }
        }
    }
}
