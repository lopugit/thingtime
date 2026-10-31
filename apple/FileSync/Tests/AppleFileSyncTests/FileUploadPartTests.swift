import XCTest
import CryptoKit
@testable import AppleFileSync

final class FileUploadPartTests: XCTestCase {
    func testFileBackedPartsMatchHashesAndCleanUp() throws {
        let size = 8 * 1024 * 1024 + 19, bytes = Data((0..<size).map { UInt8($0 % 251) })
        var calls = 0, largest = 0
        func stream(_ offset: Int64, _ length: Int, _ receive: (Data) throws -> Void) throws -> Int64 {
            calls += 1; largest = max(largest, length)
            for at in stride(from: 0, to: length, by: 65536) {
                let begin = Int(offset) + at
                try receive(bytes.subdata(in: begin..<min(begin + 65536, Int(offset) + length)))
            }
            return Int64(bytes.count)
        }
        let first = try FileUploadPart.capture(size: Int64(size), partNumber: 1, offset: 0, length: 8 * 1024 * 1024, stream: stream)
        XCTAssertEqual(try Data(contentsOf: first.url), bytes.prefix(8 * 1024 * 1024))
        XCTAssertEqual(first.checksumSha256, Data(SHA256.hash(data: bytes.prefix(8 * 1024 * 1024))).base64EncodedString())
        let last = try FileUploadPart.capture(size: Int64(size), partNumber: 2, offset: 8 * 1024 * 1024, length: 19, stream: stream)
        XCTAssertEqual(try Data(contentsOf: last.url), bytes.suffix(19)); XCTAssertEqual(last.sha256, PhotoLibraryReader.hash(bytes.suffix(19)))
        XCTAssertEqual(calls, 2); XCTAssertLessThanOrEqual(largest, MobileFolderReader.maximumStreamBytes)
        let mode = try FileManager.default.attributesOfItem(atPath: first.url.path)[.posixPermissions] as? NSNumber
        XCTAssertEqual(mode?.intValue, 0o600)
        first.discard(); last.discard(); XCTAssertFalse(FileManager.default.fileExists(atPath: first.url.path))
    }
    func testCanonicalBoundariesIncompleteStreamsAndCancellationRefuseParts() async throws {
        XCTAssertThrowsError(try FileUploadPart.capture(size: 4, partNumber: 1, offset: 1, length: 3) { _, _, _ in XCTFail(); return 4 })
        XCTAssertThrowsError(try FileUploadPart.capture(size: 4, partNumber: 2, offset: 0, length: 4) { _, _, _ in XCTFail(); return 4 })
        XCTAssertThrowsError(try FileUploadPart.capture(size: 4, partNumber: 1, offset: 0, length: 4) { _, _, receive in try receive(Data([1,2])); return 4 })
        XCTAssertThrowsError(try FileUploadPart.capture(size: 4, partNumber: 1, offset: 0, length: 4) { _, _, receive in try receive(Data(repeating: 1, count: 5)); return 4 })
        XCTAssertThrowsError(try FileUploadPart.capture(size: 4, partNumber: 1, offset: 0, length: 4) { _, _, receive in try receive(Data(repeating: 1, count: 4)); return 5 })
        let work = Task.detached { withUnsafeCurrentTask { $0?.cancel() }; return try FileUploadPart.capture(size: 4, partNumber: 1, offset: 0, length: 4) { _, _, _ in XCTFail(); return 4 } }
        do { _ = try await work.value; XCTFail("Cancelled capture succeeded") } catch is CancellationError { }
        XCTAssertThrowsError(try FileUploadPart.plan(size: 100 * 1024 * 1024 * 1024 * 1024))
    }
    func testSelectedFolderMutationCannotPublishAPart() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: directory) }
        let original = directory.appendingPathComponent("file.bin"), bytes = Data(repeating: 9, count: 131_072)
        try bytes.write(to: original)
        let bookmark = try FolderBookmark.create(directory), row = try XCTUnwrap(MobileFolderReader.scan(bookmark: bookmark).first)
        let part = try FileUploadPart.capture(size: row.size, partNumber: 1, offset: 0, length: row.size) { offset, length, receive in
            try MobileFolderReader.stream(bookmark: bookmark, path: row.path, version: row.version, offset: offset, length: length, receive: receive)
        }
        XCTAssertEqual(try Data(contentsOf: part.url), bytes); part.discard()
        XCTAssertThrowsError(try FileUploadPart.capture(size: row.size, partNumber: 1, offset: 0, length: row.size) { offset, length, receive in
            try MobileFolderReader.stream(bookmark: bookmark, path: row.path, version: row.version, offset: offset, length: length) { chunk in
                try receive(chunk)
                let handle = try FileHandle(forWritingTo: original); defer { try? handle.close() }
                try handle.seekToEnd(); try handle.write(contentsOf: Data([1]))
            }
        })
    }
    func testLargePartCaptureRemainsChunkBounded() throws {
        // Canonical 33 MiB parts exceed the browser's previous 32 MiB ceiling.
        let mib: Int64 = 1_048_576, size = 32 * mib * 10_000 + 1
        let plan = try FileUploadPart.plan(size: size); XCTAssertEqual(plan.partSize, 33 * mib)
        var calls = 0, digest = SHA256()
        let part = try FileUploadPart.capture(size: size, partNumber: 1, offset: 0, length: plan.partSize) { _, length, receive in
            calls += 1
            for at in stride(from: 0, to: length, by: 65536) {
                let bytes = Data(repeating: 42, count: min(65536, length - at)); digest.update(data: bytes); try receive(bytes)
            }
            return size
        }
        defer { part.discard() }
        XCTAssertEqual(calls, 2); XCTAssertEqual(part.length, 33 * mib)
        XCTAssertEqual(part.checksumSha256, Data(digest.finalize()).base64EncodedString())
    }
}
