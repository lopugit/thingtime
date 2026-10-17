import XCTest
import WebKit
import AppleFileSync
@testable import Thingtime

private final class FileSessionProtocol: URLProtocol, @unchecked Sendable {
    static let lock = NSLock()
    private static var handler: ((URLRequest) throws -> (Int, [String: String], Data))?
    static func set(_ value: @escaping (URLRequest) throws -> (Int, [String: String], Data)) { lock.lock(); handler = value; lock.unlock() }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock(); let respond = Self.handler; Self.lock.unlock()
        do {
            let (status, headers, data) = try XCTUnwrap(respond)(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

@MainActor
final class NativeFileSessionTests: XCTestCase {
    func testNativeTransportPinsIdentityBoundsBytesAndCancelsOnSessionChange() async throws {
        let origin = URL(string: "https://native-sync.test")!, owner = try FileSyncOwnerScope(ownerId: "test-owner", url: origin)
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [FileSessionProtocol.self]
        let dataStore = WKWebsiteDataStore.nonPersistent()
        let store = dataStore.httpCookieStore
        let webConfiguration = WKWebViewConfiguration(); webConfiguration.websiteDataStore = dataStore
        let web = WKWebView(frame: .zero, configuration: webConfiguration)
        web.loadHTMLString("<html><body>Native transport test</body></html>", baseURL: origin)
        for _ in 0..<100 {
            if (try? await web.evaluateJavaScript("document.readyState")) as? String == "complete" { break }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        defer { withExtendedLifetime(web) {} }
        func cookie(_ name: String, _ value: String) -> HTTPCookie {
            HTTPCookie(properties: [.name: name, .value: value, .domain: "native-sync.test", .path: "/", .secure: "TRUE"])!
        }
        await store.setCookie(cookie("tt_auth", "fixture"))
        let pinned = await store.allCookies()
        XCTAssertEqual(try NativeFileSession.authenticationCookie(pinned), "tt_auth=fixture")
        let invalidated = expectation(description: "identity change cancels native transport")
        let transport = NativeFileSession(scope: owner, cookieStore: store, cookies: { values, _ in values }, check: {},
            invalidated: { invalidated.fulfill() }, configuration: configuration)
        defer { transport.close() }
        FileSessionProtocol.set { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Cookie"), "tt_auth=fixture")
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Thingtime-Expected-Actor"), owner.ownerId)
            XCTAssertEqual(request.value(forHTTPHeaderField: "X-Thingtime-Expected-Data-Plane"), "home")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Accept-Encoding"), "identity")
            if request.url!.path == "/api/v1/auth/me" {
                return (200, [:], try JSONSerialization.data(withJSONObject: ["user": ["id": owner.ownerId, "accountKind": "user"]]))
            }
            return (206, [:], Data([0, 255, 127, 42]))
        }
        try await transport.open()
        await store.setCookie(cookie("theme", "dark"))
        let bytes = try await transport.read("/bytes", limit: 4) { XCTAssertEqual($0.statusCode, 206) }
        XCTAssertEqual(bytes, Data([0, 255, 127, 42]))
        do { _ = try await transport.read("/bytes", limit: 3) { _ in }; XCTFail("Accepted an oversized response") } catch {}
        do { _ = try await transport.read("https://other.test/bytes", limit: 4) { _ in }; XCTFail("Accepted another origin") } catch {}
        await store.setCookie(cookie("tt_auth", "another-session"))
        let changed = await store.allCookies()
        XCTAssertEqual(try NativeFileSession.authenticationCookie(changed), "tt_auth=another-session")
        await fulfillment(of: [invalidated], timeout: 5)
        do { _ = try await transport.read("/bytes", limit: 4) { _ in }; XCTFail("Read after session invalidation") } catch {}
    }
    func testNativeCloudDescriptorRequiresExactReviewedSource() throws {
        let fingerprint = MobileFolderReader.Fingerprint(partSizeBytes: 8 * 1024 * 1024, partCount: 1, sha256: String(repeating: "a", count: 64))
        let source = MobileFolderReader.Entry(path: "nested/file.bin", id: "file", version: "revision", kind: "file", size: 17, sha256: nil, fingerprint: fingerprint)
        let content: [String: Any] = ["attachmentId": "attachment", "version": String(repeating: "b", count: 64), "size": 17,
            "fingerprint": try JSONSerialization.jsonObject(with: JSONEncoder().encode(fingerprint))]
        let initial: [String: Any] = ["id": "file", "revision": "revision", "name": "file.bin", "folderId": NSNull(), "trashed": false, "content": content]
        func decode(_ value: [String: Any]) throws -> NativeCloudFile { try JSONDecoder().decode(NativeCloudFile.self, from: JSONSerialization.data(withJSONObject: value)) }
        try decode(initial).validate(source: source)
        for (key, value) in [("id", "other" as Any), ("revision", "changed"), ("trashed", true), ("id", "file&other=1"), ("name", "../file")] {
            var changed = initial; changed[key] = value
            XCTAssertThrowsError(try decode(changed).validate(source: source))
        }
        var wrongContent = content; wrongContent["size"] = 18
        var changed = initial; changed["content"] = wrongContent
        XCTAssertThrowsError(try decode(changed).validate(source: source))
    }
}
