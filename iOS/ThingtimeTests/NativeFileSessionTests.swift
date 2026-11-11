import XCTest
import WebKit
import AppleFileSync
import CryptoKit
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
    private struct Part: FileUploadPartSource {
        let url: URL
        let length: Int64
        let sha256: String
        let checksumSha256: String
    }
    func testDelayedRetainedPartRefusesChangedSessionWithoutProgressOrUsage() async throws {
        let origin = URL(string: "https://native-sync.test")!
        let owner = try FileSyncOwnerScope(ownerId: "test-owner", url: origin)
        let bytes = Data([1, 2, 3, 4]), digest = Data(SHA256.hash(data: Data([1, 2, 3, 4])))
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try bytes.write(to: file); defer { try? FileManager.default.removeItem(at: file) }
        let part = Part(url: file, length: Int64(bytes.count), sha256: digest.map { String(format: "%02x", $0) }.joined(), checksumSha256: digest.base64EncodedString())
        for changeOwner in [false, true] {
            let dataStore = WKWebsiteDataStore.nonPersistent(), config = URLSessionConfiguration.ephemeral
            config.protocolClasses = [FileSessionProtocol.self]
            let webConfig = WKWebViewConfiguration(); webConfig.websiteDataStore = dataStore
            let web = WKWebView(frame: .zero, configuration: webConfig)
            web.loadHTMLString("<body>Retained-part identity fixture</body>", baseURL: origin)
            let store = dataStore.httpCookieStore
            func cookie(_ value: String) -> HTTPCookie { HTTPCookie(properties: [.name: "tt_auth", .value: value, .domain: "native-sync.test", .path: "/", .secure: "TRUE"])! }
            await store.setCookie(cookie("fixture"))
            let requested = expectation(description: "provider reconciliation waits"), release = DispatchSemaphore(value: 0)
            FileSessionProtocol.set { request in
                let response: [String: Any]
                if request.url?.path == "/api/v1/auth/me" {
                    response = ["user": ["id": owner.ownerId, "accountKind": "user"]]
                } else if request.url?.path == LopuVoiceContract.manifestPath {
                    response = ["schemaVersion": 1, "origin": origin.absoluteString, "features": ["api.attachment-upload-parts": ["version": "1.3.0"]]]
                } else {
                    XCTAssertEqual(request.url?.path, "/api/v1/attachments/uploads/parts")
                    XCTAssertEqual(request.httpMethod, "POST")
                    requested.fulfill()
                    guard release.wait(timeout: .now() + 5) == .success else { throw URLError(.timedOut) }
                    response = ["ok": true, "parts": [["partNumber": 1, "url": "https://storage.test/part", "headers": ["x-amz-checksum-sha256": part.checksumSha256], "alreadyUploaded": true]]]
                }
                return (200, ["Content-Type": "application/json"], try JSONSerialization.data(withJSONObject: response))
            }
            let transport = NativeFileSession(scope: owner, cookieStore: store, cookies: { values, _ in values }, check: {}, invalidated: {}, configuration: config)
            try await transport.open()
            var progress = 0, usage: Int64 = 0
            let upload = Task { () throws -> Int64 in
                let sent = try await transport.uploadPart(part, uploadId: "upload", partNumber: 1, allowsCellular: false, photoAuthorization: nil, conditions: nil)
                progress += 1; usage += sent; return sent
            }
            await fulfillment(of: [requested], timeout: 5)
            if changeOwner { await store.setCookie(cookie("changed-session")) }
            release.signal()
            do {
                let sent = try await upload.value
                XCTAssertFalse(changeOwner, "a stale owner must never receive retained-part completion")
                XCTAssertEqual(sent, 0)
            } catch { XCTAssertTrue(changeOwner, "unchanged owner should reuse the verified remote part: \(error)") }
            XCTAssertEqual(progress, changeOwner ? 0 : 1)
            XCTAssertEqual(usage, 0, "proof reuse never creates new transfer usage")
            transport.close(); withExtendedLifetime(web) {}
        }
    }
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
            if request.url!.path == "/post" {
                XCTAssertEqual(request.httpMethod, "POST")
                XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
                return (200, [:], Data("{\"ok\":true}".utf8))
            }
            return (206, [:], Data([0, 255, 127, 42]))
        }
        try await transport.open()
        let posted = try await transport.json("/post", body: ["fixture": true])
        XCTAssertEqual(posted["ok"] as? Bool, true)
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
