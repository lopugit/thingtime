import Foundation
import Darwin

/// One explicit export of immutable bytes. No saved folder grant or sync policy.
public enum FileVersionExport {
    public typealias Failure = MobileFolderStore.Failure
    public static let rangeBytes = 2 * 1024 * 1024
    public struct Content: Codable, Equatable, Sendable {
        public let attachmentId: String
        public let version: String
        public let size: Int64
        public let fingerprint: MobileFolderReader.Fingerprint
    }
    public struct Request: Codable, Sendable {
        public init(name: String, content: Content) { self.name = name; self.content = content }
        public let name: String
        public let content: Content
        public func validate() throws {
            guard try MobileFolderReader.components(name).count == 1, !name.trimmingCharacters(in: .whitespaces).isEmpty,
                  content.attachmentId.range(of: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$", options: .regularExpression) != nil,
                  content.version.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw Failure.invalid }
            try MobileSyncStaging.Request.validateEntry(.init(path: name, id: content.attachmentId, version: content.version,
                kind: "file", size: content.size, sha256: nil, fingerprint: content.fingerprint))
        }
        public func matchFingerprint(_ data: Data) throws {
            struct Receipt: Decodable { let ok: Bool; let id: String; let version: String; let size: Int64; let fingerprint: MobileFolderReader.Fingerprint }
            let receipt = try JSONDecoder().decode(Receipt.self, from: data)
            guard receipt.ok, receipt.id == content.attachmentId, receipt.version == content.version,
                  receipt.size == content.size, receipt.fingerprint == content.fingerprint else { throw Failure.changed }
        }
        public func rangePath(offset: Int64, length: Int) throws -> String {
            guard offset >= 0, length > 0, length <= FileVersionExport.rangeBytes, offset <= content.size - Int64(length) else { throw Failure.invalid }
            return "/api/v1/attachments/content?id=\(content.attachmentId)&range=1&version=\(content.version)&offset=\(offset)&length=\(length)"
        }
        public func validateRange(_ response: HTTPURLResponse, offset: Int64, length: Int) throws {
            _ = try rangePath(offset: offset, length: length)
            let encoding = response.value(forHTTPHeaderField: "Content-Encoding")
            let count = response.value(forHTTPHeaderField: "Content-Length")
            guard response.statusCode == 206, response.value(forHTTPHeaderField: "ETag") == "\"\(content.version)\"",
                  response.value(forHTTPHeaderField: "Content-Range") == "bytes \(offset)-\(offset + Int64(length) - 1)/\(content.size)",
                  count == nil || count == String(length), encoding == nil || encoding == "identity" else { throw Failure.changed }
        }
    }

    /// Request-owned private staging is removed on cancellation, failure or release.
    /// Call prepare/save serially; only verified bytes can reach the selected folder.
    public final class Prepared: @unchecked Sendable {
        public let request: Request
        private let directory: URL
        private let file: Int32
        private init(request: Request, directory: URL, file: Int32) { self.request = request; self.directory = directory; self.file = file }
        deinit { close(file); try? FileManager.default.removeItem(at: directory) }

