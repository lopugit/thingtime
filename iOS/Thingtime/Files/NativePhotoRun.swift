import AppleFileSync
import Foundation
import UIKit

/// A browser-issued, device-bound run is only authority to request exact
/// original reservations from the current policy. No credentials or signed
/// object requests are written to the run journal.
struct NativePhotoRunRecord: Codable, Equatable, Sendable {
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
    var retryCloudGaps = false
    var foregroundOwner: Bool?
    var stage: String?
    var syncWait: String?
    var minimumPartBytes: Int64?
    var pendingOriginals: Int?
    var unavailableOriginals: Int?
    var continuedHold: Bool?
    var activity: NativePhotoRunActivity.Snapshot?

    var rootId: String { authorization.configuration.localRootId }
    var queue: PhotoBackupQueueRequest { .init(epoch: epoch, configurationId: authorization.id, configurationRevision: authorization.updatedAt) }
    var photoScope: PhotoLibraryReader.Scope { .init(owner: scope, deviceId: NativeUploadPartStaging.inventoryIdentity, rootId: rootId) }
    var nativeOwnsRun: Bool { foregroundOwner == true }
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
    mutating func holdContinuedExecution() {
        continuedHold = true; armed = false; stage = "paused"
        syncWait = nil; minimumPartBytes = nil
    }
    mutating func preserveContinuedDecision(from current: Self, explicitResume: Bool) {
        guard current.sameScope(self), current.continuedHold == true else { return }
        if explicitResume {
            continuedHold = nil; retryAt = .distantPast; stage = "ready"
        } else { holdContinuedExecution() }
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
        guard !finished, system == nil else { return false }
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
    func finishContinued(_ success: Bool) {
        let previous = continued; continued = nil; previous?.finish(success: success)
    }
    private var canExecute: Bool {
        !finished && (system != nil || continuedActive || assertion != .invalid || foregroundAllowed && applicationState() != .background)
    }
    private func cancelIfNoExecution() { if !canExecute { expired?() } }
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
