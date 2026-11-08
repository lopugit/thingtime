import AppleFileSync
import Foundation

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

    var rootId: String { authorization.configuration.localRootId }
    var queue: PhotoBackupQueueRequest { .init(epoch: epoch, configurationId: authorization.id, configurationRevision: authorization.updatedAt) }
    var photoScope: PhotoLibraryReader.Scope { .init(owner: scope, deviceId: NativeUploadPartStaging.inventoryIdentity, rootId: rootId) }
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
    func sameRun(_ other: Self) -> Bool { sameScope(other) && runId == other.runId && authorization == other.authorization }
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
        guard location(run) == url else { throw MobileFolderStore.Failure.invalid }
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
