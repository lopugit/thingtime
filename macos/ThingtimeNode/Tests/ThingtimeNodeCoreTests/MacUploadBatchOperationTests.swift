import AppleFileSync
import CryptoKit
import XCTest
@testable import ThingtimeNodeCore

private actor BatchOperationPeer {
    let batch: MacUploadBatchDescriptor, root: URL
    let replay: Bool, changeAfterVerify: Bool, mixed: Bool
    var rounds = 0, puts = 0, stored = false
    var received: [Int: Data] = [:]
    init(_ batch: MacUploadBatchDescriptor, root: URL, replay: Bool, change: Bool, mixed: Bool = false) { self.batch = batch; self.root = root; self.replay = replay; changeAfterVerify = change; self.mixed = mixed }
    func exchange(_ value: JSONValue, _ timeout: TimeInterval) async throws -> JSONValue {
        XCTAssertGreaterThan(timeout, 0); XCTAssertLessThanOrEqual(timeout, 60)
        guard case .object(let f) = value else { throw CancellationError() }
        switch f["kind"] {
        case .string("prepare-ready"):
            rounds += 1
            let rows = batch.members.map { m -> JSONValue in
                if replay { return .object(["ordinal": .number(Double(m.ordinal)), "status": .string("confirmed")]) }
                if mixed {
                    if m.ordinal == 0 { return .object(["ordinal": .number(0), "status": .string("confirmed")]) }
                    if m.ordinal == 1 { return .object(["ordinal": .number(1), "status": .string("verified"), "content": .object([
                        "ordinal": .number(1), "uploadId": .string("upload-1"), "version": .string(String(repeating: "c", count: 64)),
                        "size": .number(Double(m.source.size)), "fingerprint": try! JSONValue.from(m.source.fingerprint!)])]) }
                    if m.ordinal == 2 { return .object(["ordinal": .number(2), "status": .string("failed"), "statusCode": .number(409), "code": .string("source-changed"), "retryable": .bool(false)]) }
                }
                return .object(["ordinal": .number(Double(m.ordinal)), "status": .string(rounds == 1 ? "source-required" : "prepared"),
                                "uploadId": .string("upload-\(m.ordinal)")].filter { rounds != 1 || $0.key != "uploadId" })
            }
            return .object(["results": .array(rows)])
        case .string("chunk"):
            guard case .number(let ordinal) = f["ordinal"], case .number(let offset) = f["offset"], case .string(let data) = f["data"], let bytes = Data(base64Encoded: data) else { throw CancellationError() }
            let i = Int(ordinal); XCTAssertEqual(received[i, default: Data()].count, Int(offset)); XCTAssertLessThanOrEqual(bytes.count, 65_536)
            received[i, default: Data()].append(bytes); return .object(["accepted": .bool(true)])
        case .string("put-ready"):
            guard case .number(let ordinal) = f["ordinal"] else { throw CancellationError() }
            let i = Int(ordinal); XCTAssertEqual(received[i]?.count, Int(batch.members[i].source.size)); puts += 1
            return .object(["status": .string("accepted"), "payloadBytes": .number(Double(received[i]!.count))])
        case .string("verify-ready"):
            stored = true
            let rows = try batch.members.filter { !mixed || $0.ordinal == 3 }.map { m -> JSONValue in
                .object(["ordinal": .number(Double(m.ordinal)), "status": .string("verified"), "content": .object([
                    "ordinal": .number(Double(m.ordinal)), "uploadId": .string("upload-\(m.ordinal)"), "version": .string(String(repeating: "c", count: 64)),
                    "size": .number(Double(m.source.size)), "fingerprint": try JSONValue.from(m.source.fingerprint!)])])
            }
            if changeAfterVerify { try Data("changed".utf8).write(to: root.appendingPathComponent(batch.members[0].source.path), options: .atomic) }
            return .object(["results": .array(rows)])
        default: throw CancellationError()
        }
    }
}

