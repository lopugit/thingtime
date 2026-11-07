import AppleFileSync
import BackgroundTasks
import Foundation
import Network
import OSLog
import UIKit

/// An already-planned file can survive app suspension and process death.
/// The WebView retains ownership of planning and Timeline publication. This
/// checkpoint holds only the existing reservation/admission and confirmed part
/// cursor, never account cookies, credentials, signed URLs, or extra file bytes.
struct NativeDeferredUploadRecord: Codable, Equatable, Sendable {
    let scope: FileSyncOwnerScope
    let request: NativeUploadFileRequest
    let grantRevision: String
    let admissionId: String
    let expiresAt: Date
    var confirmedParts = 0
    var armed = true
    var revoked = false
    var ready = false
    var retryAt = Date.distantPast

    var configuration: NativeUploadAuthorization.Configuration { request.authorization.configuration }
    var rootId: String { configuration.localRootId }

    func validate() throws {
        guard scope == (try FileSyncOwnerScope(ownerId: scope.ownerId, url: scope.origin)),
              admissionId.range(of: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$", options: .regularExpression) != nil,
              grantRevision.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              confirmedParts >= 0, confirmedParts <= (request.source.fingerprint?.partCount ?? 0),
              !revoked || !armed,
              !ready || (!armed && confirmedParts == request.source.fingerprint?.partCount) else {
            throw MobileFolderStore.Failure.invalid
        }
        try request.authorization.validate(owner: scope, rootId: rootId, photos: configuration.sourceKind == "photos")
        try request.part(1).validate()
    }

    func sameReservation(scope: FileSyncOwnerScope, request: NativeUploadFileRequest, grantRevision: String) -> Bool {
        self.scope == scope && self.request == request && self.grantRevision == grantRevision
    }

    func matches(_ value: NativeDeferredUploadRecord) -> Bool {
        sameReservation(scope: value.scope, request: value.request, grantRevision: value.grantRevision) &&
            admissionId == value.admissionId && expiresAt == value.expiresAt
    }
}

@MainActor
struct NativeDeferredUploadStore {
    enum Failure: Error, LocalizedError, Equatable {
        case pausePersistence
        var errorDescription: String? {
            "The native queue was stopped, but its pause could not be saved. Keep Thingtime open and retry Pause."
        }
    }
    let url: URL
    private let beforeWrite: () throws -> Void
    init(directory: URL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0],
         beforeWrite: @escaping () throws -> Void = {}) {
        url = directory.appendingPathComponent("NativeDeferredUpload-v1.json")
        self.beforeWrite = beforeWrite
    }
    static let lookahead = 4
    private var recoveryDirectory: URL { url.deletingLastPathComponent().appendingPathComponent("NativeDeferredUploadRecovery-v1", isDirectory: true) }
    private func recoveryURL(scope: FileSyncOwnerScope, request: NativeUploadFileRequest, grantRevision: String) -> URL {
        // Include the immutable reservation plus its verified scope and grant.
        let hash = PhotoLibraryReader.hash(Data([scope.origin.absoluteString, scope.ownerId, request.uploadId,
            request.requestId, request.authorization.scope.deviceId, request.authorization.id, request.authorization.updatedAt,
            request.source.version, grantRevision].joined(separator: "\n").utf8))
        return recoveryDirectory.appendingPathComponent(hash + ".json")
    }
    func recovery(scope: FileSyncOwnerScope, request: NativeUploadFileRequest, grantRevision: String) throws -> NativeDeferredUploadRecord? {
        let url = recoveryURL(scope: scope, request: request, grantRevision: grantRevision)
        do {
            let data = try Data(contentsOf: url)
            guard data.count <= 65_536 else { throw MobileFolderStore.Failure.invalid }
            let record = try JSONDecoder().decode(NativeDeferredUploadRecord.self, from: data)
            try record.validate()
            guard record.sameReservation(scope: scope, request: request, grantRevision: grantRevision), !record.ready, !record.armed else {
                throw MobileFolderStore.Failure.invalid
            }
            return record
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile { return nil }
    }
    func archive(_ record: NativeDeferredUploadRecord) throws {
        guard !record.ready else { return }
        var archived = record; archived.armed = false
        try archived.validate()
        let url = recoveryURL(scope: record.scope, request: record.request, grantRevision: record.grantRevision)
        try FileManager.default.createDirectory(at: recoveryDirectory, withIntermediateDirectories: true)
        try write(try JSONEncoder().encode(archived), to: url)
    }
    func discardRecovery(_ record: NativeDeferredUploadRecord) {
        try? FileManager.default.removeItem(at: recoveryURL(scope: record.scope, request: record.request, grantRevision: record.grantRevision))
    }
    func pruneRecovery() {
        guard let paths = FileManager.default.enumerator(at: recoveryDirectory, includingPropertiesForKeys: [.contentModificationDateKey],
            options: [.skipsSubdirectoryDescendants, .skipsHiddenFiles]) else { return }
        // A canonical multipart reservation lasts at most one day. Retain the
        // recovery ID past that lease and limit each cleanup pass to a page.
        let cutoff = Date(timeIntervalSinceNow: -2 * 24 * 60 * 60)
        for case let path as URL in paths.prefix(16) {
            if let changed = try? path.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate, changed < cutoff {
                try? FileManager.default.removeItem(at: path)
            }
        }
    }

    func load() throws -> [NativeDeferredUploadRecord] {
        do {
            let bytes = try Data(contentsOf: url, options: .mappedIfSafe)
            guard bytes.count <= 256 * 1024 else { throw MobileFolderStore.Failure.invalid }
            let records = try JSONDecoder().decode([NativeDeferredUploadRecord].self, from: bytes)
            guard records.count <= Self.lookahead, Set(records.map(\.admissionId)).count == records.count else { throw MobileFolderStore.Failure.invalid }
            for record in records { try record.validate() }
            return records
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile { return [] }
    }
    func save(_ records: [NativeDeferredUploadRecord]) throws {
        guard records.count <= Self.lookahead else { throw MobileFolderStore.Failure.limit }
        for record in records { try record.validate() }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(records)
        guard data.count <= 256 * 1024 else { throw MobileFolderStore.Failure.limit }
        try write(data, to: url)
    }
    private func write(_ data: Data, to url: URL) throws {
        try beforeWrite()
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        var excluded = url, values = URLResourceValues()
        values.isExcludedFromBackup = true
        try excluded.setResourceValues(values)
    }
    func lookup(_ expected: NativeDeferredUploadRecord) throws -> NativeDeferredUploadRecord? {
        try load().first { $0.matches(expected) }
    }
    func update(_ record: NativeDeferredUploadRecord) throws {
        var records = try load()
        guard let at = records.firstIndex(where: { $0.matches(record) }) else { throw CancellationError() }
        records[at] = record
        try save(records)
    }
}

@MainActor
protocol NativeDeferredUploadScheduling {
    func register(_ handle: @escaping (NativeDeferredUploadSystemTask) -> Void) -> Bool
    func submit(earliest: Date, charging: Bool) throws
    func cancel()
}

@MainActor
protocol NativeDeferredUploadSystemTask: AnyObject {
    var expiration: (() -> Void)? { get set }
    func complete(_ success: Bool)
}

@MainActor
private final class DeferredProcessingTask: NativeDeferredUploadSystemTask {
    private let task: BGProcessingTask
    init(_ task: BGProcessingTask) { self.task = task }
    var expiration: (() -> Void)? {
        didSet {
            let handler = expiration
            task.expirationHandler = handler.map { callback in { Task { @MainActor in callback() } } }
        }
    }
    func complete(_ success: Bool) { task.setTaskCompleted(success: success) }
}

@MainActor
private struct DeferredProcessingScheduler: NativeDeferredUploadScheduling {
    private let id = (Bundle.main.bundleIdentifier ?? "com.thingtime.appletime") + ".file-sync-processing"
    func register(_ handle: @escaping (NativeDeferredUploadSystemTask) -> Void) -> Bool {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: id, using: .main) { task in
            MainActor.assumeIsolated {
                guard let processing = task as? BGProcessingTask else { task.setTaskCompleted(success: false); return }
                handle(DeferredProcessingTask(processing))
            }
        }
    }
    func submit(earliest: Date, charging: Bool) throws {
        let request = BGProcessingTaskRequest(identifier: id)
        request.earliestBeginDate = earliest
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = charging
        try BGTaskScheduler.shared.submit(request)
    }
    func cancel() { BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: id) }
}

