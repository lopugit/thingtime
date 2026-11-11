import XCTest
import WebKit
@testable import Thingtime

@MainActor
final class MobileDeviceBridgeLifecycleTests: XCTestCase {
    func testSuspensionSettlesPendingIdentityRequestOnceWithoutSendingToAnotherOrigin() async throws {
        let origin = URL(string:"https://native-lifecycle.test/")!
        let configuration = WKWebViewConfiguration(); configuration.websiteDataStore = .nonPersistent()
        let web = WKWebView(frame:.zero,configuration:configuration)
        web.loadHTMLString("<html><body>Lifecycle fixture</body></html>",baseURL:origin)
        for _ in 0..<100 {
            if !web.isLoading, web.url == origin { break }
            try await Task.sleep(nanoseconds:20_000_000)
        }
        XCTAssertEqual(web.url,origin)
        let bridge = MobileDeviceBridge()
        var current = origin, replies:[[String:Any]]=[]
        func request() -> String {
            let id = UUID().uuidString
            bridge.handle(["payload":["requestId":id,"ownerId":"synthetic-owner","action":"presence","enabled":true]],webView:web,root:origin,
                currentRoot:{current},cookies:{values,_ in values},reply:{type,payload in XCTAssertEqual(type,"mobile-device-result");replies.append(payload)})
            return id
        }
        let first = request(); bridge.suspend(); bridge.suspend()
        XCTAssertEqual(replies.count,1); XCTAssertEqual(replies.first?["requestId"] as? String,first)
        XCTAssertNotNil(replies.first?["error"]); XCTAssertNil(replies.first?["deviceId"])
        await Task.yield(); XCTAssertEqual(replies.count,1)
        let authorization = request()
        let stop = UUID().uuidString
        bridge.handle(["payload":["requestId":stop,"ownerId":"synthetic-owner","action":"presence","enabled":false]],
            webView:web,root:origin,currentRoot:{current},cookies:{values,_ in values},reply:{_,payload in replies.append(payload)})
        XCTAssertEqual(replies.count,3)
        XCTAssertEqual(replies[1]["requestId"] as? String,authorization)
        XCTAssertEqual(replies[2]["requestId"] as? String,stop)
        XCTAssertEqual(replies[2]["state"] as? String,"paused")
        await Task.yield()
        XCTAssertEqual(replies.count,3,"Late authorization cannot re-enable stopped presence")
        _ = request(); current = URL(string:"https://another.test")!; bridge.suspend()
        await Task.yield(); XCTAssertEqual(replies.count,3,"Do not deliver old account context after a destination switch")
    }
}
