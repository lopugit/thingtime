import ActivityKit
import AVFoundation
import Foundation
import Speech

@MainActor
final class LopuVoiceSessionController: NSObject, AVSpeechSynthesizerDelegate {
    struct Settings {
        var textResponse: Bool
        var transcribeMode: Bool
        var providerId: String
        var sessionId: String
    }

    var sendToWeb: ((String, [String: Any]) -> Void)?

    private let audioEngine = AVAudioEngine()
    private let speechSynthesizer = AVSpeechSynthesizer()
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var speechRecognizer = SFSpeechRecognizer(locale: Locale.current)
    private var settings: Settings?
    private var baseURL: URL?
    private var cookieHeader = ""
    private var history: [[String: String]] = []
    private var liveActivity: Activity<LopuVoiceActivityAttributes>?
    private var restartingRecognition = false
    private var active = false

    override init() {
        super.init()
        speechSynthesizer.delegate = self
    }

    func start(settings: Settings, baseURL: URL, cookieHeader: String) {
        stop(endActivity: false)
        self.settings = settings
        self.baseURL = baseURL
        self.cookieHeader = cookieHeader
        history = []
        active = true

        Task {
            let speechStatus = await requestSpeechAuthorization()
            let microphoneAllowed = await requestMicrophoneAuthorization()
            guard speechStatus == .authorized, microphoneAllowed else {
                active = false
                sendToWeb?("lopu-voice-error", ["error": "Speech Recognition and Microphone access are required for Lopu voice."])
                sendState()
                return
            }
            do {
                try configureAudioSession()
                try startRecognition()
                await startLiveActivityIfNeeded()
                await updateLiveActivity(phase: "listening", text: "Listening…")
                sendState()
            } catch {
                active = false
                sendToWeb?("lopu-voice-error", ["error": "Lopu could not start the microphone."])
                sendState()
            }
        }
    }

    func stop(endActivity: Bool = true) {
        active = false
        restartingRecognition = false
        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest?.endAudio()
        recognitionRequest = nil
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        speechSynthesizer.stopSpeaking(at: .immediate)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        if endActivity {
            Task { await finishLiveActivity() }
        }
        sendState()
    }

