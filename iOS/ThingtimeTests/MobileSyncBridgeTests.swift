import XCTest
import WebKit
@testable import AppleFileSync
@testable import Thingtime

// The byte/publication tests run on both platforms. This exercises the iOS host bridge.
@MainActor
extension MobileSyncStagingTests {
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
        let window = try await MobileBridgeTestReadiness.attach(webView)
        defer { window.isHidden = true; window.rootViewController = nil }
        webView.configuration.userContentController.addUserScript(WKUserScript(source: "window.thingtimeNativeBridge = {};", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView.configuration.userContentController.addUserScript(MobileFolderBridge.script)
        webView.loadHTMLString("<html><body>Native staging fixture</body></html>", baseURL: owner.origin)
        for _ in 0..<100 {
            if let version = try? await webView.evaluateJavaScript("window.thingtimeNativeBridge?.fileStagingVersion"), version as? String == "1.2.0" { break }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        let version = try await webView.evaluateJavaScript("window.thingtimeNativeBridge.fileStagingVersion")
        XCTAssertEqual(version as? String, "1.2.0")
        let encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(transfer))
        var authorizations = 0
        func call(_ action: String) async throws -> [String: Any] {
            try await MobileBridgeTestReadiness.require(webView, origin: owner.origin)
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
        let approval = MobileFolderStore.WriteApproval(scope: transfer.scope, configurationRevision: "v1", configurationHash: String(repeating: "a", count: 64))
        let encodedApproval = try JSONSerialization.jsonObject(with: JSONEncoder().encode(approval))
        func publish() async throws -> [String: Any] {
            try await MobileBridgeTestReadiness.require(webView, origin: owner.origin)
            let complete = expectation(description: "publication"), id = UUID().uuidString
            var response: [String: Any]?
            bridge.handle(["payload": ["requestId": id, "ownerId": owner.ownerId, "rootId": grant.id,
                "action": "publish", "transfer": encoded, "stage": stage, "approval": encodedApproval]],
                webView: webView, root: owner.origin, currentRoot: { owner.origin }, verifyOwner: { supplied, check in
                    XCTAssertEqual(supplied, owner); try check()
                }, reply: { _, payload in response = payload; complete.fulfill() })
            await fulfillment(of: [complete], timeout: 5); return try XCTUnwrap(response)
        }
        let denied = try await publish(); XCTAssertNotNil(denied["error"])
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: selected.path), [])
        // Synthetic consent only for this isolated test grant; production uses UIAlertController.
        try store.approveWrite(owner, grant: grant, approval: approval)
        try FileManager.default.createDirectory(at: selected.appendingPathComponent("nested"), withIntermediateDirectories: true)
        let published = try await publish()
        XCTAssertNil(published["error"])
        XCTAssertEqual((published["publication"] as? [String: Any])?["status"] as? String, "complete")
        XCTAssertEqual(try Data(contentsOf: selected.appendingPathComponent(transfer.operation.mutation.path)), bytes)
        bridge.suspend()
    }