@MainActor
final class NativeDeferredUpload {
    static let shared = NativeDeferredUpload(store: .init(), scheduler: DeferredProcessingScheduler())
    private let store: NativeDeferredUploadStore
    private let scheduler: NativeDeferredUploadScheduling
    private let grants: MobileFolderStore
    private let photos: PhotoLibraryReader
    private let parts: FileUploadPartStore
    private let network = NWPathMonitor()
    private var networkKind = "unknown"
    private var registered = false, activated = false, scheduled = false
    private var operation: UUID?
    private var revoking = Set<String>()
    private var persistenceUncertain = false
    private var background: Task<Void, Never>?
    private var foregroundObserver: NSObjectProtocol?

    init(store: NativeDeferredUploadStore, scheduler: NativeDeferredUploadScheduling,
         grants: MobileFolderStore? = nil, photos: PhotoLibraryReader? = nil, parts: FileUploadPartStore? = nil) {
        self.store = store; self.scheduler = scheduler
        self.grants = grants ?? MobileFolderStore()
        self.photos = photos ?? PhotoLibraryReader(transport: RustEmbeddedInventoryTransport.default)
        self.parts = parts ?? FileUploadPartStore()
    }

    func activate(foreground: Bool) {
        guard !activated else { return }
        activated = true
        registered = scheduler.register { [weak self] task in
            guard let self else { task.complete(false); return }
            self.run(task)
        }
        network.pathUpdateHandler = { [weak self] path in
            let kind = path.status != .satisfied ? "offline" :
                path.usesInterfaceType(.cellular) ? "cellular" : path.usesInterfaceType(.wifi) ? "wifi" :
                path.usesInterfaceType(.wiredEthernet) ? "ethernet" : "unknown"
            Task { @MainActor in self?.networkKind = kind }
        }
        network.start(queue: DispatchQueue(label: "com.thingtime.file-sync-processing.network"))
        UIDevice.current.isBatteryMonitoringEnabled = true
        foregroundObserver = NotificationCenter.default.addObserver(forName: UIScene.willEnterForegroundNotification, object: nil, queue: .main) {
            [weak self] _ in MainActor.assumeIsolated { self?.disarm() }
        }
        if foreground { disarm() }
    }

