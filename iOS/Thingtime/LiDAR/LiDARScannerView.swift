import ARKit
import AVFoundation
import SwiftUI

struct LiDARScannerView: View {
    let captureID: UUID
    let accountLabel: String?
    let onDiscard: (() throws -> Void)?
    let onSaved: (LiDARCapture) -> Void
    let onClose: () -> Void

    @StateObject private var model = LiDARScannerModel()
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @State private var confirmingDiscard = false

    init(captureID: UUID, accountLabel: String? = nil, onDiscard: (() throws -> Void)? = nil,
         onSaved: @escaping (LiDARCapture) -> Void, onClose: @escaping () -> Void) {
        self.captureID = captureID
        self.accountLabel = accountLabel
        self.onDiscard = onDiscard
        self.onSaved = onSaved
        self.onClose = onClose
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color.black.ignoresSafeArea()
                if model.state.showsCamera {
                    LiDARCameraView(session: model.recorder.session)
                        .ignoresSafeArea()
                        .accessibilityHidden(true)
                }
                if model.state.showsCamera {
                    VStack(spacing: 8) {
                        header
                        Spacer(minLength: 8)
                        ViewThatFits(in: .vertical) {
                            captureControls.fixedSize(horizontal: false, vertical: true)
                            ScrollView {
                                captureControls
                            }
                            .scrollBounceBehavior(.basedOnSize)
                            .defaultScrollAnchor(.bottom)
                        }
                        .frame(maxWidth: 460, alignment: .bottom)
                        .frame(maxWidth: .infinity, alignment: .bottom)
                        .frame(maxHeight: max(104, geometry.size.height * 0.66), alignment: .bottom)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                } else {
                    VStack(spacing: 8) {
                        header
                        ScrollView {
                            VStack(alignment: .leading, spacing: 18) {
                                introduction
                            }
                            .padding(.vertical, 24)
                            .frame(maxWidth: 440, alignment: .leading)
                            .frame(maxWidth: .infinity)
                        }
                        .scrollBounceBehavior(.basedOnSize)
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 8)
                }
            }
        }
        .foregroundStyle(.white)
        .preferredColorScheme(.dark)
        .interactiveDismissDisabled()
        .accessibilityAction(.escape, close)
        .confirmationDialog("Discard this scan?", isPresented: $confirmingDiscard, titleVisibility: .visible) {
            Button("Discard Scan", role: .destructive, action: discard)
            Button("Keep Recording", role: .cancel) {}
        } message: {
            Text("The data recorded for this scan will be deleted from this device.")
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { model.interrupt() }
        }
        .onDisappear { model.interrupt() }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 12) {
            Text("LiDAR Scan")
                .font(.headline)
                .padding(.horizontal, 14)
                .frame(minHeight: 44)
                .background(.black.opacity(0.8), in: Capsule())
                .accessibilityAddTraits(.isHeader)
            Spacer()
            if model.state.canClose {
                Button(action: close) {
                    Image(systemName: "xmark")
                        .font(.body.weight(.semibold))
                        .frame(width: 44, height: 44)
                        .background(.black.opacity(0.8), in: Circle())
                        .overlay { Circle().strokeBorder(.white.opacity(0.3)) }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close LiDAR scanner")
            }
        }
    }

    @ViewBuilder
    private var introduction: some View {
        switch model.state {
        case .ready, .requestingCamera:
            Image(systemName: "viewfinder")
                .font(.system(size: 44, weight: .regular))
                .accessibilityHidden(true)
            Text("Record a 3D scan")
                .font(.largeTitle.bold())
                .accessibilityAddTraits(.isHeader)
            Text("Move slowly around the area you want to capture. Thingtime records depth, camera frames, and the available 3D mesh.")
                .foregroundStyle(.white.opacity(0.78))
            Text("Scans can use substantial storage. When you finish, the scan stays on this device and Thingtime saves a private Thing.")
                .foregroundStyle(.white.opacity(0.78))
            if let accountLabel {
                Label {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Save to").font(.caption).foregroundStyle(.white.opacity(0.75))
                        Text(accountLabel).font(.subheadline.weight(.semibold))
                    }
                } icon: {
                    Image(systemName: "lock").accessibilityHidden(true)
                }
                .accessibilityElement(children: .combine)
            }
            primaryButton("Start Scan", icon: "record.circle", loading: model.state == .requestingCamera) {
                model.start(id: captureID, onSaved: onSaved, onDiscarded: onClose)
            }
            .accessibilityHint("Starts the camera and saves the scan locally as you record.")
        case .unsupported:
            status("LiDAR is unavailable", icon: "viewfinder",
                   description: "This scanner needs an iPhone or iPad that supports ARKit scene depth.")
        case .cameraDenied:
            status("Allow camera access", icon: "camera",
                   description: "Enable the camera for Thingtime in Settings, then return to start a scan.")
            primaryButton("Open Settings", icon: "gear") {
                if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
            }
            Button("Check Camera Access") { model.resetPermissionPrompt() }
                .frame(minHeight: 44)
                .buttonStyle(.plain)
        case .failure(let message, let canRecover):
            status("Local save needs attention", icon: "exclamationmark.triangle", description: message)
            if canRecover {
                primaryButton("Retry Local Save", icon: "arrow.clockwise", action: model.recorder.retryLocalSave)
            } else {
                primaryButton("Try Again", icon: "arrow.clockwise", action: model.resetPermissionPrompt)
            }
        case .saved(let capture):
            status(capture.isPartial ? "Partial scan saved" : "Scan saved on this device",
                   icon: "checkmark.circle", description: capture.statusDetail ?? "Waiting for Thingtime to save the private Thing.")
            Button("Close", action: onClose)
                .frame(minHeight: 44)
                .buttonStyle(.plain)
        case .discarding:
            HStack(spacing: 10) {
                ProgressView().tint(.white).accessibilityHidden(true)
                Text("Discarding scan…")
            }
            .accessibilityElement(children: .combine)
        case .discardFailure(let uploadDisabled):
            status("Could not delete the local scan", icon: "exclamationmark.triangle",
                   description: uploadDisabled
                        ? "The scan will not be uploaded. Retry to remove the remaining data from this device."
                        : "The device could not record the discard. Retry to finish safely.")
            primaryButton("Retry Delete", icon: "trash", action: discard)
        case .recording, .finalizing:
            EmptyView()
        }
    }

    @ViewBuilder
    private var captureControls: some View {
        VStack(alignment: .leading, spacing: 12) {
            switch model.state {
            case .recording(let stats):
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Image(systemName: "record.circle.fill")
                        .foregroundStyle(.red)
                        .accessibilityHidden(true)
                    Text("Recording").font(.headline)
                    Spacer(minLength: 8)
                    Text(Self.clock(stats.elapsed))
                        .font(.subheadline.monospacedDigit())
                        .accessibilityLabel("Recording time")
                        .accessibilityValue(Self.clock(stats.elapsed))
                }
                Text(stats.hint)
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.85))
                Text("\(stats.frameCount.formatted()) frames · \(ByteCountFormatter.string(fromByteCount: stats.bytes, countStyle: .file))")
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(.white.opacity(0.82))
                primaryButton("Finish & Save", icon: "stop.fill", action: model.finish)
                    .accessibilityHint("Stops recording and saves the scan as a private Thing.")
            case .finalizing:
                HStack(spacing: 10) {
                    ProgressView().tint(.white).accessibilityHidden(true)
                    Text("Saving scan on this device…").font(.headline)
                }
                .frame(minHeight: 44, alignment: .leading)
                .accessibilityElement(children: .combine)
            default:
                EmptyView()
            }
        }
        .padding(16)
        .background(.black.opacity(0.86), in: RoundedRectangle(cornerRadius: 22))
        .overlay { RoundedRectangle(cornerRadius: 22).strokeBorder(.white.opacity(0.18)) }
    }

    private func status(_ title: String, icon: String, description: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Image(systemName: icon).font(.system(size: 32)).accessibilityHidden(true)
            Text(title).font(.title.bold()).accessibilityAddTraits(.isHeader)
            Text(description).foregroundStyle(.white.opacity(0.8))
        }
    }

    private func primaryButton(_ title: String, icon: String, loading: Bool = false,
                               action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if loading {
                    ProgressView().tint(.black).accessibilityHidden(true)
                } else {
                    Image(systemName: icon).accessibilityHidden(true)
                }
                Text(title).font(.headline)
            }
            .multilineTextAlignment(.center)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, minHeight: 48)
        }
        .buttonStyle(.borderedProminent)
        .tint(.white)
        .foregroundStyle(.black)
        .disabled(loading)
    }

    private func discard() {
        model.discard(onDiscard: onDiscard)
    }

    private func close() {
        guard model.state.canClose else { return }
        switch model.state {
        case .recording: confirmingDiscard = true
        case .finalizing: break
        default: onClose()
        }
    }

    private static func clock(_ elapsed: TimeInterval) -> String {
        let seconds = max(0, Int(elapsed))
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
}

