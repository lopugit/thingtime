import Foundation
import CryptoKit
import Darwin
import SQLite3

/// Private, disposable scan metadata. This does not retain file contents, grant
/// access, or replace Timeline history. Hosts reauthorize the grant on every call.
public struct MobileFolderInventory: Sendable {
    public struct Scope: Codable, Equatable, Sendable {
        public let owner: FileSyncOwnerScope
        public let deviceId: String
        public let rootId: String
        public init(owner: FileSyncOwnerScope, deviceId: String, rootId: String) {
            self.owner = owner; self.deviceId = deviceId; self.rootId = rootId
        }
    }
    public struct Capture: Codable, Equatable, Sendable {
        public let id: String
        public let generation: String
        public let totalEntries: Int
    }
    public struct Page: Codable, Sendable {
        public let capture: Capture
        public let offset: Int
        public let entries: [MobileFolderReader.Entry]
        public let nextOffset: Int?
        enum CodingKeys: String, CodingKey { case capture, offset, entries, nextOffset }
        public func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(capture, forKey: .capture); try c.encode(offset, forKey: .offset)
            try c.encode(entries, forKey: .entries)
            if let nextOffset { try c.encode(nextOffset, forKey: .nextOffset) } else { try c.encodeNil(forKey: .nextOffset) }
        }
    }
    private struct Record: Codable {
        let scope: Scope
        let bookmarkHash: String
        let capture: Capture
        let complete: Bool
        var excludedPaths: [String]? = nil
        var retired: Bool? = nil
    }
    public static let maximumPageEntries = 128
    public static let maximumPageBytes = 512 * 1024
    public static let maximumCaptures = 8
    private typealias Failure = MobileFolderStore.Failure
    private let directory: URL
    public init(directory: URL = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("ThingtimeFolderInventories", isDirectory: true)) { self.directory = directory }

    private func location(_ scope: Scope, id: String) throws -> URL {
        guard UUID(uuidString: id) != nil, UUID(uuidString: scope.rootId) != nil,
              !scope.deviceId.isEmpty, scope.deviceId.utf8.count <= 512 else { throw Failure.invalid }
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let key = Self.digest(try encoder.encode(scope))
        return directory.appendingPathComponent(key, isDirectory: true).appendingPathComponent(id.lowercased(), isDirectory: true)
    }
    private static func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    /// Serialize readers and eviction under the scope lock. These are disposable
    /// observations: an evicted generation must be recaptured, never treated as
    /// empty or spliced into pages already imported from its predecessor.
    private func locked<T>(_ scope: Scope, id: String, creating: Bool = false, removing: Bool = false,
                           work: (Int32) throws -> T) throws -> T {
        let target = try location(scope, id: id), bucket = target.deletingLastPathComponent()
        return try NativeFileJournal.locked(directory: bucket) { bucketFD in
            var attributes = stat()
            let exists = fstatat(bucketFD, target.lastPathComponent, &attributes, AT_SYMLINK_NOFOLLOW) == 0
            guard !exists || attributes.st_mode & S_IFMT == S_IFDIR else { throw Failure.storage }
            if !exists {
                guard errno == ENOENT, creating else { throw Failure.changed }
                let children = try FileManager.default.contentsOfDirectory(at: bucket,
                    includingPropertiesForKeys: [.creationDateKey], options: [])
                    .filter { UUID(uuidString: $0.lastPathComponent) != nil }
                guard children.count <= Self.maximumCaptures else { throw Failure.storage }
                if children.count == Self.maximumCaptures {
                    let oldest = try children.map { ($0, try $0.resourceValues(forKeys: [.creationDateKey]).creationDate ?? .distantPast) }
                        .sorted { $0.1 < $1.1 }.first!.0
                    try FileManager.default.removeItem(at: oldest)
                }
            }
            let result = try NativeFileJournal.locked(directory: target, work: work)
            if removing { try FileManager.default.removeItem(at: target) }
            return result
        }
    }
    private func validate(_ record: Record, scope: Scope, id: String, bookmark: Data) throws {
        guard record.scope == scope, record.capture.id == id.lowercased(), record.bookmarkHash == Self.digest(bookmark),
              UUID(uuidString: record.capture.generation) != nil, record.capture.totalEntries >= 0 else { throw Failure.changed }
    }

    /// A caller-chosen ID survives a lost reply. Unsealed captures can be rebuilt;
    /// their server-generated generation changes and no pages were readable.
    public func capture(_ scope: Scope, id: String, bookmark: Data, excludedPaths: [String] = []) throws -> Capture {
        let exclusions = try MobileFolderReader.canonicalExclusions(excludedPaths)
        try MobileFolderReader.checkAccess(bookmark: bookmark)
        return try locked(scope, id: id, creating: true) { fd in
            if let old = try NativeFileJournal.read(fd, as: Record.self) {
                try validate(old, scope: scope, id: id, bookmark: bookmark)
                guard old.retired != true, (old.excludedPaths ?? []) == exclusions else { throw Failure.changed }
                if old.complete { return old.capture }
            }
            let generation = UUID().uuidString.lowercased(), key = Self.digest(bookmark)
            try NativeFileJournal.save(Record(scope: scope, bookmarkHash: key,
                capture: Capture(id: id.lowercased(), generation: generation, totalEntries: 0), complete: false, excludedPaths: exclusions), fd)
            for name in ["inventory.sqlite", "inventory.sqlite-journal"] {
                if unlinkat(fd, name, 0) != 0 && errno != ENOENT { throw Failure.storage }
            }
            let db = try Database(directory: fd, create: true)
            try db.execute("CREATE TABLE entries (ordinal INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, identity TEXT NOT NULL UNIQUE, data BLOB NOT NULL)")
            try db.execute("BEGIN IMMEDIATE")
            var count = 0
            try MobileFolderReader.capture(bookmark: bookmark, excludedPaths: excludedPaths, append: { entry in
                guard count < 9_007_199_254_740_991 else { throw Failure.limit }
                try db.insert(entry, ordinal: count); count += 1
            }, replay: { visit in
                try db.rows(offset: 0) { _, data in
                    try visit(JSONDecoder().decode(MobileFolderReader.Entry.self, from: data)); return true
                }
            })
            try db.execute("COMMIT")
            let result = Capture(id: id.lowercased(), generation: generation, totalEntries: count)
            try NativeFileJournal.save(Record(scope: scope, bookmarkHash: key, capture: result, complete: true, excludedPaths: exclusions), fd)
            return result
        }
    }

    /// Sealed rows are immutable. The final offset and total count prove that
    /// the client received the whole capture, including an empty directory.
    public func read(_ scope: Scope, capture: Capture, bookmark: Data, offset: Int) throws -> Page {
        try MobileFolderReader.checkAccess(bookmark: bookmark)
        guard offset >= 0 else { throw Failure.invalid }
        return try locked(scope, id: capture.id) { fd in
            guard let record = try NativeFileJournal.read(fd, as: Record.self), record.complete, record.retired != true,
                  record.capture == capture, offset < capture.totalEntries || (offset == 0 && capture.totalEntries == 0) else { throw Failure.changed }
            try validate(record, scope: scope, id: capture.id, bookmark: bookmark)
            let db = try Database(directory: fd, create: false)
            var entries: [MobileFolderReader.Entry] = [], bytes = 16_384, bounded = false
            try db.rows(offset: offset) { ordinal, data in
                guard ordinal == offset + entries.count, ordinal < capture.totalEntries else { throw Failure.storage }
                if entries.count == Self.maximumPageEntries || bytes + data.count > Self.maximumPageBytes { bounded = true; return false }
                entries.append(try JSONDecoder().decode(MobileFolderReader.Entry.self, from: data)); bytes += data.count
                return true
            }
            let next = offset + entries.count
            guard next <= capture.totalEntries, !entries.isEmpty || capture.totalEntries == 0 else { throw Failure.storage }
            guard bounded || next == capture.totalEntries else { throw Failure.storage }
            return Page(capture: capture, offset: offset, entries: entries, nextOffset: next == capture.totalEntries ? nil : next)
        }
    }

    /// Removing metadata never removes a source file. Reusing an evicted ID
    /// produces a different generation, which every page request must pin.
    public func discard(_ scope: Scope, capture: Capture, bookmark: Data) throws {
        try locked(scope, id: capture.id, removing: true) { fd in
            guard var record = try NativeFileJournal.read(fd, as: Record.self), record.capture == capture else { throw Failure.changed }
            try validate(record, scope: scope, id: capture.id, bookmark: bookmark)
            record.retired = true
            try NativeFileJournal.save(record, fd)
            for name in ["inventory.sqlite", "inventory.sqlite-journal"] {
                if unlinkat(fd, name, 0) != 0 && errno != ENOENT { throw Failure.storage }
            }
        }
    }

    private final class Database {
        private var handle: OpaquePointer?
        init(directory: Int32, create: Bool) throws {
            let file = openat(directory, "inventory.sqlite", O_RDWR | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK | (create ? O_CREAT | O_EXCL : 0), 0o600)
            guard file >= 0 else { throw Failure.storage }; defer { close(file) }
            let info = try MobileFolderReader.info(file)
            guard info.st_mode & S_IFMT == S_IFREG, info.st_nlink == 1 else { throw Failure.storage }
            // SQLite rejects /dev/fd aliases with NOFOLLOW. Resolve only this
            // already-open private cache file; no caller supplies a path.
            var path = [CChar](repeating: 0, count: Int(MAXPATHLEN))
            guard fcntl(file, F_GETPATH, &path) == 0 else { throw Failure.storage }
            let flags = (create ? SQLITE_OPEN_READWRITE : SQLITE_OPEN_READONLY) | SQLITE_OPEN_NOFOLLOW
            guard sqlite3_open_v2(String(cString: path), &handle, flags, nil) == SQLITE_OK else {
                sqlite3_close(handle); handle = nil; throw Failure.storage
            }
            var current = stat()
            guard lstat(path, &current) == 0, current.st_mode & S_IFMT == S_IFREG,
                  current.st_dev == info.st_dev, current.st_ino == info.st_ino, current.st_nlink == 1 else {
                sqlite3_close(handle); handle = nil; throw Failure.storage
            }
            if create {
                try execute("PRAGMA page_size=4096")
                try execute("PRAGMA journal_mode=DELETE")
                try execute("PRAGMA synchronous=FULL")
                try execute("PRAGMA cache_size=-2048")
                try execute("PRAGMA temp_store=FILE")
                // A disk quota, not an in-memory or file-count ceiling.
                try execute("PRAGMA max_page_count=262144")
            }
        }
        deinit { sqlite3_close(handle) }
        func execute(_ sql: String) throws {
            guard sqlite3_exec(handle, sql, nil, nil, nil) == SQLITE_OK else { throw Failure.storage }
        }
        func insert(_ entry: MobileFolderReader.Entry, ordinal: Int) throws {
            let data = try JSONEncoder().encode(entry)
            guard data.count <= 65_536 else { throw Failure.limit }
            var statement: OpaquePointer?
            guard sqlite3_prepare_v2(handle, "INSERT INTO entries VALUES (?, ?, ?, ?)", -1, &statement, nil) == SQLITE_OK else { throw Failure.storage }
            defer { sqlite3_finalize(statement) }
            let copy = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
            guard sqlite3_bind_int64(statement, 1, Int64(ordinal)) == SQLITE_OK,
                  sqlite3_bind_text(statement, 2, entry.path.precomposedStringWithCanonicalMapping.lowercased(), -1, copy) == SQLITE_OK,
                  sqlite3_bind_text(statement, 3, entry.id, -1, copy) == SQLITE_OK,
                  data.withUnsafeBytes({ sqlite3_bind_blob(statement, 4, $0.baseAddress, Int32(data.count), copy) }) == SQLITE_OK else { throw Failure.storage }
            guard sqlite3_step(statement) == SQLITE_DONE else { throw Failure.invalid }
        }
        func rows(offset: Int, visit: (Int, Data) throws -> Bool) throws {
            var statement: OpaquePointer?
            guard sqlite3_prepare_v2(handle, "SELECT ordinal, data FROM entries WHERE ordinal >= ? ORDER BY ordinal", -1, &statement, nil) == SQLITE_OK else { throw Failure.storage }
            defer { sqlite3_finalize(statement) }
            guard sqlite3_bind_int64(statement, 1, Int64(offset)) == SQLITE_OK else { throw Failure.storage }
            while true {
                try Task.checkCancellation()
                let status = sqlite3_step(statement)
                if status == SQLITE_DONE { return }
                guard status == SQLITE_ROW, let blob = sqlite3_column_blob(statement, 1) else { throw Failure.storage }
                let count = Int(sqlite3_column_bytes(statement, 1))
                guard count > 0, count <= 65_536 else { throw Failure.storage }
                if try !visit(Int(sqlite3_column_int64(statement, 0)), Data(bytes: blob, count: count)) { return }
            }
        }
    }
}
