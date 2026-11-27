import XCTest
import CryptoKit
@testable import ThingtimePasswordCore

final class PasskeyRegistrationPolicyTests: XCTestCase {
    private let rp = "registration.example.test"
    private func item(_ rp: String, _ id: Data) -> PasswordCatalogItem {
        PasswordCatalogItem(id: UUID().uuidString, title: "Fixture", username: "fixture", domains: [], hasPassword: false, hasTotp: false, relyingParty: rp, credentialId: id.base64URL, userHandle: Data([1]).base64URL)
    }
    func testExactSiteExclusionIsTerminalWithoutAWriteOrNewKey() throws {
        let id = Data([1, 2, 3])
        let summary = PasskeyRegistrationPolicy.summary(relyingParty: rp, userHandleBytes: 3, clientDataHashBytes: 32, supportsES256: true,
            excludedCredentialIDs: [id], catalog: [item(rp, id), item("foreign.example.test", id)])
        XCTAssertEqual(summary.matchedExclusions, 1)
        var writes = 0
        XCTAssertThrowsError(try { try PasskeyRegistrationPolicy.requireNoExcludedCredential(summary); writes += 1 }()) {
            XCTAssertEqual($0 as? PasswordProviderError, .credentialExcluded)
        }
        XCTAssertEqual(writes, 0)
        XCTAssertFalse(PasswordProviderError.credentialExcluded.allowsRetryInCurrentRequest)
        XCTAssertTrue(PasswordProviderPhase.vault.failure(.credentialExcluded).contains("Keep your working passkey"))
    }
    func testExclusionDoesNotInventAccountUniquenessOrMatchAnotherSite() throws {
        let id = Data([1, 2, 3])
        for catalog in [[item(rp, Data([4, 5, 6]))], [item("foreign.example.test", id)], [item(rp, id)]] {
            let exclusions = catalog.last?.relyingParty == rp && catalog.last?.credentialId == id.base64URL ? [] : [id]
            let summary = PasskeyRegistrationPolicy.summary(relyingParty: rp, userHandleBytes: 1, clientDataHashBytes: 32, supportsES256: true, excludedCredentialIDs: exclusions, catalog: catalog)
            XCTAssertNoThrow(try PasskeyRegistrationPolicy.requireNoExcludedCredential(summary))
        }
    }
    func testValidationAndUncheckedDiagnosticsStayDistinct() throws {
        let summary = PasskeyRegistrationPolicy.summary(relyingParty: rp, userHandleBytes: 3, clientDataHashBytes: 32, supportsES256: true, excludedCredentialIDs: [])
        XCTAssertNil(summary.catalogEntries); XCTAssertNil(summary.siteMatches); XCTAssertNil(summary.matchedExclusions)
        XCTAssertThrowsError(try PasskeyRegistrationPolicy.requireNoExcludedCredential(summary))
        XCTAssertNoThrow(try PasskeyRegistrationPolicy.requireValidRequest(relyingParty: rp, userHandle: Data([1]), clientDataHash: Data(repeating: 0, count: 32), supportsES256: true))
        for invalid in [(rp, Data(), 32), (rp, Data(repeating: 1, count: 65), 32), ("https://invalid.test", Data([1]), 32), (rp, Data([1]), 1)] {
            XCTAssertThrowsError(try PasskeyRegistrationPolicy.requireValidRequest(relyingParty: invalid.0, userHandle: invalid.1, clientDataHash: Data(repeating: 0, count: invalid.2), supportsES256: true)) {
                XCTAssertEqual($0 as? PasswordProviderError, .invalidRegistrationRequest)
            }
        }
        XCTAssertThrowsError(try PasskeyRegistrationPolicy.requireValidRequest(relyingParty: rp, userHandle: Data([1]), clientDataHash: Data(repeating: 0, count: 32), supportsES256: false)) { XCTAssertEqual($0 as? PasswordProviderError, .unsupportedAlgorithm) }
        XCTAssertFalse(PasswordProviderError.invalidRegistrationRequest.allowsRetryInCurrentRequest)
        XCTAssertFalse(PasswordProviderError.unsupportedAlgorithm.allowsRetryInCurrentRequest)
    }
    func testIndependentAttemptsPreserveExistingVaultMaterialForSameAccount() throws {
        // Vault/attempt independence, not a claim about two simultaneous
        // discoverable mappings in one logical WebAuthn authenticator.
        let first = try PasskeyRegistrationAttempt(relyingParty: rp, userHandle: Data([1, 2, 3]), username: "fixture")
        let second = try PasskeyRegistrationAttempt(relyingParty: rp, userHandle: first.key.userHandle, username: first.key.username)
        XCTAssertNotEqual(first.recordID, second.recordID); XCTAssertNotEqual(first.writeID, second.writeID)
        XCTAssertNotEqual(first.key.credentialID, second.key.credentialID); XCTAssertNotEqual(first.key.privateKey, second.key.privateKey)
        let records = [first.recordID: first.key.entry, second.recordID: second.key.entry]
        for attempt in [first, second] {
            let entry = try XCTUnwrap(records[attempt.recordID]); XCTAssertTrue(try attempt.matches(entry))
            let restored = try PasskeyMaterial(entry: entry), hash = Data(repeating: 1, count: 32)
            let result = try restored.assertion(clientDataHash: hash, relyingParty: rp)
            let publicKey = try P256.Signing.PrivateKey(rawRepresentation: attempt.key.privateKey).publicKey
            XCTAssertTrue(publicKey.isValidSignature(try P256.Signing.ECDSASignature(derRepresentation: result.signature), for: result.authenticatorData + hash))
        }
        XCTAssertFalse(try first.matches(PasswordEntry(title: "Malformed readback", passwordType: "passkey", fields: [])))
    }
}
