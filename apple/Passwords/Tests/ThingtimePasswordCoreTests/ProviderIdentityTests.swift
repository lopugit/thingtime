import XCTest
import CryptoKit
@testable import ThingtimePasswordCore
final class ProviderIdentityTests: XCTestCase {
    func testStableProviderModelBytesHaveValueSemantics() {
        let hex = PasswordProviderIdentity.aaguid.replacingOccurrences(of: "-", with: "")
        XCTAssertEqual(PasswordProviderIdentity.aaguidBytes.map { String(format: "%02x", $0) }.joined(), hex)
        XCTAssertEqual(PasswordProviderIdentity.aaguidBytes.count, 16)
        var mutated = PasswordProviderIdentity.aaguidBytes
        mutated.resetBytes(in: 0..<16)
        XCTAssertNotEqual(mutated, PasswordProviderIdentity.aaguidBytes)
    }
    func testSavedEntryDoesNotRequireIdentityOrChangeAssertionShape() throws {
        let original = try PasskeyMaterial(relyingParty: "passkeys.example.test", userHandle: Data([1,2,3]), username: "fixture")
        XCTAssertTrue(original.entry.title.hasPrefix("Thingtime Passkey · "))
        var saved = original.entry
        saved.title = "My custom working key"
        XCTAssertFalse(saved.fields.contains { $0.id == "aaguid" })
        let restored = try PasskeyMaterial(entry: saved)
        XCTAssertEqual(restored.entry.title, saved.title)
        let hash = Data(SHA256.hash(data: Data("public synthetic client data".utf8)))
        let assertion = try restored.assertion(clientDataHash: hash, relyingParty: restored.relyingParty)
        XCTAssertEqual(assertion.authenticatorData.count, 37)
        XCTAssertEqual(restored.credentialID, original.credentialID)
        let publicKey = try P256.Signing.PrivateKey(rawRepresentation: original.privateKey).publicKey
        XCTAssertTrue(publicKey.isValidSignature(try P256.Signing.ECDSASignature(derRepresentation: assertion.signature), for: assertion.authenticatorData + hash))
    }
}
