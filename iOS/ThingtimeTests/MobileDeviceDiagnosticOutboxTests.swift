import XCTest
import AppleFileSync
@testable import Thingtime

final class MobileDeviceDiagnosticOutboxTests: XCTestCase {
    private func binding(owner: String = "0123456789abcdef01234567", device: String = "device-fixture",
                         origin: String = "https://example.test") throws -> MobileDeviceDiagnosticOutbox.Binding {
        .init(scope: try FileSyncOwnerScope(ownerId: owner, url: URL(string: origin)!), deviceId: device)
    }
    private func fixture(_ body: (MobileDeviceDiagnosticOutbox, URL) throws -> Void) throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("diagnostics-tests-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try body(.init(root: root), root)
    }
    private func event() -> MobileDeviceDiagnosticEvent {
        .init(category: .sync, level: .warning, code: .waiting, state: .waiting,
              at: Date(timeIntervalSince1970: 1_794_451_200.125), runtime: .init(appVersion: "1.0", build: "69", osVersion: "26.0"))
    }
    func testOfflineRestartAndAmbiguousDeliveryKeepExactIdentityAndBytes() throws {
        try fixture { outbox, root in
            let binding = try binding(), original = event()
            try outbox.append(original, binding: binding)
            let first = try XCTUnwrap(outbox.next(binding: binding).first)
            let restored = MobileDeviceDiagnosticOutbox(root: root)
            try restored.append(original, binding: binding)
            let second = try XCTUnwrap(restored.next(binding: binding).first)
            XCTAssertEqual(first, second)
            XCTAssertEqual(try first.event.encoded(), try second.event.encoded())
            XCTAssertEqual(try restored.next(binding: binding).count, 1)
            try restored.acknowledge([original.eventId], from: [second], binding: binding)
            XCTAssertTrue(try restored.next(binding: binding).isEmpty)
        }
    }
    func testConflictingReplayCannotReplaceOriginal() throws {
        try fixture { outbox, _ in
            let binding = try binding(), original = event()
            try outbox.append(original, binding: binding)
            var changed = original; changed.state = .failed
            XCTAssertThrowsError(try outbox.append(changed, binding: binding))
            XCTAssertEqual(try outbox.next(binding: binding).first?.event, original)
        }
    }
    func testOwnerOriginAndRepairedDeviceAreIndependent() throws {
        try fixture { outbox, _ in
            let original = event(), first = try binding()
            try outbox.append(original, binding: first)
            for other in [try binding(owner: "abcdef0123456789abcdef01"), try binding(device: "replacement-device"),
                          try binding(origin: "https://second.example.test")] {
                XCTAssertTrue(try outbox.next(binding: other).isEmpty)
                try outbox.clear(binding: other)
                XCTAssertEqual(try outbox.next(binding: first).first?.event, original)
            }
        }
    }
    func testOnlyExactAcknowledgedMembersOfSentBatchCanBeRemoved() throws {
        try fixture { outbox, _ in
            let binding = try binding(), one = event(), two = event()
            try outbox.append(one, binding: binding); try outbox.append(two, binding: binding)
            let sent = try outbox.next(binding: binding)
            XCTAssertThrowsError(try outbox.acknowledge([UUID().uuidString.lowercased()], from: sent, binding: binding))
            XCTAssertThrowsError(try outbox.acknowledge([one.eventId, one.eventId], from: sent, binding: binding))
            XCTAssertThrowsError(try outbox.acknowledge([one.eventId], from: [sent[0], sent[0]], binding: binding))
            XCTAssertEqual(try outbox.next(binding: binding).count, 2)
            try outbox.acknowledge([one.eventId], from: sent, binding: binding)
            XCTAssertEqual(try outbox.next(binding: binding).map(\.event.eventId), [two.eventId])
            // An interrupted local acknowledgment is safe to finish.
            try outbox.acknowledge([one.eventId, two.eventId], from: sent, binding: binding)
            XCTAssertTrue(try outbox.next(binding: binding).isEmpty)
        }
    }
    func testBatchBoundDoesNotTruncateQueuedHistoryAndClearIsScoped() throws {
        try fixture { outbox, _ in
            let binding = try binding(), other = try self.binding(device: "other-device")
            for _ in 0..<37 { try outbox.append(event(), binding: binding) }
            try outbox.append(event(), binding: other)
            let batch = try outbox.next(binding: binding)
            XCTAssertEqual(batch.count, 32)
            try outbox.acknowledge(batch.map(\.event.eventId), from: batch, binding: binding)
            XCTAssertEqual(try outbox.next(binding: binding).count, 5)
            try outbox.clear(binding: binding)
            XCTAssertTrue(try outbox.next(binding: binding).isEmpty)
            XCTAssertEqual(try outbox.next(binding: other).count, 1)
        }
    }
    func testCorruptEntryIsNotUploadedAndDoesNotBlockValidEvents() throws {
        try fixture { outbox, root in
            let binding = try binding(), original = event()
            try outbox.append(original, binding: binding)
            let bad = root.appendingPathComponent(binding.key).appendingPathComponent(UUID().uuidString.lowercased() + ".json")
            try Data(#"{"token":"not-a-real-secret","message":"must-not-upload"}"#.utf8).write(to: bad)
            let batch = try outbox.next(binding: binding)
            XCTAssertEqual(batch.map(\.event), [original])
            XCTAssertTrue(FileManager.default.fileExists(atPath: bad.appendingPathExtension("invalid").path))
        }
    }
    func testSafeWireProjectionDropsUnknownFieldsAndErrorUserInfo() throws {
        let secret = "fixture-value-must-never-leave-device"
        let error = NSError(domain: "NSURLErrorDomain", code: -1009,
                            userInfo: [NSLocalizedDescriptionKey: secret, "url": "https://example.test/?token=" + secret])
        var value = event(); value.systemError = .init(error: error)
        value.runKey = MobileDeviceDiagnosticEvent.correlationKey(runId: secret, epoch: UUID())
        let data = try value.encoded()
        XCTAssertFalse(String(decoding: data, as: UTF8.self).contains(secret))
        XCTAssertEqual(value.systemError?.code, -1009)
        XCTAssertNil(MobileDeviceDiagnosticEvent.SystemError(error: NSError(domain: secret, code: 1)))
        var decoded = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        decoded["rawError"] = ["token": secret]; decoded["photoPath"] = secret
        let restored = try JSONDecoder().decode(MobileDeviceDiagnosticEvent.self, from: JSONSerialization.data(withJSONObject: decoded))
        XCTAssertEqual(try restored.encoded(), data)
    }
    func testWireDatesAndMeasurementsRejectMalformedValuesWithoutTruncation() throws {
        var value = event()
        XCTAssertEqual(value.occurredAt, "2026-11-12T02:40:00.125Z")
        value.background = .init(outcome: .expired, measuredUnits: 100, lastProgressAt: value.occurredAt, applicationState: .background)
        value.counts = .init(indexedResources: 75_985)
        XCTAssertNoThrow(try value.validate())
        value.retryAt = "not-a-date"; XCTAssertThrowsError(try value.validate())
        value.retryAt = nil; value.counts?.uploadedBytes = -1
        XCTAssertThrowsError(try value.validate())
        XCTAssertNil(MobileDeviceDiagnosticEvent.measurement(-1))
        XCTAssertNil(MobileDeviceDiagnosticEvent.measurement(Int64.max))
        XCTAssertEqual(MobileDeviceDiagnosticEvent.measurement(60_185_117), 60_185_117)
        value.counts = nil; value.configurationId = "../escape"
        XCTAssertThrowsError(try value.validate())
    }
}
