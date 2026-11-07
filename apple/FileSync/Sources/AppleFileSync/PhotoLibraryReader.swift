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
    let identity: String
    public let path: String
    public init(asset: String, index: Int, name: String, revision: String) {
        self.asset = asset; self.index = index; self.name = name; self.revision = revision
        identity = PhotoLibraryReader.hash(Data((asset + ":" + String(index)).utf8))
        let assetHash = PhotoLibraryReader.hash(Data(asset.utf8))
        let safe = String(name.unicodeScalars.map { CharacterSet.controlCharacters.contains($0) || $0.properties.generalCategory == .format || $0 == "/" || $0 == "\\" ? "_" : String($0) }.prefix(80).joined())
        path = "\(assetHash)-\(index)-\(safe.isEmpty ? "resource" : safe)"
    }
}
public protocol PhotoResourceProvider: Sendable {
    func access() -> String
    func inventory() throws -> [PhotoResource]
    func validate(_ resource: PhotoResource) throws
    func write(_ resource: PhotoResource, to url: URL) throws
    func download(_ resource: PhotoResource, to url: URL, control: PhotoOriginalDownloadControl) throws
}
public extension PhotoResourceProvider {
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
    private var membership: (scope: Scope, revision: String?, resources: [String: PhotoResource])?
    private var cached: (scope: Scope, resource: PhotoResource, entry: MobileFolderReader.Entry, native: MobileFolderReader.Entry, bookmark: Data)?
    public init(provider: any PhotoResourceProvider = SystemPhotoResources(), transport: (any RustInventoryTransport)? = nil) {
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
                             authorize: () throws -> Void = {}, allowCloudGaps: Bool = false,
                             download: PhotoOriginalDownloadControl? = nil, beginDownload: () -> Bool = { true },
                             cloudGap: (PhotoResource) -> Void = { _ in },
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
                    cloudGap(resource); return nil
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
            catch { try require() }
        }
        // A stale hint does not prove absence. Only a live PhotoKit enumeration
        // can establish that a selected resource was removed or its grant changed.
        let current = try provider.inventory()
        try require()
        try remember(current, scope: scope, revision: nil)
        return membership?.resources[path]
    }

    private func snapshot() throws -> (revision: String, resources: [PhotoResource]) {
        try require()
        let resources = try provider.inventory().sorted { $0.path.utf8.lexicographicallyPrecedes($1.path.utf8) }
        var digest = SHA256(), previous: String?
        for resource in resources {
            try Task.checkCancellation()
            guard resource.path != previous else { throw Failure.changed }
            previous = resource.path
            for value in [resource.path, resource.identity, resource.revision] {
                digest.update(data: Data(SHA256.hash(data: Data(value.utf8))))
            }
        }
        try require()
        return (digest.finalize().map { String(format: "%02x", $0) }.joined(), resources)
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
                               progress: (Int, Int) -> Void = { _, _ in }, authorize: () throws -> Void = {}) throws -> MobileFolderInventory.Capture {
        lock.lock(); defer { lock.unlock() }
        guard UUID(uuidString: id) != nil, id.lowercased() == generation.lowercased() else { throw MobileFolderStore.Failure.invalid }
        let client = try requireClient(), generation = generation.lowercased()
        try authorize()
        let start = try snapshot()
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
            if prepared.coverage == "scanning" {
                // An interrupted async job is discarded before a new capture starts.
                guard indexed == 0, skipped == 0 else { throw Failure.changed }
                for startIndex in stride(from: 0, to: start.resources.count, by: Self.observationBatchSize) {
                    let end = min(start.resources.count, startIndex + Self.observationBatchSize)
                    let resources = start.resources[startIndex..<end]
                    var gaps = Set<String>()
                    let entries = try scanEntries(resources, scope: scope, authorize: authorize, allowCloudGaps: allowCloudGaps, download: download, beginDownload: {
                            if let maximumCloudDownloads, cloudDownloads >= maximumCloudDownloads { return false }
                            cloudDownloads += 1
                            return true
                        }, cloudGap: { resource in
                            gaps.insert(resource.path); skipped += 1; progress(indexed, skipped)
                        }) { indexed += 1; progress(indexed, skipped) }
                    if !entries.isEmpty {
                        let _: RustInventoryClient.Status = try client.run("appendPhotoCapture", scope: scope,
                            generation: generation, fields: ["resources": resources.filter { !gaps.contains($0.path) }.map(resourceKey)])
                    }
                    if !gaps.isEmpty {
                        let _: RustInventoryClient.Status = try client.run("appendPhotoCloudGaps", scope: scope,
                            generation: generation, fields: ["paths": gaps.sorted()])
                    }
                }
            }
            try authorize(); try require()
            guard indexed + skipped == start.resources.count, allowCloudGaps || skipped == 0 else { throw Failure.changed }
            return Self.descriptor(id: generation, entries: indexed, gaps: skipped, allowCloudGaps: allowCloudGaps)
        } catch {
            clear(); membership = nil
            if began {
                let _: RustInventoryClient.Status? = try? client.run("discardPhotoCapture", scope: scope, generation: generation)
            }
            throw error
        }
    }

    private static func descriptor(id: String, entries: Int, gaps: Int, allowCloudGaps: Bool) -> MobileFolderInventory.Capture {
        .init(id: id, generation: id, totalEntries: entries, coverage: allowCloudGaps ? (gaps == 0 ? "full" : "partial") : nil,
              consistency: allowCloudGaps ? "per-entry" : nil, totalSkipped: allowCloudGaps ? gaps : nil)
    }

    private func checkCapture(_ capture: MobileFolderInventory.Capture, status: RustInventoryClient.Status) throws {
        guard UUID(uuidString: capture.id) != nil, capture.id == capture.generation, status.mode == "photo",
              status.generation == capture.generation, status.entryCount >= 0, status.gapCount >= 0,
              status.entryCount <= Int.max - status.gapCount,
              capture == Self.descriptor(id: capture.id, entries: status.entryCount, gaps: status.gapCount, allowCloudGaps: capture.coverage != nil),
              capture.coverage != nil || status.gapCount == 0 else { throw Failure.changed }
    }

    public func sealCapture(scope: Scope, capture: MobileFolderInventory.Capture) throws -> MobileFolderInventory.Capture {
        lock.lock(); defer { lock.unlock() }
        try require()
        let client = try requireClient()
        let status: RustInventoryClient.Status? = try client.run("status", scope: scope, generation: capture.generation)
        let current = try snapshot()
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

    public func status(scope: Scope, id: String, allowCloudGaps: Bool = false) throws -> MobileFolderInventory.Capture? {
        try require()
        guard UUID(uuidString: id) != nil else { throw MobileFolderStore.Failure.invalid }
        let generation = id.lowercased()
        let value: RustInventoryClient.Status? = try requireClient().run("status", scope: scope, generation: generation)
        guard let value, value.mode == "photo", value.coverage == "sealed", value.generation == generation else { return nil }
        lock.lock(); defer { lock.unlock() }
        let current = try snapshot()
        let capture = Self.descriptor(id: generation, entries: value.entryCount, gaps: value.gapCount, allowCloudGaps: allowCloudGaps)
        try checkCapture(capture, status: value)
        guard current.revision == value.rootVersion, current.resources.count == value.entryCount + value.gapCount else { throw Failure.changed }
        return capture
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
            let current = try snapshot()
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
                let current = try snapshot()
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

public struct SystemPhotoResources: PhotoResourceProvider {
    public init() {}
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
        return rows.enumerated().map { (.init(asset: asset.localIdentifier, index: $0.offset, name: $0.element.originalFilename, revision: revision), $0.element) }
    }
    public func inventory() throws -> [PhotoResource] {
        try require(); let options = PHFetchOptions()
        options.includeHiddenAssets = true; options.includeAllBurstAssets = true
        options.predicate = NSPredicate(format: "mediaType == %d OR mediaType == %d", PHAssetMediaType.image.rawValue, PHAssetMediaType.video.rawValue)
        let assets = PHAsset.fetchAssets(with: options)
        var result: [PhotoResource] = []
        for index in 0..<assets.count {
            try require(); result += try resources(assets.object(at: index)).map(\.0)
        }
        try require(); return result.sorted { $0.path < $1.path }
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
                if download != nil && state.stalled() { throw PhotoLibraryReader.Failure.cloudOriginal }
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
