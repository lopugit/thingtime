import XCTest
@testable import ThingtimePasswordCore

private final class RecoveryURLProtocol: URLProtocol {
    static var reply: ((URLRequest) throws -> (HTTPURLResponse, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (response, data) = try Self.reply!(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

final class NativeRecoveryTests: XCTestCase {
    private let root = URL(string: "https://passwords.example.test")!
    private func session(owner: String = "fixture-owner", origin: URL? = nil) throws -> ProviderSession {
        try ProviderSession(origin: origin ?? root, ownerId: owner, cookie: "tt_auth=synthetic-session")
    }
    private func json(_ body: [String: Any]) throws -> Data { try JSONSerialization.data(withJSONObject: body) }
    private func transport() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RecoveryURLProtocol.self]; configuration.httpCookieStorage = nil
        return URLSession(configuration: configuration)
    }
    private func manifest(origin: String? = nil, version: String = "1.3.0") throws -> Data {
        try json(["schemaVersion": 1, "origin": origin ?? root.absoluteString, "features": ["api.passwords": ["version": version]]])
    }
    private func cookie(domain: String = "passwords.example.test", path: String = "/", secure: Bool = true, httpOnly: Bool = true, expires: Date? = nil) throws -> HTTPCookie {
        var properties: [HTTPCookiePropertyKey: Any] = [.domain: domain, .path: path, .name: "tt_auth", .value: "synthetic-session"]
        if secure { properties[.secure] = "TRUE" }
        if httpOnly { properties[HTTPCookiePropertyKey("HttpOnly")] = "TRUE" }
        properties[.expires] = expires
        return try XCTUnwrap(HTTPCookie(properties: properties))
    }
    func testOnlyOneExactSecureWebViewCookieCanConnect() throws {
        let valid = try cookie()
        XCTAssertEqual(try PasswordWebConnectionAuthority.cookie([valid], origin: root), "tt_auth=synthetic-session")
        for cookies in [[], [valid, valid], [try cookie(domain: ".example.test")], [try cookie(domain: ".passwords.example.test")], [valid, try cookie(path: "/api")],
                        [try cookie(path: "/api")], [try cookie(secure: false)], [try cookie(httpOnly: false)],
                        [try cookie(expires: Date(timeIntervalSince1970: 0))], [try cookie(domain: "attacker.test")]] {
            XCTAssertThrowsError(try PasswordWebConnectionAuthority.cookie(cookies, origin: root))
        }
        XCTAssertThrowsError(try PasswordWebConnectionAuthority.cookie([valid], origin: URL(string: "http://passwords.example.test")!))
    }
    func testServerOwnerAndConfiguredVaultAreRequired() throws {
        let valid = try json(["ok": true, "configured": true, "ownerId": "fixture-owner"])
        let linked = try PasswordWebConnectionAuthority.session(valid, origin: root, cookie: "tt_auth=synthetic-session", expectedOwner: nil)
        XCTAssertEqual(linked.ownerId, try session().ownerId); XCTAssertNotNil(linked.companionConnectionID)
        XCTAssertThrowsError(try PasswordWebConnectionAuthority.session(valid, origin: root, cookie: "tt_auth=synthetic-session", expectedOwner: "another-owner")) {
            XCTAssertEqual($0 as? PasswordProviderError, .accountMismatch)
        }
        XCTAssertThrowsError(try PasswordWebConnectionAuthority.session(try json(["ok": true, "configured": false, "ownerId": "fixture-owner"]), origin: root, cookie: "tt_auth=synthetic-session", expectedOwner: nil)) {
            XCTAssertEqual($0 as? PasswordProviderError, .notConfigured)
        }
        for data in [Data("not-json".utf8), try json(["ok": true]), try json(["ok": false, "ownerId": "fixture-owner", "configured": true])] {
            XCTAssertThrowsError(try PasswordWebConnectionAuthority.session(data, origin: root, cookie: "tt_auth=synthetic-session", expectedOwner: nil))
        }
    }
    func testNativeConnectNegotiatesBeforeSendingCookieAndVerifiesOwner() async throws {
        let transport = transport(); defer { transport.invalidateAndCancel(); RecoveryURLProtocol.reply = nil }
        var paths: [String] = []
        RecoveryURLProtocol.reply = { request in
            paths.append(request.url!.path)
            let data: Data
            if request.url!.path.hasPrefix("/.well-known") {
                XCTAssertNil(request.value(forHTTPHeaderField: "Cookie")); data = try self.manifest()
            } else {
                XCTAssertEqual(request.url, self.root.appendingPathComponent("api/v1/passwords"))
                XCTAssertEqual(request.httpMethod, "GET"); XCTAssertEqual(request.value(forHTTPHeaderField: "Cookie"), "tt_auth=synthetic-session")
                data = try self.json(["ok": true, "configured": true, "ownerId": "fixture-owner"])
            }
            return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, data)
        }
        let connected = try await PasswordClient.webSession(origin: root, cookie: "tt_auth=synthetic-session", expectedOwner: "fixture-owner", transport: transport)
        XCTAssertEqual(connected.ownerId, try session().ownerId); XCTAssertNotNil(connected.companionConnectionID); XCTAssertEqual(paths, ["/.well-known/thingtime-capabilities.json", "/api/v1/passwords"])
    }
    func testNativeConnectRejectsWrongOriginManifestAndMalformedCapabilitiesBeforeCookie() async throws {
        let transport = transport(); defer { transport.invalidateAndCancel(); RecoveryURLProtocol.reply = nil }
        for manifest in [try manifest(origin: "https://attacker.test"), try manifest(version: "2.0.0"), Data("not-json".utf8)] {
            RecoveryURLProtocol.reply = { request in
                XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
                XCTAssertEqual(request.url?.path, "/.well-known/thingtime-capabilities.json")
                return (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, manifest)
            }
            do { _ = try await PasswordClient.webSession(origin: root, cookie: "tt_auth=synthetic-session", expectedOwner: nil, transport: transport); XCTFail("Must fail closed") }
            catch { XCTAssertEqual(error as? PasswordProviderError, .capabilityUnavailable) }
        }
    }
    func testHTTPFailuresAreCategorizedWithoutServerErrorText() async throws {
        let transport = transport(); defer { transport.invalidateAndCancel(); RecoveryURLProtocol.reply = nil }
        let client = PasswordClient(account: try session(), transport: transport)
        for (status, expected) in [(401, PasswordProviderError.invalidSession), (403, .accountMismatch), (503, .unavailable)] {
            RecoveryURLProtocol.reply = { request in
                let data = request.url!.path.hasPrefix("/.well-known") ? try self.manifest() : Data("sensitive untrusted server body".utf8)
                return (HTTPURLResponse(url: request.url!, statusCode: request.url!.path.hasPrefix("/.well-known") ? 200 : status, httpVersion: nil, headerFields: nil)!, data)
            }
            do { _ = try await client.read("fixture-id"); XCTFail("Must reject failed response") }
            catch { XCTAssertEqual(error as? PasswordProviderError, expected); XCTAssertFalse(expected.recoveryMessage.contains("sensitive")) }
        }
        RecoveryURLProtocol.reply = { _ in throw URLError(.notConnectedToInternet) }
        do { _ = try await client.catalog(); XCTFail("Must report network failure") }
        catch { XCTAssertEqual(error as? PasswordProviderError, .network) }
        RecoveryURLProtocol.reply = { _ in throw URLError(.cancelled) }
        do { _ = try await client.catalog(); XCTFail("Must cancel") }
        catch { XCTAssertEqual(error as? PasswordProviderError, .cancelled); XCTAssertEqual(PasswordProviderError.cancelled.recoveryMessage, "") }
    }
    func testMalformedAndWrongOwnerRepliesAreDistinctAndLargeEntriesArePreserved() async throws {
        let transport = transport(); defer { transport.invalidateAndCancel(); RecoveryURLProtocol.reply = nil }
        let client = PasswordClient(account: try session(), transport: transport)
        for (body, expected) in [(Data("not-json".utf8), PasswordProviderError.invalidResponse), (try json(["ok": true, "ownerId": "other"]), .accountMismatch)] {
            RecoveryURLProtocol.reply = { request in
                (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, request.url!.path.hasPrefix("/.well-known") ? try self.manifest() : body)
            }
            do { _ = try await client.read("fixture-id"); XCTFail("Must reject malformed/unowned response") }
            catch { XCTAssertEqual(error as? PasswordProviderError, expected) }
        }
        let entry = PasswordEntry(title: "large fixture", passwordType: "login", fields: [PasswordField("custom", "Custom", "text", String(repeating: "x", count: 2 * 1024 * 1024 + 1))])
        let encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(entry))
        let body = try json(["ok": true, "ownerId": "fixture-owner", "id": "fixture-id", "entry": encoded])
        RecoveryURLProtocol.reply = { request in
            (HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, request.url!.path.hasPrefix("/.well-known") ? try self.manifest() : body)
        }
        let restored = try await client.read("fixture-id"); XCTAssertEqual(restored, entry)
        RecoveryURLProtocol.reply = { _ in (HTTPURLResponse(url: URL(string: "https://attacker.test/api/v1/passwords")!, statusCode: 200, httpVersion: nil, headerFields: nil)!, body) }
        do { _ = try await client.read("fixture-id"); XCTFail("Must reject redirected response") }
        catch { XCTAssertEqual(error as? PasswordProviderError, .invalidResponse) }
    }
    func testCompanionOwnershipSurvivesPersistenceAndBlocksAutomaticHostLifecycle() throws {
        let legacyJSON = try json(["origin": root.absoluteString, "ownerId": "fixture-owner", "cookie": "tt_auth=synthetic-session"])
        let legacy = try JSONDecoder().decode(ProviderSession.self, from: legacyJSON)
        XCTAssertNil(legacy.companionConnectionID)
        XCTAssertTrue(PasswordHostConnectionAuthority.canSynchronize(legacy, incoming: try session()))
        XCTAssertTrue(PasswordHostConnectionAuthority.canDisconnect(legacy))
        let body = try json(["ok": true, "configured": true, "ownerId": "fixture-owner"])
        let companion = try PasswordWebConnectionAuthority.session(body, origin: root, cookie: legacy.cookie, expectedOwner: nil)
        let restored = try JSONDecoder().decode(ProviderSession.self, from: JSONEncoder().encode(companion))
        XCTAssertEqual(restored, companion)
        XCTAssertFalse(PasswordHostConnectionAuthority.canDisconnect(restored))
        XCTAssertFalse(PasswordHostConnectionAuthority.canSynchronize(restored, incoming: try session()))
        XCTAssertFalse(PasswordHostConnectionAuthority.canSynchronize(restored, incoming: try session(owner: "local-test-owner")))
        XCTAssertFalse(PasswordHostConnectionAuthority.canSynchronize(legacy, incoming: try session(owner: "local-test-owner")))
        XCTAssertFalse(PasswordHostConnectionAuthority.canSynchronize(legacy, incoming: try session(origin: URL(string: "https://local.example.test")!)))
        let replacement = try PasswordWebConnectionAuthority.session(body, origin: root, cookie: legacy.cookie, expectedOwner: nil)
        // A late cleanup of the same cookie/account is still a different link.
        XCTAssertNotEqual(companion, replacement)
        XCTAssertThrowsError(try ProviderSession(origin: root, ownerId: legacy.ownerId, cookie: legacy.cookie, companionConnectionID: "invalid"))
    }
    @MainActor func testCancelledOrReplacedNativeIntentCannotSaveAfterAsyncVerification() async throws {
        let intent = PasswordConnectionIntent(); var saves = 0
        for replace in [false, true] {
            let captured = intent.begin()
            do {
                try await intent.commit(captured, verifyAuthority: { if replace { _ = intent.begin() } else { intent.cancel() } }, save: { saves += 1 })
                XCTFail("Stale completion cannot relink")
            } catch { XCTAssertEqual(error as? PasswordProviderError, .cancelled) }
        }
        let captured = intent.begin()
        do { try await intent.commit(captured, verifyAuthority: { throw PasswordProviderError.invalidSession }, save: { saves += 1 }); XCTFail("Changed cookie/session must fail") }
        catch { XCTAssertEqual(error as? PasswordProviderError, .invalidSession) }
        let current = intent.begin(); try await intent.commit(current, verifyAuthority: {}, save: { saves += 1 })
        XCTAssertEqual(saves, 1)
    }
    @MainActor func testReplacementDuringSuspendedAuthorityReadCannotCommitOrClearNewLink() async throws {
        let intent = PasswordConnectionIntent(), captured = intent.begin()
        let reached = expectation(description: "Authority read is in flight")
        var resume: CheckedContinuation<Void, Never>?, saves = 0
        let work = Task { @MainActor in
            try await intent.commit(captured, verifyAuthority: {
                await withCheckedContinuation { continuation in resume = continuation; reached.fulfill() }
            }, save: { saves += 1 })
        }
        await fulfillment(of: [reached], timeout: 2)
        let replacement = intent.begin()
        resume?.resume()
        do { try await work.value; XCTFail("A superseded authority read cannot save") }
        catch { XCTAssertEqual(error as? PasswordProviderError, .cancelled) }
        try await intent.commit(replacement, verifyAuthority: {}, save: { saves += 1 })
        XCTAssertEqual(saves, 1)
    }
    @MainActor func testAmbiguousSaveAndPostSaveIndexRetryReuseTheSamePasskeyAndWriteIdentity() async throws {
        let account = try session(), key = try PasskeyMaterial(relyingParty: "login.example.test", userHandle: Data([1]), username: "fixture")
        let pending = PendingPasskeyRegistration(key: key, session: account)
        var storage: [String: PasswordEntry] = [:], writes: [String] = [], indexCalls = 0
        for attempt in 0...2 {
            do {
                try await pending.persist(session: account, verify: {}, save: { entry, id, write in
                    XCTAssertEqual(entry, key.entry); XCTAssertEqual(id, pending.id)
                    storage[id] = entry; writes.append(write)
                    if attempt == 0 { throw PasswordProviderError.network } // Server committed; reply was lost.
                }, read: { try XCTUnwrap(storage[$0]) }, index: { _, _ in
                    indexCalls += 1; if attempt == 1 { throw PasswordProviderError.identityIndexUnavailable }
                })
                XCTAssertEqual(attempt, 2)
            } catch { XCTAssertNotEqual(attempt, 2) }
        }
        XCTAssertEqual(storage.count, 1); XCTAssertEqual(Set(writes), [pending.writeID]); XCTAssertEqual(indexCalls, 2)
    }
    @MainActor func testRegistrationRejectsWrongOwnerOrOriginAndStopsAfterLogout() async throws {
        let account = try session(), pending = PendingPasskeyRegistration(key: try PasskeyMaterial(relyingParty: "login.example.test", userHandle: Data([1]), username: "fixture"), session: account)
        for changed in [try session(owner: "another-owner"), try session(origin: URL(string: "https://another.example.test")!)] {
            do { try await pending.persist(session: changed, verify: {}, save: { _, _, _ in XCTFail("No cross-account write") }, read: { _ in throw PasswordProviderError.unavailable }, index: { _, _ in XCTFail("No cross-account index") }); XCTFail("Wrong scope must fail") }
            catch { XCTAssertEqual(error as? PasswordProviderError, .accountMismatch) }
        }
        var current = true
        do {
            try await pending.persist(session: account, verify: { if !current { throw PasswordProviderError.invalidSession } },
                save: { _, _, _ in current = false }, read: { _ in XCTFail("No read after logout"); return pending.key.entry }, index: { _, _ in XCTFail("No index after logout") })
            XCTFail("Logout must fence completion")
        } catch { XCTAssertEqual(error as? PasswordProviderError, .invalidSession) }
    }
}
