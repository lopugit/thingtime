import XCTest
import WebKit
@testable import Thingtime

@MainActor
final class MobileDeviceBridgeQueueTests: XCTestCase {
    private final class Page: WKWebView {
        var current = URL(string: "https://queue.test")!
        override var url: URL? { current }
    }
    @MainActor private final class Fixture {
        let page = Page()
        var foreground = true
        var owner = "owner"
        var manifests = 0
        var identities = 0
        var gate: CheckedContinuation<Void, Never>?
        var replies: [[String: Any]] = []
        lazy var bridge = MobileDeviceBridge(location: .shared, engineFactory: { check in
            MobileDevicePairing(load: { _ in nil }, save: { _ in XCTFail("Status cannot create pairing material") }, transport: { request in
                let response: [String: Any]
                if request.url!.path == LopuVoiceContract.manifestPath {
                    self.manifests += 1
                    if self.manifests == 1 { await withCheckedContinuation { self.gate = $0 } }
                    response = ["schemaVersion": 1, "origin": "https://queue.test", "features": MobileDevicePairing.requirements.mapValues { ["version": $0.map(String.init).joined(separator: ".")] }]
                } else {
                    XCTAssertEqual(request.url!.path, "/api/v1/auth/me")
                    self.identities += 1
                    response = ["user": ["id": self.owner, "accountKind": "user"]]
                }
                return (try MobileDevicePairing.json(response), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
            }, cookie: { _ in "synthetic=session" }, check: check)
        }, foreground: { self.foreground })
        @discardableResult func send(_ action: String, id: String = UUID().uuidString, owner: String = "owner") -> String {
            let root = URL(string: "https://queue.test")!
            bridge.handle(["payload": ["requestId": id, "ownerId": owner, "action": action, "enabled": true]], webView: page, root: root,
                currentRoot: { root }, cookies: { cookies, _ in cookies }, reply: { _, value in self.replies.append(value) })
            return id
        }
        func release() { let old = gate; gate = nil; old?.resume() }
    }
    private func until(_ predicate: () -> Bool) async {
        for _ in 0..<1000 { if predicate() { return }; await Task.yield() }
        XCTFail("Native request did not reach its deterministic barrier")
    }
    func testReadStatusesWaitForNativePresenceAndVerifyFreshAuthorityFIFO() async throws {
        let f = Fixture(), active = f.send("presence")
        await until { f.gate != nil }
        let first = f.send("status"), second = f.send("status"), mutation = f.send("pair")
        XCTAssertEqual(f.replies.count, 1)
        XCTAssertEqual(f.replies.first?["requestId"] as? String, mutation)
        XCTAssertNotNil(f.replies.first?["error"])
        // The actual holder can outlive the failed web retry's 250 ms window.
        try await Task.sleep(for: .milliseconds(300))
        XCTAssertEqual(f.manifests, 1)
        XCTAssertEqual(f.replies.count, 1)
        f.release()
        await until { f.replies.count == 4 }
        XCTAssertEqual(f.replies.dropFirst().compactMap { $0["requestId"] as? String }, [active, first, second])
        XCTAssertTrue(f.replies.dropFirst().allSatisfy { $0["state"] as? String == "unpaired" })
        XCTAssertEqual(f.identities, 3, "Every queued status verifies the live cookie identity afresh")
    }
    func testCancellingQueuedStatusDoesNotCancelTheHolderOrNextCaller() async {
        let f = Fixture(); let active = f.send("status")
        await until { f.gate != nil }
        let cancelled = f.send("status"), next = f.send("status")
        f.send("suspend", id: cancelled, owner: "other-owner")
        XCTAssertEqual(f.replies.count, 0, "Another owner cannot cancel a queued caller")
        f.send("suspend", id: cancelled)
        XCTAssertEqual(f.replies.count, 1)
        XCTAssertEqual(f.replies[0]["requestId"] as? String, cancelled)
        XCTAssertEqual(f.manifests, 1)
        f.release()
        await until { f.replies.count == 3 }
        XCTAssertEqual(f.replies.dropFirst().compactMap { $0["requestId"] as? String }, [active, next])
        XCTAssertEqual(f.identities, 2)
    }
    func testCancellingHolderPreservesQueuedIndependentStatusAndFencesLateCompletion() async {
        let f = Fixture(), active = f.send("status")
        await until { f.gate != nil }
        let next = f.send("status")
        f.send("suspend", id: active, owner: "other-owner")
        XCTAssertEqual(f.replies.count, 0, "Another owner cannot cancel the holder")
        f.send("suspend", id: active)
        await until { f.replies.count == 2 }
        XCTAssertEqual(f.replies.map { $0["requestId"] as? String }, [active, next])
        XCTAssertEqual(f.replies.last?["state"] as? String, "unpaired")
        f.release()
        for _ in 0..<20 { await Task.yield() }
        XCTAssertEqual(f.replies.count, 2, "Cancelled old work cannot emit a late authoritative result")
    }
    func testQueueDoesNotBorrowOtherOwnerAuthorityAndRechecksForeground() async {
        let f = Fixture(); f.send("status")
        await until { f.gate != nil }
        let other = f.send("status", owner: "other-owner")
        XCTAssertEqual(f.replies[0]["requestId"] as? String, other)
        XCTAssertNotNil(f.replies[0]["error"])
        f.send("status")
        f.foreground = false; f.release()
        await until { f.replies.count == 3 }
        XCTAssertEqual(f.identities, 0)
        XCTAssertEqual(f.manifests, 1, "Queued status cannot start while inactive")
    }
}
