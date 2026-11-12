import Foundation
import CryptoKit
import Darwin
import Photos

/// Native resources use opaque, stable paths. Access is checked independently of
/// the saved connection; an unavailable library never becomes an empty scan.
public struct PhotoResource: Equatable, Sendable {
    public let asset: String
    public let index: Int
    public let name: String
    public let revision: String
    public let capturedAt: Date?
    public let modifiedAt: Date?
    public let assetKind: String?
    public let originalCount: Int
    let identity: String
    public let path: String
    public init(asset: String, index: Int, name: String, revision: String, capturedAt: Date? = nil, modifiedAt: Date? = nil,
                assetKind: String? = nil, originalCount: Int = 1) {
        self.asset = asset; self.index = index; self.name = name; self.revision = revision
        self.capturedAt = capturedAt; self.modifiedAt = modifiedAt
        self.assetKind = assetKind; self.originalCount = originalCount
        identity = PhotoLibraryReader.hash(Data((asset + ":" + String(index)).utf8))
        let assetHash = PhotoLibraryReader.hash(Data(asset.utf8))
        let safe = String(name.unicodeScalars.map { CharacterSet.controlCharacters.contains($0) || $0.properties.generalCategory == .format || $0 == "/" || $0 == "\\" ? "_" : String($0) }.prefix(80).joined())
        path = "\(assetHash)-\(index)-\(safe.isEmpty ? "resource" : safe)"
    }
}
/// Select the order by asset before opening any original bytes. Every original
/// and companion of the same asset stays together; opaque paths do not change.
enum PhotoBackupAssetOrder {
    static func precedes(_ a: (Date?, Date?, String), _ b: (Date?, Date?, String)) -> Bool {
        let aDate = a.0 ?? a.1 ?? .distantPast
        let bDate = b.0 ?? b.1 ?? .distantPast
        if aDate != bDate { return aDate > bDate }
        let aModified = a.1 ?? .distantPast
        let bModified = b.1 ?? .distantPast
        if aModified != bModified { return aModified > bModified }
        return a.2.utf8.lexicographicallyPrecedes(b.2.utf8)
    }
    static func groups(_ resources: [PhotoResource]) -> [[PhotoResource]] {
        Dictionary(grouping: resources, by: \.asset).values
            .map { $0.sorted { $0.index < $1.index } }
            .sorted { left, right in
                let a = left[0], b = right[0]
                return precedes((a.capturedAt, a.modifiedAt, a.asset), (b.capturedAt, b.modifiedAt, b.asset))
            }
    }
}

// The native queue can consume date-ordered asset groups from providers that
// can produce a stable ordered snapshot without expanding every resource.
struct OrderedPhotoCheckpoint: Codable {
    let libraryToken: Data?
    var dated = 0
    var undated = 0
    var indexed = PhotoLibraryReader.IndexedLibrary()
    var unavailable = 0
    var unavailableReadFailures: Int?
    var passID: UUID? = UUID()
}

protocol OrderedPhotoInventory: AnyObject {
    var progress: PhotoLibraryReader.InventoryProgress { get }
    var checkpoint: OrderedPhotoCheckpoint { get }
    func isCurrent() throws -> Bool
    func next() throws -> [PhotoResource]?
}

protocol OrderedPhotoResourceProvider: PhotoResourceProvider {
    func orderedInventory(resuming: OrderedPhotoCheckpoint?) throws -> any OrderedPhotoInventory
    func orderedResources(identifiers: [String]) throws -> [[PhotoResource]]
}

public protocol PhotoResourceProvider: Sendable {
    func access() -> String
    func inventory() throws -> [PhotoResource]
    func inventory(progress: (PhotoLibraryReader.InventoryProgress) -> Void) throws -> [PhotoResource]
    /// Nil means the provider does not promise change notifications.
    func membershipStamp() -> UInt64?
    func validate(_ resource: PhotoResource) throws
    func write(_ resource: PhotoResource, to url: URL) throws
    func download(_ resource: PhotoResource, to url: URL, control: PhotoOriginalDownloadControl) throws
}
public extension PhotoResourceProvider {
    func membershipStamp() -> UInt64? { nil }
    func inventory(progress: (PhotoLibraryReader.InventoryProgress) -> Void) throws -> [PhotoResource] { try inventory() }
    func download(_ resource: PhotoResource, to url: URL, control: PhotoOriginalDownloadControl) throws {
        throw PhotoLibraryReader.Failure.cloudOriginal
    }
}

/// Native hosts only supply this after verifying an explicitly unrestricted
/// Photos network policy. PhotoKit has no Wi-Fi-only interface selector.
public struct PhotoOriginalDownloadControl: Sendable {
    let authorize: @Sendable () throws -> Void
    let progress: @Sendable (Double?) -> Void
    public init(authorize: @escaping @Sendable () throws -> Void, progress: @escaping @Sendable (Double?) -> Void = { _ in }) {
        self.authorize = authorize; self.progress = progress
    }
    public func reporting(_ report: @escaping @Sendable (Double?) -> Void) -> Self {
        .init(authorize: authorize, progress: report)
    }
}

/// One temporary original at a time, shared by bounded range reads. PhotoKit has
/// no public random-access resource API, so exports are file-backed, never held
/// in one Data value. The cache is private, ephemeral and partitioned by grant.
public final class PhotoLibraryReader: @unchecked Sendable {
    public typealias Scope = MobileFolderInventory.Scope
    public struct IndexedLibrary: Codable, Equatable, Sendable {
        public var photos = 0, videos = 0, files = 0
    }
    public struct InventoryProgress: Sendable {
        public struct Item: Codable, Equatable, Sendable {
            public enum Kind: String, Codable, Sendable { case photo, video }
            public let kind: Kind
            public let capturedAt: Date?
        }
        public let inspected: Int
        public let total: Int
        public let indexed: IndexedLibrary
        public let latest: Item?
    }
    public enum CaptureProgress: Sendable {
        case enumerating(InventoryProgress)
        case hashing(completed: Int, total: Int)
        case indexed(IndexedLibrary)
        case checking(completed: Int, selected: Int, ahead: Int?)
    }
    public struct OriginalIdentity: Equatable, Sendable {
        public let group: String, resource: String, kind: String?
        public let count: Int
    }

