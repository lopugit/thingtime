import Foundation
import Security

struct ThingtimeWatchAccount: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let origin: String
    let userId: String
    let deviceId: String
    var username: String
    var displayName: String?
    var avatarURL: String?

    var displayUsername: String { username.isEmpty ? "Thingtime account" : "@\(username)" }
    var domain: String { URL(string: origin)?.host ?? origin }

    func resolvedAvatarURL() -> URL? {
        guard let avatarURL, !avatarURL.isEmpty else { return nil }
        if let absolute = URL(string: avatarURL), absolute.scheme != nil { return absolute }
        guard let base = URL(string: origin) else { return nil }
        return URL(string: avatarURL, relativeTo: base)?.absoluteURL
    }
}

enum ThingtimeWatchDomain: String, CaseIterable, Identifiable, Codable {
    case production = "https://thingtime.com"
    case development = "https://dev.thingtime.com"
    case buildPreview = "build-preview"

    var id: String { rawValue }
    var origin: String {
        switch self {
        case .production, .development: rawValue
        case .buildPreview: Self.configuredBuildOrigin ?? Self.production.rawValue
        }
    }
    var title: String {
        switch self {
        case .production: "Thingtime.com"
        case .development: "Dev Thingtime"
        case .buildPreview: "Build preview"
        }
    }
    var host: String { URL(string: origin)?.host ?? origin }

    static var availableCases: [ThingtimeWatchDomain] {
        var values: [ThingtimeWatchDomain] = [.production, .development]
        if let configuredBuildOrigin,
           configuredBuildOrigin != production.origin,
           configuredBuildOrigin != development.origin {
            values.append(.buildPreview)
        }
        return values
    }

    private static var configuredBuildOrigin: String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "ThingtimeWebURL") as? String,
              var components = URLComponents(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
              components.scheme?.lowercased() == "https",
              components.host != nil else { return nil }
        components.path = ""
        components.query = nil
        components.fragment = nil
        return components.url?.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }
}

enum ThingtimeWatchAccountStorage {
    private static let accountsKey = "watch.direct.accounts.v1"
    private static let selectedKey = "watch.direct.selected-account.v1"
    private static let service = "com.thingtime.appletime.watch.direct"

    static func loadAccounts() -> [ThingtimeWatchAccount] {
        guard let data = UserDefaults.standard.data(forKey: accountsKey),
              let accounts = try? JSONDecoder().decode([ThingtimeWatchAccount].self, from: data) else { return [] }
        return accounts
    }

    static func saveAccounts(_ accounts: [ThingtimeWatchAccount]) {
        if let data = try? JSONEncoder().encode(accounts) {
            UserDefaults.standard.set(data, forKey: accountsKey)
        }
    }

    static var selectedAccountID: String? {
        get { UserDefaults.standard.string(forKey: selectedKey) }
        set { UserDefaults.standard.set(newValue, forKey: selectedKey) }
    }

    static func credential(for accountID: String) -> String? {
        var query = baseQuery(accountID: accountID)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func storeCredential(_ credential: String, for accountID: String) throws {
        guard let data = credential.data(using: .utf8) else { throw StorageError.encoding }
        let query = baseQuery(accountID: accountID)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var insert = query
            attributes.forEach { insert[$0.key] = $0.value }
            let insertStatus = SecItemAdd(insert as CFDictionary, nil)
            guard insertStatus == errSecSuccess else { throw StorageError.keychain(insertStatus) }
        } else if status != errSecSuccess {
            throw StorageError.keychain(status)
        }
    }

    static func removeCredential(for accountID: String) {
        SecItemDelete(baseQuery(accountID: accountID) as CFDictionary)
    }

    private static func baseQuery(accountID: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: accountID
        ]
    }

    private enum StorageError: LocalizedError {
        case encoding
        case keychain(OSStatus)

        var errorDescription: String? {
            switch self {
            case .encoding: "Thingtime couldn’t encode the Watch credential."
            case let .keychain(status): "Thingtime couldn’t secure this account in Watch Keychain (\(status))."
            }
        }
    }
}
