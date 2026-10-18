@testable import AppleFileSync
import XCTest
import SQLite3

final class MobileFolderInventoryTests: XCTestCase {
    private func fixture() throws -> (URL, Data, MobileFolderInventory.Scope, URL) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("inventory-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("source")
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        let owner = try FileSyncOwnerScope(ownerId: "fixture", url: URL(string: "https://fixture.invalid")!)
        return (source, try FolderBookmark.create(source), .init(owner: owner, deviceId: "fixture-device", rootId: UUID().uuidString.lowercased()), root.appendingPathComponent("journal"))
    }

    func testLargeCapturePagesReopenAndRetainExactObservation() throws {
        let (source, bookmark, scope, directory) = try fixture()
        for index in 0..<10_001 { try Data().write(to: source.appendingPathComponent("file-\(index)")) }
        let store = MobileFolderInventory(directory: directory), id = UUID().uuidString.lowercased()
        let capture = try store.capture(scope, id: id, bookmark: bookmark)
        XCTAssertEqual(capture.totalEntries, 10_001)
        XCTAssertEqual(try store.capture(scope, id: id, bookmark: bookmark), capture)
        try Data("later edit".utf8).write(to: source.appendingPathComponent("file-0"))
        let reopened = MobileFolderInventory(directory: directory)
        var offset = 0, paths = Set<String>(), pages = 0
        while true {
            let page = try reopened.read(scope, capture: capture, bookmark: bookmark, offset: offset)
            XCTAssertEqual(page.offset, offset); XCTAssertEqual(page.capture, capture)
            XCTAssertLessThanOrEqual(page.entries.count, 128)
            XCTAssertLessThanOrEqual(try JSONEncoder().encode(page).count, MobileFolderInventory.maximumPageBytes)
            for entry in page.entries {
                XCTAssertTrue(paths.insert(entry.path).inserted); XCTAssertEqual(entry.size, 0)
                XCTAssertEqual(entry.sha256, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
            }
            pages += 1
            guard let next = page.nextOffset else { break }
            XCTAssertEqual(next, offset + page.entries.count); offset = next
        }
        XCTAssertEqual(paths.count, 10_001); XCTAssertEqual(pages, 79)
        XCTAssertEqual(paths, Set((0..<10_001).map { "file-\($0)" }))
        try reopened.discard(scope, capture: capture, bookmark: bookmark)
        XCTAssertThrowsError(try reopened.read(scope, capture: capture, bookmark: bookmark, offset: 0))
        let replacement = try reopened.capture(scope, id: id, bookmark: bookmark)
        XCTAssertNotEqual(replacement.generation, capture.generation)
        XCTAssertThrowsError(try reopened.read(scope, capture: capture, bookmark: bookmark, offset: 0))
        XCTAssertEqual(try Data(contentsOf: source.appendingPathComponent("file-0")), Data("later edit".utf8))
    }

    func testEmptyCaptureAndWrongGenerationScopeOrBookmarkRefused() throws {
        let (_, bookmark, scope, directory) = try fixture()
        let store = MobileFolderInventory(directory: directory)
        let capture = try store.capture(scope, id: UUID().uuidString.lowercased(), bookmark: bookmark)
        let page = try store.read(scope, capture: capture, bookmark: bookmark, offset: 0)
        XCTAssertTrue(page.entries.isEmpty); XCTAssertNil(page.nextOffset)
        let wrong = MobileFolderInventory.Capture(id: capture.id, generation: UUID().uuidString, totalEntries: 0)
        XCTAssertThrowsError(try store.read(scope, capture: wrong, bookmark: bookmark, offset: 0))
        let other = MobileFolderInventory.Scope(owner: scope.owner, deviceId: "other-device", rootId: scope.rootId)
        XCTAssertThrowsError(try store.read(other, capture: capture, bookmark: bookmark, offset: 0))
        XCTAssertThrowsError(try store.read(scope, capture: capture, bookmark: Data(), offset: 0))
        XCTAssertThrowsError(try store.read(scope, capture: capture, bookmark: bookmark, offset: 1))
        XCTAssertThrowsError(try store.read(scope, capture: capture, bookmark: bookmark, offset: -1))
    }

    func testLinkAndDuplicateIdentityNeverSeal() throws {
        let (source, bookmark, scope, directory) = try fixture()
        try Data("test".utf8).write(to: source.appendingPathComponent("first"))
        try FileManager.default.linkItem(at: source.appendingPathComponent("first"), to: source.appendingPathComponent("second"))
        let store = MobileFolderInventory(directory: directory), id = UUID().uuidString.lowercased()
        XCTAssertThrowsError(try store.capture(scope, id: id, bookmark: bookmark))
        try FileManager.default.removeItem(at: source.appendingPathComponent("second"))
        try FileManager.default.createSymbolicLink(at: source.appendingPathComponent("second"), withDestinationURL: source.appendingPathComponent("first"))
        XCTAssertThrowsError(try store.capture(scope, id: id, bookmark: bookmark))
        try FileManager.default.removeItem(at: source.appendingPathComponent("second"))
        XCTAssertEqual(try store.capture(scope, id: id, bookmark: bookmark).totalEntries, 1)
    }

    func testStreamingCaptureRechecksEarlierFilesBeforeCompletion() throws {
        let (source, bookmark, _, _) = try fixture()
        try Data("before".utf8).write(to: source.appendingPathComponent("first"))
        var rows: [MobileFolderReader.Entry] = []
        XCTAssertThrowsError(try MobileFolderReader.capture(bookmark: bookmark, append: { row in
            rows.append(row)
            try Data("changed".utf8).write(to: source.appendingPathComponent("first"))
        }, replay: { visit in for row in rows { try visit(row) } }))
    }

    func testAbandonedCaptureEvictionIsBoundedAndOldGenerationRefused() throws {
        let (_, bookmark, scope, directory) = try fixture()
        let store = MobileFolderInventory(directory: directory), firstID = UUID().uuidString.lowercased()
        let first = try store.capture(scope, id: firstID, bookmark: bookmark)
        for _ in 0..<MobileFolderInventory.maximumCaptures {
            _ = try store.capture(scope, id: UUID().uuidString.lowercased(), bookmark: bookmark)
        }
        XCTAssertThrowsError(try store.read(scope, capture: first, bookmark: bookmark, offset: 0))
        let replacement = try store.capture(scope, id: firstID, bookmark: bookmark)
        XCTAssertNotEqual(replacement.generation, first.generation)
        XCTAssertThrowsError(try store.read(scope, capture: first, bookmark: bookmark, offset: 0))
        let buckets = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        let captures = try FileManager.default.contentsOfDirectory(at: XCTUnwrap(buckets.first), includingPropertiesForKeys: nil)
            .filter { UUID(uuidString: $0.lastPathComponent) != nil }
        XCTAssertEqual(captures.count, MobileFolderInventory.maximumCaptures)
    }

    func testTruncatedCaptureAndReplacedDatabaseNeverBecomeCompleteOrEmpty() throws {
        for corrupt in [false, true] {
            let (source, bookmark, scope, directory) = try fixture()
            for i in 0..<3 { try Data().write(to: source.appendingPathComponent("file-\(i)")) }
            let store = MobileFolderInventory(directory: directory)
            let capture = try store.capture(scope, id: UUID().uuidString.lowercased(), bookmark: bookmark)
            let bucket = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).first)
            let file = bucket.appendingPathComponent(capture.id).appendingPathComponent("inventory.sqlite")
            if corrupt { try Data("not a database".utf8).write(to: file) }
            else {
                var db: OpaquePointer?
                XCTAssertEqual(sqlite3_open(file.path, &db), SQLITE_OK)
                XCTAssertEqual(sqlite3_exec(db, "DELETE FROM entries WHERE ordinal = 2", nil, nil, nil), SQLITE_OK)
                sqlite3_close(db)
            }
            XCTAssertThrowsError(try store.read(scope, capture: capture, bookmark: bookmark, offset: 0))
            XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: source.path).count, 3)
        }
    }

    func testCancellationDuringTraversalCannotFinishCapture() async throws {
        let (source, bookmark, scope, directory) = try fixture()
        try Data().write(to: source.appendingPathComponent("file"))
        let work = Task.detached { () throws -> Void in
            var rows: [MobileFolderReader.Entry] = []
            try MobileFolderReader.capture(bookmark: bookmark, append: { row in
                rows.append(row)
                withUnsafeCurrentTask { $0?.cancel() }
            }, replay: { visit in for row in rows { try visit(row) } })
        }
        do { try await work.value; XCTFail("Cancelled capture completed") } catch is CancellationError { }
        let store = MobileFolderInventory(directory: directory)
        XCTAssertEqual(try store.capture(scope, id: UUID().uuidString.lowercased(), bookmark: bookmark).totalEntries, 1)
    }
}
