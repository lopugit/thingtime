#if os(macOS)
@testable import AppleFileSync
import XCTest
import Darwin

final class CommanderBackupCaptureTests: XCTestCase {
    private func helper() throws -> URL {
        guard let path = ProcessInfo.processInfo.environment["THINGTIME_TEST_COMMANDER_INDEXER"] else {
            throw XCTSkip("Run macos/ThingtimeNode/scripts/test-commander-backup.sh to test the real Rust helper.")
        }
        XCTAssertTrue(FileManager.default.isExecutableFile(atPath: path)); return URL(fileURLWithPath: path)
    }
    private func fixture() throws -> (URL, URL, Data, MobileFolderInventory.Scope) {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent("commander-backup-" + UUID().uuidString)
        let source = base.appendingPathComponent("source")
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: base) }
        let owner = try FileSyncOwnerScope(ownerId: "fixture", url: URL(string: "https://fixture.invalid")!)
        return (base, source, try FolderBookmark.create(source), .init(owner: owner, deviceId: "fixture", rootId: UUID().uuidString.lowercased()))
    }
    func testRealRustCaptureMatchesSwiftContentAndGitignorePolicy() throws {
        let helper = try helper(), (base, source, bookmark, scope) = try fixture()
        for name in ["project/node_modules/deep", "Library", "keep/sub", "NODE_MODULES"] {
            try FileManager.default.createDirectory(at: source.appendingPathComponent(name), withIntermediateDirectories: true)
        }
        for name in ["project/node_modules/deep/ignored", "Library/ignored", "keep/sub/empty", "NODE_MODULES/kept", "keep/drop.tmp", "keep/keep.tmp", "cafe\u{301}.txt", "secret"] {
            try Data().write(to: source.appendingPathComponent(name))
        }
        try Data("secret\n".utf8).write(to: source.appendingPathComponent(".gitignore"))
        try Data(repeating: 0x63, count: 8 * 1_048_576 + 17).write(to: source.appendingPathComponent("keep/multipart"))
        let rules = "node_modules/\n*.tmp\n!keep.tmp\n/café.txt\n!Library/\n"
        let expected = try MobileFolderReader.scan(bookmark: bookmark, excludedPaths: ["Library"], ignoreRules: rules)
        let store = MobileFolderInventory(directory: base.appendingPathComponent("cache"), commanderIndexer: helper)
        let capture = try store.prepareBackup(scope, id: UUID().uuidString.lowercased(), generation: UUID().uuidString.lowercased(), bookmark: bookmark, excludedPaths: ["Library"], ignoreRules: rules)
        XCTAssertEqual(capture.coverage, "full"); XCTAssertEqual(capture.totalSkipped, 0)
        XCTAssertThrowsError(try store.read(scope, capture: capture, bookmark: bookmark, offset: 0, ignoreRules: rules), "Provisional Rust rows are private until authorized sealing")
        try store.sealBackup(scope, capture: capture, bookmark: bookmark)
        let actual = try store.read(scope, capture: capture, bookmark: bookmark, offset: 0, ignoreRules: rules).entries
        XCTAssertEqual(Dictionary(uniqueKeysWithValues: actual.map { ($0.path, $0) }), Dictionary(uniqueKeysWithValues: expected.map { ($0.path, $0) }))
    }
    func testRealRustSpecialFilesAndCollisionLedgerStayPartial() throws {
        let helper = try helper(), (base, source, bookmark, scope) = try fixture()
        try Data("hello".utf8).write(to: source.appendingPathComponent("good"))
        try FileManager.default.linkItem(at: source.appendingPathComponent("good"), to: source.appendingPathComponent("alias"))
        try FileManager.default.createSymbolicLink(at: source.appendingPathComponent("outside"), withDestinationURL: base)
        XCTAssertEqual(mkfifo(source.appendingPathComponent("pipe").path, 0o600), 0)
        let store = MobileFolderInventory(directory: base.appendingPathComponent("cache"), commanderIndexer: helper)
        let capture = try store.prepareBackup(scope, id: UUID().uuidString.lowercased(), generation: UUID().uuidString.lowercased(), bookmark: bookmark)
        XCTAssertEqual(capture.coverage, "partial"); XCTAssertEqual(capture.totalEntries, 1); XCTAssertEqual(capture.totalSkipped, 3)
        try store.sealBackup(scope, capture: capture, bookmark: bookmark)
        let gaps = try store.readSkipped(scope, capture: capture, bookmark: bookmark, offset: 0).skipped
        XCTAssertEqual(Set(gaps.map(\.reason.rawValue)), ["duplicate-identity", "symlink", "fifo"])
    }
    func testProcessFailureCannotSealOrBecomeEmptySuccess() throws {
        let (base, _, bookmark, scope) = try fixture()
        let script = base.appendingPathComponent("failed-helper")
        try Data("#!/bin/sh\nprintf '%s\\n' '{\"event\":\"hello\",\"version\":1}'\nexit 1\n".utf8).write(to: script)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: script.path)
        let store = MobileFolderInventory(directory: base.appendingPathComponent("cache"), commanderIndexer: script), id = UUID().uuidString.lowercased()
        XCTAssertThrowsError(try store.prepareBackup(scope, id: id, generation: UUID().uuidString.lowercased(), bookmark: bookmark))
        XCTAssertEqual(try store.backupStatus(scope, id: id, bookmark: bookmark)?.state, "interrupted")
    }
    func testNestedDirectoryChangeIsAReportedCoverageGap() throws {
        final class Once: @unchecked Sendable {
            var done = false
        }
        let helper = try helper(), (base, source, bookmark, scope) = try fixture()
        let nested = source.appendingPathComponent("nested")
        try FileManager.default.createDirectory(at: nested, withIntermediateDirectories: true)
        for i in 0..<1500 { try Data().write(to: nested.appendingPathComponent("file-\(i)")) }
        let store = MobileFolderInventory(directory: base.appendingPathComponent("cache"), commanderIndexer: helper), once = Once()
        let capture = try store.prepareBackup(scope, id: UUID().uuidString.lowercased(), generation: UUID().uuidString.lowercased(), bookmark: bookmark, progress: { count, _ in
            if count > 0 && !once.done { once.done = true; try! Data().write(to: nested.appendingPathComponent("created-during-scan")) }
        })
        XCTAssertEqual(capture.coverage, "partial")
        try store.sealBackup(scope, capture: capture, bookmark: bookmark)
        let gaps = try store.readSkipped(scope, capture: capture, bookmark: bookmark, offset: 0).skipped
        XCTAssertTrue(gaps.contains { $0.path == "nested" && $0.scope == .subtree && $0.reason == .changed })
    }
    func testCancellationTerminatesUnresponsiveHelper() async throws {
        let (base, _, bookmark, scope) = try fixture()
        let script = base.appendingPathComponent("waiting-helper")
        // Close stdout but remain alive and ignore TERM: both exit paths must
        // stay cancellable. The shell itself loops, so there is no orphan child.
        try Data("#!/bin/sh\ntrap '' TERM\nexec 1>&-\nwhile :; do :; done\n".utf8).write(to: script)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: script.path)
        let store = MobileFolderInventory(directory: base.appendingPathComponent("cache"), commanderIndexer: script), id = UUID().uuidString.lowercased()
        let task = Task.detached { try store.prepareBackup(scope, id: id, generation: UUID().uuidString.lowercased(), bookmark: bookmark) }
        try await Task.sleep(for: .milliseconds(150)); task.cancel()
        let started = Date()
        do { _ = try await task.value; XCTFail("Cancelled capture succeeded") } catch is CancellationError {} catch { XCTFail("Wrong cancellation: \(error)") }
        XCTAssertLessThan(Date().timeIntervalSince(started), 3)
        XCTAssertEqual(try store.backupStatus(scope, id: id, bookmark: bookmark)?.state, "interrupted")
    }
}
#endif
