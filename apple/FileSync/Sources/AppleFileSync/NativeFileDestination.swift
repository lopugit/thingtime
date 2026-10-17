import Foundation
import CryptoKit
import Darwin

/// Shared picker-bound, coordinated destination access. Mutations must still
/// use descriptor-relative no-follow/beneath operations and verify receipts.
enum NativeFileDestination {
    typealias Entry = MobileFolderReader.Entry
    typealias Failure = MobileFolderStore.Failure
    static func identity(_ info: stat) -> String { "\(info.st_dev):\(info.st_ino)" }
    static func rootIdentity(bookmark: Data) throws -> String {
        var stale = false
        let url = try FolderBookmark.resolve(bookmark, stale: &stale)
        guard url.isFileURL, !stale else { throw Failure.unavailable }
        let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
        let fd = open(url.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw Failure.unavailable }; defer { close(fd) }
        return try identity(MobileFolderReader.info(fd))
    }
    static func verifyContent(_ file: Int32, source: Entry) throws {
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
    static func entry(_ info: stat, source: Entry) -> Entry {
        Entry(path: source.path, id: "\(info.st_dev):\(info.st_ino)", version: MobileFolderReader.stamp(info), kind: source.kind,
              size: source.size, sha256: source.sha256, fingerprint: source.fingerprint)
    }
    static func coordinated<T>(bookmark: Data, path: String, work: (Int32, Int32) throws -> T) throws -> T {
        let parts = try MobileFolderReader.components(path)
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
    static func openDestination(_ root: Int32, path: String) throws -> Int32? {
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
}