    /// A foreground context change prevents a previous account's queued work
    /// from starting. Only a fresh exact owner/admission handoff re-arms it.
    func disarm(matching scope: FileSyncOwnerScope? = nil, configurationId: String? = nil, rootId: String? = nil) {
        do {
            var records = try store.load()
            let indices = records.indices.filter { i in
                records[i].armed && (scope == nil || records[i].scope == scope) &&
                    (configurationId == nil || records[i].request.authorization.id == configurationId) &&
                    (rootId == nil || records[i].rootId == rootId)
            }
            if scope == nil || !indices.isEmpty { stopScheduler() }
            guard !indices.isEmpty else { return }
            for index in indices { records[index].armed = false }
            try store.save(records)
        } catch {
            failClosed()
        }
    }

    private func stopScheduler() {
        scheduler.cancel(); scheduled = false; background?.cancel()
    }

    private func failClosed() {
        persistenceUncertain = true
        stopScheduler()
    }

    /// Local Pause is durable without an internet round trip. Server revocation
    /// uses only the exact immutable admissions captured by that pause.
    func pauseLocally(scope: FileSyncOwnerScope, rootId: String, configurationId: String, deviceId: String) throws {
        var records: [NativeDeferredUploadRecord]
        do { records = try store.load() }
        catch { failClosed(); throw NativeDeferredUploadStore.Failure.pausePersistence }
        let indices = records.indices.filter { i in
            let record = records[i]
            return record.scope == scope && record.rootId == rootId && record.request.authorization.id == configurationId &&
                record.configuration.deviceId == deviceId && !record.ready
        }
        guard !indices.isEmpty else { return }
        let toRevoke = indices.map { records[$0] }.filter { !$0.revoked && $0.expiresAt > Date() && !revoking.contains($0.admissionId) }
        for index in indices { records[index].armed = false }
        stopScheduler()
        do { try store.save(records) }
        catch { failClosed(); throw NativeDeferredUploadStore.Failure.pausePersistence }
        for record in toRevoke { revoking.insert(record.admissionId) }
        Task { [weak self] in
            guard let self else { return }
            for record in toRevoke {
                defer { self.revoking.remove(record.admissionId) }
                let client = NativeDeferredUploadClient(record: record)
                if (try? await client.request(action: "revoke")) != nil,
                   var local = try? self.store.lookup(record), !local.armed {
                    local.revoked = true
                    try? self.store.update(local)
                }
            }
        }
    }

