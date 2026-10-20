import CryptoKit
import Foundation

/// Scheduling only: permits never contain or reuse an authorization response.
actor FileSyncIdentityAdmission {
    static let shared = FileSyncIdentityAdmission()
    struct Permit: Sendable { let scope: String; let id: UUID }
    enum Failure: Error { case capacity, timer }
    private struct Waiter {
        let id: UUID
        let continuation: CheckedContinuation<Permit, Error>
    }
    private struct Scope {
        var active: UUID?
        var sent = false
        var queue: [Waiter] = []
        var nextStart = 0.0
        var cooldown = 0.0
        var used = 0.0
        var wake: Task<Void, Never>?
        var generation = UUID()
    }
    private let now: @Sendable () -> Double
    private let sleep: @Sendable (Double) async throws -> Void
    private let maximumScopes: Int
    private let maximumWaiters: Int
    private var scopes: [String: Scope] = [:]
    private var waiting = 0
    var queuedForTesting: Int { waiting }

    init(now: @escaping @Sendable () -> Double = { ProcessInfo.processInfo.systemUptime },
         sleep: @escaping @Sendable (Double) async throws -> Void = { seconds in
             try await Task.sleep(for: .seconds(seconds))
         }, maximumScopes: Int = 64, maximumWaiters: Int = 128) {
        self.now = now; self.sleep = sleep
        self.maximumScopes = maximumScopes; self.maximumWaiters = maximumWaiters
    }

    static func scope(origin: URL, credential: DeviceCredential) -> String {
        // Only an opaque digest is retained; no token, owner or device is logged.
        let scheme = origin.scheme!.lowercased(), host = origin.host!.lowercased()
        let port = origin.port ?? (scheme == "https" ? 443 : 80)
        let parts = [scheme, host, String(port), credential.deviceID, credential.refreshToken]
        var data = Data()
        for part in parts { data.append(contentsOf: String(part.utf8.count).utf8); data.append(0); data.append(contentsOf: part.utf8) }
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    func acquire(_ key: String) async throws -> Permit {
        try Task.checkCancellation()
        let time = now()
        // Never evict an active scope or a still-live pacing/cooldown deadline.
        for (key, state) in scopes where state.active == nil && state.queue.isEmpty &&
            max(state.nextStart, state.cooldown) <= time && time - state.used >= 300 {
            state.wake?.cancel(); scopes.removeValue(forKey: key)
        }
        if scopes[key] == nil, scopes.count >= maximumScopes {
            if let idle = scopes.filter({ $0.value.active == nil && $0.value.queue.isEmpty &&
                max($0.value.nextStart, $0.value.cooldown) <= time }).min(by: { $0.value.used < $1.value.used }) {
                idle.value.wake?.cancel(); scopes.removeValue(forKey: idle.key)
            } else { throw Failure.capacity }
        }
        guard waiting < maximumWaiters else { throw Failure.capacity }
        let id = UUID()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                var state = scopes[key] ?? Scope()
                state.queue.append(Waiter(id: id, continuation: continuation)); state.used = now()
                scopes[key] = state; waiting += 1; schedule(key)
            }
        } onCancel: { Task { await self.cancel(key, id: id) } }
    }

    /// Called after the credential is reloaded, immediately before fresh HTTP.
    func willSend(_ permit: Permit) throws {
        guard var state = scopes[permit.scope], state.active == permit.id else { throw CancellationError() }
        state.nextStart = now() + 0.334
        state.sent = true
        state.used = now(); scopes[permit.scope] = state
    }

    func finish(_ permit: Permit, cooldownSeconds: Int? = nil) {
        guard var state = scopes[permit.scope], state.active == permit.id else { return }
        // Space from completion as well: a caller can be descheduled between
        // willSend and URLSession. Completion is necessarily after its actual
        // HTTP start, so that scheduler race cannot create a later burst.
        if state.sent { state.nextStart = max(state.nextStart, now() + 0.334) }
        state.sent = false
        if let seconds = cooldownSeconds, (1...86_400).contains(seconds) {
            state.cooldown = max(state.cooldown, now() + Double(seconds))
        }
        state.active = nil; state.used = now(); scopes[permit.scope] = state; schedule(permit.scope)
    }

    private func cancel(_ key: String, id: UUID) {
        guard var state = scopes[key], let index = state.queue.firstIndex(where: { $0.id == id }) else { return }
        let waiter = state.queue.remove(at: index); waiting -= 1; scopes[key] = state
        waiter.continuation.resume(throwing: CancellationError()); schedule(key)
    }

    private func wake(_ key: String, generation: UUID) {
        guard scopes[key]?.generation == generation else { return }
        scopes[key]?.wake = nil; schedule(key)
    }

    private func wakeFailed(_ key: String, generation: UUID) {
        guard var state = scopes[key], state.generation == generation, state.active == nil else { return }
        // A replaced timer must not affect its successor. An unexpected failure
        // of the current timer fails closed without retaining stranded callers
        // or discarding the server's cooldown.
        let waiters = state.queue
        state.queue.removeAll(); state.wake = nil; state.used = now()
        waiting -= waiters.count; scopes[key] = state
        for waiter in waiters { waiter.continuation.resume(throwing: Failure.timer) }
    }

    private func schedule(_ key: String) {
        guard var state = scopes[key], state.active == nil else { return }
        state.wake?.cancel(); state.wake = nil
        guard !state.queue.isEmpty else { scopes[key] = state; return }
        let delay = max(state.nextStart, state.cooldown) - now()
        if delay > 0 {
            let generation = UUID(); state.generation = generation
            state.wake = Task {
                do { try await sleep(delay); try Task.checkCancellation(); self.wake(key, generation: generation) }
                catch { self.wakeFailed(key, generation: generation) }
            }
            scopes[key] = state; return
        }
        let waiter = state.queue.removeFirst(); waiting -= 1; state.active = waiter.id
        state.used = now(); scopes[key] = state
        waiter.continuation.resume(returning: Permit(scope: key, id: waiter.id))
    }
}
