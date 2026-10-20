import Foundation
import XCTest
@testable import ThingtimeNodeCore

final class IdentityAdmissionTestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0.0
    private var sleepers: [UUID: (Double, CheckedContinuation<Void, Error>)] = [:]
    let automatic: Bool
    init(automatic: Bool = false) { self.automatic = automatic }
    func now() -> Double { lock.withLock { value } }
    func advance(to time: Double) {
        let ready = lock.withLock { () -> [CheckedContinuation<Void, Error>] in
            value = max(value, time)
            let ids = sleepers.filter { $0.value.0 <= value }.map(\.key)
            return ids.compactMap { sleepers.removeValue(forKey: $0)?.1 }
        }
        for continuation in ready { continuation.resume() }
    }
    func sleep(_ duration: Double) async throws {
        try Task.checkCancellation()
        if automatic { advance(to: now() + duration); await Task.yield(); try Task.checkCancellation(); return }
        let id = UUID()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                lock.withLock { sleepers[id] = (value + duration, continuation) }
                if Task.isCancelled { cancel(id) }
            }
        } onCancel: { self.cancel(id) }
    }
    private func cancel(_ id: UUID) {
        lock.withLock { sleepers.removeValue(forKey: id)?.1 }?.resume(throwing: CancellationError())
    }
}

extension FileSyncIdentityAdmission {
    static func instantForTests() -> FileSyncIdentityAdmission {
        let clock = IdentityAdmissionTestClock(automatic: true)
        return FileSyncIdentityAdmission(now: { clock.now() }, sleep: { try await clock.sleep($0) })
    }
}

private actor IdentityStarts {
    var values: [(String, Double)] = []
    func add(_ name: String, _ time: Double) { values.append((name, time)) }
}

final class FileSyncIdentityAdmissionTests: XCTestCase {
    private func settle() async { for _ in 0..<100 { await Task.yield() } }
    private func queued(_ count: Int, _ admission: FileSyncIdentityAdmission) async throws {
        for _ in 0..<10_000 {
            if await admission.queuedForTesting == count { return }
            await Task.yield()
        }
        XCTFail("Admission queue did not reach expected state"); throw CancellationError()
    }
    func testInitialBurstHasNoForcedPostCompletionGapAndThirteenthWaitsForRefill() async throws {
        let clock = IdentityAdmissionTestClock(automatic: true)
        let admission = FileSyncIdentityAdmission(now: { clock.now() }, sleep: { try await clock.sleep($0) })
        for _ in 0..<12 {
            let permit = try await admission.acquire("scope"); try await admission.willSend(permit)
            await admission.finish(permit)
        }
        XCTAssertEqual(clock.now(), 0, "Initial burst must not impose a post-response gap")
        let next = try await admission.acquire("scope")
        XCTAssertGreaterThanOrEqual(clock.now(), 1.0 / 3)
        XCTAssertLessThan(clock.now(), 1.0 / 3 + 0.00001)
        try await admission.willSend(next); await admission.finish(next)
    }
    func testRepresentativeRPCScheduleTimingProof() async throws {
        let clock = IdentityAdmissionTestClock(automatic: true)
        let admission = FileSyncIdentityAdmission(now: { clock.now() }, sleep: { try await clock.sleep($0) })
        var starts: [Double] = []
        // Deterministic fixture: 13 RPCs, two fresh identity attempts per RPC,
        // each HTTP response takes 100ms. This is not a live speed prediction.
        for _ in 0..<26 {
            let permit = try await admission.acquire("scope"); try await admission.willSend(permit)
            starts.append(clock.now()); clock.advance(to: clock.now() + 0.1)
            await admission.finish(permit)
        }
        XCTAssertEqual(starts.count, 26)
        print("ADMISSION_SCHEDULE attempts=26 syntheticHTTPSeconds=0.1 elapsedSeconds=\(clock.now())")
    }

    func testConcurrentLanesRemainFIFOInsideTheBoundedBurst() async throws {
        let clock = IdentityAdmissionTestClock(automatic: true)
        let admission = FileSyncIdentityAdmission(now: { clock.now() }, sleep: { try await clock.sleep($0) })
        let first = try await admission.acquire("scope")
        try await admission.willSend(first)
        let starts = IdentityStarts()
        var tasks: [Task<Void, Error>] = []
        for lane in ["transfer-pre", "index", "monitor", "transfer-post", "index-next", "transfer-next"] {
            tasks.append(Task {
                let permit = try await admission.acquire("scope")
                try await admission.willSend(permit)
                await starts.add(lane, clock.now())
                await admission.finish(permit)
            })
            try await queued(tasks.count, admission)
        }
        await admission.finish(first)
        for task in tasks { try await task.value }
        let values = await starts.values
        XCTAssertEqual(values.map(\.0), ["transfer-pre", "index", "monitor", "transfer-post", "index-next", "transfer-next"])
        XCTAssertTrue(values.allSatisfy { $0.1 == 0 }, "FIFO does not require artificial post-response gaps")
    }
    func testDelayedHTTPStartCannotRefillThenSpendAThirteenthBurstToken() async throws {
        let clock = IdentityAdmissionTestClock(automatic: true)
        let admission = FileSyncIdentityAdmission(now: { clock.now() }, sleep: { try await clock.sleep($0) })
        for _ in 0..<11 {
            let permit = try await admission.acquire("scope"); try await admission.willSend(permit); await admission.finish(permit)
        }
        let delayed = try await admission.acquire("scope"); try await admission.willSend(delayed)
        // Deschedule before HTTP really starts. Charging at permit/willSend
        // would refill a complete 12-token burst and forget this late start.
        clock.advance(to: 10); await admission.finish(delayed)
        for _ in 0..<11 {
            let permit = try await admission.acquire("scope"); try await admission.willSend(permit)
            XCTAssertEqual(clock.now(), 10); await admission.finish(permit)
        }
        let last = try await admission.acquire("scope")
        XCTAssertGreaterThanOrEqual(clock.now(), 10 + 1.0 / 3)
        try await admission.willSend(last); await admission.finish(last)
    }

