import AppleFileSync
import Foundation
import UIKit

/// A browser-issued, device-bound run is only authority to request exact
/// original reservations from the current policy. No credentials or signed
/// object requests are written to the run journal.
struct NativePhotoRunRecord: Codable, Equatable, Sendable {
    enum RetrySource: String, Codable, Sendable { case automaticCheck, systemInterruption, conditions, budget, transferBackoff }
    let scope: FileSyncOwnerScope
    let authorization: NativeUploadAuthorization
    let grantRevision: String
    let runId: String
    let expiresAt: Date
    var epoch = UUID()
    var captureId: String?
    var batch: PhotoBackupQueueBatch?
    var armed = true
    var retryAt = Date.distantPast
    var retrySource: RetrySource?
    var retryCloudGaps = false
    var foregroundOwner: Bool?
    var stage: String?
    var syncWait: String?
    var minimumPartBytes: Int64?
    var pendingOriginals: Int?
    var unavailableOriginals: Int?
    var unavailableReasons: [String: Int]?
    // Older builds used this for the OS callback. New writes keep policy
    // pause separate and recover old holds only after fresh authorization.
    var continuedHold: Bool?
    var userPaused: Bool?
    var activity: NativePhotoRunActivity.Snapshot?
    var sourceIndexId: String?
    var sourceIndexMetadataEpoch: String?
    var sourceIndexAcknowledgedSequence: Int?
    var sourceIndexAcknowledgedAt: Date?

    var rootId: String { authorization.configuration.localRootId }
    var queue: PhotoBackupQueueRequest { .init(epoch: epoch, configurationId: authorization.id, configurationRevision: authorization.updatedAt) }
    var photoScope: PhotoLibraryReader.Scope { .init(owner: scope, deviceId: NativeUploadPartStaging.inventoryIdentity, rootId: rootId) }
    var nativeOwnsRun: Bool { foregroundOwner == true }
    var legacySystemInterruption: Bool { continuedHold == true && userPaused != true }
    mutating func recordSourceIndexReceipt(indexId: String, metadataEpoch: String, sequence: Int, now: Date = Date()) throws {
        guard sequence > 0, sourceIndexMetadataEpoch != metadataEpoch || sourceIndexId == nil || sourceIndexId == indexId else {
            throw NativeDeferredUploadClient.Failure.invalid
        }
        // The durable outbox epoch wins over stale journal progress after a
        // crash between metadata rotation and the run's checkpoint. It grants
        // no authority; this exact receipt was already origin/run negotiated.
        sourceIndexId = indexId; sourceIndexMetadataEpoch = metadataEpoch
        sourceIndexAcknowledgedSequence = sequence; sourceIndexAcknowledgedAt = now
    }
    func validate() throws {
        try authorization.validate(owner: scope, rootId: rootId, photos: true)
        guard scope == (try FileSyncOwnerScope(ownerId: scope.ownerId, url: scope.origin)),
              Self.validHandle(runId), grantRevision.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              captureId.map({ UUID(uuidString: $0) != nil && $0 == $0.lowercased() }) ?? true,
              batch == nil || (batch?.epoch == epoch && captureId != nil) else { throw MobileFolderStore.Failure.invalid }
    }
    static func validHandle(_ id: String) -> Bool {
        id.range(of: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$", options: .regularExpression) != nil
    }
    func sameScope(_ other: Self) -> Bool {
        scope == other.scope && authorization.id == other.authorization.id &&
        authorization.scope.deviceId == other.authorization.scope.deviceId && rootId == other.rootId && grantRevision == other.grantRevision
    }
    func sameRun(_ other: Self) -> Bool {
        sameScope(other) && runId == other.runId && authorization == other.authorization && nativeOwnsRun == other.nativeOwnsRun
    }
    mutating func deferAfterSystemInterruption(now: Date = Date()) {
        guard armed, userPaused != true else { return }
        stage = "waiting"
        let localRetry = now.addingTimeInterval(300)
        deferRetry(until: localRetry, source: .systemInterruption, now: now)
    }
    mutating func deferRetry(until proposed: Date, source: RetrySource, now: Date = Date()) {
        let retainExternal = retryAt > now && (retrySource == nil || retrySource == .transferBackoff || retrySource == .budget)
        retryAt = max(retryAt, proposed)
        if !retainExternal { retrySource = source }
    }
    mutating func pauseByUser() {
        armed = false; userPaused = true; continuedHold = nil; stage = "paused"
        activity?.backgroundRequest = nil
    }
}

@MainActor
struct NativePhotoRunStore {
    private let directory: URL
    init(directory: URL) { self.directory = directory.appendingPathComponent("NativePhotoRuns-v1", isDirectory: true) }
    private func location(_ run: NativePhotoRunRecord) -> URL {
        let key = PhotoLibraryReader.hash(Data([run.scope.origin.absoluteString, run.scope.ownerId, run.authorization.id,
                                                run.authorization.scope.deviceId, run.rootId].joined(separator: "\n").utf8))
        return directory.appendingPathComponent(key + ".json")
    }
    private func read(_ url: URL) throws -> NativePhotoRunRecord {
        let data = try Data(contentsOf: url)
        guard data.count <= 65_536 else { throw MobileFolderStore.Failure.invalid }
        let run = try JSONDecoder().decode(NativePhotoRunRecord.self, from: data)
        try run.validate()
        // Lookup and enumeration both use this store's directory. Foundation
        // may resolve a parent alias while enumerating it, so check the exact key.
        guard location(run).lastPathComponent == url.lastPathComponent else { throw MobileFolderStore.Failure.invalid }
        return run
    }
    func load() throws -> [NativePhotoRunRecord] {
        do { return try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }.map(read) }
        catch let error as CocoaError where error.code == .fileReadNoSuchFile || error.code == .fileNoSuchFile { return [] }
    }
    func lookup(_ run: NativePhotoRunRecord) throws -> NativePhotoRunRecord? {
        do { return try read(location(run)) }
        catch let error as CocoaError where error.code == .fileReadNoSuchFile { return nil }
    }
    func write(_ run: NativePhotoRunRecord) throws {
        try run.validate()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(run).write(to: location(run), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        var folder = directory, values = URLResourceValues()
        values.isExcludedFromBackup = true; try folder.setResourceValues(values)
    }
    func update(_ run: NativePhotoRunRecord) throws {
        guard let current = try lookup(run), current.sameRun(run), current.armed else { throw CancellationError() }
        try write(run)
    }
}

/// The worker is independent of its current permission to run. A system
/// processing opportunity can attach to the very same Swift Task that began
/// in front; expiration checkpoints it only when no other lease remains.
/// Every unit is observed work, never elapsed time. Completing one concurrent
/// original must retain all siblings' measured partial work.
enum NativePhotoContinuedProgress {
    static func total(indexed: Int64, knownIndexing: Int64, preparation: Int64, knownPreparation: Int64,
                      completed: Int64, knownOriginals: Int64, activeFiles: Int) -> Int64 {
        // The scope is library discovery plus currently known originals, not
        // an invented estimate of every original still undiscovered. Reserve
        // one real final authority/queue-checkpoint unit until verification.
        (max(indexed, knownIndexing) + max(knownOriginals, completed + Int64(activeFiles))) * 10_000 +
            max(preparation, knownPreparation) + 1
    }
    static func units(indexed: Int64, preparation: Int64, completed: Int64,
                      files: [(sent: Int64, total: Int64)]) -> Int64 {
        let partial = files.reduce(Int64(0)) { sum, file in
            guard file.total > 0 else { return sum }
            return sum + min(9_999, Int64(min(1, max(0, Double(file.sent) / Double(file.total))) * 10_000))
        }
        return (indexed + completed) * 10_000 + preparation + partial
    }
}

@MainActor
final class NativePhotoExecutionLease {
    private let foregroundAllowed: Bool
    private let applicationState: @MainActor () -> UIApplication.State
    private let endAssertion: @MainActor (UIBackgroundTaskIdentifier) -> Void
    private var assertion: UIBackgroundTaskIdentifier = .invalid
    private var system: NativeDeferredUploadSystemTask?
    private var continued: NativeUploadBackgroundLease?
    private var finished = false
    var expired: (() -> Void)?
    private(set) var executionExpired = false

