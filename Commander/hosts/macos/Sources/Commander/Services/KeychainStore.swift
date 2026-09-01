import Foundation
import Security

enum KeychainError: LocalizedError {
  case status(OSStatus)
  case invalidData

  var errorDescription: String? {
    switch self {
    case .status(let status): SecCopyErrorMessageString(status, nil) as String? ?? "Keychain error \(status)"
    case .invalidData: "The stored Commander credential is invalid."
    }
  }
}

struct KeychainCredentialEnvironment: Equatable {
  let issuer: String
  let clientID: String
  let accountID: String
}

final class KeychainStore {
  private let service = "com.thingtime.Commander"

  func store(token: String, issuer: String, clientID: String, accountID: String) throws {
    let data = Data(token.utf8)
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key(issuer: issuer, clientID: clientID, accountID: accountID)]
    let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
    let update = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if update == errSecSuccess { return }
    guard update == errSecItemNotFound else { throw KeychainError.status(update) }
    var add = query
    attributes.forEach { add[$0.key] = $0.value }
    let status = SecItemAdd(add as CFDictionary, nil)
    guard status == errSecSuccess else { throw KeychainError.status(status) }
  }

  func read(issuer: String, clientID: String, accountID: String) throws -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: key(issuer: issuer, clientID: clientID, accountID: accountID),
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess else { throw KeychainError.status(status) }
    guard let data = result as? Data, let token = String(data: data, encoding: .utf8) else { throw KeychainError.invalidData }
    return token
  }

  func delete(issuer: String, clientID: String, accountID: String) throws {
    let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key(issuer: issuer, clientID: clientID, accountID: accountID)]
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { throw KeychainError.status(status) }
  }

  /// Returns only non-secret metadata for explicitly requested Commander accounts.
  /// Tokens never leave the Keychain through this path.
  func environments(for accountIDs: Set<String>) throws -> [KeychainCredentialEnvironment] {
    guard !accountIDs.isEmpty else { return [] }
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecReturnAttributes as String: true,
      kSecMatchLimit as String: kSecMatchLimitAll,
    ]
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return [] }
    guard status == errSecSuccess else { throw KeychainError.status(status) }
    guard let entries = result as? [[String: Any]] else { return [] }
    return entries.compactMap { entry in
      guard let value = entry[kSecAttrAccount as String] as? String,
            let environment = Self.environment(from: value),
            accountIDs.contains(environment.accountID) else { return nil }
      return environment
    }
  }

  static func environment(from key: String) -> KeychainCredentialEnvironment? {
    let components = key.split(separator: "|", omittingEmptySubsequences: false)
    guard components.count == 3,
          !components[0].isEmpty,
          !components[1].isEmpty,
          !components[2].isEmpty else { return nil }
    return KeychainCredentialEnvironment(
      issuer: String(components[0]),
      clientID: String(components[1]),
      accountID: String(components[2])
    )
  }

  private func key(issuer: String, clientID: String, accountID: String) -> String {
    "\(issuer.lowercased())|\(clientID)|\(accountID)"
  }
}
