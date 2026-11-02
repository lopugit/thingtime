import Foundation

/// An inbound setup URI is untrusted data, never a navigation destination.
public struct AuthenticatorSetup: Equatable, Sendable {
    public let uri: String
    public init(_ input: String) throws {
        guard let parts = URLComponents(string: input), parts.scheme == "otpauth", parts.host == "totp",
              parts.user == nil, parts.password == nil, parts.port == nil, parts.fragment == nil,
              !parts.path.dropFirst().isEmpty, parts.path.hasPrefix("/"),
              !input.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { throw PasswordProviderError.invalidCredential }
        let items = parts.queryItems ?? []
        let allowed: Set<String> = ["secret", "issuer", "algorithm", "digits", "period"]
        guard Set(items.map(\.name)).count == items.count,
              items.allSatisfy({ allowed.contains($0.name) && $0.value != nil }),
              let secret = items.first(where: { $0.name == "secret" })?.value, !secret.isEmpty else { throw PasswordProviderError.invalidCredential }
        let normalized = secret.uppercased()
        guard normalized.range(of: "^[A-Z2-7]+={0,6}$", options: .regularExpression) != nil else { throw PasswordProviderError.invalidCredential }
        let unpadded = normalized.prefix { $0 != "=" }
        let padding = normalized.count - unpadded.count
        let expectedPadding = [0: 0, 2: 6, 4: 4, 5: 3, 7: 1][unpadded.count % 8]
        guard let expectedPadding, padding == 0 || padding == expectedPadding else { throw PasswordProviderError.invalidCredential }
        // Reuse the actual provider's parameter/Base32 validation. This computes
        // locally and neither fetches the URI nor persists the seed.
        _ = try TOTP.code(input, at: Date(timeIntervalSince1970: 0))
        uri = input
    }
}

/// One memory-only pending setup. No Codable, UserDefaults or restoration path.
public struct AuthenticatorSetupInbox {
    public struct Binding: Equatable, Sendable {
        public let owner: String
        public let nonce: String
        public let generation: UUID
        public init(owner: String, nonce: String, generation: UUID) { self.owner = owner; self.nonce = nonce; self.generation = generation }
    }
    public private(set) var requestID: UUID?
    public private(set) var binding: Binding?
    private var pending: AuthenticatorSetup?
    private var offeredAt: Date?
    public init() {}
    public mutating func offer(_ input: String, now: Date = Date()) throws -> Bool {
        expire(now)
        guard pending == nil else { return false }
        pending = try AuthenticatorSetup(input); requestID = UUID(); offeredAt = now
        return true
    }
    public mutating func bind(_ value: Binding, expectedOwner: String?, dataPlane: String, now: Date = Date()) -> UUID? {
        expire(now)
        guard pending != nil, !value.owner.isEmpty, UUID(uuidString: value.nonce) != nil,
              dataPlane == "home", expectedOwner == nil || expectedOwner == value.owner else { return nil }
        if let prior = binding, prior != value { cancel(); return nil }
        binding = value; return requestID
    }
    public mutating func consume(_ id: UUID, binding value: Binding, now: Date = Date()) -> AuthenticatorSetup? {
        expire(now)
        guard id == requestID, value == binding else { return nil }
        let result = pending; cancel(); return result
    }
    public mutating func navigationStarted() {
        // A setup received before normal login survives the login navigation;
        // once assigned to a verified owner/document it must never migrate.
        if binding != nil { cancel() }
    }
    public mutating func cancel() { pending = nil; requestID = nil; binding = nil; offeredAt = nil }
    private mutating func expire(_ now: Date) { if let offeredAt, now.timeIntervalSince(offeredAt) > 600 || now < offeredAt { cancel() } }
}

/// Pure context gate used by the WebKit adapter as well as security tests.
public enum AuthenticatorSetupPage {
    public static func permits(root: URL, page: URL?, frame: URL?, isMainFrame: Bool, securityScheme: String, securityHost: String, securityPort: Int) -> Bool {
        guard root.scheme == "https", root.host != nil, root.user == nil, root.password == nil,
              root.query == nil, root.fragment == nil, root.path.isEmpty || root.path == "/", isMainFrame,
              let page, let frame else { return false }
        func matches(_ url: URL) -> Bool {
            url.scheme == root.scheme && url.host?.lowercased() == root.host?.lowercased() && (url.port ?? 443) == (root.port ?? 443) && url.user == nil && url.password == nil && url.path == "/passwords" && url.query == nil && url.fragment == nil
        }
        return matches(page) && matches(frame) && securityScheme == root.scheme && securityHost.lowercased() == root.host?.lowercased() && (securityPort == 0 ? 443 : securityPort) == (root.port ?? 443)
    }
}

public enum AuthenticatorSetupCapability {
    public static func accepts(_ version: String) -> Bool {
        guard version.range(of: "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$", options: .regularExpression) != nil else { return false }
        let parts = version.split(separator: ".")
        guard parts[0] == "1", let minor = Int(parts[1]) else { return false }
        return minor >= 2
    }
}

/// Used immediately before sending, and mirrored by an execution-time JS guard
/// in the captured frame. Navigation invalidates the generation even if the next
/// document returns to the same origin/path.
public enum AuthenticatorSetupDeliveryGate {
    public static func permits(capturedGeneration: UUID, currentGeneration: UUID, capturedDocument: String, currentDocument: String?) -> Bool {
        capturedGeneration == currentGeneration && capturedDocument == currentDocument && UUID(uuidString: capturedDocument) != nil
    }
}

/// Responses from the existing password metadata API, not an authentication
/// exchange. The adapter separately enforces HTTPS, status and no redirects.
public enum AuthenticatorSetupAuthority {
    public static func manifest(_ data: Data, origin: URL) -> Bool {
        guard let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any], body["schemaVersion"] as? Int == 1,
              body["origin"] as? String == origin.absoluteString,
              let features = body["features"] as? [String: [String: Any]], let version = features["api.passwords"]?["version"] as? String else { return false }
        return AuthenticatorSetupCapability.accepts(version)
    }
    public static func owner(_ data: Data, expected: String) -> Bool {
        guard !expected.isEmpty, let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        return body["ok"] as? Bool == true && body["configured"] as? Bool == true && body["ownerId"] as? String == expected
    }
}