    private func requestSpeechAuthorization() async -> SFSpeechRecognizerAuthorizationStatus {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }
    }

    private func requestMicrophoneAuthorization() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { continuation.resume(returning: $0) }
        }
    }

    private func configureAudioSession() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth, .mixWithOthers])
        try session.setActive(true, options: .notifyOthersOnDeactivation)
    }

    private func startRecognition() throws {
        guard active else { return }
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        recognitionTask?.cancel()
        speechRecognizer = SFSpeechRecognizer(locale: Locale.current)
        guard let speechRecognizer, speechRecognizer.isAvailable else {
            throw NSError(domain: "LopuVoice", code: 1)
        }

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = speechRecognizer.supportsOnDeviceRecognition
        recognitionRequest = request

        let inputNode = audioEngine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak request] buffer, _ in
            request?.append(buffer)
        }
        audioEngine.prepare()
        try audioEngine.start()

        recognitionTask = speechRecognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self else { return }
            Task { @MainActor in
                if let result {
                    let text = result.bestTranscription.formattedString
                    self.sendToWeb?("lopu-voice-interim", ["text": text])
                    if result.isFinal, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        await self.completeUtterance(text)
                    }
                }
                if error != nil, self.active, !self.restartingRecognition {
                    self.scheduleRecognitionRestart()
                }
            }
        }
    }

    private func scheduleRecognitionRestart() {
        guard active else { return }
        pauseRecognition()
        Task {
            try? await Task.sleep(for: .milliseconds(250))
            guard active else { return }
            restartingRecognition = false
            try? startRecognition()
        }
    }

    private func pauseRecognition() {
        restartingRecognition = true
        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest?.endAudio()
        recognitionRequest = nil
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
    }

    private func completeUtterance(_ transcript: String) async {
        guard active, let settings else { return }
        let assistantId = "lopu-native-\(UUID().uuidString)"
        sendToWeb?("lopu-voice-transcript", ["text": transcript, "assistantId": assistantId])
        await updateLiveActivity(phase: settings.transcribeMode ? "transcribing" : "thinking", text: transcript)
        pauseRecognition()

        do {
            let events = try await requestReply(transcript: transcript, settings: settings)
            var spokenText = ""
            for event in events {
                if event["type"] as? String == "delta", let text = event["text"] as? String {
                    spokenText += text
                } else if event["type"] as? String == "quote", let text = event["text"] as? String {
                    spokenText = text
                }
                sendToWeb?("lopu-voice-event", ["assistantId": assistantId, "event": event])
            }
            if !settings.transcribeMode, !spokenText.isEmpty {
                history.append(["role": "user", "content": transcript])
                history.append(["role": "assistant", "content": spokenText])
                history = Array(history.suffix(20))
            }
            if !settings.textResponse, !settings.transcribeMode, !spokenText.isEmpty {
                await updateLiveActivity(phase: "speaking", text: spokenText)
                speechSynthesizer.speak(AVSpeechUtterance(string: spokenText))
            } else {
                await updateLiveActivity(phase: "listening", text: spokenText)
                scheduleRecognitionRestart()
            }
        } catch {
            let event: [String: Any] = ["type": "error", "error": "Lopu could not complete this turn."]
            sendToWeb?("lopu-voice-event", ["assistantId": assistantId, "event": event])
            await updateLiveActivity(phase: "listening", text: "Ready for the next thought")
            scheduleRecognitionRestart()
        }
    }

    private func requestReply(transcript: String, settings: Settings) async throws -> [[String: Any]] {
        guard let baseURL, let url = URL(string: "/api/v1/lopu/voice/reply", relativeTo: baseURL)?.absoluteURL else {
            throw NSError(domain: "LopuVoice", code: 2)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 100
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/x-ndjson", forHTTPHeaderField: "Accept")
        if !cookieHeader.isEmpty {
            request.setValue(cookieHeader, forHTTPHeaderField: "Cookie")
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "transcript": transcript,
            "sessionId": settings.sessionId,
            "providerId": settings.providerId,
            "transcribeMode": settings.transcribeMode,
            "history": history
        ])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw NSError(domain: "LopuVoice", code: 3)
        }
        return String(decoding: data, as: UTF8.self)
            .split(separator: "\n")
            .compactMap { line in
                guard let data = String(line).data(using: .utf8),
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
                else { return nil }
                return json
            }
    }

    private func sendState() {
        sendToWeb?("lopu-voice-state", ["active": active])
    }

    private func startLiveActivityIfNeeded() async {
        guard ActivityAuthorizationInfo().areActivitiesEnabled, liveActivity == nil, let settings else { return }
        let attributes = LopuVoiceActivityAttributes(sessionId: settings.sessionId, startedAt: Date())
        let state = LopuVoiceActivityAttributes.ContentState(phase: "listening", text: "Listening…", transcribeMode: settings.transcribeMode)
        liveActivity = try? Activity.request(attributes: attributes, content: ActivityContent(state: state, staleDate: nil))
    }

    private func updateLiveActivity(phase: String, text: String) async {
        guard let liveActivity, let settings else { return }
        let clipped = String(text.prefix(180))
        let state = LopuVoiceActivityAttributes.ContentState(phase: phase, text: clipped, transcribeMode: settings.transcribeMode)
        await liveActivity.update(ActivityContent(state: state, staleDate: Date().addingTimeInterval(120)))
    }

    private func finishLiveActivity() async {
        guard let liveActivity else { return }
        let final = LopuVoiceActivityAttributes.ContentState(phase: "ended", text: "Voice session ended", transcribeMode: settings?.transcribeMode == true)
        await liveActivity.end(ActivityContent(state: final, staleDate: nil), dismissalPolicy: .after(.now.addingTimeInterval(30)))
        self.liveActivity = nil
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        resumeAfterSpeech()
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        resumeAfterSpeech()
    }

    nonisolated private func resumeAfterSpeech() {
        Task { @MainActor [weak self] in
            guard let self else { return }
            await self.updateLiveActivity(phase: "listening", text: "Listening…")
            self.scheduleRecognitionRestart()
        }
    }
}
