import AppleFileSync
import CryptoKit
import XCTest
@testable import ThingtimeNodeCore

private final class BatchDiagnosticCapture: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String] = []
    func record(_ value: String) { lock.lock(); values.append(value); lock.unlock() }
    var messages: [String] { lock.lock(); defer { lock.unlock() }; return values }
}

private actor DiagnosticPreparePeer {
    let refuseChecksum: Bool
    private var calls = 0
    init(refuseChecksum: Bool) { self.refuseChecksum = refuseChecksum }
    func exchange(_ value: JSONValue, _: TimeInterval) throws -> JSONValue {
        let frame = try BatchJSON.object(value, keys: ["kind", "checksums"])
        guard frame["kind"] == .string("prepare-ready") else { throw MobileFolderStore.Failure.invalid }
        calls += 1
        let failed = JSONValue.object(["ordinal": .number(0), "status": .string("failed"), "code": .string("source-changed"),
                                       "statusCode": .number(409), "retryable": .bool(false)])
        let source = JSONValue.object(["ordinal": .number(0), "status": .string("source-required")])
        return .object(["results": .array([refuseChecksum && calls == 1 ? source : failed])])
    }
}

private actor BatchOperationPeer {
    let batch: MacUploadBatchDescriptor, root: URL
    let replay: Bool, changeAfterVerify: Bool, mixed: Bool
    var rounds = 0, puts = 0, stored = false
    var received: [Int: Data] = [:], receipts: [Int: JSONValue] = [:]
    var admissions: [(ordinal: Int, at: TimeInterval)] = []
    let holdFirstPutsUntil: TimeInterval?, expireFirstWindow: Bool
    var initialWindowEnd: TimeInterval?
    init(_ batch: MacUploadBatchDescriptor, root: URL, replay: Bool, change: Bool, mixed: Bool = false, holdFirstPutsUntil: TimeInterval? = nil, expireFirstWindow: Bool = false) {
        self.batch = batch; self.root = root; self.replay = replay; changeAfterVerify = change; self.mixed = mixed; self.holdFirstPutsUntil = holdFirstPutsUntil; self.expireFirstWindow = expireFirstWindow
    }
    private func verified(_ m: MacUploadBatchDescriptor.Member) throws -> JSONValue {
        .object(["ordinal": .number(Double(m.ordinal)), "status": .string("verified"), "content": .object([
            "ordinal": .number(Double(m.ordinal)), "uploadId": .string("upload-\(m.ordinal)"), "version": .string(String(repeating: "c", count: 64)),
            "size": .number(Double(m.source.size)), "fingerprint": try JSONValue.from(m.source.fingerprint!)])])
    }
    func exchange(_ value: JSONValue, _ timeout: TimeInterval) async throws -> JSONValue {
        XCTAssertGreaterThan(timeout, 0); XCTAssertLessThanOrEqual(timeout, 60)
        guard case .object(let f) = value else { throw CancellationError() }
        switch f["kind"] {
        case .string("prepare-ready"):
            rounds += 1
            let lookup = try BatchJSON.array(BatchJSON.required(f, "checksums")).isEmpty
            if lookup { received.removeAll() }
            if lookup && rounds == 1 && expireFirstWindow { initialWindowEnd = ProcessInfo.processInfo.systemUptime + 30.2 }
            let rows = batch.members.map { m -> JSONValue in
                if replay { return .object(["ordinal": .number(Double(m.ordinal)), "status": .string("confirmed")]) }
                if let receipt = receipts[m.ordinal] { return receipt }
                if mixed {
                    if m.ordinal == 0 { return .object(["ordinal": .number(0), "status": .string("confirmed")]) }
                    if m.ordinal == 1 { return .object(["ordinal": .number(1), "status": .string("verified"), "content": .object([
                        "ordinal": .number(1), "uploadId": .string("upload-1"), "version": .string(String(repeating: "c", count: 64)),
                        "size": .number(Double(m.source.size)), "fingerprint": try! JSONValue.from(m.source.fingerprint!)])]) }
                    if m.ordinal == 2 { return .object(["ordinal": .number(2), "status": .string("failed"), "statusCode": .number(409), "code": .string("source-changed"), "retryable": .bool(false)]) }
                }
                return .object(["ordinal": .number(Double(m.ordinal)), "status": .string(lookup ? "source-required" : "prepared"),
                                "uploadId": .string("upload-\(m.ordinal)")].filter { !lookup || $0.key != "uploadId" })
            }
            return .object(["results": .array(rows)])
        case .string("chunk"):
            guard case .number(let ordinal) = f["ordinal"], case .number(let offset) = f["offset"], case .string(let data) = f["data"], let bytes = Data(base64Encoded: data) else { throw CancellationError() }
            let i = Int(ordinal); XCTAssertEqual(received[i, default: Data()].count, Int(offset)); XCTAssertLessThanOrEqual(bytes.count, 65_536)
            received[i, default: Data()].append(bytes); return .object(["accepted": .bool(true)])
        case .string("put-ready"):
            guard case .number(let ordinal) = f["ordinal"] else { throw CancellationError() }
            let i = Int(ordinal); XCTAssertEqual(received[i]?.count, Int(batch.members[i].source.size)); puts += 1
            admissions.append((i, ProcessInfo.processInfo.systemUptime))
            if let until = initialWindowEnd ?? holdFirstPutsUntil, puts <= 16 {
                let remaining = until - ProcessInfo.processInfo.systemUptime
                if remaining > 0 { try await Task.sleep(for: .seconds(remaining)) }
            }
            return .object(["status": .string("accepted"), "payloadBytes": .number(Double(received[i]!.count))])
        case .string("verify-ready"):
            stored = true
            let uploads = try BatchJSON.array(BatchJSON.required(f, "uploads"))
            let rows = try uploads.map { value -> JSONValue in
                let upload = try BatchJSON.object(value, keys: ["ordinal", "uploadId"])
                guard case .number(let number) = upload["ordinal"], number.rounded() == number, number >= 0, number < Double(batch.members.count) else { throw CancellationError() }
                let ordinal = Int(number)
                XCTAssertEqual(upload["uploadId"], .string("upload-\(ordinal)"))
                let receipt = try verified(batch.members[ordinal]); receipts[ordinal] = receipt
                return receipt
            }
            if changeAfterVerify { try Data("changed".utf8).write(to: root.appendingPathComponent(batch.members[0].source.path), options: .atomic) }
            return .object(["results": .array(rows)])
        default: throw CancellationError()
        }
    }
}