@MainActor final class MacUploadBatchOperationTests: XCTestCase {
    private func fixture(count: Int = 1) throws -> (URL, MobileFolderStore, FileSyncOwnerScope, MobileFolderStore.Grant, MacUploadBatchDescriptor, JSONValue) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        var saved: Data?
        let store = MobileFolderStore(load: { _ in saved }, save: { _, data in saved = data })
        let owner = try FileSyncOwnerScope(ownerId: "owner", url: URL(string: "https://sync.test")!), grant = try store.add(owner, selected: root)
        let scope: JSONValue = .object(["origin": .string("https://sync.test"), "ownerId": .string("owner"), "dataPlane": .string("home"), "rootId": .string("connection"), "deviceId": .string("device")])
        let batchId = UUID().uuidString.lowercased(), updated = "2026-10-21T00:00:00.000Z"
        var members: [JSONValue] = [], fields = ["thingtime-upload-batch-v1", batchId, "https://sync.test", "owner", "home", "connection", "device", "connection", updated,
            "1", "Backup", "device", grant.id, "folder", "cloud-root", "backup", "0", "0", "wifi", "0", "0", "", String(count)]
        for i in 0..<count {
            let path = "file-\(i)", operationId = UUID().uuidString.lowercased()
            try Data("payload-\(i)".utf8).write(to: root.appendingPathComponent(path))
            let source = try XCTUnwrap(MobileFolderReader.inspect(bookmark: grant.bookmark, path: path)), f = source.fingerprint!
            fields += [String(i), operationId, "cloud-root", "cloud-parent", path, source.id, source.version, String(source.size), "", f.algorithm, String(f.partSizeBytes), "1", f.sha256]
            members.append(.object(["ordinal": .number(Double(i)), "write": .object(["scope": scope, "folderId": .string("cloud-parent"), "cloudRootId": .string("cloud-root"), "before": .null,
                "operation": .object(["id": .string(operationId), "confirmed": .bool(false), "mutation": .object(["kind": .string("copy"), "from": .string("local"), "path": .string(path), "expectedTarget": .null, "source": try JSONValue.from(source)])])])]))
        }
        let descriptor: JSONValue = .object(["version": .number(1), "batchId": .string(batchId), "scope": scope,
            "configuration": .object(["id": .string("connection"), "updatedAt": .string(updated), "configuration": .object([
                "configurationVersion": .number(1), "name": .string("Backup"), "deviceId": .string("device"), "localRootId": .string(grant.id), "remoteFolderId": .string("cloud-root"),
                "mode": .string("backup"), "paused": .bool(false), "propagateDeletes": .bool(false), "network": .string("wifi"), "chargingOnly": .bool(false), "excludedPaths": .array([])])]), "members": .array(members)])
        let digest = SHA256.hash(data: Data(fields.map { "\($0.utf8.count):\($0)" }.joined().utf8)).map { String(format: "%02x", $0) }.joined()
        let value: JSONValue = .object(["descriptor": descriptor, "digest": .string(digest)])
        return (root, store, owner, grant, try MacUploadBatchDescriptor(value), value)
    }
    func test256RealFilesUseOneBoundedOperationAndTwoFreshIdentityChecks() async throws {
        let (root, store, _, grant, batch, raw) = try fixture(count: 256); var authorizations = 0
        let service = try MacFolderSync(origin: URL(string: "https://sync.test")!, store: store,
            staging: MobileSyncStaging(directory: root.appendingPathComponent("staging")), verify: { _, _ in authorizations += 1 }, choose: { nil }, approve: { _ in false },
            conditions: { .init(network: "wifi", charging: true) })
        let peer = BatchOperationPeer(batch, root: root, replay: false, change: false)
        let request: JSONValue = .object(["action": .string("upload-batch"), "requestId": .string(UUID().uuidString), "ownerId": .string("owner"), "deviceId": .string("device"), "origin": .string("https://sync.test"), "rootId": .string(grant.id), "batch": raw])
        let result = try await service.handle(request, batchCallback: { try await peer.exchange($0, $1) })
        let data = try result.decode([String: JSONValue].self), body = try data["uploadedBatch"]!.decode([String: JSONValue].self)
        let rows = try BatchJSON.array(body["results"]!); XCTAssertEqual(rows.count, 256)
        XCTAssertTrue(rows.allSatisfy { if case .object(let row) = $0 { return row["status"] == .string("verified") }; return false })
        XCTAssertEqual(authorizations, 2); let puts = await peer.puts; XCTAssertEqual(puts, 256)
        XCTAssertEqual(try BatchJSON.array(body["payloads"]!).count, 256)
    }
    func testReceiptReplayPrecedesSourceIOAndStrongSourceFenceFollowsStoredLookup() async throws {
        for replay in [true, false] {
            let (root, _, _, grant, batch, _) = try fixture()
            if replay { try FileManager.default.removeItem(at: root.appendingPathComponent("file-0")) }
            let peer = BatchOperationPeer(batch, root: root, replay: replay, change: !replay)
            let result = try await MacUploadBatchOperation.run(batch, started: ProcessInfo.processInfo.systemUptime, bookmark: grant.bookmark, check: {}, callback: { try await peer.exchange($0, $1) })
            let body = try result.decode([String: JSONValue].self), row = try BatchJSON.array(body["results"]!)[0].decode([String: JSONValue].self)
            XCTAssertEqual(row["status"], .string(replay ? "confirmed" : "failed"))
            if !replay { XCTAssertEqual(row["code"], .string("source-changed")); let stored = await peer.stored; XCTAssertTrue(stored) }
            let puts = await peer.puts; XCTAssertEqual(puts, replay ? 0 : 1)
        }
    }
    func testExpiredOperationAndDispatchDeadlineNeverSendPUT() async throws {
        let (root, _, _, grant, batch, _) = try fixture()
        let peer = BatchOperationPeer(batch, root: root, replay: false, change: false)
        do {
            _ = try await MacUploadBatchOperation.run(batch, started: ProcessInfo.processInfo.systemUptime - 181, bookmark: grant.bookmark, check: {}, callback: { try await peer.exchange($0, $1) })
            XCTFail("Expired operation accepted")
        } catch is CancellationError { }
        let rounds = await peer.rounds; XCTAssertEqual(rounds, 0)
        let result = try await MacUploadBatchOperation.run(batch, started: ProcessInfo.processInfo.systemUptime - 31, bookmark: grant.bookmark, check: {}, callback: { try await peer.exchange($0, $1) })
        let body = try result.decode([String: JSONValue].self), row = try BatchJSON.array(body["results"]!)[0].decode([String: JSONValue].self)
        XCTAssertEqual(row["code"], .string("deadline")); let puts = await peer.puts; XCTAssertEqual(puts, 0)
    }
    func testAuthorityRevocationDuringCallbackAbortsBeforeSourceOrPUT() async throws {
        let (root, store, owner, grant, batch, raw) = try fixture()
        let service = try MacFolderSync(origin: URL(string: "https://sync.test")!, store: store,
            staging: MobileSyncStaging(directory: root.appendingPathComponent("staging")), verify: { _, _ in }, choose: { nil }, approve: { _ in false }, conditions: { .init(network: "wifi", charging: true) })
        let peer = BatchOperationPeer(batch, root: root, replay: false, change: false)
        let request: JSONValue = .object(["action": .string("upload-batch"), "requestId": .string(UUID().uuidString), "ownerId": .string("owner"), "deviceId": .string("device"), "origin": .string("https://sync.test"), "rootId": .string(grant.id), "batch": raw])
        do {
            _ = try await service.handle(request, batchCallback: { frame, timeout in
                let reply = try await peer.exchange(frame, timeout)
                try await MainActor.run { try store.remove(owner, id: grant.id) }
                return reply
            })
            XCTFail("Revoked grant accepted")
        } catch { }
        let puts = await peer.puts; XCTAssertEqual(puts, 0)
        let rounds = await peer.rounds; XCTAssertEqual(rounds, 1)
    }

    func testMixedReceiptsReadyFailureAndPUTPreserveOrderedSubset() async throws {
        let (root, _, _, grant, batch, _) = try fixture(count: 4)
        try FileManager.default.removeItem(at: root.appendingPathComponent("file-0"))
        try FileManager.default.removeItem(at: root.appendingPathComponent("file-2"))
        let peer = BatchOperationPeer(batch, root: root, replay: false, change: false, mixed: true)
        let result = try await MacUploadBatchOperation.run(batch, started: ProcessInfo.processInfo.systemUptime, bookmark: grant.bookmark, check: {}, callback: { try await peer.exchange($0, $1) })
        let body = try result.decode([String: JSONValue].self)
        let rows = try BatchJSON.array(body["results"]!).map { try $0.decode([String: JSONValue].self) }
        XCTAssertEqual(rows.map { $0["status"] }, [.string("confirmed"), .string("verified"), .string("failed"), .string("verified")])
        let puts = await peer.puts; XCTAssertEqual(puts, 1)
        XCTAssertEqual(try BatchJSON.array(body["payloads"]!).count, 4)
    }

}
