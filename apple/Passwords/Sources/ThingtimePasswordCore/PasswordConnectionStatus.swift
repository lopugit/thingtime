import Foundation

/// A read-only, non-secret description of this device's saved connection.
/// This does not claim that the OS AutoFill provider is enabled or that a
/// remote service is reachable. Session-cookie rotation keeps the same link.
public enum PasswordConnectionStatus: String, Codable, Sendable {
    case connected, disconnected, differentSession, unavailable

    public static func current(for expected: ProviderSession) -> Self {
        resolve(for: expected, load: PasswordSessionStore.loadIfPresent)
    }

    static func resolve(for expected: ProviderSession, load: () throws -> ProviderSession?) -> Self {
        do {
            guard let saved = try load() else { return .disconnected }
            return saved.ownerId == expected.ownerId && saved.origin == expected.origin ? .connected : .differentSession
        } catch { return .unavailable }
    }
}
