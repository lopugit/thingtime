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

}
