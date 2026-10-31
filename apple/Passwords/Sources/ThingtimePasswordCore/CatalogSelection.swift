import Foundation

/// Counts only: no account, credential, user-handle or session values are kept.
public struct PasswordPasskeySelectionSummary: Equatable, Sendable {
    public let catalogTotal: Int
    public let relyingPartyMatches: Int
    public let validCredentialIDs: Int
    public let allowedCredentialCount: Int
    public let eligiblePasskeys: Int
}

/// A passkey assertion may select only an allowed credential for its exact RP.
/// Password/OTP website matches never become passkey candidates.
public enum PasswordCatalogSelection {
    private static func credentialID(_ item: PasswordCatalogItem) -> Data? {
        guard let encoded = item.credentialId, let id = Data(base64URL: encoded), !id.isEmpty else { return nil }
        return id
    }
    public static func passkeySummary(_ catalog: [PasswordCatalogItem], relyingParty: String, allowedCredentialIDs: [Data] = []) -> PasswordPasskeySelectionSummary {
        let site = catalog.filter { $0.relyingParty == relyingParty }
        let valid = site.compactMap(credentialID)
        return PasswordPasskeySelectionSummary(catalogTotal: catalog.count, relyingPartyMatches: site.count,
            validCredentialIDs: valid.count, allowedCredentialCount: allowedCredentialIDs.count,
            eligiblePasskeys: valid.filter { allowedCredentialIDs.isEmpty || allowedCredentialIDs.contains($0) }.count)
    }
    public static func matching(_ catalog: [PasswordCatalogItem], hosts: [String], anyService: Bool = false, relyingParty: String? = nil, allowedCredentialIDs: [Data] = [], otp: Bool = false) -> [PasswordCatalogItem] {
        catalog.filter { item in
            if let relyingParty {
                guard item.relyingParty == relyingParty,
                      let id = credentialID(item) else { return false }
                return allowedCredentialIDs.isEmpty || allowedCredentialIDs.contains(id)
            }
            guard item.relyingParty == nil else { return false }
            return (otp ? item.hasTotp : item.hasPassword) && (anyService || item.domains.contains(where: hosts.contains))
        }
    }
}
