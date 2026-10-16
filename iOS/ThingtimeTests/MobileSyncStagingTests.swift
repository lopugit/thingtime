import XCTest
import CryptoKit
import WebKit
@testable import Thingtime

@MainActor
final class MobileSyncStagingTests: XCTestCase {
    private func fixture(_ bytes: Data, folder: Bool = false) throws -> (URL, MobileDevicePairing.Scope, MobileSyncStaging.Request) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("staging-test-" + UUID().uuidString, isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let owner = try MobileDevicePairing.Scope(ownerId: "staging-test", url: URL(string: "https://thingtime.test")!)
        let scope = MobileSyncStaging.Scope(origin: owner.origin.absoluteString, ownerId: owner.ownerId, dataPlane: "home", rootId: "config", deviceId: "device")
        var digest = SHA256(); let partSize = 8 * 1024 * 1024
        for offset in stride(from: 0, to: bytes.count, by: partSize) { digest.update(data: Data(SHA256.hash(data: bytes.subdata(in: offset..<min(bytes.count, offset + partSize))))) }
        let fingerprint = bytes.isEmpty || folder ? nil : MobileFolderReader.Fingerprint(partSizeBytes: Int64(partSize),
            partCount: (bytes.count + partSize - 1) / partSize, sha256: digest.finalize().map { String(format: "%02x", $0) }.joined())
        let entry = MobileFolderReader.Entry(path: "nested/file.bin", id: "cloud-file", version: "cloud-v1", kind: folder ? "folder" : "file",
            size: folder ? 0 : Int64(bytes.count), sha256: folder || fingerprint != nil ? nil : SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined(), fingerprint: fingerprint)
        let op = MobileSyncStaging.Operation(id: UUID().uuidString.lowercased(),
            mutation: .init(kind: "copy", from: "remote", path: entry.path, source: entry, expectedTarget: nil), confirmed: false)
        return (root, owner, .init(scope: scope, rootId: UUID().uuidString.lowercased(), operation: op))
    }
    func testMultipartStagingResumesAfterReopenAndVerifiesEveryByte() throws {
        let bytes = Data(repeating: 13, count: 8 * 1024 * 1024 + 17)
        let (root, owner, request) = try fixture(bytes)
        var stage = MobileSyncStaging(directory: root)
        XCTAssertEqual(try stage.begin(request, owner: owner).received, 0)
        let first = bytes.prefix(65_536)
        XCTAssertEqual(try stage.append(request, owner: owner, offset: 0, bytes: first).received, 65_536)
        stage = MobileSyncStaging(directory: root)
        XCTAssertEqual(try stage.begin(request, owner: owner).received, 65_536)
        XCTAssertEqual(try stage.append(request, owner: owner, offset: 0, bytes: first).received, 65_536)
        XCTAssertThrowsError(try stage.append(request, owner: owner, offset: 0, bytes: Data(repeating: 7, count: first.count)))
        for offset in stride(from: 65_536, to: bytes.count, by: 65_536) {
            _ = try stage.append(request, owner: owner, offset: Int64(offset), bytes: bytes.subdata(in: offset..<min(bytes.count, offset + 65_536)))
        }
        let done = try XCTUnwrap(stage.finish(request, owner: owner).stage)
        XCTAssertEqual(done.entry.fingerprint, request.operation.mutation.source.fingerprint)
        XCTAssertEqual(done.operationId, request.operation.id); XCTAssertEqual(done.scope, request.scope)
        let encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(done)) as! [String: Any]
        XCTAssertTrue((encoded["entry"] as? [String: Any])?["sha256"] is NSNull)
        XCTAssertEqual(try MobileSyncStaging(directory: root).finish(request, owner: owner).stage, done)
        XCTAssertEqual(try MobileSyncStaging(directory: root).begin(request, owner: owner).stage, done)
        // No caller-selected destination was created by staging.
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("nested/file.bin").path))
    }
    func testCrashAfterBytesBeforeCheckpointDiscardsOnlyUnacknowledgedTail() throws {
        let bytes = Data([1, 2, 3]), (root, owner, request) = try fixture(bytes)
        struct LostCheckpoint: Error {}
        let interrupted = MobileSyncStaging(directory: root, afterBytesFlushed: { throw LostCheckpoint() })
        _ = try interrupted.begin(request, owner: owner)
        XCTAssertThrowsError(try interrupted.append(request, owner: owner, offset: 0, bytes: bytes))
        let resumed = MobileSyncStaging(directory: root)
        XCTAssertEqual(try resumed.begin(request, owner: owner).received, 0)
        XCTAssertThrowsError(try resumed.finish(request, owner: owner))
        _ = try resumed.append(request, owner: owner, offset: 0, bytes: bytes)
        XCTAssertNotNil(try resumed.finish(request, owner: owner).stage)
    }
    func testScopeOperationRangesAndChecksumsFailClosed() throws {
        let bytes = Data([1, 2, 3]), (root, owner, request) = try fixture(bytes), stage = MobileSyncStaging(directory: root)
        _ = try stage.begin(request, owner: owner)
        XCTAssertThrowsError(try stage.begin(request, owner: MobileDevicePairing.Scope(ownerId: "other", url: owner.origin)))
        XCTAssertThrowsError(try stage.begin(request, owner: MobileDevicePairing.Scope(ownerId: owner.ownerId, url: URL(string: "https://other.test")!)))
        var object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as! [String: Any]
        var operation = object["operation"] as! [String: Any], mutation = operation["mutation"] as! [String: Any], source = mutation["source"] as! [String: Any]
        source["version"] = "different"; mutation["source"] = source; operation["mutation"] = mutation; object["operation"] = operation
        let changed = try JSONDecoder().decode(MobileSyncStaging.Request.self, from: JSONSerialization.data(withJSONObject: object))
        XCTAssertThrowsError(try stage.begin(changed, owner: owner))
        for offset: Int64 in [-1, 1, 4] { XCTAssertThrowsError(try stage.append(request, owner: owner, offset: offset, bytes: Data([1]))) }
        XCTAssertThrowsError(try stage.append(request, owner: owner, offset: 0, bytes: Data(repeating: 1, count: 65_537)))
        _ = try stage.append(request, owner: owner, offset: 0, bytes: Data([1, 2, 9]))
        XCTAssertThrowsError(try stage.finish(request, owner: owner))
        XCTAssertNil(try stage.begin(request, owner: owner).stage)
    }
    func testEmptyFilesFoldersAndCorruptCompletedPayloads() throws {
        for folder in [false, true] {
            let (root, owner, request) = try fixture(Data(), folder: folder), stage = MobileSyncStaging(directory: root)
            _ = try stage.begin(request, owner: owner)
            let result = try XCTUnwrap(stage.finish(request, owner: owner).stage)
            XCTAssertEqual(result.entry.kind, folder ? "folder" : "file")
            let payload = root.appendingPathComponent(result.token).appendingPathComponent("payload")
            if folder { try Data([1]).write(to: payload.appendingPathComponent("unexpected")) }
            else { try Data([1]).write(to: payload) }
            XCTAssertThrowsError(try stage.begin(request, owner: owner))
        }
    }
    func testSymlinkPayloadNeverWritesOutsidePrivateStaging() throws {
        let (root, owner, request) = try fixture(Data([1])), stage = MobileSyncStaging(directory: root)
        _ = try stage.begin(request, owner: owner)
        let child = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil).first { $0.lastPathComponent != "lock" })
        let outside = root.appendingPathComponent("sentinel")
        try Data([9]).write(to: outside)
        let payload = child.appendingPathComponent("payload")
        try FileManager.default.removeItem(at: payload)
        try FileManager.default.createSymbolicLink(at: payload, withDestinationURL: outside)
        XCTAssertThrowsError(try stage.append(request, owner: owner, offset: 0, bytes: Data([1])))
        XCTAssertEqual(try Data(contentsOf: outside), Data([9]))
    }
    func testBridgeStagesRealBytesThroughAnAuthorizedNativeGrant() async throws {
        let bytes = Data([1, 2, 3]), (cache, owner, initial) = try fixture(bytes)
        let selected = FileManager.default.temporaryDirectory.appendingPathComponent("staging-root-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: selected, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: selected) }
        var data: Data?
        let store = MobileFolderStore(load: { _ in data }, save: { _, next in data = next })
        let grant = try store.add(owner, selected: selected)
        let transfer = MobileSyncStaging.Request(scope: initial.scope, rootId: grant.id, operation: initial.operation)
        let bridge = MobileFolderBridge(store: store, staging: MobileSyncStaging(directory: cache))
        let webView = WKWebView()
        webView.configuration.userContentController.addUserScript(WKUserScript(source: "window.thingtimeNativeBridge = {};", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView.configuration.userContentController.addUserScript(MobileFolderBridge.script)
        webView.loadHTMLString("<html><body>Native staging fixture</body></html>", baseURL: owner.origin)
        for _ in 0..<100 {
            if let version = try? await webView.evaluateJavaScript("window.thingtimeNativeBridge?.fileStagingVersion"), version as? String == "1.0.0" { break }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        let version = try await webView.evaluateJavaScript("window.thingtimeNativeBridge.fileStagingVersion")
        XCTAssertEqual(version as? String, "1.0.0")
        let encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(transfer))
        var authorizations = 0
        func call(_ action: String) async throws -> [String: Any] {
            let complete = expectation(description: action)
            var response: [String: Any]?
            bridge.handle(["payload": ["requestId": UUID().uuidString, "ownerId": owner.ownerId, "rootId": grant.id,
                "action": action, "transfer": encoded, "offset": 0, "data": bytes.base64EncodedString()]],
                webView: webView, root: owner.origin, currentRoot: { owner.origin }, verifyOwner: { supplied, check in
                    XCTAssertEqual(supplied, owner); try check(); authorizations += 1
                }, reply: { type, payload in XCTAssertEqual(type, "mobile-files-result"); response = payload; complete.fulfill() })
            await fulfillment(of: [complete], timeout: 5)
            let result = try XCTUnwrap(response)
            XCTAssertNil(result["error"])
            return try XCTUnwrap(result["staging"] as? [String: Any])
        }
        let began = try await call("stage-begin"), appended = try await call("stage-append")
        XCTAssertEqual(began["received"] as? Int, 0); XCTAssertEqual(appended["received"] as? Int, 3)
        let done = try await call("stage-finish")
        let stage = try XCTUnwrap(done["stage"] as? [String: Any])
        XCTAssertEqual(stage["operationId"] as? String, transfer.operation.id)
        XCTAssertTrue((stage["entry"] as? [String: Any])?["sha256"] is NSNull)
        XCTAssertEqual(authorizations, 6)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: selected.path), [])
        bridge.suspend()
    }

    func testConcurrentReceiverInstancesDeduplicateTheSameChunk() async throws {
        let bytes = Data([1, 2, 3]), (root, owner, request) = try fixture(bytes)
        let first = MobileSyncStaging(directory: root), second = MobileSyncStaging(directory: root)
        _ = try first.begin(request, owner: owner)
        let left = Task.detached { try first.append(request, owner: owner, offset: 0, bytes: bytes) }
        let right = Task.detached { try second.append(request, owner: owner, offset: 0, bytes: bytes) }
        let a = try await left.value, b = try await right.value
        XCTAssertEqual(a.received, 3); XCTAssertEqual(b.received, 3)
        XCTAssertNotNil(try second.finish(request, owner: owner).stage)
    }

}
