import Foundation

/// Fixed non-secret status only. Linking a session is not proof of OS indexing.
public enum PasswordConnectionStatus: String, Sendable {
    case synchronized = "index-synchronized"
    case indexPending = "linked-index-pending"
    case disconnected
    public var helperExitCode: Int32 {
        switch self { case .synchronized: return 20; case .indexPending: return 21; case .disconnected: return 22 }
    }
    public func exitCode(detailed: Bool) -> Int32 { detailed ? helperExitCode : 0 }
    public var message: String {
        switch self {
        case .synchronized: return "Account linked and password suggestions synchronized. Enable Thingtime in your device’s AutoFill & Passwords settings."
        case .indexPending: return "Account linked. Password suggestions are not synchronized. Enable Thingtime in your device’s AutoFill & Passwords settings, then retry Connect Password AutoFill."
        case .disconnected: return "Password AutoFill is not connected."
        }
    }
}
/// Call within the serialized identity queue. Never undo a valid account link
/// merely because AutoFill is disabled. Remove stale suggestions best-effort on
/// a failed replace or superseded operation, before a newer queued replace runs.
@MainActor public enum PasswordConnectionSynchronization {
    public static func perform(isCurrent: @MainActor () async throws -> Void,
                               replace: @MainActor () async throws -> Void,
                               clear: @MainActor () async throws -> Void) async throws -> PasswordConnectionStatus {
        try await isCurrent()
        var synchronized = false
        do { try await replace(); synchronized = true } catch { try? await clear() }
        do { try await isCurrent() }
        catch { if synchronized { try? await clear() }; throw error }
        return synchronized ? .synchronized : .indexPending
    }
}
