import AppleFileSync
import BackgroundTasks
import Foundation
import Network
import OSLog
import UIKit

/// An already-planned file can survive app suspension and process death.
/// The WebView owns planning and supplies an optional immutable publication
/// guard. Older admissions only stage bytes. The checkpoint contains no
/// account cookies, device credentials, signed URLs, or extra file bytes.
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
    var transferBytes: NativePhotoTransferBytes?
    var publishStarted: Bool?
    var photoRunId: String?

    var configuration: NativeUploadAuthorization.Configuration { request.authorization.configuration }
    var rootId: String { configuration.localRootId }

    func validate() throws {
        guard scope == (try FileSyncOwnerScope(ownerId: scope.ownerId, url: scope.origin)),
              admissionId.range(of: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$", options: .regularExpression) != nil,
              grantRevision.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              confirmedParts >= 0, confirmedParts <= (request.source.fingerprint?.partCount ?? 0),
              !revoked || !armed,
              !ready || (!armed && confirmedParts == request.source.fingerprint?.partCount),
              request.publication == nil || configuration.sourceKind == "photos",
              photoRunId.map({ request.publication != nil && NativePhotoRunRecord.validHandle($0) }) ?? true,
              publishStarted != true || request.publication != nil else {
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
            admissionId == value.admissionId && expiresAt == value.expiresAt && photoRunId == value.photoRunId
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
    static let photoProgressChanged = Notification.Name("com.thingtime.file-sync.photo-progress-changed")
    private let store: NativeDeferredUploadStore
    private let photoRuns: NativePhotoRunStore
    private let scheduler: NativeDeferredUploadScheduling
    private let grants: MobileFolderStore
    private let photos: PhotoLibraryReader
    private let parts: FileUploadPartStore
    private let network = NWPathMonitor()
    private let conditions = NativePhotoDownloadConditions()
    private var registered = false, activated = false, scheduled = false
    private var operation: UUID?
    private var revoking = Set<String>()
    private var persistenceUncertain = false
    private var background: Task<Void, Never>?
    private var batteryObserver: NSObjectProtocol?
    private var activeObserver: NSObjectProtocol?
    private var inactiveObserver: NSObjectProtocol?
    private var transitionObserver: NSObjectProtocol?
    private var nativeWake: Task<Void, Never>?
    private var executionLease: NativePhotoExecutionLease?
    private var nativeExecution = false
    private var activePhotoRun: NativePhotoRunRecord?
    private var photoActivity: (run: NativePhotoRunRecord, value: NativePhotoRunActivity)?
    private var currentFile: (run: NativePhotoRunRecord, confirmed: Int64, total: Int64)?
    private var continuedRun: NativePhotoRunRecord?
    private var continuedRequest: UUID?
    private var activeContinuedRequest: UUID?
    private var continuedCompleted: Int64 = 0
    private var continuedPartial: Int64 = 0
    private var originalsRemaining: Int64?

    init(store: NativeDeferredUploadStore, scheduler: NativeDeferredUploadScheduling,
         grants: MobileFolderStore? = nil, photos: PhotoLibraryReader? = nil, parts: FileUploadPartStore? = nil) {
        self.store = store; self.scheduler = scheduler
        photoRuns = NativePhotoRunStore(directory: store.url.deletingLastPathComponent())
        self.grants = grants ?? MobileFolderStore()
        self.photos = photos ?? PhotoLibraryReader(transport: RustEmbeddedInventoryTransport.default)
        self.parts = parts ?? FileUploadPartStore()
    }

    deinit {
        for observer in [batteryObserver, activeObserver, inactiveObserver, transitionObserver].compactMap({ $0 }) {
            NotificationCenter.default.removeObserver(observer)
        }
        network.cancel()
    }

    func activate(foreground: Bool) {
        guard !activated else { return }
        activated = true
        registered = scheduler.register { [weak self] task in
            guard let self else { task.complete(false); return }
            self.run(task)
        }
        network.pathUpdateHandler = { [weak self, conditions] path in
            let kind = path.status != .satisfied ? "offline" :
                path.usesInterfaceType(.cellular) ? "cellular" : path.usesInterfaceType(.wifi) ? "wifi" :
                path.usesInterfaceType(.wiredEthernet) ? "ethernet" : "unknown"
            let changed = conditions.snapshot().network != kind
            conditions.setNetwork(kind)
            if changed { Task { @MainActor in self?.wakeForLiveConditions() } }
        }
        network.start(queue: DispatchQueue(label: "com.thingtime.file-sync-processing.network"))
        UIDevice.current.isBatteryMonitoringEnabled = true
        func battery() {
            let state = UIDevice.current.batteryState
            conditions.setCharging(state == .charging || state == .full)
        }
        battery()
        batteryObserver = NotificationCenter.default.addObserver(forName: UIDevice.batteryStateDidChangeNotification, object: nil, queue: .main) {
            [weak self] _ in MainActor.assumeIsolated {
                guard let self else { return }
                let state = UIDevice.current.batteryState
                self.conditions.setCharging(state == .charging || state == .full)
                self.wakeForLiveConditions()
            }
        }
        activeObserver = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) {
            [weak self] _ in MainActor.assumeIsolated {
                self?.executionLease?.becameActive()
                self?.startNativeForegroundIfNeeded()
            }
        }
        transitionObserver = NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) {
            [weak self] _ in MainActor.assumeIsolated {
                // This notification never cancels a request. It obtains a
                // short continuation before a possible real background hop.
                self?.executionLease?.startContinuation()
            }
        }
        inactiveObserver = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) {
            [weak self] _ in MainActor.assumeIsolated {
                self?.nativeWake?.cancel(); self?.nativeWake = nil; self?.schedule()
            }
        }
        // A fresh foreground process waits for its web identity; ordinary
        // app switching no longer destroys a healthy admitted checkpoint.
        if foreground { disarm(clearSummaries: false) }
        else { schedule() }
    }

    /// A foreground context change prevents a previous account's queued work
    /// from starting. Only a fresh exact owner/admission handoff re-arms it.
    func disarm(matching scope: FileSyncOwnerScope? = nil, configurationId: String? = nil, rootId: String? = nil,
                clearSummaries: Bool = true) {
        NativeManagedPhotoPartTransfer.shared.cancel(matching: scope, configurationId: configurationId, rootId: rootId)
        if clearSummaries { NativePhotoBackupSummaries.shared.clear(matching: scope, configurationId: configurationId, rootId: rootId) }
        do {
            var records = try store.load()
            let runs = try disarmPhotoRuns(scope: scope, configurationId: configurationId, rootId: rootId)
            let indices = records.indices.filter { i in
                records[i].armed && (scope == nil || records[i].scope == scope) &&
                    (configurationId == nil || records[i].request.authorization.id == configurationId) &&
                    (rootId == nil || records[i].rootId == rootId)
            }
            if scope == nil || !indices.isEmpty || !runs.isEmpty { stopScheduler() }
            guard !indices.isEmpty else { return }
            for index in indices { records[index].armed = false }
            try store.save(records)
        } catch {
            failClosed()
        }
    }

    func verifiedForegroundScope(_ scope: FileSyncOwnerScope) {
        guard let rows = try? store.load() else { return }
        if let other = rows.first(where: { $0.armed && $0.scope != scope })?.scope { disarm(matching: other) }
        if let runs = try? photoRuns.load() {
            for other in runs where other.armed && other.scope != scope { disarm(matching: other.scope) }
        }
        NativePhotoBackupSummaries.shared.resume(verified: scope)
    }

    private func disarmPhotoRuns(scope: FileSyncOwnerScope?, configurationId: String?, rootId: String?, deviceId: String? = nil,
                                 explicitPause: Bool = false) throws -> [NativePhotoRunRecord] {
        var affected: [NativePhotoRunRecord] = []
        for var run in try photoRuns.load() where (run.armed || (explicitPause && run.userPaused != true)) &&
            (scope == nil || run.scope == scope) &&
            (configurationId == nil || run.authorization.id == configurationId) && (rootId == nil || run.rootId == rootId) &&
            (deviceId == nil || run.authorization.scope.deviceId == deviceId) {
            if explicitPause { run.pauseByUser() } else { run.armed = false }
            try photoRuns.write(run); affected.append(run)
        }
        return affected
    }

    @discardableResult
    func armPhotoRun(_ proposed: NativePhotoRunRecord, explicitResume: Bool = false) throws -> Bool {
        try proposed.validate()
        guard activated, (registered || proposed.nativeOwnsRun), !persistenceUncertain,
              proposed.expiresAt > Date(), !revoking.contains(proposed.runId) else {
            throw NativeDeferredUploadClient.Failure.unavailable
        }
        let current = try photoRuns.lookup(proposed)
        if current?.userPaused == true, !explicitResume {
            throw MobileFolderStore.Failure.changed
        }
        var next = proposed
        if let current, current.sameScope(proposed), current.authorization == proposed.authorization {
            // Renewal changes only the handle. The protected queue and
            // reviewed asset selection remain at the same checkpoint.
            next.epoch = current.epoch; next.captureId = current.captureId; next.batch = current.batch
            next.retryAt = current.retryAt; next.retryCloudGaps = current.retryCloudGaps
            next.stage = current.stage; next.syncWait = current.syncWait; next.minimumPartBytes = current.minimumPartBytes
            next.pendingOriginals = current.pendingOriginals; next.unavailableOriginals = current.unavailableOriginals
            next.foregroundOwner = current.nativeOwnsRun || proposed.nativeOwnsRun
            next.activity = current.activity
        }
        if let current, current.sameScope(proposed), current.legacySystemInterruption || current.userPaused == true {
            next.stage = "ready"; next.retryAt = .distantPast
        } else if explicitResume && next.stage == "complete" {
            next.stage = "ready"; next.retryAt = .distantPast
        }
        if let current, current.armed, !current.sameRun(next) {
            NativeManagedPhotoPartTransfer.shared.cancel(matching: current.scope, configurationId: current.authorization.id, rootId: current.rootId)
        }
        try photoRuns.write(next)
        let scheduled = schedule()
        if next.nativeOwnsRun { startNativeForegroundIfNeeded(prioritizing: next) }
        return scheduled
    }

    func ownsPhotoRun(scope: FileSyncOwnerScope, configurationId: String, rootId: String, deviceId: String) -> Bool {
        ((try? photoRuns.load()) ?? []).contains {
            $0.scope == scope && $0.authorization.id == configurationId && $0.rootId == rootId &&
            $0.authorization.scope.deviceId == deviceId && $0.nativeOwnsRun &&
            ($0.legacySystemInterruption || $0.armed && $0.expiresAt > Date())
        }
    }

    func pausePhotoRuns(scope: FileSyncOwnerScope) throws {
        struct Target: Hashable { let root: String; let configuration: String; let device: String }
        let runs = try photoRuns.load().filter { $0.scope == scope && $0.armed }
        let photos = try store.load().filter { $0.scope == scope && $0.configuration.sourceKind == "photos" && $0.armed }
        let targets = Set(runs.map { Target(root: $0.rootId, configuration: $0.authorization.id, device: $0.authorization.scope.deviceId) }
            + photos.map { Target(root: $0.rootId, configuration: $0.request.authorization.id, device: $0.configuration.deviceId) })
        for target in targets {
            try pauseLocally(scope: scope, rootId: target.root, configurationId: target.configuration, deviceId: target.device)
        }
    }

    func photoRunProgress(scope: FileSyncOwnerScope, configurationId: String, rootId: String, deviceId: String) throws -> [String: Any]? {
        guard let run = try photoRuns.load().first(where: {
            $0.scope == scope && $0.authorization.id == configurationId && $0.rootId == rootId &&
            $0.authorization.scope.deviceId == deviceId && $0.nativeOwnsRun
        }), run.armed || run.legacySystemInterruption || run.userPaused == true || run.activity?.reason != nil else { return nil }
        let counts = try NativePhotoBackupSummaries.shared.confirmed(.init(run.authorization, owner: scope))
        var stage = run.stage ?? "ready"
        if run.legacySystemInterruption { stage = "waiting" }
        else if !run.armed { stage = run.stage == "needs-review" ? "needs-review" : "paused" }
        else if run.expiresAt <= Date() { stage = "waiting" }
        else if ["preparing", "uploading"].contains(stage), activePhotoRun?.sameRun(run) != true { stage = "ready" }
        var result: [String: Any] = ["configurationRevision": run.authorization.updatedAt, "stage": stage, "confirmed": [
            "photos": counts.photos, "videos": counts.videos, "other": counts.other,
            "wifiBytes": counts.bytes.wifi, "mobileBytes": counts.bytes.cellular, "unknownBytes": counts.bytes.unknown]]
        if let wait = run.syncWait, stage == "waiting" { result["syncWait"] = wait }
        if !run.legacySystemInterruption, run.retryAt > Date(), run.retryAt < run.expiresAt {
            result["retryAt"] = ISO8601DateFormatter().string(from: run.retryAt)
        }
        if let minimum = run.minimumPartBytes, stage == "waiting" { result["minimumPartBytes"] = minimum }
        if let pending = run.pendingOriginals { result["pendingOriginals"] = pending }
        if let unavailable = run.unavailableOriginals { result["unavailableOriginals"] = unavailable }
        if continuedRun?.sameRun(run) == true && executionLease?.continuedActive == true { result["continuation"] = "active" }
        if var activity = activity(for: run)?.snapshot() ?? run.activity {
            if activePhotoRun?.sameRun(run) != true { activity.cloudPreparationFraction = nil }
            if ["waiting", "paused", "needs-review"].contains(stage) {
                activity.phase = .waiting
                activity.downloadFraction = nil
            }
            if activity.backgroundRequest == .active, result["continuation"] as? String != "active" {
                activity.backgroundRequest = nil
            }
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            result["activity"] = try JSONSerialization.jsonObject(with: encoder.encode(activity))
        }
        if let current = currentFile, current.run.sameRun(run), stage == "uploading" {
            let active = NativeManagedPhotoPartTransfer.shared.activeMeasurement(scope: scope, configurationId: configurationId,
                rootId: rootId, deviceId: deviceId)
            result["currentFile"] = ["confirmedBytes": current.confirmed, "sentBytes": min(current.total, current.confirmed + (active?.sent ?? 0)), "totalBytes": current.total]
            if let rate = active?.uploadBytesPerSecond { result["uploadBytesPerSecond"] = rate }
        }
        return result
    }

    func requestContinuedPhotoRun(scope: FileSyncOwnerScope, rootId: String, configurationId: String, deviceId: String,
                                  configurationRevision: String) async throws -> String {
        guard #available(iOS 26.0, *) else { return "declined" }
        guard var run = try photoRuns.load().first(where: {
            $0.scope == scope && $0.rootId == rootId && $0.authorization.id == configurationId &&
            $0.authorization.scope.deviceId == deviceId && $0.authorization.updatedAt == configurationRevision && $0.nativeOwnsRun
        }), run.expiresAt > Date(), run.armed else { return "waiting" }
        guard UIApplication.shared.applicationState == .active else {
            recordBackgroundRequest(run, .declined); return "declined"
        }
        if continuedRun?.sameRun(run) == true && executionLease?.continuedActive == true { return "active" }
        guard continuedRequest == nil, continuedRun == nil else {
            recordBackgroundRequest(run, .declined); return "declined"
        }
        if run.stage == "complete", activePhotoRun?.sameRun(run) != true { return "complete" }
        if run.stage == "needs-review" || (run.syncWait == "data-budget" && run.retryAt > Date()) {
            recordBackgroundRequest(run, .waiting); return "waiting"
        }
        guard (try? conditions.verify(run.authorization)) != nil else {
            recordBackgroundRequest(run, .waiting); return "waiting"
        }
        if run.retryAt > Date() {
            run.stage = "ready"; run.retryAt = .distantPast
            try photoRuns.write(run)
        }
        startNativeForegroundIfNeeded(prioritizing: run)
        guard nativeExecution, activePhotoRun?.sameRun(run) == true, let executionLease else {
            recordBackgroundRequest(run, .declined); return "declined"
        }
        let id = UUID(), requestedRun = run
        continuedRequest = id
        defer { if continuedRequest == id { continuedRequest = nil } }
        let lease = await NativeUploadBackgroundCoordinator.shared.begin(presentation: .init(title: "Thingtime Photos backup",
            subtitle: "Checking this backup…", completedSubtitle: "Photos backup finished", bytes: nil), expired: { [weak self, weak executionLease] in
                guard let self, let executionLease, self.executionLease === executionLease else { return }
                self.interruptContinuedRun(requestedRun, request: id)
            })
        guard let lease else {
            if let latest = try? photoRuns.lookup(run), latest.sameRun(run),
               latest.activity?.reason == .interrupted { return "waiting" }
            recordBackgroundRequest(run, .declined); return "declined"
        }
        // The owner can pause, revoke or replace the run while iOS decides
        // whether to grant this lease. Recheck the durable authorization.
        let latest = try? photoRuns.lookup(run)
        guard let latest, latest.sameRun(run), latest.armed, latest.expiresAt > Date(),
              background?.isCancelled == false, self.executionLease === executionLease,
              activePhotoRun?.sameRun(run) == true, executionLease.attachContinued(lease) else {
            lease.finish(success: false)
            if let latest, latest.sameRun(run) {
                if latest.stage == "complete" { return "complete" }
                if latest.activity?.reason == .interrupted { return "waiting" }
            }
            recordBackgroundRequest(run, .declined); return "declined"
        }
        continuedRun = requestedRun; activeContinuedRequest = id
        continuedCompleted = 0; continuedPartial = 0
        recordBackgroundRequest(requestedRun, .active)
        reportContinuedWork(requestedRun, subtitle: "Checking Photos originals…")
        return "active"
    }

    private func activity(for run: NativePhotoRunRecord) -> NativePhotoRunActivity? {
        photoActivity?.run.sameRun(run) == true ? photoActivity?.value : nil
    }

    private func recordBackgroundRequest(_ requested: NativePhotoRunRecord, _ result: NativePhotoRunActivity.BackgroundRequest) {
        guard var run = try? photoRuns.lookup(requested), run.sameRun(requested) else { return }
        let observed = activity(for: requested) ?? NativePhotoRunActivity(run.activity)
        if run.activity == nil && activePhotoRun?.sameRun(run) != true { observed.phase(.waiting) }
        observed.background(result)
        run.activity = observed.snapshot()
        try? photoRuns.write(run)
        reportPhotoProgress(run)
    }

    private func interruptContinuedRun(_ expected: NativePhotoRunRecord, request: UUID) {
        guard continuedRequest == request || (activeContinuedRequest == request && continuedRun?.sameRun(expected) == true),
              activePhotoRun?.sameRun(expected) == true,
              var live = try? photoRuns.lookup(expected), live.sameRun(expected), live.armed else { return }
        live.deferAfterSystemInterruption()
        let observed = activity(for: live) ?? NativePhotoRunActivity(live.activity)
        observed.phase(.waiting, reason: .interrupted)
        _ = observed.cloudPreparation(nil)
        observed.background(.waiting)
        live.activity = observed.snapshot()
        // Apple delivers expiration and its own cancellation through this
        // callback. End this lease, retaining the saved automatic policy.
        do { try photoRuns.write(live) } catch { failClosed(); return }
        NativeManagedPhotoPartTransfer.shared.cancel(matching: live.scope, configurationId: live.authorization.id,
            rootId: live.rootId, deviceId: live.authorization.scope.deviceId)
        executionLease?.finishContinued(false); continuedRun = nil; activeContinuedRequest = nil
        stopScheduler()
        schedule(minimumDelay: 300); reportPhotoProgress(live)
    }

    private func reportContinuedWork(_ run: NativePhotoRunRecord, subtitle: String) {
        guard continuedRun?.sameRun(run) == true else { return }
        // One original is one unit of work. Give the system real partial
        // progress within large originals while reserving the final fraction
        // for verification and the canonical publication receipt.
        let unitsPerOriginal: Int64 = 10_000
        // Discovery advances measured units even before we know the backup
        // backlog. Leave the overall total indeterminate during discovery.
        let indexing = activity(for: run)?.measuredIndexingWork() ?? 0
        let total = originalsRemaining.map { (indexing + continuedCompleted + $0) * unitsPerOriginal }.flatMap { $0 > 0 ? $0 : nil }
        executionLease?.continuedProgress(completed: (indexing + continuedCompleted) * unitsPerOriginal + continuedPartial,
                                           total: total, subtitle: subtitle)
    }

    private func reportContinuedBytes(_ run: NativePhotoRunRecord, sent: Int64, size: Int64) {
        guard continuedRun?.sameRun(run) == true, size > 0 else { return }
        let fraction = min(1, max(0, Double(sent) / Double(size)))
        continuedPartial = max(continuedPartial, min(9_999, Int64(fraction * 10_000)))
        let display = ByteCountFormatter.string(fromByteCount: sent, countStyle: .decimal)
        reportContinuedWork(run, subtitle: "\(continuedCompleted) originals checked · \(display) sent")
    }

    private func finishContinuedRun(_ run: NativePhotoRunRecord, success: Bool) {
        guard continuedRun?.sameRun(run) == true else { return }
        executionLease?.finishContinued(success); continuedRun = nil; activeContinuedRequest = nil
        reportPhotoProgress(run)
    }

    private func reportPhotoProgress(_ run: NativePhotoRunRecord, immediately: Bool = false) {
        if run.nativeOwnsRun {
            NotificationCenter.default.post(name: Self.photoProgressChanged, object: nil, userInfo: ["immediate": immediately])
        }
    }

    private func stopScheduler() {
        scheduler.cancel(); scheduled = false; background?.cancel()
        nativeWake?.cancel(); nativeWake = nil
    }

    private func failClosed() {
        persistenceUncertain = true
        stopScheduler()
    }

    /// Local Pause is durable without an internet round trip. Server revocation
    /// uses only the exact immutable admissions captured by that pause.
    func pauseLocally(scope: FileSyncOwnerScope, rootId: String, configurationId: String, deviceId: String, explicitPause: Bool = false) throws {
        NativeManagedPhotoPartTransfer.shared.cancel(matching: scope, configurationId: configurationId, rootId: rootId, deviceId: deviceId)
        NativePhotoBackupSummaries.shared.clear(matching: scope, configurationId: configurationId)
        var records: [NativeDeferredUploadRecord]
        let runs: [NativePhotoRunRecord]
        do {
            records = try store.load()
            runs = try disarmPhotoRuns(scope: scope, configurationId: configurationId, rootId: rootId, deviceId: deviceId,
                                       explicitPause: explicitPause)
        }
        catch { failClosed(); throw NativeDeferredUploadStore.Failure.pausePersistence }
        let indices = records.indices.filter { i in
            let record = records[i]
            return record.scope == scope && record.rootId == rootId && record.request.authorization.id == configurationId &&
                record.configuration.deviceId == deviceId && !record.ready
        }
        guard !indices.isEmpty || !runs.isEmpty else { return }
        let toRevoke = indices.map { records[$0] }.filter { !$0.revoked && $0.expiresAt > Date() && !revoking.contains($0.admissionId) }
        for index in indices { records[index].armed = false }
        stopScheduler()
        do { try store.save(records) }
        catch { failClosed(); throw NativeDeferredUploadStore.Failure.pausePersistence }
        schedule(); startNativeForegroundIfNeeded()
        for record in toRevoke { revoking.insert(record.admissionId) }
        for run in runs { revoking.insert(run.runId) }
        Task { [weak self] in
            guard let self else { return }
            for run in runs {
                defer { self.revoking.remove(run.runId) }
                _ = try? await NativeDeferredUploadClient(photoRun: run).photoRunRequest(["action": "revoke-photo-run", "runId": run.runId])
            }
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
        if proposed.configuration.managedPhotos?.notificationInterval == 0 {
            NativePhotoBackupSummaries.shared.clear(matching: proposed.scope, configurationId: proposed.request.authorization.id)
        }
        guard (registered || (proposed.photoRunId != nil && nativeExecution)),
              proposed.expiresAt > Date(), !revoking.contains(proposed.admissionId) else { return false }
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
            if let prior {
                next.confirmedParts = prior.confirmedParts; next.transferBytes = prior.transferBytes
                next.publishStarted = prior.publishStarted
            }
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
                ($0.armed || $0.ready) && $0.expiresAt > Date()
        }
    }

    private func pending(now: Date = Date()) -> [NativeDeferredUploadRecord] {
        guard !persistenceUncertain else { return [] }
        return ((try? store.load()) ?? []).filter { $0.armed && !$0.ready && $0.expiresAt > now && $0.retryAt < $0.expiresAt }
    }
    private func pendingRuns(now: Date = Date()) -> [NativePhotoRunRecord] {
        guard !persistenceUncertain else { return [] }
        return ((try? photoRuns.load()) ?? []).filter { $0.armed && $0.expiresAt > now && $0.retryAt < $0.expiresAt }
    }

    @discardableResult
    func schedule(minimumDelay: TimeInterval = 10) -> Bool {
        if scheduled { return true }
        let candidates = pending().filter { $0.photoRunId == nil }.map { ($0.retryAt, $0.configuration.chargingOnly) } +
            pendingRuns().map { ($0.retryAt, $0.authorization.configuration.chargingOnly) }
        guard registered, let next = candidates.min(by: { $0.0 < $1.0 }) else { return false }
        do {
            try scheduler.submit(earliest: max(Date(timeIntervalSinceNow: minimumDelay), next.0), charging: candidates.allSatisfy { $0.1 })
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
        // Compatibility callers may borrow a legacy transfer slot. They never
        // cancel an exclusive native Photos worker on app foregrounding.
        guard !nativeExecution else { return }
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

    func run(_ task: NativeDeferredUploadSystemTask, checkExecution: (() throws -> Void)? = nil) {
        scheduled = false
        if nativeExecution, let executionLease {
            if !executionLease.attach(task) { task.complete(false) }
            schedule(minimumDelay: 300)
            return
        }
        let ready = pending().filter { $0.photoRunId == nil && $0.retryAt <= Date() }
        let runs = pendingRuns().filter { $0.retryAt <= Date() }.sorted { $0.retryAt < $1.retryAt }
        guard background == nil, operation == nil, !ready.isEmpty || !runs.isEmpty else {
            task.complete(false); schedule(); return
        }
        let soleNative = ready.isEmpty && !runs.isEmpty && runs.allSatisfy(\.nativeOwnsRun)
        launch(ready: ready, runs: runs, nativeOnly: soleNative, system: task, checkExecution: checkExecution)
    }

    private func startNativeForegroundIfNeeded(prioritizing preferred: NativePhotoRunRecord? = nil) {
        guard activated, UIApplication.shared.applicationState != .background, background == nil, operation == nil else { return }
        nativeWake?.cancel(); nativeWake = nil
        let now = Date(), eligible = pendingRuns().filter(\.nativeOwnsRun).sorted { $0.retryAt < $1.retryAt }
        var runs = eligible.filter { $0.retryAt <= now }
        if let preferred, let index = runs.firstIndex(where: { $0.sameRun(preferred) }), index != runs.startIndex {
            let selected = runs.remove(at: index)
            runs.insert(selected, at: runs.startIndex)
        }
        if !runs.isEmpty {
            launch(ready: [], runs: runs, nativeOnly: true, system: nil)
        } else if let next = eligible.first {
            let delay = max(1, next.retryAt.timeIntervalSince(now))
            nativeWake = Task { [weak self] in
                do { try await Task.sleep(for: .seconds(delay)) } catch { return }
                self?.nativeWake = nil; self?.startNativeForegroundIfNeeded()
            }
        }
    }

    private func wakeForLiveConditions() {
        if let runs = try? photoRuns.load() {
            for var run in runs where run.armed && run.nativeOwnsRun && ["offline", "network", "wifi", "charging"].contains(run.syncWait ?? "") {
                if (try? conditions.verify(run.authorization)) != nil {
                    run.retryAt = .distantPast; run.syncWait = nil; run.stage = "ready"
                    try? photoRuns.update(run)
                }
            }
        }
        startNativeForegroundIfNeeded()
    }

    private func launch(ready: [NativeDeferredUploadRecord], runs: [NativePhotoRunRecord], nativeOnly: Bool,
                        system: NativeDeferredUploadSystemTask?, checkExecution: (() throws -> Void)? = nil) {
        // Arm the next opportunistic slice before processing, so the OS can
        // terminate this process immediately at expiration without losing it.
        schedule(minimumDelay: 300)
        let lease = NativePhotoExecutionLease(foregroundAllowed: nativeOnly)
        executionLease = lease; nativeExecution = nativeOnly
        // Reserve the exact first run before the worker's first scheduling
        // hop so a user gesture can request its lease immediately.
        if nativeOnly { activePhotoRun = runs.first }
        if let system { _ = lease.attach(system) }
        if nativeOnly && UIApplication.shared.applicationState == .inactive { lease.startContinuation() }
        lease.expired = { [weak self] in self?.background?.cancel() }
        let check = {
            try lease.check()
            if let checkExecution { try checkExecution() }
            else if !nativeOnly && UIApplication.shared.applicationState != .background { throw CancellationError() }
        }
        background = Task { [weak self] in
            guard let self else { lease.finish(false); return }
            defer {
                self.background = nil; self.executionLease = nil; self.nativeExecution = false; self.activePhotoRun = nil; self.currentFile = nil
                self.continuedRun = nil; self.activeContinuedRequest = nil; self.originalsRemaining = nil; self.photoActivity = nil
                self.schedule(); self.startNativeForegroundIfNeeded()
            }
            var success = true
            for current in ready {
                do {
                    try Task.checkCancellation()
                    let grant = try self.grants.grant(current.scope, id: current.rootId)
                    let download = self.conditions.control(for: current.request.authorization)
                    let staging = NativeUploadPartStaging(scope: current.scope, grant: grant, photos: self.photos, store: self.parts, download: download)
                    try await self.advance(current, staging: staging, check: check, progress: { _ in })
                } catch {
                    success = false
                    if var saved = try? self.store.lookup(current), saved.armed, !saved.ready {
                        if (error as? NativeDeferredUploadClient.Failure)?.terminal == true ||
                            (error as? MobileFolderStore.Failure) == .changed {
                            saved.armed = false
                        } else {
                            // Back off on iOS expiry, Wi-Fi, power, or lost
                            // response. Foreground resume can bypass the delay.
                            saved.retryAt = max(Date(timeIntervalSinceNow: 300), (error as? NativePhotoUploadBudget.Wait)?.retryAt ?? .distantPast)
                        }
                        try? self.store.update(saved)
                    }
                    if Task.isCancelled || error is NativeUploadAuthorization.Wait || error is NativePhotoUploadBudget.Wait { break }
                }
            }
            for run in runs where !Task.isCancelled {
                do {
                    try await self.advancePhotoRun(run, checkExecution: check)
                    let latest = try self.photoRuns.lookup(run)
                    self.finishContinuedRun(run, success: latest?.stage == "complete")
                }
                catch {
                    success = false
                    self.finishContinuedRun(run, success: false)
                    if var saved = try? self.photoRuns.lookup(run), saved.sameRun(run), saved.armed {
                        if Task.isCancelled, saved.activity?.reason == .interrupted { continue }
                        if (error as? PhotoLibraryReader.Failure) == .changed {
                            saved.captureId = nil; saved.batch = nil; saved.pendingOriginals = nil
                        }
                        if (error as? NativeDeferredUploadClient.Failure)?.terminal == true || (error as? MobileFolderStore.Failure) == .changed {
                            saved.armed = false
                            saved.stage = "needs-review"
                        } else {
                            let budget = error as? NativePhotoUploadBudget.Wait
                            let conditions = error as? NativeUploadAuthorization.Wait
                            saved.retryAt = max(saved.retryAt, Date(timeIntervalSinceNow: 300), budget?.retryAt ?? .distantPast)
                            saved.stage = (error as? NativeDeferredUploadClient.Failure) == .photoPathConflict ? "needs-review" : "waiting"
                            saved.syncWait = budget == nil ? conditions?.rawValue : "data-budget"
                            saved.minimumPartBytes = budget?.minimumPartBytes
                        }
                        let observed = self.activity(for: run) ?? NativePhotoRunActivity(saved.activity)
                        observed.phase(.waiting, reason: NativePhotoRunActivity.reason(for: error))
                        if observed.snapshot().backgroundRequest == .active { observed.background(.waiting) }
                        saved.activity = observed.snapshot()
                        try? self.photoRuns.update(saved)
                        self.reportPhotoProgress(saved)
                    }
                }
            }
            lease.finish(success)
        }
    }

    private func advance(_ proposed: NativeDeferredUploadRecord, staging: NativeUploadPartStaging,
                         check: @escaping () throws -> Void, photoPhase: (NativePhotoRunActivity.Phase) -> Void = { _ in },
                         photoPulse: ((Int64) -> Void)? = nil,
                         progress: (Int64) -> Void) async throws {
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
            try self.conditions.verify(proposed.request.authorization)
        }
        let client = NativeDeferredUploadClient(record: proposed)
        try validate(); try await client.requireCapability(); try validate()
        photoPhase(.checkingOriginals)
        try await staging.verify(proposed.request.source); try validate()
        let plan = try FileUploadPart.plan(size: proposed.request.source.size)
        if current.confirmedParts > 0 {
            progress(min(proposed.request.source.size, Int64(current.confirmedParts) * plan.partSize))
        }
        while current.confirmedParts < plan.count {
            try validate()
            let request = try proposed.request.part(current.confirmedParts + 1)
            photoPhase(.checkingOriginals)
            let (retained, part) = try await staging.prepare(request)
            try validate()
            photoPhase(.uploading)
            let pulse = photoPulse.map { observer in
                Task { @MainActor in
                    while !Task.isCancelled {
                        do { try await Task.sleep(for: .seconds(1)) } catch { return }
                        if let measured = NativeManagedPhotoPartTransfer.shared.activeMeasurement(scope: proposed.scope,
                            configurationId: proposed.request.authorization.id, rootId: proposed.rootId,
                            deviceId: proposed.request.authorization.scope.deviceId) {
                            observer(request.offset + min(request.length, measured.sent))
                        }
                    }
                }
            }
            defer { pulse?.cancel() }
            try await client.send(part: part, partNumber: request.partNumber, conditions: conditions, check: validate) { bytes in
                guard var live = try self.store.lookup(proposed) else { return }
                var transfer = live.transferBytes ?? .init(); transfer.add(bytes)
                live.transferBytes = transfer
                try self.store.update(live)
                current.transferBytes = transfer
            }
            try validate(); try await staging.verify(proposed.request.source); try validate()
            current.confirmedParts = request.partNumber
            try store.update(current)
            try await staging.release(retained)
            progress(request.offset + request.length)
        }
        try validate(); photoPhase(.publishing)
        do { _ = try await client.request(action: "complete") }
        catch NativeDeferredUploadClient.Failure.partsRetryable {
            // The provider lost a previously acknowledged part. A later
            // bounded retry replays the exact bytes into the same reservation.
            try validate(); current.confirmedParts = 0; try store.update(current)
            throw NativeDeferredUploadClient.Failure.partsRetryable
        }
        try validate()
        if proposed.request.publication != nil {
            let original = try await staging.photoOriginalIdentity(proposed.request.source)
            try validate()
            let recovering = current.publishStarted == true
            current.publishStarted = true
            try store.update(current)
            let published = try await client.request(action: "publish")
            try validate()
            if published["replayed"] as? Bool == false || recovering || (current.transferBytes?.total ?? 0) > 0 {
                try NativePhotoBackupSummaries.shared.record(current, original: original)
            }
        }
        current.ready = true; current.armed = false
        try store.update(current)
        if pending().isEmpty && pendingRuns().isEmpty { scheduler.cancel(); scheduled = false }
    }

    private func advancePhotoRun(_ proposed: NativePhotoRunRecord, checkExecution: @escaping () throws -> Void) async throws {
        guard var run = try photoRuns.lookup(proposed), run.sameRun(proposed), run.armed else { throw CancellationError() }
        activePhotoRun = proposed
        defer { activePhotoRun = nil; currentFile = nil; originalsRemaining = nil }
        let activity = NativePhotoRunActivity(run.activity)
        photoActivity = (proposed, activity)
        _ = activity.cloudPreparation(nil)
        activity.phase(.verifying)
        func checkpoint() throws {
            run.activity = activity.snapshot()
            try photoRuns.update(run)
        }
        run.stage = "preparing"; run.syncWait = nil; run.minimumPartBytes = nil
        try checkpoint()
        reportPhotoProgress(run)
        let authorization = run.authorization, conditions = self.conditions, photos = self.photos, parts = self.parts
        let queue = run.queue, photoScope = run.photoScope, startWithSingleAsset = run.nativeOwnsRun
        let announce: @Sendable (Bool) -> Void = { [weak self] immediately in
            Task { @MainActor [weak self] in
                guard let self, self.activePhotoRun?.sameRun(proposed) == true, self.activity(for: proposed) === activity else { return }
                self.reportPhotoProgress(proposed, immediately: immediately)
                let snapshot = activity.snapshot()
                switch snapshot.phase {
                case .indexing:
                    let subtitle: String
                    if let indexing = snapshot.indexing {
                        if indexing.unit == .assets {
                            let kind = snapshot.latestFound.map { " · \($0.kind.rawValue)" } ?? ""
                            let time = snapshot.latestFound?.capturedAt.map { " taken \($0.formatted(date: .omitted, time: .standard))" } ?? ""
                            subtitle = "Found \(indexing.completed) of \(indexing.total) assets\(kind)\(time)"
                        } else {
                            subtitle = "Indexed \(indexing.completed) of \(indexing.total) original records"
                        }
                    } else { subtitle = "Indexing Photo Library…" }
                    self.reportContinuedWork(proposed, subtitle: subtitle)
                case .downloading:
                    let percent = snapshot.downloadFraction.map { " · \(Int($0 * 100))%" } ?? ""
                    self.reportContinuedWork(proposed, subtitle: "Downloading an iCloud original\(percent)")
                case .checkingOriginals:
                    self.reportContinuedWork(proposed, subtitle: "Checking Photos originals…")
                case .publishing: self.reportContinuedWork(proposed, subtitle: "Verifying the saved cloud copy…")
                case .waiting:
                    if let fraction = snapshot.cloudPreparationFraction {
                        self.reportContinuedWork(proposed, subtitle: "Downloading an iCloud original · \(Int(fraction * 100))%")
                    }
                default: break
                }
            }
        }
        let client = NativeDeferredUploadClient(photoRun: run)
        let check = {
            try Task.checkCancellation(); try checkExecution()
            guard !self.persistenceUncertain, let live = try self.photoRuns.lookup(proposed), live.sameRun(proposed),
                  live.armed, live.expiresAt > Date() else { throw CancellationError() }
            let grant = try self.grants.grant(proposed.scope, id: proposed.rootId)
            guard grant.sourceKind == "photos", NativeUploadPartStaging.grantRevision(grant) == proposed.grantRevision,
                  photos.access() != "unavailable" else { throw MobileFolderStore.Failure.changed }
            try conditions.verify(authorization)
            return grant
        }
        let authorize = {
            _ = try check()
            _ = try await client.photoRunRequest(["action": "check-photo-run", "runId": proposed.runId])
            _ = try check()
        }
        let grant = try check()
        let control = conditions.control(for: authorization)
        let download = control?.reporting { fraction in
            if activity.download(fraction) { announce(false) }
        }
        var cloudWork: Task<Void, Never>?
        var preparedCloud: PhotoLibraryReader.PreparedCloudOriginal?
        var cloudFailure: Error?
        defer {
            cloudWork?.cancel()
            _ = activity.cloudPreparation(nil)
            if let preparedCloud { photos.releaseDeferredCloudOriginal(preparedCloud) }
        }
        func deferredOriginalsRemain() async throws -> Bool {
            let pending = Task.detached { try photos.hasDeferredCloudOriginals(scope: photoScope, request: queue) }
            return try await withTaskCancellationHandler(operation: { try await pending.value }, onCancel: { pending.cancel() })
        }
        func startCloudWork() async throws {
            guard startWithSingleAsset, cloudWork == nil, preparedCloud == nil else { return }
            let next = Task.detached { try photos.nextDeferredCloudOriginal(scope: photoScope, request: queue) }
            guard let original = try await withTaskCancellationHandler(operation: { try await next.value }, onCancel: { next.cancel() }) else { return }
            _ = try check()
            cloudFailure = nil
            let reporting = control?.reporting { fraction in
                if activity.cloudPreparation(fraction) { announce(false) }
            }
            let read = Task.detached {
                try photos.prepareDeferredCloudOriginal(scope: photoScope, resource: original, control: reporting,
                    authorize: { try conditions.verify(authorization) })
            }
            cloudWork = Task { @MainActor in
                var authorityError: Error?
                let watchdog = Task {
                    while !Task.isCancelled {
                        do { try await Task.sleep(for: .seconds(15)); try await authorize() }
                        catch {
                            if !Task.isCancelled { authorityError = error; read.cancel() }
                            return
                        }
                    }
                }
                defer {
                    watchdog.cancel(); cloudWork = nil
                    if activity.cloudPreparation(nil) { announce(false) }
                }
                do {
                    let ready = try await withTaskCancellationHandler(operation: { try await read.value }, onCancel: { read.cancel() })
                    try Task.checkCancellation()
                    try await authorize()
                    preparedCloud = ready
                } catch {
                    if !Task.isCancelled { cloudFailure = authorityError ?? error }
                }
            }
        }
        if run.retryCloudGaps, run.batch == nil {
            try await authorize()
            let retainedDeferred = startWithSingleAsset ? try await deferredOriginalsRemain() : false
            if !retainedDeferred {
                let retry = Task.detached { try photos.retryUnavailableQueueOriginals(scope: photoScope, request: queue) }
                try await withTaskCancellationHandler(operation: { try await retry.value }, onCancel: { retry.cancel() })
            }
            _ = try check()
            run.retryCloudGaps = false; try checkpoint()
        }

        while true {
            try await authorize()
            if run.batch == nil { try await startCloudWork() }
            if run.batch == nil {
                activity.phase(.indexing)
                reportPhotoProgress(run)
                reportContinuedWork(run, subtitle: "Indexing Photo Library…")
                if run.captureId == nil {
                    run.captureId = UUID().uuidString.lowercased()
                    try checkpoint()
                }
                let id = run.captureId!, selectedDeferred = preparedCloud
                let preparation = Task.detached {
                    if let sealed = try photos.status(scope: photoScope, id: id, allowCloudGaps: true, queueRequest: queue) {
                        return sealed
                    }
                    // A prior process may have died during a scanning
                    // generation. Only its exact unsealed capture is replaced;
                    // the reviewed asset selection and receipts stay intact.
                    try photos.discard(scope: photoScope, capture: .init(id: id, generation: id, totalEntries: 0))
                    let capture = try photos.prepareCapture(scope: photoScope, id: id, generation: id, allowCloudGaps: true,
                        download: startWithSingleAsset ? nil : download, queueRequest: queue, startWithSingleAsset: startWithSingleAsset,
                        preparedDeferred: selectedDeferred, activity: { progress in
                            if activity.capture(progress) {
                                if case .enumerating(let discovery) = progress { announce(discovery.inspected == 1 && discovery.latest != nil) }
                                else { announce(false) }
                            }
                        }, authorize: { try conditions.verify(authorization) })
                    try conditions.verify(authorization)
                    return try photos.sealCapture(scope: photoScope, capture: capture)
                }
                var authorizationFailure: Error?
                let watchdog = Task {
                    while !Task.isCancelled {
                        do { try await Task.sleep(for: .seconds(15)); try await authorize() }
                        catch {
                            if !Task.isCancelled { authorizationFailure = error; preparation.cancel() }
                            return
                        }
                    }
                }
                defer { watchdog.cancel() }
                let capture: MobileFolderInventory.Capture
                do { capture = try await withTaskCancellationHandler(operation: { try await preparation.value }, onCancel: { preparation.cancel() }) }
                catch {
                    if let failure = error as? PhotoLibraryReader.Failure, case .changed = failure {
                        run.captureId = nil; try checkpoint()
                    }
                    throw authorizationFailure ?? error
                }
                try await authorize()
                guard let batch = capture.photoQueue, batch.epoch == run.epoch else { throw MobileFolderStore.Failure.changed }
                run.batch = batch
                run.pendingOriginals = batch.remainingKnown == false ? nil : batch.pending
                run.unavailableOriginals = batch.unavailable
                try checkpoint()
            }
            guard let batch = run.batch, let id = run.captureId else { throw MobileFolderStore.Failure.invalid }
            let staging = NativeUploadPartStaging(scope: run.scope, grant: grant, photos: photos, store: parts,
                download: cloudWork == nil ? download : nil)
            let read = Task.detached { try photos.queueBatchEntries(scope: photoScope, request: queue, batchId: batch.id) }
            let originals = try await withTaskCancellationHandler(operation: { try await read.value }, onCancel: { read.cancel() })
            originalsRemaining = batch.remainingKnown == false ? nil : Int64(batch.pending) + Int64(originals.count)
            activity.backlog(originalsRemaining)
            reportContinuedWork(proposed, subtitle: "\(continuedCompleted) originals checked")
            for source in originals {
                _ = try check()
                activity.phase(.checkingCloud)
                reportPhotoProgress(run)
                let retained = try store.load().first { $0.photoRunId == run.runId && $0.request.source == source && $0.expiresAt > Date() && ($0.ready || $0.armed) }
                let next: NativeDeferredUploadRecord?
                if let retained { next = retained }
                else { next = try await reservePhotoOriginal(source, run: run, client: client) }
                _ = try check()
                if let next {
                    if !next.ready {
                        if retained == nil, try !enqueue(next) { throw NativeDeferredUploadClient.Failure.unavailable }
                        run.stage = "uploading"; try checkpoint()
                        currentFile = (proposed, 0, source.size)
                        reportPhotoProgress(run)
                        defer { currentFile = nil }
                        try await advance(next, staging: staging, check: { _ = try check() }, photoPhase: { phase in
                            if activity.phase(phase) { announce(false) }
                        }, photoPulse: { bytes in
                            self.reportPhotoProgress(proposed)
                            self.reportContinuedBytes(proposed, sent: bytes, size: source.size)
                        }, progress: { bytes in
                            self.currentFile = (proposed, bytes, source.size)
                            self.reportPhotoProgress(proposed)
                            self.reportContinuedBytes(proposed, sent: bytes, size: source.size)
                        })
                    }
                } else if let identity = try await staging.photoOriginalIdentity(source) {
                    _ = try check()
                    try? NativePhotoBackupSummaries.shared.observe(.init(authorization, owner: run.scope), originals: [identity])
                }
                if let remaining = originalsRemaining {
                    originalsRemaining = max(0, remaining - 1)
                    activity.backlog(max(0, remaining - 1))
                }
                if continuedRun?.sameRun(proposed) == true { continuedCompleted += 1; continuedPartial = 0 }
                reportContinuedWork(proposed, subtitle: "\(continuedCompleted) originals checked")
            }
            try await authorize()
            let finish = Task.detached { try photos.finishQueueBatch(scope: photoScope, request: queue, batchId: batch.id) }
            try await withTaskCancellationHandler(operation: { try await finish.value }, onCancel: { finish.cancel() })
            _ = try check()
            run.captureId = nil; run.batch = nil
            if let ready = preparedCloud, batch.assetKeys.contains(ready.assetKey) {
                photos.releaseDeferredCloudOriginal(ready)
                preparedCloud = nil
            }
            let finished = batch.remainingKnown != false && batch.assetKeys.isEmpty && batch.pending == 0
            if finished {
                let retainedDeferred = startWithSingleAsset ? try await deferredOriginalsRemain() : false
                let complete = batch.unavailable == 0 && !retainedDeferred
                run.retryAt = Date(timeIntervalSinceNow: 300)
                run.retryCloudGaps = !complete
                run.stage = complete ? "complete" : "waiting"
                activity.phase(complete ? .complete : .waiting, reason: cloudFailure.flatMap(NativePhotoRunActivity.reason(for:)))
                if activity.snapshot().backgroundRequest == .active && (complete || cloudWork == nil && preparedCloud == nil) {
                    activity.background(complete ? .complete : .waiting)
                }
            } else {
                run.stage = "preparing"
            }
            try checkpoint()
            reportPhotoProgress(run)
            // The PhotoKit selection receipt is durable. Release only the
            // consumed temporary index generation and keep the next cursor.
            let cleanup = Task.detached { try? photos.discard(scope: photoScope, capture: .init(id: id, generation: id, totalEntries: 0)) }
            await cleanup.value
            if finished {
                if let cloudWork {
                    await withTaskCancellationHandler(operation: { await cloudWork.value }, onCancel: { cloudWork.cancel() })
                }
                try Task.checkCancellation()
                if preparedCloud != nil {
                    run.retryAt = .distantPast; run.retryCloudGaps = false; run.stage = "ready"
                    try checkpoint()
                    continue
                }
                if let cloudFailure {
                    activity.phase(.waiting, reason: NativePhotoRunActivity.reason(for: cloudFailure))
                    try checkpoint(); reportPhotoProgress(run)
                }
                return
            }
        }
    }

    private func reservePhotoOriginal(_ source: MobileFolderReader.Entry, run: NativePhotoRunRecord,
                                      client: NativeDeferredUploadClient) async throws -> NativeDeferredUploadRecord? {
        guard source.kind == "file", !source.path.contains("/"), source.size > 0, let fingerprint = source.fingerprint else {
            throw MobileFolderStore.Failure.invalid
        }
        var body: [String: Any] = ["action": "reserve-photo-original", "runId": run.runId,
            "path": source.path, "sourceVersion": source.version, "sizeBytes": source.size,
            "fingerprint": ["partSizeBytes": fingerprint.partSizeBytes, "partCount": fingerprint.partCount, "sha256": fingerprint.sha256]]
        if run.nativeOwnsRun { body["guardedReplacement"] = true }
        let result = try await client.photoRunRequest(body)
        if result["state"] as? String == "already-backed" { return nil }
        guard result["state"] as? String == "reserved", let uploadId = result["uploadId"] as? String,
              let requestId = result["requestId"] as? String, let admission = result["admissionId"] as? String,
              let raw = result["expiresAt"] as? String, let expiry = MobileDevicePairing.date(raw), expiry > Date(), expiry <= run.expiresAt,
              let publication = result["publication"] as? [String: Any] else { throw NativeDeferredUploadClient.Failure.invalid }
        let returned = try JSONDecoder().decode(NativeUploadFileRequest.Publication.self, from: JSONSerialization.data(withJSONObject: publication))
        let fileId = result["fileId"] as? String
        if run.nativeOwnsRun {
            guard let fileId, NativePhotoRunRecord.validHandle(fileId), returned.expectedRevision != nil || fileId == requestId else {
                throw NativeDeferredUploadClient.Failure.invalid
            }
        }
        let guardValue = NativeUploadFileRequest.Publication(expectedRevision: returned.expectedRevision, fileId: fileId)
        let request = NativeUploadFileRequest(source: source, uploadId: uploadId, requestId: requestId,
                                              authorization: run.authorization, publication: guardValue)
        var next = NativeDeferredUploadRecord(scope: run.scope, request: request, grantRevision: run.grantRevision,
                                              admissionId: admission, expiresAt: expiry)
        next.photoRunId = run.runId
        if result["staged"] as? Bool == true { next.confirmedParts = fingerprint.partCount }
        try next.validate()
        return next
    }
}
