import Foundation
import CryptoKit
import Darwin

/// Private, bounded transfer cache. This grants no file/cloud authority and is
/// never version history. The host reauthorizes before prepare, upload and release.
/// The host must serialize that whole lifecycle; returned paths are not leases
/// for independently concurrent or OS-managed background tasks.
public final class FileUploadPartStore: @unchecked Sendable {
    public enum Failure: Error, LocalizedError {
        case capacity
        public var errorDescription: String? {
            "Upload recovery storage is full. Finish pending uploads or remove their folder selections to clear cached upload parts."
        }
    }
    public struct Request: Codable, Equatable, Sendable {
        public let scope: FileSyncOwnerScope
        public let rootId: String
        public let grantHash: String
        public let uploadId: String
        public let requestId: String
        public let source: MobileFolderReader.Entry
        public let partNumber: Int
        public let offset: Int64
        public let length: Int64
        public init(scope: FileSyncOwnerScope, rootId: String, grantHash: String, uploadId: String, requestId: String,
                    source: MobileFolderReader.Entry, partNumber: Int, offset: Int64, length: Int64) {
            self.scope = scope; self.rootId = rootId; self.grantHash = grantHash; self.uploadId = uploadId; self.requestId = requestId
            self.source = source; self.partNumber = partNumber; self.offset = offset; self.length = length
        }
        public func validate() throws {
            _ = try FileSyncOwnerScope(ownerId: scope.ownerId, url: scope.origin)
            try MobileSyncStaging.Request.validateEntry(source)
            let plan = try FileUploadPart.plan(size: source.size)
            guard UUID(uuidString: rootId) != nil, Self.digest(grantHash), source.kind == "file", source.fingerprint != nil,
                  [uploadId, requestId].allSatisfy({ $0.range(of: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$", options: .regularExpression) != nil }),
                  partNumber >= 1, partNumber <= plan.count, offset == Int64(partNumber - 1) * plan.partSize,
                  length == min(plan.partSize, source.size - offset) else { throw MobileFolderStore.Failure.invalid }
        }
        fileprivate static func digest(_ value: String) -> Bool { value.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }
    }
    public struct Part: FileUploadPartSource {
        public let url: URL
        public let checksumSha256: String
        public let sha256: String
        public let length: Int64
        public let reused: Bool
    }
    private struct Record: Codable {
        let version: Int
        let request: Request
        var sha256: String?
    }
    private let directory: URL
    private let maximumParts: Int
    private let maximumBytes: Int64
    private let afterPayloadFlushed: (() throws -> Void)?
    public init(directory: URL, maximumParts: Int = 32, maximumBytes: Int64 = 5 * 1024 * 1024 * 1024,
                afterPayloadFlushed: (() throws -> Void)? = nil) {
        self.directory = directory; self.maximumParts = maximumParts; self.maximumBytes = maximumBytes
        self.afterPayloadFlushed = afterPayloadFlushed
    }
    #if os(iOS)
    public convenience init() {
        self.init(directory: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("FileUploadParts-v1", isDirectory: true))
    }
    #endif
    private func key(_ request: Request) throws -> String {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        // Source/grant changes under this original upload identity must conflict,
        // not silently allocate another cache entry or replace the captured bytes.
        return PhotoLibraryReader.hash(try encoder.encode([request.scope.origin.absoluteString, request.scope.ownerId,
            request.rootId, request.uploadId, request.requestId, String(request.partNumber)]))
    }
    private func entries() throws -> [URL] {
        let rows = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { $0.lastPathComponent != "lock" }
        guard rows.count <= maximumParts else { throw Failure.capacity }
        guard rows.allSatisfy({ Request.digest($0.lastPathComponent) }) else { throw MobileFolderStore.Failure.storage }
        return rows
    }
    private func record(_ fd: Int32) throws -> Record? {
        let r = try NativeFileJournal.read(fd, as: Record.self)
        if let r {
            try r.request.validate()
            guard r.version == 1, r.sha256 == nil || Request.digest(r.sha256!) else { throw MobileFolderStore.Failure.storage }
        }
        return r
    }
    private func validatedPart(_ record: Record, location: URL, fd: Int32, reused: Bool) throws -> Part {
        guard let expected = record.sha256 else { throw MobileFolderStore.Failure.storage }
        let file = openat(fd, "payload", O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        guard file >= 0 else { throw MobileFolderStore.Failure.storage }; defer { close(file) }
        let before = try MobileFolderReader.info(file)
        guard before.st_mode & S_IFMT == S_IFREG, before.st_nlink == 1, before.st_size == record.request.length else { throw MobileFolderStore.Failure.changed }
        let handle = FileHandle(fileDescriptor: file, closeOnDealloc: false)
        var hash = SHA256(), count: Int64 = 0
        while let bytes = try handle.read(upToCount: 65_536), !bytes.isEmpty {
            try Task.checkCancellation(); hash.update(data: bytes); count += Int64(bytes.count)
            guard count <= record.request.length else { throw MobileFolderStore.Failure.changed }
        }
        let digest = hash.finalize(), after = try MobileFolderReader.info(file)
        let hex = digest.map { String(format: "%02x", $0) }.joined()
        guard count == record.request.length, hex == expected, before.st_size == after.st_size,
              before.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec, before.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec,
              before.st_ctimespec.tv_sec == after.st_ctimespec.tv_sec, before.st_ctimespec.tv_nsec == after.st_ctimespec.tv_nsec else { throw MobileFolderStore.Failure.changed }
        return Part(url: location.appendingPathComponent("payload"), checksumSha256: Data(digest).base64EncodedString(), sha256: hex, length: count, reused: reused)
    }
    public func prepare(_ request: Request,
        stream: (_ offset: Int64, _ length: Int, _ receive: (Data) throws -> Void) throws -> Int64) throws -> Part {
        try request.validate()
        guard maximumParts > 0, maximumParts <= 32, maximumBytes > 0, maximumBytes <= 5 * 1024 * 1024 * 1024 else { throw MobileFolderStore.Failure.invalid }
        return try NativeFileJournal.locked(directory: directory) { parentFD in
            let token = try key(request), location = directory.appendingPathComponent(token, isDirectory: true)
            // A death before the first atomic record can leave an empty
            // reservation. It has no committed bytes or identity to recover.
            for row in try entries() {
                let orphan = try NativeFileJournal.locked(directory: row) { fd in
                    guard try record(fd) == nil else { return false }
                    guard try MobileFolderReader.names(fd).allSatisfy({ $0 == "lock" || $0.hasPrefix("checkpoint-") }) else {
                        throw MobileFolderStore.Failure.storage
                    }
                    return true
                }
                if orphan { try FileManager.default.removeItem(at: row) }
            }
            guard fsync(parentFD) == 0 else { throw MobileFolderStore.Failure.storage }
            let rows = try entries()
            var reserved: Int64 = 0
            for row in rows where row.lastPathComponent != token {
                try NativeFileJournal.locked(directory: row) { fd in
                    guard let record = try self.record(fd) else { throw MobileFolderStore.Failure.storage }
                    reserved += record.request.length
                }
            }
            guard reserved <= maximumBytes - request.length,
                  rows.contains(where: { $0.lastPathComponent == token }) || rows.count < maximumParts else { throw Failure.capacity }
            return try NativeFileJournal.locked(directory: location) { fd in
                if let existing = try record(fd) {
                    guard existing.request == request else { throw MobileFolderStore.Failure.changed }
                    if existing.sha256 != nil { return try validatedPart(existing, location: location, fd: fd, reused: true) }
                }
                // Reserve identity before writing. A crash before the final digest
                // leaves a recapturable part, never a successful cached response.
                try NativeFileJournal.save(Record(version: 1, request: request, sha256: nil), fd)
                guard fsync(parentFD) == 0 else { throw MobileFolderStore.Failure.storage }
                for old in try FileManager.default.contentsOfDirectory(at: location, includingPropertiesForKeys: nil)
                    where old.lastPathComponent.hasPrefix("thingtime-upload-") || old.lastPathComponent == "payload" {
                    try FileManager.default.removeItem(at: old)
                }
                let part = try FileUploadPart.capture(size: request.source.size, partNumber: request.partNumber,
                    offset: request.offset, length: request.length, temporaryDirectory: location, stream: stream)
                defer { part.discard() }
                guard rename(part.url.path, location.appendingPathComponent("payload").path) == 0, fsync(fd) == 0 else { throw MobileFolderStore.Failure.storage }
                try afterPayloadFlushed?()
                let ready = Record(version: 1, request: request, sha256: part.sha256)
                try NativeFileJournal.save(ready, fd)
                return try validatedPart(ready, location: location, fd: fd, reused: false)
            }
        }
    }
    /// Release only the exact verified handoff. Errors/uncertain uploads retain it.
    public func release(_ request: Request) throws {
        try request.validate()
        try NativeFileJournal.locked(directory: directory) { parentFD in
            let token = try key(request)
            guard let location = try entries().first(where: { $0.lastPathComponent == token }) else { return }
            try NativeFileJournal.locked(directory: location) { fd in
                guard let record = try record(fd), record.request == request else { throw MobileFolderStore.Failure.changed }
            }
            try FileManager.default.removeItem(at: location)
            guard fsync(parentFD) == 0 else { throw MobileFolderStore.Failure.storage }
        }
    }
    /// Removing the exact native grant also removes its retained upload cache.
    public func remove(scope: FileSyncOwnerScope, rootId: String) throws {
        try NativeFileJournal.locked(directory: directory) { parentFD in
            for location in try entries() {
                let matches = try NativeFileJournal.locked(directory: location) { fd in
                    guard let record = try record(fd) else { throw MobileFolderStore.Failure.storage }
                    return record.request.scope == scope && record.request.rootId == rootId
                }
                if matches {
                    try FileManager.default.removeItem(at: location)
                    guard fsync(parentFD) == 0 else { throw MobileFolderStore.Failure.storage }
                }
            }
        }
    }
}
