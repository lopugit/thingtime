import AppleFileSync
import Foundation

/// Only negotiated Photos startup controls borrow this lane. Its identities
/// never own the serialized folder scanner/upload transport or its cleanup.
@MainActor
final class MobileFolderControlRequests {
    struct Token: Equatable {
        let requestId: String
        let operation = UUID()
        let scope: FileSyncOwnerScope
        let action: String
        let configurationId: String?
    }
    private struct Entry {
        let token: Token
        let cancelled: (MobileFolderBridge.Suspension) -> Void
        var task: Task<Void, Never>?
    }
    private var entries: [String: Entry] = [:]
    static func supports(_ action: String) -> Bool { ["list", "photo-run-status", "wake-photo-run"].contains(action) }
    func begin(requestId: String, scope: FileSyncOwnerScope, action: String, configurationId: String?,
               cancelled: @escaping (MobileFolderBridge.Suspension) -> Void) -> Token? {
        guard Self.supports(action), entries[requestId] == nil else { return nil }
        let token = Token(requestId: requestId, scope: scope, action: action, configurationId: configurationId)
        entries[requestId] = Entry(token: token, cancelled: cancelled)
        return token
    }
    func attach(_ task: Task<Void, Never>, to token: Token) {
        guard isCurrent(token) else { task.cancel(); return }
        entries[token.requestId]?.task = task
    }
    func contains(_ requestId: String) -> Bool { entries[requestId] != nil }
    func isCurrent(_ token: Token) -> Bool { entries[token.requestId]?.token == token }
    @discardableResult func finish(_ token: Token) -> Bool {
        guard isCurrent(token) else { return false }
        entries.removeValue(forKey: token.requestId); return true
    }
    @discardableResult func cancel(_ requestId: String, reason: MobileFolderBridge.Suspension) -> Bool {
        guard let entry = entries.removeValue(forKey: requestId) else { return false }
        entry.task?.cancel(); entry.cancelled(reason); return true
    }
    func verified(_ scope: FileSyncOwnerScope) {
        for entry in Array(entries.values) where entry.token.scope != scope {
            cancel(entry.token.requestId, reason: .contextChanged)
        }
    }
    func cancelWakes(scope: FileSyncOwnerScope, configurationId: String? = nil) {
        for entry in Array(entries.values) where entry.token.scope == scope && entry.token.action == "wake-photo-run" &&
            (configurationId == nil || configurationId == entry.token.configurationId) {
            cancel(entry.token.requestId, reason: .requestCancelled)
        }
    }
    func cancelAll(_ reason: MobileFolderBridge.Suspension) {
        for id in Array(entries.keys) { cancel(id, reason: reason) }
    }
}
