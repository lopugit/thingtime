import XCTest
import WebKit
@testable import Thingtime

@MainActor
extension MobileFolderTests {
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
