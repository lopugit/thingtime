import Foundation
import Security
public enum PasswordSessionStore {
    private static var group: String? { Bundle.main.object(forInfoDictionaryKey: "ThingtimePasswordKeychainGroup") as? String }
    static func query(accessGroup: String?) throws -> [String: Any] {
        guard let accessGroup, !accessGroup.isEmpty,
              accessGroup == accessGroup.trimmingCharacters(in: .whitespacesAndNewlines),
              !accessGroup.contains("$(") else { throw PasswordProviderError.invalidSession }
        // macOS's legacy Keychain ignores access groups and accessibility.
        // Every operation must target the same non-synchronizing protected store.
        return [kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: "com.thingtime.password-provider",
                kSecAttrAccount as String: "active-session",
                kSecAttrAccessGroup as String: accessGroup,
                kSecUseDataProtectionKeychain as String: true,
                kSecAttrSynchronizable as String: false]
    }
    public static func load() throws -> ProviderSession {
        guard let session = try loadIfPresent() else { throw PasswordProviderError.invalidSession }
        return session
    }
    public static func loadIfPresent() throws -> ProviderSession? {
        var lookup = try query(accessGroup: group); lookup[kSecReturnData as String] = true; lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(lookup as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else { throw PasswordProviderError.storageUnavailable }
        guard let decoded = try? JSONDecoder().decode(ProviderSession.self, from: data) else { throw PasswordProviderError.invalidSession }
        return try ProviderSession(origin: decoded.origin, ownerId: decoded.ownerId, cookie: decoded.cookie, companionConnectionID: decoded.companionConnectionID)
    }
    /// Configuration metadata only. Never seed a separate web session with
    /// the provider's stored credential (which may become device-scoped).
    public static func destination() throws -> (origin: URL, ownerId: String)? {
        try destination(accessGroup: group) { query in
            var result: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &result)
            return (status, result as? Data)
        }
    }
    static func destination(accessGroup: String?, read: ([String: Any]) -> (OSStatus, Data?)) throws -> (origin: URL, ownerId: String)? {
        var lookup = try query(accessGroup: accessGroup)
        lookup[kSecReturnData as String] = true; lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        lookup[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
        let (status, data) = read(lookup)
        if status == errSecItemNotFound { return nil }
        // A locked/inaccessible linked destination must not silently fall back
        // to a different origin/account in the normal-sign-in editor.
        guard status == errSecSuccess, let data else { throw PasswordProviderError.unavailable }
        let decoded = try JSONDecoder().decode(ProviderSession.self, from: data)
        let session = try ProviderSession(origin: decoded.origin, ownerId: decoded.ownerId, cookie: decoded.cookie, companionConnectionID: decoded.companionConnectionID)
        return (session.origin, session.ownerId)
    }
    public static func save(_ session: ProviderSession) throws {
        let query = try query(accessGroup: group)
        let data = try JSONEncoder().encode(session)
        let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let updated = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updated == errSecItemNotFound {
            let status = SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil)
            guard status == errSecSuccess else { throw PasswordProviderError.storageUnavailable }
        } else if updated != errSecSuccess { throw PasswordProviderError.storageUnavailable }
    }
    public static func clear() throws {
        try clear(accessGroup: group, delete: { SecItemDelete($0 as CFDictionary) })
    }
    // Inject only the system deletion result for deterministic, credential-free
    // regression tests. Every attempt still validates the protected query.
    static func clear(accessGroup: String?, delete: ([String: Any]) -> OSStatus) throws {
        let query = try query(accessGroup: accessGroup)
        let status = delete(query)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw PasswordProviderError.unavailable
        }
    }
}
