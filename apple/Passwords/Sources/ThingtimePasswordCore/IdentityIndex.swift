import AuthenticationServices
import Foundation
public enum PasswordIdentityIndex {
    public static func identities(_ catalog: [PasswordCatalogItem]) -> [any ASCredentialIdentity] {
        var result: [any ASCredentialIdentity] = []
        for item in catalog {
            for domain in item.domains {
                let service = ASCredentialServiceIdentifier(identifier: domain, type: .domain)
                if item.hasPassword { result.append(ASPasswordCredentialIdentity(serviceIdentifier: service, user: item.username, recordIdentifier: item.id)) }
                if #available(iOS 18, macOS 15, *), item.hasTotp { result.append(ASOneTimeCodeCredentialIdentity(serviceIdentifier: service, label: item.username.isEmpty ? item.title : item.username, recordIdentifier: item.id)) }
            }
            if let rp = item.relyingParty, let encodedID = item.credentialId, let id = Data(base64URL: encodedID), let encodedUser = item.userHandle, let user = Data(base64URL: encodedUser) {
                result.append(ASPasskeyCredentialIdentity(relyingPartyIdentifier: rp, userName: item.username, credentialID: id, userHandle: user, recordIdentifier: item.id))
            }
        }
        return result
    }
    public static func synchronize(_ catalog: [PasswordCatalogItem]) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            ASCredentialIdentityStore.shared.replaceCredentialIdentities(identities(catalog)) { success, _ in
                if success { continuation.resume() } else { continuation.resume(throwing: PasswordProviderError.unavailable) }
            }
        }
    }
    public static func savePasskey(_ key: PasskeyMaterial, recordID: String) async throws {
        let identity = ASPasskeyCredentialIdentity(relyingPartyIdentifier: key.relyingParty, userName: key.username, credentialID: key.credentialID, userHandle: key.userHandle, recordIdentifier: recordID)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            ASCredentialIdentityStore.shared.saveCredentialIdentities([identity]) { success, _ in
                if success { continuation.resume() } else { continuation.resume(throwing: PasswordProviderError.unavailable) }
            }
        }
    }
    public static func clearAndWait() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            ASCredentialIdentityStore.shared.removeAllCredentialIdentities { _, _ in continuation.resume() }
        }
    }
    public static func clear() { ASCredentialIdentityStore.shared.removeAllCredentialIdentities(nil) }
}
