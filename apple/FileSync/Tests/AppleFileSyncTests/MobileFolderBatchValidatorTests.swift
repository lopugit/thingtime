@testable import AppleFileSync
import XCTest

@MainActor final class MobileFolderBatchValidatorTests: XCTestCase {
    func testFullStampDriftAndSymlinkReplacementFailClosed() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root.appendingPathComponent("deep/parent"), withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let bookmark = try FolderBookmark.create(root)
        let entry = try XCTUnwrap(MobileFolderReader.inspect(bookmark: bookmark, path: "deep/parent"))
        XCTAssertNoThrow(try MobileFolderBatchValidator.check(bookmark: bookmark, expected: entry))
        try Data("child".utf8).write(to: root.appendingPathComponent("deep/parent/child"))
        let updated = try XCTUnwrap(MobileFolderReader.inspect(bookmark: bookmark, path: "deep/parent"))
        XCTAssertEqual(updated.id, entry.id); XCTAssertNotEqual(updated.version, entry.version)
        XCTAssertThrowsError(try MobileFolderBatchValidator.check(bookmark: bookmark, expected: entry))
        XCTAssertNoThrow(try MobileFolderBatchValidator.check(bookmark: bookmark, expected: updated))
        try FileManager.default.removeItem(at: root.appendingPathComponent("deep/parent"))
        // A sparse regular-file replacement is rejected by O_DIRECTORY before
        // generic inspect could hash any of its content.
        let replacement = root.appendingPathComponent("deep/parent")
        XCTAssertTrue(FileManager.default.createFile(atPath: replacement.path, contents: nil))
        let handle = try FileHandle(forWritingTo: replacement)
        try handle.truncate(atOffset: 1_073_741_824); try handle.close()
        XCTAssertThrowsError(try MobileFolderReader.inspectFolder(bookmark: bookmark, path: "deep/parent"))
        XCTAssertThrowsError(try MobileFolderBatchValidator.check(bookmark: bookmark, expected: updated))
        try FileManager.default.removeItem(at: replacement)
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("deep/parent"), withDestinationURL: root)
        XCTAssertThrowsError(try MobileFolderBatchValidator.check(bookmark: bookmark, expected: updated))
    }
    func testStructuralBoundsAliasesAndFilesAreRefused() throws {
        let entry = MobileFolderReader.Entry(path: "a", id: "inode", version: "full", kind: "folder", size: 0, sha256: nil, fingerprint: nil)
        XCTAssertNoThrow(try MobileFolderBatchValidator.validate([entry]))
        XCTAssertThrowsError(try MobileFolderBatchValidator.validate([]))
        XCTAssertThrowsError(try MobileFolderBatchValidator.validate(Array(repeating: entry, count: 257)))
        let alias = MobileFolderReader.Entry(path: "A", id: "other", version: "full", kind: "folder", size: 0, sha256: nil, fingerprint: nil)
        XCTAssertThrowsError(try MobileFolderBatchValidator.validate([entry, alias]))
        let file = MobileFolderReader.Entry(path: "b", id: "other", version: "full", kind: "file", size: 0, sha256: nil, fingerprint: nil)
        XCTAssertThrowsError(try MobileFolderBatchValidator.validate([file]))
    }
}