    /// A bounded rolling queue is transport backpressure, not a backup limit.
    /// Never let a new connection borrow records from a previous owner.
    func enqueue(_ proposed: NativeDeferredUploadRecord) throws -> Bool {
        try proposed.validate()
        guard registered, proposed.expiresAt > Date(), !revoking.contains(proposed.admissionId) else { return false }
        var records = try store.load().filter { !$0.ready }
        if persistenceUncertain {
            // Fresh foreground admission can reopen the lane only after the
            // prior checkpoint is durably disarmed. No stale work is borrowed.
            for index in records.indices { records[index].armed = false }
            try store.save(records)
            persistenceUncertain = false
        }
        if let index = records.firstIndex(where: { $0.matches(proposed) }) {
            guard !records[index].revoked else { return false }
            records[index].armed = true
            records[index].retryAt = .distantPast
        } else {
            let same = { (record: NativeDeferredUploadRecord) in record.sameReservation(scope: proposed.scope, request: proposed.request, grantRevision: proposed.grantRevision) }
            let prior: NativeDeferredUploadRecord?
            if let index = records.firstIndex(where: same) {
                let old = records[index]
                guard old.revoked || old.expiresAt <= Date() else { return false }
                prior = records.remove(at: index)
            } else { prior = try store.recovery(scope: proposed.scope, request: proposed.request, grantRevision: proposed.grantRevision) }
            let other = { (record: NativeDeferredUploadRecord) in
                record.scope != proposed.scope || record.request.authorization.id != proposed.request.authorization.id ||
                    record.request.authorization.updatedAt != proposed.request.authorization.updatedAt
            }
            guard !records.contains(where: { other($0) && $0.armed && $0.expiresAt > Date() }) else { return false }
            for record in records.filter(other) { try store.archive(record) }
            records.removeAll(where: other)
            if records.count >= NativeDeferredUploadStore.lookahead,
               let unused = records.lastIndex(where: { !$0.armed || $0.expiresAt <= Date() }) {
                try store.archive(records[unused]); records.remove(at: unused)
            }
            guard records.count < NativeDeferredUploadStore.lookahead,
                  !records.contains(where: { $0.admissionId == proposed.admissionId }) else { return false }
            var next = proposed
            if let prior { next.confirmedParts = prior.confirmedParts }
            records.append(next)
        }
        try store.save(records)
        store.discardRecovery(proposed); store.pruneRecovery()
        return true
    }

    func renewalID(scope: FileSyncOwnerScope, request: NativeUploadFileRequest, grantRevision: String) throws -> String? {
        let record = try store.load().first {
            $0.sameReservation(scope: scope, request: request, grantRevision: grantRevision)
        } ?? store.recovery(scope: scope, request: request, grantRevision: grantRevision)
        guard let record, !record.ready, record.revoked || record.expiresAt <= Date() else { return nil }
        return record.admissionId
    }

    func read(scope: FileSyncOwnerScope, request: NativeUploadFileRequest, grantRevision: String) throws -> NativeDeferredUploadRecord? {
        try store.load().first {
            $0.scope == scope && $0.request == request && $0.grantRevision == grantRevision &&
                $0.armed && $0.expiresAt > Date()
        }
    }

    private func pending(now: Date = Date()) -> [NativeDeferredUploadRecord] {
        guard !persistenceUncertain else { return [] }
        return ((try? store.load()) ?? []).filter { $0.armed && !$0.ready && $0.expiresAt > now && $0.retryAt < $0.expiresAt }
    }

    @discardableResult
    func schedule(minimumDelay: TimeInterval = 10) -> Bool {
        if scheduled { return true }
        guard registered, let next = pending().min(by: { $0.retryAt < $1.retryAt }) else { return false }
        do {
            try scheduler.submit(earliest: max(Date(timeIntervalSinceNow: minimumDelay), next.retryAt), charging: next.configuration.chargingOnly)
            scheduled = true
            return true
        } catch {
            let failure = error as NSError
            Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.thingtime.appletime", category: "FileUploads")
                .notice("Deferred file transfer scheduler declined: \(failure.domain, privacy: .public) code \(failure.code, privacy: .public)")
            return false
        }
    }

    func waitForBackground() async {
        if let background { background.cancel(); await background.value }
    }

    func foreground(_ proposed: NativeDeferredUploadRecord, staging: NativeUploadPartStaging,
                    check: @escaping () throws -> Void, progress: (Int64) -> Void) async throws {
        // A returned foreground scene cancels system work. Wait for the exact
        // older worker to release its part file before borrowing it again.
        await waitForBackground()
        try check()
        try await advance(proposed, staging: staging, check: check, progress: progress)
    }

