import Foundation
import CryptoKit
import Darwin

/// Descriptor-relative reads within a native picker grant. No shell, symlink
/// traversal, arbitrary URL reads, overwrites or deletion authority.
public struct MobileFolderReader {
    public struct Fingerprint: Codable, Equatable, Sendable {
        public let algorithm: String
        public init(partSizeBytes: Int64, partCount: Int, sha256: String) {
            algorithm = "sha256-parts-v1"; self.partSizeBytes = partSizeBytes; self.partCount = partCount; self.sha256 = sha256
        }
        public let partSizeBytes: Int64
        public let partCount: Int
        public let sha256: String
    }
    public struct Entry: Codable, Equatable, Sendable {
        public init(path: String, id: String, version: String, kind: String, size: Int64, sha256: String?, fingerprint: Fingerprint?) { self.path = path; self.id = id; self.version = version; self.kind = kind; self.size = size; self.sha256 = sha256; self.fingerprint = fingerprint }

        public let path: String
        public let id: String
        public let version: String
        public let kind: String
        public let size: Int64
        public let sha256: String?
        public let fingerprint: Fingerprint?
        enum CodingKeys: String, CodingKey { case path, id, version, kind, size, sha256, fingerprint }
        public func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(path, forKey: .path); try c.encode(id, forKey: .id); try c.encode(version, forKey: .version)
            try c.encode(kind, forKey: .kind); try c.encode(size, forKey: .size)
            if let sha256 { try c.encode(sha256, forKey: .sha256) } else { try c.encodeNil(forKey: .sha256) }
            try c.encodeIfPresent(fingerprint, forKey: .fingerprint)
        }
    }
    public struct Chunk: Encodable, Sendable {
        public init(version: String, size: Int64, offset: Int64, data: String) { self.version = version; self.size = size; self.offset = offset; self.data = data }
        public let version: String; public let size: Int64; public let offset: Int64; public let data: String
    }
    public typealias Failure = MobileFolderStore.Failure
    /// A bounded diagnostic containing only a validated, grant-relative path.
    public struct ScanFailure: Error, Encodable, Equatable, Sendable {
        public enum Reason: String, Codable, Sendable {
            case symlink, special, unreadable, changed, fifo, socket, device
            case invalidPath = "invalid-path"
            case duplicateIdentity = "duplicate-identity"
            case pathCollision = "path-collision"
        }
        public let reason: Reason
        public let path: String?
        init(reason: Reason, path: String?) {
            if let path, (try? MobileFolderReader.components(path)) != nil {
                self.reason = reason; self.path = path
            } else { self.reason = .invalidPath; self.path = nil }
        }
        enum CodingKeys: String, CodingKey { case reason, path }
        public func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(reason, forKey: .reason)
            if let path { try c.encode(path, forKey: .path) } else { try c.encodeNil(forKey: .path) }
        }
    }
    private static func scanAt<T>(_ path: String, work: () throws -> T) throws -> T {
        do { return try work() }
        catch Failure.changed { throw ScanFailure(reason: .changed, path: path) }
        catch Failure.unavailable { throw ScanFailure(reason: .unreadable, path: path) }
        catch Failure.invalid { throw ScanFailure(reason: .invalidPath, path: nil) }
    }
    private static func scanOpen(_ parent: Int32, name: String, path: String, backup: Bool = false) throws -> Int32 {
        var before = stat()
        guard fstatat(parent, name, &before, AT_SYMLINK_NOFOLLOW) == 0 else {
            throw ScanFailure(reason: errno == ENOENT ? .changed : .unreadable, path: path)
        }
        let type = before.st_mode & S_IFMT
        guard type != S_IFLNK else { throw ScanFailure(reason: .symlink, path: path) }
        guard type == S_IFREG || type == S_IFDIR else {
            let reason: ScanFailure.Reason = backup ? (type == S_IFIFO ? .fifo : type == S_IFSOCK ? .socket : type == S_IFCHR || type == S_IFBLK ? .device : .special) : .special
            throw ScanFailure(reason: reason, path: path)
        }
        let fd = openat(parent, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        guard fd >= 0 else { throw ScanFailure(reason: errno == ENOENT || errno == ELOOP ? .changed : .unreadable, path: path) }
        do {
            guard try stamp(info(fd)) == stamp(before) else { throw ScanFailure(reason: .changed, path: path) }
            return fd
        } catch { close(fd); throw error }
    }
    public static let maximumEntries = 10_000
    public static let maximumReadBytes = 65_536
    static func components(_ path: String) throws -> [String] {
        guard !path.isEmpty, path.utf16.count <= 4096, !path.contains("\\"),
              !path.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) || $0.properties.generalCategory == .format }) else { throw Failure.invalid }
        let parts = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        guard parts.count <= 128, parts.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." && $0.utf16.count <= 255 }) else { throw Failure.invalid }
        return parts
    }
    /// Same exact-path/descendant and NFC/lowercase contract as syncPathKey.
    /// Validate before accessing the grant; globs have no special meaning.
    public static func canonicalExclusions(_ paths: [String]) throws -> [String] {
        guard paths.count <= 100, paths.reduce(0, { $0 + $1.utf8.count }) <= 16_384 else { throw Failure.invalid }
        let keys = try paths.map { path -> String in
            _ = try components(path)
            return path.precomposedStringWithCanonicalMapping.lowercased()
        }
        guard Set(keys).count == keys.count else { throw Failure.invalid }
        return keys.sorted()
    }
    private static func excluded(_ path: String, keys: [String]) -> Bool {
        let key = path.precomposedStringWithCanonicalMapping.lowercased()
        return keys.contains { key == $0 || key.hasPrefix($0 + "/") }
    }
    private static func ignored(_ parent: Int32, name: String, path: String, rules: MobileFolderIgnoreRules) -> Bool {
        guard rules.text != nil else { return false }
        var attributes = stat()
        // Only metadata on this directory entry: never follow a link to decide
        // whether a directory-only rule applies. Failed metadata stays visible
        // to the ordinary scan diagnostics instead of becoming an ignore.
        guard fstatat(parent, name, &attributes, AT_SYMLINK_NOFOLLOW) == 0 else { return false }
        return rules.ignoresEntry(path, isDirectory: attributes.st_mode & S_IFMT == S_IFDIR)
    }
    static func info(_ fd: Int32) throws -> stat {
        var result = stat(); guard fstat(fd, &result) == 0 else { throw Failure.unavailable }; return result
    }
    static func stamp(_ s: stat) -> String {
        "\(s.st_dev):\(s.st_ino):\(s.st_size):\(s.st_mtimespec.tv_sec):\(s.st_mtimespec.tv_nsec):\(s.st_ctimespec.tv_sec):\(s.st_ctimespec.tv_nsec)"
    }
    static func openPath(_ root: Int32, path: String, directory: Bool = false) throws -> Int32 {
        let parts = try components(path); var fd = dup(root); guard fd >= 0 else { throw Failure.unavailable }
        for (i, name) in parts.enumerated() {
            let next = openat(fd, name, O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK | ((i < parts.count - 1 || directory) ? O_DIRECTORY : 0))
            close(fd); guard next >= 0 else { throw Failure.unavailable }; fd = next
        }
        return fd
    }
    static func visitNames(_ fd: Int32, invalidName: () throws -> Void = { throw Failure.invalid }, visit: (String) throws -> Void) throws {
        let next = openat(fd, ".", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard next >= 0 else { throw Failure.unavailable }
        guard let directory = fdopendir(next) else { close(next); throw Failure.unavailable }; defer { closedir(directory) }
        while true {
            try Task.checkCancellation(); errno = 0
            guard let ent = readdir(directory) else { if errno != 0 { throw Failure.unavailable }; break }
            guard let name = withUnsafePointer(to: &ent.pointee.d_name, { p in
                p.withMemoryRebound(to: CChar.self, capacity: Int(ent.pointee.d_namlen) + 1) { String(validatingCString: $0) }
            }) else {
                try invalidName(); continue
            }
            if name == "." || name == ".." { continue }
            try visit(name)
        }
    }
    static func names(_ fd: Int32, including: (String) -> Bool = { _ in true }) throws -> [String] {
        var result: [String] = []
        try visitNames(fd) { name in
            guard including(name) else { return }
            result.append(name); guard result.count <= maximumEntries else { throw Failure.limit }
        }
        return result.sorted { $0.utf8.lexicographicallyPrecedes($1.utf8) }
    }
    static func fingerprint(_ fd: Int32, size: Int64) throws -> Fingerprint? {
        if size == 0 { return nil }
        let mib: Int64 = 1_048_576, partSize = ((max(8 * mib, (size + 9_999) / 10_000) + mib - 1) / mib) * mib
        guard partSize <= 5 * 1024 * mib else { throw Failure.limit }
        var composite = SHA256(), part = SHA256(), offset: Int64 = 0, inPart: Int64 = 0
        var buffer = [UInt8](repeating: 0, count: maximumReadBytes)
        while offset < size {
            try Task.checkCancellation()
            let wanted = Int(min(Int64(buffer.count), size - offset, partSize - inPart))
            let n = pread(fd, &buffer, wanted, off_t(offset))
            guard n > 0 else { throw Failure.changed }
            part.update(data: Data(buffer.prefix(n))); offset += Int64(n); inPart += Int64(n)
            if inPart == partSize || offset == size { composite.update(data: Data(part.finalize())); part = SHA256(); inPart = 0 }
        }
        return Fingerprint(partSizeBytes: partSize, partCount: Int((size + partSize - 1) / partSize), sha256: hex(composite.finalize()))
    }
    private static func hex(_ hash: SHA256.Digest) -> String { hash.map { String(format: "%02x", $0) }.joined() }
    static func access<T>(_ bookmark: Data, work: (Int32) throws -> T) throws -> T {
        var stale = false
        let url = try FolderBookmark.resolve(bookmark, stale: &stale)
        guard url.isFileURL, !stale else { throw Failure.unavailable }
        let scoped = url.startAccessingSecurityScopedResource(); defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        var result: Result<T, Error>?, error: NSError?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &error) { coordinated in
            result = Result {
                try Task.checkCancellation()
                let fd = Darwin.open(coordinated.path, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW)
                guard fd >= 0 else { throw Failure.unavailable }; defer { close(fd) }
                return try work(fd)
            }
        }
        if let error { throw error }; guard let result else { throw Failure.unavailable }; return try result.get()
    }
    public static func checkAccess(bookmark: Data) throws { try access(bookmark) { _ in try Task.checkCancellation() } }
    private static func entry(_ fd: Int32, path: String) throws -> Entry {
        let before = try info(fd), type = before.st_mode & S_IFMT
        guard type == S_IFDIR || type == S_IFREG else { throw Failure.invalid }
        guard before.st_size >= 0, before.st_size <= 9_007_199_254_740_991 else { throw Failure.limit }
        let digest = type == S_IFREG ? try fingerprint(fd, size: before.st_size) : nil
        guard try stamp(info(fd)) == stamp(before) else { throw Failure.changed }
        return Entry(path: path, id: "\(before.st_dev):\(before.st_ino)", version: stamp(before), kind: type == S_IFDIR ? "folder" : "file",
            size: type == S_IFDIR ? 0 : before.st_size, sha256: type == S_IFREG && before.st_size == 0 ? hex(SHA256.hash(data: Data())) : nil, fingerprint: digest)
    }
    /// Observe one exact relative path without hashing unrelated files or retaining
    /// a directory listing. Absence is distinct from permission/provider errors.
    /// Both traversals must resolve the same ancestors and the same final object.
    public static func inspect(bookmark: Data, path: String) throws -> Entry? {
        try inspectEntry(bookmark: bookmark, path: path, directoryOnly: false)
    }
    /// Metadata-only directory inspection: a file replacement must never enter
    /// the regular-file fingerprint path, including between the two resolves.
    public static func inspectFolder(bookmark: Data, path: String) throws -> Entry? {
        try inspectEntry(bookmark: bookmark, path: path, directoryOnly: true)
    }
    private static func inspectEntry(bookmark: Data, path: String, directoryOnly: Bool) throws -> Entry? {
        let parts = try components(path)
        return try access(bookmark) { root in
            func resolve() throws -> (fd: Int32?, ancestors: [String]) {
                var fd = dup(root), ancestors: [String] = []
                guard fd >= 0 else { throw Failure.unavailable }
                do {
                    for (index, name) in parts.enumerated() {
                        try Task.checkCancellation()
                        let before = try stamp(info(fd)); var found = false
                        let key = name.precomposedStringWithCanonicalMapping.lowercased()
                        try visitNames(fd) { candidate in
                            if candidate.precomposedStringWithCanonicalMapping.lowercased() == key {
                                guard candidate.utf8.elementsEqual(name.utf8), !found else { throw Failure.changed }
                                found = true
                            }
                        }
                        guard try stamp(info(fd)) == before else { throw Failure.changed }
                        ancestors.append(before)
                        if !found { close(fd); return (nil, ancestors) }
                        let next = openat(fd, name, O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK | (index < parts.count - 1 || directoryOnly ? O_DIRECTORY : 0))
                        guard next >= 0 else { throw Failure.unavailable }
                        close(fd); fd = next
                    }
                    return (fd, ancestors)
                } catch { close(fd); throw error }
            }
            let first = try resolve(); defer { if let fd = first.fd { close(fd) } }
            let value = try first.fd.map { try entry($0, path: path) }
            let second = try resolve(); defer { if let fd = second.fd { close(fd) } }
            guard first.ancestors == second.ancestors else { throw Failure.changed }
            if let value, let original = first.fd, let current = second.fd {
                guard try stamp(info(original)) == value.version, try stamp(info(current)) == value.version else { throw Failure.changed }
            } else if first.fd != nil || second.fd != nil { throw Failure.changed }
            try Task.checkCancellation()
            return value
        }
    }
    public static func scan(bookmark: Data, excludedPaths: [String] = [], ignoreRules: String? = nil) throws -> [Entry] {
        let exclusions = try canonicalExclusions(excludedPaths), rules = try MobileFolderIgnoreRules(ignoreRules)
        return try access(bookmark) { root in
            let initial = try stamp(info(root)); var entries: [Entry] = [], aliases = Set<String>(), identities = Set<String>(), byteBudget = 0
            func walk(_ parent: Int32, prefix: String) throws {
                let initialDirectory = try stamp(info(parent))
                for name in try names(parent, including: { name in
                    let path = prefix.isEmpty ? name : "\(prefix)/\(name)"
                    return !excluded(path, keys: exclusions) && !ignored(parent, name: name, path: path, rules: rules)
                }) {
                    try Task.checkCancellation(); let path = prefix.isEmpty ? name : "\(prefix)/\(name)"; _ = try scanAt(path) { try components(path) }
                    guard aliases.insert(path.precomposedStringWithCanonicalMapping.lowercased()).inserted else { throw ScanFailure(reason: .pathCollision, path: path) }
                    guard entries.count < maximumEntries else { throw Failure.limit }
                    let fd = try scanOpen(parent, name: name, path: path); defer { close(fd) }
                    let entry = try scanAt(path) { try Self.entry(fd, path: path) }
                    guard identities.insert(entry.id).inserted else { throw ScanFailure(reason: .duplicateIdentity, path: path) }
                    byteBudget += try JSONEncoder().encode(entry).count
                    guard byteBudget <= 4 * 1024 * 1024 else { throw Failure.limit }; entries.append(entry)
                    if entry.kind == "folder" { try scanAt(path) { try walk(fd, prefix: path) } }
                }
                guard try stamp(info(parent)) == initialDirectory else { throw Failure.changed }
            }
            try walk(root, prefix: "")
            // Recheck observed identities after traversal. A failure never becomes
            // an empty/complete scan. Executors still recheck each mutation stamp.
            for entry in entries {
                try Task.checkCancellation()
                try scanAt(entry.path) {
                    let fd = try openPath(root, path: entry.path); defer { close(fd) }
                    guard try stamp(info(fd)) == entry.version else { throw Failure.changed }
                }
            }
            guard try stamp(info(root)) == initial else { throw Failure.changed }; return entries
        }
    }

    /// The sink owns uniqueness checks and bounded, disk-backed retention. No
    /// provisional rows become a complete capture until the second pass succeeds.
    static func capture(bookmark: Data, excludedPaths: [String] = [], ignoreRules: String? = nil, append: (Entry) throws -> Void,
                        replay: ((Entry) throws -> Void) throws -> Void) throws {
        let exclusions = try canonicalExclusions(excludedPaths), rules = try MobileFolderIgnoreRules(ignoreRules)
        try access(bookmark) { root in
            let initial = try stamp(info(root))
            func walk(_ parent: Int32, prefix: String) throws {
                let before = try stamp(info(parent))
                try visitNames(parent) { name in
                    let path = prefix.isEmpty ? name : "\(prefix)/\(name)"
                    guard !excluded(path, keys: exclusions), !ignored(parent, name: name, path: path, rules: rules) else { return }
                    _ = try scanAt(path) { try components(path) }
                    let fd = try scanOpen(parent, name: name, path: path); defer { close(fd) }
                    let row = try scanAt(path) { try entry(fd, path: path) }
                    try append(row)
                    if row.kind == "folder" { try scanAt(path) { try walk(fd, prefix: path) } }
                }
                guard try stamp(info(parent)) == before else { throw Failure.changed }
            }
            try walk(root, prefix: "")
            try replay { row in
                try Task.checkCancellation()
                try scanAt(row.path) {
                    let fd = try openPath(root, path: row.path); defer { close(fd) }
                    guard try stamp(info(fd)) == row.version else { throw Failure.changed }
                }
            }
            guard try stamp(info(root)) == initial else { throw Failure.changed }
        }
    }
    public struct BackupGap: Codable, Equatable, Sendable {
        public enum Scope: String, Codable, Sendable { case entry, subtree, root }
        public let path: String?
        public let reason: ScanFailure.Reason
        public let scope: Scope
        init(path: String?, reason: ScanFailure.Reason, scope: Scope) {
            if scope == .root && path == nil && (reason == .changed || reason == .unreadable) {
                self.path = nil; self.reason = reason; self.scope = .root
            } else if scope != .root, let path, (try? MobileFolderReader.components(path)) != nil {
                self.path = path; self.reason = reason; self.scope = scope
            } else { self.path = nil; self.reason = .invalidPath; self.scope = .subtree }
        }
        enum CodingKeys: String, CodingKey { case path, reason, scope }
        public func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            if let path { try c.encode(path, forKey: .path) } else { try c.encodeNil(forKey: .path) }
            try c.encode(reason, forKey: .reason); try c.encode(scope, forKey: .scope)
        }
    }

    /// Backup observations describe independently checked entries, never a
    /// snapshot or deletion authority. The sink keeps collision checks on disk.
    static func captureBackup(bookmark: Data, excludedPaths: [String] = [], ignoreRules: String? = nil,
                              ignored: () throws -> Void = {}, append: (Entry) throws -> Bool, skip: (BackupGap) throws -> Void) throws {
        let exclusions = try canonicalExclusions(excludedPaths), rules = try MobileFolderIgnoreRules(ignoreRules)
        try access(bookmark) { root in
            func gap(_ prefix: String, _ reason: ScanFailure.Reason) throws {
                try skip(BackupGap(path: prefix.isEmpty ? nil : prefix, reason: reason, scope: prefix.isEmpty ? .root : .subtree))
            }
            func walk(_ parent: Int32, prefix: String) throws {
                let before = try stamp(info(parent))
                do {
                    try visitNames(parent, invalidName: {
                        try skip(BackupGap(path: nil, reason: .invalidPath, scope: .subtree))
                    }) { name in
                        try Task.checkCancellation()
                        let path = prefix.isEmpty ? name : "\(prefix)/\(name)"
                        guard !excluded(path, keys: exclusions) else { return }
                        if Self.ignored(parent, name: name, path: path, rules: rules) { try ignored(); return }
                        do {
                            _ = try scanAt(path) { try components(path) }
                            let fd = try scanOpen(parent, name: name, path: path, backup: true); defer { close(fd) }
                            let row = try scanAt(path) { try entry(fd, path: path) }
                            // An open descriptor may have been renamed out of this
                            // grant. Re-resolve the current grant-relative name.
                            try scanAt(path) {
                                let current = try openPath(root, path: path); defer { close(current) }
                                guard try stamp(info(current)) == row.version else { throw Failure.changed }
                            }
                            guard try append(row) else { return }
                            if row.kind == "folder" {
                                do { try walk(fd, prefix: path) }
                                catch Failure.unavailable { try gap(path, .unreadable) }
                                catch Failure.changed { try gap(path, .changed) }
                            }
                        } catch let failure as ScanFailure {
                            try skip(BackupGap(path: failure.path, reason: failure.reason, scope: failure.reason == .unreadable || failure.reason == .changed ? .subtree : .entry))
                        }
                    }
                } catch Failure.unavailable { try gap(prefix, .unreadable) }
                if try stamp(info(parent)) != before { try gap(prefix, .changed) }
            }
            try walk(root, prefix: "")
            try Task.checkCancellation()
        }
    }

    /// One pinned, coordinated range; the sink applies backpressure. Bytes remain
    /// provisional until this call and the host's final identity checks succeed.
    /// No path, descriptor or bookmark is exposed to the consumer.
    public static let maximumStreamBytes = 32 * 1024 * 1024
    public static func stream(bookmark: Data, path: String, version: String, offset: Int64, length: Int,
                              receive: (Data) throws -> Void) throws -> Int64 {
        guard offset >= 0, length > 0, length <= maximumStreamBytes else { throw Failure.invalid }
        return try access(bookmark) { root in
            let fd = try openPath(root, path: path); defer { close(fd) }
            let before = try info(fd)
            guard before.st_mode & S_IFMT == S_IFREG, stamp(before) == version,
                  offset <= before.st_size, Int64(length) <= before.st_size - offset else { throw Failure.changed }
            var buffer = [UInt8](repeating: 0, count: maximumReadBytes), sent = 0
            while sent < length {
                try Task.checkCancellation()
                guard try stamp(info(fd)) == version else { throw Failure.changed }
                let wanted = min(buffer.count, length - sent)
                let n = pread(fd, &buffer, wanted, off_t(offset) + off_t(sent))
                guard n > 0 else { throw Failure.changed }
                try receive(Data(buffer.prefix(n))); sent += n
            }
            try Task.checkCancellation()
            let current = try openPath(root, path: path); defer { close(current) }
            guard try stamp(info(fd)) == version, try stamp(info(current)) == version else { throw Failure.changed }
            return before.st_size
        }
    }
    public static func read(bookmark: Data, path: String, version: String, offset: Int64, length: Int) throws -> Chunk {
        guard offset >= 0, length > 0, length <= maximumReadBytes else { throw Failure.invalid }
        return try access(bookmark) { root in
            let fd = try openPath(root, path: path); defer { close(fd) }
            let before = try info(fd)
            guard before.st_mode & S_IFMT == S_IFREG, stamp(before) == version, offset <= before.st_size else { throw Failure.changed }
            var bytes = [UInt8](repeating: 0, count: Int(min(Int64(length), before.st_size - offset))), count = 0
            while count < bytes.count {
                try Task.checkCancellation()
                let remaining = bytes.count - count
                let n = bytes.withUnsafeMutableBytes { pread(fd, $0.baseAddress!.advanced(by: count), remaining, off_t(offset) + off_t(count)) }
                guard n > 0 else { throw Failure.changed }; count += n
            }
            let current = try openPath(root, path: path); defer { close(current) }
            guard try stamp(info(fd)) == version, try stamp(info(current)) == version else { throw Failure.changed }
            return Chunk(version: version, size: before.st_size, offset: offset, data: Data(bytes).base64EncodedString())
        }
    }
}