    func testRollingWindowCapsEveryOneHundredEightyFirstAttemptEvenWhenTokensRefill() async throws {
        let clock = IdentityAdmissionTestClock(automatic: true)
        let admission = FileSyncIdentityAdmission(now: { clock.now() }, sleep: { try await clock.sleep($0) })
        var starts: [Double] = []
        for _ in 0..<240 {
            let permit = try await admission.acquire("scope"); try await admission.willSend(permit)
            starts.append(clock.now()); await admission.finish(permit)
        }
        XCTAssertGreaterThanOrEqual(starts[180], 60)
        for (i, time) in starts.enumerated() {
            XCTAssertLessThanOrEqual(starts.prefix(i + 1).filter { $0 > time - 60 }.count, 180)
            for earlier in 0...i {
                XCTAssertLessThanOrEqual(Double(i - earlier + 1), 12 + 3 * (time - starts[earlier]) + 0.00001)
            }
        }
    }

    func testUnsentCancellationConsumesNoBudgetButWillSendCancellationIsConservativelyCharged() async throws {
        let clock = IdentityAdmissionTestClock(automatic: true)
        let admission = FileSyncIdentityAdmission(now: { clock.now() }, sleep: { try await clock.sleep($0) })
        let held = try await admission.acquire("scope")
        let cancelled = Task { try await admission.acquire("scope") }; try await queued(1, admission)
        cancelled.cancel()
        do { _ = try await cancelled.value; XCTFail("Cancelled waiter acquired") } catch { XCTAssertTrue(error is CancellationError) }
        await admission.finish(held)
        for _ in 0..<200 {
            let unsent = try await admission.acquire("scope"); await admission.finish(unsent)
        }
        XCTAssertEqual(clock.now(), 0)
        for _ in 0..<12 {
            let permit = try await admission.acquire("scope"); try await admission.willSend(permit)
            // Even cancellation before URLSession must charge after willSend:
            // the actor cannot prove that no HTTP attempt reached the server.
            await admission.finish(permit)
        }
        XCTAssertEqual(clock.now(), 0)
        let next = try await admission.acquire("scope")
        XCTAssertGreaterThanOrEqual(clock.now(), 1.0 / 3); await admission.finish(next)
    }

    func testEligibleScopeCannotBeEvictedWhileAnyRollingBudgetIsLive() async throws {
        let clock = IdentityAdmissionTestClock()
        let admission = FileSyncIdentityAdmission(now: { clock.now() }, sleep: { try await clock.sleep($0) }, maximumScopes: 1)
        let sent = try await admission.acquire("one"); try await admission.willSend(sent); await admission.finish(sent)
        // Tokens are fully refilled and another request is already eligible,
        // but deleting the scope here would reset its live rolling history.
        for time in [1.0, 59.999] {
            clock.advance(to: time)
            do { _ = try await admission.acquire("two"); XCTFail("Live rolling budget evicted") }
            catch { XCTAssertEqual(error as? FileSyncIdentityAdmission.Failure, .capacity) }
        }
        clock.advance(to: 60)
        let replacement = try await admission.acquire("two"); await admission.finish(replacement)
        // Truly unused/idle scopes retain no token debt/history/cooldown.
        let idleReplacement = try await admission.acquire("three"); await admission.finish(idleReplacement)
    }

    func testTimerFailureRetainsTokenDebtAndRecoversOnlyAfterRefill() async throws {
        struct TimerFailure: Error {}
        let clock = IdentityAdmissionTestClock()
        let admission = FileSyncIdentityAdmission(now: { clock.now() }, sleep: { _ in throw TimerFailure() })
        for _ in 0..<12 {
            let permit = try await admission.acquire("scope"); try await admission.willSend(permit); await admission.finish(permit)
        }
        for _ in 0..<2 {
            do { _ = try await admission.acquire("scope"); XCTFail("Timer failure discarded token debt") }
            catch { XCTAssertEqual(error as? FileSyncIdentityAdmission.Failure, .timer) }
        }
        clock.advance(to: 1)
        let recovered = try await admission.acquire("scope"); await admission.finish(recovered)
    }

