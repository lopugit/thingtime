import XCTest
import CryptoKit
@testable import AppleFileSync

final class FileVersionExportTests: XCTestCase {
    private func request(_ bytes: Data, name: String = "history.bin") throws -> FileVersionExport.Request {
        let partSize = 8 * 1024 * 1024
        var parts = Data()
        for offset in stride(from: 0, to: bytes.count, by: partSize) {
            parts.append(contentsOf: SHA256.hash(data: bytes.subdata(in: offset..<min(bytes.count, offset + partSize))))
        }
        let digest = SHA256.hash(data: parts).map { String(format: "%02x", $0) }.joined()
        let fingerprint: [String: Any] = [
            "algorithm": "sha256-parts-v1",
            "partSizeBytes": partSize,
            "partCount": (bytes.count + partSize - 1) / partSize,
            "sha256": digest,
        ]
        let content: [String: Any] = [
            "attachmentId": "attachment-1",
            "version": String(repeating: "a", count: 64),
            "size": bytes.count,
            "fingerprint": fingerprint,
        ]
        let json: [String: Any] = ["name": name, "content": content]
        return try JSONDecoder().decode(FileVersionExport.Request.self, from: JSONSerialization.data(withJSONObject: json))
    }
    private func directory() throws -> URL {
        let value = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: value, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: value) }; return value
    }
    func testMultiPartRangeExportPreservesExistingFilesAndSymlinks() async throws {
        let bytes = Data((0..<(8 * 1024 * 1024 + 17)).map { UInt8($0 % 251) }), root = try directory()
        let privateRoot = root.appendingPathComponent("private"), destination = root.appendingPathComponent("saved")
        try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
        let existing = destination.appendingPathComponent("history.bin"), link = destination.appendingPathComponent("history (1).bin")
        try Data([77]).write(to: existing)
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: existing)
        var prepared: FileVersionExport.Prepared? = try await .download(request(bytes), privateDirectory: privateRoot) { offset, length in
            XCTAssertLessThanOrEqual(length, 2 * 1024 * 1024)
            return bytes.subdata(in: Int(offset)..<Int(offset) + length)
        }
        XCTAssertEqual(try prepared!.save(into: destination), "history (2).bin")
        XCTAssertEqual(try Data(contentsOf: destination.appendingPathComponent("history (2).bin")), bytes)
        XCTAssertEqual(try Data(contentsOf: existing), Data([77]))
        XCTAssertEqual(try FileManager.default.destinationOfSymbolicLink(atPath: link.path), existing.path)
        prepared = nil
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: privateRoot.path), [])
        XCTAssertFalse(try FileManager.default.contentsOfDirectory(atPath: destination.path).contains { $0.hasPrefix(".thingtime-export-") })
    }
    func testCorruptTruncatedAndOversizedRangesRefuseAndCleanPrivateBytes() async throws {
        let bytes = Data(repeating: 1, count: 33), root = try directory(), input = try request(bytes)
        for invalid in [Data(repeating: 2, count: 33), Data(repeating: 1, count: 32), Data(repeating: 1, count: 34)] {
            do { _ = try await FileVersionExport.Prepared.download(input, privateDirectory: root) { _, _ in invalid }; XCTFail("Accepted corrupt range") }
            catch { }
            XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: root.path), [])
        }
    }
    func testCancellationBeforePublicationLeavesDestinationUntouched() async throws {
        let bytes = Data(repeating: 5, count: 33), root = try directory(), destination = try directory()
        let prepared = try await FileVersionExport.Prepared.download(request(bytes), privateDirectory: root) { _, _ in bytes }
        XCTAssertThrowsError(try prepared.save(into: destination, check: { throw CancellationError() }))
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: destination.path), [])
        let worker = Task { () throws -> String in
            withUnsafeCurrentTask { $0?.cancel() }
            return try prepared.save(into: destination)
        }
        do { _ = try await worker.value; XCTFail("Cancelled save succeeded") } catch { }
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: destination.path), [])
    }
    func testAuthorizationLostAfterCopyRemovesUnpublishedCandidate() async throws {
        let bytes = Data(repeating: 5, count: 33), root = try directory(), destination = try directory()
        let prepared = try await FileVersionExport.Prepared.download(request(bytes), privateDirectory: root) { _, _ in bytes }
        var revokedAfterCopy = false
        XCTAssertThrowsError(try prepared.save(into: destination, check: {
            let candidates = try FileManager.default.contentsOfDirectory(at: destination, includingPropertiesForKeys: nil)
            if candidates.contains(where: { (try? Data(contentsOf: $0)) == bytes }) {
                revokedAfterCopy = true
                throw CancellationError()
            }
        }))
        XCTAssertTrue(revokedAfterCopy)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: destination.path), [])
    }
    func testInvalidNamesFingerprintAndRangeFramingRefuse() throws {
        let bytes = Data([1]), valid = try request(bytes)
        for name in ["../escape", "a/b", "a\\b", "\u{0}bad", ".", "..", " "] { XCTAssertThrowsError(try request(bytes, name: name).validate()) }
        XCTAssertThrowsError(try request(Data()).validate())
        let url = URL(string: "https://example.com/api/v1/attachments/content")!
        let headers = ["ETag": "\"" + valid.content.version + "\"", "Content-Range": "bytes 0-0/1", "Content-Length": "1"]
        try valid.validateRange(HTTPURLResponse(url: url, statusCode: 206, httpVersion: nil, headerFields: headers)!, offset: 0, length: 1)
        for key in headers.keys {
            var invalid = headers; invalid[key] = "wrong"
            XCTAssertThrowsError(try valid.validateRange(HTTPURLResponse(url: url, statusCode: 206, httpVersion: nil, headerFields: invalid)!, offset: 0, length: 1))
        }
        XCTAssertThrowsError(try valid.validateRange(HTTPURLResponse(url: url, statusCode: 302, httpVersion: nil, headerFields: headers)!, offset: 0, length: 1))
        XCTAssertThrowsError(try valid.rangePath(offset: 1, length: 1))
        XCTAssertThrowsError(try valid.matchFingerprint(Data("{}".utf8)))
    }
}
