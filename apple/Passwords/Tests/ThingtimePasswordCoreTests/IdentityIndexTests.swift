import AuthenticationServices
import XCTest
@testable import ThingtimePasswordCore

final class IdentityIndexTests: XCTestCase {
    @MainActor func testPasskeyDiscoveryUsesRelyingPartyWithoutRequiringAPasswordWebsiteField() throws {
        let item = PasswordCatalogItem(id: "passkey-record", title: "Site account", username: "fixture@example.test", domains: [], hasPassword: false, hasTotp: false, relyingParty: "passkeys.example.test", credentialId: Data([1, 2, 3]).base64URL, userHandle: Data([4, 5, 6]).base64URL)
        let identities = PasswordIdentityIndex.identities([item])
        let identity = try XCTUnwrap(identities.first as? ASPasskeyCredentialIdentity)
        XCTAssertEqual(identities.count, 1)
        XCTAssertEqual(identity.relyingPartyIdentifier, "passkeys.example.test")
        XCTAssertEqual(identity.recordIdentifier, item.id)
        XCTAssertEqual(identity.userName, item.username)
        XCTAssertEqual(identity.credentialID, Data([1, 2, 3]))
        XCTAssertEqual(identity.userHandle, Data([4, 5, 6]))
    }
    @MainActor func testPasswordEntryDoesNotInventAPasskeyIdentityForTheSameSite() {
        let item = PasswordCatalogItem(id: "password-record", title: "Site login", username: "fixture@example.test", domains: ["passkeys.example.test"], hasPassword: true, hasTotp: false, relyingParty: nil, credentialId: nil, userHandle: nil)
        let identities = PasswordIdentityIndex.identities([item])
        XCTAssertEqual(identities.count, 1)
        XCTAssertTrue(identities.first is ASPasswordCredentialIdentity)
        XCTAssertFalse(identities.contains { $0 is ASPasskeyCredentialIdentity })
    }
}
