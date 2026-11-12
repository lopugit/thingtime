import XCTest
import Security
@testable import ThingtimePasswordCore

final class SaveIfAbsentTests: XCTestCase {
    private func session() throws -> ProviderSession {
        try ProviderSession(origin: URL(string: "https://fixture.invalid")!, ownerId: "synthetic", cookie: "tt_auth=synthetic")
    }
    func testCreatesWithCanonicalProtectedQueryAndCodec() throws {
        let value = try session(), group = "TESTTEAM.private.fixture"
        var calls = 0
        try PasswordSessionStore.saveIfAbsent(value, accessGroup: group) { attributes in
            calls += 1
            let query = try! PasswordSessionStore.query(accessGroup: group)
            for (key, expected) in query { XCTAssertEqual(String(describing: attributes[key]!), String(describing: expected)) }
            XCTAssertEqual(attributes[kSecAttrAccessible as String] as? String, kSecAttrAccessibleWhenUnlockedThisDeviceOnly as String)
            let decoded = try! JSONDecoder().decode(ProviderSession.self, from: attributes[kSecValueData as String] as! Data)
            XCTAssertEqual(decoded, value)
            return errSecSuccess
        }
        XCTAssertEqual(calls, 1)
    }
    func testConcurrentDuplicateRefusesWithoutReplacementOrRead() throws {
        var insertCalls = 0
        XCTAssertThrowsError(try PasswordSessionStore.saveIfAbsent(session(), accessGroup: "TESTTEAM.private.fixture") { _ in
            insertCalls += 1
            return errSecDuplicateItem
        }) { XCTAssertEqual($0 as? PasswordProviderError, .conflict) }
        XCTAssertEqual(insertCalls, 1)
    }
    func testStorageFailureDoesNotBecomeSuccessOrFallback() throws {
        for status in [errSecMissingEntitlement, errSecInteractionNotAllowed, errSecNotAvailable] {
            var calls = 0
            XCTAssertThrowsError(try PasswordSessionStore.saveIfAbsent(session(), accessGroup: "TESTTEAM.private.fixture") { _ in calls += 1; return status }) {
                XCTAssertEqual($0 as? PasswordProviderError, .unavailable)
            }
            XCTAssertEqual(calls, 1)
        }
    }
    func testInvalidGroupIsRejectedBeforeMutation() throws {
        XCTAssertThrowsError(try PasswordSessionStore.saveIfAbsent(session(), accessGroup: nil) { _ in
            XCTFail("Invalid authority must not be inserted"); return errSecSuccess
        })
    }
}
