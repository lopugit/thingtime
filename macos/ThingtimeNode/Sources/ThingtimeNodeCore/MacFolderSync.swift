import AppleFileSync
import Foundation

/// Local signed-host adapter. It is deliberately separate from remotely leased
/// commands. The desktop host must also verify its active browser account.
@MainActor
public final class MacFolderSync {
    public static let version = "1.11.0"
    public enum SourceSelection { case folder(URL), photos }
    public struct Conditions: Codable, Sendable {
        public let network: String
        public let charging: Bool?
        public init(network: String, charging: Bool?) { self.network = network; self.charging = charging }
        private enum CodingKeys: String, CodingKey { case network, charging }
        public func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(network, forKey: .network)
            try container.encode(charging, forKey: .charging)
        }
    }
    private struct Request: Decodable {
        let requestId: String; let ownerId: String; let deviceId: String; let origin: String; let action: String
        let excludedPaths: [String]?
        let ignoreRules: String?
        let capturePolicy: String?
        let pageSize: Int?
        let afterSequence: Int?; let waitMilliseconds: Int?
        let rootId: String?; let path: String?; let version: String?; let offset: Int64?; let length: Int?; let data: String?
        let transfer: MobileSyncStaging.Request?; let stage: MobileSyncStaging.Stage?; let approval: MobileFolderStore.WriteApproval?
        let captureId: String?; let capture: MobileFolderInventory.Capture?; let inventoryDeviceId: String?
        let trash: MobileSyncTrash.Request?; let restore: MobileSyncTrash.Restore?; let cursor: String?
    }
    private let origin: URL
    private let store: MobileFolderStore
    private let inventories: MobileFolderInventory
    private let staging: MobileSyncStaging
    private let trash: MobileSyncTrash?
    private let verify: (String, String) async throws -> Void
    private let choose: () async throws -> URL?
    private let chooseSource: (() async throws -> SourceSelection?)?
    private let photos: PhotoLibraryReader
    private let approve: (MobileFolderStore.Grant) async throws -> Bool
    private let approveTrash: ((MobileFolderStore.Grant) async throws -> Bool)?
    private let approveRestore: ((MobileFolderStore.Grant, MobileSyncTrash.Restore) async throws -> Bool)?
    private let cancelDialog: () -> Void
    private let conditions: () -> Conditions
    private typealias RequestTask = (id: String, owner: String, device: String, task: Task<JSONValue, Error>)
    private var active: RequestTask?
    private var streamWaiter: RequestTask?

    /// One task-owned scanner, 64 KiB read buffers, existing eight-capture disk
    /// retention and a 24-hour execution lifetime. Transport failures do not
    /// cancel it; explicit cancel, authority loss or lifetime expiry do.
    public static let maximumBackupJobSeconds: TimeInterval = 24 * 60 * 60
    // Testable timing only; production keeps one scanner and one sequential
    // monitor, with no queued verification attempts or unbounded retry tasks.
    var backupMonitorInterval: Duration = .seconds(15)
    var backupLifetime: TimeInterval = maximumBackupJobSeconds
    var backupNow: () -> Date = Date.init
    var backupRetrySleep: (Duration) async throws -> Void = { try await Task.sleep(for: $0) }

    nonisolated static func identityVerificationIsTransient(_ error: Error) -> Bool {
        if let network = error as? URLError {
            switch network.code {
            case .timedOut, .cannotFindHost, .cannotConnectToHost, .networkConnectionLost,
                 .dnsLookupFailed, .notConnectedToInternet: return true
            default: return false
            }
        }
        if case ThingtimeAPIClientError.rejected(let status) = error {
            return status == 408 || status == 429 || (500...599).contains(status)
        }
        return false
    }

    private func checkBackupAuthority(scope: MobileFolderInventory.Scope, grant: MobileFolderStore.Grant, started: Date) throws {
        try Task.checkCancellation()
        guard backupNow().timeIntervalSince(started) < backupLifetime,
              try store.grant(scope.owner, id: grant.id).bookmark == grant.bookmark else { throw MobileFolderStore.Failure.changed }
    }

    private func awaitBackupAuthorization(scope: MobileFolderInventory.Scope, grant: MobileFolderStore.Grant, started: Date) async throws {
        var delay = 5
        while true {
            try checkBackupAuthority(scope: scope, grant: grant, started: started)
            do {
                try await verify(scope.owner.ownerId, scope.deviceId)
                try checkBackupAuthority(scope: scope, grant: grant, started: started)
                return
            } catch {
                try checkBackupAuthority(scope: scope, grant: grant, started: started)
                guard Self.identityVerificationIsTransient(error) else { throw error }
                ThingtimeNodeLog.actions.error("Backup authorization waiting: phase=seal code=\(Self.backupDiagnosticCode(error), privacy: .public)")
                try await backupRetrySleep(.seconds(delay))
                delay = min(delay * 2, 60)
            }
        }
    }
    // Diagnostics deliberately exclude localized descriptions, URL userInfo,
    // filenames, account IDs and native bookmark data.
    static func backupDiagnosticCode(_ error: Error) -> String {
        if error is CancellationError { return "cancelled" }
        if let network = error as? URLError { return "network-" + String(network.code.rawValue) }
        if let api = error as? ThingtimeAPIClientError {
            switch api {
            case .rejected(let status): return "identity-http-" + String(status)
            case .notPaired: return "identity-not-paired"
            case .incompatibleCapabilities: return "identity-capabilities"
            default: return "identity-response"
            }
        }
        if let source = error as? MobileFolderStore.Failure {
            switch source {
            case .unavailable: return "source-unavailable"
            case .invalid: return "source-invalid"
            case .limit: return "source-limit"
            case .changed: return "source-changed"
            case .storage: return "local-storage"
            case .approvalCancelled: return "approval-cancelled"
            }
        }
        return "unexpected"
    }

    private final class BackupProgress: @unchecked Sendable {
        private let lock = NSLock()
        private var capture: MobileFolderInventory.Capture
        private var state = "running"
        private var ignoredCount = 0
        init(id: String, generation: String) {
            capture = .init(id: id, generation: generation, totalEntries: 0, coverage: "partial", consistency: "per-entry", totalSkipped: 0)
        }
        func update(_ entries: Int, _ skipped: Int) {
            lock.lock(); defer { lock.unlock() }
            capture = .init(id: capture.id, generation: capture.generation, totalEntries: entries, coverage: "partial", consistency: "per-entry", totalSkipped: skipped)
        }
        func ignored(_ count: Int) { lock.lock(); defer { lock.unlock() }; ignoredCount = count }
        func finish(_ result: MobileFolderInventory.Capture?) {
            lock.lock(); defer { lock.unlock() }
            if let result { capture = result; state = "complete" } else { state = "interrupted" }
        }
        func status() -> MobileFolderInventory.BackupStatus {
            lock.lock(); defer { lock.unlock() }
            return .init(capture: capture, state: state, ignoredCount: ignoredCount)
        }
    }
    private struct BackupJob {
        let scope: MobileFolderInventory.Scope
        let grant: MobileFolderStore.Grant
        let exclusions: [String]
        let ignoreRules: String?
        let progress: BackupProgress
        let task: Task<Void, Never>
        let monitor: Task<Void, Never>
    }
    private var backupJob: BackupJob?

    private func backupMatches(_ job: BackupJob, scope: MobileFolderInventory.Scope, grant: MobileFolderStore.Grant, id: String, exclusions: [String], ignoreRules: String?) -> Bool {
        job.scope == scope && job.grant.bookmark == grant.bookmark && job.progress.status().id == id.lowercased() && job.exclusions == exclusions && MobileFolderIgnoreRules.sameText(job.ignoreRules, ignoreRules)
    }
    private func backup(_ r: Request, scope: MobileFolderInventory.Scope, grant: MobileFolderStore.Grant) async throws -> MobileFolderInventory.BackupStatus {
        guard streamJob == nil else { throw MobileFolderStore.Failure.changed }
        guard let rawId = r.captureId, UUID(uuidString: rawId) != nil else { throw MobileFolderStore.Failure.invalid }
        let id = rawId.lowercased(), exclusions = try MobileFolderReader.canonicalExclusions(r.excludedPaths ?? []), rules = try MobileFolderIgnoreRules(r.ignoreRules).text
        if let job = backupJob, backupMatches(job, scope: scope, grant: grant, id: id, exclusions: exclusions, ignoreRules: rules),
           job.progress.status().state != "running", r.action == "scan-status" || r.action == "scan-cancel" {
            return job.progress.status()
        }
        if let job = backupJob, job.progress.status().state == "running" {
            guard backupMatches(job, scope: scope, grant: grant, id: id, exclusions: exclusions, ignoreRules: rules) else { throw ThingtimeNodeError.invalidRequest("A backup scan is already running.") }
            if r.action == "scan-cancel" {
                job.task.cancel(); job.monitor.cancel(); await job.task.value
            }
            return job.progress.status()
        }
        let inventories = inventories
        if r.action == "scan-cancel" {
            guard let status = try await worker({ try inventories.backupStatus(scope, id: id, bookmark: grant.bookmark, excludedPaths: exclusions, ignoreRules: rules) }) else {
                // A cache eviction or process restart may have removed an old
                // job. Cancellation still succeeds, after the normal live
                // account/grant checks, without disclosing capture metadata.
                return .init(capture: .init(id: id, generation: UUID().uuidString.lowercased(), totalEntries: 0,
                    coverage: "partial", consistency: "per-entry", totalSkipped: 0), state: "interrupted")
            }
            return .init(capture: .init(id: status.id, generation: status.generation, totalEntries: status.totalEntries,
                coverage: status.coverage, consistency: status.consistency, totalSkipped: status.totalSkipped), state: "interrupted", ignoredCount: status.ignoredCount)
        }
        let old = try await worker { try inventories.backupStatus(scope, id: id, bookmark: grant.bookmark, excludedPaths: exclusions, ignoreRules: rules) }
        if r.action == "scan-status" {
            guard let old else { throw MobileFolderStore.Failure.changed }; return old
        }
        if let old, old.state == "complete" { return old }
        backupJob?.monitor.cancel()
        let progress = BackupProgress(id: id, generation: UUID().uuidString.lowercased())
        let started = backupNow()
        let task = Task { @MainActor [weak self] in
            guard let self else { progress.finish(nil); return }
            var preparedCapture: MobileFolderInventory.Capture?
            do {
                let prepared = try await self.worker {
                    try inventories.prepareBackup(scope, id: id, generation: progress.status().generation, bookmark: grant.bookmark,
                        excludedPaths: exclusions, ignoreRules: rules, ignored: { progress.ignored($0) }, progress: { entries, skipped in progress.update(entries, skipped) })
                }
                preparedCapture = prepared
                try Task.checkCancellation()
                try await self.awaitBackupAuthorization(scope: scope, grant: grant, started: started)
                try await self.worker { try inventories.sealBackup(scope, capture: prepared, bookmark: grant.bookmark) }
                try Task.checkCancellation()
                progress.finish(prepared)
            } catch {
                ThingtimeNodeLog.actions.error("Backup indexing stopped: phase=scan code=\(Self.backupDiagnosticCode(error), privacy: .public)")
                if let preparedCapture {
                    // Cleanup runs independently of the cancelled job task. A
                    // cancellation racing the final fsync cannot leave it sealed.
                    await Task.detached { try? inventories.abandonBackup(scope, capture: preparedCapture, bookmark: grant.bookmark) }.value
                }
                progress.finish(nil)
            }
        }
        let monitor = Task { @MainActor [weak self] in
            while !Task.isCancelled && progress.status().state == "running" {
                do { try await Task.sleep(for: self?.backupMonitorInterval ?? .seconds(15)) } catch { return }
                guard !Task.isCancelled, progress.status().state == "running" else { return }
                guard let self else { task.cancel(); return }
                do {
                    try self.checkBackupAuthority(scope: scope, grant: grant, started: started)
                    try await self.verify(scope.owner.ownerId, scope.deviceId)
                    try self.checkBackupAuthority(scope: scope, grant: grant, started: started)
                } catch {
                    // A local revocation remains authoritative while offline.
                    let locallyAuthorized = (try? self.checkBackupAuthority(scope: scope, grant: grant, started: started)) != nil
                    if locallyAuthorized && Self.identityVerificationIsTransient(error) {
                        ThingtimeNodeLog.actions.error("Backup authorization waiting: phase=monitor code=\(Self.backupDiagnosticCode(error), privacy: .public)")
                        continue
                    }
                    ThingtimeNodeLog.actions.error("Backup indexing stopped: phase=monitor code=\(Self.backupDiagnosticCode(error), privacy: .public)")
                    task.cancel(); return
                }
            }
        }
        backupJob = BackupJob(scope: scope, grant: grant, exclusions: exclusions, ignoreRules: rules, progress: progress, task: task, monitor: monitor)
        return progress.status()
    }

    private final class StreamWake: @unchecked Sendable {
        private let condition = NSCondition()
        private var revision = 0
        func snapshot() -> Int { condition.lock(); defer { condition.unlock() }; return revision }
        func signal() { condition.lock(); revision += 1; condition.broadcast(); condition.unlock() }
        func wait(after: Int, milliseconds: Int) {
            condition.lock(); defer { condition.unlock() }
            let deadline = Date().addingTimeInterval(Double(milliseconds) / 1000)
            while revision == after && !Task.isCancelled {
                if !condition.wait(until: deadline) { break }
            }
        }
    }
    private struct StreamJob {
        let scope: MobileFolderInventory.Scope; let grant: MobileFolderStore.Grant
        let id: String; let exclusions: [String]; let rules: String?
        let control: MobileFolderInventory.StreamControl; let wake: StreamWake; let task: Task<Void, Never>; let monitor: Task<Void, Never>
    }
    private var streamJob: StreamJob?
    private func stream(_ r: Request, scope: MobileFolderInventory.Scope, grant: MobileFolderStore.Grant) async throws -> MobileFolderInventory.ChangesPage {
        guard let id = r.captureId, UUID(uuidString: id) != nil else { throw MobileFolderStore.Failure.invalid }
        let exclusions = try MobileFolderReader.canonicalExclusions(r.excludedPaths ?? []), rules = try MobileFolderIgnoreRules(r.ignoreRules).text
        let inventories = inventories
        if let job = streamJob {
            guard job.scope == scope, job.grant.bookmark == grant.bookmark, job.id == id,
                  job.exclusions == exclusions, MobileFolderIgnoreRules.sameText(job.rules, rules) else { throw MobileFolderStore.Failure.changed }
        }
        if r.action == "scan-cancel", let job = streamJob { job.task.cancel(); job.monitor.cancel(); job.wake.signal(); await job.task.value }
        if r.action == "scan-stream", streamJob == nil {
            guard backupJob?.progress.status().state != "running" else { throw MobileFolderStore.Failure.changed }
            let initial = try await worker { try inventories.beginStream(scope, id: id, bookmark: grant.bookmark, excludedPaths: exclusions, ignoreRules: rules) }
            if initial.state == "complete" { return initial }
            // A persisted running job without a live scanner is interrupted.
            // Explicit restart keeps its generation and append-only cursor.
            let wake = StreamWake(), control = MobileFolderInventory.StreamControl(), started = backupNow()
            let task = Task { @MainActor [weak self] in
                guard let self else { return }
                do {
                    try self.checkBackupAuthority(scope: scope, grant: grant, started: started)
                    try await self.worker { try inventories.runStream(scope, id: id, bookmark: grant.bookmark, excludedPaths: exclusions, ignoreRules: rules, control: control, wake: { wake.signal() }) }
                    try await self.awaitBackupAuthorization(scope: scope, grant: grant, started: started)
                    try await self.worker { try inventories.finishStream(scope, id: id, bookmark: grant.bookmark, state: "complete") }
                } catch {
                    await Task.detached { try? inventories.finishStream(scope, id: id, bookmark: grant.bookmark, state: "interrupted") }.value
                }
                wake.signal()
                if self.streamJob?.id == id { self.streamJob?.monitor.cancel(); self.streamJob = nil }
            }
            let monitor = Task { @MainActor [weak self] in
                while !Task.isCancelled {
                    do { try await Task.sleep(for: self?.backupMonitorInterval ?? .seconds(15)) } catch { return }
                    guard let self, !Task.isCancelled else { task.cancel(); wake.signal(); return }
                    do {
                        try self.checkBackupAuthority(scope: scope, grant: grant, started: started)
                        try await self.verify(scope.owner.ownerId, scope.deviceId)
                        try self.checkBackupAuthority(scope: scope, grant: grant, started: started)
                    } catch {
                        let local = (try? self.checkBackupAuthority(scope: scope, grant: grant, started: started)) != nil
                        if local && Self.identityVerificationIsTransient(error) { continue }
                        task.cancel(); wake.signal(); return
                    }
                }
            }
            streamJob = .init(scope: scope, grant: grant, id: id, exclusions: exclusions, rules: rules, control: control, wake: wake, task: task, monitor: monitor)
        }
        if streamJob == nil, r.action != "scan-stream" {
            let retained = try await worker { try inventories.streamChanges(scope, id: id, bookmark: grant.bookmark, excludedPaths: exclusions, ignoreRules: rules, afterSequence: r.afterSequence ?? 0, pageSize: r.pageSize) }
            if ["running", "indexed"].contains(retained.state) { try await worker { try inventories.finishStream(scope, id: id, bookmark: grant.bookmark, state: "interrupted") } }
        }
        let after = r.afterSequence ?? 0
        guard after >= 0, (0...25_000).contains(r.waitMilliseconds ?? 0) else { throw MobileFolderStore.Failure.invalid }
        let wake = streamJob?.wake, observed = wake?.snapshot()
        var page = try await worker { try inventories.streamChanges(scope, id: id, bookmark: grant.bookmark, excludedPaths: exclusions, ignoreRules: rules, afterSequence: after, pageSize: r.pageSize) }
        if ["running", "indexed"].contains(page.state), page.changes.isEmpty, let wake, let observed, let wait = r.waitMilliseconds, wait > 0 {
            await withTaskCancellationHandler(operation: {
                await Task.detached { wake.wait(after: observed, milliseconds: wait) }.value
            }, onCancel: { wake.signal() })
            try await authorized(r)
            guard try store.grant(scope.owner, id: grant.id).bookmark == grant.bookmark else { throw MobileFolderStore.Failure.changed }
            page = try await worker { try inventories.streamChanges(scope, id: id, bookmark: grant.bookmark, excludedPaths: exclusions, ignoreRules: rules, afterSequence: after, pageSize: r.pageSize) }
        }
        if r.action == "scan-stream-finish", page.state == "indexed", page.revision == after {
            streamJob?.control.finish(afterSequence: after)
        }
        return page
    }

    public init(origin: URL, store: MobileFolderStore, staging: MobileSyncStaging, trash: MobileSyncTrash? = nil,
                verify: @escaping (String, String) async throws -> Void,
                choose: @escaping () async throws -> URL?, approve: @escaping (MobileFolderStore.Grant) async throws -> Bool,
                chooseSource: (() async throws -> SourceSelection?)? = nil,
                photos: PhotoLibraryReader = PhotoLibraryReader(),
                inventories: MobileFolderInventory = MobileFolderInventory(),
                approveTrash: ((MobileFolderStore.Grant) async throws -> Bool)? = nil,
                approveRestore: ((MobileFolderStore.Grant, MobileSyncTrash.Restore) async throws -> Bool)? = nil,
                cancelDialog: @escaping () -> Void = {},
                conditions: @escaping () -> Conditions = { .init(network: "unknown", charging: nil) }) throws {
        self.origin = try FileSyncOwnerScope(ownerId: "origin-validation", url: origin).origin
        self.inventories = inventories; self.store = store; self.staging = staging; self.verify = verify
        self.trash = trash; self.approveTrash = approveTrash; self.approveRestore = approveRestore
        self.chooseSource = chooseSource; self.photos = photos
        self.choose = choose; self.approve = approve; self.cancelDialog = cancelDialog; self.conditions = conditions
    }

    public func suspend() {
        backupJob?.task.cancel(); backupJob?.monitor.cancel(); streamJob?.task.cancel(); streamJob?.monitor.cancel(); streamJob?.wake.signal()
        streamWaiter?.task.cancel(); streamJob?.wake.signal()
        suspendRequest()
    }
    private func suspendRequest() {
        active?.task.cancel(); cancelDialog()
        let photos = photos; Task.detached { photos.discard() }
    }

    public func handle(_ payload: JSONValue, stream: (@Sendable (Data) throws -> Void)? = nil, receive: (@Sendable (Int) throws -> Data)? = nil) async throws -> JSONValue {
        let encoded = try JSONEncoder().encode(payload)
        guard encoded.count <= 131_072 else { throw MobileFolderStore.Failure.limit }
        let r = try JSONDecoder().decode(Request.self, from: encoded)
        guard UUID(uuidString: r.requestId) != nil, !r.deviceId.isEmpty, r.deviceId.utf8.count <= 512,
              r.origin == origin.absoluteString else { throw MobileFolderStore.Failure.invalid }
        if case .object(let fields) = payload, fields["excludedPaths"] != nil, r.excludedPaths == nil {
            throw MobileFolderStore.Failure.invalid
        }
        if let exclusions = r.excludedPaths {
            guard ["scan", "scan-stream", "scan-stream-finish", "scan-changes", "scan-capture", "scan-status", "scan-cancel"].contains(r.action) else { throw MobileFolderStore.Failure.invalid }
            _ = try MobileFolderReader.canonicalExclusions(exclusions)
        }
        if case .object(let fields) = payload, fields["capturePolicy"] != nil, r.capturePolicy == nil { throw MobileFolderStore.Failure.invalid }
        if let policy = r.capturePolicy {
            if policy == "one-way-supported" {
                guard ["scan-stream", "scan-stream-finish", "scan-changes", "scan-cancel"].contains(r.action) else { throw MobileFolderStore.Failure.invalid }
            } else if ["scan-stream", "scan-stream-finish", "scan-changes"].contains(r.action) { throw MobileFolderStore.Failure.invalid }
            guard ["backup-supported", "one-way-supported"].contains(policy), ["scan-stream", "scan-stream-finish", "scan-changes", "scan-capture", "scan-status", "scan-cancel", "scan-page", "scan-skips", "scan-discard"].contains(r.action) else { throw MobileFolderStore.Failure.invalid }
        } else if ["scan-status", "scan-cancel", "scan-skips"].contains(r.action) { throw MobileFolderStore.Failure.invalid }
        if case .object(let fields) = payload, fields["ignoreRules"] != nil, r.ignoreRules == nil { throw MobileFolderStore.Failure.invalid }
        if let text = r.ignoreRules {
            guard ["scan", "scan-stream", "scan-stream-finish", "scan-changes", "scan-capture", "scan-status", "scan-cancel", "scan-page", "scan-skips", "scan-discard"].contains(r.action) else { throw MobileFolderStore.Failure.invalid }
            _ = try MobileFolderIgnoreRules(text)
        }
        if case .object(let fields) = payload, fields["pageSize"] != nil {
            guard ["scan-page", "scan-skips", "scan-changes", "scan-stream-finish"].contains(r.action), let pageSize = r.pageSize,
                  (1...MobileFolderInventory.maximumBatchPageEntries).contains(pageSize) else { throw MobileFolderStore.Failure.invalid }
        }
        if case .object(let fields) = payload {
            if fields["afterSequence"] != nil {
                guard ["scan-stream", "scan-stream-finish", "scan-changes", "scan-cancel"].contains(r.action), let after = r.afterSequence,
                      after >= 0, after <= 9_007_199_254_740_991 else { throw MobileFolderStore.Failure.invalid }
            }
            if fields["waitMilliseconds"] != nil {
                guard r.action == "scan-changes", let wait = r.waitMilliseconds, (0...25_000).contains(wait) else { throw MobileFolderStore.Failure.invalid }
            }
        }
        let owner = try FileSyncOwnerScope(ownerId: r.ownerId, url: origin)
        if r.action == "suspend" {
            if let active, active.id == r.requestId, active.owner == r.ownerId, active.device == r.deviceId { suspendRequest() }
            if let waiter = streamWaiter, waiter.id == r.requestId, waiter.owner == r.ownerId, waiter.device == r.deviceId { waiter.task.cancel(); streamJob?.wake.signal() }
            return .object([:])
        }
        let waiting = r.action == "scan-changes"
        guard waiting ? streamWaiter == nil : active == nil else { throw ThingtimeNodeError.invalidRequest("Another folder request is running.") }
        guard ["context", "conditions", "list", "choose", "remove", "scan", "scan-stream", "scan-stream-finish", "scan-changes", "scan-capture", "scan-status", "scan-cancel", "scan-skips", "scan-page", "scan-discard", "inspect", "read", "read-range", "stage-begin", "stage-append", "stage-range", "stage-finish", "write-approve", "write-check", "publication-lookup", "publish", "trash", "trash-lookup", "trash-expected", "trash-inspect", "trash-restore", "trash-restore-reviewed", "trash-list"].contains(r.action) else { throw MobileFolderStore.Failure.invalid }
        guard (r.action == "read-range") == (stream != nil), (r.action == "stage-range") == (receive != nil) else { throw MobileFolderStore.Failure.invalid }
        let task = Task { try await self.execute(r, owner: owner, stream: stream, receive: receive) }
        if waiting { streamWaiter = (r.requestId, r.ownerId, r.deviceId, task) }
        else { active = (r.requestId, r.ownerId, r.deviceId, task) }
        let timeout = Task {
            try await Task.sleep(for: .seconds(270))
            if waiting { if streamWaiter?.id == r.requestId { streamWaiter?.task.cancel(); streamJob?.wake.signal() } }
            else if active?.id == r.requestId { suspendRequest() }
        }
        defer {
            timeout.cancel()
            if waiting { if streamWaiter?.id == r.requestId { streamWaiter = nil } }
            else if active?.id == r.requestId { active = nil }
        }
        return try await withTaskCancellationHandler(operation: { try await task.value }, onCancel: {
            task.cancel()
            Task { @MainActor [weak self] in
                if waiting { if self?.streamWaiter?.id == r.requestId { self?.streamWaiter?.task.cancel(); self?.streamJob?.wake.signal() } }
                else if self?.active?.id == r.requestId { self?.suspendRequest() }
            }
        })
    }

    private func authorized(_ r: Request) async throws {
        try Task.checkCancellation()
        do { try await verify(r.ownerId, r.deviceId) }
        catch {
            if let job = streamJob, job.scope.owner.ownerId == r.ownerId, job.scope.deviceId == r.deviceId {
                let unchanged = (try? store.grant(job.scope.owner, id: job.grant.id).bookmark) == job.grant.bookmark
                if !Self.identityVerificationIsTransient(error) || !unchanged { job.task.cancel(); job.monitor.cancel(); job.wake.signal() }
            }
            if !Task.isCancelled, !(error is CancellationError), let job = backupJob,
               job.scope.owner.ownerId == r.ownerId, job.scope.deviceId == r.deviceId {
                let grantUnchanged = (try? store.grant(job.scope.owner, id: job.grant.id).bookmark) == job.grant.bookmark
                if !Self.identityVerificationIsTransient(error) || !grantUnchanged {
                    ThingtimeNodeLog.actions.error("Backup indexing stopped: phase=request-authorization code=\(Self.backupDiagnosticCode(error), privacy: .public)")
                    job.task.cancel(); job.monitor.cancel()
                }
            }
            throw error
        }
        try Task.checkCancellation()
    }
    private func worker<T: Sendable>(_ work: @escaping @Sendable () throws -> T) async throws -> T {
        let task = Task.detached { try Task.checkCancellation(); return try work() }
        return try await withTaskCancellationHandler(operation: { try await task.value }, onCancel: { task.cancel() })
    }
    private func value<T: Encodable>(_ input: T) throws -> JSONValue { try JSONValue.from(input) }

    private func execute(_ r: Request, owner: FileSyncOwnerScope, stream: (@Sendable (Data) throws -> Void)?, receive: (@Sendable (Int) throws -> Data)?) async throws -> JSONValue {
        try await authorized(r)
        var result: [String: JSONValue] = ["requestId": .string(r.requestId), "ownerId": .string(r.ownerId), "deviceId": .string(r.deviceId), "origin": .string(r.origin)]
        var inspectedGrant: MobileFolderStore.Grant?
        var checkedApproval: MobileFolderStore.WriteApproval?
        if r.action == "context" {
            var capabilities: [String: JSONValue] = ["fileAccessVersion": .string(Self.version), "fileStagingVersion": .string("1.1.0"), "filePublicationVersion": .string("1.2.0")]
            if trash != nil, approveTrash != nil { capabilities["fileTrashVersion"] = .string(approveRestore == nil ? "1.1.1" : "1.2.1") }
            result["capabilities"] = .object(capabilities)
        } else if r.action == "conditions" {
            result["conditions"] = try value(conditions())
        } else if r.action == "choose" {
            let selection: SourceSelection?
            if let chooseSource { selection = try await chooseSource() }
            else { selection = try await choose().map(SourceSelection.folder) }
            try await authorized(r)
            switch selection {
            case .folder(let url): _ = try store.add(owner, selected: url)
            case .photos:
                guard photos.access() != "unavailable" else { throw PhotoLibraryReader.Failure.unavailable }
                _ = try store.addPhotos(owner)
            case nil: break
            }
        } else if r.action != "list" {
            guard let root = r.rootId, UUID(uuidString: root) != nil else { throw MobileFolderStore.Failure.invalid }
            result["rootId"] = .string(root)
            if r.action == "remove" {
                if let job = streamJob, job.scope.owner == owner, job.scope.rootId == root { job.task.cancel(); job.monitor.cancel(); job.wake.signal(); await job.task.value }
                if let job = backupJob, job.scope.owner == owner, job.scope.rootId == root {
                    job.task.cancel(); job.monitor.cancel(); await job.task.value
                }
                try store.remove(owner, id: root)
                let photos = photos; try await worker { photos.discard() }
            }
            else {
                let grant: MobileFolderStore.Grant
                do { grant = try store.grant(owner, id: root) }
                catch {
                    if let job = streamJob, job.scope.owner == owner, job.scope.rootId == root { job.task.cancel(); job.monitor.cancel(); job.wake.signal() }
                    if let job = backupJob, job.scope.owner == owner, job.scope.rootId == root {
                        job.task.cancel(); job.monitor.cancel()
                    }
                    throw error
                }
                let staging = staging, photos = photos
                let photoScope = owner.key + ":" + root
                guard grant.sourceKind != "photos" || ["scan", "read", "read-range"].contains(r.action) else { throw MobileFolderStore.Failure.invalid }
                if r.action == "trash-list" {
                    guard let trash, approveRestore != nil else { throw MobileFolderStore.Failure.unavailable }
                    result["trashPage"] = try value(await worker { try trash.list(owner: owner, rootId: root, bookmark: grant.bookmark, cursor: r.cursor) })
                } else if r.action == "write-approve" || r.action == "write-check" {
                    guard let approval = r.approval, approval.scope.deviceId == r.deviceId else { throw MobileFolderStore.Failure.invalid }
                    try approval.validate(owner: owner)
                    if try !store.isWriteApproved(owner, id: root, approval: approval) {
                        // A resumed/background run may only reuse existing consent.
                        // Never open a dialog or persist approval from this action.
                        guard r.action == "write-approve" else { throw MobileFolderStore.Failure.unavailable }
                        let accepted: Bool
                        if approval.allowTrash == true {
                            guard trash != nil, let approveTrash else { throw MobileFolderStore.Failure.unavailable }
                            accepted = try await approveTrash(grant)
                        } else { accepted = try await approve(grant) }
                        guard accepted else { throw MobileFolderStore.Failure.approvalCancelled }
                        try await authorized(r)
                        try store.approveWrite(owner, grant: grant, approval: approval)
                    }
                    try await worker { try MobileFolderReader.checkAccess(bookmark: grant.bookmark) }
                    inspectedGrant = grant; checkedApproval = approval
                    result["writeApproval"] = try value(approval)
                } else if ["trash", "trash-lookup", "trash-expected", "trash-inspect", "trash-restore", "trash-restore-reviewed", "trash-list"].contains(r.action) {
                    guard let trash, let request = r.trash, request.rootId == root, (["trash-inspect", "trash-restore-reviewed"].contains(r.action) || request.scope.deviceId == r.deviceId) else { throw MobileFolderStore.Failure.invalid }
                    try request.validate(owner: owner)
                    if r.action == "trash" || r.action == "trash-restore" {
                        guard let approval = r.approval, approval.scope == request.scope,
                              r.action != "trash" || approval.allowTrash == true,
                              try store.isWriteApproved(owner, id: root, approval: approval) else { throw MobileFolderStore.Failure.unavailable }
                    }
                    let action = r.action, restore = r.restore
                    if action == "trash-restore-reviewed" {
                        guard let restore, let approveRestore else { throw MobileFolderStore.Failure.unavailable }
                        let resumed = try await worker { try trash.resumeRestore(request, owner: owner, bookmark: grant.bookmark, restore: restore) }
                        if let resumed { result["restoredEntry"] = try value(resumed) }
                        else {
                            try await worker { try trash.reviewRestore(request, owner: owner, bookmark: grant.bookmark, restore: restore) }
                            guard try await approveRestore(grant, restore) else { throw MobileFolderStore.Failure.approvalCancelled }
                            try await authorized(r)
                            guard try store.grant(owner, id: root).bookmark == grant.bookmark else { throw MobileFolderStore.Failure.unavailable }
                            result["restoredEntry"] = try value(await worker { try trash.restore(request, owner: owner, bookmark: grant.bookmark, restore: restore) })
                        }
                    } else if action == "trash-expected" {
                        result["expectedEntry"] = try value(await worker { try trash.expected(request, owner: owner, bookmark: grant.bookmark) })
                    } else if action == "trash-inspect" {
                        let retained = try await worker { try trash.inspect(request, owner: owner, bookmark: grant.bookmark) }
                        result["retainedEntry"] = try retained.map { try value($0) } ?? .null
                        let intent = try await worker { try trash.restoration(request, owner: owner, bookmark: grant.bookmark) }
                        result["restoreIntent"] = try intent.map { try value($0) } ?? .null
                    } else if action == "trash-restore" {
                        guard let restore else { throw MobileFolderStore.Failure.invalid }
                        result["restoredEntry"] = try value(await worker { try trash.restore(request, owner: owner, bookmark: grant.bookmark, restore: restore) })
                    } else {
                        let lookup = try await worker {
                            if action == "trash" { return MobileSyncTrash.Lookup(status: "complete", receipt: try trash.trash(request, owner: owner, bookmark: grant.bookmark)) }
                            return try trash.lookup(request, owner: owner, bookmark: grant.bookmark)
                        }
                        result["trash"] = try value(lookup)
                    }
                } else if r.action == "scan-stream" || r.action == "scan-stream-finish" || r.action == "scan-changes" || (r.action == "scan-cancel" && r.capturePolicy == "one-way-supported") {
                    guard r.capturePolicy == "one-way-supported", r.inventoryDeviceId == r.deviceId else { throw MobileFolderStore.Failure.invalid }
                    inspectedGrant = grant
                    result["capturePolicy"] = .string("one-way-supported")
                    result["changesPage"] = try value(await self.stream(r, scope: .init(owner: owner, deviceId: r.deviceId, rootId: root), grant: grant))
                } else if ["scan-capture", "scan-status", "scan-cancel", "scan-skips", "scan-page", "scan-discard"].contains(r.action) {
                    guard r.inventoryDeviceId == r.deviceId else { throw MobileFolderStore.Failure.invalid }
                    inspectedGrant = grant
                    let inventoryScope = MobileFolderInventory.Scope(owner: owner, deviceId: r.deviceId, rootId: root)
                    let inventories = inventories
                    if r.capturePolicy == "backup-supported" && ["scan-capture", "scan-status", "scan-cancel"].contains(r.action) {
                        let status = try await backup(r, scope: inventoryScope, grant: grant)
                        result["capturePolicy"] = .string("backup-supported")
                        if r.action == "scan-cancel" {
                            result["captureId"] = .string(r.captureId!)
                            result["cancelled"] = .bool(true); result["complete"] = .bool(false)
                        } else {
                            result["backupCapture"] = try value(status); result["complete"] = .bool(status.state == "complete")
                        }
                    } else {
                        // No cache-lock waiter may turn a short polling RPC into
                        // a second whole-scan request while this worker owns it.
                        guard streamJob == nil, backupJob?.progress.status().state != "running" else { throw ThingtimeNodeError.invalidRequest("A backup scan is already running.") }
                        if r.action == "scan-capture" {
                            guard let id = r.captureId else { throw MobileFolderStore.Failure.invalid }
                            do {
                                result["capture"] = try value(await worker { try inventories.capture(inventoryScope, id: id, bookmark: grant.bookmark, excludedPaths: r.excludedPaths ?? [], ignoreRules: r.ignoreRules) })
                            } catch let failure as MobileFolderReader.ScanFailure { result["scanFailure"] = try value(failure) }
                        } else {
                            guard let capture = r.capture,
                                  (capture.consistency == "per-entry") == (r.capturePolicy == "backup-supported") else { throw MobileFolderStore.Failure.invalid }
                            if r.action == "scan-page" || r.action == "scan-skips" {
                                guard let offset = r.offset, offset >= 0, offset <= 9_007_199_254_740_991 else { throw MobileFolderStore.Failure.invalid }
                                if r.action == "scan-skips" {
                                    result["skippedPage"] = try value(await worker { try inventories.readSkipped(inventoryScope, capture: capture, bookmark: grant.bookmark, offset: Int(offset), ignoreRules: r.ignoreRules, pageSize: r.pageSize) })
                                } else {
                                    result["inventoryPage"] = try value(await worker { try inventories.read(inventoryScope, capture: capture, bookmark: grant.bookmark, offset: Int(offset), ignoreRules: r.ignoreRules, pageSize: r.pageSize) })
                                }
                            } else {
                                try await worker { try inventories.discard(inventoryScope, capture: capture, bookmark: grant.bookmark, ignoreRules: r.ignoreRules) }
                                result["discarded"] = .bool(true)
                            }
                        }
                        if let policy = r.capturePolicy { result["capturePolicy"] = .string(policy) }
                        result["complete"] = .bool(result["scanFailure"] == nil)
                    }
                } else if r.action == "inspect" {
                    guard let path = r.path else { throw MobileFolderStore.Failure.invalid }
                    inspectedGrant = grant
                    let entry = try await worker { try MobileFolderReader.inspect(bookmark: grant.bookmark, path: path) }
                    result["path"] = .string(path); result["complete"] = .bool(true)
                    result["entry"] = try entry.map { try value($0) } ?? .null
                } else if r.action == "scan" {
                    if grant.sourceKind != "photos" { inspectedGrant = grant }
                    do {
                        result["entries"] = try value(await worker {
                            if grant.sourceKind == "photos" {
                                guard r.excludedPaths?.isEmpty != false, r.ignoreRules?.isEmpty != false else { throw MobileFolderStore.Failure.invalid }
                                return try photos.scan(scope: photoScope)
                            }
                            return try MobileFolderReader.scan(bookmark: grant.bookmark, excludedPaths: r.excludedPaths ?? [], ignoreRules: r.ignoreRules)
                        })
                    } catch let failure as MobileFolderReader.ScanFailure {
                        result["scanFailure"] = try value(failure)
                    }
                    result["complete"] = .bool(result["scanFailure"] == nil)
                } else if r.action == "read-range" {
                    guard let path = r.path, let version = r.version, let offset = r.offset, let length = r.length,
                          let stream else { throw MobileFolderStore.Failure.invalid }
                    let size = try await worker {
                        if grant.sourceKind == "photos" { return try photos.stream(scope: photoScope, path: path, version: version, offset: offset, length: length, receive: stream) }
                        return try MobileFolderReader.stream(bookmark: grant.bookmark, path: path, version: version,
                            offset: offset, length: length, receive: stream)
                    }
                    result["path"] = .string(path)
                    result["chunk"] = .object(["version": .string(version), "size": .number(Double(size)),
                        "offset": .number(Double(offset)), "length": .number(Double(length))])
                } else if r.action == "read" {
                    guard let path = r.path, let version = r.version, let offset = r.offset, let length = r.length else { throw MobileFolderStore.Failure.invalid }
                    result["path"] = .string(path)
                    result["chunk"] = try value(await worker {
                        if grant.sourceKind == "photos" { return try photos.read(scope: photoScope, path: path, version: version, offset: offset, length: length) }
                        return try MobileFolderReader.read(bookmark: grant.bookmark, path: path, version: version, offset: offset, length: length)
                    })
                } else {
                    guard let transfer = r.transfer, transfer.rootId == root, transfer.scope.deviceId == r.deviceId else { throw MobileFolderStore.Failure.invalid }
                    try transfer.validate(owner: owner)
                    if r.action == "publish" || r.action == "publication-lookup" {
                        var stage: MobileSyncStaging.Stage?
                        if r.action == "publish" {
                            guard let approval = r.approval, approval.scope == transfer.scope, let suppliedStage = r.stage,
                                  try store.isWriteApproved(owner, id: root, approval: approval) else { throw MobileFolderStore.Failure.unavailable }
                            stage = suppliedStage
                        }
                        let publicationStage = stage
                        let receipt = try await worker {
                            try MobileFolderReader.checkAccess(bookmark: grant.bookmark)
                            if let publicationStage {
                                return MobileSyncStaging.Lookup(status: "complete", receipt: try staging.publish(transfer, owner: owner, bookmark: grant.bookmark, stage: publicationStage))
                            }
                            return try staging.lookup(transfer, owner: owner, bookmark: grant.bookmark)
                        }
                        result["publication"] = try value(receipt)
                    } else {
                        let action = r.action, offset = r.offset, encoded = r.data, length = r.length
                        let progress = try await worker {
                            try MobileFolderReader.checkAccess(bookmark: grant.bookmark)
                            let progress: MobileSyncStaging.Progress
                            switch action {
                            case "stage-begin": progress = try staging.begin(transfer, owner: owner)
                            case "stage-finish": progress = try staging.finish(transfer, owner: owner)
                            case "stage-range":
                                guard let offset, let length, let receive else { throw MobileFolderStore.Failure.invalid }
                                progress = try staging.appendStream(transfer, owner: owner, offset: offset, length: length, read: receive)
                            case "stage-append":
                                guard let offset, offset >= 0, let encoded, encoded.utf8.count <= 87_384,
                                      let bytes = Data(base64Encoded: encoded), !bytes.isEmpty, bytes.count <= 65_536 else { throw MobileFolderStore.Failure.invalid }
                                progress = try staging.append(transfer, owner: owner, offset: offset, bytes: bytes)
                            default: throw MobileFolderStore.Failure.invalid
                            }
                            try MobileFolderReader.checkAccess(bookmark: grant.bookmark)
                            return progress
                        }
                        result["staging"] = try value(progress)
                    }
                }
            }
        }
        if let rules = r.ignoreRules, !rules.isEmpty { result["ignoreRules"] = .string(rules) }
        if let exclusions = r.excludedPaths { result["excludedPaths"] = try value(exclusions) }
        else if r.capturePolicy == "backup-supported" { result["excludedPaths"] = .array([]) }
        try await authorized(r)
        if let inspectedGrant {
            let current = try store.grant(owner, id: inspectedGrant.id)
            guard current.bookmark == inspectedGrant.bookmark, current.sourceKind == nil else { throw MobileFolderStore.Failure.changed }
            if let checkedApproval {
                guard try store.isWriteApproved(owner, id: inspectedGrant.id, approval: checkedApproval) else { throw MobileFolderStore.Failure.changed }
            }
        }
        result["roots"] = .array(try store.list(owner).map { grant in
            var row: [String: JSONValue] = ["id": .string(grant.id), "name": .string(grant.name)]
            if grant.sourceKind == "photos" {
                row["sourceKind"] = .string("photos"); row["photoAccess"] = .string(photos.access())
            } else { row["publicationVersion"] = .string("1.0.0") }
            return .object(row)
        })
        let response = JSONValue.object(result)
        // Never send a partial inventory or exceed the existing XPC frame budget.
        guard try JSONEncoder().encode(response).count <= 900_000 else { throw MobileFolderStore.Failure.limit }
        return response
    }
}
