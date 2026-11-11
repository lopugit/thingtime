@testable import AppleFileSync
import CryptoKit
import XCTest

private final class ReadGuardCapture: @unchecked Sendable {
    private let lock = NSLock()
    private var observed: [MobileFolderBulkReader.ReadGuard] = []
    func record(_ value: MobileFolderBulkReader.ReadGuard) { lock.lock(); observed.append(value); lock.unlock() }
    var values: [MobileFolderBulkReader.ReadGuard] { lock.lock(); defer { lock.unlock() }; return observed }
}

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
    func testReadGuardReportsOnlyProvenFailureWithoutChangingThrownError() throws {
        let (root, bookmark, entry) = try fixture()
        func expect(_ source: MobileFolderReader.Entry, _ guardFailure: MobileFolderBulkReader.ReadGuard,
                    sha256: String? = nil, failure: MobileFolderStore.Failure = .changed) {
            let capture = ReadGuardCapture()
            do { _ = try MobileFolderBulkReader.read(bookmark: bookmark, expected: source, sha256: sha256, observer: capture.record); XCTFail("Source accepted") }
            catch MobileFolderStore.Failure.changed { if case .changed = failure {} else { XCTFail("Wrong error") } }
            catch MobileFolderStore.Failure.invalid { if case .invalid = failure {} else { XCTFail("Wrong error") } }
            catch MobileFolderStore.Failure.limit { if case .limit = failure {} else { XCTFail("Wrong error") } }
            catch { XCTFail("Unexpected error type for \(guardFailure.rawValue): \(type(of: error))") }
            XCTAssertEqual(capture.values, [guardFailure])
        }
        let invalid = MobileFolderReader.Entry(path: entry.path, id: entry.id, version: entry.version, kind: entry.kind,
            size: 262_145, sha256: entry.sha256, fingerprint: entry.fingerprint)
        expect(invalid, .invalidShape, failure: .invalid)
        let older = MobileFolderReader.Entry(path: entry.path, id: entry.id, version: "0:0:0:0:0:0:0", kind: entry.kind,
            size: entry.size, sha256: entry.sha256, fingerprint: entry.fingerprint)
        expect(older, .firstInspectVersion)
        let wrongFingerprint = MobileFolderReader.Entry(path: entry.path, id: entry.id, version: entry.version, kind: entry.kind,
            size: entry.size, sha256: entry.sha256,
            fingerprint: .init(partSizeBytes: entry.fingerprint!.partSizeBytes, partCount: 1, sha256: String(repeating: "0", count: 64)))
        expect(wrongFingerprint, .firstInspectFingerprint)
        expect(entry, .rawDigest, sha256: String(repeating: "0", count: 64))
        try Data("replacement".utf8).write(to: root.appendingPathComponent("file"), options: .atomic)
        expect(entry, .firstInspectIdentity)
        try FileManager.default.removeItem(at: root.appendingPathComponent("file"))
        expect(entry, .firstInspectAbsent)
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
        do {
            // Simulator lookup and exclusive creation can disagree about case aliases.
            // Exclusive creation protects the original on case-insensitive hosts.
            try Data("alias".utf8).write(to: alias, options: .withoutOverwriting)
            XCTAssertThrowsError(try MobileFolderBulkReader.read(bookmark: bookmark, expected: entry))
            try FileManager.default.removeItem(at: alias)
        } catch CocoaError.fileWriteFileExists {
            // Independent case aliases cannot be constructed on this filesystem.
            XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("file")), Data(repeating: 42, count: 131_073))
        }
        try FileManager.default.removeItem(at: root.appendingPathComponent("file"))
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("file"), withDestinationURL: root)
        XCTAssertThrowsError(try MobileFolderBulkReader.read(bookmark: bookmark, expected: entry))
    }
}
