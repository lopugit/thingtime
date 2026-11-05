import Foundation
import CryptoKit
import Darwin

/// A link is an inode and opaque target bytes, never permission to resolve it.
public struct NativeSymbolicLink: Codable, Equatable, Sendable {
    public let format: String
    public let targetBase64: String
    public init(target: Data) throws {
        guard !target.isEmpty, !target.contains(0) else { throw MobileFolderStore.Failure.invalid }
        format = "posix-symlink-v1"; targetBase64 = target.base64EncodedString()
    }
    public func target() throws -> Data {
        guard format == "posix-symlink-v1", let bytes = Data(base64Encoded: targetBase64),
              bytes.base64EncodedString() == targetBase64, !bytes.isEmpty, !bytes.contains(0) else { throw MobileFolderStore.Failure.invalid }
        return bytes
    }
}

enum NativeSymbolicLinks {
    typealias Failure = MobileFolderStore.Failure
    private struct Registration: Codable { let identity: String; let birth: String; let hash: String; let symbolicLink: NativeSymbolicLink?; let journal: Bool }
    private struct Envelope: Encodable {
        let format = "thingtime-symbolic-link-fallback-v1"
        let originalKind = "symbolic-link"
        let tags = ["former-symbolic-link"]
        let symbolicLink: NativeSymbolicLink
    }
    // The portable envelope is self describing. Only this private, inode-bound
    // receipt authorizes interpreting it during an ordinary scan. A copied or
    // user-authored envelope stays an ordinary file until an explicit restore.
    @TaskLocal static var receiptDirectory: URL?
    static var registry: URL {
        if let receiptDirectory { return receiptDirectory }
        return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ThingtimeNativeLinkReceipts-v1", isDirectory: true)
    }
    static func hash(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
    static func identity(_ s: stat) -> String { "\(s.st_dev):\(s.st_ino)" }
    private static func birth(_ s: stat) -> String { "\(s.st_birthtimespec.tv_sec):\(s.st_birthtimespec.tv_nsec)" }
    private static func url(_ s: stat) -> URL { registry.appendingPathComponent(hash(Data(identity(s).utf8))) }
    static func register(_ fd: Int32, link: NativeSymbolicLink?, bytes: Data = Data(), journal: Bool = false) throws {
        let info = try MobileFolderReader.info(fd), location = url(info)
        var proof = bytes
        if journal {
            let marker = ".thingtime-owned-journal"
            let current = openat(fd, marker, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
            if current >= 0 {
                defer { close(current) }
                guard let previous = registration(info), previous.journal,
                      let existing = try markerBytes(current), hash(existing) == previous.hash else { throw Failure.changed }
                proof = existing
            } else {
                guard errno == ENOENT else { throw Failure.storage }
                proof = Data((UUID().uuidString + UUID().uuidString).utf8)
                let created = openat(fd, marker, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
                guard created >= 0 else { throw Failure.storage }; defer { close(created) }
                let n = proof.withUnsafeBytes { write(created, $0.baseAddress!, $0.count) }
                guard n == proof.count, fsync(created) == 0, fsync(fd) == 0 else { throw Failure.storage }
            }
        }
        try NativeFileJournal.locked(directory: location) { record in
            let attributes = try MobileFolderReader.info(record)
            guard attributes.st_uid == geteuid(), attributes.st_mode & 0o077 == 0 else { throw Failure.storage }
            try NativeFileJournal.save(Registration(identity: identity(info), birth: birth(info), hash: hash(proof), symbolicLink: link, journal: journal), record)
        }
    }
    private static func registration(_ s: stat) -> Registration? {
        let root = open(registry.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard root >= 0 else { return nil }; defer { close(root) }
        let record = openat(root, hash(Data(identity(s).utf8)), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard record >= 0 else { return nil }; defer { close(record) }
        guard let info = try? MobileFolderReader.info(record), info.st_uid == geteuid(), info.st_mode & 0o077 == 0,
              let row = try? NativeFileJournal.read(record, as: Registration.self), row.identity == identity(s), row.birth == birth(s) else { return nil }
        return row
    }
    private static func markerBytes(_ fd: Int32) throws -> Data? {
        let info = try MobileFolderReader.info(fd)
        guard info.st_mode & S_IFMT == S_IFREG, info.st_nlink == 1, info.st_size == 72 else { return nil }
        var bytes = Data(count: 72)
        let n = bytes.withUnsafeMutableBytes { pread(fd, $0.baseAddress!, $0.count, 0) }
        guard n == bytes.count else { return nil }; return bytes
    }
    static func isOwnedJournal(_ parent: Int32, name: String) -> Bool {
        var s = stat()
        guard fstatat(parent, name, &s, AT_SYMLINK_NOFOLLOW) == 0, s.st_mode & S_IFMT == S_IFDIR,
              let row = registration(s), row.journal else { return false }
        let directory = openat(parent, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard directory >= 0 else { return false }; defer { close(directory) }
        guard let actual = try? MobileFolderReader.info(directory), identity(actual) == identity(s), birth(actual) == birth(s) else { return false }
        let marker = openat(directory, ".thingtime-owned-journal", O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        guard marker >= 0 else { return false }; defer { close(marker) }
        guard let bytes = try? markerBytes(marker), hash(bytes) == row.hash else { return false }
        return true
    }
    static func isWithinOwnedJournal(_ root: Int32, path: String) throws -> Bool {
        let parts = try MobileFolderReader.components(path)
        var parent = dup(root); guard parent >= 0 else { throw Failure.unavailable }; defer { close(parent) }
        for (index, name) in parts.enumerated() {
            if isOwnedJournal(parent, name: name) { return true }
            if index < parts.count - 1 {
                let next = openat(parent, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                guard next >= 0 else { if errno == ENOENT { return false }; throw Failure.unavailable }; close(parent); parent = next
            }
        }
        return false
    }
    static func bytes(_ fd: Int32) throws -> Data? {
        let s = try MobileFolderReader.info(fd)
        if s.st_mode & S_IFMT == S_IFLNK {
            var capacity = max(256, Int(s.st_size) + 1)
            while true {
                var bytes = [UInt8](repeating: 0, count: capacity)
                let n = bytes.withUnsafeMutableBytes { freadlink(fd, $0.baseAddress!.assumingMemoryBound(to: CChar.self), capacity) }
                guard n >= 0 else { throw Failure.unavailable }
                if n < capacity {
                    let target = Data(bytes.prefix(n)); _ = try NativeSymbolicLink(target: target)
                    guard try MobileFolderReader.stamp(MobileFolderReader.info(fd)) == MobileFolderReader.stamp(s) else { throw Failure.changed }
                    return target
                }
                let next = capacity.multipliedReportingOverflow(by: 2)
                guard !next.overflow else { throw Failure.limit }; capacity = next.partialValue
            }
        }
        guard s.st_mode & S_IFMT == S_IFREG, let row = registration(s), let link = row.symbolicLink else { return nil }
        let envelope = try JSONEncoder().encode(Envelope(symbolicLink: link))
        guard s.st_size == envelope.count else { return nil }
        var bytes = Data(count: envelope.count)
        let count = bytes.withUnsafeMutableBytes { pread(fd, $0.baseAddress!, $0.count, 0) }
        guard count == bytes.count, hash(bytes) == row.hash,
              try MobileFolderReader.stamp(MobileFolderReader.info(fd)) == MobileFolderReader.stamp(s) else { return nil }
        return try link.target()
    }
    /// No-follow metadata chooses the special O_SYMLINK descriptor mode. It
    /// pins the link itself; combining that mode with O_NOFOLLOW yields ELOOP.
    static func openEntry(_ parent: Int32, name: String, absent: Bool = false) throws -> Int32? {
        var before = stat()
        guard fstatat(parent, name, &before, AT_SYMLINK_NOFOLLOW) == 0 else {
            if absent && errno == ENOENT { return nil }; throw Failure.unavailable
        }
        let type = before.st_mode & S_IFMT
        guard type == S_IFREG || type == S_IFDIR || type == S_IFLNK else { throw Failure.invalid }
        let flags = O_RDONLY | O_CLOEXEC | O_NONBLOCK | (type == S_IFLNK ? O_SYMLINK : O_NOFOLLOW)
        let fd = openat(parent, name, flags)
        guard fd >= 0 else { throw Failure.unavailable }
        guard try MobileFolderReader.stamp(MobileFolderReader.info(fd)) == MobileFolderReader.stamp(before) else { close(fd); throw Failure.changed }
        return fd
    }
    static func fingerprint(_ bytes: Data) -> MobileFolderReader.Fingerprint {
        MobileFolderReader.Fingerprint(partSizeBytes: 8_388_608, partCount: 1, sha256: hash(Data(SHA256.hash(data: bytes))))
    }
    /// Some filesystem drivers accept RENAME_SWAP but perform replacement.
    /// Establish semantics using only two owned throwaway inodes, before any
    /// user inode can enter that operation.
    static func supportsExchange(_ directory: Int32) throws -> Bool {
        let prefix = "exchange-probe-" + UUID().uuidString
        let a = prefix + "-a", b = prefix + "-b"
        let first = openat(directory, a, O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard first >= 0 else { throw Failure.storage }; defer { close(first) }
        let second = openat(directory, b, O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard second >= 0 else { unlinkat(directory, a, 0); throw Failure.storage }; defer { close(second) }
        let one = try MobileFolderReader.info(first), two = try MobileFolderReader.info(second)
        defer {
            for name in [a, b] {
                var info = stat()
                if fstatat(directory, name, &info, AT_SYMLINK_NOFOLLOW) == 0,
                   identity(info) == identity(one) || identity(info) == identity(two) { unlinkat(directory, name, 0) }
            }
        }
        do { try NativeFileDestination.rename(directory, a, directory, b, flags: UInt32(RENAME_SWAP)) }
        catch { guard errno == ENOTSUP || errno == EOPNOTSUPP || errno == ENOSYS else { throw error }; return false }
        var afterA = stat(), afterB = stat()
        return fstatat(directory, a, &afterA, AT_SYMLINK_NOFOLLOW) == 0 && fstatat(directory, b, &afterB, AT_SYMLINK_NOFOLLOW) == 0 &&
            identity(afterA) == identity(two) && identity(afterB) == identity(one)
    }
    /// Probe the destination filesystem itself. Permissions, quota, full disks
    /// and name collisions never turn into a successful fallback.
    static func create(_ parent: Int32, name: String, link: NativeSymbolicLink, forceUnsupported: Bool = false,
                       syscall: (UnsafePointer<CChar>, Int32, String) -> Int32 = { symlinkat($0, $1, $2) }) throws {
        let bytes = try link.target(), target = [UInt8](bytes) + [0]
        let result = forceUnsupported ? -1 : target.withUnsafeBytes { syscall($0.baseAddress!.assumingMemoryBound(to: CChar.self), parent, name) }
        if result == 0 { return }
        let code = forceUnsupported ? ENOTSUP : errno
        var unsupportedEncoding = false
        if code == EINVAL, String(data: bytes, encoding: .utf8) == nil {
            // Apple's FAT drivers accept links but reject raw non-UTF8 targets
            // with EINVAL. Classify only this measured, filesystem-scoped case.
            var filesystem = statfs()
            guard fstatfs(parent, &filesystem) == 0 else { throw Failure.unavailable }
            let type = withUnsafePointer(to: &filesystem.f_fstypename) { pointer in
                pointer.withMemoryRebound(to: CChar.self, capacity: 16) { String(cString: $0) }
            }
            unsupportedEncoding = type == "msdos" || type == "exfat"
        }
        guard code == ENOTSUP || code == EOPNOTSUPP || code == ENOSYS || unsupportedEncoding else { throw Failure.storage }
        let envelope = try JSONEncoder().encode(Envelope(symbolicLink: link))
        let fd = openat(parent, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw Failure.storage }; defer { close(fd) }
        var offset = 0
        while offset < envelope.count {
            let n = envelope.withUnsafeBytes { pwrite(fd, $0.baseAddress!.advanced(by: offset), $0.count - offset, off_t(offset)) }
            guard n > 0 else { throw Failure.storage }; offset += n
        }
        guard fsync(fd) == 0 else { throw Failure.storage }
        try register(fd, link: link, bytes: envelope)
    }
}

