import CryptoKit
import Darwin
import Foundation

/// Immutable file copies in app-owned storage. A matching directory is
/// derived from authenticated identity and exact cloud content, never JS paths.
public struct ManagedFileReplica: Sendable {
    public struct Scope: Hashable, Sendable {
        public let owner: FileSyncOwnerScope
        public let deviceId: String
        public let thingId: String

        public init(owner: FileSyncOwnerScope, dataPlane: String, deviceId: String, thingId: String) throws {
            guard dataPlane == "home", Self.validIdentifier(deviceId), Self.validIdentifier(thingId) else {
                throw MobileFolderStore.Failure.invalid
            }
            self.owner = owner; self.deviceId = deviceId; self.thingId = thingId
        }
        public static func validIdentifier(_ id: String) -> Bool {
            id.range(of: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$", options: .regularExpression) != nil
        }
        public func hash(into hasher: inout Hasher) {
            hasher.combine(owner.key); hasher.combine(deviceId); hasher.combine(thingId)
        }
        fileprivate var key: String { ManagedFileReplica.digest([owner.key, "home", deviceId, thingId]) }
    }

    /// Paths can be provided only by the native store or a host's own verified
    /// producer journal. The opaque snapshot fences the final removal.
    public struct VerifiedCopy: Sendable {
        fileprivate let url: URL
        fileprivate let stamp: String
    }

    private let root: URL
    public init(directory: URL) { root = directory }
    public var stagingDirectory: URL { root.appendingPathComponent(".staging", isDirectory: true) }

    private static func digest(_ parts: [String]) -> String {
        SHA256.hash(data: Data(parts.joined(separator: "\u{0}").utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private func directory(_ scope: Scope, content: FileVersionExport.Content) -> URL {
        root.appendingPathComponent(scope.key, isDirectory: true).appendingPathComponent(
            Self.digest([content.attachmentId, content.version, String(content.size), content.fingerprint.sha256]),
            isDirectory: true)
    }

    public func localURL(_ scope: Scope, content: FileVersionExport.Content) -> URL {
        directory(scope, content: content).appendingPathComponent("bytes")
    }

    /// Retain a verified version without replacing previous versions. Only the
    /// selected exact version can later be removed by its cloud proof.
    public func publish(_ prepared: FileVersionExport.Prepared, scope: Scope,
                        check: () throws -> Void) throws {
        let target = directory(scope, content: prepared.request.content)
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        var privateRoot = root
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try privateRoot.setResourceValues(values)
        try prepared.publishManaged(into: target, check: check)
    }

    public static func hasCopy(at url: URL, size: Int64) throws -> Bool {
        try withCopy(at: url) { file in
            let info = try MobileFolderReader.info(file)
            guard info.st_size == size else { throw MobileFolderStore.Failure.changed }
            return true
        } ?? false
    }

    public static func verify(at url: URL, request: FileVersionExport.Request) throws -> VerifiedCopy? {
        try request.validate()
        return try withCopy(at: url) { file in
            VerifiedCopy(url: url, stamp: try request.verifyBytes(file))
        }
    }

    /// Resolve only a previously hashed snapshot whose descriptor identity
    /// and timestamps still match. Native presenters never expose a path to JS.
    public static func checkedURL(_ copy: VerifiedCopy) throws -> URL {
        guard let current = try withCopy(at: copy.url, { try MobileFolderReader.stamp(MobileFolderReader.info($0)) }),
              current == copy.stamp else { throw MobileFolderStore.Failure.changed }
        return copy.url
    }

    /// The host must complete a fresh cloud and policy readback after hashing
    /// and before invoking removal. This operation only unlinks local bytes.
    public static func evict(_ copy: VerifiedCopy, check: () throws -> Void) throws {
        try check(); try Task.checkCancellation()
        let parent = open(copy.url.deletingLastPathComponent().path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard parent >= 0 else {
            if errno == ENOENT { return }
            throw MobileFolderStore.Failure.storage
        }
        defer { close(parent) }
        let name = copy.url.lastPathComponent
        var current = stat()
        if fstatat(parent, name, &current, AT_SYMLINK_NOFOLLOW) != 0 {
            if errno == ENOENT { return }
            throw MobileFolderStore.Failure.storage
        }
        guard current.st_mode & S_IFMT == S_IFREG, current.st_nlink == 1,
              MobileFolderReader.stamp(current) == copy.stamp else { throw MobileFolderStore.Failure.changed }
        try check(); try Task.checkCancellation()
        guard unlinkat(parent, name, 0) == 0, fsync(parent) == 0 else { throw MobileFolderStore.Failure.storage }
    }

    private static func withCopy<T>(at url: URL, _ use: (Int32) throws -> T) throws -> T? {
        guard url.isFileURL else { throw MobileFolderStore.Failure.invalid }
        let file = open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        guard file >= 0 else {
            if errno == ENOENT { return nil }
            throw MobileFolderStore.Failure.changed
        }
        defer { close(file) }
        let info = try MobileFolderReader.info(file)
        guard info.st_mode & S_IFMT == S_IFREG, info.st_nlink == 1 else { throw MobileFolderStore.Failure.changed }
        return try use(file)
    }
}