    public enum Failure: Error, LocalizedError {
        case unavailable, changed, cloudOriginal, storageFull, readFailed
        public var errorDescription: String? {
            switch self {
            case .unavailable: return "Photo access is unavailable. Choose photo access again."
            case .changed: return "The photo library changed during backup. Try again."
            case .cloudOriginal: return "Backup needs an original that is only in iCloud. Download originals in Photos, then retry this backup. Saved cloud copies and transfer progress are kept."
            case .storageFull: return "There is not enough device storage to prepare a photo original. Free some space, then retry this backup. Saved cloud copies and transfer progress are kept."
            case .readFailed: return "Photos could not read an original. Keep Thingtime open and retry this backup. If it still fails, check that the original opens in Photos. Saved cloud copies and transfer progress are kept."
            }
        }
    }
    // PhotoKit also reports cancellation, permission loss and disk errors here.
    // Only its explicit network-required error establishes an iCloud original.
    // Never expose NSError descriptions, asset identifiers or underlying paths.
    static func exportFailure(_ error: Error) -> Error {
        if error is CancellationError { return error }
        let failure = error as NSError
        if failure.domain == PHPhotosErrorDomain {
            switch failure.code {
            case PHPhotosError.Code.networkAccessRequired.rawValue: return Failure.cloudOriginal
            case PHPhotosError.Code.userCancelled.rawValue: return CancellationError()
            case PHPhotosError.Code.accessRestricted.rawValue, PHPhotosError.Code.accessUserDenied.rawValue:
                return Failure.unavailable
            case PHPhotosError.Code.notEnoughSpace.rawValue: return Failure.storageFull
            default: return Failure.readFailed
            }
        }
        if failure.domain == NSCocoaErrorDomain && failure.code == CocoaError.fileWriteOutOfSpace.rawValue {
            return Failure.storageFull
        }
        return Failure.readFailed
    }
    private static let observationBatchSize = 128
    private let provider: any PhotoResourceProvider
    private let client: RustInventoryClient?
    private let lock = NSLock()
    private var directory: URL?
    private struct Snapshot {
        let revision: String
        let orderRevision: String
        let resources: [PhotoResource]
        let indexed: IndexedLibrary
    }
    private var queueSnapshot: (stamp: UInt64, access: String, value: Snapshot)?
    private var queue: (scope: Scope, value: PhotoBackupQueue)?
    private let queueDirectory: URL?
    private var membership: (scope: Scope, revision: String?, resources: [String: PhotoResource])?
    /// A verified network read remains pinned while the same asset group is
    /// staged and published. Its directory is independent of the regular cache.
    public final class PreparedCloudOriginal: @unchecked Sendable {
        fileprivate let scope: Scope
        fileprivate let resource: PhotoResource
        fileprivate let directory: URL
        fileprivate init(scope: Scope, resource: PhotoResource, directory: URL) {
            self.scope = scope; self.resource = resource; self.directory = directory
        }
        deinit { try? FileManager.default.removeItem(at: directory) }
        public var assetKey: String { PhotoLibraryReader.hash(Data(resource.asset.utf8)) }
    }
    private var prefetched: PreparedCloudOriginal?
    private var cached: (scope: Scope, resource: PhotoResource, entry: MobileFolderReader.Entry, native: MobileFolderReader.Entry, bookmark: Data)?
    public init(provider: any PhotoResourceProvider = SystemPhotoResources(), transport: (any RustInventoryTransport)? = nil,
                queueDirectory: URL? = nil) {
        self.queueDirectory = queueDirectory
        self.provider = provider
        #if os(macOS)
        let selected = transport ?? RustProcessInventoryTransport.bundledHelper.map { RustProcessInventoryTransport(helper: $0) }
        #else
        let selected = transport
        #endif
        client = selected.map { RustInventoryClient(transport: $0) }
    }
    deinit { if let directory { try? FileManager.default.removeItem(at: directory) } }
    public static func hash(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
    public func access() -> String { provider.access() }
    private func require() throws { try Task.checkCancellation(); guard ["full", "limited"].contains(provider.access()) else { throw Failure.unavailable } }
    private func clear() { cached = nil; if let directory { try? FileManager.default.removeItem(at: directory) }; directory = nil }
    public func discard() { lock.lock(); defer { lock.unlock() }; clear(); membership = nil }
    private func requireClient() throws -> RustInventoryClient {
        guard let client else { throw RustInventoryTransportFailure.unavailable }
        return client
    }

    private func project(_ entry: MobileFolderReader.Entry, resource: PhotoResource) throws -> MobileFolderReader.Entry {
        guard entry.kind == "file", entry.symbolicLink == nil, entry.size >= 0,
              let digest = entry.sha256 ?? entry.fingerprint?.sha256,
              digest.utf8.count == 64, digest.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) })
        else { throw RustInventoryTransportFailure.invalidResponse }
        let version = Self.hash(Data((resource.revision + ":" + String(entry.size) + ":" + digest).utf8))
        return .init(path: resource.path, id: resource.identity, version: version, kind: "file",
                     size: entry.size, sha256: entry.sha256, fingerprint: entry.fingerprint)
    }

    private func observe(bookmark: Data, scope: Scope, resource: PhotoResource) throws -> MobileFolderReader.Entry {
        let client = try requireClient()
        return try MobileFolderReader.access(bookmark) { root in
            var fields = try RustInventoryClient.Root(fd: root).fields
            fields["path"] = "original"
            fields["resourceIdentity"] = resource.identity
            fields["resourceRevision"] = resource.revision
            fields["resourcePath"] = resource.path
            let entry: MobileFolderReader.Entry = try client.run("observe", scope: scope, fields: fields)
            guard entry.path == "original" else { throw RustInventoryTransportFailure.invalidResponse }
            // Pin the temporary resource to the native range-read stamp without
            // doing another content read or using the logical cache for bytes.
            try validateNative(entry, root: root)
            return entry
        }
    }

    private func scanEntry(_ resource: PhotoResource, scope: Scope) throws -> MobileFolderReader.Entry {
        if let cached, cached.scope == scope, cached.resource == resource {
            return try materialize(resource, scope: scope).0
        }
        try require(); try provider.validate(resource)
        let client = try requireClient()
        let observed: MobileFolderReader.Entry? = try client.run("photoObservation", scope: scope,
            fields: ["resourceIdentity": resource.identity, "resourceRevision": resource.revision])
        if let entry = observed {
            try require(); try provider.validate(resource)
            guard try project(entry, resource: resource) == entry else { throw RustInventoryTransportFailure.invalidResponse }
            return entry
        }
        return try materialize(resource, scope: scope).0
    }

    private func resourceKey(_ resource: PhotoResource) -> [String: String] {
        ["resourceIdentity": resource.identity, "resourceRevision": resource.revision]
    }

    private func scanEntries(_ resources: ArraySlice<PhotoResource>, scope: Scope,
                             authorize: () throws -> Void = {}, allowCloudGaps: Bool = false, allowReadGaps: Bool = false,
                             download: PhotoOriginalDownloadControl? = nil, beginDownload: () -> Bool = { true },
                             cloudGap: (PhotoResource) -> Void = { _ in }, gapReason: (PhotoResource, String) -> Void = { _, _ in },
                             progress: () -> Void = {}) throws -> [MobileFolderReader.Entry] {
        let client = try requireClient()
        for resource in resources { try authorize(); try require(); try provider.validate(resource) }
        let observed: [MobileFolderReader.Entry?] = try client.run("photoObservations", scope: scope,
            fields: ["resources": resources.map(resourceKey)])
        guard observed.count == resources.count else { throw RustInventoryTransportFailure.invalidResponse }
        return try zip(resources, observed).compactMap { resource, entry in
            try authorize()
            let result: MobileFolderReader.Entry
            if let entry {
                try require(); try provider.validate(resource)
                guard try project(entry, resource: resource) == entry else { throw RustInventoryTransportFailure.invalidResponse }
                result = entry
            } else {
                do { result = try materialize(resource, scope: scope, download: download, beginDownload: beginDownload).0 }
                catch Failure.cloudOriginal where allowCloudGaps {
                    try authorize(); try require(); try provider.validate(resource)
                    gapReason(resource, "cloud-download"); cloudGap(resource); return nil
                } catch Failure.readFailed where allowReadGaps {
                    try authorize(); try require(); try provider.validate(resource)
                    gapReason(resource, "photo-read"); cloudGap(resource); return nil
                }
            }
            try authorize(); progress()
            return result
        }
    }

    private func validateNative(_ entry: MobileFolderReader.Entry, root: Int32) throws {
        let original = try MobileFolderReader.openPath(root, path: entry.path)
        defer { close(original) }
        let info = try MobileFolderReader.info(original)
        guard info.st_mode & S_IFMT == S_IFREG, info.st_size == entry.size,
              MobileFolderReader.stamp(info) == entry.version else { throw Failure.changed }
    }

    private static func legacyScope(_ value: String) throws -> Scope {
        // Old native callers already hash the origin and owner into their key.
        // Keep the complete legacy key isolated from typed production scopes.
        let key = hash(Data(value.utf8))
        let owner = try FileSyncOwnerScope(ownerId: key, url: URL(string: "https://legacy-photo.invalid")!)
        return .init(owner: owner, deviceId: "legacy-photo", rootId: key)
    }

    public func scan(scope: String) throws -> [MobileFolderReader.Entry] {
        try scan(scope: Self.legacyScope(scope))
    }
    public func stream(scope: String, path: String, version: String, offset: Int64, length: Int,
                       receive: (Data) throws -> Void) throws -> Int64 {
        try stream(scope: Self.legacyScope(scope), path: path, version: version, offset: offset, length: length, receive: receive)
    }
    public func read(scope: String, path: String, version: String, offset: Int64, length: Int) throws -> MobileFolderReader.Chunk {
        try read(scope: Self.legacyScope(scope), path: path, version: version, offset: offset, length: length)
    }

    private func materialize(_ resource: PhotoResource, scope: Scope, download: PhotoOriginalDownloadControl? = nil,
                             beginDownload: () -> Bool = { true }) throws -> (MobileFolderReader.Entry, MobileFolderReader.Entry, Data) {
        try require(); try provider.validate(resource)
        if let cached, cached.scope == scope, cached.resource == resource {
            try MobileFolderReader.access(cached.bookmark) { try validateNative(cached.native, root: $0) }
            return (cached.entry, cached.native, cached.bookmark)
        }
        _ = try requireClient()
        clear()
        if let prefetched, prefetched.scope == scope, prefetched.resource == resource {
            let bookmark = try FolderBookmark.create(prefetched.directory)
            let native = try observe(bookmark: bookmark, scope: scope, resource: resource)
            try require(); try provider.validate(resource)
            let entry = try project(native, resource: resource)
            cached = (scope, resource, entry, native, bookmark)
            return (entry, native, bookmark)
        }
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("thingtime-photo-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700]); directory = root
        do {
            let original = root.appendingPathComponent("original")
            do { try provider.write(resource, to: original) }
            catch Failure.cloudOriginal {
                guard let download, beginDownload() else { throw Failure.cloudOriginal }
                try require(); try download.authorize()
                if FileManager.default.fileExists(atPath: original.path) { try FileManager.default.removeItem(at: original) }
                download.progress(0)
                defer { download.progress(nil) }
                try provider.download(resource, to: original, control: download)
                try download.authorize()
            }
            try require(); try provider.validate(resource)
            let bookmark = try FolderBookmark.create(root)
            let native = try observe(bookmark: bookmark, scope: scope, resource: resource)
            try require(); try provider.validate(resource)
            let entry = try project(native, resource: resource)
            cached = (scope, resource, entry, native, bookmark); return (entry, native, bookmark)
        } catch { clear(); throw error }
    }
    public func scan(scope: Scope) throws -> [MobileFolderReader.Entry] {
        lock.lock(); defer { lock.unlock() }
        do {
            try require()
            _ = try requireClient()
            let initial = try provider.inventory()
            guard Set(initial.map(\.path)).count == initial.count else { throw Failure.changed }
            var entries: [MobileFolderReader.Entry] = []
            entries.reserveCapacity(initial.count)
            for start in stride(from: 0, to: initial.count, by: Self.observationBatchSize) {
                let end = min(initial.count, start + Self.observationBatchSize)
                entries.append(contentsOf: try scanEntries(initial[start..<end], scope: scope))
            }
            try require(); guard try provider.inventory() == initial else { throw Failure.changed }
            try remember(initial, scope: scope, revision: nil)
            return entries
        } catch { clear(); throw error }
    }
    private func remember(_ resources: [PhotoResource], scope: Scope, revision: String?) throws {
        var paths: [String: PhotoResource] = [:]
        paths.reserveCapacity(resources.count)
        for resource in resources {
            try Task.checkCancellation()
            guard paths.updateValue(resource, forKey: resource.path) == nil else { throw Failure.changed }
        }
        membership = (scope, revision, paths)
    }

    private func resolve(path: String, scope: Scope) throws -> PhotoResource? {
        try require()
        let hint = cached.flatMap { $0.scope == scope && $0.resource.path == path ? $0.resource : nil }
            ?? membership.flatMap { $0.scope == scope ? $0.resources[path] : nil }
        if let hint {
            do { try provider.validate(hint); return hint }
            catch { queueSnapshot = nil; try require() }
        }
        // A stale hint does not prove absence. Only a live PhotoKit enumeration
        // can establish that a selected resource was removed or its grant changed.
        let current = try provider.inventory()
        try require()
        try remember(current, scope: scope, revision: nil)
        return membership?.resources[path]
    }

    private func snapshot(reuseForQueue: Bool = false, activity: (CaptureProgress) -> Void = { _ in }) throws -> Snapshot {
        try require()
        let access = provider.access(), stamp = reuseForQueue ? provider.membershipStamp() : nil
        if let stamp, let cached = queueSnapshot, cached.stamp == stamp, cached.access == access { return cached.value }
        let inventory = try reuseForQueue ? provider.inventory { activity(.enumerating($0)) } : provider.inventory()
        let resources = inventory.sorted { $0.path.utf8.lexicographicallyPrecedes($1.path.utf8) }
        var digest = SHA256(), ordering = SHA256(), previous: String?, previousAsset: String?
        var indexed = IndexedLibrary()
        activity(.hashing(completed: 0, total: resources.count))
        for (offset, resource) in resources.enumerated() {
            try Task.checkCancellation()
            guard resource.path != previous else { throw Failure.changed }
            previous = resource.path
            // The opaque path begins with the asset hash, so the sorted
            // originals and companions of each asset are contiguous.
            if resource.asset != previousAsset {
                if resource.assetKind == "photo" { indexed.photos += 1 }
                if resource.assetKind == "video" { indexed.videos += 1 }
                previousAsset = resource.asset
            }
            indexed.files += 1
            for value in [resource.path, resource.identity, resource.revision] {
                let data = Data(SHA256.hash(data: Data(value.utf8)))
                digest.update(data: data); ordering.update(data: data)
            }
            if reuseForQueue {
                for value in [resource.capturedAt, resource.modifiedAt] {
                    ordering.update(data: Data(SHA256.hash(data: Data(String(value?.timeIntervalSince1970 ?? -.infinity).utf8))))
                }
            }
            if (offset + 1) % 64 == 0 || offset + 1 == resources.count {
                activity(.hashing(completed: offset + 1, total: resources.count))
            }
        }
        try require()
        guard access == provider.access(), stamp == (reuseForQueue ? provider.membershipStamp() : nil) else { throw Failure.changed }
        let result = Snapshot(revision: digest.finalize().map { String(format: "%02x", $0) }.joined(),
            orderRevision: ordering.finalize().map { String(format: "%02x", $0) }.joined(), resources: resources, indexed: indexed)
        if let stamp { queueSnapshot = (stamp, access, result) }
        return result
    }

    private func queueStore(scope: Scope, request: PhotoBackupQueueRequest) throws -> PhotoBackupQueue {
        if let queue, queue.scope == scope, queue.value.request == request { return queue.value }
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let binding = try encoder.encode(scope) + encoder.encode([request.configurationId, request.configurationRevision])
        let base = try queueDirectory ?? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
            appropriateFor: nil, create: true).appendingPathComponent("PhotoBackupQueue", isDirectory: true)
        var namespace = base.appendingPathComponent(Self.hash(binding), isDirectory: true)
        try FileManager.default.createDirectory(at: namespace, withIntermediateDirectories: true)
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        try? namespace.setResourceValues(values)
        PhotoBackupQueue.pruneFinishedEpochs(in: namespace, protecting: request.epoch)
        let directory = namespace.appendingPathComponent(request.epoch.uuidString.lowercased(), isDirectory: true)
        let store = PhotoBackupQueue(directory: directory, request: request)
        queue = (scope, store)
        return store
    }

    private func batchSnapshot(scope: Scope, store: PhotoBackupQueue, replaceStale: Bool = false,
                               startWithSingleAsset: Bool = false, preparedDeferred: PhotoResource? = nil,
                               activity: (CaptureProgress) -> Void = { _ in }) throws -> (Snapshot, PhotoBackupQueue.Work) {
        let work: PhotoBackupQueue.Work
        let indexed: IndexedLibrary
        if let ordered = provider as? any OrderedPhotoResourceProvider,
           try store.usesOrderedSelection(preferred: startWithSingleAsset) {
            work = try store.selectOrdered(provider: ordered, replaceStale: replaceStale, preparedDeferred: preparedDeferred) {
                activity(.enumerating($0))
            }
            indexed = work.selection.orderedCursor?.indexed ?? .init()
        } else {
            let library = try snapshot(reuseForQueue: true, activity: activity)
            work = try store.select(revision: library.orderRevision, resources: library.resources, replaceStale: replaceStale,
                                    startWithSingleAsset: startWithSingleAsset)
            indexed = library.indexed
        }
        let revision = Self.hash(Data((work.selection.id.uuidString + work.selection.stamps.map(\.version).joined()).utf8))
        return (.init(revision: revision, orderRevision: revision, resources: work.assets.flatMap(\.resources), indexed: indexed), work)
    }

    private func capturedSnapshot(scope: Scope, batch: PhotoBackupQueueBatch?) throws -> Snapshot {
        guard let batch else { return try snapshot() }
        guard let queue, queue.scope == scope, queue.value.request.epoch == batch.epoch else { throw Failure.changed }
        let (source, work) = try batchSnapshot(scope: scope, store: queue.value)
        guard work.descriptor == batch else { throw Failure.changed }
        return source
    }

    /// Discover and persist metadata before any original is materialized.
    public func discoverQueueIndex(scope: Scope, request: PhotoBackupQueueRequest, preparedDeferred: PreparedCloudOriginal? = nil,
                                   activity: (CaptureProgress) -> Void = { _ in }) throws {
        lock.lock(); defer { lock.unlock() }
        try require()
        let store = try queueStore(scope: scope, request: request)
        try store.enableSourceIndex()
        let (source, _) = try batchSnapshot(scope: scope, store: store, replaceStale: true, startWithSingleAsset: true,
                              preparedDeferred: preparedDeferred?.resource, activity: activity)
        activity(.indexed(source.indexed))
    }
    public func discoverQueueIndexLookahead(scope: Scope, request: PhotoBackupQueueRequest, batchId: UUID) throws {
        lock.lock(); defer { lock.unlock() }
        try require()
        let store = try queueStore(scope: scope, request: request)
        try store.enableSourceIndex()
        if let ordered = provider as? any OrderedPhotoResourceProvider { _ = try store.lookahead(provider: ordered, batchId: batchId) }
    }
    public func rotateQueueSourceIndex(scope: Scope, request: PhotoBackupQueueRequest) throws {
        lock.lock(); defer { lock.unlock() }
        try queueStore(scope: scope, request: request).rotateSourceIndex()
    }
    public func pendingQueueSourceIndex(scope: Scope, request: PhotoBackupQueueRequest) throws -> PhotoSourceIndexPage? {
        lock.lock(); defer { lock.unlock() }
        return try queueStore(scope: scope, request: request).pendingSourceIndex()
    }
    public func acknowledgeQueueSourceIndex(scope: Scope, request: PhotoBackupQueueRequest, page: PhotoSourceIndexPage) throws {
        lock.lock(); defer { lock.unlock() }
        try queueStore(scope: scope, request: request).acknowledgeSourceIndex(page)
    }

    public func queueBatchEntries(scope: Scope, request: PhotoBackupQueueRequest, batchId: UUID) throws -> [MobileFolderReader.Entry] {
        lock.lock(); defer { lock.unlock() }
        try require()
        let store = try queueStore(scope: scope, request: request)
        let entries = try store.entriesForVerification(batchId)
        if !entries.isEmpty, try store.usesOrderedSelection(preferred: false) {
            let (source, work) = try batchSnapshot(scope: scope, store: store)
            guard work.selection.id == batchId else { throw Failure.changed }
            try remember(source.resources, scope: scope, revision: source.revision)
        }
        return entries
    }

    /// Warm only local observation hashes for the next bounded date page while
    /// current originals are on the wire. Cloud gaps stay in their canonical
    /// deferred flow; this does not admit another active queue selection.
    public func prepareQueueLookahead(scope: Scope, request: PhotoBackupQueueRequest, batchId: UUID,
                                      authorize: () throws -> Void = {}) throws {
        lock.lock(); defer { lock.unlock() }
        try require(); try authorize()
        guard let ordered = provider as? any OrderedPhotoResourceProvider else { return }
        let resources = try queueStore(scope: scope, request: request).lookahead(provider: ordered, batchId: batchId)
        _ = try scanEntries(resources[...], scope: scope, authorize: authorize, allowCloudGaps: true, allowReadGaps: true)
        try require(); try authorize()
    }

    public func finishQueueBatch(scope: Scope, request: PhotoBackupQueueRequest, batchId: UUID) throws {
        lock.lock(); defer { lock.unlock() }
        try require()
        let store = try queueStore(scope: scope, request: request)
        if try store.shouldLoadOrderedAssets(batchId) {
            let (_, work) = try batchSnapshot(scope: scope, store: store)
            guard work.selection.id == batchId else { throw Failure.changed }
            try store.finish(batchId, orderedAssets: work.assets)
        } else {
            try store.finish(batchId)
        }
    }

    public func hasDeferredCloudOriginals(scope: Scope, request: PhotoBackupQueueRequest) throws -> Bool {
        lock.lock(); defer { lock.unlock() }
        try require()
        return try queueStore(scope: scope, request: request).hasDeferredOriginals()
    }

    public func nextDeferredCloudOriginal(scope: Scope, request: PhotoBackupQueueRequest, now: Date = Date()) throws -> PhotoResource? {
        lock.lock(); defer { lock.unlock() }
        try require()
        guard let ordered = provider as? any OrderedPhotoResourceProvider else { return nil }
        return try queueStore(scope: scope, request: request).nextDeferred(provider: ordered, now: now)
    }

    public func prepareDeferredCloudOriginal(scope: Scope, resource: PhotoResource,
                                             control: PhotoOriginalDownloadControl?,
                                             authorize: () throws -> Void = {}) throws -> PreparedCloudOriginal {
        // Do not hold the ordinary inventory/cache lock while PhotoKit reads
        // iCloud. The caller owns one scoped preparation task and its lifetime.
        try require(); try authorize(); try control?.authorize(); try provider.validate(resource)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("thingtime-photo-cloud-" + UUID().uuidString, isDirectory: true)
        var attributes: [FileAttributeKey: Any] = [.posixPermissions: 0o700]
        #if os(iOS)
        attributes[.protectionKey] = FileProtectionType.completeUntilFirstUserAuthentication
        #endif
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: attributes)
        do {
            let prepared = PreparedCloudOriginal(scope: scope, resource: resource, directory: directory)
            let original = directory.appendingPathComponent("original")
            if let control { try provider.download(resource, to: original, control: control) }
            else { try provider.write(resource, to: original) }
            try require(); try authorize(); try control?.authorize(); try provider.validate(resource)
            return prepared
        } catch {
            try? FileManager.default.removeItem(at: directory)
            throw error
        }
    }

    public func releaseDeferredCloudOriginal(_ prepared: PreparedCloudOriginal) {
        lock.lock(); defer { lock.unlock() }
        guard prefetched === prepared else { return }
        clear(); prefetched = nil
    }

    public func capture(scope: Scope, id: String) throws -> MobileFolderInventory.Capture {
        let prepared = try prepareCapture(scope: scope, id: id, generation: id)
        do { return try sealCapture(scope: scope, capture: prepared) }
        catch { try? discard(scope: scope, capture: prepared); throw error }
    }

    public func prepareCapture(scope: Scope, id: String, generation: String,
                               progress: (Int) -> Void = { _ in }, authorize: () throws -> Void = {}) throws -> MobileFolderInventory.Capture {
        try prepareCapture(scope: scope, id: id, generation: generation, allowCloudGaps: false,
                           progress: { indexed, _ in progress(indexed) }, authorize: authorize)
    }

    public func prepareCapture(scope: Scope, id: String, generation: String, allowCloudGaps: Bool,
                               download: PhotoOriginalDownloadControl? = nil, maximumCloudDownloads: Int? = nil,
                               queueRequest: PhotoBackupQueueRequest? = nil, startWithSingleAsset: Bool = false,
                               preparedDeferred: PreparedCloudOriginal? = nil,
                               progress: (Int, Int) -> Void = { _, _ in }, activity: (CaptureProgress) -> Void = { _ in },
                               authorize: () throws -> Void = {}) throws -> MobileFolderInventory.Capture {
        lock.lock(); defer { lock.unlock() }
        guard UUID(uuidString: id) != nil, id.lowercased() == generation.lowercased() else { throw MobileFolderStore.Failure.invalid }
        let client = try requireClient(), generation = generation.lowercased()
        try authorize()
        guard queueRequest == nil || allowCloudGaps else { throw Failure.changed }
        if let preparedDeferred {
            guard queueRequest != nil, preparedDeferred.scope == scope else { throw Failure.changed }
            try provider.validate(preparedDeferred.resource)
            prefetched = preparedDeferred
        }
        let batchStore = try queueRequest.map { try queueStore(scope: scope, request: $0) }
        let batch = try batchStore.map {
            try batchSnapshot(scope: scope, store: $0, replaceStale: true, startWithSingleAsset: startWithSingleAsset,
                              preparedDeferred: preparedDeferred?.resource, activity: activity)
        }
        let start = try batch?.0 ?? snapshot()
        activity(.indexed(start.indexed))
        var batchStatus = batch?.1.descriptor
        var began = false
        do {
            let prepared: RustInventoryClient.Status = try client.run("beginPhotoCapture", scope: scope, generation: generation,
                fields: ["resourceRevision": start.revision])
            guard prepared.generation == generation, prepared.mode == "photo",
                  prepared.rootVersion == start.revision, ["scanning", "sealed"].contains(prepared.coverage) else {
                throw RustInventoryTransportFailure.invalidResponse
            }
            began = true
            var indexed = prepared.entryCount, skipped = prepared.gapCount, cloudDownloads = 0
            func report(legacy: Bool = true) {
                if legacy { progress(indexed, skipped) }
                activity(.checking(completed: indexed, selected: start.resources.count,
                    ahead: batchStatus?.remainingKnown == false ? nil : batchStatus?.pending ?? 0))
            }
            report(legacy: false)
            let retainedGaps = Set(batch?.1.selection.attempts?.flatMap(\.unavailable) ?? [])
            var batchReasons = Dictionary(uniqueKeysWithValues: (batch?.1.selection.attempts ?? []).flatMap { attempt in
                attempt.unavailable.map { ($0, attempt.reasonByPath?[$0] ?? "cloud-download") }
            })
            var batchGaps = Set<String>(), batchEntries: [MobileFolderReader.Entry] = []
            if prepared.coverage == "scanning" {
                // An interrupted async job is discarded before a new capture starts.
                guard indexed == 0, skipped == 0 else { throw Failure.changed }
                for startIndex in stride(from: 0, to: start.resources.count, by: Self.observationBatchSize) {
                    let end = min(start.resources.count, startIndex + Self.observationBatchSize)
                    let resources = start.resources[startIndex..<end]
                    var gaps = Set(resources.map(\.path).filter(retainedGaps.contains))
                    skipped += gaps.count
                    let eligible = resources.filter { !retainedGaps.contains($0.path) }
                    let entries = try scanEntries(eligible[...], scope: scope, authorize: authorize, allowCloudGaps: allowCloudGaps, allowReadGaps: batch != nil && allowCloudGaps, download: download, beginDownload: {
                            if let maximumCloudDownloads, cloudDownloads >= maximumCloudDownloads { return false }
                            cloudDownloads += 1
                            return true
                        }, cloudGap: { resource in
                            gaps.insert(resource.path); skipped += 1; report()
                        }, gapReason: { resource, reason in batchReasons[resource.path] = reason }) { indexed += 1; report() }
                    if !entries.isEmpty {
                        if batch != nil { batchEntries += entries }
                        let _: RustInventoryClient.Status = try client.run("appendPhotoCapture", scope: scope,
                            generation: generation, fields: ["resources": resources.filter { !gaps.contains($0.path) }.map(resourceKey)])
                    }
                    if !gaps.isEmpty {
                        batchGaps.formUnion(gaps)
                        let _: RustInventoryClient.Status = try client.run("appendPhotoCloudGaps", scope: scope,
                            generation: generation, fields: ["paths": gaps.sorted()])
                    }
                }
                if let batchStore, let batch { batchStatus = try batchStore.prepare(batch.1, unavailable: batchGaps, entries: batchEntries, reasons: batchReasons) }
            }
            try authorize(); try require()
            guard indexed + skipped == start.resources.count, allowCloudGaps || skipped == 0 else { throw Failure.changed }
            return Self.descriptor(id: generation, entries: indexed, gaps: skipped, allowCloudGaps: allowCloudGaps, queue: batchStatus)
        } catch {
            clear(); membership = nil
            if began {
                let _: RustInventoryClient.Status? = try? client.run("discardPhotoCapture", scope: scope, generation: generation)
            }
            throw error
        }
    }

    private static func descriptor(id: String, entries: Int, gaps: Int, allowCloudGaps: Bool,
                                   queue: PhotoBackupQueueBatch? = nil) -> MobileFolderInventory.Capture {
        .init(id: id, generation: id, totalEntries: entries, coverage: allowCloudGaps ? (gaps == 0 ? "full" : "partial") : nil,
              consistency: allowCloudGaps ? "per-entry" : nil, totalSkipped: allowCloudGaps ? gaps : nil, photoQueue: queue)
    }

    private func checkCapture(_ capture: MobileFolderInventory.Capture, status: RustInventoryClient.Status) throws {
        guard UUID(uuidString: capture.id) != nil, capture.id == capture.generation, status.mode == "photo",
              status.generation == capture.generation, status.entryCount >= 0, status.gapCount >= 0,
              status.entryCount <= Int.max - status.gapCount,
              capture == Self.descriptor(id: capture.id, entries: status.entryCount, gaps: status.gapCount,
                                         allowCloudGaps: capture.coverage != nil, queue: capture.photoQueue),
              capture.coverage != nil || status.gapCount == 0 else { throw Failure.changed }
    }

    public func sealCapture(scope: Scope, capture: MobileFolderInventory.Capture) throws -> MobileFolderInventory.Capture {
        lock.lock(); defer { lock.unlock() }
        try require()
        let client = try requireClient()
        let status: RustInventoryClient.Status? = try client.run("status", scope: scope, generation: capture.generation)
        let current = try capturedSnapshot(scope: scope, batch: capture.photoQueue)
        guard let status else { throw Failure.changed }
        try checkCapture(capture, status: status)
        guard status.rootVersion == current.revision, status.entryCount + status.gapCount == current.resources.count else { throw Failure.changed }
        let sealed: RustInventoryClient.Status = try client.run("sealPhotoCapture", scope: scope, generation: capture.generation,
            fields: ["resourceRevision": current.revision, "totalEntries": capture.totalEntries, "totalGaps": status.gapCount])
        try checkCapture(capture, status: sealed)
        guard sealed.coverage == "sealed", sealed.rootVersion == current.revision else { throw RustInventoryTransportFailure.invalidResponse }
        try require()
        try remember(current.resources, scope: scope, revision: current.revision)
        return capture
    }

    public func status(scope: Scope, id: String, allowCloudGaps: Bool = false,
                       queueRequest: PhotoBackupQueueRequest? = nil) throws -> MobileFolderInventory.Capture? {
        try require()
        guard UUID(uuidString: id) != nil else { throw MobileFolderStore.Failure.invalid }
        let generation = id.lowercased()
        let value: RustInventoryClient.Status? = try requireClient().run("status", scope: scope, generation: generation)
        guard let value, value.mode == "photo", value.coverage == "sealed", value.generation == generation else { return nil }
        lock.lock(); defer { lock.unlock() }
        let batch = try queueRequest.map { try batchSnapshot(scope: scope, store: queueStore(scope: scope, request: $0)) }
        let current = try batch?.0 ?? snapshot()
        let capture = Self.descriptor(id: generation, entries: value.entryCount, gaps: value.gapCount,
                                      allowCloudGaps: allowCloudGaps, queue: batch?.1.descriptor)
        try checkCapture(capture, status: value)
        guard current.revision == value.rootVersion, current.resources.count == value.entryCount + value.gapCount else { throw Failure.changed }
        return capture
    }

    public func retryUnavailableQueueOriginals(scope: Scope, request: PhotoBackupQueueRequest) throws {
        lock.lock(); defer { lock.unlock() }
        try require(); try queueStore(scope: scope, request: request).retryUnavailable()
    }

    public func readSkipped(scope: Scope, capture: MobileFolderInventory.Capture, offset: Int, pageSize: Int? = nil) throws -> MobileFolderInventory.SkippedPage {
        lock.lock(); defer { lock.unlock() }
        try require()
        let limit = min(pageSize ?? MobileFolderInventory.maximumPageEntries, MobileFolderInventory.maximumPageEntries)
        guard limit > 0, let total = capture.totalSkipped, offset >= 0, offset < total || (offset == 0 && total == 0)
        else { throw MobileFolderStore.Failure.invalid }
        let client = try requireClient()
        let value: RustInventoryClient.Status? = try client.run("status", scope: scope, generation: capture.generation)
        guard let value, value.coverage == "sealed" else { throw Failure.changed }
        try checkCapture(capture, status: value)
        if membership?.scope != scope || membership?.revision != value.rootVersion {
            let current = try capturedSnapshot(scope: scope, batch: capture.photoQueue)
            guard current.revision == value.rootVersion, current.resources.count == value.entryCount + value.gapCount else { throw Failure.changed }
            try remember(current.resources, scope: scope, revision: current.revision)
        }
        let page = try client.gaps(scope, generation: capture.generation, offset: offset, limit: limit)
        let next = offset + page.gaps.count
        guard page.generation == capture.generation, page.gapCount == total, next <= total,
              page.gaps.count <= limit, !page.gaps.isEmpty || total == 0, page.nextOffset == (next < total ? next : nil) else { throw Failure.changed }
        let rows = try page.gaps.enumerated().map { i, gap in
            try require()
            let checked = try gap.checked()
            guard checked.reason == .cloudOriginal, checked.scope == .entry,
                  let path = checked.path, let resource = membership?.resources[path] else { throw Failure.changed }
            try provider.validate(resource)
            return MobileFolderInventory.Skipped(ordinal: offset + i, gap: checked)
        }
        return .init(capture: capture, offset: offset, skipped: rows, nextOffset: page.nextOffset, totalSkipped: total)
    }

    public func page(scope: Scope, capture: MobileFolderInventory.Capture, offset: Int, pageSize: Int? = nil) throws -> MobileFolderInventory.Page {
        lock.lock(); defer { lock.unlock() }
        do {
            try require()
            guard UUID(uuidString: capture.id) != nil, capture.id == capture.generation,
                  offset >= 0, offset <= capture.totalEntries,
                  offset < capture.totalEntries || offset == 0 else { throw MobileFolderStore.Failure.invalid }
            let client = try requireClient()
            let limit = min(pageSize ?? MobileFolderInventory.maximumPageEntries, MobileFolderInventory.maximumPageEntries)
            guard limit > 0 else { throw MobileFolderStore.Failure.invalid }
            let page: RustInventoryClient.Page = try client.run("photoPage", scope: scope, generation: capture.generation,
                fields: ["offset": offset, "limit": limit])
            guard let status = page.status else { throw Failure.changed }
            try checkCapture(capture, status: status)
            guard page.generation == capture.generation, page.coverage == "sealed", page.totalEntries == capture.totalEntries,
                  page.entries.count <= limit, page.entries.count <= capture.totalEntries - offset,
                  !page.entries.isEmpty || capture.totalEntries == 0 else { throw Failure.changed }
            let next = offset + page.entries.count
            guard page.nextOffset == (next < capture.totalEntries ? next : nil) else { throw Failure.changed }
            if membership?.scope != scope || membership?.revision != page.rootVersion || page.nextOffset == nil {
                let current = try capturedSnapshot(scope: scope, batch: capture.photoQueue)
                guard current.revision == page.rootVersion, current.resources.count == status.entryCount + status.gapCount else { throw Failure.changed }
                try remember(current.resources, scope: scope, revision: current.revision)
            }
            for entry in page.entries {
                try require()
                guard let resource = membership?.resources[entry.path], try project(entry, resource: resource) == entry else { throw Failure.changed }
                try provider.validate(resource)
            }
            try require()
            return MobileFolderInventory.Page(capture: capture, offset: offset, entries: page.entries, nextOffset: page.nextOffset)
        } catch { clear(); membership = nil; throw error }
    }

    public func discard(scope: Scope, capture: MobileFolderInventory.Capture) throws {
        lock.lock(); defer { lock.unlock() }
        guard UUID(uuidString: capture.id) != nil, capture.id == capture.generation else { throw MobileFolderStore.Failure.invalid }
        let client = try requireClient()
        let status: RustInventoryClient.Status? = try client.run("status", scope: scope, generation: capture.generation)
        guard let status else { return }
        guard status.mode == "photo" else { throw Failure.changed }
        guard !["invalidated", "cancelled"].contains(status.coverage) else { return }
        let _: RustInventoryClient.Status = try client.run("discardPhotoCapture", scope: scope, generation: capture.generation)
    }

    public func inspect(scope: Scope, path: String) throws -> MobileFolderReader.Entry? {
        lock.lock(); defer { lock.unlock() }
        do {
            return try resolve(path: path, scope: scope).map { try scanEntry($0, scope: scope) }
        } catch { clear(); throw error }
    }

    /// Asset identity, current revision, and number of original resources are
    /// all from PhotoKit; a Live Photo's motion companion is not a second asset.
    public func originalIdentity(scope: Scope, source: MobileFolderReader.Entry) throws -> OriginalIdentity? {
        lock.lock(); defer { lock.unlock() }
        guard let resource = try resolve(path: source.path, scope: scope), resource.originalCount > 0 else { return nil }
        guard try scanEntry(resource, scope: scope) == source else { throw Failure.changed }
        return .init(group: Self.hash(Data((resource.asset + ":" + resource.revision).utf8)), resource: resource.identity,
                     kind: resource.assetKind, count: resource.originalCount)
    }

    public func stream(scope: Scope, path: String, version: String, offset: Int64, length: Int,
                       download: PhotoOriginalDownloadControl? = nil, receive: (Data) throws -> Void) throws -> Int64 {
        lock.lock(); defer { lock.unlock() }
        do {
            try require()
            guard let resource = try resolve(path: path, scope: scope) else { throw Failure.unavailable }
            let (entry, native, bookmark) = try materialize(resource, scope: scope, download: download)
            guard entry.version == version else { throw Failure.changed }
            let size = try MobileFolderReader.stream(bookmark: bookmark, path: native.path, version: native.version, offset: offset, length: length) { bytes in
                try require(); try receive(bytes)
            }
            try require(); try provider.validate(resource)
            return size
        } catch { clear(); throw error }
    }
    public func read(scope: Scope, path: String, version: String, offset: Int64, length: Int,
                     download: PhotoOriginalDownloadControl? = nil) throws -> MobileFolderReader.Chunk {
        lock.lock(); defer { lock.unlock() }
        do {
            try require(); guard offset >= 0, length > 0, length <= MobileFolderReader.maximumReadBytes else { throw MobileFolderStore.Failure.invalid }
            guard let resource = try resolve(path: path, scope: scope) else { throw Failure.unavailable }
            let (entry, native, bookmark) = try materialize(resource, scope: scope, download: download)
            guard entry.version == version else { throw Failure.changed }
            let chunk = try MobileFolderReader.read(bookmark: bookmark, path: native.path, version: native.version, offset: offset, length: length)
            try require(); try provider.validate(resource)
            return .init(version: entry.version, size: entry.size, offset: offset, data: chunk.data)
        } catch { clear(); throw error }
    }
}

