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
    /// A companion link belongs to its own private WebView. Background Electron
    /// sync/logout must never adopt or erase that independently connected session.
    public var companionConnectionID: String?
    public init(origin: URL, ownerId: String, cookie: String, companionConnectionID: String? = nil) throws {
        guard origin.scheme == "https", origin.host != nil, origin.user == nil, origin.password == nil,
              origin.query == nil, origin.fragment == nil, origin.path.isEmpty || origin.path == "/",
              !ownerId.isEmpty, ownerId.count < 200, cookie.hasPrefix("tt_auth="), cookie.count > 8,
              cookie.unicodeScalars.allSatisfy({ (33...126).contains($0.value) && $0.value != 59 }), cookie.count < 16384 else { throw PasswordProviderError.invalidSession }
        guard companionConnectionID == nil || companionConnectionID.flatMap(UUID.init(uuidString:)) != nil else { throw PasswordProviderError.invalidSession }
        self.origin = origin; self.ownerId = ownerId; self.cookie = cookie; self.companionConnectionID = companionConnectionID
    }
}
public enum PasswordProviderError: Error {
    case invalidSession, unavailable, invalidCredential, unsupportedAlgorithm, cancelled
    case accountMismatch, capabilityUnavailable, invalidResponse, network, storageUnavailable, identityIndexUnavailable, notConfigured
    /// Fixed allowlisted messages only. Never display server bodies, cookie or
    /// Keychain errors from an authentication extension.
    public var recoveryMessage: String {
        switch self {
        case .invalidSession: return "Password AutoFill is not connected, or its sign-in expired. Open Thingtime Passwords, sign in there, then choose Connect Password AutoFill."
        case .accountMismatch: return "This window is signed in to a different account. Sign in to the linked Thingtime account before connecting Password AutoFill."
        case .capabilityUnavailable: return "This Thingtime destination does not provide a compatible Passwords service. Retry after the service is available."
        case .invalidResponse: return "The Passwords service returned an invalid response. Retry when the service is available."
        case .network: return "The Passwords service could not be reached. Check your connection, then retry this request."
        case .storageUnavailable: return "The protected Password AutoFill connection could not be accessed. Unlock this device and retry. If it continues, reconnect in Thingtime Passwords."
        case .identityIndexUnavailable: return "The passkey is saved, but password suggestions could not be updated. Enable Thingtime in AutoFill & Passwords settings, then retry this request."
        case .notConfigured: return "Finish setting up Passwords in this window, then choose Connect Password AutoFill."
        case .invalidCredential: return "This credential does not match the request or is already registered. Review the saved entry in Thingtime Passwords."
        case .unsupportedAlgorithm: return "This site requested a passkey algorithm that Thingtime does not support."
        case .cancelled: return ""
        case .unavailable: return "Password AutoFill could not complete this request. Retry, or open Thingtime Passwords to check the connection."
        }
    }
}
public enum PasswordProviderError: Error {
    case invalidSession, unavailable, invalidCredential, unsupportedAlgorithm, cancelled
    case accountMismatch, capabilityUnavailable, invalidResponse, network, storageUnavailable, identityIndexUnavailable, notConfigured
    /// Fixed allowlisted messages only. Never display server bodies, cookie or
    /// Keychain errors from an authentication extension.
    public var recoveryMessage: String {
        switch self {
        case .invalidSession: return "Password AutoFill is not connected, or its sign-in expired. Open Thingtime Passwords, sign in there, then choose Connect Password AutoFill."
        case .accountMismatch: return "This window is signed in to a different account. Sign in to the linked Thingtime account before connecting Password AutoFill."
        case .capabilityUnavailable: return "This Thingtime destination does not provide a compatible Passwords service. Retry after the service is available."
        case .invalidResponse: return "The Passwords service returned an invalid response. Retry when the service is available."
        case .network: return "The Passwords service could not be reached. Check your connection, then retry this request."
        case .storageUnavailable: return "The protected Password AutoFill connection could not be accessed. Unlock this device and retry. If it continues, reconnect in Thingtime Passwords."
        case .identityIndexUnavailable: return "The passkey is saved, but password suggestions could not be updated. Enable Thingtime in AutoFill & Passwords settings, then retry this request."
        case .notConfigured: return "Finish setting up Passwords in this window, then choose Connect Password AutoFill."
        case .invalidCredential: return "This credential does not match the request or is already registered. Review the saved entry in Thingtime Passwords."
        case .unsupportedAlgorithm: return "This site requested a passkey algorithm that Thingtime does not support."
        case .cancelled: return ""
        case .unavailable: return "Password AutoFill could not complete this request. Retry, or open Thingtime Passwords to check the connection."
        }
    }
}
extension Data {
    public var base64URL: String { base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
    public init?(base64URL: String) {
        let text = base64URL.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        self.init(base64Encoded: text + String(repeating: "=", count: (4 - text.count % 4) % 4))
    }
}
