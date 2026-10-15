import Foundation
import Security
public enum PasswordSessionStore {
    private static var group: String? { Bundle.main.object(forInfoDictionaryKey: "ThingtimePasswordKeychainGroup") as? String }
    private static var query: [String: Any] {
        var result: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.thingtime.password-provider", kSecAttrAccount as String: "active-session"]
        if let group, !group.isEmpty { result[kSecAttrAccessGroup as String] = group }
        return result
    }
    public static func load() throws -> ProviderSession {
        var lookup = query; lookup[kSecReturnData as String] = true; lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(lookup as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { throw PasswordProviderError.invalidSession }
        let decoded = try JSONDecoder().decode(ProviderSession.self, from: data)
        return try ProviderSession(origin: decoded.origin, ownerId: decoded.ownerId, cookie: decoded.cookie)
    }
    public static func save(_ session: ProviderSession) throws {
        let data = try JSONEncoder().encode(session)
        let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let updated = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if updated == errSecItemNotFound {
            let status = SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil)
            guard status == errSecSuccess else { throw PasswordProviderError.unavailable }
        } else if updated != errSecSuccess { throw PasswordProviderError.unavailable }
    }
    public static func clear() { SecItemDelete(query as CFDictionary) }
}
