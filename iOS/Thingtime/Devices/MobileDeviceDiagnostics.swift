import AppleFileSync
import Foundation
import Network
import UIKit

@MainActor
protocol MobileDeviceDiagnosticsTransporting {
    func status(_ binding: MobileDeviceDiagnosticOutbox.Binding, check: @escaping () throws -> Void) async throws -> Bool
    func append(_ events: [MobileDeviceDiagnosticEvent], binding: MobileDeviceDiagnosticOutbox.Binding,
                check: @escaping () throws -> Void) async throws -> (enabled: Bool, acknowledged: [String])
}

@MainActor
final class MobileDeviceDiagnosticsTransport: MobileDeviceDiagnosticsTransporting {
    enum Failure: Error { case rateLimited(until: Date) }
    private let client: MobileDeviceNodeTransport
    init(client: MobileDeviceNodeTransport) { self.client = client }
    private func checked(_ binding: MobileDeviceDiagnosticOutbox.Binding, _ check: () throws -> Void) throws {
        try check(); try binding.validate()
        guard try client.deviceId(binding.scope) == binding.deviceId else { throw MobileDevicePairing.Failure.identity }
    }
    func status(_ binding: MobileDeviceDiagnosticOutbox.Binding, check: @escaping () throws -> Void) async throws -> Bool {
        do {
        let fence = { try self.checked(binding, check) }
        try await client.negotiate(["api.devices-node-diagnostics": [1, 0, 0]], scope: binding.scope, check: fence)
        let result = try await client.request(binding.scope, "/api/v1/devices/node/diagnostics",
            body: MobileDevicePairing.json(["action": "status"]), check: fence)
        guard let enabled = result["enabled"] as? Bool, let folder = result["folderId"] as? String,
              folder.hasPrefix("device-debug-") else { throw MobileDevicePairing.Failure.invalid }
        return enabled
        } catch MobileDeviceNodeTransport.Failure.http(429, _) {
            throw Failure.rateLimited(until: client.retryAfter ?? Date().addingTimeInterval(60))
        }
    }
    func append(_ events: [MobileDeviceDiagnosticEvent], binding: MobileDeviceDiagnosticOutbox.Binding,
                check: @escaping () throws -> Void) async throws -> (enabled: Bool, acknowledged: [String]) {
        do {
        struct Body: Encodable { let action = "append"; let events: [MobileDeviceDiagnosticEvent] }
        for event in events { try event.validate() }
        let body = try JSONEncoder().encode(Body(events: events))
        guard body.count <= 64 * 1024 else { throw MobileDeviceNodeTransport.Failure.http(413, "DIAGNOSTIC_BATCH") }
        let result = try await client.request(binding.scope, "/api/v1/devices/node/diagnostics", body: body,
            check: { try self.checked(binding, check) })
        guard let enabled = result["enabled"] as? Bool, let ids = result["acknowledgedEventIds"] as? [String],
              let folder = result["folderId"] as? String, folder.hasPrefix("device-debug-"),
              Set(ids).count == ids.count, Set(ids).isSubset(of: Set(events.map(\.eventId))),
              enabled ? !ids.isEmpty : ids.isEmpty else { throw MobileDevicePairing.Failure.invalid }
        return (enabled, ids)
        } catch MobileDeviceNodeTransport.Failure.http(429, _) {
            throw Failure.rateLimited(until: client.retryAfter ?? Date().addingTimeInterval(60))
        }
    }
}

/// Best-effort diagnostics never own a background execution lease or fail sync.
/// Disk envelopes and every callback retain the exact owner, origin and device.
@MainActor
final class MobileDeviceDiagnostics {
    typealias Binding = MobileDeviceDiagnosticOutbox.Binding
    typealias Event = MobileDeviceDiagnosticEvent
    typealias Recorder = @MainActor (Event) -> Void
    struct SavedState: Codable {
        var binding: Binding?
        var disabledBindings: Set<String> = []
        var retryAt: Date?
        var serverRetryAt: Date?
        var failures: Int = 0
    }
    static let shared = MobileDeviceDiagnostics()
    private let outbox: MobileDeviceDiagnosticOutbox
    private let transport: any MobileDeviceDiagnosticsTransporting
    private let load: () -> SavedState?
    private let save: (SavedState) -> Void
    private let now: () -> Date
    private let automaticRetries: Bool
    private var saved = SavedState()
    private var generation = UUID()
    private var started = false
    private var work: Task<Void, Never>?
    private var workID: UUID?
    private var retry: Task<Void, Never>?
    private var monitor: NWPathMonitor?
    private var pathAvailable: Bool?
    private var samples: [String: Date] = [:]
    private var lastVerifiedPolicy: Date?
    private(set) var localStorageUnavailable = false

