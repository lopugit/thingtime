import XCTest
import CryptoKit
@testable import ThingtimePasswordCore
final class CoreTests: XCTestCase {
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
        guard let path = ProcessInfo.processInfo.environment["THINGTIME_PASSKEY_FIXTURE_PATH"] else { return }
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
    func testSessionOriginAndExactDomainBinding() throws {
        XCTAssertThrowsError(try ProviderSession(origin: URL(string:"http://example.test")!, ownerId:"user", cookie:"tt_auth=fixture"))
        XCTAssertThrowsError(try ProviderSession(origin: URL(string:"https://example.test/other")!, ownerId:"user", cookie:"tt_auth=fixture"))
        XCTAssertThrowsError(try ProviderSession(origin: URL(string:"https://example.test")!, ownerId:"user", cookie:"tt_auth=fixture\r\nInjected: yes"))
        let entry = PasswordEntry(title: "test", passwordType: "login", fields:[PasswordField("site", "Site", "url", "https://example.test/login")])
        XCTAssertTrue(entry.matches(host:"example.test")); XCTAssertFalse(entry.matches(host:"evil.example.test")); XCTAssertFalse(entry.matches(host:"example.test.evil.test"))
    }
}
