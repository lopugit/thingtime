import Foundation
public struct PasswordField: Codable, Equatable, Sendable {
    public var id: String
    public var label: String
    public var type: String
    public var value: String
    public init(_ id: String, _ label: String, _ type: String, _ value: String) { self.id = id; self.label = label; self.type = type; self.value = value }
}
public struct PasswordEntry: Codable, Equatable, Sendable {
    public var title: String
    public var passwordType: String
    public var fields: [PasswordField]
    public init(title: String, passwordType: String, fields: [PasswordField]) { self.title = title; self.passwordType = passwordType; self.fields = fields }
    public func value(_ id: String) -> String { fields.first { $0.id == id }?.value ?? "" }
    public func matches(host: String) -> Bool {
        fields.filter { $0.type == "url" }.contains {
            guard let url = URL(string: $0.value), url.scheme == "https", let stored = url.host?.lowercased(), !stored.isEmpty else { return false }
            return stored == host.lowercased()
        }
    }
}
public struct PasswordRecord: Codable, Identifiable, Sendable {
    public var id: String
    public var title: String
    public var passwordType: String
    public var revision: Int
    public var entry: PasswordEntry?
}
public struct ProviderSession: Codable, Equatable, Sendable {
    public var origin: URL
    public var ownerId: String
    public var cookie: String
    public func requireUnchanged(from expected: ProviderSession) throws {
        guard self == expected else { throw PasswordProviderError.sessionChanged }
    }
    public init(origin: URL, ownerId: String, cookie: String) throws {
        guard origin.scheme == "https", origin.host != nil, origin.user == nil, origin.password == nil,
              origin.query == nil, origin.fragment == nil, origin.path.isEmpty || origin.path == "/",
              !ownerId.isEmpty, ownerId.count < 200, cookie.hasPrefix("tt_auth="), cookie.count > 8,
              cookie.unicodeScalars.allSatisfy({ (33...126).contains($0.value) && $0.value != 59 }), cookie.count < 16384 else { throw PasswordProviderError.invalidSession }
        self.origin = origin; self.ownerId = ownerId; self.cookie = cookie
    }
}
// Closed categories are safe to present in the extension. Never display a raw
// server response, URLSession error, Keychain value or credential in diagnostics.
public enum PasswordProviderError: Error, Equatable {
    case invalidSession, sessionChanged, sessionUnavailable, unavailable, invalidCredential, unsupportedAlgorithm, cancelled
    case permissionDenied, conflict, rateLimited, serviceUnavailable, incompatibleService, networkUnavailable, invalidResponse
    public var allowsRetryInCurrentRequest: Bool { self != .sessionChanged }
}
extension Data {
    public var base64URL: String { base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
    public init?(base64URL: String) {
        let text = base64URL.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        self.init(base64Encoded: text + String(repeating: "=", count: (4 - text.count % 4) % 4))
    }
}
