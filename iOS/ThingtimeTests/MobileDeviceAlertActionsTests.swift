import XCTest
@testable import Thingtime

@MainActor
final class MobileDeviceAlertActionsTests: XCTestCase {
    func testPreparationConfirmsOnlyWrittenScopedCacheAndPreservesPinnedVersion() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let fixture = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "device-alert-tone", withExtension: "mp3"))
        let scope = try MobileDevicePairing.Scope(ownerId: "synthetic-owner", url: URL(string: "https://example.test")!)
        let other = try MobileDevicePairing.Scope(ownerId: "other-owner", url: scope.origin)
        let store = MobileDevicePreparedSoundStore(library: root.appendingPathComponent("Library"))
        let sound = String(repeating: "a", count: 64), version = String(repeating: "b", count: 64)
        let command = MobileDeviceCommandWorker.Command(id: "prepare", kind: "media.prepare", input: [
            "attachmentId": "synthetic-attachment", "versionId": version, "soundId": sound, "format": "notification-sound"],
            leaseId: "synthetic-lease", leaseExpiresAt: Date().addingTimeInterval(60), approved: true)
        var downloads = 0, confirmations = 0, validations = 0
        let actions = MobileDeviceAlertActions(store: store, resolveAttachment: { _, _, check in
            try check(); downloads += 1
            let file = root.appendingPathComponent(UUID().uuidString + ".mp3")
            try FileManager.default.copyItem(at: fixture, to: file)
            return file
        }, authorizeMedia: { _, selected, attachment, selectedVersion, check in
            try check(); validations += 1
            XCTAssertEqual(selected, scope); XCTAssertEqual(attachment, "synthetic-attachment"); XCTAssertEqual(selectedVersion, version)
        }, confirmPrepared: { _, id, duration, check in
            try check(); confirmations += 1
            let receipt = try XCTUnwrap(store.resolve(id, scope: scope))
            XCTAssertEqual(receipt.versionId, version)
            XCTAssertGreaterThan(duration, 0); XCTAssertLessThan(duration, 30)
        })
        try await actions.execute(command, scope: scope, check: {})
        try await actions.execute(command, scope: scope, check: {})
        XCTAssertEqual(downloads, 1); XCTAssertEqual(confirmations, 2); XCTAssertGreaterThanOrEqual(validations, 2)
        XCTAssertNil(try store.resolve(sound, scope: other))
        let receipt = try XCTUnwrap(store.resolve(sound, scope: scope))
        try Data("invalid audio".utf8).write(to: store.library.appendingPathComponent("Sounds").appendingPathComponent(receipt.filename))
        XCTAssertThrowsError(try store.resolve(sound, scope: scope), "A broken cached sound must not silently choose the default")
    }
}
