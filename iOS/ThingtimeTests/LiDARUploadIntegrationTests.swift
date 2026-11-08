import AppleFileSync
import CryptoKit
import WebKit
import XCTest
@testable import Thingtime

/// Run with a disposable, private-upload-approved loopback fixture. This uses
/// the same WK session and file-backed multipart transport as the scanner.
@MainActor
final class LiDARUploadIntegrationTests: XCTestCase {
    func testRealMultipartRecoversLostPublicationAndPreservesPrivateArchiveBytes() async throws {
        let env = ProcessInfo.processInfo.environment
        guard env["THINGTIME_LIDAR_UPLOAD_TEST"] == "1" else {
            throw XCTSkip("Supply an isolated, private-upload-approved loopback account fixture")
        }
        let base = try XCTUnwrap(env["THINGTIME_DEVICE_TEST_ORIGIN"])
        let owner = try XCTUnwrap(env["THINGTIME_DEVICE_TEST_USER_ID"])
        let origin = try XCTUnwrap(URL(string: base))
        let scope = try FileSyncOwnerScope(ownerId: owner, url: origin)
        guard scope.origin.absoluteString == base, origin.scheme == "http",
              ["localhost", "127.0.0.1"].contains(origin.host ?? "") else { throw URLError(.badURL) }

        let config = URLSessionConfiguration.ephemeral
        let client = URLSession(configuration: config, delegate: MobileDeviceRedirectPolicy(), delegateQueue: nil)
        defer { client.invalidateAndCancel() }
        func call(_ path: String, body: [String: Any]? = nil, status: Int = 200, authenticated: Bool = true) async throws -> Data {
            var request = URLRequest(url: try XCTUnwrap(URL(string: path, relativeTo: origin)?.absoluteURL))
            request.httpShouldHandleCookies = authenticated
            request.setValue(base, forHTTPHeaderField: "Origin")
            if let body {
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.httpBody = try JSONSerialization.data(withJSONObject: body)
            }
            let (data, response) = try await client.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == status else {
                XCTFail("Unexpected HTTP \((response as? HTTPURLResponse)?.statusCode ?? 0) at \(path.split(separator: "?")[0])")
                throw URLError(.badServerResponse)
            }
            return data
        }
        func json(_ path: String, body: [String: Any]? = nil) async throws -> [String: Any] {
            let data = try await call(path, body: body)
            return try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        }
        let manifest = try await json("/.well-known/thingtime-capabilities.json")
        XCTAssertTrue(LopuVoiceContract.accepts(manifest, baseURL: origin, feature: "api.attachment-content", minimum: [1, 18, 0]))
        let username = try XCTUnwrap(env["THINGTIME_DEVICE_TEST_USERNAME"])
        let password = try XCTUnwrap(env["THINGTIME_DEVICE_TEST_PASSWORD"])
        _ = try await call("/api/v1/login", body: ["username": username, "password": password])
        let identity = try await json("/api/v1/auth/me")
        let user = try XCTUnwrap(identity["user"] as? [String: Any])
        guard user["id"] as? String == owner, user["accountKind"] as? String == "user",
              user["temporary"] as? Bool != true, user["privateUploadsEnabled"] as? Bool == true else {
            XCTFail("The disposable account or its private upload approval changed")
            throw URLError(.userAuthenticationRequired)
        }

        let webConfig = WKWebViewConfiguration()
        webConfig.websiteDataStore = .nonPersistent()
        let web = WKWebView(frame: .zero, configuration: webConfig)
        defer { withExtendedLifetime(web) {} }
        web.loadHTMLString("<html><body>Disposable LiDAR upload fixture</body></html>", baseURL: origin)
        let store = web.configuration.websiteDataStore.httpCookieStore
        let auth = try XCTUnwrap(config.httpCookieStorage?.cookies(for: origin)?.first { $0.name == "tt_auth" })
        await store.setCookie(auth)
        let session = NativeFileSession(scope: scope, cookieStore: store, cookies: { cookies, _ in
            cookies.filter { $0.domain == auth.domain && $0.path == "/" }
        }, check: {}, invalidated: {})
        defer { session.close() }
        try await session.open()

        let fixture = try LiDARUploadFixture()
        defer { fixture.remove() }
        let id = try fixture.outbox().reserve(scope: scope)
        let capture = try fixture.capture(id: id, bytes: 8 * 1024 * 1024 + 17)
        let original = try Data(contentsOf: capture.archiveURL)
        try fixture.outbox().record(capture, scope: scope)
        let transport = LiDARLostCommitTransport(session: session)
        let fileId = id.uuidString.lowercased()
        var failure: Error?
        do {
            do {
                _ = try await fixture.outbox().upload(id: id, scope: scope, session: transport)
                XCTFail("The test should lose the accepted commit response")
            } catch let error as URLError {
                XCTAssertEqual(error.code, .networkConnectionLost)
            }
            XCTAssertNil(try fixture.outbox().entries(scope: scope).first?.receipt)
            let receipt = try await fixture.outbox().upload(id: id, scope: scope, session: transport)
            XCTAssertEqual(receipt.fileThingId, fileId)
            XCTAssertEqual(transport.parts, [1, 2])
            XCTAssertEqual(transport.commitCount, 2)
            XCTAssertEqual(try fixture.outbox().entries(scope: scope).first?.receipt, receipt)

            let published = try await json("/api/v1/files?id=\(fileId)")
            let raw = try XCTUnwrap(published["file"] as? [String: Any])
            let file = try JSONDecoder().decode(NativeCloudFile.self, from: JSONSerialization.data(withJSONObject: raw))
            XCTAssertEqual(file.id, receipt.fileThingId)
            XCTAssertEqual(file.revision, receipt.revision)
            XCTAssertNil(file.folderId)
            XCTAssertFalse(file.trashed)
            XCTAssertEqual(file.content.size, Int64(original.count))
            let stored = try await call("/api/v1/attachments/content?id=\(file.content.attachmentId)&cache=bytes")
            XCTAssertEqual(SHA256.hash(data: stored), SHA256.hash(data: original))
            XCTAssertEqual(try Data(contentsOf: capture.archiveURL), original)
            _ = try await call("/api/v1/files?id=\(fileId)", status: 401, authenticated: false)
            _ = try await call("/api/v1/attachments/content?id=\(file.content.attachmentId)&cache=bytes", status: 404, authenticated: false)
        } catch { failure = error }

        if let accepted = transport.acceptedFile {
            let content = try XCTUnwrap(accepted["content"] as? [String: Any])
            let cleanup = try await json("/api/v1/files", body: ["id": fileId, "operationId": UUID().uuidString.lowercased(),
                "expectedRevision": try XCTUnwrap(accepted["revision"]), "name": try XCTUnwrap(accepted["name"]),
                "folderId": NSNull(), "trashed": true, "attachmentId": try XCTUnwrap(content["attachmentId"]),
                "contentVersion": try XCTUnwrap(content["version"])])
            XCTAssertEqual((cleanup["file"] as? [String: Any])?["trashed"] as? Bool, true)
        }
        _ = try await call("/api/v1/auth/accounts/remove", body: ["userId": owner])
        if let failure { throw failure }
    }
}

@MainActor
private final class LiDARLostCommitTransport: LiDARUploadTransport {
    let session: NativeFileSession
    var scope: FileSyncOwnerScope { session.scope }
    var parts: [Int] = []
    var commitCount = 0
    var acceptedFile: [String: Any]?

    init(session: NativeFileSession) { self.session = session }

    func verifyOwner() async throws { try await session.verifyOwner() }
    func require(_ requirements: [(String, [Int])]) async throws { try await session.require(requirements) }
    func uploadPart(_ part: any FileUploadPartSource, uploadId: String, partNumber: Int, allowsCellular: Bool) async throws {
        try await session.uploadPart(part, uploadId: uploadId, partNumber: partNumber, allowsCellular: allowsCellular)
        parts.append(partNumber)
    }

    func json(_ path: String, body: [String: Any]?, statuses: Set<Int>) async throws -> [String: Any] {
        let result = try await session.json(path, body: body, statuses: statuses)
        if path == "/api/v1/files", body != nil {
            commitCount += 1
            if commitCount == 1 {
                acceptedFile = try XCTUnwrap(result["file"] as? [String: Any])
                throw URLError(.networkConnectionLost)
            }
        }
        return result
    }
}
