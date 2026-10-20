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

    func testCurrentRevisionDedupeRetainsReversionsAndContiguousSequencesAcrossRestart() throws {
        let (source, bookmark, _, directory) = try fixture()
        try Data("fixture".utf8).write(to: source.appendingPathComponent("file"))
        let a = try XCTUnwrap(MobileFolderReader.scan(bookmark: bookmark).first)
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(a)) as? [String: Any])
        object["version"] = "fixture-B"
        let b = try JSONDecoder().decode(MobileFolderReader.Entry.self, from: JSONSerialization.data(withJSONObject: object))
        try NativeFileJournal.locked(directory: directory) { fd in
            do {
                let db = try MobileFolderInventory.Database(directory: fd, create: true)
                try db.execute("CREATE TABLE changes (ordinal INTEGER PRIMARY KEY, data BLOB NOT NULL, path TEXT NOT NULL, revision TEXT NOT NULL)")
                try db.execute("CREATE TABLE current_entries (path TEXT PRIMARY KEY, revision TEXT NOT NULL)")
                try db.execute("CREATE TABLE stream_metadata (skipped INTEGER NOT NULL, totalEntries INTEGER NOT NULL)")
                try db.execute("INSERT INTO stream_metadata VALUES (0, 0)")
                var cursor = 0
                for entry in [a, b, a, a] { if try db.insertChange(entry, sequence: cursor + 1) { cursor += 1 } }
                XCTAssertEqual(cursor, 3)
                var versions: [String] = [], sequences: [Int] = []
                try db.rows(offset: 1, table: "changes") { sequence, data in
                    sequences.append(sequence); versions.append(try JSONDecoder().decode(MobileFolderReader.Entry.self, from: data).version); return true
                }
                XCTAssertEqual(sequences, [1, 2, 3]); XCTAssertEqual(versions, [a.version, b.version, a.version])
            }
            let reopened = try MobileFolderInventory.Database(directory: fd, create: false, writable: true)
            XCTAssertFalse(try reopened.insertChange(a, sequence: 4))
            XCTAssertEqual(try reopened.lastSequence(), 3); XCTAssertEqual(try reopened.streamTotal(), 1)
        }
    }

    func testIgnoreRulesPruneDependenciesBeforeOpenAndBindCapturePolicy() throws {
        let (source, bookmark, scope, directory) = try fixture()
        for name in ["project/node_modules", ".venv", "cache", "hard"] {
            try FileManager.default.createDirectory(at: source.appendingPathComponent(name), withIntermediateDirectories: true)
            try FileManager.default.createSymbolicLink(at: source.appendingPathComponent(name + "/blocked"), withDestinationURL: source.appendingPathComponent("outside"))
        }
        for name in ["project/cache", "NODE_MODULES"] {
            try FileManager.default.createDirectory(at: source.appendingPathComponent(name), withIntermediateDirectories: true)
            try Data().write(to: source.appendingPathComponent(name + "/kept"))
        }
        try Data("secret\n".utf8).write(to: source.appendingPathComponent(".gitignore"))
        for name in ["secret", "drop.tmp", "keep.tmp"] { try Data().write(to: source.appendingPathComponent(name)) }
        let venv = source.appendingPathComponent(".venv")
        try FileManager.default.setAttributes([.posixPermissions: 0], ofItemAtPath: venv.path)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: venv.path) }
        let rules = "node_modules/\n.venv/\n/cache/\n*.tmp\n!keep.tmp\n!hard/\n"
        let expected: Set<String> = ["project", "project/cache", "project/cache/kept", "NODE_MODULES", "NODE_MODULES/kept", ".gitignore", "secret", "keep.tmp"]
        let exclusions = ["hard"], store = MobileFolderInventory(directory: directory)
        let scanned = try MobileFolderReader.scan(bookmark: bookmark, excludedPaths: exclusions, ignoreRules: rules)
        XCTAssertEqual(Set(scanned.map(\.path)), expected)
        let strictID = UUID().uuidString.lowercased()
        let strict = try store.capture(scope, id: strictID, bookmark: bookmark, excludedPaths: exclusions, ignoreRules: rules)
        XCTAssertEqual(Set(try store.read(scope, capture: strict, bookmark: bookmark, offset: 0, ignoreRules: rules).entries.map(\.path)), expected)
        XCTAssertThrowsError(try store.read(scope, capture: strict, bookmark: bookmark, offset: 0))
        XCTAssertThrowsError(try store.capture(scope, id: strictID, bookmark: bookmark, excludedPaths: exclusions, ignoreRules: rules + "# policy change"))
        let id = UUID().uuidString.lowercased()
        let backup = try store.prepareBackup(scope, id: id, generation: UUID().uuidString.lowercased(), bookmark: bookmark, excludedPaths: exclusions, ignoreRules: rules)
        XCTAssertEqual(backup.coverage, "full"); XCTAssertEqual(backup.totalSkipped, 0)
        try store.sealBackup(scope, capture: backup, bookmark: bookmark)
        XCTAssertEqual(try store.backupStatus(scope, id: id, bookmark: bookmark, excludedPaths: exclusions, ignoreRules: rules)?.ignoredCount, 4)
        XCTAssertEqual(Set(try store.read(scope, capture: backup, bookmark: bookmark, offset: 0, ignoreRules: rules).entries.map(\.path)), expected)
        XCTAssertThrowsError(try store.backupStatus(scope, id: id, bookmark: bookmark, excludedPaths: exclusions))
        XCTAssertThrowsError(try store.readSkipped(scope, capture: backup, bookmark: bookmark, offset: 0))
        XCTAssertThrowsError(try store.discard(scope, capture: backup, bookmark: bookmark))
        XCTAssertEqual(try store.readSkipped(scope, capture: backup, bookmark: bookmark, offset: 0, ignoreRules: rules).skipped.count, 0)
        try store.discard(scope, capture: backup, bookmark: bookmark, ignoreRules: rules)
    }

    func testIgnoreMatchingAndEmittedInventoryPreserveDecomposedFilenameBytes() throws {
        let (source, bookmark, scope, directory) = try fixture()
        let nfd = "cafe\u{301}.txt", nfc = "café.txt"
        try Data().write(to: source.appendingPathComponent(nfd))
        let entries = try MobileFolderReader.scan(bookmark: bookmark, ignoreRules: "/" + nfc)
        let entry = try XCTUnwrap(entries.first)
        XCTAssertTrue(entry.path.utf8.elementsEqual(nfd.utf8), "Native inventory must preserve readdir spelling")
        XCTAssertFalse(try MobileFolderIgnoreRules("/" + nfc).ignores(entry.path, isDirectory: false))
        XCTAssertTrue(try MobileFolderIgnoreRules("/" + nfd).ignores(entry.path, isDirectory: false))
        XCTAssertTrue(try MobileFolderReader.scan(bookmark: bookmark, ignoreRules: "/" + nfd).isEmpty)
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(entry)) as! [String: Any]
        XCTAssertTrue(try XCTUnwrap(json["path"] as? String).utf8.elementsEqual(nfd.utf8), "JSON transport must preserve matching bytes")
        let store = MobileFolderInventory(directory: directory)
        let capture = try store.capture(scope, id: UUID().uuidString.lowercased(), bookmark: bookmark, ignoreRules: "/" + nfc)
        let page = try store.read(scope, capture: capture, bookmark: bookmark, offset: 0, ignoreRules: "/" + nfc)
        XCTAssertTrue(try XCTUnwrap(page.entries.first).path.utf8.elementsEqual(nfd.utf8), "Folded identity keys must not rewrite emitted paths")
    }

    func testIgnorePolicyIdentityUsesExactUnicodeBytesAndValidatesBeforeGrantAccess() throws {
        let (_, bookmark, scope, directory) = try fixture()
        let store = MobileFolderInventory(directory: directory), id = UUID().uuidString.lowercased()
        let composed = "café", decomposed = "cafe\u{301}"
        XCTAssertEqual(composed, decomposed) // Swift equivalence must not bind rules.
        XCTAssertFalse(MobileFolderIgnoreRules.sameText(composed, decomposed))
        _ = try store.capture(scope, id: id, bookmark: bookmark, ignoreRules: composed)
        XCTAssertThrowsError(try store.capture(scope, id: id, bookmark: bookmark, ignoreRules: decomposed))
        for bad in ["\0"] {
            XCTAssertThrowsError(try MobileFolderReader.scan(bookmark: Data(), ignoreRules: bad)) { error in
                guard case MobileFolderStore.Failure.invalid = error else { return XCTFail("Invalid rules must fail before touching the grant") }
            }
        }
    }

    func testOptionalPageSizesReuseSealedCapturesWithExactOffsetsAndByteBounds() throws {
        let (source, bookmark, scope, directory) = try fixture()
        for i in 0..<1301 {
            try Data().write(to: source.appendingPathComponent(String(repeating: "f", count: 220) + String(format: "%04d", i)))
        }
        let store = MobileFolderInventory(directory: directory)
        // The capture itself has no new fields and survives the paging upgrade.
        let capture = try store.capture(scope, id: UUID().uuidString.lowercased(), bookmark: bookmark)
        XCTAssertEqual(try store.read(scope, capture: capture, bookmark: bookmark, offset: 0).entries.count, 128)
        let first = try store.read(scope, capture: capture, bookmark: bookmark, offset: 0, pageSize: 512)
        XCTAssertEqual(first.entries.count, 512); XCTAssertEqual(first.nextOffset, 512)
        let second = try store.read(scope, capture: capture, bookmark: bookmark, offset: 512, pageSize: 512)
        XCTAssertEqual(second.entries.count, 512); XCTAssertEqual(second.nextOffset, 1024)
        let last = try store.read(scope, capture: capture, bookmark: bookmark, offset: 1024, pageSize: 512)
        XCTAssertEqual(last.entries.count, 277); XCTAssertNil(last.nextOffset)
        XCTAssertEqual(Set((first.entries + second.entries + last.entries).map(\.path)).count, 1301)
        let bounded = try store.read(scope, capture: capture, bookmark: bookmark, offset: 0, pageSize: 4096)
        XCTAssertGreaterThan(bounded.entries.count, 128); XCTAssertLessThan(bounded.entries.count, 1301)
        XCTAssertEqual(bounded.nextOffset, bounded.entries.count)
        XCTAssertLessThanOrEqual(try JSONEncoder().encode(bounded).count, MobileFolderInventory.maximumPageBytes)
        let tail = try store.read(scope, capture: capture, bookmark: bookmark, offset: bounded.entries.count, pageSize: 4096)
        XCTAssertEqual(bounded.entries.count + tail.entries.count, 1301); XCTAssertNil(tail.nextOffset)
        for invalid in [-1, 0, 4097, Int.max] {
            XCTAssertThrowsError(try store.read(scope, capture: capture, bookmark: Data(), offset: 0, pageSize: invalid))
        }
        let foreign = MobileFolderInventory.Scope(owner: try FileSyncOwnerScope(ownerId: "foreign", url: scope.owner.origin),
            deviceId: scope.deviceId, rootId: scope.rootId)
        XCTAssertThrowsError(try store.read(foreign, capture: capture, bookmark: bookmark, offset: 0, pageSize: 4096))
    }

    func testSkipPagesOptInto4096WithLegacyDefaultAndExactLastPage() throws {
        let (source, bookmark, scope, directory) = try fixture()
        for i in 0..<4103 {
            try FileManager.default.createSymbolicLink(at: source.appendingPathComponent("link-\(i)"),
                withDestinationURL: source.appendingPathComponent("missing"))
        }
        let store = MobileFolderInventory(directory: directory)
        let capture = try store.prepareBackup(scope, id: UUID().uuidString.lowercased(), generation: UUID().uuidString.lowercased(), bookmark: bookmark)
        try store.sealBackup(scope, capture: capture, bookmark: bookmark)
        XCTAssertEqual(capture.totalSkipped, 4103)
        XCTAssertEqual(try store.readSkipped(scope, capture: capture, bookmark: bookmark, offset: 0).skipped.count, 128)
        let first = try store.readSkipped(scope, capture: capture, bookmark: bookmark, offset: 0, pageSize: 4096)
        XCTAssertEqual(first.skipped.count, 4096); XCTAssertEqual(first.nextOffset, 4096)
        XCTAssertEqual(first.skipped.map(\.ordinal), Array(0..<4096))
        XCTAssertLessThanOrEqual(try JSONEncoder().encode(first).count, MobileFolderInventory.maximumPageBytes)
        let last = try store.readSkipped(scope, capture: capture, bookmark: bookmark, offset: 4096, pageSize: 4096)
        XCTAssertEqual(last.skipped.map(\.ordinal), Array(4096..<4103)); XCTAssertNil(last.nextOffset)
        for invalid in [-1, 0, 4097, Int.max] {
            XCTAssertThrowsError(try store.readSkipped(scope, capture: capture, bookmark: Data(), offset: 0, pageSize: invalid))
        }
        let foreign = MobileFolderInventory.Scope(owner: scope.owner, deviceId: "foreign", rootId: scope.rootId)
        XCTAssertThrowsError(try store.readSkipped(foreign, capture: capture, bookmark: bookmark, offset: 0, pageSize: 4096))
    }

    func testBackupCaptureKeepsSupportedFilesAndPagesExplicitSkips() throws {
        let (source, bookmark, scope, directory) = try fixture()
        let outside = source.deletingLastPathComponent().appendingPathComponent("outside-pipe")
        XCTAssertEqual(mkfifo(outside.path, 0o600), 0)
        for i in 0..<130 {
            try FileManager.default.createSymbolicLink(at: source.appendingPathComponent("link-\(i)"), withDestinationURL: outside)
        }
        try Data("supported".utf8).write(to: source.appendingPathComponent("first"))
        try FileManager.default.linkItem(at: source.appendingPathComponent("first"), to: source.appendingPathComponent("alias"))
        XCTAssertEqual(mkfifo(source.appendingPathComponent("pipe").path, 0o600), 0)
        try Data().write(to: source.appendingPathComponent("bad\\name"))
        let store = MobileFolderInventory(directory: directory), id = UUID().uuidString.lowercased()
        let capture = try store.prepareBackup(scope, id: id, generation: UUID().uuidString.lowercased(), bookmark: bookmark)
        XCTAssertEqual(capture.coverage, "partial"); XCTAssertEqual(capture.consistency, "per-entry")
        XCTAssertEqual(capture.totalEntries, 1); XCTAssertEqual(capture.totalSkipped, 133)
        XCTAssertThrowsError(try store.read(scope, capture: capture, bookmark: bookmark, offset: 0))
        XCTAssertThrowsError(try store.readSkipped(scope, capture: capture, bookmark: bookmark, offset: 0))
        try store.sealBackup(scope, capture: capture, bookmark: bookmark)
        let entries = try store.read(scope, capture: capture, bookmark: bookmark, offset: 0).entries
        XCTAssertEqual(entries.count, 1); XCTAssertEqual(entries[0].size, 9)
        var gaps: [MobileFolderInventory.Skipped] = [], offset = 0
        repeat {
            let page = try store.readSkipped(scope, capture: capture, bookmark: bookmark, offset: offset)
            XCTAssertEqual(page.capture, capture); XCTAssertEqual(page.offset, offset)
            XCTAssertLessThanOrEqual(page.skipped.count, 128)
            XCTAssertLessThanOrEqual(try JSONEncoder().encode(page).count, MobileFolderInventory.maximumPageBytes)
            gaps += page.skipped
            guard let next = page.nextOffset else { break }; offset = next
        } while true
        XCTAssertEqual(gaps.map(\.ordinal), Array(0..<133))
        XCTAssertEqual(gaps.filter { $0.reason == .symlink }.count, 130)
        XCTAssertEqual(gaps.filter { $0.reason == .duplicateIdentity }.count, 1)
        XCTAssertEqual(gaps.filter { $0.reason == .fifo }.count, 1)
        XCTAssertEqual(gaps.filter { $0.reason == .invalidPath && $0.path == nil }.count, 1)
        let stripped = MobileFolderInventory.Capture(id: capture.id, generation: capture.generation, totalEntries: capture.totalEntries)
        XCTAssertThrowsError(try store.read(scope, capture: stripped, bookmark: bookmark, offset: 0))
        XCTAssertThrowsError(try store.readSkipped(scope, capture: stripped, bookmark: bookmark, offset: 0))
        XCTAssertThrowsError(try store.capture(scope, id: id, bookmark: bookmark))
        XCTAssertEqual(try store.backupStatus(scope, id: id, bookmark: bookmark)?.state, "complete")
        XCTAssertThrowsError(try MobileFolderReader.scan(bookmark: bookmark))
    }

    func testBackupUnreadableSubtreeIsExplicitAndDoesNotHideSupportedSibling() throws {
        guard geteuid() != 0 else { throw XCTSkip("Permission fixture requires an unprivileged user") }
        let (source, bookmark, scope, directory) = try fixture()
        let blocked = source.appendingPathComponent("blocked")
        try FileManager.default.createDirectory(at: blocked, withIntermediateDirectories: true)
        try Data().write(to: blocked.appendingPathComponent("hidden"))
        try Data().write(to: source.appendingPathComponent("kept"))
        try FileManager.default.setAttributes([.posixPermissions: 0], ofItemAtPath: blocked.path)
        defer { try? FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: blocked.path) }
        let store = MobileFolderInventory(directory: directory)
        let capture = try store.prepareBackup(scope, id: UUID().uuidString.lowercased(), generation: UUID().uuidString.lowercased(), bookmark: bookmark)
        try store.sealBackup(scope, capture: capture, bookmark: bookmark)
        XCTAssertEqual(try store.read(scope, capture: capture, bookmark: bookmark, offset: 0).entries.map(\.path), ["kept"])
        let gaps = try store.readSkipped(scope, capture: capture, bookmark: bookmark, offset: 0).skipped
        XCTAssertTrue(gaps.contains { $0.path == "blocked" && $0.scope == .subtree && $0.reason == .unreadable })
        XCTAssertEqual(capture.coverage, "partial")
    }

    func testBackupRootMutationRecordsGapWithoutWholeTreeReplay() throws {
        let (source, bookmark, _, _) = try fixture()
        try Data().write(to: source.appendingPathComponent("first"))
        var gaps: [MobileFolderReader.BackupGap] = [], rows: [MobileFolderReader.Entry] = [], changed = false
        try MobileFolderReader.captureBackup(bookmark: bookmark, append: { row in
            rows.append(row)
            if !changed { changed = true; try Data().write(to: source.appendingPathComponent("added")) }
            return true
        }, skip: { gaps.append($0) })
        XCTAssertTrue(rows.contains { $0.path == "first" })
        XCTAssertTrue(gaps.contains { $0.path == nil && $0.scope == .root && $0.reason == .changed })
    }

    func testBackupCancellationAndLostHostLeaveUnsealedGeneration() async throws {
        let (source, bookmark, scope, directory) = try fixture()
        try Data().write(to: source.appendingPathComponent("first"))
        let store = MobileFolderInventory(directory: directory), id = UUID().uuidString.lowercased()
        let interrupted = try store.prepareBackup(scope, id: id, generation: UUID().uuidString.lowercased(), bookmark: bookmark)
        XCTAssertEqual(try store.backupStatus(scope, id: id, bookmark: bookmark)?.state, "interrupted")
        XCTAssertThrowsError(try store.read(scope, capture: interrupted, bookmark: bookmark, offset: 0))
        let work = Task.detached {
            try store.prepareBackup(scope, id: id, generation: UUID().uuidString.lowercased(), bookmark: bookmark,
                progress: { _, _ in withUnsafeCurrentTask { $0?.cancel() } })
        }
        do { _ = try await work.value; XCTFail("Cancelled backup prepared") } catch is CancellationError { }
        let replacement = try store.prepareBackup(scope, id: id, generation: UUID().uuidString.lowercased(), bookmark: bookmark)
        XCTAssertNotEqual(replacement.generation, interrupted.generation)
        XCTAssertEqual(replacement.coverage, "full"); XCTAssertEqual(replacement.totalSkipped, 0)
        try store.sealBackup(scope, capture: replacement, bookmark: bookmark)
        XCTAssertThrowsError(try store.read(scope, capture: interrupted, bookmark: bookmark, offset: 0))
        XCTAssertEqual(try store.readSkipped(scope, capture: replacement, bookmark: bookmark, offset: 0).skipped.count, 0)
        // Cancellation may arrive during the final fsync. The host abandons
        // that exact generation before reporting interruption.
        try store.abandonBackup(scope, capture: replacement, bookmark: bookmark)
        XCTAssertThrowsError(try store.read(scope, capture: replacement, bookmark: bookmark, offset: 0))
        XCTAssertEqual(try store.backupStatus(scope, id: id, bookmark: bookmark)?.state, "interrupted")
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
