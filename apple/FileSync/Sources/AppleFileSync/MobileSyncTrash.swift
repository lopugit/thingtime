import Foundation
import CryptoKit
import Darwin

/// Recoverable native trash, scoped to a picker grant and immutable executor
/// operation. Callers must separately authorize the live account, device and
/// explicit deletion approval. No item is purged by this adapter. Unsupported
/// cross-volume moves fail; they never fall back to copy-and-unlink.
public final class MobileSyncTrash: @unchecked Sendable {
    public typealias Entry = MobileFolderReader.Entry
    public typealias Scope = MobileSyncStaging.Scope
    public typealias Failure = MobileFolderStore.Failure
    public struct Mutation: Codable, Equatable, Sendable {
        public let kind: String; public let side: String; public let path: String; public let expected: Entry
        public init(kind: String, side: String, path: String, expected: Entry) {
            self.kind = kind; self.side = side; self.path = path; self.expected = expected
        }
    }
    public struct Operation: Codable, Equatable, Sendable {
        public let id: String; public let mutation: Mutation; public let confirmed: Bool
        public init(id: String, mutation: Mutation, confirmed: Bool) { self.id = id; self.mutation = mutation; self.confirmed = confirmed }
    }
    public struct Request: Codable, Equatable, Sendable {
        public let scope: Scope; public let rootId: String; public let operation: Operation
        public init(scope: Scope, rootId: String, operation: Operation) { self.scope = scope; self.rootId = rootId; self.operation = operation }
        public func validate(owner: FileSyncOwnerScope) throws {
            guard scope.origin == owner.origin.absoluteString, scope.ownerId == owner.ownerId, scope.dataPlane == "home",
                  !scope.rootId.isEmpty, scope.rootId.utf16.count <= 4096, !scope.deviceId.isEmpty, scope.deviceId.utf16.count <= 4096,
                  UUID(uuidString: rootId) != nil, UUID(uuidString: operation.id) != nil, !operation.confirmed,
                  operation.mutation.kind == "trash", operation.mutation.side == "local",
                  operation.mutation.path == operation.mutation.expected.path else { throw Failure.invalid }
            try MobileSyncStaging.Request.validateEntry(operation.mutation.expected)
        }
    }
    public struct Receipt: Codable, Equatable, Sendable {
        public let operationId: String; public let scope: Scope; public let entry: Entry?
        init(_ request: Request) { operationId = request.operation.id; scope = request.scope; entry = nil }
        enum CodingKeys: String, CodingKey { case operationId, scope, entry }
        public func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(operationId, forKey: .operationId); try c.encode(scope, forKey: .scope); try c.encodeNil(forKey: .entry)
        }
    }
    public struct Lookup: Codable, Sendable {
        public let status: String; public let receipt: Receipt?
        public init(status: String, receipt: Receipt?) { self.status = status; self.receipt = receipt }
    }
    public struct Restore: Codable, Equatable, Sendable {
        public let path: String; public let expected: Entry
        /// `expected` comes from inspect(), so restoration never silently picks
        /// a changed retained payload. `path` is relative to the same grant.
        public init(path: String, expected: Entry) { self.path = path; self.expected = expected }
    }
    private struct RestoreState: Codable {
        let request: Restore
        var receipt: Entry?
    }
    private struct Record: Codable {
        let version: Int
        let request: Request
        let bookmarkHash: String
        let rootIdentity: String
        var receipt: Receipt?
        var conflict: Bool
        var restoration: RestoreState?
    }
    private let directory: URL
    private let beforeMove: (() throws -> Void)?
    private let afterMove: (() throws -> Void)?
    private let afterRestore: (() throws -> Void)?
    public init(directory: URL, beforeMove: (() throws -> Void)? = nil, afterMove: (() throws -> Void)? = nil,
                afterRestore: (() throws -> Void)? = nil) {
        self.directory = directory; self.beforeMove = beforeMove; self.afterMove = afterMove; self.afterRestore = afterRestore
    }
    #if os(iOS)
    public convenience init() {
        self.init(directory: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MobileSyncTrash-v1", isDirectory: true))
    }
    #endif
    private static func digest(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
    private func key(_ request: Request) throws -> String {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        return Self.digest(try encoder.encode([request.scope.origin, request.scope.ownerId, request.scope.dataPlane,
            request.scope.rootId, request.scope.deviceId, request.rootId, request.operation.id]))
    }
    private func outsideJournal(bookmark: Data, path: String) throws {
        let parts = try MobileFolderReader.components(path)
        var stale = false
        let root = try FolderBookmark.resolve(bookmark, stale: &stale)
        guard root.isFileURL, !stale else { throw Failure.unavailable }
        let access = root.startAccessingSecurityScopedResource(); defer { if access { root.stopAccessingSecurityScopedResource() } }
        let target = parts.reduce(root.resolvingSymlinksInPath()) { $0.appendingPathComponent($1) }.standardizedFileURL.pathComponents
        let storage = directory.resolvingSymlinksInPath().standardizedFileURL.pathComponents
        let normalized: ([String]) -> [String] = { $0.map { $0.precomposedStringWithCanonicalMapping.lowercased() } }
        let a = normalized(target), b = normalized(storage)
        // A user may select a broad parent folder, but cannot sync this
        // adapter's own lock, checkpoint, retained payloads or their ancestors.
        guard !a.starts(with: b), !b.starts(with: a) else { throw Failure.invalid }
    }
    private func withRecord<T>(_ request: Request, owner: FileSyncOwnerScope, bookmark: Data, create: Bool,
                               missing: () throws -> T, work: (Int32, inout Record?) throws -> T) throws -> T {
        try request.validate(owner: owner)
        try outsideJournal(bookmark: bookmark, path: request.operation.mutation.path)
        let binding = try NativeFileDestination.rootIdentity(bookmark: bookmark)
        return try NativeFileJournal.locked(directory: directory) { root in
            let info = try MobileFolderReader.info(root)
            guard info.st_uid == geteuid(), info.st_mode & 0o077 == 0 else { throw Failure.storage }
            let name = try key(request)
            let names = create ? try MobileFolderReader.names(root) : []
            if create, !names.contains(name) {
                guard names.count < MobileFolderReader.maximumEntries,
                      mkdirat(root, name, 0o700) == 0, fsync(root) == 0 else { throw Failure.storage }
            }
            let fd = openat(root, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            if fd < 0 { if errno == ENOENT { return try missing() }; throw Failure.storage }; defer { close(fd) }
            var row = try NativeFileJournal.read(fd, as: Record.self)
            if let existing = row {
                guard existing.version == 1, existing.request == request, existing.bookmarkHash == Self.digest(bookmark),
                      existing.rootIdentity == binding else { throw Failure.changed }
                if let receipt = existing.receipt { guard receipt == Receipt(request) else { throw Failure.changed } }
            }
            return try work(fd, &row)
        }
    }
    private func retained(_ fd: Int32) throws -> Int32? {
        let item = openat(fd, "retained", O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        if item < 0 { if errno == ENOENT { return nil }; throw Failure.storage }
        return item
    }
    private func verifyPayload(_ file: Int32, expected: Entry, restoring: Bool) throws {
        if restoring, expected.kind == "folder" {
            // A writer can populate a folder between the empty check and rename.
            // Preserve and explicitly restore that entire retained directory without
            // traversing its children. This is not a recursive content snapshot.
            guard try MobileFolderReader.info(file).st_mode & S_IFMT == S_IFDIR else { throw Failure.changed }
        } else { try NativeFileDestination.verifyContent(file, source: expected) }
    }
    private func exact(_ file: Int32, expected: Entry, restoring: Bool = false) throws {
        guard try NativeFileDestination.entry(MobileFolderReader.info(file), source: expected) == expected else { throw Failure.changed }
        try verifyPayload(file, expected: expected, restoring: restoring)
        guard try MobileFolderReader.stamp(MobileFolderReader.info(file)) == expected.version else { throw Failure.changed }
    }
    private func moved(_ file: Int32, expected: Entry, restoring: Bool = false) throws -> Entry {
        let before = try MobileFolderReader.info(file), observed = NativeFileDestination.entry(before, source: expected)
        // Rename changes ctime. Device/inode, size, mtime and content must match.
        guard observed.id == expected.id,
              observed.version.split(separator: ":").dropLast(2) == expected.version.split(separator: ":").dropLast(2) else { throw Failure.changed }
        try verifyPayload(file, expected: expected, restoring: restoring)
        guard try MobileFolderReader.stamp(MobileFolderReader.info(file)) == observed.version else { throw Failure.changed }
        return observed
    }
    private func recover(_ fd: Int32, root: Int32, parent: Int32, row: inout Record) throws -> Lookup {
        if let receipt = row.receipt { return Lookup(status: "complete", receipt: receipt) }
        if row.conflict { return Lookup(status: "pending", receipt: nil) }
        guard let item = try retained(fd) else { return Lookup(status: "missing", receipt: nil) }
        defer { close(item) }
        do { _ = try moved(item, expected: row.request.operation.mutation.expected) }
        catch Failure.changed {
            row.conflict = true; try NativeFileJournal.save(row, fd)
            return Lookup(status: "pending", receipt: nil)
        }
        guard fsync(item) == 0, fsync(fd) == 0, fsync(parent) == 0, fsync(root) == 0 else { throw Failure.storage }
        row.receipt = Receipt(row.request); try NativeFileJournal.save(row, fd)
        return Lookup(status: "complete", receipt: row.receipt)
    }
    public func lookup(_ request: Request, owner: FileSyncOwnerScope, bookmark: Data) throws -> Lookup {
        try withRecord(request, owner: owner, bookmark: bookmark, create: false,
            missing: { Lookup(status: "missing", receipt: nil) }) { fd, value in
            guard var row = value else { return Lookup(status: "missing", receipt: nil) }
            if let receipt = row.receipt { return Lookup(status: "complete", receipt: receipt) }
            return try NativeFileDestination.coordinated(bookmark: bookmark, path: request.operation.mutation.path) { root, parent in
                guard try NativeFileDestination.identity(MobileFolderReader.info(root)) == row.rootIdentity else { throw Failure.changed }
                return try recover(fd, root: root, parent: parent, row: &row)
            }
        }
    }
    public func trash(_ request: Request, owner: FileSyncOwnerScope, bookmark: Data) throws -> Receipt {
        try withRecord(request, owner: owner, bookmark: bookmark, create: true, missing: { throw Failure.storage }) { fd, value in
            if let receipt = value?.receipt { return receipt }
            guard value?.restoration == nil else { throw Failure.changed }
            return try NativeFileDestination.coordinated(bookmark: bookmark, path: request.operation.mutation.path) { root, parent in
                let rootIdentity = try NativeFileDestination.identity(MobileFolderReader.info(root))
                if var existing = value {
                    guard existing.rootIdentity == rootIdentity else { throw Failure.changed }
                    let prior = try recover(fd, root: root, parent: parent, row: &existing)
                    if let receipt = prior.receipt { return receipt }
                    guard prior.status == "missing" else { throw Failure.changed }
                }
                guard let source = try NativeFileDestination.openDestination(root, path: request.operation.mutation.path) else { throw Failure.changed }
                defer { close(source) }
                try exact(source, expected: request.operation.mutation.expected)
                guard try MobileFolderReader.info(source).st_dev == MobileFolderReader.info(fd).st_dev else { throw Failure.unavailable }
                var row = value ?? Record(version: 1, request: request, bookmarkHash: Self.digest(bookmark), rootIdentity: rootIdentity,
                    receipt: nil, conflict: false, restoration: nil)
                try NativeFileJournal.save(row, fd)
                try Task.checkCancellation(); try exact(source, expected: request.operation.mutation.expected)
                try beforeMove?()
                let flags = UInt32(RENAME_EXCL | RENAME_NOFOLLOW_ANY | RENAME_RESOLVE_BENEATH)
                guard renameatx_np(root, request.operation.mutation.path, fd, "retained", flags) == 0 else { throw Failure.changed }
                try afterMove?()
                let result = try recover(fd, root: root, parent: parent, row: &row)
                guard let receipt = result.receipt else { throw Failure.changed }; return receipt
            }
        }
    }
    /// Inspect a retained item even when an external writer raced the move.
    /// The returned current stamp is required for an explicit exclusive restore.
    public func inspect(_ request: Request, owner: FileSyncOwnerScope, bookmark: Data) throws -> Entry? {
        try withRecord(request, owner: owner, bookmark: bookmark, create: false, missing: { nil }) { fd, row in
            guard row != nil, let file = try retained(fd) else { return nil }; defer { close(file) }
            let before = try MobileFolderReader.info(file), kind: String
            if before.st_mode & S_IFMT == S_IFREG, before.st_nlink == 1 { kind = "file" }
            else if before.st_mode & S_IFMT == S_IFDIR { kind = "folder" }
            else { throw Failure.changed }
            let fingerprint = kind == "file" ? try MobileFolderReader.fingerprint(file, size: Int64(before.st_size)) : nil
            let entry = Entry(path: request.operation.mutation.path, id: NativeFileDestination.identity(before), version: MobileFolderReader.stamp(before),
                kind: kind, size: kind == "file" ? Int64(before.st_size) : 0,
                sha256: kind == "file" && fingerprint == nil ? Self.digest(Data()) : nil, fingerprint: fingerprint)
            guard try MobileFolderReader.stamp(MobileFolderReader.info(file)) == entry.version else { throw Failure.changed }
            return entry
        }
    }
    public func restore(_ request: Request, owner: FileSyncOwnerScope, bookmark: Data, restore: Restore) throws -> Entry {
        _ = try MobileFolderReader.components(restore.path)
        try outsideJournal(bookmark: bookmark, path: restore.path)
        try MobileSyncStaging.Request.validateEntry(restore.expected)
        guard restore.expected.path == request.operation.mutation.path else { throw Failure.invalid }
        return try withRecord(request, owner: owner, bookmark: bookmark, create: false, missing: { throw Failure.unavailable }) { fd, value in
            guard var row = value else { throw Failure.unavailable }
            if let prior = row.restoration {
                guard prior.request == restore else { throw Failure.changed }
                if let receipt = prior.receipt { return receipt }
            }
            return try NativeFileDestination.coordinated(bookmark: bookmark, path: restore.path) { root, parent in
                guard try NativeFileDestination.identity(MobileFolderReader.info(root)) == row.rootIdentity else { throw Failure.changed }
                if let file = try retained(fd) {
                    defer { close(file) }
                    try exact(file, expected: restore.expected, restoring: true)
                    if let occupied = try NativeFileDestination.openDestination(root, path: restore.path) { close(occupied); throw Failure.changed }
                    if row.restoration == nil {
                        row.restoration = RestoreState(request: restore, receipt: nil); try NativeFileJournal.save(row, fd)
                    }
                    try Task.checkCancellation(); try exact(file, expected: restore.expected, restoring: true)
                    let flags = UInt32(RENAME_EXCL | RENAME_NOFOLLOW_ANY | RENAME_RESOLVE_BENEATH)
                    guard renameatx_np(fd, "retained", root, restore.path, flags) == 0 else { throw Failure.changed }
                    try afterRestore?()
                } else { guard row.restoration != nil else { throw Failure.changed } }
                guard let target = try NativeFileDestination.openDestination(root, path: restore.path) else { throw Failure.changed }
                defer { close(target) }
                let observed = try moved(target, expected: restore.expected, restoring: true)
                guard fsync(target) == 0, fsync(parent) == 0, fsync(root) == 0, fsync(fd) == 0 else { throw Failure.storage }
                let result = Entry(path: restore.path, id: observed.id, version: observed.version, kind: observed.kind,
                    size: observed.size, sha256: observed.sha256, fingerprint: observed.fingerprint)
                row.restoration?.receipt = result; try NativeFileJournal.save(row, fd)
                return result
            }
        }
    }
}
