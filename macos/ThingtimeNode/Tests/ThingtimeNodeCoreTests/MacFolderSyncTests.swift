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
            staging: MobileSyncStaging(directory: folder.appendingPathComponent("private")), verify: verify,
            choose: { selected }, approve: approve)
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
        XCTAssertEqual(capabilities, ["fileAccessVersion": "1.2.0", "fileStagingVersion": "1.0.0", "filePublicationVersion": "1.1.0"])
        let result = try await service.handle(request("conditions")).decode([String: JSONValue].self)
        XCTAssertEqual(result["conditions"], .object(["network": .string("unknown"), "charging": .null]))
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

}