    func testBridgeTrashSeparatesConsentAndPreservesARecreatedDestination() async throws {
        let bytes = Data("retained iOS bytes".utf8), (cache, owner, initial) = try fixture(Data([1]))
        let selected = cache.appendingPathComponent("selected")
        try FileManager.default.createDirectory(at: selected, withIntermediateDirectories: true)
        let target = selected.appendingPathComponent("retained.bin")
        try bytes.write(to: target)
        var data: Data?
        let store = MobileFolderStore(load: { _ in data }, save: { _, next in data = next })
        let grant = try store.add(owner, selected: selected)
        let entry = try XCTUnwrap(MobileFolderReader.scan(bookmark: grant.bookmark).first)
        let request = MobileSyncTrash.Request(scope: initial.scope, rootId: grant.id,
            operation: .init(id: UUID().uuidString.lowercased(), mutation: .init(kind: "trash", side: "local", path: entry.path, expected: entry), confirmed: false))
        let bridge = MobileFolderBridge(store: store, staging: MobileSyncStaging(directory: cache.appendingPathComponent("staging")),
            trash: MobileSyncTrash(directory: cache.appendingPathComponent("trash")))
        let webView = WKWebView()
        let window = try await MobileBridgeTestReadiness.attach(webView)
        defer { window.isHidden = true; window.rootViewController = nil }
        webView.configuration.userContentController.addUserScript(WKUserScript(source: "window.thingtimeNativeBridge = {};", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView.configuration.userContentController.addUserScript(MobileFolderBridge.script)
        webView.loadHTMLString("<html><body>Native trash fixture</body></html>", baseURL: owner.origin)
        for _ in 0..<100 {
            if let version = try? await webView.evaluateJavaScript("window.thingtimeNativeBridge?.fileTrashVersion"), version as? String == "1.2.1" { break }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        let version = try await webView.evaluateJavaScript("window.thingtimeNativeBridge.fileTrashVersion")
        XCTAssertEqual(version as? String, "1.2.1")
        let encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(request))
        let ordinary = MobileFolderStore.WriteApproval(scope: initial.scope, configurationRevision: "v1", configurationHash: String(repeating: "a", count: 64))
        let deletion = MobileFolderStore.WriteApproval(scope: initial.scope, configurationRevision: "v1", configurationHash: ordinary.configurationHash, allowTrash: true)
        var approval = ordinary, live = true
        func call(_ action: String, restore: MobileSyncTrash.Restore? = nil) async throws -> [String: Any] {
            try await MobileBridgeTestReadiness.require(webView, origin: owner.origin)
            let complete = expectation(description: action)
            var response: [String: Any]?
            var payload: [String: Any] = ["requestId": UUID().uuidString, "ownerId": owner.ownerId, "rootId": grant.id,
                "action": action, "trash": encoded, "approval": try JSONSerialization.jsonObject(with: JSONEncoder().encode(approval))]
            if let restore { payload["restore"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(restore)) }
            bridge.handle(["payload": payload], webView: webView, root: owner.origin, currentRoot: { owner.origin },
                verifyOwner: { supplied, check in
                    XCTAssertEqual(supplied, owner); try check()
                    if !live { throw MobileFolderStore.Failure.unavailable }
                }, reply: { _, payload in response = payload; complete.fulfill() })
            await fulfillment(of: [complete], timeout: 5)
            return try XCTUnwrap(response)
        }
        try store.approveWrite(owner, grant: grant, approval: ordinary)
        let denied = try await call("trash"); XCTAssertNotNil(denied["error"])
        XCTAssertEqual(try Data(contentsOf: target), bytes)
        approval = deletion
        let unapproved = try await call("trash"); XCTAssertNotNil(unapproved["error"])
        // Synthetic consent is restricted to this disposable native test grant.
        try store.approveWrite(owner, grant: grant, approval: deletion)
        let deleted = try await call("trash"); XCTAssertNil(deleted["error"])
        let receipt = try XCTUnwrap((deleted["trash"] as? [String: Any])?["receipt"] as? [String: Any])
        XCTAssertTrue(receipt["entry"] is NSNull)
        XCTAssertFalse(FileManager.default.fileExists(atPath: target.path))
        live = false
        let revoked = try await call("trash-inspect"); XCTAssertNotNil(revoked["error"])
        live = true
        let inspected = try await call("trash-inspect")
        let retained = try JSONDecoder().decode(MobileFolderReader.Entry.self,
            from: JSONSerialization.data(withJSONObject: try XCTUnwrap(inspected["retainedEntry"])))
        try Data("new local version".utf8).write(to: target)
        let occupied = try await call("trash-restore", restore: .init(path: entry.path, expected: retained))
        XCTAssertNotNil(occupied["error"])
        approval = ordinary; try store.approveWrite(owner, grant: grant, approval: ordinary)
        let restored = try await call("trash-restore", restore: .init(path: "recovered.bin", expected: retained))
        XCTAssertNil(restored["error"])
        XCTAssertEqual(try Data(contentsOf: selected.appendingPathComponent("recovered.bin")), bytes)
        XCTAssertEqual(try Data(contentsOf: target), Data("new local version".utf8))
        bridge.suspend()
    }

}
