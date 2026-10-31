import CryptoKit
import Foundation
import Security

/// An in-memory, single-use PKCE transaction. No verifier or callback is persisted.
struct WidgetOAuthRequest {
    static let callback = URL(string: "com.thingtime.widgets://oauth/callback")!
    let origin: URL
    let clientID: String
    let verifier: String
    let state: String
    let startedAt: Date
    private(set) var consumed = false

    enum Failure: LocalizedError, Equatable {
        case invalidOrigin, randomUnavailable, invalidCallback, expired, cancelled, alreadyUsed
        var errorDescription: String? {
            switch self {
            case .invalidOrigin: return "Use an HTTPS Thingtime address, or HTTP on your local computer."
            case .randomUnavailable: return "Could not securely start sign-in. Please try again."
            case .invalidCallback: return "The sign-in response did not match this connection. Please try again."
            case .expired: return "Sign-in expired. Please start again."
            case .cancelled: return "Sign-in was cancelled."
            case .alreadyUsed: return "This sign-in response has already been used."
            }
        }
    }

    static func normalizeOrigin(_ value: String) throws -> URL {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let supplied = trimmed.contains("://") ? trimmed : "https://" + trimmed
        guard var parts = URLComponents(string: supplied),
              let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/",
              parts.port == nil || (1...65535).contains(parts.port!),
              parts.scheme == "https" || (parts.scheme == "http" && ["localhost", "127.0.0.1", "[::1]", "::1"].contains(host))
        else { throw Failure.invalidOrigin }
        parts.host = host.lowercased()
        parts.path = ""
        if (parts.scheme == "https" && parts.port == 443) || (parts.scheme == "http" && parts.port == 80) { parts.port = nil }
        guard let origin = parts.url else { throw Failure.invalidOrigin }
        return origin
    }

    init(origin: URL, clientID: String, now: Date = Date()) throws {
        self.origin = try Self.normalizeOrigin(origin.absoluteString)
        self.clientID = clientID
        verifier = try Self.random()
        state = try Self.random()
        startedAt = now
    }

    static func challenge(for verifier: String) -> String {
        base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    var authorizationURL: URL {
        var parts = URLComponents(url: origin.appendingPathComponent("authorize"), resolvingAgainstBaseURL: false)!
        parts.queryItems = [
            URLQueryItem(name: "client_id", value: clientID),
            URLQueryItem(name: "redirect_uri", value: Self.callback.absoluteString),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "code_challenge", value: Self.challenge(for: verifier)),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "scope", value: "profile.username"),
            URLQueryItem(name: "optional_scope", value: "profile.displayName things account.things actions.run lopu.chat lopu.voice lopu.recordings"),
            URLQueryItem(name: "extra", value: "1")
        ]
        return parts.url!
    }

    mutating func consume(_ callback: URL, now: Date = Date()) throws -> [String: String] {
        guard !consumed else { throw Failure.alreadyUsed }
        guard now >= startedAt, now.timeIntervalSince(startedAt) < 300 else {
            consumed = true
            throw Failure.expired
        }
        guard let parts = URLComponents(url: callback, resolvingAgainstBaseURL: false),
              parts.scheme == Self.callback.scheme, parts.host == Self.callback.host,
              parts.path == Self.callback.path, parts.port == nil, parts.user == nil,
              parts.password == nil, parts.fragment == nil else { throw Failure.invalidCallback }
        let items = parts.queryItems ?? []
        guard Set(items.map(\.name)).count == items.count,
              items.allSatisfy({ ["code", "state", "error", "error_description"].contains($0.name) }),
              items.first(where: { $0.name == "state" })?.value == state else { throw Failure.invalidCallback }
        // A matching response ends this attempt, even on denial or malformed code.
        consumed = true
        if items.contains(where: { $0.name == "error" }) { throw Failure.cancelled }
        guard let code = items.first(where: { $0.name == "code" })?.value,
              !code.isEmpty, code.utf8.count <= 4096 else { throw Failure.invalidCallback }
        return ["grantType": "authorization_code", "code": code, "clientId": clientID,
                "redirectUri": Self.callback.absoluteString, "codeVerifier": verifier]
    }

    private static func random() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw Failure.randomUnavailable }
        return base64URL(Data(bytes))
    }
    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}
