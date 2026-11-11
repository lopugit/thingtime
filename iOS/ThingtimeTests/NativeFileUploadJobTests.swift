import XCTest
import AppleFileSync
import CryptoKit
@testable import Thingtime

@MainActor
private struct DeferredUploadTestScheduler: NativeDeferredUploadScheduling {
    func register(_ handle: @escaping (NativeDeferredUploadSystemTask) -> Void) -> Bool { true }
    func submit(earliest: Date, charging: Bool) throws {}
    func cancel() {}
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

}
