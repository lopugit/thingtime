import Foundation

/// Closed, non-sensitive progress and recovery text shared by provider surfaces.
public enum PasswordProviderPhase: String, CaseIterable, Sendable {
    case connection, verification, vault, saving, confirming, indexing, filling

    public var message: String {
        switch self {
        case .connection: return "Checking your Thingtime connection…"
        case .verification: return "Waiting for device verification…"
        case .vault: return "Fetching your saved credentials…"
        case .saving: return "Saving your encrypted passkey…"
        case .confirming: return "Confirming the saved passkey…"
        case .indexing: return "Adding the passkey to Password AutoFill…"
        case .filling: return "Returning your credential to the browser…"
        }
    }

    public func failure(_ error: PasswordProviderError) -> String {
        switch error {
        case .sessionChanged:
            return "Your Thingtime connection changed during this request. Cancel this request, then start again from the website."
        case .invalidSession:
            return "Your Password AutoFill connection is missing, changed, or expired. Open Thingtime → Passwords → Connect Password AutoFill, then try again."
        case .sessionUnavailable:
            return "Thingtime could not access its protected connection on this device. Unlock the device and try again."
        case .cancelled:
            return "Device verification was cancelled. Try again when you are ready."
        case .permissionDenied:
            return "Your account cannot access this password vault. Check the selected account and its access in Thingtime before trying again."
        case .rateLimited:
            return "Thingtime is receiving too many requests. Wait a moment, then try again."
        case .serviceUnavailable:
            return "The Thingtime service is temporarily unavailable. Try again shortly."
        case .incompatibleService:
            return "The connected Thingtime service does not support this password request. Update Thingtime or check the selected service, then reconnect Password AutoFill."
        case .networkUnavailable:
            if self == .saving || self == .confirming {
                return "The connection was interrupted while saving or confirming your passkey. Try again here to continue with the same passkey."
            }
            return "Could not reach Thingtime. Check your connection and try again."
        case .conflict:
            return "The saved entry changed during this request. Retry here to confirm the same passkey; if it still fails, check the entry in Thingtime."
        case .invalidCredential:
            return "This credential cannot be used for this site's request. Check the selected account and site in Thingtime."
        case .unsupportedAlgorithm:
            return "This site's passkey request is not supported. Thingtime supports ES256 passkeys."
        case .invalidResponse:
            return "Thingtime returned an unexpected response. Try again; if it continues, update Thingtime and check the selected service."
        case .unavailable:
            switch self {
            case .verification: return "Device verification could not finish. Unlock your device and try again."
            case .indexing: return "Your passkey is saved, but Password AutoFill could not add it. Enable Thingtime in AutoFill & Passwords settings, then retry here."
            case .saving, .confirming: return "Could not confirm the saved passkey. Retry here to continue with the same passkey."
            default: return "Could not finish this step. Try again; if it continues, open Thingtime and check Password AutoFill."
            }
        }
    }
}

/// Kept in memory for one registration request so uncertain writes never mint
/// another key or operation identity. No credential material belongs in logs.
public struct PasskeyRegistrationAttempt: Sendable {
    public let key: PasskeyMaterial
    public let recordID: String
    public let writeID: String
    public init(relyingParty: String, userHandle: Data, username: String) throws {
        key = try PasskeyMaterial(relyingParty: relyingParty, userHandle: userHandle, username: username)
        recordID = UUID().uuidString.lowercased()
        writeID = UUID().uuidString.lowercased()
    }
    public func matches(_ entry: PasswordEntry) throws -> Bool {
        let confirmed = try PasskeyMaterial(entry: entry)
        return confirmed.credentialID == key.credentialID && confirmed.privateKey == key.privateKey && confirmed.relyingParty == key.relyingParty && confirmed.userHandle == key.userHandle
    }
}

/// One system request at a time. Stale completions cannot clear a newer busy
/// state, and queued clicks cannot start another operation while work is active.
public struct PasswordProviderRequests: Sendable {
    private var token = UUID()
    private var busy = false
    public init() {}
    public mutating func reset() { token = UUID(); busy = false }
    public mutating func start() -> UUID? {
        guard !busy else { return nil }
        token = UUID(); busy = true
        return token
    }
    public func isCurrent(_ candidate: UUID) -> Bool { candidate == token }
    @discardableResult public mutating func finish(_ candidate: UUID) -> Bool {
        guard isCurrent(candidate) else { return false }
        busy = false
        return true
    }
}

/// A registration selected in the OS picker starts once, after presentation.
/// Consuming the pending start is independent of operation completion: a failed
/// attempt or a reappearing view must wait for the person's explicit retry.
public struct PasswordProviderRegistrationStart: Sendable {
    private var pending = false
    private var visible = false
    public init() {}
    public mutating func prepare() { pending = true }
    public mutating func setVisible(_ value: Bool) { visible = value }
    public mutating func reset() { pending = false }
    public mutating func takeStart() -> Bool {
        guard pending && visible else { return false }
        pending = false
        return true
    }
}
