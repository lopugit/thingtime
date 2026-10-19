@testable import AppleFileSync
import XCTest
import CryptoKit

@MainActor
final class MobileFolderTests: XCTestCase {
    private func fixture() throws -> (URL, FileSyncOwnerScope, MobileFolderStore) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("folder-test-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let scope = try FileSyncOwnerScope(ownerId: "folder-test-" + UUID().uuidString, url: URL(string: "https://thingtime.test")!)
        var data: Data?
        return (root, scope, MobileFolderStore(load: { _ in data }, save: { _, next in data = next }))
    }
    func testWriteApprovalIsSeparateBoundedAndClearedByReselection() throws {
        let (root, owner, store) = try fixture(), grant = try store.add(owner, selected: root)
        let scope = MobileSyncStaging.Scope(origin: owner.origin.absoluteString, ownerId: owner.ownerId, dataPlane: "home", rootId: "connection", deviceId: "device")
        let approval = MobileFolderStore.WriteApproval(scope: scope, configurationRevision: "v1", configurationHash: String(repeating: "a", count: 64))
        XCTAssertFalse(try store.isWriteApproved(owner, id: grant.id, approval: approval))
        try store.approveWrite(owner, grant: grant, approval: approval)
        XCTAssertTrue(try store.isWriteApproved(owner, id: grant.id, approval: approval))
        let changed = MobileFolderStore.WriteApproval(scope: scope, configurationRevision: "v2", configurationHash: approval.configurationHash)
        XCTAssertFalse(try store.isWriteApproved(owner, id: grant.id, approval: changed))
        let changedBytes = MobileFolderStore.WriteApproval(scope: scope, configurationRevision: "v1", configurationHash: String(repeating: "b", count: 64))
        XCTAssertFalse(try store.isWriteApproved(owner, id: grant.id, approval: changedBytes))
        let foreign = MobileSyncStaging.Scope(origin: owner.origin.absoluteString, ownerId: "other", dataPlane: "home", rootId: "connection", deviceId: "device")
        XCTAssertThrowsError(try store.approveWrite(owner, grant: grant, approval: .init(scope: foreign, configurationRevision: "v1", configurationHash: approval.configurationHash)))
        _ = try store.add(owner, selected: root)
        XCTAssertFalse(try store.isWriteApproved(owner, id: grant.id, approval: approval))
        try store.remove(owner, id: grant.id)
        XCTAssertThrowsError(try store.approveWrite(owner, grant: grant, approval: approval))
    }
    func testMultipartFingerprintMatchesSharedByteContractAndBoundedReads() throws {
        let (root, scope, store) = try fixture()
        let bytes = Data(repeating: 13, count: 8 * 1024 * 1024 + 17)
        try bytes.write(to: root.appendingPathComponent("original.bin"))
        let grant = try store.add(scope, selected: root), rows = try MobileFolderReader.scan(bookmark: grant.bookmark)
        let entry = try XCTUnwrap(rows.first); XCTAssertEqual(entry.path, "original.bin"); XCTAssertEqual(entry.size, Int64(bytes.count))
        var parts = Data(SHA256.hash(data: bytes.prefix(8 * 1024 * 1024))); parts.append(Data(SHA256.hash(data: bytes.suffix(17))))
        XCTAssertEqual(entry.fingerprint?.sha256, SHA256.hash(data: parts).map { String(format: "%02x", $0) }.joined())
        XCTAssertEqual(entry.fingerprint?.partSizeBytes, 8 * 1024 * 1024); XCTAssertEqual(entry.fingerprint?.partCount, 2)
        let chunk = try MobileFolderReader.read(bookmark: grant.bookmark, path: entry.path, version: entry.version, offset: 8 * 1024 * 1024, length: 65_536)
        XCTAssertEqual(Data(base64Encoded: chunk.data), bytes.suffix(17)); XCTAssertEqual(chunk.version, entry.version)
        XCTAssertThrowsError(try MobileFolderReader.read(bookmark: grant.bookmark, path: entry.path, version: entry.version, offset: 0, length: 65_537))
    }
    func testDirectoriesAndEmptyFilesStayInCompleteInventory() throws {
        let (root, scope, store) = try fixture()
        try FileManager.default.createDirectory(at: root.appendingPathComponent("nested"), withIntermediateDirectories: true)
        try Data().write(to: root.appendingPathComponent("nested/empty.txt"))
        let grant = try store.add(scope, selected: root), rows = try MobileFolderReader.scan(bookmark: grant.bookmark)
        XCTAssertEqual(rows.map(\.path), ["nested", "nested/empty.txt"]); XCTAssertEqual(rows[0].kind, "folder")
        XCTAssertEqual(rows[1].sha256, SHA256.hash(data: Data()).map { String(format: "%02x", $0) }.joined()); XCTAssertNil(rows[1].fingerprint)
        let chunk = try MobileFolderReader.read(bookmark: grant.bookmark, path: rows[1].path, version: rows[1].version, offset: 0, length: 1)
        XCTAssertEqual(chunk.data, "")
    }

