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
    func testStreamingFirstPageIsDurableWhileIndexerPausedAndLegacyPagesStayPrivate() async throws {
        let (base, source, bookmark, scope) = try fixture()
        try Data("first".utf8).write(to: source.appendingPathComponent("first"))
        try Data("pending".utf8).write(to: source.appendingPathComponent("pending"))
        let scanned = try MobileFolderReader.scan(bookmark: bookmark)
        let entry = try XCTUnwrap(scanned.first { $0.path == "first" })
        let queued = try XCTUnwrap(scanned.first { $0.path == "pending" })
        let queuedEvent = String(decoding: try JSONEncoder().encode(queued), as: UTF8.self)
        let event = String(decoding: try JSONEncoder().encode(entry), as: UTF8.self)
        let gate = base.appendingPathComponent("continue"), script = base.appendingPathComponent("stream-helper")
        let text = "#!/bin/sh\n/usr/bin/read request\nprintf '%s\\n' '{\"event\":\"hello\",\"version\":1,\"streaming\":true}' '{\"event\":\"entry\",\"entry\":\(event)}' '{\"event\":\"entry\",\"entry\":\(queuedEvent)}'\nwhile [ ! -f '\(gate.path)' ]; do /bin/sleep 0.05; done\n/bin/cat '\(gate.path)'\nprintf '%s\\n' '{\"event\":\"complete\"}'\n"
        try Data(text.utf8).write(to: script)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: script.path)
        let inventory = MobileFolderInventory(directory: base.appendingPathComponent("stream-cache"), commanderIndexer: script)
        let id = UUID().uuidString.lowercased()
        let initial = try inventory.beginStream(scope, id: id, bookmark: bookmark, excludedPaths: [], ignoreRules: nil)
        XCTAssertEqual(initial.revision, 0)
        let ready = expectation(description: "first eligible row committed")
        ready.expectedFulfillmentCount = 2 // First entry + timer-flushed pending entry before helper resumes.
        ready.assertForOverFulfill = false
        let scanner = Task.detached {
            try inventory.runStream(scope, id: id, bookmark: bookmark, excludedPaths: [], ignoreRules: nil, wake: { ready.fulfill() })
        }
        defer { try? Data().write(to: gate); scanner.cancel() }
        await fulfillment(of: [ready], timeout: 5)
        // Reopen the cache, proving this is committed disk state, not a callback buffer.
        let reopened = MobileFolderInventory(directory: base.appendingPathComponent("stream-cache"), commanderIndexer: script)
        let page = try reopened.streamChanges(scope, id: id, bookmark: bookmark, excludedPaths: [], ignoreRules: nil, afterSequence: 0)
        XCTAssertEqual(page.state, "running"); XCTAssertEqual(page.generation, initial.generation)
        XCTAssertEqual(page.changes.map(\.entry.path), ["first", "pending"]); XCTAssertEqual(page.nextSequence, 2)
        XCTAssertThrowsError(try reopened.streamChanges(scope, id: id, bookmark: bookmark, excludedPaths: ["first"], ignoreRules: nil, afterSequence: 0))
        try Data("updated".utf8).write(to: source.appendingPathComponent("first"))
        let updated = try XCTUnwrap(MobileFolderReader.scan(bookmark: bookmark).first { $0.path == "first" })
        let update = String(decoding: try JSONEncoder().encode(updated), as: UTF8.self)
        try Data(("{\"event\":\"entry\",\"entry\":\(update)}\n").utf8).write(to: gate)
        try await scanner.value
        let next = try inventory.streamChanges(scope, id: id, bookmark: bookmark, excludedPaths: [], ignoreRules: nil, afterSequence: 2)
        XCTAssertEqual(next.changes.count, 1); XCTAssertEqual(next.nextSequence, 3)
        XCTAssertEqual(next.totalEntries, 2)
        XCTAssertNotEqual(next.changes.first?.revision, page.changes.first?.revision)
        try inventory.finishStream(scope, id: id, bookmark: bookmark, state: "interrupted")
        XCTAssertEqual(try inventory.streamChanges(scope, id: id, bookmark: bookmark, excludedPaths: [], ignoreRules: nil, afterSequence: 3).state, "interrupted")
    }
    func testRealRustStreamingFeedRetainsGenerationAndSkipsUnsupportedEntries() throws {
        let helper = try helper(), (base, source, bookmark, scope) = try fixture()
        try FileManager.default.createDirectory(at: source.appendingPathComponent("folder"), withIntermediateDirectories: true)
        try Data("payload".utf8).write(to: source.appendingPathComponent("folder/file"))
        try FileManager.default.createSymbolicLink(at: source.appendingPathComponent("outside"), withDestinationURL: base)
        let inventory = MobileFolderInventory(directory: base.appendingPathComponent("feed"), commanderIndexer: helper)
        let id = UUID().uuidString.lowercased()
        let initial = try inventory.beginStream(scope, id: id, bookmark: bookmark, excludedPaths: [], ignoreRules: nil)
        try inventory.runStream(scope, id: id, bookmark: bookmark, excludedPaths: [], ignoreRules: nil, wake: {})
        try inventory.finishStream(scope, id: id, bookmark: bookmark, state: "complete")
        let page = try inventory.streamChanges(scope, id: id, bookmark: bookmark, excludedPaths: [], ignoreRules: nil, afterSequence: 0)
        XCTAssertEqual(page.generation, initial.generation); XCTAssertEqual(page.state, "complete")
        XCTAssertEqual(Set(page.changes.map(\.entry.path)), ["folder", "folder/file"])
        XCTAssertEqual(page.totalEntries, 2); XCTAssertEqual(page.totalSkipped, 1)
        XCTAssertEqual(page.nextSequence, 2); XCTAssertFalse(page.hasMore)
        XCTAssertEqual(try inventory.beginStream(scope, id: id, bookmark: bookmark, excludedPaths: [], ignoreRules: nil).generation, initial.generation)
    }
    func testProductionDirectoryRevisionsRemainDurableAndMatchNativeFullStamp() async throws {
        let helper = try helper(), (base, source, bookmark, scope) = try fixture()
        let folder = source.appendingPathComponent("visited")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try Data("seed".utf8).write(to: folder.appendingPathComponent("seed"))
        // Keep initial traversal active after the first folder observation.
        let slow = source.appendingPathComponent("zz-slow.bin")
        XCTAssertTrue(FileManager.default.createFile(atPath: slow.path, contents: nil))
        let handle = try FileHandle(forWritingTo: slow)
        try handle.truncate(atOffset: 64 * 1024 * 1024); try handle.close()
        let cache = base.appendingPathComponent("directory-feed")
        let inventory = MobileFolderInventory(directory: cache, commanderIndexer: helper)
        let id = UUID().uuidString.lowercased(), control = MobileFolderInventory.StreamControl()
        let wake = DispatchSemaphore(value: 0)
        let initial = try inventory.beginStream(scope, id: id, bookmark: bookmark, excludedPaths: [], ignoreRules: nil)
        let scanner = Task.detached {
            try inventory.runStream(scope, id: id, bookmark: bookmark, excludedPaths: [], ignoreRules: nil,
                control: control, wake: { wake.signal() }, authorize: { try Task.checkCancellation() })
            try inventory.finishStream(scope, id: id, bookmark: bookmark, state: "complete")
            wake.signal()
        }
        defer { scanner.cancel() }
        var rows: [MobileFolderInventory.Change] = [], cursor = 0, state = "running"
        func drain() throws {
            var more = true
            while more {
                let page = try inventory.streamChanges(scope, id: id, bookmark: bookmark, excludedPaths: [], ignoreRules: nil, afterSequence: cursor)
                XCTAssertEqual(page.generation, initial.generation)
                rows += page.changes; cursor = page.nextSequence; state = page.state; more = page.hasMore
            }
        }
        // Reads occur only after a producer wake, never on a timer/poll loop.
        func awaitChange(_ condition: () -> Bool) throws {
            let deadline = DispatchTime.now() + 10
            while !condition() {
                guard wake.wait(timeout: deadline) == .success else {
                    XCTFail("No expected directory revision before bounded deadline")
                    throw NSError(domain: "directory-feed-timeout", code: 1)
                }
                try drain()
            }
        }
        try awaitChange { rows.contains { $0.entry.path == "visited" } }
        let a = try XCTUnwrap(rows.first { $0.entry.path == "visited" })
        XCTAssertEqual(state, "running")
        let child = folder.appendingPathComponent("added")
        try Data("new child".utf8).write(to: child)
        let b = try XCTUnwrap(MobileFolderReader.inspect(bookmark: bookmark, path: "visited"))
        XCTAssertEqual(a.entry.id, b.id); XCTAssertNotEqual(a.entry.version, b.version)
        try awaitChange { rows.contains { $0.entry.path == "visited" && $0.entry.version == b.version } && state == "indexed" }
        // Initial traversal has ended, but the backlog watcher is still live.
        try FileManager.default.removeItem(at: child)
        let c = try XCTUnwrap(MobileFolderReader.inspect(bookmark: bookmark, path: "visited"))
        XCTAssertEqual(c.id, a.entry.id); XCTAssertNotEqual(c.version, b.version)
        try awaitChange { rows.contains { $0.entry.path == "visited" && $0.entry.version == c.version } }
        let bRow = try XCTUnwrap(rows.first { $0.entry.path == "visited" && $0.entry.version == b.version })
        let cRow = try XCTUnwrap(rows.first { $0.entry.path == "visited" && $0.entry.version == c.version })
        XCTAssertLessThan(a.sequence, bRow.sequence); XCTAssertLessThan(bRow.sequence, cRow.sequence)
        // Reopening retains the same generation and all immutable revisions.
        let reopened = MobileFolderInventory(directory: cache, commanderIndexer: helper)
        let durable = try reopened.streamChanges(scope, id: id, bookmark: bookmark, excludedPaths: [], ignoreRules: nil, afterSequence: 0)
        XCTAssertEqual(durable.generation, initial.generation)
        XCTAssertEqual(durable.changes.filter { $0.entry.path == "visited" }.map(\.entry.version), [a.entry.version, b.version, c.version])
        let current = try XCTUnwrap(MobileFolderReader.inspect(bookmark: bookmark, path: "visited"))
        XCTAssertEqual(current, cRow.entry) // Latest production full stamp validates.
        XCTAssertNotEqual(current, a.entry); XCTAssertNotEqual(current, bRow.entry)
        control.finish(afterSequence: cursor)
        // A final queued namespace gap may advance the stop watermark once.
        try awaitChange { state == "complete" || (state == "indexed" && cursor > cRow.sequence) }
        if state != "complete" {
            control.finish(afterSequence: cursor)
            try awaitChange { state == "complete" }
        }
        try await scanner.value
    }
    func testProductionCommanderStreamEntryPassesBulkReaderAndStaleSourceFails() throws {
        let helper = try helper(), (base, source, bookmark, scope) = try fixture()
        let bytes = Data(repeating: 71, count: 131_073), file = source.appendingPathComponent("payload")
        try bytes.write(to: file)
        let inventory = MobileFolderInventory(directory: base.appendingPathComponent("bulk-feed"), commanderIndexer: helper)
        let id = UUID().uuidString.lowercased()
        let initial = try inventory.beginStream(scope, id: id, bookmark: bookmark, excludedPaths: [], ignoreRules: nil)
        try inventory.runStream(scope, id: id, bookmark: bookmark, excludedPaths: [], ignoreRules: nil, wake: {})
        try inventory.finishStream(scope, id: id, bookmark: bookmark, state: "complete")
        let page = try inventory.streamChanges(scope, id: id, bookmark: bookmark, excludedPaths: [], ignoreRules: nil, afterSequence: 0)
        XCTAssertEqual(page.generation, initial.generation); XCTAssertEqual(page.nextSequence, 1)
        let entry = try XCTUnwrap(page.changes.first?.entry)
        XCTAssertEqual(entry.path, "payload"); XCTAssertEqual(entry.size, Int64(bytes.count))
        XCTAssertNil(entry.sha256); XCTAssertEqual(entry.fingerprint?.partSizeBytes, 8_388_608); XCTAssertEqual(entry.fingerprint?.partCount, 1)
        // Expected metadata comes only from the production Rust feed. The bulk
        // reader independently checks inode/stamp and both raw/composite hashes.
        let payload = try MobileFolderBulkReader.read(bookmark: bookmark, expected: entry)
        XCTAssertEqual(payload.bytes, bytes)
        try Data("changed".utf8).write(to: file, options: .atomic)
        XCTAssertThrowsError(try MobileFolderBulkReader.read(bookmark: bookmark, expected: entry, sha256: payload.sha256))
    }
    func testLiveIndexExcludesOnlyItsPhysicallyNestedPrivateCache() throws {
        let helper = try helper(), (_, source, bookmark, scope) = try fixture()
        try FileManager.default.createDirectory(at: source.appendingPathComponent("Library"), withIntermediateDirectories: true)
        try Data("user data".utf8).write(to: source.appendingPathComponent("Library/keep"))
        let inventory = MobileFolderInventory(directory: source.appendingPathComponent("Library/private-inventory"), commanderIndexer: helper)
        let id = UUID().uuidString.lowercased()
        _ = try inventory.beginStream(scope, id: id, bookmark: bookmark, excludedPaths: [], ignoreRules: nil)
        try inventory.runStream(scope, id: id, bookmark: bookmark, excludedPaths: [], ignoreRules: nil, wake: {})
        let page = try inventory.streamChanges(scope, id: id, bookmark: bookmark, excludedPaths: [], ignoreRules: nil, afterSequence: 0)
        XCTAssertEqual(Set(page.changes.map(\.entry.path)), ["Library", "Library/keep"])
        XCTAssertEqual(page.totalEntries, 2)
        XCTAssertFalse(page.changes.contains { $0.entry.path.contains("private-inventory") })
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