private struct LiDARCameraView: UIViewRepresentable {
    let session: ARSession

    func makeUIView(context: Context) -> ARSCNView {
        let view = ARSCNView(frame: .zero)
        view.session = session
        view.isUserInteractionEnabled = false
        return view
    }

    func updateUIView(_ view: ARSCNView, context: Context) {}
}

@MainActor
private final class LiDARScannerModel: ObservableObject {
    struct Stats: Equatable {
        let frameCount: Int
        let bytes: Int64
        let elapsed: TimeInterval
        let tracking: String
        let hasDepth: Bool

        var hint: String {
            switch tracking {
            case "limited.excessiveMotion": return "Move more slowly to improve tracking."
            case "limited.insufficientFeatures": return "Aim at a well-lit surface with visible detail."
            case "limited.relocalizing": return "Point the camera toward an area you already scanned."
            case "normal" where hasDepth: return "Move slowly around the area to capture it from different angles."
            default: return "Hold steady while the scanner finds depth."
            }
        }
    }

    enum State: Equatable {
        case ready
        case unsupported
        case cameraDenied
        case requestingCamera
        case recording(Stats)
        case finalizing
        case discarding
        case discardFailure(uploadDisabled: Bool)
        case failure(String, canRecover: Bool)
        case saved(LiDARCapture)