private final class PhotoMembershipChanges: NSObject, PHPhotoLibraryChangeObserver, @unchecked Sendable {
    static let shared = PhotoMembershipChanges()
    private let lock = NSLock()
    private var revision: UInt64 = 0
    private var tracked: [PHFetchResult<PHAsset>] = []
    private var cursors: [UUID: [PHFetchResult<PHAsset>]] = [:]
    override init() { super.init(); PHPhotoLibrary.shared().register(self) }
    deinit { PHPhotoLibrary.shared().unregisterChangeObserver(self) }
    func track(_ results: [PHFetchResult<PHAsset>], cursor: UUID? = nil) {
        lock.lock(); defer { lock.unlock() }
        if let cursor { cursors[cursor] = results } else { tracked = results }
    }
    func untrack(_ cursor: UUID) {
        lock.lock(); defer { lock.unlock() }
        cursors.removeValue(forKey: cursor)
    }
    func photoLibraryDidChange(_ changeInstance: PHChange) {
        lock.lock(); defer { lock.unlock() }
        if tracked.isEmpty && cursors.isEmpty { revision &+= 1; return }
        func refresh(_ results: inout [PHFetchResult<PHAsset>]) -> Bool {
            var changed = false
            for index in results.indices {
                guard let details = changeInstance.changeDetails(for: results[index]) else { continue }
                results[index] = details.fetchResultAfterChanges
                if !details.hasIncrementalChanges || !details.insertedObjects.isEmpty || !details.removedObjects.isEmpty ||
                    !details.changedObjects.isEmpty || details.hasMoves { changed = true }
            }
            return changed
        }
        var changed = refresh(&tracked)
        // A separate foreground or legacy inventory cannot replace the
        // snapshots that a live limited-library cursor depends on.
        for key in Array(cursors.keys) {
            if var results = cursors[key] {
                let updated = refresh(&results)
                cursors[key] = results
                changed = changed || updated
            }
        }
        if changed { revision &+= 1 }
    }
    func stamp() -> UInt64 { lock.lock(); defer { lock.unlock() }; return revision }
}

