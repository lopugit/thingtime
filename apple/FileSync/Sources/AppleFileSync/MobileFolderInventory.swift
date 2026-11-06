import Foundation
import CryptoKit
import Darwin

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
    // This is an authorization/recovery record only. Entries, gaps, counts
    // and revisions live in Commander’s canonical Rust store.
    private struct Record: Codable, Equatable {
        let scope: Scope
        let bookmarkHash: String
        let id: String
        let generation: String
        let policy: String
        let exclusions: [String]
        let ignoreRules: String?
        let rootIdentity: String
        var rootContinuity: String? = nil
        var rootPath: String? = nil
        var phase: String
    }
    private struct LegacyRecord: Decodable {
        let scope: Scope
        let bookmarkHash: String
        let capture: Capture
        let excludedPaths: [String]?
        let capturePolicy: String?
        let ignoreRules: String?
    }
    public struct Change: Codable, Sendable {
        public let sequence: Int
        public let entry: MobileFolderReader.Entry
        public let revision: String
    }
    public struct ChangesPage: Codable, Sendable {
        public let id: String; public let generation: String; public let state: String
        public let revision: Int; public let changes: [Change]; public let nextSequence: Int; public let hasMore: Bool
        public let totalEntries: Int; public let totalSkipped: Int
    }
    public final class StreamControl: @unchecked Sendable {
        private let lock = NSLock()
        private var revision: Int?
        public init() {}
        public func finish(afterSequence: Int) { lock.lock(); revision = afterSequence; lock.unlock() }
        func take() -> Int? { lock.lock(); defer { lock.unlock() }; let value = revision; revision = nil; return value }
    }

    public struct Capabilities: Decodable, Sendable {
        public let version: Int
        public let strictCoverage: Bool
    }

    public static let maximumPageEntries = 128
    public static let maximumBatchPageEntries = 4096
    public static let maximumPageBytes = 512 * 1024
    private static let backup = "backup-supported"
    private static let strict = "strict-async"
    private static let legacy = "strict-inline"
    private static let stream = "one-way-supported"
    private typealias Failure = MobileFolderStore.Failure
    private let directory: URL
    private let client: RustInventoryClient?
    private let databaseDirectory: URL?
    public var supportsResourceGovernance: Bool { client != nil }

    public init(directory: URL? = nil, commanderIndexer: URL? = nil,
                transport: (any RustInventoryTransport)? = nil, database: URL? = nil) {
        self.directory = directory ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ThingtimeFolderInventories", isDirectory: true)
        #if os(macOS)
        let database = database ?? RustProcessInventoryTransport.defaultDatabase
        let resolved = transport ?? (commanderIndexer ?? RustProcessInventoryTransport.bundledHelper)
            .map { RustProcessInventoryTransport(helper: $0, database: database) }
        self.databaseDirectory = ((resolved as? RustProcessInventoryTransport)?.database ?? database).deletingLastPathComponent()
        #else
        let resolved = transport
        self.databaseDirectory = database?.deletingLastPathComponent()
        #endif
        client = resolved.map(RustInventoryClient.init(transport:))
    }

    private func requireClient() throws -> RustInventoryClient {
        guard let client else { throw RustInventoryTransportFailure.unavailable }; return client
    }
    public func capabilities() throws -> Capabilities { try capabilities(fields: [:]) }

    public func checkStrictVolume(bookmark: Data) throws {
        try withRoot(bookmark) { root in
            guard try capabilities(fields: root.fields).strictCoverage else {
                throw RustInventoryTransportFailure.operation("strict_watcher_unavailable")
            }
        }
    }

    private func capabilities(fields: [String: Any]) throws -> Capabilities {
        let value: Capabilities = try requireClient().run("capabilities", fields: fields)
        guard value.version == 1 else { throw RustInventoryTransportFailure.invalidResponse }
        return value
    }

    private static func pageLimit(_ requested: Int?) throws -> Int {
        let limit = requested ?? maximumPageEntries
        guard (1...maximumBatchPageEntries).contains(limit) else { throw Failure.invalid }; return limit
    }
    private static func digest(_ data: Data) -> String { NativeSymbolicLinks.hash(data) }
    private func location(_ scope: Scope, id: String) throws -> URL {
        guard UUID(uuidString: id) != nil, UUID(uuidString: scope.rootId) != nil,
              !scope.deviceId.isEmpty, scope.deviceId.utf8.count <= 512 else { throw Failure.invalid }
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        return directory.appendingPathComponent(Self.digest(try encoder.encode(scope)), isDirectory: true)
            .appendingPathComponent(id.lowercased(), isDirectory: true)
    }

    private func record<T>(_ scope: Scope, id: String, bookmark: Data, missing: Bool = false,
                           work: (Record?, LegacyRecord?, Int32) throws -> T) throws -> T {
        let target = try location(scope, id: id)
        if !missing && !FileManager.default.fileExists(atPath: target.path) { throw Failure.changed }
        return try NativeFileJournal.locked(directory: target.deletingLastPathComponent()) { _ in
            try NativeFileJournal.locked(directory: target) { fd in
                let existing: Record?
                let legacy: LegacyRecord?
                do { existing = try NativeFileJournal.read(fd, as: Record.self); legacy = nil }
                catch DecodingError.keyNotFound {
                    existing = nil; legacy = try NativeFileJournal.read(fd, as: LegacyRecord.self)
                }
                if let existing {
                    guard existing.scope == scope, existing.id == id.lowercased(), existing.bookmarkHash == Self.digest(bookmark),
                          UUID(uuidString: existing.generation) != nil else { throw Failure.changed }
                }
                if let legacy {
                    guard legacy.scope == scope, legacy.capture.id == id.lowercased(), legacy.bookmarkHash == Self.digest(bookmark) else { throw Failure.changed }
                }
                return try work(existing, legacy, fd)
            }
        }
    }

    private func matches(_ record: Record, policy: String, exclusions: [String]? = nil, rules: String?) -> Bool {
        record.policy == policy && (exclusions == nil || record.exclusions == exclusions) &&
            MobileFolderIgnoreRules.sameText(record.ignoreRules, rules)
    }
    private func canonical(_ excludedPaths: [String], _ ignoreRules: String?) throws -> ([String], String?) {
        (try MobileFolderReader.canonicalExclusions(excludedPaths), try MobileFolderIgnoreRules(ignoreRules).text)
    }
    private func withRoot<T>(_ bookmark: Data, expected: String? = nil, continuity: String? = nil, path: String? = nil, work: (RustInventoryClient.Root) throws -> T) throws -> T {
        try MobileFolderReader.access(bookmark) { fd in
            let root = try RustInventoryClient.Root(fd: fd)
            if let continuity, continuity != root.continuity { throw Failure.changed }
            if expected != nil && (expected != root.identity || (path != nil && path != root.path)) {
                guard let expected, root.continues(identity: expected, continuity: continuity, bookmark: bookmark) else { throw Failure.changed }
                throw FolderReconnectFailure.remounted
            }
            let result = try work(root)
            try Task.checkCancellation()
            // Keep the security scope alive during Rust calls, and catch a
            // rename/replacement before releasing the pinned descriptor.
            try root.revalidate(fd: fd)
            return result
        }
    }

    private func internalPaths(_ root: RustInventoryClient.Root) throws -> [String] {
        let prefix = root.path == "/" ? "/" : root.path + "/"
        var paths: [String] = []
        if let databaseDirectory {
            try FileManager.default.createDirectory(at: databaseDirectory, withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700])
        }
        for folder in [directory, NativeSymbolicLinks.registry, databaseDirectory].compactMap({ $0 }) {
            // URL normalization can retain /var when the root descriptor
            // reports /private/var. Compare physically opened directories.
            let fd = open(folder.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            if fd < 0 {
                guard folder != directory, errno == ENOENT else { throw Failure.storage }
                continue
            }
            defer { close(fd) }
            let path = try RustInventoryClient.Root(fd: fd).path
            guard path != root.path else { throw Failure.invalid }
            if path.hasPrefix(prefix) { paths.append(String(path.dropFirst(prefix.count))) }
        }
        return paths
    }

    private func makeRecord(_ scope: Scope, id: String, bookmark: Data, policy: String, generation: String,
                            exclusions: [String], rules: String?, root: RustInventoryClient.Root) -> Record {
        Record(scope: scope, bookmarkHash: Self.digest(bookmark), id: id.lowercased(), generation: generation.lowercased(),
            policy: policy, exclusions: exclusions, ignoreRules: rules, rootIdentity: root.identity,
            rootContinuity: root.continuity, rootPath: root.path, phase: "running")
    }

    private func start(_ scope: Scope, id: String, generation: String, bookmark: Data, excludedPaths: [String], ignoreRules: String?,
                       policy: String, resourceLimits: SyncResourceLimits?, resourceUsage: @escaping @Sendable (CommanderResourceUsage) -> Void,
                       sourceCpuMeter: SyncSourceCpuMeter?, ignored: @escaping @Sendable (Int) -> Void,
                       progress: @escaping @Sendable (Int, Int) -> Void) throws -> Capture {
        guard UUID(uuidString: generation) != nil else { throw Failure.invalid }
        let client = try requireClient()
        let (exclusions, rules) = try canonical(excludedPaths, ignoreRules)
        return try withRoot(bookmark) { root in
            if policy != Self.backup, try !capabilities(fields: root.fields).strictCoverage {
                throw RustInventoryTransportFailure.operation("strict_watcher_unavailable")
            }
            let pending = try record(scope, id: id, bookmark: bookmark, missing: true) { old, legacy, fd in
                if let legacy {
                    guard (legacy.capturePolicy ?? Self.legacy) == policy, (legacy.excludedPaths ?? []) == exclusions,
                          MobileFolderIgnoreRules.sameText(legacy.ignoreRules, rules) else { throw Failure.changed }
                }
                if let old {
                    if let continuity = old.rootContinuity, continuity != root.continuity { throw Failure.changed }
                    guard matches(old, policy: policy, exclusions: exclusions, rules: rules),
                          old.rootIdentity == root.identity || (["retired", "reindex"].contains(old.phase) && root.continues(identity: old.rootIdentity, continuity: old.rootContinuity, bookmark: bookmark)) else { throw Failure.changed }
                    if old.phase == "complete" { return old }
                    // An exact prepared retry can resume sealing after loss of
                    // the scan reply, but never expose its rows yet.
                    if old.generation == generation.lowercased(), old.phase == "prepared" { return old }
                    if old.phase != "retired" {
                        try client.invalidateIfPresent(scope, generation: old.generation)
                    }
                }
                let fresh = makeRecord(scope, id: id, bookmark: bookmark, policy: policy, generation: generation,
                    exclusions: exclusions, rules: rules, root: root)
                try NativeFileJournal.save(fresh, fd)
                if legacy != nil {
                    for filename in ["inventory.sqlite", "inventory.sqlite-wal", "inventory.sqlite-shm", "inventory.sqlite-journal"] {
                        _ = unlinkat(fd, filename, 0)
                    }
                }
                return fresh
            }
            if pending.phase != "running" {
                return try capture(pending, status: client.requireStatus(scope, generation: pending.generation))
            }
            let privatePaths = try internalPaths(root).flatMap { try MobileFolderReader.canonicalExclusions([$0]) }
            let all = Array(Set(exclusions + privatePaths)).sorted()
            try client.scan(scope, generation: pending.generation, mode: policy == Self.backup ? "backup" : "strict",
                root: root, exclusions: all, rules: rules, limits: resourceLimits, resourceUsage: resourceUsage,
                sourceCpuMeter: sourceCpuMeter, ignored: ignored, progress: progress)
            let status = try client.requireStatus(scope, generation: pending.generation)
            guard status.coverage == (policy == Self.backup ? "provisional" : "prepared") else { throw Failure.changed }
            try record(scope, id: id, bookmark: bookmark) { current, _, fd in
                guard var current, current == pending else { throw Failure.changed }
                current.phase = "prepared"; try NativeFileJournal.save(current, fd)
            }
            return try capture(pending, status: status)
        }
    }

    /// A native caller must finish live authorization before calling sealBackup.
    public func capture(_ scope: Scope, id: String, bookmark: Data, excludedPaths: [String] = [], ignoreRules: String? = nil,
                        preparingGeneration: String? = nil, resourceLimits: SyncResourceLimits? = nil,
                        resourceUsage: @escaping @Sendable (CommanderResourceUsage) -> Void = { _ in },
                        sourceCpuMeter: SyncSourceCpuMeter? = nil, progress: @escaping @Sendable (Int) -> Void = { _ in }) throws -> Capture {
        let policy = preparingGeneration == nil ? Self.legacy : Self.strict
        let result = try start(scope, id: id, generation: preparingGeneration ?? UUID().uuidString, bookmark: bookmark,
            excludedPaths: excludedPaths, ignoreRules: ignoreRules, policy: policy, resourceLimits: resourceLimits,
            resourceUsage: resourceUsage, sourceCpuMeter: sourceCpuMeter, ignored: { _ in }, progress: { entries, _ in progress(entries) })
        if preparingGeneration == nil {
            try seal(scope, capture: result, bookmark: bookmark, policy: policy, resourceLimits: resourceLimits)
        }
        return result
    }

    public func prepareInline(_ scope: Scope, id: String, generation: String, bookmark: Data, excludedPaths: [String] = [],
                              ignoreRules: String? = nil, resourceLimits: SyncResourceLimits? = nil,
                              resourceUsage: @escaping @Sendable (CommanderResourceUsage) -> Void = { _ in },
                              sourceCpuMeter: SyncSourceCpuMeter? = nil) throws -> Capture {
        try start(scope, id: id, generation: generation, bookmark: bookmark, excludedPaths: excludedPaths, ignoreRules: ignoreRules,
            policy: Self.legacy, resourceLimits: resourceLimits, resourceUsage: resourceUsage, sourceCpuMeter: sourceCpuMeter,
            ignored: { _ in }, progress: { _, _ in })
    }

    public func sealInline(_ scope: Scope, capture: Capture, bookmark: Data, resourceLimits: SyncResourceLimits? = nil) throws {
        try seal(scope, capture: capture, bookmark: bookmark, policy: Self.legacy, resourceLimits: resourceLimits)
    }

    public func prepareBackup(_ scope: Scope, id: String, generation: String, bookmark: Data, excludedPaths: [String] = [], ignoreRules: String? = nil,
                              resourceLimits: SyncResourceLimits? = nil, resourceUsage: @escaping @Sendable (CommanderResourceUsage) -> Void = { _ in },
                              sourceCpuMeter: SyncSourceCpuMeter? = nil, ignored: @escaping @Sendable (Int) -> Void = { _ in },
                              progress: @escaping @Sendable (Int, Int) -> Void = { _, _ in }) throws -> Capture {
        try start(scope, id: id, generation: generation, bookmark: bookmark, excludedPaths: excludedPaths, ignoreRules: ignoreRules,
            policy: Self.backup, resourceLimits: resourceLimits, resourceUsage: resourceUsage, sourceCpuMeter: sourceCpuMeter,
            ignored: ignored, progress: progress)
    }

    private func capture(_ record: Record, status: RustInventoryClient.Status) throws -> Capture {
        guard status.generation == record.generation, status.mode == ([Self.backup, Self.stream].contains(record.policy) ? "backup" : "strict") else { throw Failure.changed }
        if record.policy == Self.backup {
            return Capture(id: record.id, generation: record.generation, totalEntries: status.entryCount,
                coverage: status.gapCount == 0 ? "full" : "partial", consistency: "per-entry", totalSkipped: status.gapCount)
        }
        return Capture(id: record.id, generation: record.generation, totalEntries: status.entryCount)
    }

    private func seal(_ scope: Scope, capture: Capture, bookmark: Data, policy: String, resourceLimits: SyncResourceLimits?) throws {
        let client = try requireClient()
        try record(scope, id: capture.id, bookmark: bookmark) { current, _, fd in
            guard var current, current.generation == capture.generation, current.policy == policy,
                  ["prepared", "complete"].contains(current.phase) else { throw Failure.changed }
            try withRoot(bookmark, expected: current.rootIdentity, continuity: current.rootContinuity, path: current.rootPath) { root in
                let existing = try client.requireStatus(scope, generation: current.generation)
                guard try self.capture(current, status: existing) == capture else { throw Failure.changed }
                if current.policy == Self.backup {
                    guard existing.coverage == "provisional" else { throw Failure.changed }
                } else if existing.coverage != "sealed" {
                    try client.seal(scope, generation: current.generation, root: root, limits: resourceLimits)
                }
            }
            try Task.checkCancellation()
            current.phase = "complete"; try NativeFileJournal.save(current, fd)
        }
    }
    public func sealBackup(_ scope: Scope, capture: Capture, bookmark: Data, strict: Bool = false,
                           resourceLimits: SyncResourceLimits? = nil) throws {
        try seal(scope, capture: capture, bookmark: bookmark, policy: strict ? Self.strict : Self.backup, resourceLimits: resourceLimits)
    }

    private func retire(_ scope: Scope, id: String, generation: String, bookmark: Data, policy: String? = nil,
                        ignoreRules: String? = nil, checkRules: Bool = false) throws {
        guard FileManager.default.fileExists(atPath: try location(scope, id: id).path) else { return }
        let client = try requireClient()
        try record(scope, id: id, bookmark: bookmark) { current, legacy, fd in
            guard var current else {
                guard legacy?.capture.generation == generation else { throw Failure.changed }
                // Old rows cannot be consumed in the new store. Keep recovery
                // metadata rather than deleting an unrelated or unknown job.
                return
            }
            guard current.generation == generation, policy == nil || current.policy == policy,
                  !checkRules || MobileFolderIgnoreRules.sameText(current.ignoreRules, ignoreRules) else { throw Failure.changed }
            if current.phase == "retired" { return }
            try client.invalidateIfPresent(scope, generation: generation)
            current.phase = "retired"; try NativeFileJournal.save(current, fd)
        }
    }

    public func abandonBackup(_ scope: Scope, capture: Capture, bookmark: Data) throws {
        try retire(scope, id: capture.id, generation: capture.generation, bookmark: bookmark, policy: Self.backup)
    }
    public func abandonStrict(_ scope: Scope, id: String, generation: String, bookmark: Data) throws {
        try retire(scope, id: id, generation: generation, bookmark: bookmark, policy: Self.strict)
    }
    public func discard(_ scope: Scope, capture: Capture, bookmark: Data, ignoreRules: String? = nil) throws {
        try retire(scope, id: capture.id, generation: capture.generation, bookmark: bookmark,
            ignoreRules: try MobileFolderIgnoreRules(ignoreRules).text, checkRules: true)
    }

    public func backupStatus(_ scope: Scope, id: String, bookmark: Data, excludedPaths: [String] = [], ignoreRules: String? = nil,
                             strict: Bool = false) throws -> BackupStatus? {
        let (exclusions, rules) = try canonical(excludedPaths, ignoreRules)
        let policy = strict ? Self.strict : Self.backup
        guard FileManager.default.fileExists(atPath: try location(scope, id: id).path) else { return nil }
        let client = try requireClient()
        try MobileFolderReader.checkAccess(bookmark: bookmark)
        return try record(scope, id: id, bookmark: bookmark) { current, legacy, fd in
            guard let current else {
                guard let legacy else { return nil }
                guard legacy.capturePolicy == policy, (legacy.excludedPaths ?? []) == exclusions,
                      MobileFolderIgnoreRules.sameText(legacy.ignoreRules, rules) else { throw Failure.changed }
                return BackupStatus(capture: legacy.capture, state: "interrupted")
            }
            guard matches(current, policy: policy, exclusions: exclusions, rules: rules) else { throw Failure.changed }
            if current.phase == "reindex" { return nil }
            let remounted = try withRoot(bookmark) { root in
                if let continuity = current.rootContinuity, continuity != root.continuity { throw Failure.changed }
                guard root.identity != current.rootIdentity || (current.rootPath != nil && current.rootPath != root.path) else { return false }
                guard root.continues(identity: current.rootIdentity, continuity: current.rootContinuity, bookmark: bookmark) else { throw Failure.changed }
                return true
            }
            if remounted {
                // The exact authorized bookmark returned, on the same volume
                // and root inode/birth. Old device IDs and paths are still
                // invalid: retire its Rust snapshot before allocating another.
                try client.invalidateIfPresent(scope, generation: current.generation)
                var retired = current; retired.phase = "reindex"
                try NativeFileJournal.save(retired, fd)
                return nil
            }
            return try withRoot(bookmark, expected: current.rootIdentity, continuity: current.rootContinuity, path: current.rootPath) { _ in
                guard let status = try client.status(scope, generation: current.generation) else {
                    return BackupStatus(capture: Capture(id: current.id, generation: current.generation, totalEntries: 0), state: "interrupted")
                }
                if current.phase != "retired", status.coverage == "invalidated" {
                    var retired = current; retired.phase = "reindex"
                    try NativeFileJournal.save(retired, fd)
                    return nil
                }
                let readable = current.phase == "complete" && status.coverage == (strict ? "sealed" : "provisional")
                return BackupStatus(capture: try capture(current, status: status), state: readable ? "complete" : "interrupted",
                    ignoredCount: status.ignoredCount)
            }
        }
    }

    private func withReadableRecord<T>(_ scope: Scope, capture: Capture, bookmark: Data, ignoreRules: String?,
                                       work: (Record, RustInventoryClient) throws -> T) throws -> T {
        let client = try requireClient(), rules = try MobileFolderIgnoreRules(ignoreRules).text
        return try record(scope, id: capture.id, bookmark: bookmark) { current, _, _ in
            guard let current, current.phase == "complete", current.generation == capture.generation,
                  current.policy != Self.stream, MobileFolderIgnoreRules.sameText(current.ignoreRules, rules) else { throw Failure.changed }
            return try withRoot(bookmark, expected: current.rootIdentity, continuity: current.rootContinuity, path: current.rootPath) { _ in
                return try work(current, client)
            }
        }
    }

    private func readRecord<T>(_ scope: Scope, capture: Capture, bookmark: Data, ignoreRules: String?,
                               work: (Record, RustInventoryClient, RustInventoryClient.Status) throws -> T) throws -> T {
        try withReadableRecord(scope, capture: capture, bookmark: bookmark, ignoreRules: ignoreRules) { current, client in
            let status = try client.requireStatus(scope, generation: current.generation)
            guard status.coverage == (current.policy == Self.backup ? "provisional" : "sealed"),
                  try self.capture(current, status: status) == capture else { throw Failure.changed }
            return try work(current, client, status)
        }
    }

    public func read(_ scope: Scope, capture: Capture, bookmark: Data, offset: Int, ignoreRules: String? = nil,
                     pageSize: Int? = nil) throws -> Page {
        let limit = try Self.pageLimit(pageSize)
        guard offset >= 0, offset < capture.totalEntries || (offset == 0 && capture.totalEntries == 0) else { throw Failure.changed }
        return try withReadableRecord(scope, capture: capture, bookmark: bookmark, ignoreRules: ignoreRules) { record, client in
            let rules = try MobileFolderIgnoreRules(record.ignoreRules)
            var entries: [MobileFolderReader.Entry] = [], bytes = 16_384
            while entries.count < limit {
                let at = offset + entries.count, want = min(512, limit - entries.count)
                let (page, status) = try client.checkedPage(scope, generation: record.generation, offset: at, limit: want)
                guard status.coverage == (record.policy == Self.backup ? "provisional" : "sealed"),
                      try self.capture(record, status: status) == capture,
                      page.totalEntries == capture.totalEntries,
                      page.entries.count <= want, at + page.entries.count <= capture.totalEntries,
                      page.nextOffset == (at + page.entries.count < capture.totalEntries ? at + page.entries.count : nil),
                      !page.entries.isEmpty || capture.totalEntries == 0 else { throw Failure.changed }
                for entry in page.entries {
                    try RustInventoryClient.validate(entry, exclusions: record.exclusions, compiledRules: rules)
                    bytes += try JSONEncoder().encode(entry).count + 1
                    if bytes > Self.maximumPageBytes {
                        guard !entries.isEmpty else { throw Failure.storage }
                        return Page(capture: capture, offset: offset, entries: entries, nextOffset: offset + entries.count)
                    }
                    entries.append(entry)
                }
                if page.nextOffset == nil { break }
            }
            let next = offset + entries.count
            return Page(capture: capture, offset: offset, entries: entries, nextOffset: next < capture.totalEntries ? next : nil)
        }
    }

    public func readSkipped(_ scope: Scope, capture: Capture, bookmark: Data, offset: Int, ignoreRules: String? = nil,
                            pageSize: Int? = nil) throws -> SkippedPage {
        let limit = try Self.pageLimit(pageSize)
        guard let total = capture.totalSkipped, offset >= 0, offset < total || (offset == 0 && total == 0) else { throw Failure.invalid }
        return try readRecord(scope, capture: capture, bookmark: bookmark, ignoreRules: ignoreRules) { record, client, _ in
            guard record.policy == Self.backup else { throw Failure.changed }
            var rows: [Skipped] = [], bytes = 16_384
            while rows.count < limit {
                let at = offset + rows.count, want = min(512, limit - rows.count)
                let page = try client.gaps(scope, generation: record.generation, offset: at, limit: want)
                guard page.gapCount == total, page.gaps.count <= want, at + page.gaps.count <= total,
                      page.nextOffset == (at + page.gaps.count < total ? at + page.gaps.count : nil),
                      !page.gaps.isEmpty || total == 0 else { throw Failure.changed }
                for gap in page.gaps {
                    let row = Skipped(ordinal: offset + rows.count, gap: try gap.checked())
                    bytes += try JSONEncoder().encode(row).count + 1
                    if bytes > Self.maximumPageBytes {
                        guard !rows.isEmpty else { throw Failure.storage }
                        return SkippedPage(capture: capture, offset: offset, skipped: rows, nextOffset: offset + rows.count, totalSkipped: total)
                    }
                    rows.append(row)
                }
                if page.nextOffset == nil { break }
            }
            let next = offset + rows.count
            return SkippedPage(capture: capture, offset: offset, skipped: rows, nextOffset: next < total ? next : nil, totalSkipped: total)
        }
    }

    /// Compatibility for older native clients; the bounded whole-result
    /// envelope reads the same strict Rust generation as modern paged scans.
    public func legacyScan(_ scope: Scope, bookmark: Data, excludedPaths: [String] = [], ignoreRules: String? = nil) throws -> [MobileFolderReader.Entry] {
        let id = UUID().uuidString.lowercased()
        let capture = try capture(scope, id: id, bookmark: bookmark, excludedPaths: excludedPaths, ignoreRules: ignoreRules)
        defer { try? discard(scope, capture: capture, bookmark: bookmark, ignoreRules: ignoreRules) }
        return try readInline(scope, capture: capture, bookmark: bookmark, ignoreRules: ignoreRules)
    }

    public func readInline(_ scope: Scope, capture: Capture, bookmark: Data, ignoreRules: String? = nil) throws -> [MobileFolderReader.Entry] {
        guard capture.totalEntries <= MobileFolderReader.maximumEntries else { throw Failure.limit }
        var entries: [MobileFolderReader.Entry] = [], offset: Int? = 0, bytes = 0
        while let next = offset {
            let page = try read(scope, capture: capture, bookmark: bookmark, offset: next, ignoreRules: ignoreRules, pageSize: 512)
            for entry in page.entries {
                bytes += try JSONEncoder().encode(entry).count
                guard bytes <= 4 * 1024 * 1024 else { throw Failure.limit }
                entries.append(entry)
            }
            offset = page.nextOffset
        }
        return entries
    }

    private func emptyStream(_ record: Record, state: String) -> ChangesPage {
        ChangesPage(id: record.id, generation: record.generation, state: state, revision: 0, changes: [], nextSequence: 0,
            hasMore: false, totalEntries: 0, totalSkipped: 0)
    }

    public func beginStream(_ scope: Scope, id: String, bookmark: Data, excludedPaths: [String], ignoreRules: String?) throws -> ChangesPage {
        let client = try requireClient(), (exclusions, rules) = try canonical(excludedPaths, ignoreRules)
        let current = try withRoot(bookmark) { root in
            try record(scope, id: id, bookmark: bookmark, missing: true) { existing, legacy, fd in
                // A legacy stream’s consumed cursor cannot be spliced onto a
                // different log. The caller must allocate a fresh capture ID.
                guard legacy == nil else { throw Failure.changed }
                if var existing {
                    if let continuity = existing.rootContinuity, continuity != root.continuity { throw Failure.changed }
                    guard matches(existing, policy: Self.stream, exclusions: exclusions, rules: rules), existing.phase != "retired" else { throw Failure.changed }
                    if existing.rootIdentity != root.identity || (existing.rootPath != nil && existing.rootPath != root.path) {
                        guard root.continues(identity: existing.rootIdentity, continuity: existing.rootContinuity, bookmark: bookmark) else { throw Failure.changed }
                        throw FolderReconnectFailure.remounted
                    }
                    if existing.phase != "complete" { existing.phase = "running"; try NativeFileJournal.save(existing, fd) }
                    return existing
                }
                let fresh = makeRecord(scope, id: id, bookmark: bookmark, policy: Self.stream, generation: UUID().uuidString,
                    exclusions: exclusions, rules: rules, root: root)
                try NativeFileJournal.save(fresh, fd); return fresh
            }
        }
        if try client.status(scope, generation: current.generation) == nil { return emptyStream(current, state: "running") }
        return try streamChanges(scope, id: id, bookmark: bookmark, excludedPaths: exclusions, ignoreRules: rules, afterSequence: 0)
    }

    public func streamChanges(_ scope: Scope, id: String, bookmark: Data, excludedPaths: [String], ignoreRules: String?,
                              afterSequence: Int, pageSize: Int? = nil) throws -> ChangesPage {
        guard afterSequence >= 0, afterSequence <= 9_007_199_254_740_991 else { throw Failure.invalid }
        let limit = try Self.pageLimit(pageSize), (exclusions, rules) = try canonical(excludedPaths, ignoreRules)
        let client = try requireClient()
        return try record(scope, id: id, bookmark: bookmark) { current, _, _ in
            guard let current, current.phase != "retired", matches(current, policy: Self.stream, exclusions: exclusions, rules: rules) else { throw Failure.changed }
            return try withRoot(bookmark, expected: current.rootIdentity, continuity: current.rootContinuity, path: current.rootPath) { _ in
                guard try client.status(scope, generation: current.generation) != nil else {
                    guard afterSequence == 0, current.phase != "complete" else { throw Failure.changed }
                    return emptyStream(current, state: current.phase)
                }
                let page = try client.changes(scope, generation: current.generation, after: afterSequence, limit: min(limit, 512))
                guard page.nextSequence == afterSequence + page.changes.count, page.nextSequence <= page.revision,
                      page.hasMore == (page.nextSequence < page.revision),
                      page.changes.count <= limit else { throw Failure.storage }
                let compiledRules = try MobileFolderIgnoreRules(rules)
                for (ordinal, change) in page.changes.enumerated() {
                    guard change.sequence == afterSequence + ordinal + 1, change.revision == change.entry.version else { throw Failure.storage }
                    try RustInventoryClient.validate(change.entry, exclusions: exclusions, compiledRules: compiledRules)
                }
                // An indexed Rust snapshot is still provisional. Only the
                // host may publish completion after current live authorization.
                let state = current.phase == "complete" ? "complete" : current.phase == "interrupted" ? "interrupted" : page.state == "complete" ? "indexed" : page.state
                return ChangesPage(id: current.id, generation: current.generation, state: state, revision: page.revision,
                    changes: page.changes, nextSequence: page.nextSequence, hasMore: page.hasMore,
                    totalEntries: page.totalEntries, totalSkipped: page.totalSkipped)
            }
        }
    }

    public func finishStream(_ scope: Scope, id: String, bookmark: Data, state: String) throws {
        guard ["indexed", "complete", "interrupted"].contains(state) else { throw Failure.invalid }
        let client = try requireClient()
        try record(scope, id: id, bookmark: bookmark) { current, _, fd in
            guard var current, current.policy == Self.stream, current.phase != "retired" else { throw Failure.changed }
            if state == "complete" {
                try withRoot(bookmark, expected: current.rootIdentity, continuity: current.rootContinuity, path: current.rootPath) { _ in
                    let status = try client.requireStatus(scope, generation: current.generation)
                    guard status.coverage == "provisional" else { throw Failure.changed }
                }
            }
            if current.phase == "complete" && state == "interrupted" { return }
            current.phase = state; try NativeFileJournal.save(current, fd)
        }
    }

    public func runStream(_ scope: Scope, id: String, bookmark: Data, excludedPaths: [String], ignoreRules: String?,
                          resourceLimits: SyncResourceLimits? = nil, resourceUsage: @escaping @Sendable (CommanderResourceUsage) -> Void = { _ in },
                          sourceCpuMeter: SyncSourceCpuMeter? = nil, control: StreamControl? = nil,
                          wake: @escaping @Sendable () -> Void, authorize: @escaping @Sendable () throws -> Void = {}) throws {
        let client = try requireClient(), (exclusions, rules) = try canonical(excludedPaths, ignoreRules)
        let current = try record(scope, id: id, bookmark: bookmark) { current, _, _ in
            guard let current, matches(current, policy: Self.stream, exclusions: exclusions, rules: rules), current.phase == "running" else { throw Failure.changed }
            return current
        }
        try withRoot(bookmark, expected: current.rootIdentity, continuity: current.rootContinuity, path: current.rootPath) { root in
            try authorize()
            if try client.status(scope, generation: current.generation)?.coverage == "provisional" {
                // Rust finished before a lost completion reply or a revoked
                // host session. Reauthorization still gates publication.
                return
            }
            let privatePaths = try internalPaths(root).flatMap { try MobileFolderReader.canonicalExclusions([$0]) }
            let all = Array(Set(exclusions + privatePaths)).sorted()
            try client.scan(scope, generation: current.generation, mode: "backup", root: root, exclusions: all,
                rules: rules, limits: resourceLimits, resourceUsage: resourceUsage, sourceCpuMeter: sourceCpuMeter,
                ignored: { _ in }, progress: { _, _ in }, streaming: true, control: control,
                wake: { try authorize(); wake() })
        }
    }
}
