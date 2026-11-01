import AuthenticationServices
import Foundation
// Keep mutations ordered even while the system store completes asynchronously.
// In particular, logout's clear must finish after an already submitted sync.
@MainActor final class PasswordIdentityOperations {
    private var pending: Task<Void, Never>?
    func submit(_ work: @escaping () async throws -> Void) -> Task<Void, Error> {
        let previous = pending
        let next = Task { await previous?.value; try await work() }
        pending = Task { _ = try? await next.value }
        return next
    }
}
@MainActor public enum PasswordIdentityIndex {
    private static let operations = PasswordIdentityOperations()
    public static func isEnabled() async -> Bool {
        await withCheckedContinuation { continuation in
            ASCredentialIdentityStore.shared.getState { continuation.resume(returning: $0.isEnabled) }
        }
    }
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
        try await operations.submit {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                ASCredentialIdentityStore.shared.replaceCredentialIdentities(identities(catalog)) { success, _ in
                    if success { continuation.resume() } else { continuation.resume(throwing: PasswordProviderError.unavailable) }
                }
            }
        }.value
    }
    public static func savePasskey(_ key: PasskeyMaterial, recordID: String) async throws {
        let identity = ASPasskeyCredentialIdentity(relyingPartyIdentifier: key.relyingParty, userName: key.username, credentialID: key.credentialID, userHandle: key.userHandle, recordIdentifier: recordID)
        try await operations.submit {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                ASCredentialIdentityStore.shared.saveCredentialIdentities([identity]) { success, _ in
                    if success { continuation.resume() } else { continuation.resume(throwing: PasswordProviderError.unavailable) }
                }
            }
        }.value
    }
    public static func clearAndWait() async {
        _ = try? await operations.submit { await removeAll() }.value
    }
    private static func removeAll() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            ASCredentialIdentityStore.shared.removeAllCredentialIdentities { _, _ in continuation.resume() }
        }
    }
    public static func clear() { _ = operations.submit { await removeAll() } }
}
