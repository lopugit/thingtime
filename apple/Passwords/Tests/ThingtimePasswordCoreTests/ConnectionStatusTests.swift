import XCTest
@testable import ThingtimePasswordCore

final class ConnectionStatusTests: XCTestCase {
    func testReadOnlyConnectionStatusSurvivesCookieRotationAndSeparatesAccountAndOrigin() throws {
        let session = try ProviderSession(origin: URL(string: "https://thingtime.example")!, ownerId: "fixture", cookie: "tt_auth=synthetic")
        XCTAssertEqual(PasswordConnectionStatus.resolve(for: session, load: { nil }), .disconnected)
        XCTAssertEqual(PasswordConnectionStatus.resolve(for: session, load: { session }), .connected)
        var renewed = session; renewed.cookie = "tt_auth=rotated"
        XCTAssertEqual(PasswordConnectionStatus.resolve(for: renewed, load: { session }), .connected)
        var switched = session; switched.ownerId = "other-fixture"
        XCTAssertEqual(PasswordConnectionStatus.resolve(for: switched, load: { session }), .differentSession)
        switched = session; switched.origin = URL(string: "https://other.example")!
        XCTAssertEqual(PasswordConnectionStatus.resolve(for: switched, load: { session }), .differentSession)
        XCTAssertEqual(PasswordConnectionStatus.resolve(for: session, load: { throw PasswordProviderError.sessionUnavailable }), .unavailable)
        XCTAssertEqual(String(data: try JSONEncoder().encode(PasswordConnectionStatus.connected), encoding: .utf8), "\"connected\"")
    }
}
