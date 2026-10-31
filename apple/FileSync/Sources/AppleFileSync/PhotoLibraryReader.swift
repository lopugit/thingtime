import Foundation
import CryptoKit
import Photos

/// Native resources use opaque, stable paths. Access is checked independently of
/// the saved connection; an unavailable library never becomes an empty scan.
public struct PhotoResource: Equatable, Sendable {
    public let asset: String
    public let index: Int
    public let name: String
    public let revision: String
    public init(asset: String, index: Int, name: String, revision: String) {
        self.asset = asset; self.index = index; self.name = name; self.revision = revision
    }
    public var path: String {
        let identity = PhotoLibraryReader.hash(Data(asset.utf8))
        let safe = String(name.unicodeScalars.map { CharacterSet.controlCharacters.contains($0) || $0.properties.generalCategory == .format || $0 == "/" || $0 == "\\" ? "_" : String($0) }.prefix(80).joined())
        return "\(identity)-\(index)-\(safe.isEmpty ? "resource" : safe)"
    }
}
public protocol PhotoResourceProvider: Sendable {
    func access() -> String
    func inventory() throws -> [PhotoResource]
    func validate(_ resource: PhotoResource) throws
    func write(_ resource: PhotoResource, to url: URL) throws
}

/// One temporary original at a time, shared by bounded range reads. PhotoKit has
/// no public random-access resource API, so exports are file-backed, never held
/// in one Data value. The cache is private, ephemeral and partitioned by grant.
public final class PhotoLibraryReader: @unchecked Sendable {
    public enum Failure: Error, LocalizedError {
        case unavailable, changed, limit, cloudOriginal
        public var errorDescription: String? {
            switch self {
            case .unavailable: return "Photo access is unavailable. Choose photo access again."
            case .changed: return "The photo library changed during backup. Try again."
            case .limit: return "The photo library exceeds the current scan limit. Choose fewer photos."
            case .cloudOriginal: return "A photo original is unavailable locally. Download originals in Photos and try again."
            }
        }
    }
    private let provider: any PhotoResourceProvider
    private let lock = NSLock()
    private var directory: URL?
    private var cached: (scope: String, resource: PhotoResource, entry: MobileFolderReader.Entry, native: MobileFolderReader.Entry, bookmark: Data)?
    public init(provider: any PhotoResourceProvider = SystemPhotoResources()) { self.provider = provider }
    deinit { if let directory { try? FileManager.default.removeItem(at: directory) } }
    public static func hash(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
    public func access() -> String { provider.access() }
    private func require() throws { try Task.checkCancellation(); guard ["full", "limited"].contains(provider.access()) else { throw Failure.unavailable } }
    private func clear() { cached = nil; if let directory { try? FileManager.default.removeItem(at: directory) }; directory = nil }
    public func discard() { lock.lock(); defer { lock.unlock() }; clear() }
    private func materialize(_ resource: PhotoResource, scope: String) throws -> (MobileFolderReader.Entry, MobileFolderReader.Entry, Data) {
        try require(); try provider.validate(resource)
        if let cached, cached.scope == scope, cached.resource == resource { return (cached.entry, cached.native, cached.bookmark) }
        clear()
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("thingtime-photo-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700]); directory = root
        do {
            try provider.write(resource, to: root.appendingPathComponent("original")); try require(); try provider.validate(resource)
            let bookmark = try FolderBookmark.create(root)
            guard let native = try MobileFolderReader.scan(bookmark: bookmark).first,
                  native.kind == "file", let digest = native.sha256 ?? native.fingerprint?.sha256 else { throw Failure.changed }
            let version = Self.hash(Data((resource.revision + ":" + String(native.size) + ":" + digest).utf8))
            let entry = MobileFolderReader.Entry(path: resource.path, id: Self.hash(Data((resource.asset + ":" + String(resource.index)).utf8)), version: version, kind: "file", size: native.size, sha256: native.sha256, fingerprint: native.fingerprint)
            cached = (scope, resource, entry, native, bookmark); return (entry, native, bookmark)
        } catch { clear(); throw error }
    }
    public func scan(scope: String) throws -> [MobileFolderReader.Entry] {
        lock.lock(); defer { lock.unlock() }
        do {
            try require(); let initial = try provider.inventory()
            guard initial.count <= MobileFolderReader.maximumEntries, Set(initial.map(\.path)).count == initial.count else { throw Failure.limit }
            var entries: [MobileFolderReader.Entry] = [], size = 0
            for resource in initial {
                let entry = try materialize(resource, scope: scope).0
                size += try JSONEncoder().encode(entry).count; guard size <= 4 * 1024 * 1024 else { throw Failure.limit }
                entries.append(entry)
            }
            try require(); guard try provider.inventory() == initial else { throw Failure.changed }; return entries
        } catch { clear(); throw error }
    }
    public func stream(scope: String, path: String, version: String, offset: Int64, length: Int,
                       receive: (Data) throws -> Void) throws -> Int64 {
        lock.lock(); defer { lock.unlock() }
        do {
            try require()
            let resource: PhotoResource
            if let cached, cached.scope == scope, cached.resource.path == path { resource = cached.resource }
            else {
                guard let found = try provider.inventory().first(where: { $0.path == path }) else { throw Failure.unavailable }
                resource = found
            }
            let (entry, native, bookmark) = try materialize(resource, scope: scope)
            guard entry.version == version else { throw Failure.changed }
            let size = try MobileFolderReader.stream(bookmark: bookmark, path: native.path, version: native.version, offset: offset, length: length) { bytes in
                try require(); try receive(bytes)
            }
            try require(); try provider.validate(resource)
            return size
        } catch { clear(); throw error }
    }
    public func read(scope: String, path: String, version: String, offset: Int64, length: Int) throws -> MobileFolderReader.Chunk {
        lock.lock(); defer { lock.unlock() }
        do {
            try require(); guard offset >= 0, length > 0, length <= MobileFolderReader.maximumReadBytes else { throw MobileFolderStore.Failure.invalid }
            let resource: PhotoResource
            if let cached, cached.scope == scope, cached.resource.path == path { resource = cached.resource }
            else {
                guard let found = try provider.inventory().first(where: { $0.path == path }) else { throw Failure.unavailable }
                resource = found
            }
            let (entry, native, bookmark) = try materialize(resource, scope: scope)
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
        guard !rows.isEmpty, rows.count <= 32 else { throw PhotoLibraryReader.Failure.unavailable }
        let descriptions = rows.map { "\($0.type.rawValue):\($0.originalFilename):\($0.uniformTypeIdentifier)" }.joined(separator: "\n")
        let revision = PhotoLibraryReader.hash(Data((asset.localIdentifier + ":" + String(asset.modificationDate?.timeIntervalSince1970 ?? -1) + ":" + descriptions).utf8))
        return rows.enumerated().map { (.init(asset: asset.localIdentifier, index: $0.offset, name: $0.element.originalFilename, revision: revision), $0.element) }
    }
    public func inventory() throws -> [PhotoResource] {
        try require(); let options = PHFetchOptions(); options.fetchLimit = MobileFolderReader.maximumEntries + 1
        options.includeHiddenAssets = true; options.includeAllBurstAssets = true
        options.predicate = NSPredicate(format: "mediaType == %d OR mediaType == %d", PHAssetMediaType.image.rawValue, PHAssetMediaType.video.rawValue)
        let assets = PHAsset.fetchAssets(with: options)
        guard assets.count <= MobileFolderReader.maximumEntries else { throw PhotoLibraryReader.Failure.limit }
        var result: [PhotoResource] = []
        for index in 0..<assets.count {
            try require(); result += try resources(assets.object(at: index)).map(\.0)
            guard result.count <= MobileFolderReader.maximumEntries else { throw PhotoLibraryReader.Failure.limit }
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
        let original = try resolve(resource), manager = PHAssetResourceManager.default(), options = PHAssetResourceRequestOptions()
        // Do not initiate unbounded iCloud traffic outside the sync network policy.
        options.isNetworkAccessAllowed = false
        guard FileManager.default.createFile(atPath: url.path, contents: nil, attributes: [.posixPermissions: 0o600]) else { throw MobileFolderStore.Failure.storage }
        let file = try FileHandle(forWritingTo: url); defer { try? file.close() }
        let state = PhotoExportState(file: file)
        let request = manager.requestData(for: original, options: options, dataReceivedHandler: { state.receive($0) }, completionHandler: { state.complete($0) })
        do {
            while state.finished.wait(timeout: .now() + 0.1) == .timedOut { try require() }
            try state.result(); try require(); try validate(resource)
        } catch { manager.cancelDataRequest(request); state.cancel(); throw error }
    }
}
private final class PhotoExportState: @unchecked Sendable {
    let finished = DispatchSemaphore(value: 0)
    private let lock = NSLock(), file: FileHandle
    private var error: Error?, cancelled = false
    init(file: FileHandle) { self.file = file }
    func receive(_ bytes: Data) { lock.lock(); defer { lock.unlock() }; guard !cancelled, error == nil else { return }; do { try file.write(contentsOf: bytes) } catch { self.error = error } }
    func complete(_ error: Error?) { lock.lock(); if self.error == nil, error != nil { self.error = PhotoLibraryReader.Failure.cloudOriginal }; lock.unlock(); finished.signal() }
    func cancel() { lock.lock(); cancelled = true; lock.unlock() }
    func result() throws { lock.lock(); defer { lock.unlock() }; if let error { throw error } }
}