public final class SystemPhotoResources: PhotoResourceProvider, OrderedPhotoResourceProvider, @unchecked Sendable {
    public init() {}
    public func membershipStamp() -> UInt64? { PhotoMembershipChanges.shared.stamp() }
    public func access() -> String {
        switch PHPhotoLibrary.authorizationStatus(for: .readWrite) {
        case .authorized: return "full"
        case .limited: return "limited"
        default: return "unavailable"
        }
    }
    private func require() throws { try Task.checkCancellation(); guard access() != "unavailable" else { throw PhotoLibraryReader.Failure.unavailable } }
    private func resources(_ asset: PHAsset) throws -> [(PhotoResource, PHAssetResource)] {
        let rows = PHAssetResource.assetResources(for: asset)
        guard !rows.isEmpty else { throw PhotoLibraryReader.Failure.unavailable }
        let descriptions = rows.map { "\($0.type.rawValue):\($0.originalFilename):\($0.uniformTypeIdentifier)" }.joined(separator: "\n")
        let revision = PhotoLibraryReader.hash(Data((asset.localIdentifier + ":" + String(asset.modificationDate?.timeIntervalSince1970 ?? -1) + ":" + descriptions).utf8))
        return rows.enumerated().map {
            (.init(asset: asset.localIdentifier, index: $0.offset, name: $0.element.originalFilename, revision: revision,
                   capturedAt: asset.creationDate, modifiedAt: asset.modificationDate,
                   assetKind: asset.mediaType == .image ? "photo" : asset.mediaType == .video ? "video" : nil,
                   originalCount: rows.count), $0.element)
        }
    }
    private func photoOptions() -> PHFetchOptions {
        let options = PHFetchOptions()
        options.includeHiddenAssets = true; options.includeAllBurstAssets = true
        options.predicate = NSPredicate(format: "mediaType == %d OR mediaType == %d", PHAssetMediaType.image.rawValue, PHAssetMediaType.video.rawValue)
        return options
    }

