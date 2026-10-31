import CryptoKit
import Darwin
import Foundation

/// Short coordinated reads only. No descriptor or coordinator survives a call,
/// so the caller can perform bounded network callbacks without locking Files.
public enum MobileFolderBulkReader {
    public static let maximumFiles = 256
    public static let maximumFileBytes = 262_144
    public static let maximumBytes = 33_554_432
    public struct Payload: Sendable { public let bytes: Data; public let sha256: String }

    public static func validate(_ entries: [MobileFolderReader.Entry]) throws {
        guard !entries.isEmpty, entries.count <= maximumFiles else { throw MobileFolderStore.Failure.limit }
        var paths = Set<String>(), identities = Set<String>(), total: Int64 = 0
        for entry in entries {
            _ = try MobileFolderReader.components(entry.path)
            guard entry.kind == "file", entry.size > 0, entry.size <= maximumFileBytes,
                  !entry.id.isEmpty, !entry.version.isEmpty,
                  let fingerprint = entry.fingerprint, fingerprint.algorithm == "sha256-parts-v1",
                  fingerprint.partSizeBytes == 8_388_608, fingerprint.partCount == 1,
                  hex(fingerprint.sha256), entry.sha256 == nil || hex(entry.sha256!),
                  paths.insert(entry.path.precomposedStringWithCanonicalMapping.lowercased()).inserted,
                  identities.insert(entry.id).inserted else { throw MobileFolderStore.Failure.invalid }
            total += entry.size
            guard total <= maximumBytes else { throw MobileFolderStore.Failure.limit }
        }
    }

    private static func hex(_ value: String) -> Bool {
        value.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
    private static func check(_ actual: MobileFolderReader.Entry?, _ expected: MobileFolderReader.Entry) throws {
        guard let actual, actual.id == expected.id, actual.path == expected.path, actual.version == expected.version,
              actual.kind == "file", actual.size == expected.size, actual.fingerprint == expected.fingerprint else {
            throw MobileFolderStore.Failure.changed
        }
    }

    /// Re-resolves every ancestor and checks canonical sibling aliases through
    /// inspect before and after reading. The strong digest is checked even when
    /// metadata is unchanged, including the final call after stored verification.
    public static func read(bookmark: Data, expected: MobileFolderReader.Entry, sha256: String? = nil) throws -> Payload {
        try validate([expected])
        try check(MobileFolderReader.inspect(bookmark: bookmark, path: expected.path), expected)
        let bytes = try MobileFolderReader.access(bookmark) { root -> Data in
            let fd = try MobileFolderReader.openPath(root, path: expected.path); defer { close(fd) }
            let before = try MobileFolderReader.info(fd)
            guard before.st_mode & S_IFMT == S_IFREG, MobileFolderReader.stamp(before) == expected.version,
                  before.st_size == expected.size, "\(before.st_dev):\(before.st_ino)" == expected.id else { throw MobileFolderStore.Failure.changed }
            var output = Data(count: Int(expected.size)), count = 0
            while count < output.count {
                try Task.checkCancellation()
                let wanted = min(65_536, output.count - count)
                let n = output.withUnsafeMutableBytes { pread(fd, $0.baseAddress!.advanced(by: count), wanted, off_t(count)) }
                guard n > 0 else { throw MobileFolderStore.Failure.changed }; count += n
            }
            let current = try MobileFolderReader.openPath(root, path: expected.path); defer { close(current) }
            guard try MobileFolderReader.stamp(MobileFolderReader.info(fd)) == expected.version,
                  try MobileFolderReader.stamp(MobileFolderReader.info(current)) == expected.version else { throw MobileFolderStore.Failure.changed }
            return output
        }
        let digest = SHA256.hash(data: bytes), raw = digest.map { String(format: "%02x", $0) }.joined()
        let composite = SHA256.hash(data: Data(digest)).map { String(format: "%02x", $0) }.joined()
        guard composite == expected.fingerprint?.sha256,
              expected.sha256 == nil || raw == expected.sha256, sha256 == nil || raw == sha256 else { throw MobileFolderStore.Failure.changed }
        try check(MobileFolderReader.inspect(bookmark: bookmark, path: expected.path), expected)
        try Task.checkCancellation()
        return Payload(bytes: bytes, sha256: raw)
    }
}
