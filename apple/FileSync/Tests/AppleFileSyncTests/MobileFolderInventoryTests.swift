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

    func testExclusionsPruneBeforeOpeningAndPreserveExactPathBoundaries() throws {
        let (source, bookmark, scope, directory) = try fixture()
        // Each excluded subtree contains a symlink the reader must never open.
        // The included sibling proves exclusions are exact paths, not prefixes.
        for name in ["Library", ".Trash", "Café", "keep"] {
            try FileManager.default.createDirectory(at: source.appendingPathComponent(name), withIntermediateDirectories: true)
            try FileManager.default.createSymbolicLink(at: source.appendingPathComponent(name + "/blocked"),
                withDestinationURL: source.appendingPathComponent("missing"))
        }
        try FileManager.default.createSymbolicLink(at: source.appendingPathComponent("Applications"),
            withDestinationURL: source.appendingPathComponent("missing"))
        try Data("included".utf8).write(to: source.appendingPathComponent("Library-copy"))
        try Data().write(to: source.appendingPathComponent("keep/file"))
        let exclusions = ["library", "APPLICATIONS", ".Trash", "CAFE\u{301}", "keep/blocked"]
        let small = try MobileFolderReader.scan(bookmark: bookmark, excludedPaths: exclusions)
        XCTAssertEqual(Set(small.map(\.path)), ["Library-copy", "keep", "keep/file"])
        let store = MobileFolderInventory(directory: directory), id = UUID().uuidString.lowercased()
        let capture = try store.capture(scope, id: id, bookmark: bookmark, excludedPaths: exclusions)
        let page = try store.read(scope, capture: capture, bookmark: bookmark, offset: 0)
        XCTAssertEqual(Set(page.entries.map(\.path)), Set(small.map(\.path)))
        XCTAssertEqual(capture.totalEntries, 3)
        XCTAssertEqual(try store.capture(scope, id: id, bookmark: bookmark, excludedPaths: exclusions.reversed()), capture)
        XCTAssertThrowsError(try store.capture(scope, id: id, bookmark: bookmark, excludedPaths: []))
        XCTAssertThrowsError(try MobileFolderReader.scan(bookmark: bookmark))
        XCTAssertThrowsError(try store.capture(scope, id: UUID().uuidString.lowercased(), bookmark: bookmark))
    }

    func testFailedCaptureCannotRetryWithAnotherExclusionPolicy() throws {
        let (source, bookmark, scope, directory) = try fixture()
        try FileManager.default.createSymbolicLink(at: source.appendingPathComponent("blocked"),
            withDestinationURL: source.appendingPathComponent("missing"))
        let store = MobileFolderInventory(directory: directory), id = UUID().uuidString.lowercased()
        XCTAssertThrowsError(try store.capture(scope, id: id, bookmark: bookmark))
        XCTAssertThrowsError(try store.capture(scope, id: id, bookmark: bookmark, excludedPaths: ["blocked"]))
        let next = try store.capture(scope, id: UUID().uuidString.lowercased(), bookmark: bookmark, excludedPaths: ["blocked"])
        XCTAssertEqual(next.totalEntries, 0)
    }

    func testExclusionsValidateBeforeOpeningTheGrant() throws {
        for paths in [["../escape"], ["/absolute"], ["Library", "LIBRARY"], [""],
                      Array(repeating: "path", count: 101),
                      (0..<100).map { String(repeating: "x", count: 180) + String($0) }] {
            XCTAssertThrowsError(try MobileFolderReader.canonicalExclusions(paths))
            XCTAssertThrowsError(try MobileFolderReader.scan(bookmark: Data(), excludedPaths: paths))
        }
        XCTAssertEqual(try MobileFolderReader.canonicalExclusions(["Library", "keep/file"]), ["keep/file", "library"])
        XCTAssertEqual(try MobileFolderReader.canonicalExclusions(["*.tmp"]), ["*.tmp"])
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
        XCTAssertThrowsError(try store.capture(scope, id: id, bookmark: bookmark)) { error in
            XCTAssertEqual((error as? MobileFolderReader.ScanFailure)?.reason, .duplicateIdentity)
            XCTAssertTrue(["first", "second"].contains((error as? MobileFolderReader.ScanFailure)?.path ?? ""))
        }
        try FileManager.default.removeItem(at: source.appendingPathComponent("second"))
        try FileManager.default.createSymbolicLink(at: source.appendingPathComponent("second"), withDestinationURL: source.appendingPathComponent("first"))
        XCTAssertThrowsError(try store.capture(scope, id: id, bookmark: bookmark)) { error in
            XCTAssertEqual((error as? MobileFolderReader.ScanFailure)?.reason, .symlink)
            XCTAssertEqual((error as? MobileFolderReader.ScanFailure)?.path, "second")
        }
        let bucket = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).first)
        let record = try Data(contentsOf: bucket.appendingPathComponent(id).appendingPathComponent("record.json"))
        XCTAssertEqual((try JSONSerialization.jsonObject(with: record) as? [String: Any])?["complete"] as? Bool, false)
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
        }, replay: { visit in for row in rows { try visit(row) } })) { error in
            XCTAssertEqual((error as? MobileFolderReader.ScanFailure)?.reason, .changed)
            XCTAssertEqual((error as? MobileFolderReader.ScanFailure)?.path, "first")
        }
    }


    func testRootDirectoryChangeKeepsOriginalFailureWithoutInventingAPath() throws {
        let (source, bookmark, _, _) = try fixture()
        try Data().write(to: source.appendingPathComponent("first"))
        var rows: [MobileFolderReader.Entry] = [], changed = false
        XCTAssertThrowsError(try MobileFolderReader.capture(bookmark: bookmark, append: { row in
            rows.append(row)
            if !changed {
                changed = true
                try Data().write(to: source.appendingPathComponent("added-during-capture"))
            }
        }, replay: { visit in for row in rows { try visit(row) } })) { error in
            XCTAssertNil(error as? MobileFolderReader.ScanFailure)
            guard case MobileFolderStore.Failure.changed = error else {
                return XCTFail("Expected original root changed failure")
            }
        }
    }

    func testScanDiagnosticsRejectLinksSpecialAndInvalidPathsWithoutReadingTargets() throws {
        let (source, bookmark, _, _) = try fixture()
        let outside = source.deletingLastPathComponent().appendingPathComponent("outside")
        XCTAssertEqual(mkfifo(outside.path, 0o600), 0)
        try FileManager.default.createSymbolicLink(at: source.appendingPathComponent("link"), withDestinationURL: outside)
        // A followed FIFO would block. The diagnostic is about the link itself.
        XCTAssertThrowsError(try MobileFolderReader.scan(bookmark: bookmark)) { error in
            XCTAssertEqual((error as? MobileFolderReader.ScanFailure)?.reason, .symlink)
            XCTAssertEqual((error as? MobileFolderReader.ScanFailure)?.path, "link")
        }
        try FileManager.default.removeItem(at: source.appendingPathComponent("link"))
        XCTAssertEqual(mkfifo(source.appendingPathComponent("pipe").path, 0o600), 0)
        XCTAssertThrowsError(try MobileFolderReader.scan(bookmark: bookmark)) { error in
            XCTAssertEqual((error as? MobileFolderReader.ScanFailure)?.reason, .special)
            XCTAssertEqual((error as? MobileFolderReader.ScanFailure)?.path, "pipe")
        }
        try FileManager.default.removeItem(at: source.appendingPathComponent("pipe"))
        try Data().write(to: source.appendingPathComponent("bad\\name"))
        XCTAssertThrowsError(try MobileFolderReader.scan(bookmark: bookmark)) { error in
            XCTAssertEqual((error as? MobileFolderReader.ScanFailure)?.reason, .invalidPath)
            XCTAssertNil((error as? MobileFolderReader.ScanFailure)?.path)
        }
        let diagnostic = MobileFolderReader.ScanFailure(reason: .unreadable, path: "../private")
        let fields = try JSONSerialization.jsonObject(with: JSONEncoder().encode(diagnostic)) as! [String: Any]
        XCTAssertEqual(fields["reason"] as? String, "invalid-path"); XCTAssertTrue(fields["path"] is NSNull)
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
