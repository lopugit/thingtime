import XCTest
@testable import ThingtimePasswordCore

final class CatalogSelectionTests: XCTestCase {
    private let rp = "passkeys.example.test"
    private func item(_ id: String, rp: String? = nil, credential: String? = nil, password: Bool = false, totp: Bool = false, domains: [String]? = nil) -> PasswordCatalogItem {
        PasswordCatalogItem(id: id, title: id, username: "fixture", domains: domains ?? [self.rp], hasPassword: password, hasTotp: totp, relyingParty: rp, credentialId: credential, userHandle: Data([9]).base64URL)
    }
    func testPasskeyPickerNeverOffersPasswordOrOTPRecordsForTheRequestedWebsite() {
        let credentials = [item("password", password: true), item("otp", totp: true), item("both", password: true, totp: true)]
        XCTAssertTrue(PasswordCatalogSelection.matching(credentials, hosts: [rp], relyingParty: rp).isEmpty)
        XCTAssertTrue(PasswordCatalogSelection.matching(credentials, hosts: [], anyService: true, relyingParty: rp).isEmpty)
        XCTAssertEqual(PasswordCatalogSelection.matching(credentials, hosts: [rp]).map(\.id), ["password", "both"])
        XCTAssertEqual(PasswordCatalogSelection.matching(credentials, hosts: [rp], otp: true).map(\.id), ["otp", "both"])
    }
    func testPasskeyReadbackRejectsAPasswordRecordAfterCatalogSelection() {
        let password = PasswordEntry(title: "Changed record", passwordType: "login", fields: [PasswordField("password", "Password", "password", "synthetic")])
        XCTAssertThrowsError(try PasskeyMaterial(entry: password)) { XCTAssertEqual($0 as? PasswordProviderError, .invalidCredential) }
    }
    func testPasskeyPickerRequiresExactRPValidCredentialAndSiteAllowlistWithoutAURLField() {
        let allowed = Data([1, 2, 3]), other = Data([4, 5, 6])
        let credentials = [
            item("allowed", rp: rp, credential: allowed.base64URL, domains: []),
            item("other-id", rp: rp, credential: other.base64URL),
            item("foreign-rp", rp: "other.example.test", credential: allowed.base64URL),
            item("malformed", rp: rp, credential: "!invalid!"),
            item("empty-id", rp: rp, credential: ""),
            item("missing-id", rp: rp)
        ]
        XCTAssertEqual(PasswordCatalogSelection.matching(credentials, hosts: [], relyingParty: rp, allowedCredentialIDs: [allowed]).map(\.id), ["allowed"])
        XCTAssertEqual(PasswordCatalogSelection.matching(credentials, hosts: [], relyingParty: rp).map(\.id), ["allowed", "other-id"])
        XCTAssertTrue(PasswordCatalogSelection.matching(credentials, hosts: [rp], anyService: true).isEmpty)
        XCTAssertTrue(PasswordCatalogSelection.matching(credentials, hosts: [], relyingParty: rp, allowedCredentialIDs: [Data([7])]).isEmpty)
    }
    func testPasskeySummaryUsesTheSameExactRPDecodingAndAllowlistAsSelection() {
        let allowed = Data((0..<32).map { UInt8($0) }), other = Data([4, 5, 6])
        XCTAssertEqual(allowed.base64URL.count, 43)
        let catalog = [item("allowed", rp: rp, credential: allowed.base64URL),
            item("other", rp: rp, credential: other.base64URL),
            item("malformed", rp: rp, credential: "!invalid!"),
            item("empty", rp: rp, credential: ""), item("missing", rp: rp),
            item("foreign", rp: "other.example.test", credential: allowed.base64URL), item("password", password: true)]
        let summary = PasswordCatalogSelection.passkeySummary(catalog, relyingParty: rp, allowedCredentialIDs: [allowed])
        XCTAssertEqual(summary.catalogTotal, 7)
        XCTAssertEqual(summary.relyingPartyMatches, 5)
        XCTAssertEqual(summary.validCredentialIDs, 2)
        XCTAssertEqual(summary.allowedCredentialCount, 1)
        XCTAssertEqual(summary.eligiblePasskeys, 1)
        XCTAssertEqual(summary.eligiblePasskeys, PasswordCatalogSelection.matching(catalog, hosts: [], relyingParty: rp, allowedCredentialIDs: [allowed]).count)
        let unrestricted = PasswordCatalogSelection.passkeySummary(catalog, relyingParty: rp)
        XCTAssertEqual(unrestricted.allowedCredentialCount, 0)
        XCTAssertEqual(unrestricted.eligiblePasskeys, 2)
        let wrongSite = PasswordCatalogSelection.passkeySummary(catalog, relyingParty: "missing.example.test")
        XCTAssertEqual(wrongSite.catalogTotal, 7)
        XCTAssertEqual(wrongSite.relyingPartyMatches, 0)
        XCTAssertEqual(wrongSite.validCredentialIDs, 0)
        XCTAssertEqual(wrongSite.eligiblePasskeys, 0)
        let empty = PasswordCatalogSelection.passkeySummary([], relyingParty: rp)
        XCTAssertEqual(empty.catalogTotal, 0)
        XCTAssertEqual(empty.eligiblePasskeys, 0)
    }
}
