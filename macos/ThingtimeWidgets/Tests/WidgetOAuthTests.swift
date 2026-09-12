import XCTest
@testable import Thingtime_Widgets

final class WidgetOAuthTests: XCTestCase {
    func testRFC7636ChallengeVector() {
        XCTAssertEqual(WidgetOAuthRequest.challenge(for: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
                       "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }
    func testOriginValidation() throws {
        for value in ["https://thingtime.com/path", "https://name:password@thingtime.com", "http://thingtime.com",
                      "https://thingtime.com?token=abc", "https://thingtime.com#fragment", "file:///tmp/page"] {
            XCTAssertThrowsError(try WidgetOAuthRequest.normalizeOrigin(value), value)
        }
        XCTAssertEqual(try WidgetOAuthRequest.normalizeOrigin("https://THINGTIME.com:443/").absoluteString, "https://thingtime.com")
        XCTAssertEqual(try WidgetOAuthRequest.normalizeOrigin("http://127.0.0.1:9999").absoluteString, "http://127.0.0.1:9999")
    }
    func testUniqueStateAndVerifierAreNotExposedInAuthorizationURL() throws {
        let a = try transaction(), b = try transaction()
        XCTAssertNotEqual(a.state, b.state)
        XCTAssertNotEqual(a.verifier, b.verifier)
        XCTAssertEqual(a.verifier.count, 43)
        XCTAssertFalse(a.authorizationURL.absoluteString.contains(a.verifier))
        XCTAssertEqual(a.authorizationURL.host, "thingtime.com")
    }
    func testWrongStateAndDestinationCannotConsumeTransaction() throws {
        var request = try transaction()
        for value in ["com.thingtime.widgets://oauth/other?state=\(request.state)&code=code",
                      "com.thingtime.widgets://other/callback?state=\(request.state)&code=code",
                      "https://oauth/callback?state=\(request.state)&code=code",
                      "com.thingtime.widgets://oauth/callback?state=wrong&code=code",
                      "com.thingtime.widgets://oauth/callback?state=\(request.state)&state=\(request.state)&code=code"] {
            XCTAssertThrowsError(try request.consume(URL(string: value)!))
            XCTAssertFalse(request.consumed)
        }
        let body = try request.consume(callback(request))
        XCTAssertEqual(body["code"], "one-time-code")
        XCTAssertEqual(body["codeVerifier"], request.verifier)
        XCTAssertEqual(body["clientId"], "test-client")
        XCTAssertThrowsError(try request.consume(callback(request)))
    }
    func testExpiredAndDeniedTransactionsCannotBeReplayed() throws {
        var expired = try transaction()
        XCTAssertThrowsError(try expired.consume(callback(expired), now: expired.startedAt.addingTimeInterval(300)))
        XCTAssertTrue(expired.consumed)
        var denied = try transaction()
        let url = URL(string: "\(WidgetOAuthRequest.callback)?state=\(denied.state)&error=access_denied")!
        XCTAssertThrowsError(try denied.consume(url))
        XCTAssertTrue(denied.consumed)
        XCTAssertThrowsError(try denied.consume(callback(denied)))
    }
    @MainActor
    func testCapabilityVersionsRejectMissingBreakingAndMalformedContracts() {
        for version in ["1.10.0", "1.10.1", "1.11.0"] {
            XCTAssertTrue(WidgetConnection.compatible(version, minimum: [1, 10, 0]))
        }
        for version in ["1.9.9", "2.10.0", "", "1.x.10.0", "1..10.0", "1.-10.0", "1.10.0-beta"] {
            XCTAssertFalse(WidgetConnection.compatible(version, minimum: [1, 10, 0]), version)
        }
    }
    private func transaction() throws -> WidgetOAuthRequest {
        try WidgetOAuthRequest(origin: URL(string: "https://thingtime.com")!, clientID: "test-client")
    }
    private func callback(_ request: WidgetOAuthRequest) -> URL {
        URL(string: "\(WidgetOAuthRequest.callback)?state=\(request.state)&code=one-time-code")!
    }
}
