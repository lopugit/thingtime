import Foundation

/// Only the companion's own WKHTTPCookieStore may supply these cookies. Reject
/// shadow cookies rather than guess which identity the HTTP server would use.
public enum PasswordWebConnectionAuthority {
    public static func cookie(_ cookies: [HTTPCookie], origin: URL, now: Date = Date()) throws -> String {
        guard origin.scheme == "https", let host = origin.host?.lowercased() else { throw PasswordProviderError.invalidSession }
        let candidates = cookies.filter {
            let domain = $0.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
            return $0.name == "tt_auth" && (host == domain || host.hasSuffix("." + domain))
        }
        guard candidates.count == 1, let cookie = candidates.first,
              cookie.domain.lowercased() == host,
              cookie.path == "/", cookie.isSecure, cookie.isHTTPOnly,
              cookie.expiresDate.map({ $0 > now }) ?? true else { throw PasswordProviderError.invalidSession }
        let header = "tt_auth=\(cookie.value)"
        _ = try ProviderSession(origin: origin, ownerId: "pending-verification", cookie: header)
        return header
    }
    public static func session(_ data: Data, origin: URL, cookie: String, expectedOwner: String?) throws -> ProviderSession {
        guard let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              body["ok"] as? Bool == true, let configured = body["configured"] as? Bool,
              let owner = body["ownerId"] as? String, !owner.isEmpty else { throw PasswordProviderError.invalidResponse }
        guard expectedOwner == nil || owner == expectedOwner else { throw PasswordProviderError.accountMismatch }
        guard configured else { throw PasswordProviderError.notConfigured }
        return try ProviderSession(origin: origin, ownerId: owner, cookie: cookie, companionConnectionID: UUID().uuidString.lowercased())
    }
}

/// Single-use native intent. Navigation, Cancel, logout and destination changes
/// invalidate it. A fresh button click must authorize a new attempt.
@MainActor public final class PasswordConnectionIntent {
    private var generation = UUID()
    public init() {}
    public func begin() -> UUID { generation = UUID(); return generation }
    public func cancel() { generation = UUID() }
    public func verify(_ captured: UUID) throws {
        try Task.checkCancellation()
        guard generation == captured else { throw PasswordProviderError.cancelled }
    }
    /// No suspension between the final authority check and protected save.
    public func commit(_ captured: UUID, verifyAuthority: () async throws -> Void, save: () throws -> Void) async throws {
        try verify(captured); try await verifyAuthority(); try verify(captured); try save()
    }
}

/// The CLI serves Electron lifecycle calls. Independent companion connections
/// are changed only by their own explicit native Connect/Disconnect controls.
public enum PasswordHostConnectionAuthority {
    public static func canDisconnect(_ prior: ProviderSession?) -> Bool {
        prior?.companionConnectionID == nil
    }
    public static func canSynchronize(_ prior: ProviderSession?, incoming: ProviderSession) -> Bool {
        guard let prior else { return false }
        return prior.companionConnectionID == nil && prior.origin == incoming.origin && prior.ownerId == incoming.ownerId
    }
}
