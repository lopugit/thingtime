import Foundation
import CryptoKit
import Darwin

/// App-private transfer state, not file history or permission to publish into a
/// selected folder. Every bridge call separately reauthorizes the native grant.
/// The immutable operation and receipt shapes match the shared sync executor.
public final class MobileSyncStaging: @unchecked Sendable {
    public typealias Entry = MobileFolderReader.Entry
    public typealias Failure = MobileFolderStore.Failure
    public struct Scope: Codable, Equatable, Sendable {
        public init(origin: String, ownerId: String, dataPlane: String, rootId: String, deviceId: String) { self.origin = origin; self.ownerId = ownerId; self.dataPlane = dataPlane; self.rootId = rootId; self.deviceId = deviceId }

        public let origin: String; public let ownerId: String; public let dataPlane: String; public let rootId: String; public let deviceId: String
    }
    public struct Mutation: Codable, Equatable, Sendable {
        public init(kind: String, from: String, path: String, source: Entry, expectedTarget: Entry?) { self.kind = kind; self.from = from; self.path = path; self.source = source; self.expectedTarget = expectedTarget }

        public let kind: String; public let from: String; public let path: String; public let source: Entry; public let expectedTarget: Entry?
    }
    public struct Operation: Codable, Equatable, Sendable {
        public init(id: String, mutation: Mutation, confirmed: Bool) { self.id = id; self.mutation = mutation; self.confirmed = confirmed }

        public let id: String; public let mutation: Mutation; public let confirmed: Bool
    }
    public struct Request: Codable, Equatable, Sendable {
        public init(scope: Scope, rootId: String, operation: Operation) { self.scope = scope; self.rootId = rootId; self.operation = operation }

        public let scope: Scope; public let rootId: String; public let operation: Operation
        public func validate(owner: FileSyncOwnerScope) throws {
            guard scope.origin == owner.origin.absoluteString, scope.ownerId == owner.ownerId, scope.dataPlane == "home",
                  !scope.rootId.isEmpty, scope.rootId.utf16.count <= 4096, !scope.deviceId.isEmpty, scope.deviceId.utf16.count <= 4096,
                  UUID(uuidString: rootId) != nil, UUID(uuidString: operation.id) != nil, !operation.confirmed,
                  operation.mutation.kind == "copy", operation.mutation.from == "remote",
                  operation.mutation.path == operation.mutation.source.path else { throw Failure.invalid }
            try Self.validateEntry(operation.mutation.source)
            if let before = operation.mutation.expectedTarget {
                try Self.validateEntry(before)
                guard before.path == operation.mutation.path, before.kind == operation.mutation.source.kind else { throw Failure.invalid }
            }
            if operation.mutation.source.kind == "folder", operation.mutation.expectedTarget != nil { throw Failure.invalid }
        }
        private static func validateEntry(_ e: Entry) throws {
            _ = try MobileFolderReader.components(e.path)
            guard !e.id.isEmpty, e.id.utf16.count <= 512, !e.version.isEmpty, e.version.utf16.count <= 512,
                  e.size >= 0, e.size <= 9_007_199_254_740_991 else { throw Failure.invalid }
            if e.kind == "folder" {
                guard e.size == 0, e.sha256 == nil, e.fingerprint == nil else { throw Failure.invalid }
            } else if e.kind == "file" {
                if let f = e.fingerprint {
                    let mib: Int64 = 1_048_576
                    let partSize = ((max(8 * mib, (e.size + 9_999) / 10_000) + mib - 1) / mib) * mib
                    guard e.size > 0, e.sha256 == nil, f.algorithm == "sha256-parts-v1", f.partSizeBytes == partSize,
                          partSize <= 5 * 1024 * mib, f.partCount == Int((e.size + partSize - 1) / partSize), digest(f.sha256) else { throw Failure.invalid }
                } else { guard let sha = e.sha256, digest(sha) else { throw Failure.invalid } }
            } else { throw Failure.invalid }
        }
    }
    public struct Stage: Codable, Equatable, Sendable {
        public init(operationId: String, scope: Scope, token: String, entry: Entry) { self.operationId = operationId; self.scope = scope; self.token = token; self.entry = entry }

