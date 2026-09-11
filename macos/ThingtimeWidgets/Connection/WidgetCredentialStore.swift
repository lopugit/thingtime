import Foundation
import Security

struct WidgetCredential: Codable {
    let origin: String
    let accessToken: String
    let expiresAt: Date
    let ownerID: String
    let displayName: String
    let scopes: [String]
}

/// Credentials belong exclusively to the companion app, never its App Group.
enum WidgetCredentialStore {
    private static let service = "com.thingtime.widgets.oauth"
    private static func query(_ origin: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service, kSecAttrAccount as String: origin,
         kSecAttrSynchronizable as String: false]
    }
    struct Failure: LocalizedError {
        let status: OSStatus
        var errorDescription: String? { "The connection could not be saved in Keychain (\(status))." }
    }
    static func read(origin: String) throws -> WidgetCredential? {
        var request = query(origin)
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else { throw Failure(status: status) }
        let credential = try JSONDecoder().decode(WidgetCredential.self, from: data)
        guard credential.origin == origin else { throw Failure(status: errSecDecode) }
        return credential
    }
    static func save(_ credential: WidgetCredential) throws {
        let attributes: [String: Any] = [
            kSecValueData as String: try JSONEncoder().encode(credential),
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]
        let status = SecItemUpdate(query(credential.origin) as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var item = query(credential.origin)
            attributes.forEach { item[$0.key] = $0.value }
            let added = SecItemAdd(item as CFDictionary, nil)
            guard added == errSecSuccess else { throw Failure(status: added) }
        } else if status != errSecSuccess { throw Failure(status: status) }
    }
    static func remove(origin: String) throws {
        let status = SecItemDelete(query(origin) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw Failure(status: status) }
    }
}
