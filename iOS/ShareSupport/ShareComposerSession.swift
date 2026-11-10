import Foundation
import UniformTypeIdentifiers
import Darwin
import ImageIO
import UIKit
import CryptoKit

/// Private draft, retry and receipt data kept beside the original payload.
/// Never store authentication credentials or session material here.
struct ShareComposerMetadata: Codable {
    let origin: String
    let textPaths: [String]
    var supplementalTextPaths: [String]?
    /// Generated provider namespaces are not user-supplied directories.
    var providerContainers: [String]?
    var accountId: String?
    var completed = false
    var submission: ShareComposerSubmission?
    static func read(from directory: URL) throws -> Self {
        try JSONDecoder().decode(Self.self, from: Data(contentsOf: directory.appendingPathComponent("composer.json")))
    }
    func write(to directory: URL) throws {
        try JSONEncoder().encode(self).write(to: directory.appendingPathComponent("composer.json"), options: .atomic)
    }
}

struct ShareComposerSubmission: Codable {
    let destination: String
    let operationId: String
    let targetId: String?
    var outcomeIds: [String]?
    var recoveryPayload: String?
    func matches(_ other: Self) -> Bool {
        destination == other.destination && operationId == other.operationId && targetId == other.targetId
    }
    var json: [String: Any] {
        var value: [String: Any] = ["destination": destination, "operationId": operationId]
        if let targetId { value["targetId"] = targetId }
        if let outcomeIds { value["outcomeIds"] = outcomeIds }
        if let recoveryPayload { value["recoveryPayload"] = recoveryPayload }
        return value
    }
}

/// A lease on exactly one committed share. All file access is descriptor-relative;
/// web callers receive opaque IDs and bounded chunks, never filesystem paths.
final class ShareComposerSession {
    static let version = "1.0.0"
    static let maxChunkBytes = 256 * 1024
    enum Failure: LocalizedError {
        case unavailable, identity, invalidRequest, busy
        var errorDescription: String? {
            switch self {
            case .unavailable: return "This share is unavailable. Its original files remain on this device."
            case .identity: return "This share belongs to another account or origin. Switch back to continue."
            case .invalidRequest: return "The share request is invalid."
            case .busy: return "This share is already open in another Thingtime window. Close that composer and retry."
            }
        }
    }
    struct Entry {
        let id: String
        let path: String
        let size: UInt64
        var json: [String: Any] {
            ["id": id, "name": (path as NSString).lastPathComponent, "relativePath": path,
             "size": size, "type": UTType(filenameExtension: (path as NSString).pathExtension)?.preferredMIMEType ?? "application/octet-stream"]
        }
    }
    let id: UUID
    let origin: String
    private let directory: URL
    private let payloadDescriptor: Int32
    private let leaseDescriptor: Int32
    private var entries: [Entry] = []
    private var directories: [String] = []
    private var indexed = false

