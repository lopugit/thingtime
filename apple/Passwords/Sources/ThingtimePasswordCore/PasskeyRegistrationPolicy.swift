import Foundation

/// Registration diagnostics contain only counts and a supported-algorithm flag.
/// They never retain a handle, credential identifier, key or account/session.
public struct PasskeyRegistrationSummary: Equatable, Sendable {
    public let userHandleBytes: Int
    public let clientDataHashBytes: Int
    public let supportsES256: Bool
    public let excludedCredentialCount: Int
    public let catalogEntries: Int?
    public let siteMatches: Int?
    public let matchedExclusions: Int?
}
public enum PasskeyRegistrationPolicy {
    public static func summary(relyingParty: String, userHandleBytes: Int, clientDataHashBytes: Int, supportsES256: Bool,
                               excludedCredentialIDs: [Data], catalog: [PasswordCatalogItem]? = nil) -> PasskeyRegistrationSummary {
        let site = catalog?.filter { $0.relyingParty == relyingParty }
        let matches = site?.filter { item in
            item.credentialId.flatMap { Data(base64URL: $0) }.map { excludedCredentialIDs.contains($0) } == true
        }.count
        return PasskeyRegistrationSummary(userHandleBytes: userHandleBytes, clientDataHashBytes: clientDataHashBytes,
            supportsES256: supportsES256, excludedCredentialCount: excludedCredentialIDs.count,
            catalogEntries: catalog?.count, siteMatches: site?.count, matchedExclusions: matches)
    }
    public static func requireValidRequest(relyingParty: String, userHandle: Data, clientDataHash: Data, supportsES256: Bool) throws {
        guard PasskeyMaterial.validRP(relyingParty), !userHandle.isEmpty, userHandle.count <= 64, clientDataHash.count == 32 else {
            throw PasswordProviderError.invalidRegistrationRequest
        }
        guard supportsES256 else { throw PasswordProviderError.unsupportedAlgorithm }
    }
    public static func requireNoExcludedCredential(_ summary: PasskeyRegistrationSummary) throws {
        guard summary.matchedExclusions == 0 else { throw summary.matchedExclusions == nil ? PasswordProviderError.unavailable : .credentialExcluded }
    }
}
