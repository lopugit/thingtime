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
        public let coverage: String?
        public let consistency: String?
        public let totalSkipped: Int?
        public init(id: String, generation: String, totalEntries: Int, coverage: String? = nil, consistency: String? = nil, totalSkipped: Int? = nil) {
            self.id = id; self.generation = generation; self.totalEntries = totalEntries
            self.coverage = coverage; self.consistency = consistency; self.totalSkipped = totalSkipped
        }
    }
    public struct BackupStatus: Encodable, Sendable {
        public let id: String; public let generation: String; public let state: String
        public let coverage: String; public let consistency = "per-entry"
        public let totalEntries: Int; public let totalSkipped: Int
        /// Count of pruned entries/subtree roots, never unseen descendants.
        public let ignoredCount: Int
        public init(capture: Capture, state: String, ignoredCount: Int = 0) {
            id = capture.id; generation = capture.generation; self.state = state
            coverage = state == "complete" ? (capture.coverage ?? "partial") : "partial"
            totalEntries = capture.totalEntries; totalSkipped = capture.totalSkipped ?? 0; self.ignoredCount = ignoredCount
        }
    }
    public struct Skipped: Codable, Sendable {
        public let ordinal: Int
        public let path: String?
        public let reason: MobileFolderReader.ScanFailure.Reason
        public let scope: MobileFolderReader.BackupGap.Scope
        init(ordinal: Int, gap: MobileFolderReader.BackupGap) {
            self.ordinal = ordinal; path = gap.path; reason = gap.reason; scope = gap.scope
        }
        enum CodingKeys: String, CodingKey { case ordinal, path, reason, scope }
        public func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(ordinal, forKey: .ordinal); try c.encode(reason, forKey: .reason); try c.encode(scope, forKey: .scope)
            if let path { try c.encode(path, forKey: .path) } else { try c.encodeNil(forKey: .path) }
        }
    }
    public struct SkippedPage: Encodable, Sendable {
        public let capture: Capture; public let offset: Int; public let skipped: [Skipped]
        public let nextOffset: Int?; public let totalSkipped: Int
        enum CodingKeys: String, CodingKey { case capture, offset, skipped, nextOffset, totalSkipped }
        public func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(capture, forKey: .capture); try c.encode(offset, forKey: .offset)
            try c.encode(skipped, forKey: .skipped); try c.encode(totalSkipped, forKey: .totalSkipped)
            if let nextOffset { try c.encode(nextOffset, forKey: .nextOffset) } else { try c.encodeNil(forKey: .nextOffset) }
        }
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
        var capturePolicy: String? = nil
        var prepared: Bool? = nil
        var ignoreRules: String? = nil
        var ignoredCount: Int? = nil
    }
    public static let maximumPageEntries = 128
    public static let maximumBatchPageEntries = 4096
    private static func pageLimit(_ requested: Int?) throws -> Int {
        let limit = requested ?? maximumPageEntries
        guard (1...maximumBatchPageEntries).contains(limit) else { throw Failure.invalid }
        return limit
    }
    public static let maximumPageBytes = 512 * 1024
    public static let maximumCaptures = 8
    private typealias Failure = MobileFolderStore.Failure
    private let directory: URL
    private let commanderIndexer: URL?
    public init(directory: URL = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("ThingtimeFolderInventories", isDirectory: true), commanderIndexer: URL? = nil) {
        self.directory = directory
        #if os(macOS)
        self.commanderIndexer = commanderIndexer ?? Bundle.main.url(forAuxiliaryExecutable: "commander-indexer")
        #else
        self.commanderIndexer = nil
        #endif
    }

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
        guard try MobileFolderIgnoreRules.sameText(MobileFolderIgnoreRules(record.ignoreRules).text, record.ignoreRules), (record.ignoredCount ?? 0) >= 0 else { throw Failure.changed }
        if record.capturePolicy == "backup-supported" {
            guard record.capture.consistency == "per-entry", let skipped = record.capture.totalSkipped, skipped >= 0,
                  ["full", "partial"].contains(record.capture.coverage ?? ""),
                  record.capture.coverage != "full" || skipped == 0,
                  !record.complete || record.prepared == true else { throw Failure.changed }
        } else {
            guard record.capturePolicy == nil, record.capture.coverage == nil, record.capture.consistency == nil,
                  record.capture.totalSkipped == nil else { throw Failure.changed }
        }
    }

    /// A caller-chosen ID survives a lost reply. Unsealed captures can be rebuilt;
    /// their server-generated generation changes and no pages were readable.
    public func capture(_ scope: Scope, id: String, bookmark: Data, excludedPaths: [String] = [], ignoreRules: String? = nil) throws -> Capture {
        let exclusions = try MobileFolderReader.canonicalExclusions(excludedPaths), rules = try MobileFolderIgnoreRules(ignoreRules).text
        try MobileFolderReader.checkAccess(bookmark: bookmark)
        return try locked(scope, id: id, creating: true) { fd in
            if let old = try NativeFileJournal.read(fd, as: Record.self) {
                try validate(old, scope: scope, id: id, bookmark: bookmark)
                guard old.retired != true, old.capturePolicy == nil, (old.excludedPaths ?? []) == exclusions, MobileFolderIgnoreRules.sameText(old.ignoreRules, rules) else { throw Failure.changed }
                if old.complete { return old.capture }
            }
            let generation = UUID().uuidString.lowercased(), key = Self.digest(bookmark)
            try NativeFileJournal.save(Record(scope: scope, bookmarkHash: key,
                capture: Capture(id: id.lowercased(), generation: generation, totalEntries: 0), complete: false, excludedPaths: exclusions, ignoreRules: rules), fd)
            for name in ["inventory.sqlite", "inventory.sqlite-journal"] {
                if unlinkat(fd, name, 0) != 0 && errno != ENOENT { throw Failure.storage }
            }
            let db = try Database(directory: fd, create: true)
            try db.execute("CREATE TABLE entries (ordinal INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, identity TEXT NOT NULL UNIQUE, data BLOB NOT NULL)")
            try db.execute("BEGIN IMMEDIATE")
            var count = 0
            try MobileFolderReader.capture(bookmark: bookmark, excludedPaths: excludedPaths, ignoreRules: rules, append: { entry in
                guard count < 9_007_199_254_740_991 else { throw Failure.limit }
                try db.insert(entry, ordinal: count); count += 1
            }, replay: { visit in
                try db.rows(offset: 0) { _, data in
                    try visit(JSONDecoder().decode(MobileFolderReader.Entry.self, from: data)); return true
                }
            })
            try db.execute("COMMIT")
            let result = Capture(id: id.lowercased(), generation: generation, totalEntries: count)
            try NativeFileJournal.save(Record(scope: scope, bookmarkHash: key, capture: result, complete: true, excludedPaths: exclusions, ignoreRules: rules), fd)
            return result
        }
    }

    /// Private provisional rows are committed before the host's final live
    /// authorization check. Only sealBackup makes them readable.
    public func prepareBackup(_ scope: Scope, id: String, generation: String, bookmark: Data, excludedPaths: [String] = [], ignoreRules: String? = nil,
                              ignored: @Sendable (Int) -> Void = { _ in }, progress: @Sendable (Int, Int) -> Void = { _, _ in }) throws -> Capture {
        guard UUID(uuidString: generation) != nil else { throw Failure.invalid }
        let exclusions = try MobileFolderReader.canonicalExclusions(excludedPaths), rules = try MobileFolderIgnoreRules(ignoreRules).text
        try MobileFolderReader.checkAccess(bookmark: bookmark)
        return try locked(scope, id: id, creating: true) { fd in
            if let old = try NativeFileJournal.read(fd, as: Record.self) {
                try validate(old, scope: scope, id: id, bookmark: bookmark)
                guard old.retired != true, old.capturePolicy == "backup-supported", (old.excludedPaths ?? []) == exclusions, MobileFolderIgnoreRules.sameText(old.ignoreRules, rules) else { throw Failure.changed }
                if old.complete { return old.capture }
            }
            let initial = Capture(id: id.lowercased(), generation: generation.lowercased(), totalEntries: 0, coverage: "partial", consistency: "per-entry", totalSkipped: 0)
            try NativeFileJournal.save(Record(scope: scope, bookmarkHash: Self.digest(bookmark), capture: initial,
                complete: false, excludedPaths: exclusions, capturePolicy: "backup-supported", ignoreRules: rules, ignoredCount: 0), fd)
            for name in ["inventory.sqlite", "inventory.sqlite-journal"] {
                if unlinkat(fd, name, 0) != 0 && errno != ENOENT { throw Failure.storage }
            }
            let db = try Database(directory: fd, create: true)
            try db.execute("CREATE TABLE entries (ordinal INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, identity TEXT NOT NULL UNIQUE, data BLOB NOT NULL)")
            try db.execute("CREATE TABLE skipped (ordinal INTEGER PRIMARY KEY, data BLOB NOT NULL)")
            try db.execute("CREATE TABLE blocked_paths (path TEXT PRIMARY KEY)")
            try db.execute("BEGIN IMMEDIATE")
            var count = 0, skipped = 0, nextOrdinal = 0, ignoredCount = 0
            func skip(_ gap: MobileFolderReader.BackupGap) throws {
                guard skipped < 9_007_199_254_740_991 else { throw Failure.limit }
                try db.insertSkipped(Skipped(ordinal: skipped, gap: gap)); skipped += 1; progress(count, skipped)
            }
            func scan(ignored: () throws -> Void, append: (MobileFolderReader.Entry) throws -> Bool, skip: (MobileFolderReader.BackupGap) throws -> Void) throws {
                #if os(macOS)
                if let helper = commanderIndexer {
                    try MobileFolderReader.captureBackupWithCommander(helper: helper, bookmark: bookmark, excludedPaths: exclusions,
                        ignoreRules: rules, ignored: ignored, append: append, skip: skip)
                    return
                }
                #endif
                try MobileFolderReader.captureBackup(bookmark: bookmark, excludedPaths: exclusions, ignoreRules: rules,
                    ignored: ignored, append: append, skip: skip)
            }
            try scan(
                ignored: { ignoredCount += 1; ignored(ignoredCount) }, append: { row in
                try Task.checkCancellation()
                do {
                    if try db.blocked(row.path) {
                        try skip(.init(path: row.path, reason: .pathCollision, scope: row.kind == "folder" ? .subtree : .entry))
                        return false
                    }
                    try db.insert(row, ordinal: nextOrdinal); nextOrdinal += 1; count += 1; progress(count, skipped)
                    return true
                } catch let failure as MobileFolderReader.ScanFailure {
                    if failure.reason == .pathCollision {
                        // No first-wins upload into a case/Unicode ambiguous path.
                        try db.block(row.path)
                        count -= try db.removeCollision(row.path) { previous in
                            try skip(.init(path: previous.path, reason: .pathCollision, scope: previous.kind == "folder" ? .subtree : .entry))
                        }
                    }
                    try skip(.init(path: row.path, reason: failure.reason, scope: row.kind == "folder" ? .subtree : .entry))
                    return false
                }
            }, skip: skip)
            try Task.checkCancellation()
            #if os(macOS)
            if commanderIndexer != nil {
                try MobileFolderReader.recheckCommanderDirectories(bookmark: bookmark, replay: { visit in
                    try db.rows(offset: 0) { _, data in
                        if let gap = try visit(JSONDecoder().decode(MobileFolderReader.Entry.self, from: data)) { try skip(gap) }
                        return true
                    }
                })
            }
            #endif
            // Removing ambiguous earlier entries leaves ordinal gaps. Compact
            // once on disk before publishing any final page/count.
            try db.execute("CREATE TABLE sealed_entries (ordinal INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, identity TEXT NOT NULL UNIQUE, data BLOB NOT NULL)")
            try db.execute("INSERT INTO sealed_entries SELECT ROW_NUMBER() OVER (ORDER BY ordinal) - 1, path, identity, data FROM entries")
            try db.execute("DROP TABLE entries")
            try db.execute("ALTER TABLE sealed_entries RENAME TO entries")
            try db.execute("COMMIT")
            let result = Capture(id: id.lowercased(), generation: generation.lowercased(), totalEntries: count,
                                 coverage: skipped == 0 ? "full" : "partial", consistency: "per-entry", totalSkipped: skipped)
            try NativeFileJournal.save(Record(scope: scope, bookmarkHash: Self.digest(bookmark), capture: result,
                complete: false, excludedPaths: exclusions, capturePolicy: "backup-supported", prepared: true, ignoreRules: rules, ignoredCount: ignoredCount), fd)
            return result
        }
    }
    public func sealBackup(_ scope: Scope, capture: Capture, bookmark: Data) throws {
        try MobileFolderReader.checkAccess(bookmark: bookmark)
        try locked(scope, id: capture.id) { fd in
            guard let old = try NativeFileJournal.read(fd, as: Record.self), old.capture == capture,
                  old.capturePolicy == "backup-supported", old.prepared == true, old.retired != true else { throw Failure.changed }
            try validate(old, scope: scope, id: capture.id, bookmark: bookmark)
            try Task.checkCancellation()
            try NativeFileJournal.save(Record(scope: scope, bookmarkHash: old.bookmarkHash, capture: capture,
                complete: true, excludedPaths: old.excludedPaths, capturePolicy: old.capturePolicy, prepared: true, ignoreRules: old.ignoreRules, ignoredCount: old.ignoredCount), fd)
        }
    }
    /// Close a cancellation/seal race without reopening the source grant.
    /// This only makes private provisional metadata unreadable again.
    public func abandonBackup(_ scope: Scope, capture: Capture, bookmark: Data) throws {
        try locked(scope, id: capture.id) { fd in
            guard let old = try NativeFileJournal.read(fd, as: Record.self), old.capture == capture,
                  old.capturePolicy == "backup-supported", old.retired != true else { throw Failure.changed }
            try validate(old, scope: scope, id: capture.id, bookmark: bookmark)
            try NativeFileJournal.save(Record(scope: scope, bookmarkHash: old.bookmarkHash, capture: capture,
                complete: false, excludedPaths: old.excludedPaths, capturePolicy: old.capturePolicy, prepared: false, ignoreRules: old.ignoreRules, ignoredCount: old.ignoredCount), fd)
        }
    }
    /// Call only when this scope has no active scanner holding its cache lock.
    public func backupStatus(_ scope: Scope, id: String, bookmark: Data, excludedPaths: [String] = [], ignoreRules: String? = nil) throws -> BackupStatus? {
        let exclusions = try MobileFolderReader.canonicalExclusions(excludedPaths), rules = try MobileFolderIgnoreRules(ignoreRules).text
        try MobileFolderReader.checkAccess(bookmark: bookmark)
        guard FileManager.default.fileExists(atPath: try location(scope, id: id).path) else { return nil }
        return try locked(scope, id: id) { fd in
            guard let old = try NativeFileJournal.read(fd, as: Record.self) else { return nil }
            try validate(old, scope: scope, id: id, bookmark: bookmark)
            guard old.retired != true, old.capturePolicy == "backup-supported", (old.excludedPaths ?? []) == exclusions, MobileFolderIgnoreRules.sameText(old.ignoreRules, rules) else { throw Failure.changed }
            return BackupStatus(capture: old.capture, state: old.complete ? "complete" : "interrupted", ignoredCount: old.ignoredCount ?? 0)
        }
    }
    public func readSkipped(_ scope: Scope, capture: Capture, bookmark: Data, offset: Int, ignoreRules: String? = nil, pageSize: Int? = nil) throws -> SkippedPage {
        let limit = try Self.pageLimit(pageSize)
        try MobileFolderReader.checkAccess(bookmark: bookmark)
        guard offset >= 0, let total = capture.totalSkipped, total >= 0,
              offset < total || (offset == 0 && total == 0) else { throw Failure.invalid }
        return try locked(scope, id: capture.id) { fd in
            guard let record = try NativeFileJournal.read(fd, as: Record.self), record.complete, record.retired != true,
                  record.capturePolicy == "backup-supported", record.capture == capture, MobileFolderIgnoreRules.sameText(record.ignoreRules, try MobileFolderIgnoreRules(ignoreRules).text) else { throw Failure.changed }
            try validate(record, scope: scope, id: capture.id, bookmark: bookmark)
            let db = try Database(directory: fd, create: false)
            var rows: [Skipped] = [], bytes = 16_384, bounded = false
            try db.rows(offset: offset, table: "skipped") { ordinal, data in
                guard ordinal == offset + rows.count, ordinal < total else { throw Failure.storage }
                if rows.count == limit || bytes + data.count > Self.maximumPageBytes { bounded = true; return false }
                let row = try JSONDecoder().decode(Skipped.self, from: data)
                let gap = MobileFolderReader.BackupGap(path: row.path, reason: row.reason, scope: row.scope)
                guard row.ordinal == ordinal, gap.path == row.path, gap.reason == row.reason, gap.scope == row.scope else { throw Failure.storage }
                rows.append(row); bytes += data.count; return true
            }
            let next = offset + rows.count
            guard next <= total, !rows.isEmpty || total == 0, bounded || next == total else { throw Failure.storage }
            return SkippedPage(capture: capture, offset: offset, skipped: rows, nextOffset: next == total ? nil : next, totalSkipped: total)
        }
    }

    /// Sealed rows are immutable. The final offset and total count prove that
    /// the client received the whole capture, including an empty directory.
    public func read(_ scope: Scope, capture: Capture, bookmark: Data, offset: Int, ignoreRules: String? = nil, pageSize: Int? = nil) throws -> Page {
        let limit = try Self.pageLimit(pageSize)
        try MobileFolderReader.checkAccess(bookmark: bookmark)
        guard offset >= 0 else { throw Failure.invalid }
        return try locked(scope, id: capture.id) { fd in
            guard let record = try NativeFileJournal.read(fd, as: Record.self), record.complete, record.retired != true,
                  record.capture == capture, MobileFolderIgnoreRules.sameText(record.ignoreRules, try MobileFolderIgnoreRules(ignoreRules).text), offset < capture.totalEntries || (offset == 0 && capture.totalEntries == 0) else { throw Failure.changed }
            try validate(record, scope: scope, id: capture.id, bookmark: bookmark)
            let db = try Database(directory: fd, create: false)
            var entries: [MobileFolderReader.Entry] = [], bytes = 16_384, bounded = false
            try db.rows(offset: offset) { ordinal, data in
                guard ordinal == offset + entries.count, ordinal < capture.totalEntries else { throw Failure.storage }
                if entries.count == limit || bytes + data.count > Self.maximumPageBytes { bounded = true; return false }
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
    public func discard(_ scope: Scope, capture: Capture, bookmark: Data, ignoreRules: String? = nil) throws {
        try locked(scope, id: capture.id, removing: true) { fd in
            guard var record = try NativeFileJournal.read(fd, as: Record.self), record.capture == capture, MobileFolderIgnoreRules.sameText(record.ignoreRules, try MobileFolderIgnoreRules(ignoreRules).text) else { throw Failure.changed }
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
                // Metadata streams to disk; SQLite's bounded cache controls RAM.
                // Do not impose a fixed inventory-size ceiling on large homes.
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
            guard sqlite3_step(statement) == SQLITE_DONE else {
                guard sqlite3_errcode(handle) == SQLITE_CONSTRAINT else { throw Failure.storage }
                // Determine the violated key without publishing SQLite error text.
                var check: OpaquePointer?
                guard sqlite3_prepare_v2(handle, "SELECT 1 FROM entries WHERE path = ?", -1, &check, nil) == SQLITE_OK else { throw Failure.storage }
                defer { sqlite3_finalize(check) }
                guard sqlite3_bind_text(check, 1, entry.path.precomposedStringWithCanonicalMapping.lowercased(), -1, copy) == SQLITE_OK else { throw Failure.storage }
                let status = sqlite3_step(check)
                guard status == SQLITE_ROW || status == SQLITE_DONE else { throw Failure.storage }
                throw MobileFolderReader.ScanFailure(reason: status == SQLITE_ROW ? .pathCollision : .duplicateIdentity, path: entry.path)
            }
        }
        func insertSkipped(_ row: Skipped) throws {
            let data = try JSONEncoder().encode(row)
            guard data.count <= 65_536 else { throw Failure.limit }
            var statement: OpaquePointer?
            guard sqlite3_prepare_v2(handle, "INSERT INTO skipped VALUES (?, ?)", -1, &statement, nil) == SQLITE_OK else { throw Failure.storage }
            defer { sqlite3_finalize(statement) }
            let copy = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
            guard sqlite3_bind_int64(statement, 1, Int64(row.ordinal)) == SQLITE_OK,
                  data.withUnsafeBytes({ sqlite3_bind_blob(statement, 2, $0.baseAddress, Int32(data.count), copy) }) == SQLITE_OK,
                  sqlite3_step(statement) == SQLITE_DONE else { throw Failure.storage }
        }
        func blocked(_ path: String) throws -> Bool {
            let key = path.precomposedStringWithCanonicalMapping.lowercased(), copy = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
            var statement: OpaquePointer?
            guard sqlite3_prepare_v2(handle, "SELECT 1 FROM blocked_paths WHERE ? = path OR substr(?,1,length(path)+1) = path || '/' LIMIT 1", -1, &statement, nil) == SQLITE_OK else { throw Failure.storage }
            defer { sqlite3_finalize(statement) }
            for i in Int32(1)...2 { guard sqlite3_bind_text(statement, i, key, -1, copy) == SQLITE_OK else { throw Failure.storage } }
            let status = sqlite3_step(statement); guard status == SQLITE_ROW || status == SQLITE_DONE else { throw Failure.storage }
            return status == SQLITE_ROW
        }
        func block(_ path: String) throws {
            let key = path.precomposedStringWithCanonicalMapping.lowercased(), copy = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
            var statement: OpaquePointer?
            guard sqlite3_prepare_v2(handle, "INSERT OR IGNORE INTO blocked_paths VALUES (?)", -1, &statement, nil) == SQLITE_OK else { throw Failure.storage }
            defer { sqlite3_finalize(statement) }
            guard sqlite3_bind_text(statement, 1, key, -1, copy) == SQLITE_OK, sqlite3_step(statement) == SQLITE_DONE else { throw Failure.storage }
        }
        func removeCollision(_ path: String, visit: (MobileFolderReader.Entry) throws -> Void) throws -> Int {
            let key = path.precomposedStringWithCanonicalMapping.lowercased()
            let predicate = "path = ? OR substr(path, 1, length(?) + 1) = ? || '/'"
            let copy = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
            func bind(_ statement: OpaquePointer?) throws {
                for i in Int32(1)...3 { guard sqlite3_bind_text(statement, i, key, -1, copy) == SQLITE_OK else { throw Failure.storage } }
            }
            var read: OpaquePointer?
            guard sqlite3_prepare_v2(handle, "SELECT data FROM entries WHERE " + predicate, -1, &read, nil) == SQLITE_OK else { throw Failure.storage }
            defer { sqlite3_finalize(read) }; try bind(read)
            while true {
                try Task.checkCancellation()
                let status = sqlite3_step(read)
                if status == SQLITE_DONE { break }
                guard status == SQLITE_ROW, let blob = sqlite3_column_blob(read, 0) else { throw Failure.storage }
                let size = Int(sqlite3_column_bytes(read, 0)); guard size > 0, size <= 65_536 else { throw Failure.storage }
                try visit(JSONDecoder().decode(MobileFolderReader.Entry.self, from: Data(bytes: blob, count: size)))
            }
            var remove: OpaquePointer?
            guard sqlite3_prepare_v2(handle, "DELETE FROM entries WHERE " + predicate, -1, &remove, nil) == SQLITE_OK else { throw Failure.storage }
            defer { sqlite3_finalize(remove) }; try bind(remove)
            guard sqlite3_step(remove) == SQLITE_DONE else { throw Failure.storage }
            return Int(sqlite3_changes(handle))
        }
        func rows(offset: Int, table: String = "entries", visit: (Int, Data) throws -> Bool) throws {
            var statement: OpaquePointer?
            guard ["entries", "skipped"].contains(table) else { throw Failure.invalid }
            guard sqlite3_prepare_v2(handle, "SELECT ordinal, data FROM " + table + " WHERE ordinal >= ? ORDER BY ordinal", -1, &statement, nil) == SQLITE_OK else { throw Failure.storage }
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