    func testQueuedLanesRespectSharedCooldownWithoutRetryHerdAndCancellationUnblocksHead() async throws {
        let clock = IdentityAdmissionTestClock()
        let admission = FileSyncIdentityAdmission(now: { clock.now() }, sleep: { try await clock.sleep($0) })
        let first = try await admission.acquire("scope"); try await admission.willSend(first)
        let cancelled = Task { try await admission.acquire("scope") }; try await queued(1, admission)
        let next = Task { try await admission.acquire("scope") }; try await queued(2, admission)
        let tail = Task { try await admission.acquire("scope") }; try await queued(3, admission)
        await admission.finish(first, cooldownSeconds: 10); await settle()
        cancelled.cancel()
        do { _ = try await cancelled.value; XCTFail("Cancelled head acquired") } catch { XCTAssertTrue(error is CancellationError) }
        clock.advance(to: 9); await settle(); try await queued(2, admission)
        clock.advance(to: 10); await settle()
        let second = try await next.value; try await admission.willSend(second)
        // A later response extends the deadline for a lane that was already queued.
        await admission.finish(second, cooldownSeconds: 20); await settle()
        clock.advance(to: 29); await settle(); try await queued(1, admission)
        clock.advance(to: 30); await settle()
        let last = try await tail.value; try await admission.willSend(last)
        await admission.finish(last)
        XCTAssertEqual(clock.now(), 30)
    }
    func testScopeAndQueueBoundsNeverEvictLiveCooldownAndExpiredScopesCanBeReused() async throws {
        let clock = IdentityAdmissionTestClock()
        let admission = FileSyncIdentityAdmission(now: { clock.now() }, sleep: { try await clock.sleep($0) }, maximumScopes: 1, maximumWaiters: 1)
        let first = try await admission.acquire("one"); try await admission.willSend(first)
        let queued = Task { try await admission.acquire("one") }; try await self.queued(1, admission)
        do { _ = try await admission.acquire("one"); XCTFail("Unbounded waiter") } catch { XCTAssertTrue(error is FileSyncIdentityAdmission.Failure) }
        queued.cancel(); _ = try? await queued.value
        await admission.finish(first, cooldownSeconds: 60)
        do { _ = try await admission.acquire("two"); XCTFail("Live cooldown evicted") } catch { XCTAssertTrue(error is FileSyncIdentityAdmission.Failure) }
        clock.advance(to: 60)
        let replacement = try await admission.acquire("two"); await admission.finish(replacement)
    }
    func testTimerFailureFailsQueuedCallersWithoutDiscardingCooldownOrStrandingQueue() async throws {
        struct TimerFailure: Error {}
        let clock = IdentityAdmissionTestClock()
        let admission = FileSyncIdentityAdmission(now: { clock.now() }, sleep: { _ in throw TimerFailure() })
        let first = try await admission.acquire("scope"); try await admission.willSend(first)
        let next = Task { try await admission.acquire("scope") }; try await queued(1, admission)
        let tail = Task { try await admission.acquire("scope") }; try await queued(2, admission)
        await admission.finish(first, cooldownSeconds: 60)
        for task in [next, tail] {
            do { _ = try await task.value; XCTFail("Failed timer admitted HTTP") }
            catch { XCTAssertEqual(error as? FileSyncIdentityAdmission.Failure, .timer) }
        }
        let remaining = await admission.queuedForTesting
        XCTAssertEqual(remaining, 0)
        // A new caller still cannot bypass the retained server deadline.
        do { _ = try await admission.acquire("scope"); XCTFail("Cooldown bypassed") }
        catch { XCTAssertEqual(error as? FileSyncIdentityAdmission.Failure, .timer) }
        clock.advance(to: 60)
        let recovered = try await admission.acquire("scope")
        await admission.finish(recovered)
    }
    func testOriginCredentialScopesAreOpaqueCanonicalAndIndependent() async throws {
        let original = DeviceCredential(deviceID: "device", refreshToken: "synthetic-secret", signingPrivateKey: Data(), signingPublicKey: Data())
        let rotated = DeviceCredential(deviceID: "device", refreshToken: "rotated-secret", signingPrivateKey: Data(), signingPublicKey: Data())
        let a = FileSyncIdentityAdmission.scope(origin: URL(string: "https://example.test")!, credential: original)
        XCTAssertEqual(a, FileSyncIdentityAdmission.scope(origin: URL(string: "https://EXAMPLE.test:443/")!, credential: original))
        XCTAssertNotEqual(a, FileSyncIdentityAdmission.scope(origin: URL(string: "https://other.test")!, credential: original))
        XCTAssertNotEqual(a, FileSyncIdentityAdmission.scope(origin: URL(string: "https://example.test")!, credential: rotated))
        XCTAssertEqual(a.count, 64); XCTAssertFalse(a.contains("secret"))
        let admission = FileSyncIdentityAdmission.instantForTests()
        let held = try await admission.acquire(a)
        let other = try await admission.acquire("other-origin")
        await admission.finish(other); await admission.finish(held)
    }
}
