import AVFoundation
import Foundation

@MainActor
final class ThingtimeWatchAudioRecorder: NSObject, ObservableObject {
    struct Recording: Sendable {
        let url: URL
        let filename: String
        let contentType: String
    }

    @Published private(set) var isRecording = false
    @Published private(set) var duration: TimeInterval = 0
    @Published private(set) var errorMessage: String?

    var completedRecording: ((Recording) -> Void)?

    private var recorder: AVAudioRecorder?
    private var timer: Timer?
    private let maximumDuration: TimeInterval = 10 * 60

    func toggle() async {
        if isRecording {
            stop()
        } else {
            await start()
        }
    }

    func stop() {
        recorder?.stop()
    }

    private func start() async {
        errorMessage = nil
        guard await requestMicrophonePermission() else {
            errorMessage = "Microphone access is off in Watch Settings."
            return
        }

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .default)
            try session.setActive(true)

            let filename = "Apple-Watch-Audio-\(Self.timestamp()).m4a"
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
            let settings: [String: Any] = [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                AVSampleRateKey: 32_000,
                AVNumberOfChannelsKey: 1,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
            ]
            let recorder = try AVAudioRecorder(url: url, settings: settings)
            recorder.delegate = self
            guard recorder.record(forDuration: maximumDuration) else {
                throw RecordingError.couldNotStart
            }
            self.recorder = recorder
            duration = 0
            isRecording = true
            timer?.invalidate()
            timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
                Task { @MainActor in
                    guard let self else { return }
                    self.duration = self.recorder?.currentTime ?? 0
                }
            }
        } catch {
            errorMessage = "Couldn’t start recording: \(error.localizedDescription)"
            finishSession()
        }
    }

    private func requestMicrophonePermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    private func finishSession() {
        timer?.invalidate()
        timer = nil
        recorder = nil
        isRecording = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private static func timestamp() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return formatter.string(from: Date())
    }
}

extension ThingtimeWatchAudioRecorder: AVAudioRecorderDelegate {
    nonisolated func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        let url = recorder.url
        Task { @MainActor in
            let filename = url.lastPathComponent
            finishSession()
            guard flag else {
                errorMessage = "The audio recording didn’t finish successfully."
                try? FileManager.default.removeItem(at: url)
                return
            }
            completedRecording?(Recording(url: url, filename: filename, contentType: "audio/mp4"))
        }
    }

    nonisolated func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        Task { @MainActor in
            errorMessage = "Couldn’t save the recording: \(error?.localizedDescription ?? "Unknown error")"
            finishSession()
            try? FileManager.default.removeItem(at: recorder.url)
        }
    }
}

private enum RecordingError: LocalizedError {
    case couldNotStart

    var errorDescription: String? { "The Apple Watch couldn’t start recording." }
}
