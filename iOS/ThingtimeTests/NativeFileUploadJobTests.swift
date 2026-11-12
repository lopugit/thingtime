import XCTest
import AppleFileSync
import CryptoKit
import UIKit
@testable import Thingtime

@MainActor
private struct DeferredUploadTestScheduler: NativeDeferredUploadScheduling {
    func register(_ handle: @escaping (NativeDeferredUploadSystemTask) -> Void) -> Bool { true }
    func submit(earliest: Date, charging: Bool) throws {}
    func cancel() {}
}

private actor PhotoBatchTestGate {
    private var opened = false
    private var waiters: [CheckedContinuation<Void, Never>] = []
    func wait() async {
        if opened { return }
        await withCheckedContinuation { waiters.append($0) }
    }
    func open() {
        opened = true
        let pending = waiters; waiters.removeAll()
        for waiter in pending { waiter.resume() }
    }
}

@MainActor
final class NativeFileUploadJobTests: XCTestCase {
    private let root = "11111111-1111-4111-8111-111111111111"
    private func authorization(sourceKind: String? = nil) throws -> NativeUploadAuthorization {
        var config: [String: Any] = ["configurationVersion": 1, "name": "Backup", "deviceId": "device", "localRootId": root,
            "remoteFolderId": "cloud", "mode": "backup", "paused": false, "propagateDeletes": false,
            "network": "wifi", "chargingOnly": true, "excludedPaths": [String]()]
        config["sourceKind"] = sourceKind
        return try JSONDecoder().decode(NativeUploadAuthorization.self, from: JSONSerialization.data(withJSONObject:
            ["id": "connection", "updatedAt": "2026-10-18T00:00:00Z", "configuration": config,
             "scope": ["ownerId": "owner", "origin": "https://sync.test", "dataPlane": "home", "deviceId": "device", "rootId": "connection"]]))
    }
    private func fixture() throws -> (NativeUploadFileRequest, String) {
        let part = Data(repeating: 7, count: 32), digest = part.map { String(format: "%02x", $0) }.joined()
        var hash = SHA256(); hash.update(data: part); hash.update(data: part); hash.update(data: part)
        let fingerprint = MobileFolderReader.Fingerprint(partSizeBytes: 8 * 1024 * 1024, partCount: 3,
            sha256: hash.finalize().map { String(format: "%02x", $0) }.joined())
        let source = MobileFolderReader.Entry(path: "file.bin", id: "file", version: "v1", kind: "file", size: 16 * 1024 * 1024 + 1, sha256: nil, fingerprint: fingerprint)
        return (NativeUploadFileRequest(source: source, uploadId: "upload", requestId: "operation", authorization: try authorization()), digest)
    }

    func testSourceIndexRotationReconcilesStaleJournalWithoutChangingByteEpoch() throws {
        let scope = try FileSyncOwnerScope(ownerId: "owner", url: URL(string: "https://sync.test")!)
        var run = NativePhotoRunRecord(scope: scope, authorization: try authorization(sourceKind: "photos"),
            grantRevision: String(repeating: "a", count: 64), runId: "run", expiresAt: Date().addingTimeInterval(3600))
        let byteEpoch = run.epoch
        try run.recordSourceIndexReceipt(indexId: "old-index", metadataEpoch: "old-metadata", sequence: 40)
        // Durable outbox rotation happened, but its journal checkpoint did not.
        let data = try JSONEncoder().encode(run)
        var restarted = try JSONDecoder().decode(NativePhotoRunRecord.self, from: data)
        try restarted.recordSourceIndexReceipt(indexId: "new-index", metadataEpoch: "new-metadata", sequence: 1)
        XCTAssertEqual(restarted.epoch, byteEpoch)
        XCTAssertEqual(restarted.sourceIndexId, "new-index")
        XCTAssertEqual(restarted.sourceIndexAcknowledgedSequence, 1)
        XCTAssertThrowsError(try restarted.recordSourceIndexReceipt(indexId: "wrong-index", metadataEpoch: "new-metadata", sequence: 2))
    }

    func testPhotoRunStoreReloadsThroughDirectoryAliasAndRejectsWrongKey() throws {
        let files = FileManager.default
        let directory = files.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let real = directory.appendingPathComponent("real", isDirectory: true)
        let alias = directory.appendingPathComponent("alias", isDirectory: true)
        try files.createDirectory(at: real, withIntermediateDirectories: true)
        defer { try? files.removeItem(at: directory) }
        try files.createSymbolicLink(at: alias, withDestinationURL: real)
        let scope = try FileSyncOwnerScope(ownerId: "owner", url: URL(string: "https://sync.test")!)
        let run = NativePhotoRunRecord(scope: scope, authorization: try authorization(sourceKind: "photos"),
            grantRevision: String(repeating: "a", count: 64), runId: "run", expiresAt: .distantFuture, foregroundOwner: true)
        try NativePhotoRunStore(directory: alias).write(run)

        let reopened = NativePhotoRunStore(directory: alias)
        XCTAssertEqual(try reopened.load(), [run])
        XCTAssertEqual(try reopened.lookup(run), run)

        let stored = real.appendingPathComponent("NativePhotoRuns-v1", isDirectory: true)
        let file = try XCTUnwrap(files.contentsOfDirectory(at: stored, includingPropertiesForKeys: nil).first)
        try files.moveItem(at: file, to: stored.appendingPathComponent("other.json"))
        XCTAssertThrowsError(try reopened.load()) {
            XCTAssertEqual($0 as? MobileFolderStore.Failure, .invalid)
        }
    }

