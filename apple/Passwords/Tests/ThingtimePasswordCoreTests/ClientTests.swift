import XCTest
import Foundation
@testable import ThingtimePasswordCore

private final class PasswordTestProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, data) = try Self.handler!(request)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

final class ClientTests: XCTestCase {
    private let origin = URL(string: "https://passwords.example.test")!
    private func client() throws -> PasswordClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [PasswordTestProtocol.self]
        return PasswordClient(account: try ProviderSession(origin: origin, ownerId: "fixture-owner", cookie: "tt_auth=synthetic-fixture"), configuration: configuration)
    }
    override func tearDown() { PasswordTestProtocol.handler = nil; super.tearDown() }
    private var manifest: Data { Data("{\"schemaVersion\":1,\"origin\":\"https://passwords.example.test\",\"features\":{\"api.passwords\":{\"version\":\"1.4.0\"}}}".utf8) }

    func testTransportPreservesSafeFailureCategoryWithoutResponseText() async throws {
        for (status, expected) in [(401, PasswordProviderError.invalidSession), (403, .permissionDenied), (404, .incompatibleService), (409, .conflict), (429, .rateLimited), (503, .serviceUnavailable), (400, .invalidResponse)] {
            PasswordTestProtocol.handler = { request in
                if request.url!.path.hasPrefix("/.well-known/") { return (200, self.manifest) }
                XCTAssertEqual(request.value(forHTTPHeaderField: "Origin"), self.origin.absoluteString)
                XCTAssertEqual(request.value(forHTTPHeaderField: "Cookie"), "tt_auth=synthetic-fixture")
                return (status, Data("{\"ok\":false,\"error\":\"arbitrary server content must never be displayed\"}".utf8))
            }
            do { _ = try await client().read("fixture-record"); XCTFail("Expected safe failure for status \(status)") }
            catch { XCTAssertEqual(error as? PasswordProviderError, expected) }
        }
    }
    func testMalformedSuccessfulReplyAndNetworkFailureRemainDistinct() async throws {
        PasswordTestProtocol.handler = { request in
            (200, request.url!.path.hasPrefix("/.well-known/") ? self.manifest : Data("<html>not JSON</html>".utf8))
        }
        do { _ = try await client().read("fixture-record"); XCTFail("Expected invalid response") }
        catch { XCTAssertEqual(error as? PasswordProviderError, .invalidResponse) }
        PasswordTestProtocol.handler = { _ in throw URLError(.timedOut) }
        do { _ = try await client().read("fixture-record"); XCTFail("Expected network failure") }
        catch { XCTAssertEqual(error as? PasswordProviderError, .networkUnavailable) }
    }
    func testCapabilityOriginMismatchDoesNotContinueToPasswordRoute() async throws {
        var paths: [String] = []
        PasswordTestProtocol.handler = { request in
            paths.append(request.url!.path)
            return (200, Data("{\"schemaVersion\":1,\"origin\":\"https://other.example.test\",\"features\":{\"api.passwords\":{\"version\":\"1.4.0\"}}}".utf8))
        }
        do { _ = try await client().read("fixture-record"); XCTFail("Expected incompatible service") }
        catch { XCTAssertEqual(error as? PasswordProviderError, .incompatibleService) }
        XCTAssertEqual(paths, ["/.well-known/thingtime-capabilities.json"])
    }
    func testCatalogPaginatesBeyondTenThousandWithoutTruncation() async throws {
        var page = 0
        PasswordTestProtocol.handler = { request in
            if request.url!.path.hasPrefix("/.well-known/") { return (200, self.manifest) }
            defer { page += 1 }
            let count = page < 2 ? 5_000 : 1
            let entries: [[String: Any]] = (0..<count).map { offset in
                ["id": "fixture-\(page * 5_000 + offset)", "title": "Fixture", "username": "fixture", "domains": ["example.test"], "hasPassword": true, "hasTotp": false]
            }
            var body: [String: Any] = ["ok": true, "ownerId": "fixture-owner", "catalog": entries]
            if page < 2 { body["nextCursor"] = "page-\(page + 1)" }
            return (200, try JSONSerialization.data(withJSONObject: body))
        }
        let catalog = try await client().catalog()
        XCTAssertEqual(page, 3)
        XCTAssertEqual(catalog.count, 10_001)
        XCTAssertEqual(catalog.last?.id, "fixture-10000")
    }
    func testCatalogRejectsConsecutiveAndNonconsecutiveCursorCycles() async throws {
        for cursors in [["a", "a"], ["a", "b", "a"]] {
            var page = 0
            PasswordTestProtocol.handler = { request in
                if request.url!.path.hasPrefix("/.well-known/") { return (200, self.manifest) }
                guard page < cursors.count else { throw URLError(.badServerResponse) }
                defer { page += 1 }
                return (200, try JSONSerialization.data(withJSONObject: ["ok": true, "ownerId": "fixture-owner", "catalog": [], "nextCursor": cursors[page]]))
            }
            do { _ = try await client().catalog(); XCTFail("Expected cursor cycle refusal") }
            catch { XCTAssertEqual(error as? PasswordProviderError, .invalidResponse) }
            XCTAssertEqual(page, cursors.count)
        }
    }
}