@MainActor final class MacUploadBatchOperationTests: XCTestCase {
    private func fixture(count: Int = 1, rustCapture: Bool = false) throws -> (URL, MobileFolderStore, FileSyncOwnerScope, MobileFolderStore.Grant, MacUploadBatchDescriptor, JSONValue) {
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
        for i in 0..<count { try Data("payload-\(i)".utf8).write(to: root.appendingPathComponent("file-\(i)")) }
        let captured: [MobileFolderReader.Entry]
        if rustCapture {
            let project = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
                .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            let helper = ProcessInfo.processInfo.environment["THINGTIME_TEST_COMMANDER_INDEXER"].map { URL(fileURLWithPath: $0) }
                ?? project.appendingPathComponent("filesystem-indexer/target/debug/commander-indexer")
            guard FileManager.default.isExecutableFile(atPath: helper.path) else {
                throw NSError(domain: "Build the canonical filesystem-indexer fixture first.", code: 1)
            }
            let index = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            addTeardownBlock { try? FileManager.default.removeItem(at: index) }
            let database = index.appendingPathComponent("filesystem-index.sqlite3")
            let inventory = MobileFolderInventory(directory: index.appendingPathComponent("captures"),
                transport: RustProcessInventoryTransport(helper: helper, database: database), database: database)
            let inventoryScope = MobileFolderInventory.Scope(owner: owner, deviceId: "device", rootId: grant.id)
            let id = UUID().uuidString.lowercased()
            _ = try inventory.beginStream(inventoryScope, id: id, bookmark: grant.bookmark, excludedPaths: [], ignoreRules: nil)
            try inventory.runStream(inventoryScope, id: id, bookmark: grant.bookmark, excludedPaths: [], ignoreRules: nil, wake: {})
            try inventory.finishStream(inventoryScope, id: id, bookmark: grant.bookmark, state: "complete")
            captured = try inventory.streamChanges(inventoryScope, id: id, bookmark: grant.bookmark, excludedPaths: [], ignoreRules: nil,
                afterSequence: 0).changes.map(\.entry)
            XCTAssertEqual(captured.count, count)
        } else { captured = [] }
        for i in 0..<count {
            let path = "file-\(i)", operationId = UUID().uuidString.lowercased()
            let source = try XCTUnwrap(rustCapture ? captured.first(where: { $0.path == path }) : MobileFolderReader.inspect(bookmark: grant.bookmark, path: path)), f = source.fingerprint!
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
    func testRustCaptureBatchDiagnosticSeparatesUnchangedAndStaleNativeSource() async throws {
        let (root, _, _, grant, batch, _) = try fixture(rustCapture: true)
        let success = BatchDiagnosticCapture(), peer = BatchOperationPeer(batch, root: root, replay: false, change: false)
        let accepted = try await MacUploadBatchOperation.run(batch, started: ProcessInfo.processInfo.systemUptime,
            bookmark: grant.bookmark, check: {}, callback: { try await peer.exchange($0, $1) }, diagnostic: success.record)
        let acceptedBody = try accepted.decode([String: JSONValue].self)
        XCTAssertEqual(try BatchJSON.array(acceptedBody["results"]!)[0].decode([String: JSONValue].self)["status"], .string("verified"))
        XCTAssertTrue(success.messages.isEmpty, "unchanged Rust source emits no failure diagnostic")

        let (staleRoot, _, _, staleGrant, staleBatch, _) = try fixture(rustCapture: true)
        try Data("replacement".utf8).write(to: staleRoot.appendingPathComponent("file-0"), options: .atomic)
        let stale = BatchDiagnosticCapture(), stalePeer = BatchOperationPeer(staleBatch, root: staleRoot, replay: false, change: false)
        let rejected = try await MacUploadBatchOperation.run(staleBatch, started: ProcessInfo.processInfo.systemUptime,
            bookmark: staleGrant.bookmark, check: {}, callback: { try await stalePeer.exchange($0, $1) }, diagnostic: stale.record)
        let rejectedBody = try rejected.decode([String: JSONValue].self)
        XCTAssertEqual(try BatchJSON.array(rejectedBody["results"]!)[0].decode([String: JSONValue].self)["code"], .string("source-changed"))
        XCTAssertEqual(stale.messages.count, 1)
        XCTAssertTrue(stale.messages[0].contains("native-initial-read=1"))
        XCTAssertTrue(stale.messages[0].contains("server-checksum-prepare=0"), "a second source-required reply keeps the first failure stage")
        let staleRounds = await stalePeer.rounds, stalePuts = await stalePeer.puts
        XCTAssertEqual(staleRounds, 2)
        XCTAssertEqual(stalePuts, 0)
        XCTAssertFalse(stale.messages[0].contains("file-0"))
    }
    func testServerPrepareRefusalsHaveDistinctSafeDiagnosticStages() async throws {
        for checksum in [false, true] {
            let (_, _, _, grant, batch, _) = try fixture()
            let sink = BatchDiagnosticCapture(), peer = DiagnosticPreparePeer(refuseChecksum: checksum)
            let reply = try await MacUploadBatchOperation.run(batch, started: ProcessInfo.processInfo.systemUptime,
                bookmark: grant.bookmark, check: {}, callback: { try await peer.exchange($0, $1) }, diagnostic: sink.record)
            let body = try reply.decode([String: JSONValue].self)
            XCTAssertEqual(try BatchJSON.array(body["results"]!)[0].decode([String: JSONValue].self)["code"], .string("source-changed"))
            XCTAssertEqual(sink.messages.count, 1)
            XCTAssertTrue(sink.messages[0].contains(checksum ? "server-checksum-prepare=1" : "server-lookup=1"))
            XCTAssertFalse(sink.messages[0].contains("file-0"))
        }
    }
    func test256RealFilesUseFreshBoundedWindowsWithoutRepeatingPUTs() async throws {
        let (root, store, _, grant, batch, raw) = try fixture(count: 256); var authorizations = 0
        let service = try MacFolderSync(origin: URL(string: "https://sync.test")!, store: store,
            staging: MobileSyncStaging(directory: root.appendingPathComponent("staging")), verify: { _, _ in authorizations += 1 }, choose: { nil }, approve: { _ in false },
            conditions: { .init(network: "wifi", charging: true) })
        let peer = BatchOperationPeer(batch, root: root, replay: false, change: false, expireFirstWindow: true)
        var verified = 0, windows = 0
        // Each bounded request reacquires authority while retaining the exact
        // descriptor, operation IDs and stored upload receipts. The initial
        // accepted bodies deliberately finish after the admission window.
        while verified < 256 && windows < 8 {
            let request: JSONValue = .object(["action": .string("upload-batch"), "requestId": .string(UUID().uuidString), "ownerId": .string("owner"), "deviceId": .string("device"), "origin": .string("https://sync.test"), "rootId": .string(grant.id), "batch": raw])
            let result = try await service.handle(request, batchCallback: { try await peer.exchange($0, $1) })
            let data = try result.decode([String: JSONValue].self), body = try data["uploadedBatch"]!.decode([String: JSONValue].self)
            let rows = try BatchJSON.array(body["results"]!); XCTAssertEqual(rows.count, 256)
            XCTAssertTrue(rows.enumerated().allSatisfy { ordinal, value in
                guard case .object(let row) = value, row["ordinal"] == .number(Double(ordinal)) else { return false }
                return row["status"] == .string("verified") || (row["status"] == .string("failed") && row["code"] == .string("deadline") && row["retryable"] == .bool(true))
            })
            let previous = verified
            verified = rows.filter { if case .object(let row) = $0 { return row["status"] == .string("verified") }; return false }.count
            windows += 1
            XCTAssertEqual(authorizations, windows * 2, "Every fresh request needs both identity checks")
            XCTAssertEqual(try BatchJSON.array(body["payloads"]!).count, 256)
            XCTAssertGreaterThan(verified, previous, "Stop a non-progressing fixture rather than retrying indefinitely")
            if verified <= previous { break }
            print("UPLOAD_BATCH_WINDOW window=\(windows) verified=\(verified) total=256")
        }
        XCTAssertGreaterThan(windows, 1, "Expiry must exercise a fresh window")
        XCTAssertEqual(verified, 256, "All 256 files must complete across fresh bounded windows")
        let admissions = await peer.admissions
        XCTAssertEqual(admissions.count, 256)
        XCTAssertEqual(Set(admissions.map(\.ordinal)).count, 256, "Every original operation sends exactly one PUT")
    }
    func testExpiredAdmissionRetainsSubsetAndFreshWindowDoesNotRepeatPUTs() async throws {
        let (root, _, _, grant, batch, _) = try fixture(count: 32)
        let started = ProcessInfo.processInfo.systemUptime - 25
        let peer = BatchOperationPeer(batch, root: root, replay: false, change: false, holdFirstPutsUntil: started + 30.2)
        let first = try await MacUploadBatchOperation.run(batch, started: started, bookmark: grant.bookmark, check: {}, callback: { try await peer.exchange($0, $1) })
        let firstBody = try first.decode([String: JSONValue].self)
        let rows = try BatchJSON.array(firstBody["results"]!).map { try $0.decode([String: JSONValue].self) }
        XCTAssertEqual(rows.count, 32)
        XCTAssertEqual(rows.filter { $0["status"] == .string("verified") }.count, 16)
        XCTAssertEqual(rows.filter { $0["code"] == .string("deadline") && $0["retryable"] == .bool(true) }.count, 16)
        let initialAdmissions = await peer.admissions
        XCTAssertEqual(initialAdmissions.count, 16)
        XCTAssertTrue(initialAdmissions.allSatisfy { $0.at - started < 30 }, "No expired PUT may be admitted")
        let freshStarted = ProcessInfo.processInfo.systemUptime
        let resumed = try await MacUploadBatchOperation.run(batch, started: freshStarted, bookmark: grant.bookmark, check: {}, callback: { try await peer.exchange($0, $1) })
        let body = try resumed.decode([String: JSONValue].self)
        let resumedRows = try BatchJSON.array(body["results"]!).map { try $0.decode([String: JSONValue].self) }
        XCTAssertEqual(resumedRows.map { $0["ordinal"] }, (0..<32).map { .number(Double($0)) })
        XCTAssertTrue(resumedRows.allSatisfy { $0["status"] == .string("verified") })
        let admissions = await peer.admissions
        XCTAssertEqual(Set(admissions.map(\.ordinal)).count, 32)
        XCTAssertEqual(admissions.count, 32, "Stored receipts must not send another PUT in a fresh window")
        XCTAssertTrue(admissions.dropFirst(16).allSatisfy { $0.at >= freshStarted && $0.at - freshStarted < 30 })
    }
    func testReceiptReplayPrecedesSourceIOAndStrongSourceFenceFollowsStoredLookup() async throws {
        for replay in [true, false] {
            let (root, _, _, grant, batch, _) = try fixture()
            if replay { try FileManager.default.removeItem(at: root.appendingPathComponent("file-0")) }
            let peer = BatchOperationPeer(batch, root: root, replay: replay, change: !replay)
            let sink = BatchDiagnosticCapture()
            let result = try await MacUploadBatchOperation.run(batch, started: ProcessInfo.processInfo.systemUptime, bookmark: grant.bookmark, check: {},
                callback: { try await peer.exchange($0, $1) }, diagnostic: sink.record)
            let body = try result.decode([String: JSONValue].self), row = try BatchJSON.array(body["results"]!)[0].decode([String: JSONValue].self)
            XCTAssertEqual(row["status"], .string(replay ? "confirmed" : "failed"))
            if !replay { XCTAssertEqual(row["code"], .string("source-changed")); let stored = await peer.stored; XCTAssertTrue(stored) }
            XCTAssertEqual(sink.messages.count, replay ? 0 : 1)
            if !replay { XCTAssertTrue(sink.messages[0].contains("native-final-read=1")) }
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
