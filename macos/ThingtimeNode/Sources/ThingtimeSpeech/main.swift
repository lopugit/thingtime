import AVFoundation
import Foundation
import Speech
import ThingtimeSpeechCore

// One utterance per process. Only the owning Electron window receives text;
// no audio files, provider credentials, or persistent recording are created.
final class SpeechCapture {
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var recognizer: SFSpeechRecognizer?
    private let continuous: Bool
    private var silenceTimer: Timer?
    private var deadline: Timer?
    private var latest = ""
    private var finished = false
    private var tapped = false

    init(continuous: Bool) { self.continuous = continuous }

    func emit(_ event: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: event) else { return }
        FileHandle.standardOutput.write(data + Data([10]))
    }

    func finish(error: String? = nil, sendTranscript: Bool = false) {
        guard !finished else { return }
        finished = true
        silenceTimer?.invalidate()
        deadline?.invalidate()
        engine.stop()
        if tapped { engine.inputNode.removeTap(onBus: 0) }
        request?.endAudio()
        task?.cancel()
        if let error { emit(["type": "error", "error": error]) }
        else if sendTranscript && !latest.isEmpty { emit(["type": "final", "text": latest]) }
        emit(["type": "end"])
        exit(0)
    }

    func start(locale: String) {
        // Explicit invocation from the mic control is the only prompting path.
        SFSpeechRecognizer.requestAuthorization { status in
            DispatchQueue.main.async {
                guard !self.finished else { return }
                guard status == .authorized else { self.finish(error: "speech-denied"); return }
                AVCaptureDevice.requestAccess(for: .audio) { granted in
                    DispatchQueue.main.async {
                        guard !self.finished else { return }
                        guard granted else { self.finish(error: "microphone-denied"); return }
                        self.listen(locale: locale)
                    }
                }
            }
        }
    }

    private func listen(locale: String) {
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)), recognizer.isAvailable else {
            finish(error: "service-unavailable"); return
        }
        self.recognizer = recognizer
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        // Prefer local recognition where macOS supports the selected language.
        request.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition
        self.request = request
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { finish(error: "audio-capture"); return }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in request.append(buffer) }
        tapped = true
        task = recognizer.recognitionTask(with: request) { result, error in
            DispatchQueue.main.async {
                guard !self.finished else { return }
                if let result {
                    let text = String(result.bestTranscription.formattedString.prefix(16_000))
                    if text != self.latest {
                        self.latest = text
                        self.emit(["type": "partial", "text": text])
                        // The composer owns pauses for continuous dictation.
                        // Keep the dedicated private-page/legacy utterance path.
                        if !self.continuous {
                            self.silenceTimer?.invalidate()
                            self.silenceTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: false) { _ in
                                self.finish(sendTranscript: true)
                            }
                        }
                    }
                    if result.isFinal { self.finish(sendTranscript: true); return }
                }
                if let error {
                    self.finish(error: recognitionFailureCode(error as NSError, hasTranscript: !self.latest.isEmpty))
                }
            }
        }
        do {
            engine.prepare()
            try engine.start()
            emit(["type": "ready"])
            deadline = Timer.scheduledTimer(withTimeInterval: 55, repeats: false) { _ in
                self.finish(error: self.latest.isEmpty ? "no-speech" : nil, sendTranscript: true)
            }
        } catch { finish(error: "audio-capture") }
    }
}

let locale = CommandLine.arguments.dropFirst().first ?? "en-US"
guard locale.range(of: "^[A-Za-z]{2,8}([-_][A-Za-z0-9]{1,8}){0,3}$", options: .regularExpression) != nil else { exit(2) }
signal(SIGPIPE, SIG_IGN)
guard CommandLine.arguments.count <= 3,
      CommandLine.arguments.count < 3 || CommandLine.arguments[2] == "continuous" else { exit(2) }
let capture = SpeechCapture(continuous: CommandLine.arguments.count == 3)
// Closing the parent's pipe (including an Electron crash) releases the mic.
DispatchQueue.global().async {
    _ = FileHandle.standardInput.readData(ofLength: 1)
    DispatchQueue.main.async { capture.finish() }
}
capture.start(locale: locale)
RunLoop.main.run()
