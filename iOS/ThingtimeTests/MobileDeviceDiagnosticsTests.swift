import AppleFileSync
import XCTest
@testable import Thingtime

@MainActor
private final class DiagnosticsTransportFixture: MobileDeviceDiagnosticsTransporting {
    var enabled = true
    var statusCalls = 0
    var batches: [[MobileDeviceDiagnosticEvent]] = []
    var send: (([MobileDeviceDiagnosticEvent], @escaping () throws -> Void) async throws -> (Bool, [String]))?
    func status(_ binding: MobileDeviceDiagnosticOutbox.Binding, check: @escaping () throws -> Void) async throws -> Bool {
        try check(); statusCalls += 1; return enabled
    }
    func append(_ events: [MobileDeviceDiagnosticEvent], binding: MobileDeviceDiagnosticOutbox.Binding,
                check: @escaping () throws -> Void) async throws -> (enabled: Bool, acknowledged: [String]) {
        try check(); batches.append(events)
        if let send { return try await send(events, check) }
        return (enabled, enabled ? events.map(\.eventId) : [])
    }
}

@MainActor
final class MobileDeviceDiagnosticsTests: XCTestCase {
    private let scope = try! FileSyncOwnerScope(ownerId: "0123456789abcdef01234567", url: URL(string: "https://example.test")!)
    private func fixture(_ body: (MobileDeviceDiagnosticOutbox, DiagnosticsTransportFixture) async throws -> Void) async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("diagnostics-coordinator-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        try await body(.init(root: root), .init())
    }
    private func event(_ code: MobileDeviceDiagnosticEvent.Code = .failed) -> MobileDeviceDiagnosticEvent {
        .init(category: .sync, level: .error, code: code, state: .failed)
    }
    func testAmbiguousFailureRetainsImmutableEventsAndResumesWithoutRetryButton() async throws {
        try await fixture { outbox, transport in
            var clock = Date(), saved: MobileDeviceDiagnostics.SavedState?
            transport.send = { _, _ in throw URLError(.networkConnectionLost) }
            let first = MobileDeviceDiagnostics(outbox: outbox, transport: transport, load: { saved }, save: { saved = $0 }, now: { clock }, automaticRetries: false)
            first.verified(scope, deviceId: "device-a")
            let event = event(); first.recorder(for: scope, expectedDeviceId: "device-a")?(event)
            await first.flushAndWait()
            let binding = MobileDeviceDiagnosticOutbox.Binding(scope: scope, deviceId: "device-a")
            let queued = try outbox.next(binding: binding)
            XCTAssertTrue(queued.contains { $0.event == event })
            XCTAssertNotNil(saved?.retryAt)
            let attempts = transport.batches.count
            first.verified(scope, deviceId: "device-a"); await first.flushAndWait()
            XCTAssertEqual(transport.batches.count, attempts, "Repeated pairing status preserves backoff")
            clock = clock.addingTimeInterval(31)
            transport.send = nil
            let restored = MobileDeviceDiagnostics(outbox: outbox, transport: transport, load: { saved }, save: { saved = $0 }, now: { clock }, automaticRetries: false)
            restored.activate(); await restored.flushAndWait()
            XCTAssertTrue(try outbox.next(binding: binding).isEmpty)
            XCTAssertTrue(transport.batches.last?.contains(event) == true)
        }
    }
    func testDisabledCaptureSurvivesRelaunchAndForegroundCanReenable() async throws {
        try await fixture { outbox, transport in
            var saved: MobileDeviceDiagnostics.SavedState?
            transport.enabled = false
            let first = MobileDeviceDiagnostics(outbox: outbox, transport: transport, load: { saved }, save: { saved = $0 }, automaticRetries: false)
            first.verified(scope, deviceId: "device-a"); await first.flushAndWait()
            let binding = MobileDeviceDiagnosticOutbox.Binding(scope: scope, deviceId: "device-a")
            XCTAssertTrue(saved?.disabledBindings.contains(binding.key) == true)
            first.recorder(for: scope, expectedDeviceId: "device-a")?(event())
            XCTAssertTrue(try outbox.next(binding: binding).isEmpty)
            let restored = MobileDeviceDiagnostics(outbox: outbox, transport: transport, load: { saved }, save: { saved = $0 }, automaticRetries: false)
            restored.activate(); await restored.flushAndWait()
            XCTAssertTrue(transport.batches.isEmpty)
            transport.enabled = true; restored.foreground(); await restored.flushAndWait()
            let fresh = event(); restored.recorder(for: scope, expectedDeviceId: "device-a")?(fresh)
            await restored.flushAndWait()
            XCTAssertTrue(transport.batches.last?.contains(fresh) == true)
        }
    }
    func testOldRecorderAndOldAcknowledgmentCannotTouchReplacementPairing() async throws {
        try await fixture { outbox, transport in
            let coordinator = MobileDeviceDiagnostics(outbox: outbox, transport: transport, automaticRetries: false)
            coordinator.verified(scope, deviceId: "device-a"); await coordinator.flushAndWait()
            let oldRecorder = try XCTUnwrap(coordinator.recorder(for: scope, expectedDeviceId: "device-a"))
            let old = event(); oldRecorder(old)
            transport.send = { events, check in
                coordinator.verified(self.scope, deviceId: "device-b")
                try check()
                return (true, events.map(\.eventId))
            }
            await coordinator.flushAndWait()
            transport.send = nil
            oldRecorder(event())
            XCTAssertNil(coordinator.recorder(for: scope, expectedDeviceId: "device-a"))
            let oldQueue = try outbox.next(binding: .init(scope: scope, deviceId: "device-a"))
            XCTAssertEqual(oldQueue.map(\.event.eventId), [old.eventId])
            await coordinator.flushAndWait()
            XCTAssertFalse(transport.batches.last?.contains(old) == true)
            coordinator.suspendAuthorization()
            XCTAssertNil(coordinator.recorder(for: scope, expectedDeviceId: "device-b"))
        }
    }
    func testRejectedEntryDoesNotBlockLaterEventsAndLargeBatchesSplit() async throws {
        try await fixture { outbox, transport in
            let binding = MobileDeviceDiagnosticOutbox.Binding(scope: scope, deviceId: "device-a")
            let bad = event(), good = event()
            try outbox.append(bad, binding: binding); try outbox.append(good, binding: binding)
            transport.send = { events, _ in
                if events.count > 1 { throw MobileDeviceNodeTransport.Failure.http(413, "DIAGNOSTIC_BATCH") }
                if events[0].eventId == bad.eventId { throw MobileDeviceNodeTransport.Failure.http(403, "DIAGNOSTIC_CONFIGURATION") }
                return (true, events.map(\.eventId))
            }
            let coordinator = MobileDeviceDiagnostics(outbox: outbox, transport: transport, automaticRetries: false)
            coordinator.verified(scope, deviceId: "device-a"); await coordinator.flushAndWait()
            XCTAssertTrue(try outbox.next(binding: binding).isEmpty)
            XCTAssertTrue(transport.batches.contains { $0 == [good] })
            let rejected = outbox.root.appendingPathComponent(binding.key).appendingPathComponent(bad.eventId + ".json.rejected")
            XCTAssertTrue(FileManager.default.fileExists(atPath: rejected.path))
        }
    }
    func testSnapshotSamplingKeepsPhaseChangesAndErrorsImmediately() async throws {
        try await fixture { outbox, transport in
            var clock = Date()
            transport.send = { _, _ in throw URLError(.notConnectedToInternet) }
            let coordinator = MobileDeviceDiagnostics(outbox: outbox, transport: transport, now: { clock }, automaticRetries: false)
            coordinator.verified(scope, deviceId: "device-a"); await coordinator.flushAndWait()
            let record = try XCTUnwrap(coordinator.recorder(for: scope, expectedDeviceId: "device-a"))
            var first = event(.snapshot); first.phase = .indexing
            record(first)
            var duplicatePhase = event(.snapshot); duplicatePhase.phase = .indexing
            record(duplicatePhase)
            var nextPhase = event(.snapshot); nextPhase.phase = .uploading
            record(nextPhase)
            let failure = event(); record(failure)
            clock = clock.addingTimeInterval(11); record(duplicatePhase)
            let queued = try outbox.next(binding: .init(scope: scope, deviceId: "device-a")).map(\.event.eventId)
            XCTAssertTrue([first.eventId, duplicatePhase.eventId, nextPhase.eventId, failure.eventId].allSatisfy(queued.contains))
            XCTAssertEqual(queued.filter { $0 == duplicatePhase.eventId }.count, 1)
        }
    }
    func testServerRetryDeadlineSurvivesForegroundAndRelaunch() async throws {
        try await fixture { outbox, transport in
            var clock = Date(), saved: MobileDeviceDiagnostics.SavedState?
            let until = clock.addingTimeInterval(600)
            transport.send = { _, _ in throw MobileDeviceDiagnosticsTransport.Failure.rateLimited(until: until) }
            let first = MobileDeviceDiagnostics(outbox: outbox, transport: transport, load: { saved }, save: { saved = $0 }, now: { clock }, automaticRetries: false)
            first.verified(scope, deviceId: "device-a"); await first.flushAndWait()
            let attempts = transport.batches.count
            clock = clock.addingTimeInterval(31); first.foreground(); await first.flushAndWait()
            XCTAssertEqual(transport.batches.count, attempts)
            XCTAssertEqual(saved?.serverRetryAt, until)
            let restored = MobileDeviceDiagnostics(outbox: outbox, transport: transport, load: { saved }, save: { saved = $0 }, now: { clock }, automaticRetries: false)
            restored.activate(); restored.foreground(); await restored.flushAndWait()
            XCTAssertEqual(transport.batches.count, attempts)
            transport.send = nil; clock = until.addingTimeInterval(1)
            await restored.flushAndWait()
            XCTAssertTrue(try outbox.next(binding: .init(scope: scope, deviceId: "device-a")).isEmpty)
        }
    }
    func testRetryAfterParsesSecondsAndHTTPDateWithoutRetainingHeaders() {
        let now = Date(timeIntervalSince1970: 1_794_451_200)
        XCTAssertEqual(MobileDeviceNodeTransport.retryDate("600", now: now), now.addingTimeInterval(600))
        XCTAssertEqual(MobileDeviceNodeTransport.retryDate("Thu, 12 Nov 2026 02:50:00 GMT", now: now), now.addingTimeInterval(600))
        XCTAssertNil(MobileDeviceNodeTransport.retryDate("-3", now: now))
        XCTAssertNil(MobileDeviceNodeTransport.retryDate("token=not-a-header", now: now))
    }
}
