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
    /// One bounded link to the previous direct child's durable transition.
    /// The original parent entry is constant across the whole deletion run.
    public struct Parent: Codable, Equatable, Sendable {
        public let expected: Entry; public let previousOperationId: String?
        public init(expected: Entry, previousOperationId: String? = nil) {
            self.expected = expected; self.previousOperationId = previousOperationId
        }
    }
    public struct Request: Codable, Equatable, Sendable {
        public let scope: Scope; public let rootId: String; public let operation: Operation
        public let parent: Parent?; public let childrenOperationId: String?
        public init(scope: Scope, rootId: String, operation: Operation, parent: Parent? = nil, childrenOperationId: String? = nil) {
            self.scope = scope; self.rootId = rootId; self.operation = operation
            self.parent = parent; self.childrenOperationId = childrenOperationId
        }
        public func validate(owner: FileSyncOwnerScope) throws {
            guard scope.origin == owner.origin.absoluteString, scope.ownerId == owner.ownerId, scope.dataPlane == "home",
                  !scope.rootId.isEmpty, scope.rootId.utf16.count <= 4096, !scope.deviceId.isEmpty, scope.deviceId.utf16.count <= 4096,
                  UUID(uuidString: rootId) != nil, UUID(uuidString: operation.id) != nil, !operation.confirmed,
                  operation.mutation.kind == "trash", operation.mutation.side == "local",
                  operation.mutation.path == operation.mutation.expected.path else { throw Failure.invalid }
            try MobileSyncStaging.Request.validateEntry(operation.mutation.expected)
            if let parent {
                try MobileSyncStaging.Request.validateEntry(parent.expected)
                guard parent.expected.kind == "folder", parent.expected.path == operation.mutation.path.split(separator: "/").dropLast().joined(separator: "/")
                    else { throw Failure.invalid }
            }
            for id in [parent?.previousOperationId, childrenOperationId].compactMap({ $0 }) {
                guard UUID(uuidString: id) != nil, id != operation.id else { throw Failure.invalid }
            }
            if childrenOperationId != nil, operation.mutation.expected.kind != "folder" { throw Failure.invalid }
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
    public struct Item: Codable, Sendable {
        public let request: Request; public let kind: String; public let size: Int64; public let state: String; public let restore: Restore?
    }
    public struct Page: Codable, Sendable {
        public let items: [Item]; public let nextCursor: String?
    }
    /// Page native recovery metadata across this owner's connections/devices,
    /// but only under the same surviving picker grant. No bytes are read here.
    public func list(owner: FileSyncOwnerScope, rootId: String, bookmark: Data, cursor: String? = nil) throws -> Page {
        guard UUID(uuidString: rootId) != nil,
              cursor == nil || (cursor!.count == 64 && cursor!.allSatisfy({ "0123456789abcdef".contains($0) })) else { throw Failure.invalid }
        let binding = try NativeFileDestination.rootIdentity(bookmark: bookmark)
        return try NativeFileJournal.locked(directory: directory) { journal in
            let info = try MobileFolderReader.info(journal)
            guard info.st_uid == geteuid(), info.st_mode & 0o077 == 0 else { throw Failure.storage }
            let names = try MobileFolderReader.names(journal).filter {
                $0.count == 64 && $0.allSatisfy({ "0123456789abcdef".contains($0) }) && (cursor == nil || $0 > cursor!)
            }.sorted()
            let page = Array(names.prefix(20))
            var items: [Item] = []
            for name in page {
                try Task.checkCancellation()
                let fd = openat(journal, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                guard fd >= 0 else { throw Failure.storage }; defer { close(fd) }
                guard let row = try NativeFileJournal.read(fd, as: Record.self) else { continue }
                guard row.request.scope.ownerId == owner.ownerId, row.request.scope.origin == owner.origin.absoluteString,
                      row.request.scope.dataPlane == "home", row.request.rootId == rootId else { continue }
                try row.request.validate(owner: owner)
                guard try key(row.request) == name, row.version == 1, row.bookmarkHash == Self.digest(bookmark), row.rootIdentity == binding else { throw Failure.changed }
                var retained = stat()
                if fstatat(fd, "retained", &retained, AT_SYMLINK_NOFOLLOW) != 0 {
                    if errno == ENOENT {
                        if let pending = row.restoration, pending.receipt == nil {
                            items.append(Item(request: row.request, kind: pending.request.expected.kind, size: pending.request.expected.size,
                                              state: "restoring", restore: pending.request))
                        }
                        continue
                    }; throw Failure.storage
                }
                let kind = retained.st_mode & S_IFMT == S_IFDIR ? "folder" : retained.st_mode & S_IFMT == S_IFREG ? "file" : "other"
                let needsReview = row.conflict || row.receipt == nil || kind == "other" || (kind == "file" && retained.st_nlink != 1)
                items.append(Item(request: row.request, kind: kind, size: kind == "file" ? max(0, Int64(retained.st_size)) : 0,
                                  state: row.restoration != nil ? "restoring" : needsReview ? "needs-review" : "retained", restore: row.restoration?.request))
            }
            return Page(items: items, nextCursor: names.count > page.count ? page.last : nil)
        }
    }
    public struct RestoreState: Codable, Sendable {
        public let request: Restore
        public var receipt: Entry?
    }
    private struct Record: Codable {
        let version: Int
        let request: Request
        let bookmarkHash: String
        let rootIdentity: String
        var receipt: Receipt?
        var conflict: Bool
        var restoration: RestoreState?
        var effectiveExpected: Entry? = nil
        var parentAfter: Entry? = nil
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
    private func key(_ request: Request, operationId: String? = nil) throws -> String {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        return Self.digest(try encoder.encode([request.scope.origin, request.scope.ownerId, request.scope.dataPlane,
            request.scope.rootId, request.scope.deviceId, request.rootId, operationId ?? request.operation.id]))
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
                               missing: () throws -> T, work: (Int32, Int32, inout Record?) throws -> T) throws -> T {
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
            return try work(root, fd, &row)
        }
    }
    private func resolved(_ expected: Entry, previous: String?, request: Request, bookmark: Data,
                          rootIdentity: String, journal: Int32) throws -> Entry {
        guard let previous else { return expected }
        let fd = openat(journal, try key(request, operationId: previous), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw Failure.changed }; defer { close(fd) }
        guard let row = try NativeFileJournal.read(fd, as: Record.self), row.version == 1,
              row.request.scope == request.scope, row.request.rootId == request.rootId,
              row.request.operation.id == previous, row.bookmarkHash == Self.digest(bookmark), row.rootIdentity == rootIdentity,
              row.request.parent?.expected == expected, row.receipt == Receipt(row.request), !row.conflict, row.restoration == nil,
              let after = row.parentAfter, after.id == expected.id, after.path == expected.path, after.kind == "folder" else { throw Failure.changed }
        try row.request.validate(owner: FileSyncOwnerScope(ownerId: request.scope.ownerId, url: URL(string: request.scope.origin)!))
        try MobileSyncStaging.Request.validateEntry(after)
        return after
    }
    private func parentStamp(_ parent: Int32, expected: Entry) throws -> Entry {
        let info = try MobileFolderReader.info(parent)
        guard info.st_mode & S_IFMT == S_IFDIR else { throw Failure.changed }
        return NativeFileDestination.entry(info, source: expected)
    }
    /// Read a native-verified precondition without rewriting the immutable
    /// operation. Only completed direct-child receipts can advance a folder.
    public func expected(_ request: Request, owner: FileSyncOwnerScope, bookmark: Data) throws -> Entry {
        try request.validate(owner: owner)
        try outsideJournal(bookmark: bookmark, path: request.operation.mutation.path)
        let binding = try NativeFileDestination.rootIdentity(bookmark: bookmark)
        return try NativeFileJournal.locked(directory: directory) { journal in
            let info = try MobileFolderReader.info(journal)
            guard info.st_uid == geteuid(), info.st_mode & 0o077 == 0 else { throw Failure.storage }
            return try resolved(request.operation.mutation.expected, previous: request.childrenOperationId,
                request: request, bookmark: bookmark, rootIdentity: binding, journal: journal)
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
    private func recover(_ fd: Int32, root: Int32, parent: Int32, row: inout Record, captureParent: Bool = false) throws -> Lookup {
        if let receipt = row.receipt { return Lookup(status: "complete", receipt: receipt) }
        if row.conflict { return Lookup(status: "pending", receipt: nil) }
        guard let item = try retained(fd) else { return Lookup(status: "missing", receipt: nil) }
        defer { close(item) }
        do { _ = try moved(item, expected: row.effectiveExpected ?? row.request.operation.mutation.expected) }
        catch Failure.changed {
            row.conflict = true; try NativeFileJournal.save(row, fd)
            return Lookup(status: "pending", receipt: nil)
        }
        guard fsync(item) == 0, fsync(fd) == 0, fsync(parent) == 0, fsync(root) == 0 else { throw Failure.storage }
        // A post-crash lookup cannot attribute intervening parent changes to
        // this operation. Recover its receipt, but never invent a transition.
        if captureParent, let proof = row.request.parent {
            let after = try parentStamp(parent, expected: proof.expected)
            guard after.id == proof.expected.id else { throw Failure.changed }
            row.parentAfter = after
        }
        row.receipt = Receipt(row.request); try NativeFileJournal.save(row, fd)
        return Lookup(status: "complete", receipt: row.receipt)
    }
    public func lookup(_ request: Request, owner: FileSyncOwnerScope, bookmark: Data) throws -> Lookup {
        try withRecord(request, owner: owner, bookmark: bookmark, create: false,
            missing: { Lookup(status: "missing", receipt: nil) }) { _, fd, value in
            guard var row = value else { return Lookup(status: "missing", receipt: nil) }
            if let receipt = row.receipt { return Lookup(status: "complete", receipt: receipt) }
            return try NativeFileDestination.coordinated(bookmark: bookmark, path: request.operation.mutation.path) { root, parent in
                guard try NativeFileDestination.identity(MobileFolderReader.info(root)) == row.rootIdentity else { throw Failure.changed }
                return try recover(fd, root: root, parent: parent, row: &row)
            }
        }
    }
    public func trash(_ request: Request, owner: FileSyncOwnerScope, bookmark: Data) throws -> Receipt {
        try withRecord(request, owner: owner, bookmark: bookmark, create: true, missing: { throw Failure.storage }) { journal, fd, value in
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
                let expected = try resolved(request.operation.mutation.expected, previous: request.childrenOperationId,
                    request: request, bookmark: bookmark, rootIdentity: rootIdentity, journal: journal)
                let parentExpected = try request.parent.map { proof in
                    try resolved(proof.expected, previous: proof.previousOperationId, request: request, bookmark: bookmark,
                        rootIdentity: rootIdentity, journal: journal)
                }
                if let parentExpected { guard try parentStamp(parent, expected: parentExpected) == parentExpected else { throw Failure.changed } }
                try exact(source, expected: expected)
                guard try MobileFolderReader.info(source).st_dev == MobileFolderReader.info(fd).st_dev else { throw Failure.unavailable }
                var row = value ?? Record(version: 1, request: request, bookmarkHash: Self.digest(bookmark), rootIdentity: rootIdentity,
                    receipt: nil, conflict: false, restoration: nil)
                if let recorded = row.effectiveExpected { guard recorded == expected else { throw Failure.changed } }
                row.effectiveExpected = expected
                try NativeFileJournal.save(row, fd)
                try Task.checkCancellation(); try exact(source, expected: expected)
                if let parentExpected { guard try parentStamp(parent, expected: parentExpected) == parentExpected else { throw Failure.changed } }
                try beforeMove?()
                let flags = UInt32(RENAME_EXCL | RENAME_NOFOLLOW_ANY | RENAME_RESOLVE_BENEATH)
                guard renameatx_np(root, request.operation.mutation.path, fd, "retained", flags) == 0 else { throw Failure.changed }
                try afterMove?()
                let result = try recover(fd, root: root, parent: parent, row: &row, captureParent: true)
                guard let receipt = result.receipt else { throw Failure.changed }; return receipt
            }
        }
    }
    /// Inspect a retained item even when an external writer raced the move.
    /// The returned current stamp is required for an explicit exclusive restore.
    public func inspect(_ request: Request, owner: FileSyncOwnerScope, bookmark: Data) throws -> Entry? {
        try withRecord(request, owner: owner, bookmark: bookmark, create: false, missing: { nil }) { _, fd, row in
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
    public func restoration(_ request: Request, owner: FileSyncOwnerScope, bookmark: Data) throws -> RestoreState? {
        try withRecord(request, owner: owner, bookmark: bookmark, create: false, missing: { nil }) { _, _, value in value?.restoration }
    }
    public func reviewRestore(_ request: Request, owner: FileSyncOwnerScope, bookmark: Data, restore: Restore) throws {
        _ = try MobileFolderReader.components(restore.path)
        try outsideJournal(bookmark: bookmark, path: restore.path)
        try MobileSyncStaging.Request.validateEntry(restore.expected)
        guard restore.expected.path == request.operation.mutation.path,
              try inspect(request, owner: owner, bookmark: bookmark) == restore.expected else { throw Failure.changed }
        try NativeFileDestination.coordinated(bookmark: bookmark, path: restore.path) { root, _ in
            if let occupied = try NativeFileDestination.openDestination(root, path: restore.path) { close(occupied); throw Failure.changed }
        }
    }
    /// An existing immutable restore intent already records native approval.
    /// Resume it after a lost reply without another prompt or a new destination.
    public func resumeRestore(_ request: Request, owner: FileSyncOwnerScope, bookmark: Data, restore: Restore) throws -> Entry? {
        let pending = try withRecord(request, owner: owner, bookmark: bookmark, create: false, missing: { false }) { _, _, value in
            guard let state = value?.restoration else { return false }
            guard state.request == restore else { throw Failure.changed }
            return true
        }
        return pending ? try self.restore(request, owner: owner, bookmark: bookmark, restore: restore) : nil
    }
    public func restore(_ request: Request, owner: FileSyncOwnerScope, bookmark: Data, restore: Restore) throws -> Entry {
        _ = try MobileFolderReader.components(restore.path)
        try outsideJournal(bookmark: bookmark, path: restore.path)
        try MobileSyncStaging.Request.validateEntry(restore.expected)
        guard restore.expected.path == request.operation.mutation.path else { throw Failure.invalid }
        return try withRecord(request, owner: owner, bookmark: bookmark, create: false, missing: { throw Failure.unavailable }) { _, fd, value in
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
