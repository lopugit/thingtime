import Foundation
import Darwin

/// Shared durable operation journal for bounded native file adapters. This is
/// recovery state, not a second file-history database or a permission grant.
enum NativeFileJournal {
    typealias Failure = MobileFolderStore.Failure

    static func locked<T>(directory: URL, work: (Int32) throws -> T) throws -> T {
        try Task.checkCancellation()
        var attributes: [FileAttributeKey: Any] = [.posixPermissions: 0o700]
        #if os(iOS)
        attributes[.protectionKey] = FileProtectionType.completeUntilFirstUserAuthentication
        #endif
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: attributes)
        var location = directory, values = URLResourceValues()
        values.isExcludedFromBackup = true
        try location.setResourceValues(values)
        let fd = open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw Failure.storage }; defer { close(fd) }
        let lock = openat(fd, "lock", O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK, 0o600)
        guard lock >= 0 else { throw Failure.storage }; defer { close(lock) }
        let info = try MobileFolderReader.info(lock)
        guard info.st_mode & S_IFMT == S_IFREG, info.st_nlink == 1 else { throw Failure.storage }
        while flock(lock, LOCK_EX | LOCK_NB) != 0 {
            guard errno == EWOULDBLOCK else { throw Failure.storage }
            try Task.checkCancellation(); Thread.sleep(forTimeInterval: 0.01)
        }
        defer { flock(lock, LOCK_UN) }
        try Task.checkCancellation()
        return try work(fd)
    }

    static func read<T: Decodable>(_ fd: Int32, as type: T.Type) throws -> T? {
        let file = openat(fd, "record.json", O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        if file < 0 { if errno == ENOENT { return nil }; throw Failure.storage }
        defer { close(file) }
        let info = try MobileFolderReader.info(file)
        guard info.st_mode & S_IFMT == S_IFREG, info.st_nlink == 1, info.st_size > 0, info.st_size <= 65_536 else { throw Failure.storage }
        let data = try FileHandle(fileDescriptor: file, closeOnDealloc: false).read(upToCount: 65_537) ?? Data()
        guard data.count == info.st_size else { throw Failure.storage }
        return try JSONDecoder().decode(type, from: data)
    }

    static func save<T: Encodable>(_ value: T, _ fd: Int32) throws {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(value)
        guard data.count <= 65_536 else { throw Failure.limit }
        let name = "checkpoint-" + UUID().uuidString
        let file = openat(fd, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard file >= 0 else { throw Failure.storage }
        defer { close(file); unlinkat(fd, name, 0) }
        try FileHandle(fileDescriptor: file, closeOnDealloc: false).write(contentsOf: data)
        guard fsync(file) == 0, renameat(fd, name, fd, "record.json") == 0, fsync(fd) == 0 else { throw Failure.storage }
    }
}
