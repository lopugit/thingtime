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
    /// A closed, value-free diagnostic for the guard that rejected a source.
    /// The ordinary error and upload result remain unchanged.
    public enum ReadGuard: String, CaseIterable, Sendable {
        case invalidShape = "invalid-shape", firstInspectError = "first-inspect-error"
        case firstInspectAbsent = "first-inspect-absent", firstInspectIdentity = "first-inspect-identity"
        case firstInspectPath = "first-inspect-path", firstInspectVersion = "first-inspect-version"
        case firstInspectKind = "first-inspect-kind", firstInspectSize = "first-inspect-size"
        case firstInspectFingerprint = "first-inspect-fingerprint", firstInspectLink = "first-inspect-link"
        case descriptorAccessError = "descriptor-access-error", descriptorMetadata = "descriptor-metadata", descriptorRead = "descriptor-read"
        case descriptorReopen = "descriptor-reopen", compositeDigest = "composite-digest"
        case rawDigest = "raw-digest", finalInspectError = "final-inspect-error"
        case finalInspectMismatch = "final-inspect-mismatch", symlinkReadError = "symlink-read-error"
    }
    public typealias ReadObserver = @Sendable (ReadGuard) -> Void

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
    private static func check(_ actual: MobileFolderReader.Entry?, _ expected: MobileFolderReader.Entry,
                              final: Bool, observer: ReadObserver?) throws {
        func reject(_ reason: ReadGuard) throws -> Never { observer?(final ? .finalInspectMismatch : reason); throw MobileFolderStore.Failure.changed }
        guard let actual else { try reject(.firstInspectAbsent) }
        guard actual.id == expected.id else { try reject(.firstInspectIdentity) }
        guard actual.path == expected.path else { try reject(.firstInspectPath) }
        guard actual.version == expected.version else { try reject(.firstInspectVersion) }
        guard actual.kind == "file" else { try reject(.firstInspectKind) }
        guard actual.size == expected.size else { try reject(.firstInspectSize) }
        guard actual.fingerprint == expected.fingerprint else { try reject(.firstInspectFingerprint) }
        guard actual.symbolicLink == expected.symbolicLink else { try reject(.firstInspectLink) }
    }

    /// Re-resolves every ancestor and checks canonical sibling aliases through
    /// inspect before and after reading. The strong digest is checked even when
    /// metadata is unchanged, including the final call after stored verification.
    public static func read(bookmark: Data, expected: MobileFolderReader.Entry, sha256: String? = nil,
                            observer: ReadObserver? = nil) throws -> Payload {
        do { try validate([expected]) } catch { observer?(.invalidShape); throw error }
        let first: MobileFolderReader.Entry?
        do { first = try MobileFolderReader.inspect(bookmark: bookmark, path: expected.path) }
        catch { observer?(.firstInspectError); throw error }
        try check(first, expected, final: false, observer: observer)
        if expected.symbolicLink != nil {
            let chunk: MobileFolderReader.Chunk
            do { chunk = try MobileFolderReader.read(bookmark: bookmark, path: expected.path, version: expected.version, offset: 0, length: Int(expected.size)) }
            catch { if !(error is CancellationError) { observer?(.symlinkReadError) }; throw error }
            guard let bytes = Data(base64Encoded: chunk.data), NativeSymbolicLinks.fingerprint(bytes) == expected.fingerprint else {
                observer?(.compositeDigest); throw MobileFolderStore.Failure.changed
            }
            let raw = NativeSymbolicLinks.hash(bytes)
            guard sha256 == nil || raw == sha256 else { observer?(.rawDigest); throw MobileFolderStore.Failure.changed }
            let final: MobileFolderReader.Entry?
            do { final = try MobileFolderReader.inspect(bookmark: bookmark, path: expected.path) }
            catch { observer?(.finalInspectError); throw error }
            try check(final, expected, final: true, observer: observer)
            return Payload(bytes: bytes, sha256: raw)
        }
        var reportedDescriptorGuard = false
        func reportDescriptor(_ value: ReadGuard) { reportedDescriptorGuard = true; observer?(value) }
        let bytes: Data
        do { bytes = try MobileFolderReader.access(bookmark) { root -> Data in
            let fd = try MobileFolderReader.openPath(root, path: expected.path); defer { close(fd) }
            let before = try MobileFolderReader.info(fd)
            guard before.st_mode & S_IFMT == S_IFREG, MobileFolderReader.stamp(before) == expected.version,
                  before.st_size == expected.size, "\(before.st_dev):\(before.st_ino)" == expected.id else {
                reportDescriptor(.descriptorMetadata); throw MobileFolderStore.Failure.changed
            }
            var output = Data(count: Int(expected.size)), count = 0
            while count < output.count {
                try Task.checkCancellation()
                let wanted = min(65_536, output.count - count)
                try SyncScanContext.current?.pace(wanted)
                let n = output.withUnsafeMutableBytes { pread(fd, $0.baseAddress!.advanced(by: count), wanted, off_t(count)) }
                guard n > 0 else { reportDescriptor(.descriptorRead); throw MobileFolderStore.Failure.changed }; SyncScanContext.current?.record(n); count += n
            }
            let current = try MobileFolderReader.openPath(root, path: expected.path); defer { close(current) }
            guard try MobileFolderReader.stamp(MobileFolderReader.info(fd)) == expected.version,
                  try MobileFolderReader.stamp(MobileFolderReader.info(current)) == expected.version else {
                reportDescriptor(.descriptorReopen); throw MobileFolderStore.Failure.changed
            }
            return output
        } } catch {
            if !(error is CancellationError) && !reportedDescriptorGuard { observer?(.descriptorAccessError) }
            throw error
        }
        let digest = SHA256.hash(data: bytes), raw = digest.map { String(format: "%02x", $0) }.joined()
        let composite = SHA256.hash(data: Data(digest)).map { String(format: "%02x", $0) }.joined()
        guard composite == expected.fingerprint?.sha256 else { observer?(.compositeDigest); throw MobileFolderStore.Failure.changed }
        guard expected.sha256 == nil || raw == expected.sha256, sha256 == nil || raw == sha256 else {
            observer?(.rawDigest); throw MobileFolderStore.Failure.changed
        }
        let final: MobileFolderReader.Entry?
        do { final = try MobileFolderReader.inspect(bookmark: bookmark, path: expected.path) }
        catch { observer?(.finalInspectError); throw error }
        try check(final, expected, final: true, observer: observer)
        try Task.checkCancellation()
        return Payload(bytes: bytes, sha256: raw)
    }
}
