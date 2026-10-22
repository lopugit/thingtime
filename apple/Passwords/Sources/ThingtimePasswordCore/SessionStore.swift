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
        var lookup = try query(accessGroup: group); lookup[kSecReturnData as String] = true; lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(lookup as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { throw PasswordProviderError.invalidSession }
        let decoded = try JSONDecoder().decode(ProviderSession.self, from: data)
        return try ProviderSession(origin: decoded.origin, ownerId: decoded.ownerId, cookie: decoded.cookie)
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
    public static func clear() {
        guard let query = try? query(accessGroup: group) else { return }
        SecItemDelete(query as CFDictionary)
    }
}