    public func inventory() throws -> [PhotoResource] {
        try inventory(progress: { _ in }).sorted { $0.path < $1.path }
    }
    public func inventory(progress: (PhotoLibraryReader.InventoryProgress) -> Void) throws -> [PhotoResource] {
        try require()
        let assets = PHAsset.fetchAssets(with: photoOptions())
        PhotoMembershipChanges.shared.track([assets])
        var result: [PhotoResource] = [], indexed = PhotoLibraryReader.IndexedLibrary()
        progress(.init(inspected: 0, total: assets.count, indexed: indexed, latest: nil))
        for index in 0..<assets.count {
            try require()
            let asset = assets.object(at: index), originals = try resources(asset)
            result.append(contentsOf: originals.map(\.0))
            if asset.mediaType == .video { indexed.videos += 1 } else { indexed.photos += 1 }
            indexed.files += originals.count
            progress(.init(inspected: index + 1, total: assets.count, indexed: indexed,
                latest: .init(kind: asset.mediaType == .video ? .video : .photo, capturedAt: asset.creationDate)))
        }
        return result
    }

    private final class DateOrderedInventory: OrderedPhotoInventory {
        let provider: SystemPhotoResources
        let dated: PHFetchResult<PHAsset>
        let undated: PHFetchResult<PHAsset>
        let stamp: UInt64?
        let access: String
        let token: PHPersistentChangeToken?
        private let observerID = UUID()
        private var position: OrderedPhotoCheckpoint
        private var latest: PhotoLibraryReader.InventoryProgress.Item?
        var checkpoint: OrderedPhotoCheckpoint {
            var saved = position
            // PhotoKit rejects sorting by localIdentifier on iOS. Equal dates
            // have stable positions in this fetch result, but may be reordered
            // on reopen. Only checkpoint across complete date groups.
            func isDateBoundary(_ results: PHFetchResult<PHAsset>, _ index: Int) -> Bool {
                guard index > 0, index < results.count else { return true }
                let previous = results.object(at: index - 1), next = results.object(at: index)
                return previous.creationDate != next.creationDate || previous.modificationDate != next.modificationDate
            }
            if !isDateBoundary(dated, position.dated) || !isDateBoundary(undated, position.undated) {
                saved = .init(libraryToken: nil, dated: position.dated, undated: position.undated,
                              indexed: position.indexed, unavailable: position.unavailable, passID: position.passID)
            }
            return saved
        }
        var progress: PhotoLibraryReader.InventoryProgress {
            .init(inspected: position.dated + position.undated, total: dated.count + undated.count,
                  indexed: position.indexed, latest: latest)
        }
        init(provider: SystemPhotoResources, dated: PHFetchResult<PHAsset>, undated: PHFetchResult<PHAsset>,
             stamp: UInt64?, access: String, token: PHPersistentChangeToken?, checkpoint: OrderedPhotoCheckpoint) {
            self.provider = provider; self.dated = dated; self.undated = undated
            self.stamp = stamp; self.access = access; self.token = token; self.position = checkpoint
            PhotoMembershipChanges.shared.track([dated, undated], cursor: observerID)
        }
        deinit { PhotoMembershipChanges.shared.untrack(observerID) }
        func isCurrent() throws -> Bool {
            try provider.require()
            return provider.access() == access && provider.membershipStamp() == stamp &&
                (token == nil || token == PHPhotoLibrary.shared().currentChangeToken)
        }
        func next() throws -> [PhotoResource]? {
            try provider.require()
            let a = position.dated < dated.count ? dated.object(at: position.dated) : nil
            let b = position.undated < undated.count ? undated.object(at: position.undated) : nil
            guard let asset = [a, b].compactMap({ $0 }).min(by: { left, right in
                PhotoBackupAssetOrder.precedes((left.creationDate, left.modificationDate, left.localIdentifier),
                                              (right.creationDate, right.modificationDate, right.localIdentifier))
            }) else { return nil }
            let resources = try provider.resources(asset).map(\.0)
            if asset.creationDate == nil { position.undated += 1 } else { position.dated += 1 }
            if asset.mediaType == .video { position.indexed.videos += 1 } else { position.indexed.photos += 1 }
            position.indexed.files += resources.count
            latest = .init(kind: asset.mediaType == .video ? .video : .photo, capturedAt: asset.creationDate)
            return resources
        }
    }

