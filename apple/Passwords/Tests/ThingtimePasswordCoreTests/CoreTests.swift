import XCTest
import CryptoKit
import Security
@testable import ThingtimePasswordCore
final class CoreTests: XCTestCase {
    func testMissingSessionAndInaccessibleProtectedStoreAreDistinct() throws {
        XCTAssertNoThrow(try PasswordSessionStore.validateLoadStatus(errSecSuccess))
        XCTAssertThrowsError(try PasswordSessionStore.validateLoadStatus(errSecItemNotFound)) { XCTAssertEqual($0 as? PasswordProviderError, .invalidSession) }
        for status in [errSecMissingEntitlement, errSecInteractionNotAllowed, errSecAuthFailed, errSecNotAvailable] {
            XCTAssertThrowsError(try PasswordSessionStore.validateLoadStatus(status)) { XCTAssertEqual($0 as? PasswordProviderError, .sessionUnavailable) }
        }
    }
    func testSessionKeychainRequiresProtectedSharedStorage() throws {
        // Missing or unexpanded signing configuration must never fall back to
        // a private/default Keychain that the provider cannot safely share.
        for group in [nil, "", " ", "TEAM.com.thingtime.passwords ", "$(AppIdentifierPrefix)com.thingtime.passwords"] as [String?] {
            XCTAssertThrowsError(try PasswordSessionStore.query(accessGroup: group))
        }
        let query = try PasswordSessionStore.query(accessGroup: "TESTTEAM.com.thingtime.passwords")
        XCTAssertEqual(query[kSecUseDataProtectionKeychain as String] as? Bool, true)
        XCTAssertEqual(query[kSecAttrSynchronizable as String] as? Bool, false)
        XCTAssertEqual(query[kSecAttrAccessGroup as String] as? String, "TESTTEAM.com.thingtime.passwords")
    }
    func testSessionDeletionAcceptsOnlySuccessOrAlreadyMissingAndCanRetry() throws {
        let group = "TESTTEAM.com.thingtime.passwords"
        let expected = try PasswordSessionStore.query(accessGroup: group)
        var calls = 0
        for status in [errSecSuccess, errSecItemNotFound] {
            try PasswordSessionStore.clear(accessGroup: group) { query in
                calls += 1
                XCTAssertEqual(query as NSDictionary, expected as NSDictionary)
                return status
            }
        }
        for status in [errSecInteractionNotAllowed, errSecAuthFailed, errSecMissingEntitlement, errSecNotAvailable] {
            XCTAssertThrowsError(try PasswordSessionStore.clear(accessGroup: group) { query in
                calls += 1
                XCTAssertEqual(query as NSDictionary, expected as NSDictionary)
                return status
            }) { error in
                guard case PasswordProviderError.unavailable = error else { return XCTFail("Deletion must return the safe provider error") }
            }
        }
        // A failed attempt must not mark clearing complete or prevent retry.
        try PasswordSessionStore.clear(accessGroup: group) { _ in calls += 1; return errSecSuccess }
        XCTAssertEqual(calls, 7)
        XCTAssertThrowsError(try PasswordSessionStore.clear(accessGroup: nil) { _ in
            XCTFail("An invalid signing scope must never reach Keychain deletion")
            return errSecSuccess
        })
    }
    @MainActor func testLogoutClearsAfterPendingIdentitySync() async throws {
        let operations = PasswordIdentityOperations()
        var calls: [String] = []
        var release: CheckedContinuation<Void, Never>?
        let sync = operations.submit {
            calls.append("sync-start")
            await withCheckedContinuation { release = $0 }
            calls.append("sync-finish")
        }
        while release == nil { await Task.yield() }
        let clear = operations.submit { calls.append("clear") }
        await Task.yield()
        XCTAssertEqual(calls, ["sync-start"])
        release?.resume()
        try await sync.value; try await clear.value
        XCTAssertEqual(calls, ["sync-start", "sync-finish", "clear"])
        let failure = operations.submit { throw PasswordProviderError.unavailable }
        let next = operations.submit { calls.append("after-failure") }
        _ = try? await failure.value; try await next.value
        XCTAssertEqual(calls.last, "after-failure")
    }
    func testTOTPVectorsAndHandoffRejection() throws {
        for (time, code) in [(59.0,"94287082"),(1111111109,"07081804"),(1111111111,"14050471"),(1234567890,"89005924"),(2000000000,"69279037"),(20000000000,"65353130")] {
            XCTAssertEqual(try TOTP.code("otpauth://totp/Test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=8", at: Date(timeIntervalSince1970: time)), code)
        }
        XCTAssertThrowsError(try TOTP.code("FIDO:/fixture"))
        XCTAssertThrowsError(try TOTP.code("otpauth://hotp/Test?secret=GEZDGNBVGY3TQOJQ"))
    }
    func testNewPasskeyRoundTripAndRealSignature() throws {
        let original = try PasskeyMaterial(relyingParty: "login.example.test", userHandle: Data([1,2,3]), username: "test@example.test")
        let key = try PasskeyMaterial(entry: original.entry), hash = Data(SHA256.hash(data: Data("browser client data".utf8)))
        let assertion = try key.assertion(clientDataHash: hash, relyingParty: "login.example.test")
        let publicKey = try P256.Signing.PrivateKey(rawRepresentation: original.privateKey).publicKey
        XCTAssertTrue(publicKey.isValidSignature(try P256.Signing.ECDSASignature(derRepresentation: assertion.signature), for: assertion.authenticatorData + hash))
        XCTAssertEqual(assertion.authenticatorData.count, 37)
        XCTAssertEqual(assertion.authenticatorData[32], 0x1d)
        XCTAssertThrowsError(try key.assertion(clientDataHash: hash, relyingParty: "attacker.test"))
        XCTAssertThrowsError(try key.assertion(clientDataHash: Data([1]), relyingParty: key.relyingParty))
        XCTAssertGreaterThan(try key.registration().count, 150)
        XCTAssertNotEqual(key.credentialID, try PasskeyMaterial(relyingParty: key.relyingParty, userHandle: key.userHandle, username: key.username).credentialID)
    }
    func testWebAuthnInteroperabilityFixture() throws {
        guard let path = ProcessInfo.processInfo.environment["THINGTIME_PASSKEY_FIXTURE_PATH"] else { throw XCTSkip("WebAuthn interoperability fixture is opt-in.") }
        let challenge = Data(repeating: 7, count: 32).base64URL, origin = "https://passkeys.example.test"
        let registration = try JSONSerialization.data(withJSONObject: ["type": "webauthn.create", "challenge": challenge, "origin": origin, "crossOrigin": false], options: .sortedKeys)
        let authentication = try JSONSerialization.data(withJSONObject: ["type": "webauthn.get", "challenge": challenge, "origin": origin, "crossOrigin": false], options: .sortedKeys)
        let key = try PasskeyMaterial(relyingParty: "passkeys.example.test", userHandle: Data([1, 2, 3]), username: "fixture@example.test")
        let signed = try key.assertion(clientDataHash: Data(SHA256.hash(data: authentication)), relyingParty: key.relyingParty)
        let fixture: [String: Any] = ["challenge": challenge, "origin": origin, "rp": key.relyingParty,
            "registration": ["id": key.credentialID.base64URL, "rawId": key.credentialID.base64URL, "type": "public-key", "clientExtensionResults": [:], "response": ["clientDataJSON": registration.base64URL, "attestationObject": try key.registration().base64URL, "transports": ["internal"]]],
            "authentication": ["id": key.credentialID.base64URL, "rawId": key.credentialID.base64URL, "type": "public-key", "clientExtensionResults": [:], "response": ["clientDataJSON": authentication.base64URL, "authenticatorData": signed.authenticatorData.base64URL, "signature": signed.signature.base64URL, "userHandle": key.userHandle.base64URL]]]
        // Public ceremony outputs only; the private key never leaves this test.
        try JSONSerialization.data(withJSONObject: fixture).write(to: URL(fileURLWithPath: path), options: .atomic)
    }
    func testConfiguredHTTPSPreview() async throws {
        guard let path = ProcessInfo.processInfo.environment["THINGTIME_PASSWORD_TEST_SESSION"] else { throw XCTSkip("HTTPS preview session is opt-in.") }
        let decoded = try JSONDecoder().decode(ProviderSession.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
        let session = try ProviderSession(origin: decoded.origin, ownerId: decoded.ownerId, cookie: decoded.cookie)
        let client = PasswordClient(account: session), catalog = try await client.catalog()
        let fixture = try XCTUnwrap(catalog.first { $0.title == "Preview QA account" })
        let login = try await client.read(fixture.id)
        XCTAssertEqual(login.value("username"), "fixture@example.test")
        let key = try PasskeyMaterial(relyingParty: "passkeys.example.test", userHandle: Data([1, 2, 3]), username: "fixture@example.test")
        let id = UUID().uuidString.lowercased()
        _ = try await client.save(key.entry, id: id, writeId: UUID().uuidString.lowercased())
        let restored = try PasskeyMaterial(entry: try await client.read(id))
        XCTAssertEqual(restored.privateKey, key.privateKey)
        XCTAssertEqual(restored.credentialID, key.credentialID)
        let updated = try await client.catalog()
        XCTAssertEqual(updated.first { $0.id == id }?.credentialId, key.credentialID.base64URL)
    }
    func testSessionOriginAndExactDomainBinding() throws {
        XCTAssertThrowsError(try ProviderSession(origin: URL(string:"http://example.test")!, ownerId:"user", cookie:"tt_auth=fixture"))
        XCTAssertThrowsError(try ProviderSession(origin: URL(string:"https://example.test/other")!, ownerId:"user", cookie:"tt_auth=fixture"))
        XCTAssertThrowsError(try ProviderSession(origin: URL(string:"https://example.test")!, ownerId:"user", cookie:"tt_auth=fixture\r\nInjected: yes"))
        let entry = PasswordEntry(title: "test", passwordType: "login", fields:[PasswordField("site", "Site", "url", "https://example.test/login")])
        XCTAssertTrue(entry.matches(host:"example.test")); XCTAssertFalse(entry.matches(host:"evil.example.test")); XCTAssertFalse(entry.matches(host:"example.test.evil.test"))
    }
}


final class CapabilityContractTests: XCTestCase {
    func testProviderManifestRequiresTheSelectedOriginAndCompatiblePasswordsFeature() throws {
        let origin = URL(string: "https://passwords.example.test")!
        func manifest(version: String? = "1.0.0", selectedOrigin: String = "https://passwords.example.test", schema: Int = 1) throws -> Data {
            let features = version.map { ["api.passwords": ["version": $0]] } ?? [:]
            return try JSONSerialization.data(withJSONObject: ["schemaVersion": schema, "origin": selectedOrigin, "features": features])
        }
        for version in ["1.0.0", "1.2.1", "1.99.99"] {
            XCTAssertTrue(PasswordClient.compatibleCapabilities(try manifest(version: version), origin: origin))
        }
        for version in [nil, "0.9.0", "2.0.0", "1.00.0", "1.0", "1.0.0-beta"] {
            XCTAssertFalse(PasswordClient.compatibleCapabilities(try manifest(version: version), origin: origin))
        }
        XCTAssertFalse(PasswordClient.compatibleCapabilities(try manifest(selectedOrigin: "https://other.example.test"), origin: origin))
        XCTAssertFalse(PasswordClient.compatibleCapabilities(try manifest(schema: 2), origin: origin))
        XCTAssertFalse(PasswordClient.compatibleCapabilities(Data("not-json".utf8), origin: origin))
        XCTAssertFalse(PasswordClient.compatibleCapabilities(Data(repeating: 32, count: 512 * 1024), origin: origin))
    }
}