    convenience init() {
        let root = URL.applicationSupportDirectory.appendingPathComponent("MobileDeviceDiagnostics", isDirectory: true)
        let key = "thingtime.device-diagnostics.v1"
        self.init(outbox: .init(root: root), transport: MobileDeviceDiagnosticsTransport(client: .make()), load: {
            UserDefaults.standard.data(forKey: key).flatMap { try? JSONDecoder().decode(SavedState.self, from: $0) }
        }, save: { value in
            if let data = try? JSONEncoder().encode(value) { UserDefaults.standard.set(data, forKey: key) }
        })
    }
    init(outbox: MobileDeviceDiagnosticOutbox, transport: any MobileDeviceDiagnosticsTransporting,
         load: @escaping () -> SavedState? = { nil }, save: @escaping (SavedState) -> Void = { _ in },
         now: @escaping () -> Date = Date.init, automaticRetries: Bool = true) {
        self.outbox = outbox; self.transport = transport; self.load = load; self.save = save
        self.now = now; self.automaticRetries = automaticRetries
    }
    deinit { monitor?.cancel(); work?.cancel(); retry?.cancel() }
    func activate() {
        guard !started else { return }; started = true
        if let prior = load(), prior.binding == nil || (try? prior.binding?.validate()) != nil { saved = prior }
        if automaticRetries {
            let monitor = NWPathMonitor(); self.monitor = monitor
            monitor.pathUpdateHandler = { [weak self] path in
                let available = path.status == .satisfied
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    let recovered = available && self.pathAvailable == false; self.pathAvailable = available
                    if recovered { self.retryNow() }
                }
            }
            monitor.start(queue: DispatchQueue(label: "com.thingtime.device-diagnostics.network"))
        }
        lifecycle(.appStarted); flush()
    }
    /// Called only after normal account and paired-device verification.
    func verified(_ scope: FileSyncOwnerScope, deviceId: String) {
        activate()
        let binding = Binding(scope: scope, deviceId: deviceId)
        guard (try? binding.validate()) != nil else { return }
        if saved.binding != binding {
            cancelWork(); saved.binding = binding; saved.retryAt = nil; saved.serverRetryAt = nil; saved.failures = 0
            samples.removeAll(); lastVerifiedPolicy = nil; save(saved)
            lifecycle(.appStarted)
            retryNow()
        } else {
            flush()
        }
    }
    func suspendAuthorization(matching scope: FileSyncOwnerScope? = nil) {
        if let scope, saved.binding?.scope != scope { return }
        cancelWork(); saved.binding = nil; saved.retryAt = nil; saved.serverRetryAt = nil; saved.failures = 0
        lastVerifiedPolicy = nil; samples.removeAll(); save(saved)
    }
    private func cancelWork() {
        generation = UUID(); work?.cancel(); work = nil; workID = nil; retry?.cancel(); retry = nil
    }
    /// A stale run cannot acquire a recorder for a replacement device pairing.
    func recorder(for scope: FileSyncOwnerScope, expectedDeviceId: String) -> Recorder? {
        guard let binding = saved.binding, binding.scope == scope, binding.deviceId == expectedDeviceId else { return nil }
        let token = generation
        return { [weak self] event in
            guard let self, self.generation == token, self.saved.binding == binding else { return }
            self.capture(event, binding: binding)
        }
    }
    private func capture(_ event: Event, binding: Binding) {
        guard !saved.disabledBindings.contains(binding.key) else { return }
        if event.code == .snapshot {
            let key = [event.configurationId, event.runKey, event.phase?.rawValue, event.reason?.rawValue,
                       event.failureOperation?.rawValue, event.state.rawValue].map { $0 ?? "" }.joined(separator: "|")
            if let last = samples[key], now().timeIntervalSince(last) < 10 { return }
            samples[key] = now()
            // This is a sampling cache, not event retention. Drop expired keys.
            samples = samples.filter { now().timeIntervalSince($0.value) < 10 }
        }
        do { try outbox.append(event, binding: binding); localStorageUnavailable = false }
        catch { localStorageUnavailable = true; return }
        flush()
    }
    private func lifecycle(_ code: Event.Code) {
        guard let binding = saved.binding else { return }
        capture(.init(category: .lifecycle, level: .info, code: code, state: .idle, at: now()), binding: binding)
    }
    func foreground() { activate(); lifecycle(.appForeground); retryNow() }
    func background() { lifecycle(.appBackground); flush() }
    private func retryNow() {
        // Foreground/network recovery may retry a transient outage immediately,
        // but never bypass a deadline required by the selected server.
        saved.retryAt = saved.serverRetryAt.flatMap { $0 > now() ? $0 : nil }
        lastVerifiedPolicy = nil; retry?.cancel(); retry = nil; save(saved); flush()
    }
    func flush() {
        guard work == nil, let binding = saved.binding else { return }
        if let at = saved.retryAt, at > now() { scheduleRetry(); return }
        let token = generation, id = UUID(); workID = id
        work = Task { [weak self] in
            guard let self else { return }
            let check = { [weak self] in
                guard let self, self.generation == token, self.saved.binding == binding else { throw MobileDevicePairing.Failure.identity }
                try Task.checkCancellation()
            }
            do {
                try check()
                if self.lastVerifiedPolicy == nil || self.now().timeIntervalSince(self.lastVerifiedPolicy!) >= 30 {
                    let enabled = try await self.transport.status(binding, check: check)
                    try check(); self.lastVerifiedPolicy = self.now()
                    if !enabled { try self.disable(binding); self.finish(id); return }
                    self.saved.disabledBindings.remove(binding.key); self.save(self.saved)
                }
                var batchSize = 32
                // Yield after bounded work; this never truncates saved history.
                for _ in 0..<50 {
                    try check()
                    let batch = try self.outbox.next(binding: binding, batchSize: batchSize)
                    if batch.isEmpty {
                        self.saved.failures = 0; self.saved.retryAt = nil; self.saved.serverRetryAt = nil
                        self.save(self.saved); self.finish(id); return
                    }
                    do {
                        let response = try await self.transport.append(batch.map(\.event), binding: binding, check: check)
                        try check()
                        if !response.enabled { try self.disable(binding); self.finish(id); return }
                        try self.outbox.acknowledge(response.acknowledged, from: batch, binding: binding)
                        batchSize = 32
                    } catch MobileDeviceNodeTransport.Failure.http(let status, let code) {
                        try check()
                        let rejected = (status == 403 && code == "DIAGNOSTIC_CONFIGURATION") ||
                            (status == 409 && code == "DIAGNOSTIC_CONFLICT") || (status == 400 && code == "INVALID_DIAGNOSTIC") || status == 413
                        guard rejected else { throw MobileDeviceNodeTransport.Failure.http(status, code) }
                        if batch.count > 1 { batchSize = max(1, batch.count / 2) }
                        else { try self.outbox.quarantine(batch[0]); batchSize = 32 }
                    }
                    await Task.yield()
                }
                self.saved.retryAt = self.now().addingTimeInterval(1); self.save(self.saved)
            } catch {
                guard self.generation == token, self.saved.binding == binding, !Task.isCancelled else { self.finish(id); return }
                if case MobileDevicePairing.Failure.revoked = error { self.suspendAuthorization(matching: binding.scope); return }
                if case MobileDevicePairing.Failure.identity = error { self.suspendAuthorization(matching: binding.scope); return }
                self.saved.failures = min(6, max(0, self.saved.failures) + 1)
                self.saved.retryAt = self.now().addingTimeInterval(min(900, 30 * pow(2, Double(self.saved.failures - 1))))
                if case MobileDeviceDiagnosticsTransport.Failure.rateLimited(let until) = error {
                    self.saved.serverRetryAt = until
                    self.saved.retryAt = max(until, self.saved.retryAt!)
                }
                self.save(self.saved)
            }
            self.finish(id); self.scheduleRetry()
        }
    }
    private func disable(_ binding: Binding) throws {
        saved.disabledBindings.insert(binding.key); saved.retryAt = nil; saved.serverRetryAt = nil; saved.failures = 0; save(saved)
        try outbox.clear(binding: binding)
    }
    private func finish(_ id: UUID) { if workID == id { work = nil; workID = nil } }
    private func scheduleRetry() {
        guard automaticRetries, retry == nil, saved.binding != nil, let at = saved.retryAt else { return }
        let delay = max(1, min(900, at.timeIntervalSince(now()))), token = generation
        retry = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(delay)) } catch { return }
            guard let self, self.generation == token else { return }
            self.retry = nil; self.flush()
        }
    }
    /// Tests and an existing granted execution window may await delivery. This
    /// does not request time, override backoff, or throw into the sync worker.
    func flushAndWait() async { flush(); await work?.value }
}