        public let operationId: String; public let scope: Scope; public let token: String; public let entry: Entry
    }
    public struct Progress: Codable, Sendable {
        public init(received: Int64, stage: Stage?) { self.received = received; self.stage = stage }
        public let received: Int64; public let stage: Stage?
    }
    public struct Receipt: Codable, Equatable, Sendable {
        public init(operationId: String, scope: Scope, entry: Entry) { self.operationId = operationId; self.scope = scope; self.entry = entry }

        public let operationId: String; public let scope: Scope; public let entry: Entry
    }
    public struct Lookup: Codable, Sendable {
        public init(status: String, receipt: Receipt?) { self.status = status; self.receipt = receipt }

        public let status: String; public let receipt: Receipt?
    }
    private struct Publication: Codable {
        let bookmarkHash: String
        let rootIdentity: String
        let candidate: Entry
        var receipt: Receipt?
        var conflict: Bool = false
    }
    private struct Record: Codable {
        let version: Int
        let request: Request
        var received: Int64
        var stage: Stage?
        var publication: Publication?
    }
    private let directory: URL
    private let afterBytesFlushed: (() throws -> Void)?
    private let beforePublication: (() throws -> Void)?
    private let afterPublication: (() throws -> Void)?
    public init(directory: URL, afterBytesFlushed: (() throws -> Void)? = nil, afterPublication: (() throws -> Void)? = nil, beforePublication: (() throws -> Void)? = nil) {
        self.directory = directory
        self.afterBytesFlushed = afterBytesFlushed; self.afterPublication = afterPublication; self.beforePublication = beforePublication
    }
    #if os(iOS)
    public convenience init() {
        self.init(directory: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MobileSyncStaging-v1", isDirectory: true))
    }
    #endif
    private static func digest(_ s: String) -> Bool { s.count == 64 && s.unicodeScalars.allSatisfy { (48...57).contains($0.value) || (97...102).contains($0.value) } }
    private static func hex(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    private func key(_ request: Request) throws -> String {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        // The binding intentionally excludes mutable progress, never the root or identity.
        return Self.hex(try encoder.encode([request.scope.origin, request.scope.ownerId, request.scope.dataPlane,
                                           request.scope.rootId, request.scope.deviceId, request.rootId, request.operation.id]))
    }
    private func locked<T>(_ work: (Int32) throws -> T) throws -> T {
        try Task.checkCancellation()
        var storageAttributes: [FileAttributeKey: Any] = [.posixPermissions: 0o700]
        #if os(iOS)
        storageAttributes[.protectionKey] = FileProtectionType.completeUntilFirstUserAuthentication
        #endif
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: storageAttributes)
        var storageDirectory = directory, attributes = URLResourceValues()
        attributes.isExcludedFromBackup = true
        try storageDirectory.setResourceValues(attributes)
        let fd = open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw Failure.storage }; defer { close(fd) }
        let lock = openat(fd, "lock", O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK, 0o600)
        guard lock >= 0 else { throw Failure.storage }; defer { close(lock) }
        let lockInfo = try MobileFolderReader.info(lock)
        guard lockInfo.st_mode & S_IFMT == S_IFREG, lockInfo.st_nlink == 1 else { throw Failure.storage }
        // Do not leave a cancelled worker blocked behind another transfer.
        while flock(lock, LOCK_EX | LOCK_NB) != 0 {
            guard errno == EWOULDBLOCK else { throw Failure.storage }
            try Task.checkCancellation(); Thread.sleep(forTimeInterval: 0.01)
        }
        defer { flock(lock, LOCK_UN) }
        try Task.checkCancellation(); return try work(fd)
    }
    private func record(_ fd: Int32) throws -> Record? {
        let file = openat(fd, "record.json", O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        if file < 0 { if errno == ENOENT { return nil }; throw Failure.storage }
        defer { close(file) }
        let info = try MobileFolderReader.info(file)
        guard info.st_mode & S_IFMT == S_IFREG, info.st_nlink == 1, info.st_size > 0, info.st_size <= 65_536 else { throw Failure.storage }
        let handle = FileHandle(fileDescriptor: file, closeOnDealloc: false)
        let data = try handle.read(upToCount: 65_537) ?? Data()
        guard data.count == info.st_size else { throw Failure.storage }
        return try JSONDecoder().decode(Record.self, from: data)
    }
    private func save(_ record: Record, _ fd: Int32) throws {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(record)
        guard data.count <= 65_536 else { throw Failure.limit }
        let name = "checkpoint-" + UUID().uuidString
        let file = openat(fd, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard file >= 0 else { throw Failure.storage }
        defer { close(file); unlinkat(fd, name, 0) }
        try FileHandle(fileDescriptor: file, closeOnDealloc: false).write(contentsOf: data)
        guard fsync(file) == 0, renameat(fd, name, fd, "record.json") == 0, fsync(fd) == 0 else { throw Failure.storage }
    }
    private func withRecord<T>(_ request: Request, owner: FileSyncOwnerScope, create: Bool,
                               work: (Int32, inout Record) throws -> T) throws -> T {
        try request.validate(owner: owner)
        return try locked { root in
            let name = try key(request)
            if create {
                let existing = try MobileFolderReader.names(root)
                if !existing.contains(name) {
                    guard existing.count < MobileFolderReader.maximumEntries else { throw Failure.limit }
                    guard mkdirat(root, name, 0o700) == 0 else { throw Failure.storage }
                }
            }
            let fd = openat(root, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            guard fd >= 0 else { throw Failure.unavailable }; defer { close(fd) }
            var row: Record
            if let existing = try record(fd) {
                guard existing.version == 1, existing.request == request, existing.received >= 0,
                      existing.received <= request.operation.mutation.source.size else { throw Failure.changed }
                row = existing
            } else {
                guard create, try MobileFolderReader.names(fd).isEmpty else { throw Failure.unavailable }
                // Journal first. A crash before payload creation is repaired on begin.
                row = Record(version: 1, request: request, received: 0, stage: nil)
                try save(row, fd); guard fsync(root) == 0 else { throw Failure.storage }
            }
            return try work(fd, &row)
        }
    }
    private func payload(_ fd: Int32, row: Record, create: Bool = false) throws -> Int32 {
        let folder = row.request.operation.mutation.source.kind == "folder"
        if create && folder && mkdirat(fd, "payload", 0o700) != 0 && errno != EEXIST { throw Failure.storage }
        let file = openat(fd, "payload", (folder ? O_RDONLY | O_DIRECTORY : O_RDWR | (create ? O_CREAT : 0)) | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK, 0o600)
        guard file >= 0 else { throw Failure.storage }
        do {
            let info = try MobileFolderReader.info(file)
            guard info.st_mode & S_IFMT == (folder ? S_IFDIR : S_IFREG), folder || info.st_nlink == 1 else { throw Failure.storage }
            if !folder {
                guard info.st_size >= row.received else { throw Failure.changed }
                if info.st_size > row.received {
                    guard row.stage == nil, ftruncate(file, off_t(row.received)) == 0, fsync(file) == 0 else { throw Failure.changed }
                }
            }
            return file
        } catch { close(file); throw error }
    }
    public func begin(_ request: Request, owner: FileSyncOwnerScope) throws -> Progress {
        try withRecord(request, owner: owner, create: true) { fd, row in
            let file = try payload(fd, row: row, create: row.received == 0 && row.stage == nil); defer { close(file) }
            if row.stage != nil { try verify(file, row: row) }
            guard fsync(file) == 0, fsync(fd) == 0 else { throw Failure.storage }
            return Progress(received: row.received, stage: row.stage)
        }
    }
    public func append(_ request: Request, owner: FileSyncOwnerScope, offset: Int64, bytes: Data) throws -> Progress {
        guard offset >= 0, !bytes.isEmpty, bytes.count <= MobileFolderReader.maximumReadBytes else { throw Failure.invalid }
        return try withRecord(request, owner: owner, create: false) { fd, row in
            guard request.operation.mutation.source.kind == "file", offset <= row.received,
                  offset <= request.operation.mutation.source.size - Int64(bytes.count) else { throw Failure.invalid }
            let file = try payload(fd, row: row); defer { close(file) }
            if offset < row.received || row.stage != nil {
                guard offset + Int64(bytes.count) <= row.received else { throw Failure.changed }
                var existing = Data(count: bytes.count)
                let count = existing.withUnsafeMutableBytes { pread(file, $0.baseAddress!, bytes.count, off_t(offset)) }
                guard count == bytes.count, existing == bytes else { throw Failure.changed }
                return Progress(received: row.received, stage: row.stage)
            }
            var written = 0
            while written < bytes.count {
                try Task.checkCancellation()
                let n = bytes.withUnsafeBytes { pwrite(file, $0.baseAddress!.advanced(by: written), bytes.count - written, off_t(offset) + off_t(written)) }
                guard n > 0 else { throw Failure.storage }; written += n
            }
            guard fsync(file) == 0 else { throw Failure.storage }
            try afterBytesFlushed?()
            row.received += Int64(bytes.count); try save(row, fd)
            return Progress(received: row.received, stage: nil)
        }
    }
    private func verify(_ file: Int32, row: Record) throws {
        guard row.received == row.request.operation.mutation.source.size else { throw Failure.changed }
        try verifyContent(file, source: row.request.operation.mutation.source)
        if let stage = row.stage {
            guard stage.operationId == row.request.operation.id, stage.scope == row.request.scope, stage.token == (try key(row.request)),
                  stage.entry == entry(try MobileFolderReader.info(file), source: row.request.operation.mutation.source) else { throw Failure.changed }
        }
    }
    private func verifyContent(_ file: Int32, source: Entry) throws {
        let before = try MobileFolderReader.info(file)
        if source.kind == "file" {
            guard before.st_mode & S_IFMT == S_IFREG, before.st_nlink == 1, before.st_size == source.size else { throw Failure.changed }
            if let expected = source.fingerprint {
                guard try MobileFolderReader.fingerprint(file, size: source.size) == expected else { throw Failure.changed }
            } else {
                var hash = SHA256(), offset: Int64 = 0
                var bytes = [UInt8](repeating: 0, count: MobileFolderReader.maximumReadBytes)
                while offset < source.size {
                    try Task.checkCancellation()
                    let n = pread(file, &bytes, Int(min(Int64(bytes.count), source.size - offset)), off_t(offset))
                    guard n > 0 else { throw Failure.changed }
                    hash.update(data: Data(bytes.prefix(n))); offset += Int64(n)
                }
                guard hash.finalize().map({ String(format: "%02x", $0) }).joined() == source.sha256 else { throw Failure.changed }
            }
        } else { guard before.st_mode & S_IFMT == S_IFDIR, try MobileFolderReader.names(file).isEmpty else { throw Failure.changed } }
        guard try MobileFolderReader.stamp(MobileFolderReader.info(file)) == MobileFolderReader.stamp(before) else { throw Failure.changed }
    }
    private func entry(_ info: stat, source: Entry) -> Entry {
        Entry(path: source.path, id: "\(info.st_dev):\(info.st_ino)", version: MobileFolderReader.stamp(info), kind: source.kind,
              size: source.size, sha256: source.sha256, fingerprint: source.fingerprint)
    }
    public func finish(_ request: Request, owner: FileSyncOwnerScope) throws -> Progress {
        try withRecord(request, owner: owner, create: false) { fd, row in
            let file = try payload(fd, row: row); defer { close(file) }
            try verify(file, row: row)
            if row.stage == nil {
                row.stage = Stage(operationId: request.operation.id, scope: request.scope, token: try key(request),
                                  entry: entry(try MobileFolderReader.info(file), source: request.operation.mutation.source))
                try save(row, fd)
            }
            return Progress(received: row.received, stage: row.stage)
        }
    }

    private static func identity(_ info: stat) -> String { "\(info.st_dev):\(info.st_ino)" }

    /// Coordinate the exact target with Files providers. Both path resolution and
    /// the final rename remain relative to the native grant; JavaScript supplies
    /// no absolute URLs. A provider/volume without the required rename support
    /// fails closed. Private staging is never copied directly over a destination.
    private func destination<T>(_ request: Request, bookmark: Data, work: (Int32, Int32) throws -> T) throws -> T {
        let parts = try MobileFolderReader.components(request.operation.mutation.path)
        var stale = false
        let url = try FolderBookmark.resolve(bookmark, stale: &stale)
        guard url.isFileURL, !stale else { throw Failure.unavailable }
        let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
        let root = open(url.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard root >= 0 else { throw Failure.unavailable }; defer { close(root) }
        let rootIdentity = try Self.identity(MobileFolderReader.info(root))
        let target = parts.reduce(url) { $0.appendingPathComponent($1) }
        var result: Result<T, Error>?, error: NSError?
        NSFileCoordinator().coordinate(writingItemAt: target, options: .forReplacing, error: &error) { coordinated in
            result = Result {
                try Task.checkCancellation()
                guard coordinated.standardizedFileURL == target.standardizedFileURL else { throw Failure.changed }
                let current = open(url.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                guard current >= 0 else { throw Failure.unavailable }; defer { close(current) }
                guard try Self.identity(MobileFolderReader.info(current)) == rootIdentity else { throw Failure.changed }
                var parent = dup(root); guard parent >= 0 else { throw Failure.storage }; defer { close(parent) }
                for (index, name) in parts.enumerated() {
                    // Refuse alternate case/Unicode spellings even on a case-sensitive volume.
                    let alias = name.precomposedStringWithCanonicalMapping.lowercased()
                    guard try MobileFolderReader.names(parent).allSatisfy({ $0 == name || $0.precomposedStringWithCanonicalMapping.lowercased() != alias }) else { throw Failure.changed }
                    if index < parts.count - 1 {
                        let next = openat(parent, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                        guard next >= 0 else { throw Failure.unavailable }; close(parent); parent = next
                    }
                }
                return try work(root, parent)
            }
        }
        if let error { throw error }; guard let result else { throw Failure.unavailable }; return try result.get()
    }
    private func openDestination(_ root: Int32, path: String) throws -> Int32? {
        let parts = try MobileFolderReader.components(path)
        var parent = dup(root); guard parent >= 0 else { throw Failure.storage }; defer { close(parent) }
        for name in parts.dropLast() {
            let next = openat(parent, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            guard next >= 0 else { throw Failure.unavailable }; close(parent); parent = next
        }
        let file = openat(parent, parts.last!, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        if file < 0 { if errno == ENOENT { return nil }; throw Failure.unavailable }
        return file
    }
    private func checkExpected(_ root: Int32, request: Request) throws {
        let expected = request.operation.mutation.expectedTarget
        guard let file = try openDestination(root, path: request.operation.mutation.path) else {
            guard expected == nil else { throw Failure.changed }; return
        }
        defer { close(file) }
        guard let expected, try entry(MobileFolderReader.info(file), source: expected) == expected else { throw Failure.changed }
        try verifyContent(file, source: expected)
        guard try MobileFolderReader.stamp(MobileFolderReader.info(file)) == expected.version else { throw Failure.changed }
    }
    private func prepareCandidate(_ fd: Int32, row: Record) throws -> Entry {
        let source = row.request.operation.mutation.source
        // Only an unjournaled, private temporary candidate may be discarded. The
        // original verified payload is retained, including after publication.
        if unlinkat(fd, "publication", source.kind == "folder" ? AT_REMOVEDIR : 0) != 0 && errno != ENOENT { throw Failure.storage }
        if source.kind == "folder", mkdirat(fd, "publication", 0o700) != 0 { throw Failure.storage }
        let candidate = openat(fd, "publication", (source.kind == "folder" ? O_RDONLY | O_DIRECTORY : O_RDWR | O_CREAT | O_EXCL) | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard candidate >= 0 else { throw Failure.storage }; defer { close(candidate) }
        if source.kind == "file" {
            let file = try payload(fd, row: row); defer { close(file) }
            var bytes = [UInt8](repeating: 0, count: MobileFolderReader.maximumReadBytes), offset: Int64 = 0
            while offset < source.size {
                try Task.checkCancellation()
                let n = pread(file, &bytes, Int(min(Int64(bytes.count), source.size - offset)), off_t(offset))
                guard n > 0 else { throw Failure.changed }
                var written = 0
                while written < n {
                    let count = bytes.withUnsafeBytes { pwrite(candidate, $0.baseAddress!.advanced(by: written), n - written, off_t(offset) + off_t(written)) }
                    guard count > 0 else { throw Failure.storage }; written += count
                }
                offset += Int64(n)
            }
        }
        try verifyContent(candidate, source: source)
        guard fsync(candidate) == 0, fsync(fd) == 0 else { throw Failure.storage }
        return entry(try MobileFolderReader.info(candidate), source: source)
    }
    private func recoverPublication(_ fd: Int32, root: Int32, parent: Int32, row: inout Record) throws -> Lookup {
        guard let publication = row.publication else { return Lookup(status: "missing", receipt: nil) }
        if let receipt = publication.receipt { return Lookup(status: "complete", receipt: receipt) }
        if publication.conflict { return Lookup(status: "pending", receipt: nil) }
        let candidate = openat(fd, "publication", O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        if candidate >= 0 {
            defer { close(candidate) }
            if try Self.identity(MobileFolderReader.info(candidate)) == publication.candidate.id {
                guard try entry(MobileFolderReader.info(candidate), source: publication.candidate) == publication.candidate else { throw Failure.changed }
                try verifyContent(candidate, source: row.request.operation.mutation.source)
                return Lookup(status: "missing", receipt: nil) // Prepared, but rename has not happened.
            }
            // Flush displaced bytes before treating their retained name as durable,
            // including when subsequent identity/content checks report a conflict.
            guard fsync(candidate) == 0, fsync(fd) == 0, fsync(parent) == 0, fsync(root) == 0 else { throw Failure.storage }
        } else if errno != ENOENT { throw Failure.storage }
        // Never repeat an uncertain swap. Recovery proves the new inode and its
        // content at the destination, plus the retained displaced inode. A local
        // edit before receipt persistence remains pending for conflict review.
        do {
            guard let file = try openDestination(root, path: row.request.operation.mutation.path) else { throw Failure.changed }
            defer { close(file) }
            let before = try MobileFolderReader.info(file)
            guard Self.identity(before) == publication.candidate.id else { throw Failure.changed }
            try verifyContent(file, source: row.request.operation.mutation.source)
            guard try MobileFolderReader.stamp(MobileFolderReader.info(file)) == MobileFolderReader.stamp(before) else { throw Failure.changed }
            if let expected = row.request.operation.mutation.expectedTarget {
                let old = openat(fd, "publication", O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
                guard old >= 0 else { throw Failure.changed }; defer { close(old) }
                let info = try MobileFolderReader.info(old)
                // rename changes ctime; identity, size, mtime and all bytes must match.
                guard Self.identity(info) == expected.id,
                      MobileFolderReader.stamp(info).split(separator: ":").dropLast(2).elementsEqual(expected.version.split(separator: ":").dropLast(2)) else { throw Failure.changed }
                try verifyContent(old, source: expected)
            } else if candidate >= 0 { throw Failure.changed }
            guard fsync(file) == 0, fsync(parent) == 0, fsync(root) == 0, fsync(fd) == 0 else { throw Failure.storage }
            let receipt = Receipt(operationId: row.request.operation.id, scope: row.request.scope,
                                  entry: entry(before, source: row.request.operation.mutation.source))
            row.publication?.receipt = receipt; try save(row, fd)
            return Lookup(status: "complete", receipt: receipt)
        } catch Failure.changed {
            row.publication?.conflict = true; try save(row, fd)
            return Lookup(status: "pending", receipt: nil)
        }
    }
    public func lookup(_ request: Request, owner: FileSyncOwnerScope, bookmark: Data) throws -> Lookup {
        try withRecord(request, owner: owner, create: true) { fd, row in
            guard let publication = row.publication else { return Lookup(status: "missing", receipt: nil) }
            guard publication.bookmarkHash == Self.hex(bookmark) else { throw Failure.changed }
            // A durable receipt is historical evidence, even if the user later
            // edits/deletes the destination. Returning it performs no write there.
            if let receipt = publication.receipt { return Lookup(status: "complete", receipt: receipt) }
            return try destination(request, bookmark: bookmark) { root, parent in
                guard try Self.identity(MobileFolderReader.info(root)) == publication.rootIdentity else { throw Failure.changed }
                return try recoverPublication(fd, root: root, parent: parent, row: &row)
            }
        }
    }
    public func publish(_ request: Request, owner: FileSyncOwnerScope, bookmark: Data, stage: Stage) throws -> Receipt {
        try withRecord(request, owner: owner, create: false) { fd, row in
            guard row.stage == stage else { throw Failure.changed }
            if let publication = row.publication {
                guard publication.bookmarkHash == Self.hex(bookmark) else { throw Failure.changed }
                if let receipt = publication.receipt { return receipt }
            }
            let file = try payload(fd, row: row); defer { close(file) }; try verify(file, row: row)
            return try destination(request, bookmark: bookmark) { root, parent in
                let info = try MobileFolderReader.info(root)
                guard info.st_dev == (try MobileFolderReader.info(fd)).st_dev else { throw Failure.unavailable }
                if let publication = row.publication {
                    guard publication.rootIdentity == Self.identity(info) else { throw Failure.changed }
                    let recovered = try recoverPublication(fd, root: root, parent: parent, row: &row)
                    if let receipt = recovered.receipt { return receipt }
                    guard recovered.status == "missing" else { throw Failure.changed }
                }
                try checkExpected(root, request: request)
                if row.publication == nil {
                    let candidate = try prepareCandidate(fd, row: row)
                    row.publication = Publication(bookmarkHash: Self.hex(bookmark), rootIdentity: Self.identity(info), candidate: candidate)
                    try save(row, fd)
                }
                try Task.checkCancellation(); try checkExpected(root, request: request)
                // Both flags are required: unsupported kernels/providers refuse.
                // SWAP retains the old inode in private storage. A non-cooperating
                // writer racing the precondition is detected during recovery; its
                // displaced bytes are preserved and no blind rollback is attempted.
                try beforePublication?()
                let flags = UInt32(RENAME_NOFOLLOW_ANY | RENAME_RESOLVE_BENEATH | (request.operation.mutation.expectedTarget == nil ? RENAME_EXCL : RENAME_SWAP))
                guard renameatx_np(fd, "publication", root, request.operation.mutation.path, flags) == 0 else { throw Failure.changed }
                try afterPublication?()
                let recovered = try recoverPublication(fd, root: root, parent: parent, row: &row)
                guard let receipt = recovered.receipt else { throw Failure.changed }; return receipt
            }
        }
    }
}
