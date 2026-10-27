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
    static func loadIfPresent() throws -> ProviderSession? {
        var lookup = try query(accessGroup: group); lookup[kSecReturnData as String] = true; lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(lookup as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        try validateLoadStatus(status)
        guard let data = item as? Data, let decoded = try? JSONDecoder().decode(ProviderSession.self, from: data) else { throw PasswordProviderError.invalidSession }
        return try ProviderSession(origin: decoded.origin, ownerId: decoded.ownerId, cookie: decoded.cookie)
    }
    static func validateLoadStatus(_ status: OSStatus) throws {
        if status == errSecItemNotFound { throw PasswordProviderError.invalidSession }
        guard status == errSecSuccess else { throw PasswordProviderError.sessionUnavailable }
    }
    public static func save(_ session: ProviderSession) throws {
        let query = try query(accessGroup: group)
        let data = try JSONEncoder().encode(session)
        let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let updated = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updated == errSecItemNotFound {
            let status = SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil)
            guard status == errSecSuccess else { throw PasswordProviderError.unavailable }
        } else if updated != errSecSuccess { throw PasswordProviderError.unavailable }
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
