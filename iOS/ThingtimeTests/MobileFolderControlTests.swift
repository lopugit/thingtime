import AppleFileSync
import XCTest
import WebKit
@testable import Thingtime

@MainActor
final class MobileFolderControlTests: XCTestCase {
    func testTokensFenceLateCompletionIdentityAndPauseWithoutTouchingOtherControls() throws {
        let lane = MobileFolderControlRequests()
        let scope = try FileSyncOwnerScope(ownerId: "control-owner", url: URL(string: "https://control.test")!)
        let other = try FileSyncOwnerScope(ownerId: "other-owner", url: scope.origin)
        var cancelled: [String] = []
        func begin(_ id: String, _ action: String, _ config: String? = nil) throws -> MobileFolderControlRequests.Token {
            try XCTUnwrap(lane.begin(requestId: id, scope: scope, action: action, configurationId: config) { _ in cancelled.append(id) })
        }
        XCTAssertNil(lane.begin(requestId: "upload", scope: scope, action: "upload-file", configurationId: nil) { _ in XCTFail() })
        let old = try begin("reused", "list")
        XCTAssertTrue(lane.cancel("reused", reason: .requestCancelled))
        let replacement = try begin("reused", "list")
        XCTAssertFalse(lane.finish(old)); XCTAssertTrue(lane.isCurrent(replacement))
        let wake = try begin("wake", "wake-photo-run", "a")
        let sibling = try begin("sibling", "wake-photo-run", "b")
        let status = try begin("status", "photo-run-status", "a")
        lane.cancelWakes(scope: scope, configurationId: "a")
        XCTAssertFalse(lane.isCurrent(wake)); XCTAssertTrue(lane.isCurrent(sibling)); XCTAssertTrue(lane.isCurrent(status))
        lane.verified(other)
        XCTAssertFalse(lane.isCurrent(replacement)); XCTAssertFalse(lane.isCurrent(sibling)); XCTAssertFalse(lane.isCurrent(status))
        XCTAssertEqual(cancelled.sorted(), ["reused", "reused", "sibling", "status", "wake"].sorted())
    }

    func testRealHandlerCompletesVerifiedListWhileMainRequestHeldAndExactAbortKeepsSibling() async throws {
        let origin = URL(string: "https://folder-control.test/")!
        let web = WKWebView(), window = try await MobileBridgeTestReadiness.attach(web)
        defer { window.isHidden = true; window.rootViewController = nil }
        web.loadHTMLString("<html><body>Control lane</body></html>", baseURL: origin)
        try await MobileBridgeTestReadiness.require(web, origin: origin)
        var saved: Data?
        let bridge = MobileFolderBridge(store: MobileFolderStore(load: { _ in saved }, save: { _, value in saved = value }))
        var held: CheckedContinuation<Void, Never>?, replies: [[String: Any]] = [], validations = 0
        let main = UUID().uuidString, control = UUID().uuidString, sibling = UUID().uuidString
        let completed = expectation(description: "independent verified list")
        func request(_ id: String, control isControl: Bool, hold: Bool = false) {
            var payload: [String: Any] = ["requestId": id, "ownerId": "control-owner", "action": "list"]
            if isControl { payload["control"] = "photos-startup-v1" }
            bridge.handle(["payload": payload], webView: web, root: origin, currentRoot: { origin },
                verifyOwner: { _, check in
                    if id == main || hold { await withCheckedContinuation { held = $0 } }
                    try check()
                }, verifyDevice: { _, device, check in XCTAssertEqual(device, "paired-device"); validations += 1; try check() },
                pairedDevice: { _, check in try check(); return "paired-device" },
                reply: { _, result in replies.append(result); if result["requestId"] as? String == control && result["roots"] != nil { completed.fulfill() } })
        }
        request(main, control: false)
        for _ in 0..<20 { if held != nil { break }; await Task.yield() }
        XCTAssertNotNil(held)
        let mainContinuation = held; held = nil
        request(control, control: true)
        await fulfillment(of: [completed], timeout: 3)
        XCTAssertGreaterThan(validations, 0)
        XCTAssertFalse(replies.contains { $0["requestId"] as? String == main })
        request(sibling, control: true, hold: true)
        for _ in 0..<20 { if held != nil { break }; await Task.yield() }
        XCTAssertNotNil(held)
        // Exact main abort must not cancel the independently held control.
        bridge.handle(["payload": ["requestId": main, "ownerId": "control-owner", "action": "suspend"]], webView: web,
            root: origin, currentRoot: { origin }, verifyOwner: { _, _ in }, reply: { _, _ in XCTFail() })
        XCTAssertFalse(replies.contains { $0["requestId"] as? String == sibling })
        bridge.suspend(.contextChanged)
        mainContinuation?.resume(); held?.resume(); held = nil
        for _ in 0..<10 { await Task.yield() }
        XCTAssertFalse(replies.contains { $0["requestId"] as? String == sibling }, "Old context must never deliver its late result")
    }
}
