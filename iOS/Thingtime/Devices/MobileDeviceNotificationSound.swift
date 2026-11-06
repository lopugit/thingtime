import AVFoundation
import Foundation

/// Converts an already authorized local attachment into an Apple notification
/// sound. This adapter never fetches arbitrary URLs or changes the source MP3.
enum MobileDeviceNotificationSound {
    enum Failure: Error { case unsupported, tooLong, conversion }
    static func prepare(source: URL, soundId: String, library: URL) async throws -> String {
        guard soundId.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else { throw Failure.unsupported }
        guard source.isFileURL else { throw Failure.unsupported }
        let asset = AVURLAsset(url: source)
        let duration = try await asset.load(.duration)
        guard duration.seconds.isFinite, duration.seconds > 0, duration.seconds < 30 else { throw Failure.tooLong }
        let sounds = library.appendingPathComponent("Sounds", isDirectory: true)
        try FileManager.default.createDirectory(at: sounds, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        let name = "tt-" + soundId + ".caf"
        let destination = sounds.appendingPathComponent(name)
        let staged = sounds.appendingPathComponent(UUID().uuidString + ".caf")
        defer { try? FileManager.default.removeItem(at: staged) }
        do {
            let input = try AVAudioFile(forReading: source)
            let format = input.processingFormat
            let settings: [String: Any] = [AVFormatIDKey: kAudioFormatLinearPCM,
                AVSampleRateKey: format.sampleRate, AVNumberOfChannelsKey: format.channelCount,
                AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false]
            let output = try AVAudioFile(forWriting: staged, settings: settings)
            guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096) else { throw Failure.conversion }
            while input.framePosition < input.length {
                try Task.checkCancellation()
                try input.read(into: buffer, frameCount: 4096)
                if buffer.frameLength == 0 { break }
                try output.write(from: buffer)
            }
        }
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: staged.path)
        if FileManager.default.fileExists(atPath: destination.path) { _ = try FileManager.default.replaceItemAt(destination, withItemAt: staged) }
        else { try FileManager.default.moveItem(at: staged, to: destination) }
        return name
    }
    static func validatedName(_ value: String) -> String? {
        guard value.range(of: "^tt-[0-9a-f]{64}\\.caf$", options: .regularExpression) != nil else { return nil }
        return value
    }
}
