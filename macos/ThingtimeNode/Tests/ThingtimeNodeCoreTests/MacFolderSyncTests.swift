import XCTest
import Foundation
import CryptoKit
import AppleFileSync
@testable import ThingtimeNodeCore

@MainActor
final class MacFolderSyncTests: XCTestCase {
    private let origin = URL(string: "https://sync.test")!
    private var folder: URL!
    override func setUpWithError() throws {
        folder = FileManager.default.temporaryDirectory.appendingPathComponent("mac-sync-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: folder.appendingPathComponent("selected"), withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try FileManager.default.removeItem(at: folder) }
    private func request(_ action: String, _ fields: [String: JSONValue] = [:], id: String = UUID().uuidString) -> JSONValue {
        .object(["action": .string(action), "requestId": .string(id), "ownerId": .string("owner"), "deviceId": .string("device"), "origin": .string(origin.absoluteString)].merging(fields) { _, next in next })
    }
    private func service(verify: @escaping (String, String) async throws -> Void = { owner, device in
        guard owner == "owner", device == "device" else { throw MobileFolderStore.Failure.unavailable }
    }, approve: @escaping (MobileFolderStore.Grant) async throws -> Bool = { _ in true }) throws -> MacFolderSync {
        var saved: [String: Data] = [:]
        let selected = folder.appendingPathComponent("selected")
        return try MacFolderSync(origin: origin, store: MobileFolderStore(load: { saved[$0.key] }, save: { saved[$0.key] = $1 }),
            staging: MobileSyncStaging(directory: folder.appendingPathComponent("private")),
            verify: verify, choose: { selected }, approve: approve, chooseSource: { .folder(selected) },
            inventories: MobileFolderInventory(directory: folder.appendingPathComponent("inventories")))
    }
    private func root(_ service: MacFolderSync) async throws -> String {
        let result = try await service.handle(request("choose"))
        let data = try JSONEncoder().encode(result)
        let body = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let rows = try XCTUnwrap(body["roots"] as? [[String: Any]])
        XCTAssertEqual(Set(rows[0].keys), ["id", "name", "publicationVersion"])
        return try XCTUnwrap(rows.first?["id"] as? String)
    }
    private func rejects(_ work: () async throws -> JSONValue) async {
        do { _ = try await work(); XCTFail("Unauthorized request succeeded") } catch { }
    }
    func testContextAndUnknownConditionsUseTheSharedFolderContract() async throws {
        let service = try service()
        let context = try await service.handle(request("context")).decode([String: JSONValue].self)
        XCTAssertEqual(context["deviceId"], .string("device"))
        let capabilities = try XCTUnwrap(context["capabilities"]).decode([String: String].self)
        XCTAssertEqual(capabilities, ["fileAccessVersion": "1.5.0", "fileStagingVersion": "1.1.0", "filePublicationVersion": "1.1.0"])
        let result = try await service.handle(request("conditions")).decode([String: JSONValue].self)
        XCTAssertEqual(result["conditions"], .object(["network": .string("unknown"), "charging": .null]))
    }

    func testInventoryCapturePagesAreScopedImmutableAndDiscardable() async throws {
        let service = try service(), id = try await root(service)
        let source = folder.appendingPathComponent("selected")
        for i in 0..<129 { try Data().write(to: source.appendingPathComponent("file-\(i)")) }
        let fields: [String: JSONValue] = ["rootId": .string(id), "inventoryDeviceId": .string("device")]
        let captureID = UUID().uuidString.lowercased()
        let begin = request("scan-capture", fields.merging(["captureId": .string(captureID)]) { _, v in v })
        let first = try await service.handle(begin).decode([String: JSONValue].self)
        let capture = try XCTUnwrap(first["capture"])
        XCTAssertEqual(try capture.decode(MobileFolderInventory.Capture.self).totalEntries, 129)
        let repeated = try await service.handle(begin).decode([String: JSONValue].self)
        XCTAssertEqual(repeated["capture"], capture)
        try Data("later".utf8).write(to: source.appendingPathComponent("file-0"))
        let pageFields = fields.merging(["capture": capture, "offset": .number(0)]) { _, v in v }
        let firstPage = try await service.handle(request("scan-page", pageFields)).decode([String: JSONValue].self)
        let page = try XCTUnwrap(firstPage["inventoryPage"]).decode(MobileFolderInventory.Page.self)
        XCTAssertEqual(page.entries.count, 128); XCTAssertEqual(page.nextOffset, 128)
        XCTAssertTrue(page.entries.allSatisfy { $0.size == 0 })
        let last = try await service.handle(request("scan-page", pageFields.merging(["offset": .number(128)]) { _, v in v })).decode([String: JSONValue].self)
        let lastPage = try XCTUnwrap(last["inventoryPage"]).decode(MobileFolderInventory.Page.self)
        XCTAssertEqual(lastPage.entries.count, 1); XCTAssertNil(lastPage.nextOffset)
        for patch: [String: JSONValue] in [["inventoryDeviceId": .string("other")], ["rootId": .string(UUID().uuidString)], ["offset": .number(-1)]] {
            await rejects { try await service.handle(self.request("scan-page", pageFields.merging(patch) { _, v in v })) }
        }
        _ = try await service.handle(request("scan-discard", pageFields))
        await rejects { try await service.handle(self.request("scan-page", pageFields)) }
        XCTAssertEqual(try Data(contentsOf: source.appendingPathComponent("file-0")), Data("later".utf8))
    }

    func testInventoryReauthorizesEveryCaptureAndPageBeforeReply() async throws {
        var calls = 0, refuse = false
        let service = try service(verify: { _, _ in
            calls += 1
            if refuse && calls == 2 { throw MobileFolderStore.Failure.unavailable }
        })
        let id = try await root(service), captureID = UUID().uuidString.lowercased()
        let fields: [String: JSONValue] = ["rootId": .string(id), "inventoryDeviceId": .string("device"), "captureId": .string(captureID)]
        calls = 0; refuse = true
        await rejects { try await service.handle(self.request("scan-capture", fields)) }
        XCTAssertEqual(calls, 2)
        calls = 0; refuse = false
        let result = try await service.handle(request("scan-capture", fields)).decode([String: JSONValue].self)
        let capture = try XCTUnwrap(result["capture"])
        calls = 0; refuse = true
        await rejects { try await service.handle(self.request("scan-page", fields.merging(["capture": capture, "offset": .number(0)]) { _, v in v })) }
        XCTAssertEqual(calls, 2)
    }

    func testSinglePathInspectionIsScopedAndReauthorizesBeforeReply() async throws {
        var allowed = true, calls = 0
        let service = try service(verify: { owner, device in
            calls += 1
            guard allowed, owner == "owner", device == "device" else { throw MobileFolderStore.Failure.unavailable }
        })
        let id = try await root(service)
        try Data("real native bytes".utf8).write(to: folder.appendingPathComponent("selected/file.bin"))
        let fields: [String: JSONValue] = ["rootId": .string(id), "path": .string("file.bin")]
        calls = 0
        let result = try await service.handle(request("inspect", fields)).decode([String: JSONValue].self)
        let entry = try XCTUnwrap(result["entry"]).decode(MobileFolderReader.Entry.self)
        XCTAssertEqual(entry.path, "file.bin"); XCTAssertEqual(entry.size, 17); XCTAssertEqual(calls, 2)
        XCTAssertEqual(result["complete"], .bool(true)); XCTAssertNil(result["entries"])
        let missing = try await service.handle(request("inspect", ["rootId": .string(id), "path": .string("missing")])).decode([String: JSONValue].self)
        XCTAssertEqual(missing["entry"], .null)
        for path in ["../outside", "/outside"] {
            await rejects { try await service.handle(self.request("inspect", ["rootId": .string(id), "path": .string(path)])) }
        }
        allowed = false
        await rejects { try await service.handle(self.request("inspect", fields)) }
    }

    func testInspectionRejectsIdentityOrGrantRevokedBeforeReply() async throws {
        for revokeGrant in [false, true] {
            var saved: [String: Data] = [:], calls = 0
            var revoke = false, id = ""
            let owner = try FileSyncOwnerScope(ownerId: "owner", url: origin)
            let store = MobileFolderStore(load: { saved[$0.key] }, save: { saved[$0.key] = $1 })
            let selected = folder.appendingPathComponent("selected")
            let service = try MacFolderSync(origin: origin, store: store,
                staging: MobileSyncStaging(directory: folder.appendingPathComponent(UUID().uuidString)),
                verify: { _, _ in
                    calls += 1
                    if revoke && calls == 2 {
                        if revokeGrant { try store.remove(owner, id: id) }
                        else { throw MobileFolderStore.Failure.unavailable }
                    }
                }, choose: { selected }, approve: { _ in true }, chooseSource: { .folder(selected) })
            id = try await root(service)
            try Data("authorized before inspection".utf8).write(to: selected.appendingPathComponent("file.bin"))
            calls = 0; revoke = true
            await rejects { try await service.handle(self.request("inspect", ["rootId": .string(id), "path": .string("file.bin")])) }
            XCTAssertEqual(calls, 2)
            XCTAssertEqual(try Data(contentsOf: selected.appendingPathComponent("file.bin")), Data("authorized before inspection".utf8))
        }
    }

    func testNativeSelectionReadAndAccountDeviceOriginFences() async throws {
        let service = try service(), bytes = Data([1,2,3])
        try bytes.write(to: folder.appendingPathComponent("selected/file.bin"))
        let id = try await root(service)
        let scanned = try await service.handle(request("scan", ["rootId": .string(id)]))
        let body = try scanned.decode([String: JSONValue].self)
        XCTAssertEqual(body["complete"], .bool(true))
        let entries = try XCTUnwrap(body["entries"]).decode([MobileFolderReader.Entry].self)
        XCTAssertEqual(entries.count, 1)
        let read = try await service.handle(request("read", ["rootId": .string(id), "path": .string("file.bin"), "version": .string(entries[0].version), "offset": .number(0), "length": .number(3)]))
        let json = try read.decode([String: JSONValue].self)
        XCTAssertEqual(json["path"], .string("file.bin"))
        let chunk = try XCTUnwrap(json["chunk"]).decode([String: JSONValue].self)
        XCTAssertEqual(chunk["data"], .string(bytes.base64EncodedString()))
        for fields: [String: JSONValue] in [["ownerId": .string("foreign")], ["deviceId": .string("other")], ["origin": .string("https://foreign.test")]] {
            await rejects { try await service.handle(self.request("scan", fields.merging(["rootId": .string(id)]) { _, x in x })) }
        }
        await rejects { try await service.handle(self.request("read", ["rootId": .string(id), "path": .string("../outside"), "version": .string(entries[0].version), "offset": .number(0), "length": .number(3)])) }
    }
    func testPublicationRequiresExactNativeConsentAndRemovalPreservesBytes() async throws {
        var allow = false
        let service = try service(approve: { _ in allow }), id = try await root(service)
        let bytes = Data(repeating: 17, count: 65_537)
        let digest = SHA256.hash(data: Data(SHA256.hash(data: bytes))).map { String(format: "%02x", $0) }.joined()
        let scope = MobileSyncStaging.Scope(origin: origin.absoluteString, ownerId: "owner", dataPlane: "home", rootId: "connection", deviceId: "device")
        let source = MobileFolderReader.Entry(path: "sample.bin", id: "cloud", version: "v1", kind: "file", size: Int64(bytes.count), sha256: nil, fingerprint: .init(partSizeBytes: 8_388_608, partCount: 1, sha256: digest))
        let transfer = MobileSyncStaging.Request(scope: scope, rootId: id, operation: .init(id: UUID().uuidString.lowercased(), mutation: .init(kind: "copy", from: "remote", path: source.path, source: source, expectedTarget: nil), confirmed: false))
        var fields: [String: JSONValue] = ["rootId": .string(id), "transfer": try .from(transfer)]
        _ = try await service.handle(request("stage-begin", fields))
        for offset in stride(from: 0, to: bytes.count, by: 65_536) {
            _ = try await service.handle(request("stage-append", fields.merging(["offset": .number(Double(offset)), "data": .string(bytes.subdata(in: offset..<min(bytes.count, offset + 65_536)).base64EncodedString())]) { _, x in x }))
        }
        let staged = try await service.handle(request("stage-finish", fields)).decode([String: JSONValue].self)
        fields["stage"] = try XCTUnwrap(staged["staging"]).decode([String: JSONValue].self)["stage"]
        let approval = MobileFolderStore.WriteApproval(scope: scope, configurationRevision: "1", configurationHash: String(repeating: "a", count: 64))
        fields["approval"] = try .from(approval)
        await rejects { try await service.handle(self.request("publish", fields)) }
        await rejects { try await service.handle(self.request("write-approve", fields)) }
        XCTAssertFalse(FileManager.default.fileExists(atPath: folder.appendingPathComponent("selected/sample.bin").path))
        allow = true; _ = try await service.handle(request("write-approve", fields))
        var changed = fields
        changed["approval"] = try .from(MobileFolderStore.WriteApproval(scope: scope, configurationRevision: "2", configurationHash: approval.configurationHash))
        await rejects { try await service.handle(self.request("publish", changed)) }
        let result = try await service.handle(request("publish", fields))
        XCTAssertEqual(try Data(contentsOf: folder.appendingPathComponent("selected/sample.bin")), bytes)
        let repeated = try await service.handle(request("publish", fields))
        XCTAssertEqual(try result.decode([String: JSONValue].self)["publication"], try repeated.decode([String: JSONValue].self)["publication"])
        _ = try await service.handle(request("remove", ["rootId": .string(id)]))
        await rejects { try await service.handle(self.request("publication-lookup", fields)) }
        XCTAssertEqual(try Data(contentsOf: folder.appendingPathComponent("selected/sample.bin")), bytes)
    }
    func testIdentityChangeDuringPickerCannotSaveGrant() async throws {
        var valid = true, saved: Data?
        let selected = folder.appendingPathComponent("selected")
        let store = MobileFolderStore(load: { _ in saved }, save: { _, data in saved = data })
        let service = try MacFolderSync(origin: origin, store: store, staging: MobileSyncStaging(directory: folder.appendingPathComponent("private")),
            verify: { _, _ in if !valid { throw MobileFolderStore.Failure.unavailable } }, choose: { valid = false; return selected }, approve: { _ in true })
        await rejects { try await service.handle(self.request("choose")) }
        XCTAssertNil(saved)
    }
    func testMatchingSuspendCancelsOnlyItsOwnPendingPicker() async throws {
        var started = false, saved: Data?
        let store = MobileFolderStore(load: { _ in saved }, save: { _, value in saved = value })
        let service = try MacFolderSync(origin: origin, store: store, staging: MobileSyncStaging(directory: folder.appendingPathComponent("private")),
            verify: { _, _ in }, choose: { started = true; try await Task.sleep(for: .seconds(30)); return nil }, approve: { _ in true })
        let id = UUID().uuidString
        let pending = Task { try await service.handle(request("choose", id: id)) }
        while !started { await Task.yield() }
        _ = try await service.handle(request("suspend", ["ownerId": .string("foreign")], id: id))
        await rejects { try await service.handle(self.request("list")) }
        _ = try await service.handle(request("suspend", id: id))
        await rejects { try await pending.value }; XCTAssertNil(saved)
        _ = try await service.handle(request("list"))
    }
    func testGenericAndLeasedDispatchCannotCallFolderAdapter() async throws {
        var calls = 0
        let folderService = try service(verify: { _, _ in calls += 1 })
        let telemetry = DeviceTelemetryCollector()
        let controller = ThingtimeNodeController(
            journal: try CommandJournal(fileURL: folder.appendingPathComponent("commands.json")),
            folderSync: folderService,
            pairing: PairingManager(store: InMemoryDeviceCredentialStore()),
            connector: ConnectorRuntime(configuration: nil), telemetry: telemetry,
            actionExecutor: SafeActionExecutor(telemetry: telemetry))
        let generic = await controller.handle(NodeRequest(method: "folder-sync.request", parameters: request("list")))
        XCTAssertFalse(generic.ok)
        let leased = await controller.handleLeasedCommand(.init(commandID: "remote", leaseID: "lease", method: "folder-sync.request", parameters: request("list"), leaseExpiresAt: .distantFuture))
        XCTAssertFalse(leased.ok); XCTAssertEqual(calls, 0)
        let local = await controller.handleLocalFolderSync(NodeRequest(method: "folder-sync.request", parameters: request("list")))
        XCTAssertTrue(local.ok); XCTAssertEqual(calls, 2)
    }

    func testCallerCancellationClosesOnlyActiveDialog() async throws {
        var started = false, cancelled = false
        var selection: CheckedContinuation<URL?, Never>?
        let service = try MacFolderSync(origin: origin, store: MobileFolderStore(load: { _ in nil }, save: { _, _ in }),
            staging: MobileSyncStaging(directory: folder.appendingPathComponent("private")), verify: { _, _ in },
            choose: { await withCheckedContinuation { selection = $0; started = true } }, approve: { _ in true },
            cancelDialog: { cancelled = true; selection?.resume(returning: nil); selection = nil })
        let pending = Task { try await service.handle(request("choose")) }
        while !started { await Task.yield() }
        pending.cancel()
        await rejects { try await pending.value }
        // The picker exits on cancellation as well as the service's dialog callback.
        _ = try await service.handle(request("list"))
        XCTAssertTrue(cancelled)
    }

    func testFolderSyncIsExplicitlyLocalOnly() {
        XCTAssertEqual(ThingtimeNodeXPCRequestPolicy.access(for: "folder-sync.request"), .folderSync)
        XCTAssertEqual(ThingtimeNodeXPCRequestPolicy.access(for: "folder-sync.publish"), .forbidden)
        XCTAssertEqual(ThingtimeNodeXPCRequestPolicy.bridgeResponseTimeoutSeconds(for: "folder-sync.request"), 300)
    }
    func testStreamUsesTwoLiveIdentityChecksAndNeverSucceedsAfterRevocation() async throws {
        let bytes = Data(repeating: 29, count: 8 * 1024 * 1024 + 17)
        try bytes.write(to: folder.appendingPathComponent("selected/large.bin"))
        var checks = 0, revoked = false, failAt = Int.max
        let service = try service(verify: { _, _ in checks += 1; if revoked || checks == failAt { throw MobileFolderStore.Failure.unavailable } })
        let id = try await root(service)
        let rows = try await service.handle(request("scan", ["rootId": .string(id)])).decode([String: JSONValue].self)
        let entry = try XCTUnwrap(rows["entries"]).decode([MobileFolderReader.Entry].self)[0]
        let input = request("read-range", ["rootId": .string(id), "path": .string(entry.path), "version": .string(entry.version), "offset": .number(0), "length": .number(Double(bytes.count))])
        final class Collector: @unchecked Sendable { var bytes = Data(); var chunks = 0 }
        let collector = Collector(); checks = 0
        let result = try await service.handle(input, stream: { data in
            XCTAssertLessThanOrEqual(data.count, 65_536); collector.bytes.append(data); collector.chunks += 1
        })
        XCTAssertEqual(collector.bytes, bytes); XCTAssertEqual(collector.chunks, 129); XCTAssertEqual(checks, 2)
        let chunk = try XCTUnwrap(result.decode([String: JSONValue].self)["chunk"]).decode([String: JSONValue].self)
        XCTAssertNil(chunk["data"]); XCTAssertEqual(chunk["length"], .number(Double(bytes.count)))
        await rejects { try await service.handle(input) } // Never put a whole range in a normal XPC reply.
        await rejects { try await service.handle(self.request("list"), stream: { _ in }) }
        // The completion verifier refuses after all provisional frames arrived.
        checks = 0; failAt = 2; collector.bytes.removeAll()
        await rejects { try await service.handle(input, stream: { collector.bytes.append($0) }) }
        XCTAssertEqual(collector.bytes, bytes); XCTAssertEqual(checks, 2)
        revoked = true
        await rejects { try await service.handle(input, stream: { _ in XCTFail("Revoked source disclosed bytes") }) }

    }

    func testCancellationDuringStreamStopsBeforeSecondFrameAndReleasesRequest() async throws {
        let bytes = Data(repeating: 7, count: 131_073)
        try bytes.write(to: folder.appendingPathComponent("selected/cancel.bin"))
        let service = try service(), id = try await root(service)
        let rows = try await service.handle(request("scan", ["rootId": .string(id)])).decode([String: JSONValue].self)
        let entry = try XCTUnwrap(rows["entries"]).decode([MobileFolderReader.Entry].self)[0]
        let started = expectation(description: "first provisional frame"), release = DispatchSemaphore(value: 0)
        let input = request("read-range", ["rootId": .string(id), "path": .string(entry.path), "version": .string(entry.version), "offset": .number(0), "length": .number(Double(bytes.count))])
        let pending = Task { try await service.handle(input, stream: { _ in
            started.fulfill(); _ = release.wait(timeout: .now() + 5)
        }) }
        await fulfillment(of: [started], timeout: 5)
        await rejects { try await service.handle(self.request("list")) }
        pending.cancel(); release.signal()
        await rejects { try await pending.value }
        _ = try await service.handle(request("list"))
    }

    func testStagingRangeSurvivesLateIdentityRefusalWithoutPublishing() async throws {
        var checks = 0, failAt = Int.max
        let service = try service(verify: { _, _ in checks += 1; if checks == failAt { throw MobileFolderStore.Failure.unavailable } })
        let id = try await root(service), bytes = Data(repeating: 71, count: 2 * 1024 * 1024 + 17)
        let scope = MobileSyncStaging.Scope(origin: origin.absoluteString, ownerId: "owner", dataPlane: "home", rootId: "connection", deviceId: "device")
        let source = MobileFolderReader.Entry(path: "sample.bin", id: "cloud", version: "v1", kind: "file", size: Int64(bytes.count), sha256: nil,
            fingerprint: .init(partSizeBytes: 8_388_608, partCount: 1, sha256: SHA256.hash(data: Data(SHA256.hash(data: bytes))).map { String(format: "%02x", $0) }.joined()))
        let transfer = MobileSyncStaging.Request(scope: scope, rootId: id, operation: .init(id: UUID().uuidString.lowercased(), mutation: .init(kind: "copy", from: "remote", path: source.path, source: source, expectedTarget: nil), confirmed: false))
        let fields: [String: JSONValue] = ["rootId": .string(id), "transfer": try .from(transfer)]
        _ = try await service.handle(request("stage-begin", fields))
        final class Cursor: @unchecked Sendable { var offset = 0; var calls = 0 }
        let cursor = Cursor()
        checks = 0; failAt = 2
        let input = request("stage-range", fields.merging(["offset": .number(0), "length": .number(Double(bytes.count))]) { _, next in next })
        await rejects { try await service.handle(input, receive: { count in
            let data = bytes.subdata(in: cursor.offset..<cursor.offset + count)
            cursor.offset += count; cursor.calls += 1; return data
        }) }
        XCTAssertEqual(checks, 2); XCTAssertEqual(cursor.calls, 33)
        failAt = Int.max
        let resumed = try await service.handle(request("stage-begin", fields)).decode([String: JSONValue].self)
        XCTAssertEqual(try XCTUnwrap(resumed["staging"]).decode(MobileSyncStaging.Progress.self).received, Int64(bytes.count))
        _ = try await service.handle(request("stage-finish", fields))
        XCTAssertFalse(FileManager.default.fileExists(atPath: folder.appendingPathComponent("selected/sample.bin").path))
        await rejects { try await service.handle(input) }
        await rejects { try await service.handle(self.request("list"), receive: { _ in Data() }) }
    }

    func testTrashRequiresSeparateConsentAndRestoreSurvivesDisablingDeletions() async throws {
        var saved: [String: Data] = [:], allowTrash = false, trashPrompts = 0, writePrompts = 0, live = true
        let selected = folder.appendingPathComponent("selected"), target = selected.appendingPathComponent("keep.bin")
        let bytes = Data("recover this exact version".utf8)
        try bytes.write(to: target)
        let service = try MacFolderSync(origin: origin,
            store: MobileFolderStore(load: { saved[$0.key] }, save: { saved[$0.key] = $1 }),
            staging: MobileSyncStaging(directory: folder.appendingPathComponent("staging")),
            trash: MobileSyncTrash(directory: folder.appendingPathComponent("trash")),
            verify: { owner, device in
                guard live, owner == "owner", device == "device" else { throw MobileFolderStore.Failure.unavailable }
            }, choose: { selected }, approve: { _ in writePrompts += 1; return true },
            approveTrash: { _ in trashPrompts += 1; return allowTrash })
        let context = try await service.handle(request("context")).decode([String: JSONValue].self)
        XCTAssertEqual(try XCTUnwrap(context["capabilities"]).decode([String: String].self)["fileTrashVersion"], "1.1.0")
        let id = try await root(service)
        let scan = try await service.handle(request("scan", ["rootId": .string(id)])).decode([String: JSONValue].self)
        let entry = try XCTUnwrap(scan["entries"]).decode([MobileFolderReader.Entry].self)[0]
        let scope = MobileSyncStaging.Scope(origin: origin.absoluteString, ownerId: "owner", dataPlane: "home", rootId: "connection", deviceId: "device")
        let operation = MobileSyncTrash.Request(scope: scope, rootId: id,
            operation: .init(id: UUID().uuidString.lowercased(), mutation: .init(kind: "trash", side: "local", path: entry.path, expected: entry), confirmed: false))
        let ordinary = MobileFolderStore.WriteApproval(scope: scope, configurationRevision: "1", configurationHash: String(repeating: "a", count: 64))
        let deletion = MobileFolderStore.WriteApproval(scope: scope, configurationRevision: "1", configurationHash: ordinary.configurationHash, allowTrash: true)
        var fields: [String: JSONValue] = ["rootId": .string(id), "trash": try .from(operation), "approval": try .from(ordinary)]
        _ = try await service.handle(request("write-approve", fields))
        await rejects { try await service.handle(self.request("trash", fields)) }
        XCTAssertEqual(writePrompts, 1); XCTAssertEqual(trashPrompts, 0)
        fields["approval"] = try .from(deletion)
        await rejects { try await service.handle(self.request("trash", fields)) }
        await rejects { try await service.handle(self.request("write-approve", fields)) }
        XCTAssertEqual(try Data(contentsOf: target), bytes)
        allowTrash = true
        _ = try await service.handle(request("write-approve", fields))
        XCTAssertEqual(trashPrompts, 2)
        var changed = fields
        changed["approval"] = try .from(MobileFolderStore.WriteApproval(scope: scope, configurationRevision: "2", configurationHash: ordinary.configurationHash, allowTrash: true))
        await rejects { try await service.handle(self.request("trash", changed)) }
        let result = try await service.handle(request("trash", fields)).decode([String: JSONValue].self)
        let receipt = try XCTUnwrap(result["trash"]).decode(MobileSyncTrash.Lookup.self)
        XCTAssertEqual(receipt.status, "complete"); XCTAssertNil(receipt.receipt?.entry)
        XCTAssertFalse(FileManager.default.fileExists(atPath: target.path))
        let repeated = try await service.handle(request("trash-lookup", fields)).decode([String: JSONValue].self)
        XCTAssertEqual(repeated["trash"], result["trash"])
        live = false
        await rejects { try await service.handle(self.request("trash-inspect", fields)) }
        live = true
        let inspected = try await service.handle(request("trash-inspect", fields)).decode([String: JSONValue].self)
        let retained = try XCTUnwrap(inspected["retainedEntry"]).decode(MobileFolderReader.Entry.self)
        XCTAssertEqual(retained.id, entry.id)
        // Revoke deletion consent by accepting the ordinary configuration again.
        fields["approval"] = try .from(ordinary)
        _ = try await service.handle(request("write-approve", fields))
        fields["restore"] = try .from(MobileSyncTrash.Restore(path: entry.path, expected: retained))
        _ = try await service.handle(request("trash-restore", fields))
        XCTAssertEqual(try Data(contentsOf: target), bytes)
        await rejects { try await service.handle(self.request("trash", fields)) }
        _ = try await service.handle(request("remove", ["rootId": .string(id)]))
        await rejects { try await service.handle(self.request("trash-inspect", fields)) }
        XCTAssertEqual(try Data(contentsOf: target), bytes)
    }

    func testReviewedRecoveryNeedsNativeConsentAndResumesOnlyTheApprovedDestination() async throws {
        struct Interrupted: Error {}
        var saved: [String: Data] = [:], accept = false, live = true, prompts = 0, interrupt = true
        let selected = folder.appendingPathComponent("selected"), target = selected.appendingPathComponent("recover.bin")
        try Data("retained".utf8).write(to: target)
        let store = MobileFolderStore(load: { saved[$0.key] }, save: { saved[$0.key] = $1 })
        let trash = MobileSyncTrash(directory: folder.appendingPathComponent("trash"), afterRestore: { if interrupt { throw Interrupted() } })
        let service = try MacFolderSync(origin: origin, store: store,
            staging: MobileSyncStaging(directory: folder.appendingPathComponent("staging")), trash: trash,
            verify: { _, _ in guard live else { throw MobileFolderStore.Failure.unavailable } },
            choose: { selected }, approve: { _ in false }, approveTrash: { _ in false },
            approveRestore: { _, _ in prompts += 1; return accept })
        let context = try await service.handle(request("context")).decode([String: JSONValue].self)
        XCTAssertEqual(try XCTUnwrap(context["capabilities"]).decode([String: String].self)["fileTrashVersion"], "1.2.0")
        let id = try await root(service), owner = try FileSyncOwnerScope(ownerId: "owner", url: origin), grant = try store.grant(owner, id: id)
        let entry = try XCTUnwrap(MobileFolderReader.scan(bookmark: grant.bookmark).first { $0.path == "recover.bin" })
        let oldScope = MobileSyncStaging.Scope(origin: origin.absoluteString, ownerId: "owner", dataPlane: "home", rootId: "old-connection", deviceId: "old-device")
        let operation = MobileSyncTrash.Request(scope: oldScope, rootId: id, operation: .init(id: UUID().uuidString.lowercased(),
            mutation: .init(kind: "trash", side: "local", path: entry.path, expected: entry), confirmed: false))
        _ = try trash.trash(operation, owner: owner, bookmark: grant.bookmark)
        let listed = try await service.handle(request("trash-list", ["rootId": .string(id)])).decode([String: JSONValue].self)
        XCTAssertEqual(try XCTUnwrap(listed["trashPage"]).decode(MobileSyncTrash.Page.self).items.count, 1)
        var fields: [String: JSONValue] = ["rootId": .string(id), "trash": try .from(operation)]
        let inspected = try await service.handle(request("trash-inspect", fields)).decode([String: JSONValue].self)
        let retained = try XCTUnwrap(inspected["retainedEntry"]).decode(MobileFolderReader.Entry.self)
        fields["restore"] = try .from(MobileSyncTrash.Restore(path: "new-path", expected: retained))
        await rejects { try await service.handle(self.request("trash-restore-reviewed", fields)) }
        XCTAssertEqual(prompts, 1); XCTAssertNil(try trash.restoration(operation, owner: owner, bookmark: grant.bookmark))
        accept = true; live = false
        await rejects { try await service.handle(self.request("trash-restore-reviewed", fields)) }
        XCTAssertEqual(prompts, 1)
        live = true
        await rejects { try await service.handle(self.request("trash-restore-reviewed", fields)) }
        XCTAssertEqual(prompts, 2)
        let pending = try await service.handle(request("trash-inspect", fields)).decode([String: JSONValue].self)
        XCTAssertNotEqual(pending["restoreIntent"], .null)
        var changed = fields
        changed["restore"] = try .from(MobileSyncTrash.Restore(path: "different", expected: retained))
        await rejects { try await service.handle(self.request("trash-restore-reviewed", changed)) }
        interrupt = false
        _ = try await service.handle(request("trash-restore-reviewed", fields))
        XCTAssertEqual(prompts, 2)
        XCTAssertEqual(try Data(contentsOf: selected.appendingPathComponent("new-path")), Data("retained".utf8))
        await rejects { try await service.handle(self.request("trash", fields)) }
    }

    func testOldNativeAdapterCannotApproveTrash() async throws {
        let service = try service(), id = try await root(service)
        let scope = MobileSyncStaging.Scope(origin: origin.absoluteString, ownerId: "owner", dataPlane: "home", rootId: "connection", deviceId: "device")
        let approval = MobileFolderStore.WriteApproval(scope: scope, configurationRevision: "1", configurationHash: String(repeating: "a", count: 64), allowTrash: true)
        await rejects { try await service.handle(self.request("write-approve", ["rootId": .string(id), "approval": try .from(approval)])) }
    }

}
