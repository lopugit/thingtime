import Foundation
import CryptoKit

/// A single canonical multipart part backed by private temporary storage. The
/// producer emits bounded chunks; only the digest crosses the native bridge.
public final class FileUploadPart: @unchecked Sendable {
    public let url: URL
    public let checksumSha256: String
    public let sha256: String
    public let length: Int64
    private let directory: URL
    private init(directory: URL, url: URL, digest: SHA256.Digest, length: Int64) {
        self.directory = directory; self.url = url; self.length = length
        checksumSha256 = Data(digest).base64EncodedString()
        sha256 = digest.map { String(format: "%02x", $0) }.joined()
    }
    deinit { discard() }
    public func discard() { try? FileManager.default.removeItem(at: directory) }
    public static func plan(size: Int64) throws -> (partSize: Int64, count: Int) {
        let mib: Int64 = 1_048_576
        guard size > 0, size <= 9_007_199_254_740_991 else { throw MobileFolderStore.Failure.invalid }
        let part = ((max(8 * mib, (size + 9_999) / 10_000) + mib - 1) / mib) * mib
        guard part <= 5 * 1024 * mib else { throw MobileFolderStore.Failure.limit }
        return (part, Int((size + part - 1) / part))
    }
    public static func capture(size: Int64, partNumber: Int, offset: Int64, length: Int64,
        stream: (_ offset: Int64, _ length: Int, _ receive: (Data) throws -> Void) throws -> Int64) throws -> FileUploadPart {
        let plan = try plan(size: size)
        guard partNumber >= 1, partNumber <= plan.count, offset == Int64(partNumber - 1) * plan.partSize,
              length == min(plan.partSize, size - offset) else { throw MobileFolderStore.Failure.invalid }
        try Task.checkCancellation()
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("thingtime-upload-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        let url = directory.appendingPathComponent("part")
        do {
            guard FileManager.default.createFile(atPath: url.path, contents: nil, attributes: [.posixPermissions: 0o600]) else { throw MobileFolderStore.Failure.storage }
            let file = try FileHandle(forWritingTo: url); defer { try? file.close() }
            var hash = SHA256(), copied: Int64 = 0
            while copied < length {
                try Task.checkCancellation()
                let wanted = Int(min(Int64(MobileFolderReader.maximumStreamBytes), length - copied))
                var received = 0
                let actualSize = try stream(offset + copied, wanted) { bytes in
                    try Task.checkCancellation()
                    guard !bytes.isEmpty, bytes.count <= MobileFolderReader.maximumReadBytes,
                          bytes.count <= wanted - received else { throw MobileFolderStore.Failure.changed }
                    try file.write(contentsOf: bytes); hash.update(data: bytes); received += bytes.count
                }
                guard actualSize == size, received == wanted else { throw MobileFolderStore.Failure.changed }
                copied += Int64(received)
            }
            try file.synchronize(); try Task.checkCancellation()
            return FileUploadPart(directory: directory, url: url, digest: hash.finalize(), length: copied)
        } catch { try? FileManager.default.removeItem(at: directory); throw error }
    }
}
