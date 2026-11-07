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
    private func authorization() throws -> NativeUploadAuthorization {
        let config: [String: Any] = ["configurationVersion": 1, "name": "Backup", "deviceId": "device", "localRootId": root,
            "remoteFolderId": "cloud", "mode": "backup", "paused": false, "propagateDeletes": false,
            "network": "wifi", "chargingOnly": true, "excludedPaths": [String]()]
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
        for i in 3...5 { XCTAssertTrue(try coordinator.enqueue(record(i, 1))) }
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
