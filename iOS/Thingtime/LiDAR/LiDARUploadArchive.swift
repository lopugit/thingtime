import AppleFileSync
import CryptoKit
import Darwin
import Foundation

/// The recorder seals a file in private Application Support. Keep only a
/// multipart hash plan in memory and stage one file-backed PUT at a time.
struct LiDARUploadArchive: Sendable {
    let fingerprint: MobileFolderReader.Fingerprint
    private let checksums: [Data]

    static func recover(id: UUID, directory: URL) async throws -> LiDARCapture? {
        try await offMain { try LiDARCaptureStore.recover(id: id, directory: directory) }
    }

    static func inspect(_ capture: LiDARCapture, verifySeal: Bool) async throws -> Self {
        try await offMain {
            try withArchive(capture) { file in
                if verifySeal {
                    do { try LiDARCaptureStore.validateSealedArchive(capture, file: file) }
                    catch is CancellationError { throw CancellationError() }
                    catch { throw LiDARUploadOutbox.Failure.archiveChanged }
                }
                let plan = try FileUploadPart.plan(size: capture.byteCount)
                var checksums: [Data] = []
                var composite = SHA256()
                for index in 0..<plan.count {
                    var remaining = min(plan.partSize, capture.byteCount - Int64(index) * plan.partSize)
                    var part = SHA256()
                    while remaining > 0 {
                        try Task.checkCancellation()
                        let data = try read(file, maximum: remaining)
                        remaining -= Int64(data.count)
                        part.update(data: data)
                    }
                    let digest = Data(part.finalize())
                    checksums.append(digest)
                    composite.update(data: digest)
                }
                let hex = composite.finalize().map { String(format: "%02x", $0) }.joined()
                return Self(fingerprint: .init(partSizeBytes: plan.partSize, partCount: plan.count, sha256: hex),
                            checksums: checksums)
            }
        }
    }

    func part(_ number: Int, capture: LiDARCapture) async throws -> FileUploadPart {
        try await Self.offMain {
            let offset = Int64(number - 1) * fingerprint.partSizeBytes
            let length = min(fingerprint.partSizeBytes, capture.byteCount - offset)
            return try Self.withArchive(capture) { file in
                let part = try FileUploadPart.capture(size: capture.byteCount, partNumber: number,
                                                      offset: offset, length: length) { offset, count, receive in
                    try file.seek(toOffset: UInt64(offset))
                    var remaining = Int64(count)
                    while remaining > 0 {
                        let data = try Self.read(file, maximum: remaining)
                        try receive(data)
                        remaining -= Int64(data.count)
                    }
                    return capture.byteCount
                }
                guard Data(base64Encoded: part.checksumSha256) == checksums[number - 1] else {
                    throw LiDARUploadOutbox.Failure.archiveChanged
                }
                return part
            }
        }
    }

    private static func read(_ file: FileHandle, maximum: Int64) throws -> Data {
        guard let data = try file.read(upToCount: Int(min(65_536, maximum))), !data.isEmpty else {
            throw LiDARUploadOutbox.Failure.archiveChanged
        }
        return data
    }

    private static func withArchive<T>(_ capture: LiDARCapture, _ work: (FileHandle) throws -> T) throws -> T {
        let descriptor = open(capture.archiveURL.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK)
        guard descriptor >= 0 else { throw LiDARUploadOutbox.Failure.archiveChanged }
        defer { close(descriptor) }
        var before = stat()
        guard fstat(descriptor, &before) == 0, before.st_mode & S_IFMT == S_IFREG,
              before.st_nlink == 1, before.st_size == capture.byteCount else {
            throw LiDARUploadOutbox.Failure.archiveChanged
        }
        let result = try work(FileHandle(fileDescriptor: descriptor, closeOnDealloc: false))
        var after = stat()
        guard fstat(descriptor, &after) == 0, after.st_nlink == 1, before.st_size == after.st_size,
              before.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec,
              before.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec,
              before.st_ctimespec.tv_sec == after.st_ctimespec.tv_sec,
              before.st_ctimespec.tv_nsec == after.st_ctimespec.tv_nsec else {
            throw LiDARUploadOutbox.Failure.archiveChanged
        }
        return result
    }

    private static func offMain<T: Sendable>(_ work: @escaping @Sendable () throws -> T) async throws -> T {
        let task = Task.detached(priority: .utility, operation: work)
        return try await withTaskCancellationHandler(operation: { try await task.value }, onCancel: { task.cancel() })
    }
}
