import Foundation

/// A passkey assertion may select only an allowed credential for its exact RP.
/// Password/OTP website matches never become passkey candidates.
public enum PasswordCatalogSelection {
    public static func matching(_ catalog: [PasswordCatalogItem], hosts: [String], anyService: Bool = false, relyingParty: String? = nil, allowedCredentialIDs: [Data] = [], otp: Bool = false) -> [PasswordCatalogItem] {
        catalog.filter { item in
            if let relyingParty {
                guard item.relyingParty == relyingParty,
                      let encoded = item.credentialId, let id = Data(base64URL: encoded), !id.isEmpty else { return false }
                return allowedCredentialIDs.isEmpty || allowedCredentialIDs.contains(id)
            }
            guard item.relyingParty == nil else { return false }
            return (otp ? item.hasTotp : item.hasPassword) && (anyService || item.domains.contains(where: hosts.contains))
        }
    }
}
