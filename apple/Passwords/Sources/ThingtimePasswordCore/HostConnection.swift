import Foundation

/// Automatic desktop lifecycle work cannot replace another account or an
/// independently linked companion. OS enablement authorizes an initial link;
/// an explicit Disconnect remains an account/origin-scoped opt-out.
public enum PasswordHostConnectionAuthority {
    public static func canDisconnect(_ prior: ProviderSession?, expectedOrigin: URL) -> Bool {
        guard let prior else { return true }
        return prior.companionConnectionID == nil && prior.origin == expectedOrigin
    }
    public static func canSynchronize(_ prior: ProviderSession?, incoming: ProviderSession, providerEnabled: Bool, optedOut: Bool) -> Bool {
        guard !optedOut else { return false }
        guard let prior else { return providerEnabled }
        return prior.companionConnectionID == nil && prior.origin == incoming.origin && prior.ownerId == incoming.ownerId
    }
}
