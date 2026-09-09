import AVFoundation
import Speech
import XCTest
@testable import Thingtime

final class LopuVoiceRecoveryTests: XCTestCase {
    private let baseURL = URL(string: "https://thingtime.com")!

    func testCapabilitiesRequireOriginAndCompatibleFeatureVersion() {
        func manifest(_ version: String, origin: String = "https://thingtime.com") -> [String: Any] {
            ["schemaVersion": 1, "origin": origin, "features": ["api.lopu-chats-reply": ["version": version]]]
        }
        for version in ["1.3.0", "1.3.1", "1.4.0"] {
            XCTAssertTrue(LopuVoiceContract.accepts(manifest(version), baseURL: baseURL, feature: "api.lopu-chats-reply", minimum: [1, 3, 0]))
        }
        for version in ["1.2.9", "2.0.0", "0.9.9", "1.3", "1.3.x", "1.3.0-beta"] {
            XCTAssertFalse(LopuVoiceContract.accepts(manifest(version), baseURL: baseURL, feature: "api.lopu-chats-reply", minimum: [1, 3, 0]))
        }
        XCTAssertFalse(LopuVoiceContract.accepts(manifest("1.4.0", origin: "https://other.example"), baseURL: baseURL, feature: "api.lopu-chats-reply", minimum: [1, 3, 0]))
        XCTAssertFalse(LopuVoiceContract.accepts(manifest("1.4.0"), baseURL: baseURL, feature: "api.missing", minimum: [1, 0, 0]))
    }

    func testManifestPathMatchesOriginScopedServerContract() {
        XCTAssertEqual(LopuVoiceContract.manifestPath, "/.well-known/thingtime-capabilities.json")
    }

    @MainActor
    func testStartDoesNotEmitStoppedAndStopInvalidatesPendingPermission() async {
        var permission: CheckedContinuation<Bool, Never>?
        var asked = false
        let controller = LopuVoiceSessionController(microphoneAuthorization: {
            asked = true
            return await withCheckedContinuation { permission = $0 }
        })
        var events: [(String, [String: Any])] = []
        controller.sendToWeb = { events.append(($0, $1)) }
        controller.start(settings: settings(), baseURL: baseURL, cookieHeader: "")
        while !asked { await Task.yield() }
        XCTAssertFalse(events.contains { $0.0 == "lopu-voice-state" })
        controller.stop()
        permission?.resume(returning: true)
        for _ in 0..<10 { await Task.yield() }
        XCTAssertEqual(events.filter { $0.0 == "lopu-voice-state" }.count, 1)
        XCTAssertFalse(events.contains { $0.1["active"] as? Bool == true })
        XCTAssertFalse(events.contains { $0.0 == "lopu-voice-error" })
    }

    @MainActor
    func testMicrophoneAndSpeechDenialsHaveSeparateRecoveryInstructions() async {
        for micAllowed in [false, true] {
            let controller = LopuVoiceSessionController(microphoneAuthorization: { micAllowed }, speechAuthorization: { .denied })
            let failed = expectation(description: "permission denied")
            var error = ""
            controller.sendToWeb = { type, payload in
                if type == "lopu-voice-error" {
                    error = payload["error"] as? String ?? ""
                    failed.fulfill()
                }
            }
            controller.start(settings: settings(), baseURL: baseURL, cookieHeader: "")
            await fulfillment(of: [failed], timeout: 2)
            XCTAssertTrue(error.contains(micAllowed ? "Speech Recognition" : "Microphone"))
            XCTAssertTrue(error.contains("Settings"))
        }
    }

    @MainActor
    func testCapturedAudioAndTranscriptRemainReadableWithoutProvider() throws {
        let controller = LopuVoiceSessionController()
        let format = AVAudioFormat(standardFormatWithSampleRate: 16000, channels: 1)!
        var file: AVAudioFile? = try controller.makeRecording(format: format)
        let url = file!.url
        defer {
            try? FileManager.default.removeItem(at: url)
            try? FileManager.default.removeItem(at: url.deletingPathExtension().appendingPathExtension("txt"))
        }
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1600)!
        buffer.frameLength = 1600
        for i in 0..<1600 { buffer.floatChannelData![0][i] = Float(sin(Double(i) * 0.2) * 0.1) }
        try file!.write(from: buffer)
        file = nil
        var filename: String?
        controller.sendToWeb = { type, payload in
            if type == "lopu-voice-recording" { filename = payload["filename"] as? String }
        }
        controller.finishRecording(transcript: "A recoverable voice note")
        XCTAssertEqual(filename, url.lastPathComponent)
        XCTAssertEqual(try AVAudioFile(forReading: url).length, 1600)
        XCTAssertEqual(try String(contentsOf: url.deletingPathExtension().appendingPathExtension("txt"), encoding: .utf8), "A recoverable voice note")
    }

    @MainActor
    private func settings() -> LopuVoiceSessionController.Settings {
        .init(textResponse: true, transcribeMode: false, providerId: "", sessionId: "test-voice", inputMode: "native-transcript", model: "", effort: "", speed: "normal", chatId: "test-chat")
    }
}