    func testFreshAuthorizationClearsOnlyAuthorityRefusalAndKeepsQueueCheckpoint() throws {
        let scope = try FileSyncOwnerScope(ownerId: "owner", url: URL(string: "https://sync.test")!)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NativePhotoRunStore(directory: directory)
        let worker = NativeDeferredUpload(store: .init(directory: directory), scheduler: DeferredUploadTestScheduler())
        worker.activate(foreground: false)
        let auth = try authorization(sourceKind: "photos"), grant = String(repeating: "a", count: 64)
        let expiry = Date(timeIntervalSinceNow: 3600)
        for reason: NativePhotoRunActivity.Reason in [.savedSettings, .transferPermission, .transferExpired, .transferMissing, .transferState] {
            var old = NativePhotoRunRecord(scope: scope, authorization: auth, grantRevision: grant, runId: "old", expiresAt: expiry)
            old.captureId = UUID().uuidString.lowercased()
            old.armed = false; old.stage = "needs-review"; old.retryAt = Date(timeIntervalSinceNow: 300)
            old.activity = .init(phase: .waiting, reason: reason)
            try store.write(old)
            let renewed = NativePhotoRunRecord(scope: scope, authorization: auth, grantRevision: grant, runId: "fresh", expiresAt: expiry)
            XCTAssertTrue(try worker.armPhotoRun(renewed))
            let saved = try XCTUnwrap(store.lookup(renewed))
            XCTAssertTrue(saved.armed); XCTAssertEqual(saved.stage, "ready")
            XCTAssertLessThan(saved.retryAt, Date()); XCTAssertNil(saved.activity?.reason)
            XCTAssertEqual(saved.epoch, old.epoch); XCTAssertEqual(saved.captureId, old.captureId)
            var paused = old; paused.pauseByUser(); try store.write(paused)
            XCTAssertThrowsError(try worker.armPhotoRun(renewed))
        }
    }

    func testInterruptedPhotosRemainArmedAndLegacyHoldRenewsAtExactCheckpoint() throws {
        let scope = try FileSyncOwnerScope(ownerId: "owner", url: URL(string: "https://sync.test")!)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NativePhotoRunStore(directory: directory)
        let worker = NativeDeferredUpload(store: .init(directory: directory), scheduler: DeferredUploadTestScheduler())
        worker.activate(foreground: false)
        let auth = try authorization(sourceKind: "photos")
        let grant = String(repeating: "a", count: 64)
        let expiry = Date(timeIntervalSinceNow: 3600)
        var old = NativePhotoRunRecord(scope: scope, authorization: auth, grantRevision: grant, runId: "old", expiresAt: expiry)
        old.captureId = UUID().uuidString.lowercased()
        let now = Date()
        old.deferAfterSystemInterruption(now: now)
        XCTAssertTrue(old.armed)
        XCTAssertEqual(old.stage, "waiting")
        XCTAssertEqual(old.retryAt, now.addingTimeInterval(300))

        old.armed = false; old.continuedHold = true
        try store.write(old)
        XCTAssertEqual(try store.lookup(old)?.legacySystemInterruption, true)
        let renewed = NativePhotoRunRecord(scope: scope, authorization: auth, grantRevision: grant, runId: "new", expiresAt: expiry)
        XCTAssertTrue(try worker.armPhotoRun(renewed))
        var current = try XCTUnwrap(store.lookup(renewed))
        XCTAssertEqual(current.epoch, old.epoch)
        XCTAssertEqual(current.captureId, old.captureId)
        XCTAssertEqual(current.stage, "ready")
        XCTAssertTrue(current.armed)
        XCTAssertNil(current.continuedHold)
        XCTAssertThrowsError(try store.update(old), "Expired work cannot update a replacement run")

        current.pauseByUser()
        try store.write(current)
        current.deferAfterSystemInterruption(now: now)
        XCTAssertEqual(current.stage, "paused")
        XCTAssertFalse(current.armed)
        XCTAssertThrowsError(try worker.armPhotoRun(renewed), "Ordinary retries respect the durable Pause")
        let replacedGrant = NativePhotoRunRecord(scope: scope, authorization: auth, grantRevision: String(repeating: "b", count: 64),
            runId: "replacement-grant", expiresAt: expiry)
        XCTAssertThrowsError(try worker.armPhotoRun(replacedGrant), "A renewed grant does not undo a deliberate Pause")
        XCTAssertTrue(try worker.armPhotoRun(renewed, explicitResume: true))
        XCTAssertEqual(try store.lookup(renewed)?.armed, true)
        XCTAssertNil(try store.lookup(renewed)?.userPaused)
    }

