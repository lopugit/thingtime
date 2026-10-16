import Foundation
import CryptoKit
import Darwin

/// App-private transfer state, not file history or permission to publish into a
/// selected folder. Every bridge call separately reauthorizes the native grant.
/// The immutable operation and receipt shapes match the shared sync executor.
final class MobileSyncStaging: @unchecked Sendable {
    typealias Entry = MobileFolderReader.Entry
    typealias Failure = MobileFolderStore.Failure
    struct Scope: Codable, Equatable, Sendable {
        let origin: String; let ownerId: String; let dataPlane: String; let rootId: String; let deviceId: String
    }
    struct Mutation: Codable, Equatable, Sendable {
        let kind: String; let from: String; let path: String; let source: Entry; let expectedTarget: Entry?
    }
    struct Operation: Codable, Equatable, Sendable {
        let id: String; let mutation: Mutation; let confirmed: Bool
    }
    struct Request: Codable, Equatable, Sendable {
        let scope: Scope; let rootId: String; let operation: Operation
        func validate(owner: MobileDevicePairing.Scope) throws {
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
    struct Stage: Codable, Equatable, Sendable {
        let operationId: String; let scope: Scope; let token: String; let entry: Entry
    }
    struct Progress: Codable, Sendable { let received: Int64; let stage: Stage? }
    private struct Record: Codable {
        let version: Int
        let request: Request
        var received: Int64
        var stage: Stage?
    }
    private let directory: URL
    private let afterBytesFlushed: (() throws -> Void)?
    init(directory: URL? = nil, afterBytesFlushed: (() throws -> Void)? = nil) {
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MobileSyncStaging-v1", isDirectory: true)
        self.afterBytesFlushed = afterBytesFlushed
    }
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
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700, .protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
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
    private func withRecord<T>(_ request: Request, owner: MobileDevicePairing.Scope, create: Bool,
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
    func begin(_ request: Request, owner: MobileDevicePairing.Scope) throws -> Progress {
        try withRecord(request, owner: owner, create: true) { fd, row in
            let file = try payload(fd, row: row, create: row.received == 0 && row.stage == nil); defer { close(file) }
            if row.stage != nil { try verify(file, row: row) }
            guard fsync(file) == 0, fsync(fd) == 0 else { throw Failure.storage }
            return Progress(received: row.received, stage: row.stage)
        }
    }
    func append(_ request: Request, owner: MobileDevicePairing.Scope, offset: Int64, bytes: Data) throws -> Progress {
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
        let source = row.request.operation.mutation.source
        let before = try MobileFolderReader.info(file)
        if source.kind == "file" {
            guard row.received == source.size, before.st_size == source.size else { throw Failure.changed }
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
        } else { guard try MobileFolderReader.names(file).isEmpty else { throw Failure.changed } }
        guard try MobileFolderReader.stamp(MobileFolderReader.info(file)) == MobileFolderReader.stamp(before) else { throw Failure.changed }
        if let stage = row.stage {
            guard stage.operationId == row.request.operation.id, stage.scope == row.request.scope, stage.token == (try key(row.request)),
                  stage.entry == entry(before, source: source) else { throw Failure.changed }
        }
    }
    private func entry(_ info: stat, source: Entry) -> Entry {
        Entry(path: source.path, id: "\(info.st_dev):\(info.st_ino)", version: MobileFolderReader.stamp(info), kind: source.kind,
              size: source.size, sha256: source.sha256, fingerprint: source.fingerprint)
    }
    func finish(_ request: Request, owner: MobileDevicePairing.Scope) throws -> Progress {
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
}