        public static func download(_ request: Request, privateDirectory: URL,
            read: @Sendable (Int64, Int) async throws -> Data) async throws -> Prepared {
            try request.validate(); try Task.checkCancellation()
            // Parent is app-private storage supplied by the native host, never JS.
            try FileManager.default.createDirectory(at: privateDirectory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            var directory = privateDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            guard mkdir(directory.path, 0o700) == 0 else { throw Failure.storage }
            var values = URLResourceValues(); values.isExcludedFromBackup = true
            do { try directory.setResourceValues(values) } catch { try? FileManager.default.removeItem(at: directory); throw error }
            let file = open(directory.appendingPathComponent("bytes").path, O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
            guard file >= 0 else { try? FileManager.default.removeItem(at: directory); throw Failure.storage }
            let prepared = Prepared(request: request, directory: directory, file: file)
            var offset: Int64 = 0
            while offset < request.content.size {
                try Task.checkCancellation()
                let length = Int(min(Int64(FileVersionExport.rangeBytes), request.content.size - offset))
                let data = try await read(offset, length)
                try Task.checkCancellation()
                guard data.count == length else { throw Failure.changed }
                try writeAll(data, to: file); offset += Int64(length)
            }
            guard fsync(file) == 0 else { throw Failure.storage }
            try prepared.verify(file)
            return prepared
        }
        private func verify(_ descriptor: Int32) throws {
            try Task.checkCancellation()
            let before = try MobileFolderReader.info(descriptor)
            guard before.st_mode & S_IFMT == S_IFREG, before.st_nlink == 1, before.st_size == request.content.size,
                  try MobileFolderReader.fingerprint(descriptor, size: before.st_size) == request.content.fingerprint,
                  try MobileFolderReader.stamp(MobileFolderReader.info(descriptor)) == MobileFolderReader.stamp(before) else { throw Failure.changed }
        }
        /// Called only after the host reauthorizes the account and selected destination.
        /// Existing names (including symlinks) are never replaced. Errors after rename
        /// preserve the saved file; callers must tell users to check Files before retry.
        public func save(into destination: URL, check: () throws -> Void = {}) throws -> String {
            guard destination.isFileURL else { throw Failure.invalid }
            try check(); try verify(file)
            let scoped = destination.startAccessingSecurityScopedResource()
            defer { if scoped { destination.stopAccessingSecurityScopedResource() } }
            var result: Result<String, Error>?, coordinationError: NSError?
            NSFileCoordinator().coordinate(writingItemAt: destination, options: .forMerging, error: &coordinationError) { url in
                result = Result {
                    try Task.checkCancellation(); try check()
                    let root = open(url.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                    guard root >= 0 else { throw Failure.unavailable }; defer { close(root) }
                    let temporary = ".thingtime-export-\(UUID().uuidString)"
                    let output = openat(root, temporary, O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
                    guard output >= 0 else { throw Failure.storage }; defer { close(output) }
                    let created = try MobileFolderReader.info(output)
                    defer {
                        var current = stat()
                        if fstatat(root, temporary, &current, AT_SYMLINK_NOFOLLOW) == 0,
                           current.st_dev == created.st_dev, current.st_ino == created.st_ino { unlinkat(root, temporary, 0) }
                    }
                    var buffer = [UInt8](repeating: 0, count: MobileFolderReader.maximumReadBytes), offset: Int64 = 0
                    while offset < request.content.size {
                        try Task.checkCancellation(); try check()
                        let count = pread(file, &buffer, Int(min(Int64(buffer.count), request.content.size - offset)), off_t(offset))
                        guard count > 0 else { throw Failure.changed }
                        try Self.writeAll(Data(buffer.prefix(count)), to: output); offset += Int64(count)
                    }
                    guard fsync(output) == 0 else { throw Failure.storage }
                    try verify(output)
                    for suffix in 0..<1000 {
                        try Task.checkCancellation(); try check()
                        let name = Self.availableName(request.name, suffix: suffix)
                        if renameatx_np(root, temporary, root, name, UInt32(RENAME_EXCL)) != 0 {
                            if errno == EEXIST { continue }; throw Failure.storage
                        }
                        guard fsync(root) == 0 else { throw Failure.storage }
                        let saved = openat(root, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
                        guard saved >= 0 else { throw Failure.changed }; defer { close(saved) }
                        let current = try MobileFolderReader.info(saved)
                        guard current.st_dev == created.st_dev, current.st_ino == created.st_ino else { throw Failure.changed }
                        try verify(saved); try check(); try Task.checkCancellation()
                        return name
                    }
                    throw Failure.limit
                }
            }
            if let coordinationError { throw coordinationError }
            guard let result else { throw Failure.unavailable }; return try result.get()
        }
        static func availableName(_ original: String, suffix: Int) -> String {
            if suffix == 0 { return original }
            let ext = (original as NSString).pathExtension
            let ending = " (\(suffix))" + (ext.isEmpty ? "" : "." + ext)
            var stem = ext.isEmpty ? original : (original as NSString).deletingPathExtension
            while !stem.isEmpty && (stem + ending).utf8.count > 255 { stem.removeLast() }
            return stem + ending
        }
        private static func writeAll(_ data: Data, to descriptor: Int32) throws {
            try data.withUnsafeBytes { bytes in
                var at = 0
                while at < bytes.count {
                    try Task.checkCancellation()
                    let count = write(descriptor, bytes.baseAddress!.advanced(by: at), bytes.count - at)
                    if count < 0 && errno == EINTR { continue }
                    guard count > 0 else { throw Failure.storage }; at += count
                }
            }
        }
    }
}
