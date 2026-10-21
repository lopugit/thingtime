@testable import AppleFileSync
import CryptoKit
import XCTest

@MainActor final class MobileFolderBulkReaderTests: XCTestCase {
    private func fixture() throws -> (URL, Data, MobileFolderReader.Entry) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        var saved: Data?
        let store = MobileFolderStore(load: { _ in saved }, save: { _, data in saved = data })
        let owner = try FileSyncOwnerScope(ownerId: "test", url: URL(string: "https://sync.test")!)
        try Data(repeating: 42, count: 131_073).write(to: root.appendingPathComponent("file"))
        let grant = try store.add(owner, selected: root)
        return (root, grant.bookmark, try XCTUnwrap(MobileFolderReader.inspect(bookmark: grant.bookmark, path: "file")))
    }
    func testRealBoundedFileAndFinalDigestFence() throws {
        let (root, bookmark, entry) = try fixture()
        let payload = try MobileFolderBulkReader.read(bookmark: bookmark, expected: entry)
        XCTAssertEqual(payload.bytes.count, 131_073)
        XCTAssertEqual(try MobileFolderBulkReader.read(bookmark: bookmark, expected: entry, sha256: payload.sha256).sha256, payload.sha256)
        XCTAssertThrowsError(try MobileFolderBulkReader.read(bookmark: bookmark, expected: entry, sha256: String(repeating: "0", count: 64)))
        try Data("replacement".utf8).write(to: root.appendingPathComponent("file"), options: .atomic)
        XCTAssertThrowsError(try MobileFolderBulkReader.read(bookmark: bookmark, expected: entry, sha256: payload.sha256))
    }
    func testAliasesAndResourceBoundsFailClosed() throws {
        let (_, _, entry) = try fixture()
        XCTAssertThrowsError(try MobileFolderBulkReader.validate([]))
        XCTAssertThrowsError(try MobileFolderBulkReader.validate(Array(repeating: entry, count: 257)))
        let alias = MobileFolderReader.Entry(path: "FILE", id: "other", version: entry.version, kind: "file", size: entry.size, sha256: nil, fingerprint: entry.fingerprint)
        XCTAssertThrowsError(try MobileFolderBulkReader.validate([entry, alias]))
        let sameIdentity = MobileFolderReader.Entry(path: "other", id: entry.id, version: entry.version, kind: "file", size: entry.size, sha256: nil, fingerprint: entry.fingerprint)
        XCTAssertThrowsError(try MobileFolderBulkReader.validate([entry, sameIdentity]))
        let tooBig = MobileFolderReader.Entry(path: "other", id: "other", version: entry.version, kind: "file", size: 262_145, sha256: nil, fingerprint: entry.fingerprint)
        XCTAssertThrowsError(try MobileFolderBulkReader.validate([tooBig]))
        let maximum = (0..<129).map { MobileFolderReader.Entry(path: "bounded-\($0)", id: "inode-\($0)", version: entry.version, kind: "file", size: 262_144, sha256: nil, fingerprint: entry.fingerprint) }
        XCTAssertNoThrow(try MobileFolderBulkReader.validate(Array(maximum.prefix(128))))
        XCTAssertThrowsError(try MobileFolderBulkReader.validate(maximum))
    }
    func testNewCaseAliasAndSymlinkReplacementRefuseExistingSource() throws {
        let (root, bookmark, entry) = try fixture()
        // A canonical alias is detected on case-sensitive test filesystems.
        let alias = root.appendingPathComponent("FILE")
        if !FileManager.default.fileExists(atPath: alias.path) {
            try Data("alias".utf8).write(to: alias)
            XCTAssertThrowsError(try MobileFolderBulkReader.read(bookmark: bookmark, expected: entry))
            try FileManager.default.removeItem(at: alias)
        }
        try FileManager.default.removeItem(at: root.appendingPathComponent("file"))
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("file"), withDestinationURL: root)
        XCTAssertThrowsError(try MobileFolderBulkReader.read(bookmark: bookmark, expected: entry))
    }
}