    private func budgetWaitingRun(now: Date) throws -> NativePhotoRunRecord {
        let scope = try FileSyncOwnerScope(ownerId: "owner", url: URL(string: "https://sync.test")!)
        var run = NativePhotoRunRecord(scope: scope, authorization: try authorization(sourceKind: "photos"),
            grantRevision: String(repeating: "a", count: 64), runId: "run", expiresAt: now.addingTimeInterval(7200), foregroundOwner: true)
        run.captureId = UUID().uuidString.lowercased(); run.stage = "uploading"
        run.batch = try JSONDecoder().decode(PhotoBackupQueueBatch.self, from: JSONSerialization.data(withJSONObject: [
            "epoch": run.epoch.uuidString, "id": UUID().uuidString, "assetKeys": ["first", "second"], "pending": 0, "unavailable": 0]))
        run.activity = .init(phase: .uploading, backlogOriginals: 1, backgroundRequest: .active)
        return run
    }

    func testOneBudgetWaitDrainsAllowedUploadAndRetryDoesNotReplayItsReceipt() async throws {
        let scope = try FileSyncOwnerScope(ownerId: "owner", url: URL(string: "https://sync.test")!)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let budget = NativePhotoUploadBudget(directory: directory), started = PhotoBatchTestGate(), waiting = PhotoBatchTestGate()
        let now = Date(timeIntervalSince1970: 6000)
        var receipts = Set<Int>(), uploads: [Int: Int] = [:], batchAcknowledged = false
        let run = try budgetWaitingRun(now: now), store = NativePhotoRunStore(directory: directory)
        try store.write(run)
        var continuedSliceSucceeded = false
        do {
            try await NativeDeferredUpload.processPhotoOriginals([1, 2], concurrency: 2) { original in
                if original == 2 { await started.wait() }
                let lease: NativePhotoUploadBudget.Lease
                do { lease = try budget.reserve(scope: scope, deviceId: "device", bytes: 80, cap: 100, now: now) }
                catch let wait as NativePhotoUploadBudget.Wait {
                    await waiting.open(); throw wait
                }
                uploads[original, default: 0] += 1
                await started.open(); await waiting.wait()
                try Task.checkCancellation()
                try budget.finish(lease, observedBytes: 80, now: now)
                receipts.insert(original)
            }
            batchAcknowledged = true
            XCTFail("The incomplete batch must retain its queue checkpoint")
        } catch let wait as NativePhotoUploadBudget.Wait {
            XCTAssertNotNil(wait.retryAt)
            let committed = try await NativeDeferredUpload.checkpointPhotoBudgetWait(run, wait: wait, now: { now }, check: {},
                verifyAuthority: {}, read: { try store.lookup(run) }, write: { try store.update($0) })
            continuedSliceSucceeded = true
            XCTAssertEqual(try store.lookup(run), committed)
            XCTAssertEqual(committed.stage, "waiting"); XCTAssertEqual(committed.syncWait, "data-budget")
            XCTAssertEqual(committed.batch, run.batch); XCTAssertEqual(committed.captureId, run.captureId)
            XCTAssertEqual(committed.activity?.backlogOriginals, 1); XCTAssertEqual(committed.activity?.backgroundRequest, .waiting)
        }
        XCTAssertTrue(continuedSliceSucceeded, "The durable incomplete slice can finish successfully without acknowledging the batch")
        XCTAssertEqual(receipts, [1], "Waiting sibling cannot cancel the already admitted upload")
        XCTAssertFalse(batchAcknowledged)
        try await NativeDeferredUpload.processPhotoOriginals([1, 2], concurrency: 2) { original in
            if receipts.contains(original) { return }
            let later = now.addingTimeInterval(7200)
            let lease = try budget.reserve(scope: scope, deviceId: "device", bytes: 80, cap: 100, now: later)
            uploads[original, default: 0] += 1
            try budget.finish(lease, observedBytes: 80, now: later)
            receipts.insert(original)
        }
        batchAcknowledged = true
        XCTAssertTrue(batchAcknowledged); XCTAssertEqual(receipts, [1, 2]); XCTAssertEqual(uploads, [1: 1, 2: 1])
    }