    func run(_ task: NativeDeferredUploadSystemTask, checkExecution: @escaping () throws -> Void = {
        guard UIApplication.shared.applicationState == .background else { throw CancellationError() }
    }) {
        scheduled = false
        let ready = pending().filter { $0.retryAt <= Date() }
        guard background == nil, operation == nil, !ready.isEmpty else {
            task.complete(false); schedule(); return
        }
        // Arm the next opportunistic slice before processing, so the OS can
        // terminate this process immediately at expiration without losing it.
        schedule(minimumDelay: 300)
        var done = false
        let finish: (Bool) -> Void = { success in
            guard !done else { return }; done = true
            task.expiration = nil; task.complete(success)
        }
        task.expiration = { [weak self] in self?.background?.cancel(); finish(false) }
        background = Task { [weak self] in
            guard let self else { finish(false); return }
            defer { self.background = nil; self.schedule() }
            var success = true
            for current in ready {
                do {
                    try Task.checkCancellation()
                    let grant = try self.grants.grant(current.scope, id: current.rootId)
                    let staging = NativeUploadPartStaging(scope: current.scope, grant: grant, photos: self.photos, store: self.parts)
                    try await self.advance(current, staging: staging, check: checkExecution, progress: { _ in })
                } catch {
                    success = false
                    if var saved = try? self.store.lookup(current), saved.armed, !saved.ready {
                        if (error as? NativeDeferredUploadClient.Failure)?.terminal == true ||
                            (error as? MobileFolderStore.Failure) == .changed {
                            saved.armed = false
                        } else {
                            // Back off on iOS expiry, Wi-Fi, power, or lost
                            // response. Foreground resume can bypass the delay.
                            saved.retryAt = Date(timeIntervalSinceNow: 300)
                        }
                        try? self.store.update(saved)
                    }
                    if Task.isCancelled || error is NativeUploadAuthorization.Wait { break }
                }
            }
            finish(success)
        }
    }

    private func advance(_ proposed: NativeDeferredUploadRecord, staging: NativeUploadPartStaging,
                         check: @escaping () throws -> Void, progress: (Int64) -> Void) async throws {
        guard operation == nil, var current = try store.lookup(proposed) else { throw CancellationError() }
        if current.ready { progress(current.request.source.size); return }
        let id = UUID(); operation = id
        defer { if operation == id { operation = nil } }
        let validate = {
            try Task.checkCancellation(); try check()
            guard !self.persistenceUncertain, self.operation == id, let live = try self.store.lookup(proposed), live.armed, !live.ready,
                  live.expiresAt > Date() else { throw CancellationError() }
            let grant = try self.grants.grant(proposed.scope, id: proposed.rootId)
            guard grant.sourceKind == staging.grant.sourceKind, NativeUploadPartStaging.grantRevision(grant) == proposed.grantRevision,
                  staging.grantRevision == proposed.grantRevision,
                  grant.sourceKind != "photos" || staging.photos.access() != "unavailable" else {
                throw MobileFolderStore.Failure.changed
            }
            let battery = UIDevice.current.batteryState
            try proposed.request.authorization.verifyConditions(network: self.networkKind, charging: battery == .charging || battery == .full)
        }
        let client = NativeDeferredUploadClient(record: proposed)
        try validate(); try await client.requireCapability(); try validate()
        try await staging.verify(proposed.request.source); try validate()
        let plan = try FileUploadPart.plan(size: proposed.request.source.size)
        if current.confirmedParts > 0 {
            progress(min(proposed.request.source.size, Int64(current.confirmedParts) * plan.partSize))
        }
        while current.confirmedParts < plan.count {
            try validate()
            let request = try proposed.request.part(current.confirmedParts + 1)
            let (retained, part) = try await staging.prepare(request)
            try validate()
            try await client.send(part: part, partNumber: request.partNumber, check: validate)
            try validate(); try await staging.verify(proposed.request.source); try validate()
            current.confirmedParts = request.partNumber
            try store.update(current)
            try await staging.release(retained)
            progress(request.offset + request.length)
        }
        try validate()
        do { _ = try await client.request(action: "complete") }
        catch NativeDeferredUploadClient.Failure.partsRetryable {
            // The provider lost a previously acknowledged part. A later
            // bounded retry replays the exact bytes into the same reservation.
            try validate(); current.confirmedParts = 0; try store.update(current)
            throw NativeDeferredUploadClient.Failure.partsRetryable
        }
        try validate()
        current.ready = true; current.armed = false
        try store.update(current)
        if pending().isEmpty { scheduler.cancel(); scheduled = false }
    }
}