    func testInspectionMatchesCompleteScanButDoesNotTraverseUnrelatedItems() throws {
        let (root, scope, store) = try fixture()
        try FileManager.default.createDirectory(at: root.appendingPathComponent("nested"), withIntermediateDirectories: true)
        try Data(repeating: 41, count: 65_537).write(to: root.appendingPathComponent("nested/file.bin"))
        try Data().write(to: root.appendingPathComponent("empty"))
        let grant = try store.add(scope, selected: root)
        for row in try MobileFolderReader.scan(bookmark: grant.bookmark) {
            XCTAssertEqual(try MobileFolderReader.inspect(bookmark: grant.bookmark, path: row.path), row)
        }
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("unrelated-link"), withDestinationURL: root)
        XCTAssertThrowsError(try MobileFolderReader.scan(bookmark: grant.bookmark))
        XCTAssertEqual(try MobileFolderReader.inspect(bookmark: grant.bookmark, path: "nested/file.bin")?.size, 65_537)
        XCTAssertNil(try MobileFolderReader.inspect(bookmark: grant.bookmark, path: "missing"))
        XCTAssertNil(try MobileFolderReader.inspect(bookmark: grant.bookmark, path: "missing/child"))
        for path in ["../outside", "nested/../empty", "unrelated-link/empty", "nested/FILE.bin", "empty/child"] {
            XCTAssertThrowsError(try MobileFolderReader.inspect(bookmark: grant.bookmark, path: path), path)
        }
        try FileManager.default.removeItem(at: root)
        XCTAssertThrowsError(try MobileFolderReader.inspect(bookmark: grant.bookmark, path: "missing"))
    }

    func testInspectionInWideDirectoriesHasNoWholeScanEntryLimit() throws {
        let (root, scope, store) = try fixture(), grant = try store.add(scope, selected: root)
        for index in 0...MobileFolderReader.maximumEntries {
            try Data().write(to: root.appendingPathComponent("file-\(index)"))
        }
        XCTAssertThrowsError(try MobileFolderReader.scan(bookmark: grant.bookmark))
        XCTAssertEqual(try MobileFolderReader.inspect(bookmark: grant.bookmark, path: "file-10000")?.size, 0)
        XCTAssertNil(try MobileFolderReader.inspect(bookmark: grant.bookmark, path: "absent"))
    }

    func testCancelledInspectionCannotReportAbsence() async throws {
        let (root, scope, store) = try fixture(), grant = try store.add(scope, selected: root)
        let task = Task.detached {
            withUnsafeCurrentTask { $0?.cancel() }
            return try MobileFolderReader.inspect(bookmark: grant.bookmark, path: "absent")
        }
        do { _ = try await task.value; XCTFail("Cancelled lookup returned absence") } catch is CancellationError { }
    }
    func testSymlinksTraversalAndChangedFilesCannotReturnBytes() throws {
        let (root, scope, store) = try fixture(); let file = root.appendingPathComponent("file")
        try Data("one".utf8).write(to: file); let grant = try store.add(scope, selected: root)
        let entry = try XCTUnwrap(MobileFolderReader.scan(bookmark: grant.bookmark).first)
        for path in ["../file", "/file", "a//file", "a\\file", "a/./file"] {
            XCTAssertThrowsError(try MobileFolderReader.read(bookmark: grant.bookmark, path: path, version: entry.version, offset: 0, length: 1))
        }
        try Data("changed".utf8).write(to: file)
        XCTAssertThrowsError(try MobileFolderReader.read(bookmark: grant.bookmark, path: "file", version: entry.version, offset: 0, length: 1))
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("link"), withDestinationURL: file)
        XCTAssertThrowsError(try MobileFolderReader.scan(bookmark: grant.bookmark))
        XCTAssertThrowsError(try MobileFolderReader.read(bookmark: grant.bookmark, path: "link", version: entry.version, offset: 0, length: 1))
    }
    func testMissingFolderIsFailureNotAnEmptyScan() throws {
        let (root, scope, store) = try fixture(); let grant = try store.add(scope, selected: root)
        XCTAssertEqual(try MobileFolderReader.scan(bookmark: grant.bookmark).count, 0)
        try FileManager.default.removeItem(at: root)
        XCTAssertThrowsError(try MobileFolderReader.scan(bookmark: grant.bookmark))
    }
    func testGrantsReloadDeduplicateScopeAndRemoveWithoutDeletingFiles() throws {
        let (root, scope, store) = try fixture(); let a = try store.add(scope, selected: root), b = try store.add(scope, selected: root)
        XCTAssertEqual(a.id, b.id); XCTAssertEqual(try store.list(scope).count, 1)
        let other = try FileSyncOwnerScope(ownerId: "other", url: scope.origin)
        XCTAssertThrowsError(try store.list(other)) // Injected storage returns another account's row.
        try store.remove(scope, id: a.id); XCTAssertEqual(try store.list(scope).count, 0); XCTAssertTrue(FileManager.default.fileExists(atPath: root.path))
        XCTAssertThrowsError(try store.grant(scope, id: a.id))
    }
    func testKeychainReloadStaysOnDeviceAndScopedToAccountAndOrigin() throws {
        let (root, scope, _) = try fixture(); let first = MobileFolderStore(), grant = try first.add(scope, selected: root)
        defer { try? first.remove(scope, id: grant.id) }
        let reopened = MobileFolderStore(); XCTAssertEqual(try reopened.grant(scope, id: grant.id).bookmark, grant.bookmark)
        let otherOrigin = try FileSyncOwnerScope(ownerId: scope.ownerId, url: URL(string: "https://elsewhere.test")!)
        XCTAssertTrue(try reopened.list(otherOrigin).isEmpty)
        XCTAssertTrue(try reopened.list(FileSyncOwnerScope(ownerId: "other", url: scope.origin)).isEmpty)
    }
    func testSaveFailureCannotPublishNewFolderAccess() throws {
        let (root, scope, _) = try fixture()
        let store = MobileFolderStore(load: { _ in nil }, save: { _, _ in throw MobileFolderStore.Failure.storage })
        XCTAssertThrowsError(try store.add(scope, selected: root)); XCTAssertTrue(try store.list(scope).isEmpty)
    }
    func testCancellationStopsHashingWithoutACompleteScan() async throws {
        let (root, scope, store) = try fixture(); try Data(repeating: 1, count: 1024 * 1024).write(to: root.appendingPathComponent("file"))
        let grant = try store.add(scope, selected: root)
        let task = Task { try Task.checkCancellation(); return try MobileFolderReader.scan(bookmark: grant.bookmark) }; task.cancel()
        do { _ = try await task.value; XCTFail("Cancelled scan returned success") } catch is CancellationError { }
    }
    func testStreamRejectsReplacedPathsChangedInodesCancellationAndConsumerRefusal() async throws {
        let (root, scope, store) = try fixture(), file = root.appendingPathComponent("stream.bin")
        let bytes = Data(repeating: 43, count: 131_073)
        try bytes.write(to: file)
        let grant = try store.add(scope, selected: root)
        func entry() throws -> MobileFolderReader.Entry { try XCTUnwrap(MobileFolderReader.scan(bookmark: grant.bookmark).first) }
        let original = try entry()
        var received = Data()
        XCTAssertEqual(try MobileFolderReader.stream(bookmark: grant.bookmark, path: original.path, version: original.version, offset: 7, length: 100_000) { received.append($0) }, Int64(bytes.count))
        XCTAssertEqual(received, bytes.subdata(in: 7..<100_007))
        for length in [0, -1, MobileFolderReader.maximumStreamBytes + 1] {
            XCTAssertThrowsError(try MobileFolderReader.stream(bookmark: grant.bookmark, path: original.path, version: original.version, offset: 0, length: length) { _ in XCTFail() })
        }
        XCTAssertThrowsError(try MobileFolderReader.stream(bookmark: grant.bookmark, path: original.path, version: original.version, offset: 0, length: bytes.count) { _ in throw CancellationError() })
        var frames = 0
        XCTAssertThrowsError(try MobileFolderReader.stream(bookmark: grant.bookmark, path: original.path, version: original.version, offset: 0, length: bytes.count) { _ in
            frames += 1
            if frames == 1 { try Data(repeating: 2, count: bytes.count).write(to: file) }
        })
        XCTAssertEqual(frames, 1)
        let current = try entry()
        frames = 0
        XCTAssertThrowsError(try MobileFolderReader.stream(bookmark: grant.bookmark, path: current.path, version: current.version, offset: 0, length: bytes.count) { _ in
            frames += 1
            if frames == 3 { try Data(repeating: 3, count: bytes.count).write(to: file, options: .atomic) }
        })
        let latest = try entry()
        let cancelled = Task.detached {
            withUnsafeCurrentTask { $0?.cancel() }
            return try MobileFolderReader.stream(bookmark: grant.bookmark, path: latest.path, version: latest.version, offset: 0, length: bytes.count) { _ in XCTFail("Cancelled stream emitted bytes") }
        }
        do { _ = try await cancelled.value; XCTFail() } catch { }
    }

}