    func testPolicyEditReconsidersOnlyMatchingArmedHourlyWaitsAndKeepsPause() throws {
        for scenario in ["same", "folder", "device", "owner", "paused"] {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: directory) }
            let store = NativePhotoRunStore(directory: directory)
            var run = try budgetWaitingRun(now: Date())
            run.stage = "waiting"; run.syncWait = "data-budget"; run.retryAt = Date(timeIntervalSinceNow: 3_600)
            if scenario == "paused" { run.pauseByUser() }
            try store.write(run)
            let worker = NativeDeferredUpload(store: .init(directory: directory), scheduler: DeferredUploadTestScheduler())
            let selected = scenario == "owner" ? try FileSyncOwnerScope(ownerId: "other", url: run.scope.origin) : run.scope
            try worker.uploadPolicyChanged(scope: selected, deviceId: scenario == "device" ? "other" : run.authorization.scope.deviceId,
                rootId: scenario == "folder" ? "other" : run.rootId)
            let actual = try XCTUnwrap(store.lookup(run))
            if scenario == "same" { var expected = run; expected.retryAt = .distantPast; XCTAssertEqual(actual, expected) }
            else { XCTAssertEqual(actual, run) }
        }
    }

    func testLateVerifiedIdentityStartsPersistedDueRunOnceAfterAlreadyActiveEvent() async throws {
        XCTAssertEqual(UIApplication.shared.applicationState, .active, "Run this lifecycle regression in an active installed test host")
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NativePhotoRunStore(directory: directory), run = try budgetWaitingRun(now: Date())
        try store.write(run)
        let authorityAttempted = expectation(description: "Persisted due run reaches its real native authority guard")
        var grantReads = 0
        let grants = MobileFolderStore(load: { scope in
            XCTAssertEqual(scope, run.scope); grantReads += 1; authorityAttempted.fulfill()
            // Stop at the real grant boundary. No permission, PhotoKit content,
            // device credential or HTTP response is fabricated by this test.
            throw NativePhotoRunActivity.SourceFailure.grantChanged
        }, save: { _, _ in XCTFail("Lifecycle kickoff cannot grant folder access") })
        let worker = NativeDeferredUpload(store: .init(directory: directory), scheduler: DeferredUploadTestScheduler(), grants: grants)
        worker.activate(foreground: true)
        NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil)
        await Task.yield()
        XCTAssertEqual(grantReads, 0, "An active event alone cannot start an unverified owner")
        XCTAssertEqual(try store.lookup(run), run)
        worker.verifiedForegroundScope(run.scope)
        worker.verifiedForegroundScope(run.scope)
        await fulfillment(of: [authorityAttempted], timeout: 2)
        let stopped = try XCTUnwrap(store.lookup(run))
        XCTAssertEqual(grantReads, 1, "Repeated identity verification must reuse the sole worker")
        XCTAssertEqual(stopped.stage, "needs-review"); XCTAssertFalse(stopped.armed)
        XCTAssertEqual(stopped.activity?.reason, .grantChanged, "Starting the worker still enforces native authority")
        XCTAssertEqual(stopped.epoch, run.epoch); XCTAssertEqual(stopped.batch, run.batch)
        XCTAssertEqual(stopped.captureId, run.captureId)
        worker.disarm(matching: run.scope)
    }

    func testLateIdentityKeepsPausedFutureAndOtherOwnerRunsUnstarted() async throws {
        XCTAssertEqual(UIApplication.shared.applicationState, .active)
        for scenario in ["paused", "future", "other-owner"] {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: directory) }
            let store = NativePhotoRunStore(directory: directory)
            var run = try budgetWaitingRun(now: Date())
            if scenario == "paused" { run.pauseByUser() }
            if scenario == "future" { run.stage = "waiting"; run.retryAt = Date(timeIntervalSinceNow: 60) }
            try store.write(run)
            let unstarted = expectation(description: "\(scenario) cannot enter native execution")
            unstarted.isInverted = true
            let grants = MobileFolderStore(load: { _ in unstarted.fulfill(); throw NativePhotoRunActivity.SourceFailure.grantChanged },
                save: { _, _ in XCTFail("Identity verification cannot grant access") })
            let worker = NativeDeferredUpload(store: .init(directory: directory), scheduler: DeferredUploadTestScheduler(), grants: grants)
            worker.activate(foreground: true)
            NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil)
            let verified = scenario == "other-owner" ? try FileSyncOwnerScope(ownerId: "other", url: run.scope.origin) : run.scope
            worker.verifiedForegroundScope(verified)
            await fulfillment(of: [unstarted], timeout: 0.15)
            let saved = try XCTUnwrap(store.lookup(run))
            if scenario == "other-owner" { XCTAssertFalse(saved.armed) }
            else { XCTAssertEqual(saved, run, "\(scenario) checkpoint must remain intact") }
            worker.disarm(matching: run.scope)
        }
    }

    func testKnownBudgetDeadlineSurvivesDurableCheckpointWithoutFiveMinuteInflation() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NativePhotoRunStore(directory: directory), now = Date(timeIntervalSince1970: 6000)
        let cases: [(String, NativePhotoUploadBudget.Wait, Date)] = [
            ("pacing", .init(retryAt: now.addingTimeInterval(13)), now.addingTimeInterval(13)),
            ("hourly", .init(retryAt: now.addingTimeInterval(3600)), now.addingTimeInterval(3600)),
            ("unknown", .init(retryAt: nil), now.addingTimeInterval(300)),
            ("past", .init(retryAt: now.addingTimeInterval(-13)), now.addingTimeInterval(1))]
        for (name, wait, expected) in cases {
            var run = try budgetWaitingRun(now: now)
            run.retryAt = now.addingTimeInterval(300) // Retained older-build backoff is superseded by a fresh known deadline.
            try store.write(run)
            let committed = try await NativeDeferredUpload.checkpointPhotoBudgetWait(run, wait: wait, now: { now },
                check: {}, verifyAuthority: {}, read: { try store.lookup(run) }, write: { try store.update($0) })
            XCTAssertEqual(committed.retryAt, expected, name)
            XCTAssertEqual(try store.lookup(run)?.retryAt, expected, "Exact deadline must survive durable readback")
            XCTAssertGreaterThan(committed.retryAt, now, "Even a stale pacing deadline must not busy-loop")
            XCTAssertEqual(committed.batch, run.batch); XCTAssertEqual(committed.captureId, run.captureId)
            XCTAssertEqual(committed.stage, "waiting"); XCTAssertTrue(committed.armed)
        }
        XCTAssertEqual(NativeDeferredUpload.budgetRetryDeadline(nil, now: now), now.addingTimeInterval(300), "Unclassified transient failures retain their backoff")
    }

    func testBudgetWaitCannotSettleOnAuthorityExpiryCancellationOrCheckpointFailure() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NativePhotoRunStore(directory: directory), now = Date(timeIntervalSince1970: 6000)
        let original = try budgetWaitingRun(now: now), wait = NativePhotoUploadBudget.Wait(retryAt: now.addingTimeInterval(600))
        for scenario in ["authority", "network", "expired", "cancelled", "write", "readback", "paused"] {
            try store.write(original)
            var clock = now, wrote = false, settled = false
            do {
                _ = try await NativeDeferredUpload.checkpointPhotoBudgetWait(original, wait: wait, now: { clock }, check: {
                    if scenario == "cancelled" { throw CancellationError() }
                }, verifyAuthority: {
                    if scenario == "authority" { throw NativeDeferredUploadClient.Failure.denied }
                    if scenario == "network" { throw URLError(.notConnectedToInternet) }
                    if scenario == "expired" { clock = original.expiresAt }
                    if scenario == "paused" { var paused = original; paused.pauseByUser(); try store.write(paused) }
                }, read: {
                    var current = try store.lookup(original)
                    if scenario == "readback", wrote { current?.stage = "uploading" }
                    return current
                }, write: {
                    if scenario == "write" { throw CocoaError(.fileWriteNoPermission) }
                    try store.update($0); wrote = true
                })
                settled = true
            } catch {
                if scenario == "authority" { XCTAssertEqual(NativeDeferredUploadClient.failure(error), .denied) }
                if scenario == "network" { XCTAssertEqual((error as? URLError)?.code, .notConnectedToInternet) }
                if scenario == "expired" { XCTAssertEqual(NativeDeferredUploadClient.failure(error), .expired) }
                if ["paused", "cancelled"].contains(scenario) { XCTAssertTrue(error is CancellationError) }
                if scenario == "readback" { XCTAssertEqual(NativeDeferredUploadClient.failure(error), .invalid) }
            }
            XCTAssertFalse(settled, "\(scenario) must never report a successful continued slice")
            if scenario != "readback" { XCTAssertFalse(wrote) }
        }
    }

    func testFatalPhotoAuthorityFailureStillCancelsAdmittedSibling() async throws {
        let started = PhotoBatchTestGate()
        var siblingCancelled = false
        do {
            try await NativeDeferredUpload.processPhotoOriginals([1, 2], concurrency: 2) { original in
                if original == 2 {
                    await started.wait(); throw NativeDeferredUploadClient.Failure.denied
                }
                await started.open()
                do { try await Task.sleep(for: .seconds(60)) }
                catch { siblingCancelled = Task.isCancelled; throw error }
            }
            XCTFail("A revoked authority must fail the batch")
        } catch { XCTAssertEqual(NativeDeferredUploadClient.failure(error), .denied) }
        XCTAssertTrue(siblingCancelled)
    }

    func testDeviceBudgetCountsPartialRetryAndRetainsUncertainBytesAcrossRelaunch() throws {
        let owner = try FileSyncOwnerScope(ownerId: "owner", url: URL(string: "https://sync.test")!)
        let other = try FileSyncOwnerScope(ownerId: "other", url: owner.origin)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let budget = NativePhotoUploadBudget(directory: directory)
        let now = Date(timeIntervalSince1970: 6000)
        let first = try budget.reserve(scope: owner, deviceId: "device", bytes: 80, cap: 100, now: now)
        try budget.finish(first, observedBytes: 30, now: now.addingTimeInterval(1))
        XCTAssertThrowsError(try budget.reserve(scope: owner, deviceId: "device", bytes: 80, cap: 100, now: now.addingTimeInterval(2))) {
            XCTAssertEqual(($0 as? NativePhotoUploadBudget.Wait)?.retryAt, now.addingTimeInterval(3660))
        }
        XCTAssertThrowsError(try budget.reserve(scope: owner, deviceId: "device", bytes: 120, cap: 100, now: now)) {
            XCTAssertEqual(($0 as? NativePhotoUploadBudget.Wait)?.minimumPartBytes, 120)
        }
        _ = try budget.reserve(scope: owner, deviceId: "device", bytes: 60, cap: 100, now: now.addingTimeInterval(2))
        let restarted = NativePhotoUploadBudget(directory: directory)
        XCTAssertThrowsError(try restarted.reserve(scope: owner, deviceId: "device", bytes: 11, cap: 100, now: now.addingTimeInterval(3)))
        _ = try restarted.reserve(scope: other, deviceId: "device", bytes: 100, cap: 100, now: now)
        _ = try restarted.reserve(scope: owner, deviceId: "device", bytes: 100, cap: 100, now: now.addingTimeInterval(4800))
    }
    func testDurableBackgroundTrafficSettlementAndOldPartPruneAreIdempotent() throws {
        let (request, _) = try fixture()
        let scope = try FileSyncOwnerScope(ownerId: "owner", url: URL(string: "https://sync.test")!)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NativeDeferredUploadStore(directory: directory)
        var record = NativeDeferredUploadRecord(scope: scope, request: request, grantRevision: String(repeating: "a", count: 64),
            admissionId: "admission", expiresAt: Date(timeIntervalSinceNow: 3600))
        let first = UUID(), second = UUID()
        XCTAssertTrue(record.accountTransfer(.init(wifi: 30), settlement: first, partNumber: 1))
        try store.save([record])
        // Simulate death after the counter write but before job.accounted.
        var reopened = try XCTUnwrap(store.lookup(record))
        XCTAssertFalse(reopened.accountTransfer(.init(wifi: 30), settlement: first, partNumber: 1))
        XCTAssertEqual(reopened.transferBytes?.total, 30)
        reopened.confirmedParts = 1
        XCTAssertTrue(reopened.accountTransfer(.init(wifi: 40), settlement: second, partNumber: 2))
        XCTAssertFalse(reopened.accountTransfer(.init(wifi: 30), settlement: first, partNumber: 1), "Older confirmed part cannot replay after a newer settlement")
        XCTAssertEqual(reopened.transferBytes?.total, 70)
    }

    func testWholeFileUsesCanonicalOrderedPartsAndCompletesOnlyAfterCompositeVerification() async throws {
        let (request,digest) = try fixture()
        var parts = [Int](), progress = [Int64](), paths = [String](), authorizations = 0
        try await NativeFileUploadJob.run(request, check: {}, authorize: { authorizations += 1 }, json: { path, body in
            paths.append(path)
            if path.hasSuffix("/complete") { XCTAssertEqual(body?["uploadId"] as? String, "upload"); return ["ok": true] }
            XCTAssertEqual(body?["requestId"] as? String, "operation")
            return ["ok": true, "upload": ["id": "upload", "partSizeBytes": 8 * 1024 * 1024, "partCount": 3]]
        }, upload: { part in
            parts.append(part.partNumber); XCTAssertEqual(part.offset, Int64(part.partNumber - 1) * 8 * 1024 * 1024)
            XCTAssertEqual(part.length, part.partNumber == 3 ? 1 : 8 * 1024 * 1024)
            XCTAssertEqual(part.source, request.source); return digest
        }, progress: { progress.append($0) })
        let partSize = Int64(8 * 1024 * 1024)
        let expectedProgress: [Int64] = [partSize, 2 * partSize, request.source.size]
        XCTAssertEqual(parts, [1,2,3]); XCTAssertEqual(progress, expectedProgress)
        XCTAssertEqual(paths, ["/api/v1/attachments/uploads", "/api/v1/attachments/uploads/complete"])
        XCTAssertEqual(authorizations,5)
    }
    func testReadyReplayDoesNotResendOrCompleteAgain() async throws {
        let (request,_) = try fixture(); var calls = 0
        try await NativeFileUploadJob.run(request, check: {}, authorize: {}, json: { _,_ in
            calls += 1; return ["ok": true, "upload": ["id": "upload", "partSizeBytes": 8 * 1024 * 1024, "partCount": 3, "state": "ready"]]
        }, upload: { _ in XCTFail("Replayed accepted upload"); return "" }, progress: { XCTAssertEqual($0,request.source.size) })
        XCTAssertEqual(calls,1)
    }
    func testWrongCompositeLostPartResponseAndRevocationNeverFinalize() async throws {
        let (request,digest) = try fixture()
        for failure in ["digest", "lost", "revoked", "identity"] {
            var count = 0, authorized = 0
            do {
                try await NativeFileUploadJob.run(request, check: {}, authorize: {
                    authorized += 1
                    if failure == "revoked" && authorized == 3 { throw CancellationError() }
                }, json: { path,_ in
                    XCTAssertFalse(path.hasSuffix("/complete"))
                    return ["ok": true, "upload": ["id": failure == "identity" ? "other" : "upload", "partSizeBytes": 8 * 1024 * 1024, "partCount": 3]]
                }, upload: { _ in
                    count += 1
                    if failure == "lost" { throw URLError(.networkConnectionLost) }
                    return failure == "digest" ? String(repeating: "a",count: 64) : digest
                }, progress: { _ in })
                XCTFail("Accepted \(failure)")
            } catch {}
            XCTAssertEqual(count, failure == "digest" ? 3 : failure == "identity" ? 0 : 1)
        }
    }
    func testChangedConfigAccountAudienceNetworkPowerAndScopeAreRejected() throws {
        let a = try authorization(), owner = try FileSyncOwnerScope(ownerId: "owner", url: URL(string: "https://sync.test")!)
        try a.validate(owner: owner, rootId: root, photos: false)
        XCTAssertThrowsError(try a.validate(owner: owner, rootId: "other", photos: false))
        XCTAssertThrowsError(try a.validate(owner: owner, rootId: root, photos: true))
        let config: [String: Any] = ["configurationVersion": 1,"name": "Backup","deviceId": "device","localRootId": root,"remoteFolderId": "cloud",
            "mode": "backup","paused": false,"propagateDeletes": false,"network": "wifi","chargingOnly": true,"excludedPaths": [String]()]
        let row: [String: Any] = ["id": "connection","updatedAt": "2026-10-18T00:00:00Z","author": ["id": "owner"],"acl": ["tt:user"],"thingtime": ["file-sync"],"crystal": config]
        try a.verify(["ok": true,"thing": row], network: "wifi", charging: true)
        for network in ["cellular", "ethernet", "offline", "unknown"] {
            XCTAssertThrowsError(try a.verify(["ok": true,"thing": row], network: network, charging: true)) {
                XCTAssertEqual($0 as? NativeUploadAuthorization.Wait, .wifi)
            }
        }
        XCTAssertThrowsError(try a.verify(["ok": true,"thing": row], network: "wifi", charging: false))
        for (key,value) in [("id", "other" as Any), ("updatedAt", "later"), ("author", ["id": "other"]), ("appId", "app"), ("targetId", "target"), ("acl", ["tt:public"]), ("thingtime", ["file-sync","extra"])] {
            var changed = row; changed[key] = value
            XCTAssertThrowsError(try a.verify(["ok": true,"thing": changed], network: "wifi", charging: true))
        }
        for (key,value) in [("paused", true as Any), ("network", "any"), ("excludedPaths", ["file.bin"]), ("deviceId", "other"), ("localRootId", "other")] {
            var changedConfig = config; changedConfig[key] = value
            var changed = row; changed["crystal"] = changedConfig
            XCTAssertThrowsError(try a.verify(["ok": true,"thing": changed], network: "wifi", charging: true))
        }
    }
    func testRenewalKeepsTwoOriginalCursorsAcrossQueueEviction() throws {
        let (template, _) = try fixture()
        let scope = try FileSyncOwnerScope(ownerId: "owner", url: URL(string: "https://sync.test")!)
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let checkpoint = NativeDeferredUploadStore(directory: dir)
        let coordinator = NativeDeferredUpload(store: checkpoint, scheduler: DeferredUploadTestScheduler())
        coordinator.activate(foreground: false)
        let grant = String(repeating: "a", count: 64)
        func record(_ number: Int, _ generation: Int, expired: Bool = false) -> NativeDeferredUploadRecord {
            .init(scope: scope, request: .init(source: template.source, uploadId: "upload-\(number)",
                requestId: "request-\(number)", authorization: template.authorization), grantRevision: grant,
                admissionId: "admission-\(number)-\(generation)", expiresAt: Date(timeIntervalSinceNow: expired ? -60 : 300))
        }
        var revoked = record(1, 1), expired = record(2, 1, expired: true)
        revoked.armed = false; revoked.revoked = true; revoked.confirmedParts = 1
        expired.confirmedParts = 2
        try checkpoint.save([revoked, expired])
        let next1 = record(1, 2), next2 = record(2, 2)
        XCTAssertEqual(try coordinator.renewalID(scope: scope, request: next1.request, grantRevision: grant), revoked.admissionId)
        XCTAssertTrue(try coordinator.enqueue(next1))
        XCTAssertEqual(try coordinator.renewalID(scope: scope, request: next2.request, grantRevision: grant), expired.admissionId)
        XCTAssertEqual(try checkpoint.lookup(next1)?.confirmedParts, 1)
        XCTAssertEqual(NativeDeferredUploadStore.lookahead, 5)
        let additions = (3...6).map { record($0, 1) }
        for (index, addition) in additions.enumerated() {
            XCTAssertTrue(try coordinator.enqueue(addition))
            XCTAssertEqual(try checkpoint.load().count, min(index + 3, 5))
        }
        XCTAssertEqual(try checkpoint.lookup(next1)?.confirmedParts, 1, "An active cursor is never evicted")
        for addition in additions { XCTAssertNotNil(try checkpoint.lookup(addition)) }
        XCTAssertFalse(try coordinator.enqueue(record(7, 1)), "Five active reservations fill the working batch")
        XCTAssertEqual(try checkpoint.load().count, 5)
        XCTAssertNil(try checkpoint.lookup(expired))
        XCTAssertEqual(try coordinator.renewalID(scope: scope, request: next2.request, grantRevision: grant), expired.admissionId)
        XCTAssertFalse(try coordinator.enqueue(next2), "Queue capacity only limits its working batch")
        var finished = try XCTUnwrap(checkpoint.lookup(next1))
        finished.confirmedParts = try XCTUnwrap(finished.request.source.fingerprint?.partCount)
        finished.ready = true; finished.armed = false
        try checkpoint.update(finished)
        XCTAssertTrue(try coordinator.enqueue(next2))
        XCTAssertEqual(try checkpoint.lookup(next2)?.confirmedParts, 2)
        XCTAssertNil(try coordinator.renewalID(scope: scope, request: next2.request, grantRevision: grant))
        XCTAssertNil(try checkpoint.recovery(scope: scope, request: next2.request, grantRevision: grant))
        try coordinator.pauseLocally(scope: scope, rootId: root, configurationId: "connection", deviceId: "device")
        XCTAssertFalse(try checkpoint.load().contains(where: { $0.armed }))
    }

    func testPausePersistenceFailureCannotRearmStaleQueue() throws {
        let (request, _) = try fixture()
        let scope = try FileSyncOwnerScope(ownerId: "owner", url: URL(string: "https://sync.test")!)
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        var failedWrite = false
        let checkpoint = NativeDeferredUploadStore(directory: dir, beforeWrite: {
            if failedWrite { throw CocoaError(.fileWriteOutOfSpace) }
        })
        let coordinator = NativeDeferredUpload(store: checkpoint, scheduler: DeferredUploadTestScheduler())
        coordinator.activate(foreground: false)
        let record = NativeDeferredUploadRecord(scope: scope, request: request, grantRevision: String(repeating: "a", count: 64),
            admissionId: "admission-1", expiresAt: Date(timeIntervalSinceNow: 300))
        XCTAssertTrue(try coordinator.enqueue(record)); XCTAssertTrue(coordinator.schedule())
        failedWrite = true
        XCTAssertThrowsError(try coordinator.pauseLocally(scope: scope, rootId: root, configurationId: "connection", deviceId: "device")) {
            XCTAssertEqual(($0 as? NativeDeferredUploadStore.Failure), .pausePersistence)
        }
        XCTAssertEqual(try checkpoint.lookup(record)?.armed, true, "Injected disk failure retains old bytes")
        XCTAssertFalse(coordinator.schedule(), "Old durable bytes cannot reschedule a stopped queue")
        XCTAssertThrowsError(try coordinator.enqueue(record), "Fresh admission first needs a successful durable disarm")
        XCTAssertFalse(coordinator.schedule())
        failedWrite = false
        XCTAssertTrue(try coordinator.enqueue(record))
        XCTAssertTrue(coordinator.schedule(), "A fresh exact admission recovers after durable disarm")
    }

    func testForegroundNativeLifecyclePublishesImmediateProgressHintWithoutAWebVisibilityEvent() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let worker = NativeDeferredUpload(store: .init(directory: directory), scheduler: DeferredUploadTestScheduler())
        worker.activate(foreground: true)
        var hints = 0
        let observer = NotificationCenter.default.addObserver(forName: NativeDeferredUpload.photoProgressChanged,
            object: nil, queue: .main) { notification in
                if notification.userInfo?["immediate"] as? Bool == true && notification.userInfo?["lifecycle"] as? Bool == true { hints += 1 }
            }
        defer { NotificationCenter.default.removeObserver(observer) }
        NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil)
        XCTAssertGreaterThan(hints, 0)
        XCTAssertTrue(try NativePhotoRunStore(directory: directory).load().isEmpty,
            "A status hint alone neither admits work nor restores authority")
    }

    func testClosedBackgroundTerminationSurvivesExactJournalReopenWithoutChangingQueueOrPause() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NativePhotoRunStore(directory: directory)
        var run = try budgetWaitingRun(now: Date())
        let before = run
        let activity = NativePhotoRunActivity(run.activity)
        activity.backgroundEnded(.workerCancelled, measuredUnits: 12_345, lastProgressAt: Date(timeIntervalSince1970: 100),
            now: Date(timeIntervalSince1970: 101))
        run.activity = activity.snapshot(); try store.write(run)
        let reopened = try XCTUnwrap(NativePhotoRunStore(directory: directory).lookup(run))
        XCTAssertEqual(reopened.activity?.backgroundEnd?.cause, .workerCancelled)
        XCTAssertEqual(reopened.activity?.backgroundEnd?.measuredUnits, 12_345)
        XCTAssertEqual(reopened.batch, before.batch); XCTAssertEqual(reopened.authorization, before.authorization)
        XCTAssertEqual(reopened.armed, before.armed); XCTAssertEqual(reopened.retryAt, before.retryAt)
        var paused = reopened; paused.pauseByUser(); try store.write(paused)
        XCTAssertEqual(try store.lookup(paused)?.userPaused, true)
        XCTAssertEqual(try store.lookup(paused)?.activity?.backgroundEnd, reopened.activity?.backgroundEnd)
    }

}
