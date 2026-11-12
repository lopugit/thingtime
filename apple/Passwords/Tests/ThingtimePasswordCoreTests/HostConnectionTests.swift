import XCTest
@testable import ThingtimePasswordCore

final class HostConnectionTests: XCTestCase {
    private func session(_ owner: String = "fixture", origin: String = "https://thingtime.example", companion: String? = nil) throws -> ProviderSession {
        try ProviderSession(origin: URL(string: origin)!, ownerId: owner, cookie: "tt_auth=synthetic", companionConnectionID: companion)
    }
    func testAutomaticLinkRequiresOSOptInAndHonorsExplicitDisconnect() throws {
        let incoming = try session()
        XCTAssertFalse(PasswordHostConnectionAuthority.canSynchronize(nil, incoming: incoming, providerEnabled: false, optedOut: false))
        XCTAssertTrue(PasswordHostConnectionAuthority.canSynchronize(nil, incoming: incoming, providerEnabled: true, optedOut: false))
        XCTAssertFalse(PasswordHostConnectionAuthority.canSynchronize(nil, incoming: incoming, providerEnabled: true, optedOut: true))
        XCTAssertTrue(PasswordHostConnectionAuthority.canSynchronize(incoming, incoming: incoming, providerEnabled: false, optedOut: false))
        XCTAssertFalse(PasswordHostConnectionAuthority.canSynchronize(incoming, incoming: incoming, providerEnabled: true, optedOut: true))
    }
    func testAutomaticLifecycleCannotReplaceForeignOrCompanionConnection() throws {
        let incoming = try session()
        let companion = try session(companion: UUID().uuidString)
        for prior in [try session("other"), try session(origin: "https://other.example"), companion] {
            XCTAssertFalse(PasswordHostConnectionAuthority.canSynchronize(prior, incoming: incoming, providerEnabled: true, optedOut: false))
        }
        XCTAssertFalse(PasswordHostConnectionAuthority.canDisconnect(companion, expectedOrigin: incoming.origin))
        XCTAssertTrue(PasswordHostConnectionAuthority.canDisconnect(incoming, expectedOrigin: incoming.origin))
        XCTAssertTrue(PasswordHostConnectionAuthority.canDisconnect(nil, expectedOrigin: incoming.origin))
        XCTAssertFalse(PasswordHostConnectionAuthority.canDisconnect(incoming, expectedOrigin: URL(string: "http://127.0.0.1:28630")!))
        XCTAssertEqual(try JSONDecoder().decode(ProviderSession.self, from: JSONEncoder().encode(companion)), companion)
        let legacy = Data("{\"origin\":\"https://thingtime.example\",\"ownerId\":\"fixture\",\"cookie\":\"tt_auth=synthetic\"}".utf8)
        XCTAssertNil(try JSONDecoder().decode(ProviderSession.self, from: legacy).companionConnectionID)
        XCTAssertThrowsError(try session(companion: "malformed"))
    }
}
