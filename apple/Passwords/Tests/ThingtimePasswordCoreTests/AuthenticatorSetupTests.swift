import XCTest
import Security
@testable import ThingtimePasswordCore

final class AuthenticatorSetupTests: XCTestCase {
    // RFC 6238's published synthetic test seed; never a real account credential.
    private var valid: String { "otpauth://totp/Example:test?secret=" + ["GEZD", "GNBV", "GY3T", "QOJQ", "GEZD", "GNBV", "GY3T", "QOJQ"].joined() }
    private let start = Date(timeIntervalSince1970: 1000)
    private func binding(_ owner: String = "synthetic-owner", generation: UUID = UUID()) -> AuthenticatorSetupInbox.Binding {
        .init(owner: owner, nonce: UUID().uuidString, generation: generation)
    }
    func testStrictSetupValidation() throws {
        XCTAssertNoThrow(try AuthenticatorSetup(valid))
        for value in [valid.replacingOccurrences(of: "totp", with: "hotp"), valid.replacingOccurrences(of: "otpauth:", with: "otpauth-migration:"), valid + "&secret=AAAA", valid + "&digits=7", valid + "&period=0", valid + "&algorithm=MD5", valid + "&origin=https://other.invalid", valid + "#fragment", valid.replacingOccurrences(of: "totp/", with: "user@totp/"), valid.replacingOccurrences(of: "GEZD", with: "18!@"), valid.replacingOccurrences(of: "Example:test", with: "")] {
            XCTAssertThrowsError(try AuthenticatorSetup(value))
        }
        XCTAssertNoThrow(try AuthenticatorSetup(valid + "&algorithm=SHA256&digits=8&period=60"))
    }
    func testBase32PaddingAndResidualBitsAreStrict() throws {
        let prefix = "otpauth://totp/Test?secret="
        XCTAssertNoThrow(try AuthenticatorSetup(prefix + String(repeating: "A", count: 18)))
        XCTAssertNoThrow(try AuthenticatorSetup(prefix + String(repeating: "A", count: 18) + "======"))
        for secret in [String(repeating: "A", count: 18) + "=", String(repeating: "A", count: 32) + "=", String(repeating: "A", count: 17), String(repeating: "A", count: 17) + "B", String(repeating: "A", count: 16) + " A", String(repeating: "A", count: 16) + "=A"] {
            XCTAssertThrowsError(try AuthenticatorSetup(prefix + secret))
        }
    }
    func testCapabilityAndDelayedDeliveryFences() {
        for version in ["1.2.0", "1.2.1", "1.10.0"] { XCTAssertTrue(AuthenticatorSetupCapability.accepts(version)) }
        for version in ["1.1.99", "2.0.0", "01.2.0", "1.02.0", "1.2.00", "1.2.0-preview", "prefix1.2.0"] { XCTAssertFalse(AuthenticatorSetupCapability.accepts(version)) }
        let generation = UUID(), document = UUID().uuidString
        XCTAssertTrue(AuthenticatorSetupDeliveryGate.permits(capturedGeneration: generation, currentGeneration: generation, capturedDocument: document, currentDocument: document))
        XCTAssertFalse(AuthenticatorSetupDeliveryGate.permits(capturedGeneration: generation, currentGeneration: UUID(), capturedDocument: document, currentDocument: document))
        XCTAssertFalse(AuthenticatorSetupDeliveryGate.permits(capturedGeneration: generation, currentGeneration: generation, capturedDocument: document, currentDocument: UUID().uuidString))
    }
    func testExistingMetadataResponseShapeAndManifestBindOriginAndOwner() throws {
        let root = URL(string: "https://thingtime.example")!
        func json(_ value: [String: Any]) throws -> Data { try JSONSerialization.data(withJSONObject: value) }
        XCTAssertTrue(AuthenticatorSetupAuthority.manifest(try json(["schemaVersion": 1, "origin": root.absoluteString, "features": ["api.passwords": ["version": "1.2.1"]]]), origin: root))
        XCTAssertFalse(AuthenticatorSetupAuthority.manifest(try json(["schemaVersion": 1, "origin": "https://other.example", "features": ["api.passwords": ["version": "1.2.1"]]]), origin: root))
        // Actual GET shape includes configured + ownerId and a paginated metadata
        // list. Additional/large metadata does not invalidate owner verification.
        let largeTitle = String(repeating: "synthetic metadata ", count: 150000)
        XCTAssertTrue(AuthenticatorSetupAuthority.owner(try json(["ok": true, "configured": true, "ownerId": "owner", "entries": [["title": largeTitle]], "nextCursor": "next"]), expected: "owner"))
        for payload: [String: Any] in [["ok": true, "ownerId": "owner"], ["ok": true, "configured": false, "ownerId": "owner"], ["ok": true, "configured": true, "ownerId": "other"], ["ok": false, "configured": true, "ownerId": "owner"]] {
            XCTAssertFalse(AuthenticatorSetupAuthority.owner(try json(payload), expected: "owner"))
        }
    }
    func testMissingDestinationDiffersFromLockedOrInvalidMetadata() throws {
        let group = "TESTTEAM.com.thingtime.passwords"
        XCTAssertNil(try PasswordSessionStore.destination(accessGroup: group, read: { _ in (errSecItemNotFound, nil) }))
        for status in [errSecInteractionNotAllowed, errSecAuthFailed, errSecMissingEntitlement] {
            XCTAssertThrowsError(try PasswordSessionStore.destination(accessGroup: group, read: { _ in (status, nil) }))
        }
        XCTAssertThrowsError(try PasswordSessionStore.destination(accessGroup: group, read: { _ in (errSecSuccess, Data("invalid".utf8)) }))
        let session = try ProviderSession(origin: URL(string: "https://thingtime.example")!, ownerId: "synthetic-owner", cookie: "tt_auth=synthetic-not-a-session")
        let data = try JSONEncoder().encode(session)
        let destination = try PasswordSessionStore.destination(accessGroup: group, read: { _ in (errSecSuccess, data) })
        XCTAssertEqual(destination?.origin, session.origin); XCTAssertEqual(destination?.ownerId, session.ownerId)
    }
    func testColdStartSurvivesLoginThenConsumesOnce() throws {
        var inbox = AuthenticatorSetupInbox()
        XCTAssertTrue(try inbox.offer(valid, now: start))
        inbox.navigationStarted() // Login redirects before a verified owner binds.
        let scope = binding()
        let id = try XCTUnwrap(inbox.bind(scope, expectedOwner: scope.owner, dataPlane: "home", now: start))
        XCTAssertEqual(inbox.consume(id, binding: scope, now: start)?.uri, valid)
        XCTAssertNil(inbox.consume(id, binding: scope, now: start))
    }
    func testWarmDeliveryDoesNotReplacePendingAndSupportsNextAfterConsumption() throws {
        var inbox = AuthenticatorSetupInbox()
        XCTAssertTrue(try inbox.offer(valid, now: start)); let original = inbox.requestID
        XCTAssertFalse(try inbox.offer(valid + "&issuer=Different", now: start))
        XCTAssertEqual(inbox.requestID, original)
        let scope = binding(); let id = try XCTUnwrap(inbox.bind(scope, expectedOwner: nil, dataPlane: "home", now: start))
        XCTAssertNotNil(inbox.consume(id, binding: scope, now: start))
        XCTAssertTrue(try inbox.offer(valid, now: start)); XCTAssertNotEqual(inbox.requestID, original)
    }
    func testOwnerDataPlaneNonceAndNavigationChangesFenceDelivery() throws {
        var inbox = AuthenticatorSetupInbox(); _ = try inbox.offer(valid, now: start)
        let scope = binding()
        XCTAssertNil(inbox.bind(scope, expectedOwner: "other", dataPlane: "home", now: start))
        XCTAssertNil(inbox.bind(scope, expectedOwner: nil, dataPlane: "custom-unknown", now: start))
        let id = try XCTUnwrap(inbox.bind(scope, expectedOwner: nil, dataPlane: "home", now: start))
        XCTAssertNil(inbox.consume(id, binding: binding(), now: start))
        inbox.navigationStarted(); XCTAssertNil(inbox.consume(id, binding: scope, now: start))
        _ = try inbox.offer(valid, now: start); _ = inbox.bind(scope, expectedOwner: nil, dataPlane: "home", now: start)
        XCTAssertNil(inbox.bind(binding("other"), expectedOwner: nil, dataPlane: "home", now: start))
        XCTAssertNil(inbox.requestID)
    }
    func testCancellationExpiryAndInvalidNonce() throws {
        var inbox = AuthenticatorSetupInbox(); _ = try inbox.offer(valid, now: start)
        XCTAssertNil(inbox.bind(.init(owner: "synthetic", nonce: "not-a-document-nonce", generation: UUID()), expectedOwner: nil, dataPlane: "home", now: start))
        let scope = binding(), id = try XCTUnwrap(inbox.bind(binding(), expectedOwner: nil, dataPlane: "home", now: start))
        inbox.cancel(); XCTAssertNil(inbox.consume(id, binding: scope, now: start)); XCTAssertNil(inbox.requestID)
        _ = try inbox.offer(valid, now: start)
        XCTAssertNil(inbox.bind(scope, expectedOwner: nil, dataPlane: "home", now: start.addingTimeInterval(601)))
        XCTAssertNil(inbox.requestID)
    }
    func testPageGateRejectsIframeWrongOriginPortPathQueryAndOpaqueSecurityOrigin() {
        let root = URL(string: "https://thingtime.example")!, page = root.appendingPathComponent("passwords")
        func permits(_ target: URL?, _ frame: URL?, _ main: Bool = true, _ host: String = "thingtime.example", _ port: Int = 0) -> Bool {
            AuthenticatorSetupPage.permits(root: root, page: target, frame: frame, isMainFrame: main, securityScheme: "https", securityHost: host, securityPort: port)
        }
        XCTAssertTrue(permits(page, page))
        XCTAssertFalse(permits(page, page, false)); XCTAssertFalse(permits(page, page, true, "")); XCTAssertFalse(permits(page, page, true, "thingtime.example", 444))
        for url in ["https://other.example/passwords", "https://thingtime.example:444/passwords", "https://thingtime.example/login", "https://thingtime.example/passwords?redirect=1", "https://thingtime.example/passwords#x", "http://thingtime.example/passwords"] {
            let wrong = URL(string: url)!
            XCTAssertFalse(permits(wrong, page)); XCTAssertFalse(permits(page, wrong))
        }
    }
}
