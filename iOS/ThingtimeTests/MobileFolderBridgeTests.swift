import XCTest
import UIKit
import WebKit
@testable import Thingtime

@MainActor
extension MobileFolderTests {
    func testAnInactiveInterruptionDoesNotWithdrawThePendingRequest() async throws {
        let bridge = MobileFolderBridge(), web = WKWebView()
        let root = URL(string: "https://thingtime.test/")!, id = UUID().uuidString
        var replies: [[String: Any]] = []
        bridge.handle(["payload": ["requestId": id, "ownerId": "folder-test", "action": "list"]], webView: web,
            root: root, currentRoot: { root }, verifyOwner: { _, _ in }, reply: { _, payload in replies.append(payload) })
        // Old observer queued a blanket `suspend` for this exact notification,
        // even if the foreground view had already become active again.
        NotificationCenter.default.post(name: UIApplication.willResignActiveNotification, object: nil)
        for _ in 0..<5 { await Task.yield() }
        XCTAssertTrue(replies.isEmpty, "Temporary inactive must not report a paused folder access error")
        XCTAssertFalse(MobileFolderBridge.suspendsForLifecycle(state: .inactive, photoPermissionPending: false, hasContinuation: false))
        XCTAssertTrue(MobileFolderBridge.suspendsForLifecycle(state: .background, photoPermissionPending: false, hasContinuation: false))
        XCTAssertFalse(MobileFolderBridge.suspendsForLifecycle(state: .background, photoPermissionPending: false, hasContinuation: true))
    }

    func testSuspendingBridgeReleasesOnlyTheMatchingPendingRequest() throws {
        let bridge = MobileFolderBridge(), webView = WKWebView()
        let root = URL(string: "https://thingtime.test")!, id = UUID().uuidString
        var replies: [[String: Any]] = []
        let verify: (MobileDevicePairing.Scope, @escaping () throws -> Void) async throws -> Void = { _, _ in XCTFail("Cancelled request reached authentication") }
        func request(_ id: String, _ action: String) {
            bridge.handle(["payload": ["requestId": id, "ownerId": "folder-test", "action": action]], webView: webView,
                root: root, currentRoot: { root }, verifyOwner: verify, reply: { _, payload in replies.append(payload) })
        }
        request(id, "scan")
        request(UUID().uuidString, "suspend"); XCTAssertTrue(replies.isEmpty)
        request(id, "suspend"); XCTAssertEqual(replies.count, 1)
        XCTAssertEqual(replies.first?["requestId"] as? String, id)
        XCTAssertEqual(replies.first?["ownerId"] as? String, "folder-test")
        XCTAssertNotNil(replies.first?["error"]); XCTAssertNil(replies.first?["roots"])
        bridge.suspend(); XCTAssertEqual(replies.count, 1)
    }
}