    static func origin(_ url: URL) -> String {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let scheme = components.scheme?.lowercased(), let host = components.host?.lowercased(),
              components.user == nil, components.password == nil,
              scheme == "https" || (scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(host)) else { return "" }
        var normalized = URLComponents()
        normalized.scheme = scheme; normalized.host = host
        if let port = components.port, !((scheme == "https" && port == 443) || (scheme == "http" && port == 80)) { normalized.port = port }
        return normalized.string ?? ""
    }
    static func composerURL(origin: URL, requestId: UUID) -> URL? {
        guard !Self.origin(origin).isEmpty, var components = URLComponents(string: Self.origin(origin)) else { return nil }
        components.path = "/share"
        components.queryItems = [URLQueryItem(name: "requestId", value: requestId.uuidString)]
        return components.url
    }
    init(inbox: ShareInbox, id: UUID, origin: URL) throws {
        self.id = id; self.origin = Self.origin(origin)
        guard !self.origin.isEmpty else { throw Failure.identity }
        directory = try inbox.composerDirectory(id: id)
        let metadata = try ShareComposerMetadata.read(from: directory)
        guard metadata.origin == self.origin, !metadata.completed else { throw Failure.identity }
        let lease = directory.appendingPathComponent("composer.lock").withUnsafeFileSystemRepresentation {
            open($0!, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, mode_t(0o600))
        }
        guard lease >= 0 else { throw Failure.unavailable }
        guard flock(lease, LOCK_EX | LOCK_NB) == 0 else { close(lease); throw Failure.busy }
        let payload = directory.appendingPathComponent("payload").withUnsafeFileSystemRepresentation {
            open($0!, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        }
        guard payload >= 0 else { close(lease); throw Failure.unavailable }
        leaseDescriptor = lease; payloadDescriptor = payload
    }
    deinit { close(payloadDescriptor); close(leaseDescriptor) }

    private func metadata(accountId: String) throws -> ShareComposerMetadata {
        guard !accountId.isEmpty else { throw Failure.identity }
        let metadata = try ShareComposerMetadata.read(from: directory)
        guard metadata.origin == origin, !metadata.completed,
              metadata.accountId == nil || metadata.accountId == accountId else { throw Failure.identity }
        return metadata
    }
    func incoming(accountId: String) throws -> [String: Any] {
        var metadata = try metadata(accountId: accountId)
        // Bind once, before disclosing payload. This persists across termination.
        if metadata.accountId == nil { metadata.accountId = accountId; try metadata.write(to: directory) }
        if !indexed {
            entries = []; directories = []
            try index(descriptor: payloadDescriptor, prefix: "")
            entries.sort { Self.ordered($0.path, before: $1.path) }
            directories.sort { Self.ordered($0, before: $1) }
            indexed = true
        }
        var text: [String] = []
        var inlinePaths = Set<String>()
        let supplemental = Set(metadata.supplementalTextPaths ?? [])
        var providerText = Set<String>()
        for path in metadata.textPaths {
            if let value = try inlineText(path: path) {
                inlinePaths.insert(path)
                // A host often supplies the same String as both an attachment
                // and attributedContentText. Preserve separate provider items,
                // but do not repeat that transport-level supplemental caption.
                if !supplemental.contains(path) { providerText.insert(value); text.append(value) }
                else if !providerText.contains(value) { text.append(value) }
            }
        }
        let providerContainers = Set(metadata.providerContainers ?? [])
        return ["id": id.uuidString, "accountId": accountId, "apiOrigin": origin,
                "text": text.joined(separator: "\n\n"), "attachments": entries.filter { !inlinePaths.contains($0.path) }.map(\.json),
                "directories": directories.filter { !providerContainers.contains($0) }, "submission": metadata.submission?.json as Any? ?? NSNull()]
    }
    func read(accountId: String, fileId: String, offset: UInt64, length: Int) throws -> [String: Any] {
        let metadata = try metadata(accountId: accountId)
        guard metadata.accountId == accountId, indexed, length > 0, length <= Self.maxChunkBytes,
              let entry = entries.first(where: { $0.id == fileId }), offset <= entry.size, offset <= UInt64(Int64.max) else { throw Failure.invalidRequest }
        let descriptor = try openFile(path: entry.path)
        defer { close(descriptor) }
        var bytes = Data(count: min(length, Int(entry.size - offset)))
        let count = bytes.withUnsafeMutableBytes { buffer in pread(descriptor, buffer.baseAddress, buffer.count, off_t(offset)) }
        guard count >= 0 else { throw Failure.unavailable }
        bytes.count = count
        let next = offset + UInt64(count)
        guard count > 0 || next == entry.size else { throw Failure.unavailable }
        return ["base64": bytes.base64EncodedString(), "nextOffset": next, "eof": next == entry.size]
    }
    func thumbnail(accountId: String, fileId: String, maxDimension: Int) throws -> [String: Any]? {
        let metadata = try metadata(accountId: accountId)
        guard metadata.accountId == accountId, indexed, maxDimension > 0, maxDimension <= 640,
              let entry = entries.first(where: { $0.id == fileId }) else { throw Failure.invalidRequest }
        let reader = ShareThumbnailReader(descriptor: try openFile(path: entry.path))
        let info = Unmanaged.passRetained(reader).toOpaque()
        var callbacks = CGDataProviderDirectCallbacks(version: 0, getBytePointer: nil, releaseBytePointer: nil,
            getBytesAtPosition: { info, output, position, count in
                guard let info else { return 0 }
                let reader = Unmanaged<ShareThumbnailReader>.fromOpaque(info).takeUnretainedValue()
                var copied = 0
                while copied < count {
                    let result = pread(reader.descriptor, output.advanced(by: copied), min(count - copied, ShareComposerSession.maxChunkBytes), position + off_t(copied))
                    if result < 0 && errno == EINTR { continue }
                    if result <= 0 { break }
                    copied += result
                }
                return copied
            }, releaseInfo: { info in
                if let info { Unmanaged<ShareThumbnailReader>.fromOpaque(info).release() }
            })
        guard let provider = CGDataProvider(directInfo: info, size: off_t(entry.size), callbacks: &callbacks) else {
            Unmanaged<ShareThumbnailReader>.fromOpaque(info).release(); return nil
        }
        guard let source = CGImageSourceCreateWithDataProvider(provider, [kCGImageSourceShouldCache: false] as CFDictionary),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: maxDimension,
                kCGImageSourceShouldCacheImmediately: true
              ] as CFDictionary) else { return nil }
        for quality in [0.75, 0.45, 0.2] {
            if let data = UIImage(cgImage: image).jpegData(compressionQuality: quality), data.count <= 512 * 1024 {
                return ["base64": data.base64EncodedString(), "type": "image/jpeg"]
            }
        }
        return nil
    }
    func beginSubmission(accountId: String, submission: ShareComposerSubmission) throws -> [String: Any] {
        var metadata = try metadata(accountId: accountId)
        guard metadata.accountId == accountId, ["post", "message", "save"].contains(submission.destination),
              !submission.operationId.isEmpty else { throw Failure.invalidRequest }
        if let existing = metadata.submission {
            guard existing.matches(submission), existing.recoveryPayload == submission.recoveryPayload else { throw Failure.invalidRequest }
            return ["submission": existing.json]
        }
        metadata.submission = ShareComposerSubmission(destination: submission.destination, operationId: submission.operationId, targetId: submission.targetId, recoveryPayload: submission.recoveryPayload)
        try metadata.write(to: directory)
        return ["submission": metadata.submission!.json]
    }
    func recordOutcome(accountId: String, submission: ShareComposerSubmission, outcomeIds: [String]) throws -> [String: Any] {
        var metadata = try metadata(accountId: accountId)
        guard metadata.accountId == accountId, var existing = metadata.submission, existing.matches(submission),
              !outcomeIds.isEmpty, outcomeIds.allSatisfy({ !$0.isEmpty }),
              existing.outcomeIds == nil || existing.outcomeIds == outcomeIds else { throw Failure.invalidRequest }
        existing.outcomeIds = outcomeIds
        metadata.submission = existing
        try metadata.write(to: directory)
        return ["submission": existing.json]
    }
    func complete(accountId: String) throws {
        var metadata = try ShareComposerMetadata.read(from: directory)
        guard metadata.origin == origin, metadata.accountId == accountId,
              metadata.submission?.outcomeIds?.isEmpty == false else { throw Failure.identity }
        metadata.completed = true
        try metadata.write(to: directory)
    }
    /// Decode across bounded reads without allocating a second whole-file byte
    /// buffer. The current web composer contract still requires a text String;
    /// invalid or whitespace-only content stays an original file attachment.
    private func inlineText(path: String) throws -> String? {
        let handle = FileHandle(fileDescriptor: try openFile(path: path), closeOnDealloc: true)
        defer { try? handle.close() }
        var input = ShareTextBytes(handle: handle)
        var decoder = UTF8()
        var value = ""
        var meaningful = false
        while true {
            switch decoder.decode(&input) {
            case .scalarValue(let scalar):
                value.unicodeScalars.append(scalar)
                if !meaningful && !CharacterSet.whitespacesAndNewlines.contains(scalar) { meaningful = true }
            case .emptyInput:
                if let error = input.error { throw error }
                return meaningful ? value : nil
            case .error:
                if let error = input.error { throw error }
                return nil
            }
        }
    }

    /// Importer-generated Item N groups retain the sender's attachment order,
    /// including 10+ items; descendants use a stable locale-independent ordering.
    private static func ordered(_ left: String, before right: String) -> Bool {
        func itemIndex(_ path: String) -> Int? {
            let root = String(path.split(separator: "/", maxSplits: 1).first ?? "")
            guard root.hasPrefix("Item "), let number = Int(root.dropFirst(5)), number > 0, root == "Item \(number)" else { return nil }
            return number
        }
        let a = itemIndex(left), b = itemIndex(right)
        if let a, let b, a != b { return a < b }
        if (a != nil) != (b != nil) { return a != nil }
        return left < right
    }
    private func openFile(path: String) throws -> Int32 {
        let components = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        guard !components.isEmpty, components.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else { throw Failure.invalidRequest }
        var current = dup(payloadDescriptor)
        guard current >= 0 else { throw Failure.unavailable }
        for (index, component) in components.enumerated() {
            let next = openat(current, component, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK | (index == components.count - 1 ? 0 : O_DIRECTORY))
            close(current)
            guard next >= 0 else { throw Failure.unavailable }
            current = next
        }
        var status = stat()
        guard fstat(current, &status) == 0, status.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG) else { close(current); throw Failure.invalidRequest }
        return current
    }
    private func index(descriptor: Int32, prefix: String) throws {
        let copy = openat(descriptor, ".", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard copy >= 0 else { throw Failure.unavailable }
        guard let stream = fdopendir(copy) else { close(copy); throw Failure.unavailable }
        defer { closedir(stream) }
        while true {
            errno = 0
            guard let entry = readdir(stream) else { if errno != 0 { throw Failure.unavailable }; break }
            let name = withUnsafePointer(to: entry.pointee.d_name) {
                $0.withMemoryRebound(to: CChar.self, capacity: Int(MAXNAMLEN) + 1) { String(cString: $0) }
            }
            if name == "." || name == ".." { continue }
            let child = openat(descriptor, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
            guard child >= 0 else { throw Failure.unavailable }
            defer { close(child) }
            var status = stat()
            guard fstat(child, &status) == 0 else { throw Failure.unavailable }
            let path = prefix.isEmpty ? name : prefix + "/" + name
            switch status.st_mode & mode_t(S_IFMT) {
            case mode_t(S_IFDIR): directories.append(path); try index(descriptor: child, prefix: path)
            case mode_t(S_IFREG): entries.append(Entry(id: SHA256.hash(data: Data((id.uuidString + "\0" + path).utf8)).map { String(format: "%02x", $0) }.joined(), path: path, size: UInt64(status.st_size)))
            default: throw Failure.invalidRequest
            }
        }
    }
}

private final class ShareThumbnailReader {
    let descriptor: Int32
    init(descriptor: Int32) { self.descriptor = descriptor }
    deinit { close(descriptor) }
}

private struct ShareTextBytes: IteratorProtocol {
    let handle: FileHandle
    private var bytes = Data()
    private var index = 0
    private var ended = false
    private(set) var error: Error?
    init(handle: FileHandle) { self.handle = handle }
    mutating func next() -> UInt8? {
        if index == bytes.count {
            guard !ended else { return nil }
            do {
                bytes = try handle.read(upToCount: ShareComposerSession.maxChunkBytes) ?? Data()
                index = 0
                if bytes.isEmpty { ended = true; return nil }
            } catch { self.error = error; ended = true; return nil }
        }
        defer { index += 1 }
        return bytes[index]
    }
}
