import XCTest
@testable import ThingtimePasswordCore

final class PasswordHostRequestScopeTests: XCTestCase {
    private let root = URL(string: "https://thingtime.example")!
    private func cookie(domain: String = "thingtime.example", path: String = "/", secure: Bool = true, httpOnly: Bool = true, expires: Date? = nil) -> HTTPCookie {
        var values: [HTTPCookiePropertyKey: Any] = [.name: "tt_auth", .value: "synthetic-fixture", .domain: domain, .path: path]
        if secure { values[.secure] = "TRUE" }
        if httpOnly { values[HTTPCookiePropertyKey("HttpOnly")] = "TRUE" }
        if let expires { values[.expires] = expires }
        return HTTPCookie(properties: values)!
    }
    func testOnlyVerifiedHTTPSMainDocumentOrigin() {
        func permits(_ page: String, _ frame: String, scheme: String = "https", host: String = "thingtime.example", port: Int = 0) -> Bool {
            PasswordHostRequestScope.permits(root: root, page: URL(string: page)!, frame: URL(string: frame)!, securityScheme: scheme, securityHost: host, securityPort: port)
        }
        XCTAssertTrue(permits("https://thingtime.example/passwords", "https://thingtime.example/passwords"))
        XCTAssertFalse(permits("https://other.example/passwords", "https://thingtime.example/passwords"))
        XCTAssertFalse(permits("https://thingtime.example/passwords", "https://other.example/passwords"))
        XCTAssertFalse(permits("https://thingtime.example:444/passwords", "https://thingtime.example/passwords"))
        XCTAssertFalse(permits("https://thingtime.example/passwords", "https://thingtime.example/passwords", host: "other.example"))
        XCTAssertFalse(permits("https://thingtime.example/passwords", "https://thingtime.example/passwords", scheme: "http"))
    }
    func testLoopbackCanReceiveUnsupportedStatusButCannotAcquireProviderAuthority() {
        let local = URL(string: "http://127.0.0.1:19283")!
        XCTAssertTrue(PasswordHostRequestScope.permitsTransport(root: local, page: local, frame: local, securityScheme: "http", securityHost: "127.0.0.1", securityPort: 19283))
        XCTAssertFalse(PasswordHostRequestScope.permits(root: local, page: local, frame: local, securityScheme: "http", securityHost: "127.0.0.1", securityPort: 19283))
        let insecure = URL(string: "http://thingtime.example")!
        XCTAssertFalse(PasswordHostRequestScope.permitsTransport(root: insecure, page: insecure, frame: insecure, securityScheme: "http", securityHost: "thingtime.example", securityPort: 80))
    }
    func testNativeTransportAcceptsMissingOrNullOwnerButKeepsCorrelationTyped() {
        var payload: [String: Any] = ["action": "sync", "requestId": UUID().uuidString, "documentNonce": UUID().uuidString]
        XCTAssertEqual(PasswordHostBridgeRequest(payload)?.ownerId, "")
        payload["ownerId"] = NSNull()
        XCTAssertEqual(PasswordHostBridgeRequest(payload)?.ownerId, "")
        payload["ownerId"] = "synthetic-owner"
        XCTAssertEqual(PasswordHostBridgeRequest(payload)?.ownerId, "synthetic-owner")
        payload["ownerId"] = 123
        XCTAssertNil(PasswordHostBridgeRequest(payload))
        payload.removeValue(forKey: "ownerId"); payload["requestId"] = NSNull()
        XCTAssertNil(PasswordHostBridgeRequest(payload))
        payload["requestId"] = UUID().uuidString; payload["action"] = ["sync"]
        XCTAssertNil(PasswordHostBridgeRequest(payload))
    }
    func testCookieSelectionRefusesAmbiguousUnprotectedOrWrongDestination() throws {
        XCTAssertEqual(try PasswordHostRequestScope.authenticationCookie([cookie()], origin: root), "tt_auth=synthetic-fixture")
        for invalid in [cookie(domain: "other.example"), cookie(path: "/passwords"), cookie(secure: false), cookie(httpOnly: false), cookie(expires: Date(timeIntervalSince1970: 1))] {
            XCTAssertThrowsError(try PasswordHostRequestScope.authenticationCookie([invalid], origin: root))
        }
        XCTAssertThrowsError(try PasswordHostRequestScope.authenticationCookie([cookie(), cookie(domain: ".thingtime.example")], origin: root))
        XCTAssertThrowsError(try PasswordHostRequestScope.authenticationCookie([], origin: root))
        XCTAssertThrowsError(try PasswordHostRequestScope.authenticationCookie([cookie()], origin: URL(string: "http://thingtime.example")!))
    }
    @MainActor func testAccountSwitchDuringDocumentCheckCannotCommit() async throws {
        let generation = UUID()
        let expected = try ProviderSession(origin: root, ownerId: "synthetic-owner", cookie: "tt_auth=synthetic-fixture")
        var switched = false, committed = false
        do {
            try await PasswordHostCommitFence.verify(expected: expected, generation: generation,
                checkDocument: { await Task.yield(); switched = true },
                cookies: { switched ? [] : [self.cookie()] },
                currentGeneration: { generation }, destinationIsCurrent: { true })
            committed = true
        } catch { XCTAssertEqual(error as? PasswordProviderError, .sessionChanged) }
        XCTAssertFalse(committed)
    }
    @MainActor func testNavigationDuringFinalCookieReadCannotCommit() async throws {
        let generation = UUID(); var current = generation
        let expected = try ProviderSession(origin: root, ownerId: "synthetic-owner", cookie: "tt_auth=synthetic-fixture")
        do {
            try await PasswordHostCommitFence.verify(expected: expected, generation: generation,
                checkDocument: {}, cookies: { await Task.yield(); current = UUID(); return [self.cookie()] },
                currentGeneration: { current }, destinationIsCurrent: { true })
            XCTFail("Stale operation passed its final authority fence")
        } catch { XCTAssertEqual(error as? PasswordProviderError, .sessionChanged) }
    }
    @MainActor func testUnchangedDocumentCookieAndGenerationCanCommit() async throws {
        let generation = UUID()
        let expected = try ProviderSession(origin: root, ownerId: "synthetic-owner", cookie: "tt_auth=synthetic-fixture")
        try await PasswordHostCommitFence.verify(expected: expected, generation: generation,
            checkDocument: {}, cookies: { [self.cookie()] }, currentGeneration: { generation }, destinationIsCurrent: { true })
    }

    @MainActor func testLogoutQueuedAfterSaveWaitsForIndexThenClears() async {
        let queue = PasswordHostRetirementQueue()
        var saved = false, indexed = false, cleared = false
        var indexCompletion: CheckedContinuation<Void, Never>?
        let submitted = expectation(description: "Session saved; system index callback suspended")
        let operation = Task { @MainActor in
            saved = true
            await withCheckedContinuation { continuation in
                indexCompletion = continuation; submitted.fulfill()
            }
            indexed = true
            queue.drain()
        }
        await fulfillment(of: [submitted], timeout: 2)
        XCTAssertTrue(saved); XCTAssertFalse(indexed)
        XCTAssertTrue(queue.enqueue { cleared = true })
        XCTAssertFalse(queue.enqueue { XCTFail("A second pending logout displaced the first") })
        XCTAssertFalse(cleared)
        indexCompletion?.resume()
        await operation.value
        XCTAssertTrue(indexed); XCTAssertTrue(cleared)
        cleared = false; queue.drain(); XCTAssertFalse(cleared)
        XCTAssertTrue(queue.enqueue { cleared = true }); queue.cancel(); queue.drain(); XCTAssertFalse(cleared)
    }

}
