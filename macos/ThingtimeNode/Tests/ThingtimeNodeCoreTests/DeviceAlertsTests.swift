import AVFoundation
import Foundation
import XCTest
@testable import ThingtimeNodeCore

private actor AlertAuthorizationFixture: DeviceAlertClient {
    let initial: ThingtimeAPIClient.AlertMedia
    var authorizationCount = 0
    var revoked = false
    var replacementVersion: String?
    var registered = false
    init(media: ThingtimeAPIClient.AlertMedia) { initial = media }
    func verifyAlertsCapabilities() {}
    func verifyAlertLease(_ command: LeasedCommand) {}
    func alertMedia(command: LeasedCommand) throws -> ThingtimeAPIClient.AlertMedia {
        authorizationCount += 1
        if revoked { throw ThingtimeAPIClientError.rejected(status: 403) }
        return .init(url: initial.url, attachmentId: initial.attachmentId,
            versionId: replacementVersion ?? initial.versionId, size: initial.size, contentType: initial.contentType)
    }
    func registerAlertSound(command: LeasedCommand, soundID: String, duration: Double, cacheGeneration: String) { registered = true }
    func revoke() { revoked = true }
    func replaceVersion() { replacementVersion = String(repeating: "b", count: 64) }
    func counts() -> (Int, Bool) { (authorizationCount, registered) }
}

@MainActor private final class SilentAlertPlayer: DeviceAlertPlayback {
    var isPlaying = false
    var numberOfLoops = 0
    var playCount = 0
    func prepareToPlay() -> Bool { true }
    func play() -> Bool { playCount += 1; isPlaying = true; return true }
}

final class DeviceAlertsTests: XCTestCase {
    @MainActor func testRevokedAudioDuringDownloadNeverPlaysOrPersistsPreparedSound() async throws {
        for method in ["media.play", "media.prepare"] {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: root) }
            let source = root.appendingPathComponent("source.wav")
            try writeAudio(source)
            let id = String(repeating: "a", count: 64)
            let media = ThingtimeAPIClient.AlertMedia(url: URL(string: "https://storage.example.test/pinned.wav")!, attachmentId: "attachment", versionId: id,
                size: Int64(try source.resourceValues(forKeys: [.fileSizeKey]).fileSize!), contentType: "audio/wav")
            let client = AlertAuthorizationFixture(media: media)
            let service = DeviceAlertService(), player = SilentAlertPlayer()
            service.playbackFactory = { _ in player }
            service.soundDirectoryOverride = root.appendingPathComponent("sounds")
            service.downloadOverride = { url in
                let copy = root.appendingPathComponent("download.wav")
                try FileManager.default.copyItem(at: source, to: copy)
                // Deletion/moderation changes after the initial grant and while the download is outstanding.
                await client.revoke()
                return (copy, HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!)
            }
            do { _ = try await service.execute(command(method, version: id), client: client); XCTFail("A stale media grant must not authorize an effect") }
            catch { XCTAssertEqual(error as? ThingtimeAPIClientError, .rejected(status: 403)) }
            XCTAssertEqual(player.playCount, 0)
            XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("sounds/" + id + ".caf").path))
            let counts = await client.counts(); XCTAssertEqual(counts.0, 2); XCTAssertFalse(counts.1)
        }
    }
    @MainActor func testChangedVersionDuringDownloadNeverPlays() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let id = String(repeating: "a", count: 64), source = root.appendingPathComponent("download.wav")
        try Data([0, 1, 2]).write(to: source)
        let media = ThingtimeAPIClient.AlertMedia(url: URL(string: "https://storage.example.test/pinned.wav")!, attachmentId: "attachment", versionId: id, size: 3, contentType: "audio/wav")
        let client = AlertAuthorizationFixture(media: media)
        let service = DeviceAlertService(), player = SilentAlertPlayer()
        service.playbackFactory = { _ in player }
        service.downloadOverride = { url in
            await client.replaceVersion()
            return (source, HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }
        do { _ = try await service.execute(command("media.play", version: id), client: client); XCTFail("Changed pinned version must refuse playback") }
        catch { XCTAssertEqual(error as? ThingtimeAPIClientError, .invalidResponse) }
        XCTAssertEqual(player.playCount, 0)
    }
    @MainActor func testUnchangedGrantPlaysExactlyOnceAfterFreshAuthorization() async throws {
        let source = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try Data([0, 1, 2]).write(to: source)
        defer { try? FileManager.default.removeItem(at: source) }
        let id = String(repeating: "a", count: 64)
        let media = ThingtimeAPIClient.AlertMedia(url: URL(string: "https://storage.example.test/pinned.wav")!, attachmentId: "attachment", versionId: id, size: 3, contentType: "audio/wav")
        let client = AlertAuthorizationFixture(media: media)
        let service = DeviceAlertService(), player = SilentAlertPlayer()
        service.playbackFactory = { _ in player }
        service.downloadOverride = { (source, HTTPURLResponse(url: $0, statusCode: 200, httpVersion: nil, headerFields: nil)!) }
        _ = try await service.execute(command("media.play", version: id), client: client)
        XCTAssertEqual(player.playCount, 1)
        let counts = await client.counts(); XCTAssertEqual(counts.0, 2)
    }
    private func command(_ method: String, version: String) -> LeasedCommand {
        .init(commandID: UUID().uuidString, leaseID: UUID().uuidString, method: method,
            parameters: .object(["attachmentId": .string("attachment"), "versionId": .string(version), "soundId": .string(version), "format": .string("notification-sound")]),
            leaseExpiresAt: Date().addingTimeInterval(60), approvedForExecution: true, deviceID: "device")
    }
    private func writeAudio(_ url: URL) throws {
        let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1)!
        let file = try AVAudioFile(forWriting: url, settings: format.settings)
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 441)!
        buffer.frameLength = 441
        buffer.floatChannelData![0].initialize(repeating: 0, count: 441)
        try file.write(from: buffer)
    }
}
