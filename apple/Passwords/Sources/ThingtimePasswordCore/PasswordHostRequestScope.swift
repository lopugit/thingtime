import Foundation

/// Shared, credential-free authority checks for a containing app's web bridge.
public enum PasswordHostRequestScope {
    public static func permits(root: URL, page: URL, frame: URL, securityScheme: String, securityHost: String, securityPort: Int) -> Bool {
        root.scheme == "https" && permitsTransport(root: root, page: page, frame: frame, securityScheme: securityScheme, securityHost: securityHost, securityPort: securityPort)
    }
    public static func permitsTransport(root: URL, page: URL, frame: URL, securityScheme: String, securityHost: String, securityPort: Int) -> Bool {
        guard root.scheme == "https" || (root.scheme == "http" && ["localhost", "127.0.0.1", "::1", "[::1]"].contains(root.host?.lowercased() ?? "")), root.host != nil, root.user == nil, root.password == nil,
              root.query == nil, root.fragment == nil, root.path.isEmpty || root.path == "/" else { return false }
        func same(_ value: URL) -> Bool {
            value.scheme == root.scheme && value.host?.lowercased() == root.host?.lowercased()
                && (value.port ?? (value.scheme == "https" ? 443 : 80)) == (root.port ?? (root.scheme == "https" ? 443 : 80)) && value.user == nil && value.password == nil
        }
        return same(page) && same(frame) && securityScheme == root.scheme && securityHost.lowercased() == root.host?.lowercased()
            && (securityPort == 0 ? (root.scheme == "https" ? 443 : 80) : securityPort) == (root.port ?? (root.scheme == "https" ? 443 : 80))
    }
    /// Reject ambiguous cookies. A narrower unrelated-path tt_auth must not
    /// shadow the one used for the canonical account API.
    public static func authenticationCookie(_ cookies: [HTTPCookie], origin: URL, now: Date = Date()) throws -> String {
        guard origin.scheme == "https", let host = origin.host?.lowercased() else { throw PasswordProviderError.invalidSession }
        let matches = cookies.filter { cookie in
            let domain = cookie.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
            return cookie.name == "tt_auth" && cookie.isSecure && cookie.isHTTPOnly && cookie.path == "/"
                && (host == domain || (cookie.domain.hasPrefix(".") && host.hasSuffix("." + domain)))
                && (cookie.expiresDate.map { $0 > now } ?? true)
        }
        guard matches.count == 1 else { throw PasswordProviderError.invalidSession }
        return "tt_auth=" + matches[0].value
    }
}

/// The ordering here matters: a same-document account switch can happen while
/// WebKit evaluates the document check. Read cookies last, then compare native
/// lifecycle authority synchronously immediately before a caller commits.
@MainActor public enum PasswordHostCommitFence {
    public static func verify(expected: ProviderSession, generation: UUID,
                              checkDocument: () async throws -> Void,
                              cookies: () async -> [HTTPCookie],
                              currentGeneration: () -> UUID,
                              destinationIsCurrent: () -> Bool) async throws {
        try await checkDocument()
        let latest = await cookies()
        guard !Task.isCancelled, currentGeneration() == generation, destinationIsCurrent(),
              (try? PasswordHostRequestScope.authenticationCookie(latest, origin: expected.origin)) == expected.cookie else {
            throw PasswordProviderError.sessionChanged
        }
    }
}

/// WKScriptMessage preserves JavaScript undefined/null differently from JSON
/// transports. Only ownerId may be absent/null; correlation and action stay typed.
public struct PasswordHostBridgeRequest {
    public let action: String
    public let ownerId: String
    public let requestId: String
    public let documentNonce: String
    public init?(_ payload: [String: Any]) {
        guard let action = payload["action"] as? String, ["connect", "sync", "disconnect", "status"].contains(action),
              let request = payload["requestId"] as? String, UUID(uuidString: request) != nil,
              let document = payload["documentNonce"] as? String, UUID(uuidString: document) != nil else { return nil }
        if let value = payload["ownerId"], !(value is NSNull) {
            guard let owner = value as? String else { return nil }
            ownerId = owner
        } else { ownerId = "" }
        self.action = action; requestId = request; documentNonce = document
    }
}

/// Preserve one logout signal that arrives after a host save while its system
/// identity-index callback is still pending. Other busy requests get a reply.
@MainActor public final class PasswordHostRetirementQueue {
    private var pending: (() -> Void)?
    public init() {}
    public func enqueue(_ work: @escaping () -> Void) -> Bool {
        guard pending == nil else { return false }
        pending = work; return true
    }
    public func drain() { let work = pending; pending = nil; work?() }
    public func cancel() { pending = nil }
}