    init(foregroundAllowed: Bool,
         applicationState: @escaping @MainActor () -> UIApplication.State = { UIApplication.shared.applicationState },
         endAssertion: @escaping @MainActor (UIBackgroundTaskIdentifier) -> Void = { UIApplication.shared.endBackgroundTask($0) }) {
        self.foregroundAllowed = foregroundAllowed; self.applicationState = applicationState; self.endAssertion = endAssertion
    }
    func startContinuation() {
        guard foregroundAllowed, !finished, assertion == .invalid, applicationState() != .background else { return }
        assertion = UIApplication.shared.beginBackgroundTask(withName: "Photos backup") { [weak self] in
            Task { @MainActor in self?.expireAssertion() }
        }
    }
    func attach(_ task: NativeDeferredUploadSystemTask) -> Bool {
        guard !finished, system == nil, task.available else { return false }
        system = task
        task.expiration = { [weak self] in
            guard let self else { return }
            self.finishSystem(false); self.cancelIfNoExecution()
        }
        return true
    }
    func check() throws {
        try Task.checkCancellation()
        guard canExecute else { throw CancellationError() }
    }
    func becameActive() { releaseAssertion() }
    var continuedActive: Bool { continued?.canContinue == true }
    func attachContinued(_ lease: NativeUploadBackgroundLease) -> Bool {
        guard foregroundAllowed, !finished, !continuedActive, lease.canContinue else { return false }
        continued = lease; return true
    }
    func continuedProgress(completed: Int64, total: Int64?, subtitle: String) {
        continued?.work(completed: completed, total: total, subtitle: subtitle)
    }
    var continuedMeasurement: (units: Int64, at: Date?) {
        (continued?.measuredUnits ?? 0, continued?.lastProgressAt)
    }
    func finishContinued(_ success: Bool, settledSubtitle: String? = nil) {
        let previous = continued; continued = nil; previous?.finish(success: success, settledSubtitle: settledSubtitle)
    }
    private var canExecute: Bool {
        !finished && (system != nil || continuedActive || assertion != .invalid || foregroundAllowed && applicationState() != .background)
    }
    private func cancelIfNoExecution() {
        if !canExecute { executionExpired = true; expired?() }
    }
    private func expireAssertion() {
        releaseAssertion(); cancelIfNoExecution()
    }
    private func releaseAssertion() {
        guard assertion != .invalid else { return }
        let prior = assertion; assertion = .invalid; endAssertion(prior)
    }
    private func finishSystem(_ success: Bool) {
        guard let task = system else { return }
        system = nil; task.expiration = nil; task.complete(success)
    }
    func finish(_ success: Bool) {
        guard !finished else { return }
        finished = true; expired = nil
        releaseAssertion(); finishSystem(success); finishContinued(success)
    }
}