        var showsCamera: Bool {
            if case .recording = self { return true }
            return isFinalizing
        }

        var isFinalizing: Bool { self == .finalizing }
        var canClose: Bool {
            switch self {
            case .finalizing, .discarding, .discardFailure(uploadDisabled: false): return false
            default: return true
            }
        }
    }

    @Published private(set) var state: State = LiDARRecorder.isSupported ? .ready : .unsupported
    let recorder = LiDARRecorder()
    private var attempt: UUID?

    func start(id: UUID, onSaved: @escaping (LiDARCapture) -> Void, onDiscarded: @escaping () -> Void) {
        guard state == .ready else { return }
        let attempt = UUID()
        self.attempt = attempt
        state = .requestingCamera
        Task { @MainActor [weak self] in
            let allowed: Bool
            switch AVCaptureDevice.authorizationStatus(for: .video) {
            case .authorized: allowed = true
            case .notDetermined: allowed = await AVCaptureDevice.requestAccess(for: .video)
            case .restricted, .denied: allowed = false
            @unknown default: allowed = false
            }
            guard let self, self.attempt == attempt else { return }
            guard allowed else { self.state = .cameraDenied; return }
            self.recorder.start(id: id) { [weak self] update in
                switch update {
                case .recording(let frames, let bytes, let elapsed, let tracking, let hasDepth):
                    guard let self, self.state == .requestingCamera || self.state.showsCamera && !self.state.isFinalizing else { return }
                    self.state = .recording(.init(frameCount: frames, bytes: bytes, elapsed: elapsed,
                                                   tracking: tracking, hasDepth: hasDepth))
                case .finalizing:
                    if self?.state != .discarding { self?.state = .finalizing }
                case .failed(let message, let canRecover):
                    if self?.state != .discarding { self?.state = .failure(message, canRecover: canRecover) }
                case .saved(let capture):
                    self?.state = .saved(capture)
                    onSaved(capture)
                case .discardFailed(let uploadDisabled):
                    self?.state = .discardFailure(uploadDisabled: uploadDisabled)
                case .discarded:
                    onDiscarded()
                }
            }
        }
    }

    func finish() {
        guard case .recording = state else { return }
        state = .finalizing
        recorder.finish()
    }

    func discard(onDiscard: (() throws -> Void)?) {
        switch state {
        case .recording, .discardFailure:
            state = .discarding
            let uploadDisabled: Bool
            if let onDiscard {
                do {
                    try onDiscard()
                    uploadDisabled = true
                } catch {
                    uploadDisabled = false
                }
            } else {
                uploadDisabled = false
            }
            recorder.discard(uploadDisabled: uploadDisabled)
        default: break
        }
    }

    func resetPermissionPrompt() { state = .ready }

    func interrupt() {
        attempt = nil
        if state == .requestingCamera { state = .ready }
        recorder.interrupt()
    }
}