    func orderedInventory(resuming: OrderedPhotoCheckpoint?) throws -> any OrderedPhotoInventory {
        try require()
        let access = access(), stamp = membershipStamp()
        let library = PHPhotoLibrary.shared()
        let token: PHPersistentChangeToken? = access == "full" ? library.currentChangeToken : nil
        let datedOptions = photoOptions(), undatedOptions = photoOptions()
        datedOptions.predicate = NSCompoundPredicate(andPredicateWithSubpredicates: [datedOptions.predicate!,
            NSPredicate(format: "creationDate != nil")])
        undatedOptions.predicate = NSCompoundPredicate(andPredicateWithSubpredicates: [undatedOptions.predicate!,
            NSPredicate(format: "creationDate == nil")])
        let modified = NSSortDescriptor(key: "modificationDate", ascending: false)
        datedOptions.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false), modified]
        undatedOptions.sortDescriptors = [modified]
        let dated = PHAsset.fetchAssets(with: datedOptions), undated = PHAsset.fetchAssets(with: undatedOptions)
        var checkpoint: OrderedPhotoCheckpoint
        if let resuming, let token, let data = resuming.libraryToken,
           (try? NSKeyedUnarchiver.unarchivedObject(ofClass: PHPersistentChangeToken.self, from: data)) == token,
           (0...dated.count).contains(resuming.dated), (0...undated.count).contains(resuming.undated),
           (0...(resuming.dated + resuming.undated)).contains(resuming.indexed.photos),
           resuming.indexed.videos == resuming.dated + resuming.undated - resuming.indexed.photos,
           resuming.indexed.files >= 0, (0...resuming.indexed.files).contains(resuming.unavailable) {
            checkpoint = resuming
        } else {
            checkpoint = .init(libraryToken: token.flatMap { try? NSKeyedArchiver.archivedData(withRootObject: $0, requiringSecureCoding: true) })
        }
        if checkpoint.passID == nil { checkpoint.passID = UUID() }
        let inventory = DateOrderedInventory(provider: self, dated: dated, undated: undated, stamp: stamp, access: access,
                                             token: token, checkpoint: checkpoint)
        guard try inventory.isCurrent() else { throw PhotoLibraryReader.Failure.changed }
        return inventory
    }

    func orderedResources(identifiers: [String]) throws -> [[PhotoResource]] {
        try require()
        guard !identifiers.isEmpty else { return [] }
        let matches = PHAsset.fetchAssets(withLocalIdentifiers: identifiers, options: photoOptions())
        var assets: [String: PHAsset] = [:]
        for index in 0..<matches.count {
            let asset = matches.object(at: index)
            assets[asset.localIdentifier] = asset
        }
        return try identifiers.map { id in
            try require()
            guard let asset = assets[id] else { throw PhotoLibraryReader.Failure.changed }
            return try resources(asset).map(\.0)
        }
    }

    private func resolve(_ resource: PhotoResource) throws -> PHAssetResource {
        try require(); let assets = PHAsset.fetchAssets(withLocalIdentifiers: [resource.asset], options: nil)
        guard assets.count == 1 else { throw PhotoLibraryReader.Failure.unavailable }
        let current = try resources(assets.object(at: 0))
        guard current.indices.contains(resource.index), current[resource.index].0 == resource else { throw PhotoLibraryReader.Failure.changed }
        return current[resource.index].1
    }
    public func validate(_ resource: PhotoResource) throws { _ = try resolve(resource) }
    public func write(_ resource: PhotoResource, to url: URL) throws {
        try export(resource, to: url, download: nil)
    }
    public func download(_ resource: PhotoResource, to url: URL, control: PhotoOriginalDownloadControl) throws {
        try export(resource, to: url, download: control)
    }
    private func export(_ resource: PhotoResource, to url: URL, download: PhotoOriginalDownloadControl?) throws {
        let original = try resolve(resource), manager = PHAssetResourceManager.default(), options = PHAssetResourceRequestOptions()
        try download?.authorize()
        options.isNetworkAccessAllowed = download != nil
        guard FileManager.default.createFile(atPath: url.path, contents: nil, attributes: [.posixPermissions: 0o600]) else { throw MobileFolderStore.Failure.storage }
        let file = try FileHandle(forWritingTo: url); defer { try? file.close() }
        let state = PhotoExportState(file: file)
        if let download {
            options.progressHandler = { progress in
                guard progress.isFinite, (0...1).contains(progress) else { return }
                if state.report(progress) { download.progress(progress) }
            }
        }
        let request = manager.requestData(for: original, options: options, dataReceivedHandler: { state.receive($0) }, completionHandler: { state.complete($0) })
        do {
            while state.finished.wait(timeout: .now() + 0.1) == .timedOut {
                try require(); try download?.authorize(); try state.result()
                if state.stalled() {
                    // A quiet PhotoKit request can outlive the foreground
                    // assertion even when network access was disabled.
                    throw download == nil ? PhotoLibraryReader.Failure.readFailed : PhotoLibraryReader.Failure.cloudOriginal
                }
            }
            try state.result(); try require(); try download?.authorize(); try validate(resource)
        } catch { manager.cancelDataRequest(request); state.cancel(); throw error }
    }
}
private final class PhotoExportState: @unchecked Sendable {
    let finished = DispatchSemaphore(value: 0)
    private let lock = NSLock(), file: FileHandle
    private var error: Error?, cancelled = false, terminal = false
    private var lastActivity = DispatchTime.now().uptimeNanoseconds
    private var progress = 0.0
    func report(_ fraction: Double) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard !cancelled, !terminal, fraction > progress else { return false }
        progress = fraction; lastActivity = DispatchTime.now().uptimeNanoseconds
        return true
    }
    func stalled() -> Bool {
        lock.lock(); defer { lock.unlock() }
        return DispatchTime.now().uptimeNanoseconds - lastActivity > 60_000_000_000
    }
    init(file: FileHandle) { self.file = file }
    func receive(_ bytes: Data) { lock.lock(); defer { lock.unlock() }; guard !cancelled, error == nil else { return }; do { try file.write(contentsOf: bytes); if !bytes.isEmpty { lastActivity = DispatchTime.now().uptimeNanoseconds } } catch { self.error = PhotoLibraryReader.exportFailure(error) } }
    func complete(_ error: Error?) { lock.lock(); terminal = true; if self.error == nil, let error { self.error = PhotoLibraryReader.exportFailure(error) }; lock.unlock(); finished.signal() }
    func cancel() { lock.lock(); cancelled = true; lock.unlock() }
    func result() throws { lock.lock(); defer { lock.unlock() }; if let error { throw error } }
}
