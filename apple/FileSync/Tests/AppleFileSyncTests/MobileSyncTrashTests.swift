@testable import AppleFileSync
import XCTest
import Foundation

@MainActor
final class MobileSyncTrashTests: XCTestCase {
    struct Fixture {
        let base: URL; let selected: URL; let storage: URL; let target: URL
        let owner: FileSyncOwnerScope; let bookmark: Data; let request: MobileSyncTrash.Request
        var trash: MobileSyncTrash { MobileSyncTrash(directory: storage) }
    }
    func fixture(bytes: Data = Data("original bytes".utf8), folder: Bool = false) throws -> Fixture {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent("native-trash-" + UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: base) }
        let selected = base.appendingPathComponent("selected"), storage = base.appendingPathComponent("private")
        try FileManager.default.createDirectory(at: selected.appendingPathComponent("nested"), withIntermediateDirectories: true)
        let target = selected.appendingPathComponent("nested/item")
        if folder { try FileManager.default.createDirectory(at: target, withIntermediateDirectories: false) }
        else { try bytes.write(to: target) }
        let owner = try FileSyncOwnerScope(ownerId: "trash-test", url: URL(string: "https://trash.test")!)
        let bookmark = try FolderBookmark.create(selected)
        let expected = try XCTUnwrap(MobileFolderReader.scan(bookmark: bookmark).first { $0.path == "nested/item" })
        let scope = MobileSyncStaging.Scope(origin: owner.origin.absoluteString, ownerId: owner.ownerId, dataPlane: "home",
            rootId: "connection", deviceId: "device")
        let request = MobileSyncTrash.Request(scope: scope, rootId: UUID().uuidString.lowercased(),
            operation: .init(id: UUID().uuidString.lowercased(), mutation: .init(kind: "trash", side: "local", path: expected.path, expected: expected), confirmed: false))
        return Fixture(base: base, selected: selected, storage: storage, target: target, owner: owner, bookmark: bookmark, request: request)
    }
    private func inspect(_ f: Fixture) throws -> MobileFolderReader.Entry {
        try XCTUnwrap(f.trash.inspect(f.request, owner: f.owner, bookmark: f.bookmark))
    }
    private func request(_ f: Fixture, entry: MobileFolderReader.Entry, parent: MobileSyncTrash.Parent? = nil,
                         child: String? = nil) -> MobileSyncTrash.Request {
        .init(scope: f.request.scope, rootId: f.request.rootId,
            operation: .init(id: UUID().uuidString.lowercased(), mutation: .init(kind: "trash", side: "local", path: entry.path, expected: entry), confirmed: false),
            parent: parent, childrenOperationId: child)
    }
    func testRecoveryPagesPreserveOwnershipAndPendingRestoreAcrossRestart() throws {
        struct Interrupted: Error {}
        let f = try fixture()
        _ = try f.trash.trash(f.request, owner: f.owner, bookmark: f.bookmark)
        let page = try f.trash.list(owner: f.owner, rootId: f.request.rootId, bookmark: f.bookmark)
        XCTAssertEqual(page.items.count, 1); XCTAssertNil(page.nextCursor)
        XCTAssertEqual(page.items[0].request, f.request); XCTAssertEqual(page.items[0].state, "retained")
        let other = try FileSyncOwnerScope(ownerId: "another-owner", url: f.owner.origin)
        XCTAssertTrue(try f.trash.list(owner: other, rootId: f.request.rootId, bookmark: f.bookmark).items.isEmpty)
        XCTAssertTrue(try f.trash.list(owner: f.owner, rootId: UUID().uuidString, bookmark: f.bookmark).items.isEmpty)
        XCTAssertThrowsError(try f.trash.list(owner: f.owner, rootId: f.request.rootId, bookmark: f.bookmark, cursor: "../bad"))
        let restore = MobileSyncTrash.Restore(path: "recovered", expected: try inspect(f))
        try Data("occupied".utf8).write(to: f.selected.appendingPathComponent(restore.path))
        XCTAssertThrowsError(try f.trash.reviewRestore(f.request, owner: f.owner, bookmark: f.bookmark, restore: restore))
        XCTAssertNil(try f.trash.restoration(f.request, owner: f.owner, bookmark: f.bookmark))
        try FileManager.default.removeItem(at: f.selected.appendingPathComponent(restore.path))
        try f.trash.reviewRestore(f.request, owner: f.owner, bookmark: f.bookmark, restore: restore)
        XCTAssertNil(try f.trash.resumeRestore(f.request, owner: f.owner, bookmark: f.bookmark, restore: restore))
        let interrupted = MobileSyncTrash(directory: f.storage, afterRestore: { throw Interrupted() })
        XCTAssertThrowsError(try interrupted.restore(f.request, owner: f.owner, bookmark: f.bookmark, restore: restore))
        let pending = try f.trash.list(owner: f.owner, rootId: f.request.rootId, bookmark: f.bookmark)
        XCTAssertEqual(pending.items.count, 1); XCTAssertEqual(pending.items[0].state, "restoring")
        XCTAssertEqual(pending.items[0].restore, restore)
        XCTAssertThrowsError(try f.trash.resumeRestore(f.request, owner: f.owner, bookmark: f.bookmark,
            restore: .init(path: "another-destination", expected: restore.expected)))
        let receipt = try XCTUnwrap(f.trash.resumeRestore(f.request, owner: f.owner, bookmark: f.bookmark, restore: restore))
        XCTAssertEqual(receipt.path, restore.path)
        XCTAssertEqual(try Data(contentsOf: f.selected.appendingPathComponent(restore.path)), Data("original bytes".utf8))
        XCTAssertTrue(try f.trash.list(owner: f.owner, rootId: f.request.rootId, bookmark: f.bookmark).items.isEmpty)
        XCTAssertEqual(try f.trash.restoration(f.request, owner: f.owner, bookmark: f.bookmark)?.receipt, receipt)
    }
    func testTrashAndRestoreInWideDirectoryKeepAllSiblingBytes() throws {
        let f = try fixture(), parent = f.selected.appendingPathComponent("nested")
        for index in 0...10_000 { try Data().write(to: parent.appendingPathComponent("sibling-\(index)")) }
        let receipt = try f.trash.trash(f.request, owner: f.owner, bookmark: f.bookmark)
        XCTAssertEqual(try f.trash.lookup(f.request, owner: f.owner, bookmark: f.bookmark).receipt, receipt)
        XCTAssertFalse(FileManager.default.fileExists(atPath: f.target.path))
        _ = try f.trash.restore(f.request, owner: f.owner, bookmark: f.bookmark,
            restore: .init(path: "nested/item", expected: inspect(f)))
        XCTAssertEqual(try Data(contentsOf: f.target), Data("original bytes".utf8))
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: parent.path).count, 10_002)
    }
    func testRecoveryPaginationHasNoDuplicatesAndIncludesPreviousConnections() throws {
        let f = try fixture()
        _ = try f.trash.trash(f.request, owner: f.owner, bookmark: f.bookmark)
        for i in 0..<23 {
            let path = "file-\(i)"
            try Data("bytes".utf8).write(to: f.selected.appendingPathComponent(path))
            let entry = try XCTUnwrap(MobileFolderReader.scan(bookmark: f.bookmark).first { $0.path == path })
            let op = request(f, entry: entry)
            let old = MobileSyncTrash.Request(scope: .init(origin: f.owner.origin.absoluteString, ownerId: f.owner.ownerId,
                dataPlane: "home", rootId: "prior-connection", deviceId: "prior-device"), rootId: f.request.rootId, operation: op.operation)
            _ = try f.trash.trash(old, owner: f.owner, bookmark: f.bookmark)
        }
        let first = try f.trash.list(owner: f.owner, rootId: f.request.rootId, bookmark: f.bookmark)
        XCTAssertEqual(first.items.count, 20)
        let second = try f.trash.list(owner: f.owner, rootId: f.request.rootId, bookmark: f.bookmark, cursor: XCTUnwrap(first.nextCursor))
        XCTAssertEqual(second.items.count, 4); XCTAssertNil(second.nextCursor)
        XCTAssertEqual(Set((first.items + second.items).map { $0.request.operation.id }).count, 24)
        let foreign = try FileSyncOwnerScope(ownerId: "another-owner", url: f.owner.origin)
        let empty = try f.trash.list(owner: foreign, rootId: f.request.rootId, bookmark: f.bookmark)
        XCTAssertTrue(empty.items.isEmpty); XCTAssertNotNil(empty.nextCursor)
    }
    func testChildReceiptsAdvanceAnEmptyParentWithoutChangingTheOriginalOperation() throws {
        let f = try fixture(), parent = try XCTUnwrap(MobileFolderReader.scan(bookmark: f.bookmark).first { $0.path == "nested" })
        let child = request(f, entry: f.request.operation.mutation.expected, parent: .init(expected: parent))
        _ = try f.trash.trash(child, owner: f.owner, bookmark: f.bookmark)
        let folder = request(f, entry: parent, child: child.operation.id)
        let expected = try f.trash.expected(folder, owner: f.owner, bookmark: f.bookmark)
        XCTAssertEqual(expected.id, parent.id); XCTAssertNotEqual(expected.version, parent.version)
        XCTAssertEqual(folder.operation.mutation.expected, parent)
        _ = try f.trash.trash(folder, owner: f.owner, bookmark: f.bookmark)
        XCTAssertFalse(FileManager.default.fileExists(atPath: f.selected.appendingPathComponent("nested").path))
        XCTAssertEqual(try f.trash.lookup(child, owner: f.owner, bookmark: f.bookmark).status, "complete")
        let retainedParent = try XCTUnwrap(f.trash.inspect(folder, owner: f.owner, bookmark: f.bookmark))
        _ = try f.trash.restore(folder, owner: f.owner, bookmark: f.bookmark, restore: .init(path: "nested", expected: retainedParent))
        let retainedChild = try XCTUnwrap(f.trash.inspect(child, owner: f.owner, bookmark: f.bookmark))
        _ = try f.trash.restore(child, owner: f.owner, bookmark: f.bookmark, restore: .init(path: "nested/item", expected: retainedChild))
        XCTAssertEqual(try Data(contentsOf: f.target), Data("original bytes".utf8))
    }
    func testSiblingsUseBoundedReceiptLinksAndRejectInterveningParentChanges() throws {
        for changed in [false, true] {
            let f = try fixture(), other = f.selected.appendingPathComponent("nested/other")
            try Data("sibling".utf8).write(to: other)
            let scan = try MobileFolderReader.scan(bookmark: f.bookmark)
            let parent = try XCTUnwrap(scan.first { $0.path == "nested" })
            let first = request(f, entry: f.request.operation.mutation.expected, parent: .init(expected: parent))
            let second = request(f, entry: try XCTUnwrap(scan.first { $0.path == "nested/other" }),
                parent: .init(expected: parent, previousOperationId: first.operation.id))
            _ = try f.trash.trash(first, owner: f.owner, bookmark: f.bookmark)
            if changed {
                let temporary = f.selected.appendingPathComponent("nested/external")
                try Data("external".utf8).write(to: temporary); try FileManager.default.removeItem(at: temporary)
                XCTAssertThrowsError(try f.trash.trash(second, owner: f.owner, bookmark: f.bookmark))
                XCTAssertEqual(try Data(contentsOf: other), Data("sibling".utf8))
            } else {
                _ = try f.trash.trash(second, owner: f.owner, bookmark: f.bookmark)
                _ = try f.trash.trash(request(f, entry: parent, child: second.operation.id), owner: f.owner, bookmark: f.bookmark)
                XCTAssertFalse(FileManager.default.fileExists(atPath: other.deletingLastPathComponent().path))
            }
        }
    }
    func testPostCrashChildReceiptDoesNotInventAParentTransition() throws {
        struct Interrupted: Error {}
        let f = try fixture(), parent = try XCTUnwrap(MobileFolderReader.scan(bookmark: f.bookmark).first { $0.path == "nested" })
        let child = request(f, entry: f.request.operation.mutation.expected, parent: .init(expected: parent))
        let worker = MobileSyncTrash(directory: f.storage, afterMove: { throw Interrupted() })
        XCTAssertThrowsError(try worker.trash(child, owner: f.owner, bookmark: f.bookmark))
        XCTAssertEqual(try f.trash.lookup(child, owner: f.owner, bookmark: f.bookmark).status, "complete")
        let folder = request(f, entry: parent, child: child.operation.id)
        XCTAssertThrowsError(try f.trash.expected(folder, owner: f.owner, bookmark: f.bookmark))
        XCTAssertThrowsError(try f.trash.trash(folder, owner: f.owner, bookmark: f.bookmark))
        XCTAssertTrue(FileManager.default.fileExists(atPath: f.selected.appendingPathComponent("nested").path))
    }
    func testRebasedFolderMoveRecoversAfterInterruptionAndRejectsForeignPredecessors() throws {
        struct Interrupted: Error {}
        let f = try fixture(), parent = try XCTUnwrap(MobileFolderReader.scan(bookmark: f.bookmark).first { $0.path == "nested" })
        let child = request(f, entry: f.request.operation.mutation.expected, parent: .init(expected: parent))
        _ = try f.trash.trash(child, owner: f.owner, bookmark: f.bookmark)
        XCTAssertThrowsError(try f.trash.expected(request(f, entry: parent, child: UUID().uuidString), owner: f.owner, bookmark: f.bookmark))
        let otherGrant = MobileSyncTrash.Request(scope: child.scope, rootId: UUID().uuidString, operation: request(f, entry: parent).operation,
            childrenOperationId: child.operation.id)
        XCTAssertThrowsError(try f.trash.expected(otherGrant, owner: f.owner, bookmark: f.bookmark))
        let folder = request(f, entry: parent, child: child.operation.id)
        let worker = MobileSyncTrash(directory: f.storage, afterMove: { throw Interrupted() })
        XCTAssertThrowsError(try worker.trash(folder, owner: f.owner, bookmark: f.bookmark))
        XCTAssertEqual(try f.trash.lookup(folder, owner: f.owner, bookmark: f.bookmark).status, "complete")
        XCTAssertEqual(try f.trash.inspect(folder, owner: f.owner, bookmark: f.bookmark)?.id, parent.id)
    }
    func testTrashAndExclusiveRestorePreserveFilesEmptyFilesAndEmptyFolders() throws {
        for kind in ["file", "empty-file", "folder"] {
            let bytes = kind == "empty-file" ? Data() : Data(repeating: 39, count: 131_079)
            let f = try fixture(bytes: bytes, folder: kind == "folder")
            XCTAssertEqual(try f.trash.lookup(f.request, owner: f.owner, bookmark: f.bookmark).status, "missing")
            let receipt = try f.trash.trash(f.request, owner: f.owner, bookmark: f.bookmark)
            XCTAssertEqual(receipt.operationId, f.request.operation.id)
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(receipt)) as? [String: Any])
            XCTAssertTrue(json["entry"] is NSNull)
            XCTAssertFalse(FileManager.default.fileExists(atPath: f.target.path))
            let retained = try inspect(f)
            XCTAssertEqual(retained.id, f.request.operation.mutation.expected.id)
            let restore = MobileSyncTrash.Restore(path: "nested/item", expected: retained)
            let restored = try f.trash.restore(f.request, owner: f.owner, bookmark: f.bookmark, restore: restore)
            XCTAssertEqual(restored.id, retained.id)
            if kind != "folder" { XCTAssertEqual(try Data(contentsOf: f.target), bytes) }
            else { XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: f.target.path), []) }
            XCTAssertNil(try f.trash.inspect(f.request, owner: f.owner, bookmark: f.bookmark))
            XCTAssertEqual(try f.trash.restore(f.request, owner: f.owner, bookmark: f.bookmark, restore: restore), restored)
            XCTAssertEqual(try f.trash.trash(f.request, owner: f.owner, bookmark: f.bookmark), receipt)
            XCTAssertTrue(FileManager.default.fileExists(atPath: f.target.path), "Retry must not trash a restored file again")
        }
    }
    func testInterruptedTrashRecoversAfterRelaunchAndPreservesARecreatedSource() throws {
        struct Interrupted: Error {}
        let f = try fixture()
        let worker = MobileSyncTrash(directory: f.storage, afterMove: { throw Interrupted() })
        XCTAssertThrowsError(try worker.trash(f.request, owner: f.owner, bookmark: f.bookmark))
        XCTAssertFalse(FileManager.default.fileExists(atPath: f.target.path))
        try Data("new local file".utf8).write(to: f.target)
        let lookup = try f.trash.lookup(f.request, owner: f.owner, bookmark: f.bookmark)
        XCTAssertEqual(lookup.status, "complete")
        XCTAssertEqual(try f.trash.trash(f.request, owner: f.owner, bookmark: f.bookmark), lookup.receipt)
        XCTAssertEqual(try Data(contentsOf: f.target), Data("new local file".utf8))
        let retained = try inspect(f)
        XCTAssertEqual(retained.fingerprint, f.request.operation.mutation.expected.fingerprint)
    }
    func testRestoreNeverOverwritesAndAllowsAReviewedAlternatePath() throws {
        let f = try fixture()
        _ = try f.trash.trash(f.request, owner: f.owner, bookmark: f.bookmark)
        let retained = try inspect(f)
        try Data("newer file".utf8).write(to: f.target)
        XCTAssertThrowsError(try f.trash.restore(f.request, owner: f.owner, bookmark: f.bookmark,
            restore: .init(path: "nested/item", expected: retained)))
        XCTAssertEqual(try inspect(f), retained)
        let restored = try f.trash.restore(f.request, owner: f.owner, bookmark: f.bookmark,
            restore: .init(path: "nested/recovered", expected: retained))
        XCTAssertEqual(restored.path, "nested/recovered")
        XCTAssertEqual(try Data(contentsOf: f.selected.appendingPathComponent(restored.path)), Data("original bytes".utf8))
        XCTAssertEqual(try Data(contentsOf: f.target), Data("newer file".utf8))
    }
    func testInterruptedRestoreRecoversWithoutMovingOrOverwritingAgain() throws {
        struct Interrupted: Error {}
        let f = try fixture()
        _ = try f.trash.trash(f.request, owner: f.owner, bookmark: f.bookmark)
        let restore = MobileSyncTrash.Restore(path: "nested/item", expected: try inspect(f))
        let worker = MobileSyncTrash(directory: f.storage, afterRestore: { throw Interrupted() })
        XCTAssertThrowsError(try worker.restore(f.request, owner: f.owner, bookmark: f.bookmark, restore: restore))
        let restored = try f.trash.restore(f.request, owner: f.owner, bookmark: f.bookmark, restore: restore)
        try Data("edited after restore".utf8).write(to: f.target, options: .atomic)
        XCTAssertEqual(try f.trash.restore(f.request, owner: f.owner, bookmark: f.bookmark, restore: restore), restored)
        XCTAssertEqual(try Data(contentsOf: f.target), Data("edited after restore".utf8))
    }
    func testRacingReplacementIsRetainedForExplicitReviewInsteadOfClaimingSuccess() throws {
        let f = try fixture()
        let worker = MobileSyncTrash(directory: f.storage, beforeMove: { try Data("racing replacement".utf8).write(to: f.target, options: .atomic) })
        XCTAssertThrowsError(try worker.trash(f.request, owner: f.owner, bookmark: f.bookmark))
        XCTAssertEqual(try f.trash.lookup(f.request, owner: f.owner, bookmark: f.bookmark).status, "pending")
        let retained = try inspect(f)
        XCTAssertNotEqual(retained.id, f.request.operation.mutation.expected.id)
        _ = try f.trash.restore(f.request, owner: f.owner, bookmark: f.bookmark,
            restore: .init(path: "nested/recovered-race", expected: retained))
        XCTAssertEqual(try Data(contentsOf: f.selected.appendingPathComponent("nested/recovered-race")), Data("racing replacement".utf8))
        XCTAssertThrowsError(try f.trash.trash(f.request, owner: f.owner, bookmark: f.bookmark))
    }
    func testChangedSourceNonemptyFolderAndSymbolicLinksRefuseBeforeMoving() throws {
        let changed = try fixture()
        try Data("changed".utf8).write(to: changed.target)
        XCTAssertThrowsError(try changed.trash.trash(changed.request, owner: changed.owner, bookmark: changed.bookmark))
        XCTAssertEqual(try Data(contentsOf: changed.target), Data("changed".utf8))
        let folder = try fixture(folder: true)
        try Data("keep".utf8).write(to: folder.target.appendingPathComponent("child"))
        XCTAssertThrowsError(try folder.trash.trash(folder.request, owner: folder.owner, bookmark: folder.bookmark))
        XCTAssertEqual(try Data(contentsOf: folder.target.appendingPathComponent("child")), Data("keep".utf8))
        let link = try fixture(), outside = link.base.appendingPathComponent("outside")
        try Data("outside".utf8).write(to: outside)
        try FileManager.default.removeItem(at: link.target)
        try FileManager.default.createSymbolicLink(at: link.target, withDestinationURL: outside)
        XCTAssertThrowsError(try link.trash.trash(link.request, owner: link.owner, bookmark: link.bookmark))
        XCTAssertEqual(try Data(contentsOf: outside), Data("outside".utf8))
    }
    func testRacingAncestorSymlinkCannotEscapeThePickerGrant() throws {
        let f = try fixture(), outside = f.base.appendingPathComponent("outside")
        try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: false)
        try Data("outside".utf8).write(to: outside.appendingPathComponent("item"))
        let worker = MobileSyncTrash(directory: f.storage, beforeMove: {
            try FileManager.default.moveItem(at: f.selected.appendingPathComponent("nested"), to: f.selected.appendingPathComponent("old-nested"))
            try FileManager.default.createSymbolicLink(at: f.selected.appendingPathComponent("nested"), withDestinationURL: outside)
        })
        XCTAssertThrowsError(try worker.trash(f.request, owner: f.owner, bookmark: f.bookmark))
        XCTAssertEqual(try Data(contentsOf: outside.appendingPathComponent("item")), Data("outside".utf8))
        XCTAssertEqual(try Data(contentsOf: f.selected.appendingPathComponent("old-nested/item")), Data("original bytes".utf8))
    }
    func testOwnerBookmarkAndImmutableOperationBindingsRejectSubstitution() throws {
        let f = try fixture()
        _ = try f.trash.trash(f.request, owner: f.owner, bookmark: f.bookmark)
        let other = try FileSyncOwnerScope(ownerId: "other", url: f.owner.origin)
        XCTAssertThrowsError(try f.trash.lookup(f.request, owner: other, bookmark: f.bookmark))
        let otherRoot = f.base.appendingPathComponent("other-root")
        try FileManager.default.createDirectory(at: otherRoot, withIntermediateDirectories: false)
        XCTAssertThrowsError(try f.trash.lookup(f.request, owner: f.owner, bookmark: FolderBookmark.create(otherRoot)))
        let e = f.request.operation.mutation.expected
        let altered = MobileFolderReader.Entry(path: e.path, id: e.id, version: "another", kind: e.kind, size: e.size, sha256: e.sha256, fingerprint: e.fingerprint)
        let request = MobileSyncTrash.Request(scope: f.request.scope, rootId: f.request.rootId, operation: .init(id: f.request.operation.id,
            mutation: .init(kind: "trash", side: "local", path: e.path, expected: altered), confirmed: false))
        XCTAssertThrowsError(try f.trash.lookup(request, owner: f.owner, bookmark: f.bookmark))
        XCTAssertNotNil(try inspect(f))
    }
    func testExposedJournalRefusesWithoutRemovingTheSource() throws {
        let f = try fixture()
        try FileManager.default.createDirectory(at: f.storage, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o755])
        XCTAssertThrowsError(try f.trash.trash(f.request, owner: f.owner, bookmark: f.bookmark))
        XCTAssertEqual(try Data(contentsOf: f.target), Data("original bytes".utf8))
    }
    func testSelectingTheJournalCannotMoveItsOwnLockOrRetainedData() throws {
        let f = try fixture()
        _ = try f.trash.trash(f.request, owner: f.owner, bookmark: f.bookmark)
        let bookmark = try FolderBookmark.create(f.storage)
        let lock = try XCTUnwrap(MobileFolderReader.scan(bookmark: bookmark).first { $0.path == "lock" })
        let request = MobileSyncTrash.Request(scope: f.request.scope, rootId: UUID().uuidString.lowercased(),
            operation: .init(id: UUID().uuidString.lowercased(), mutation: .init(kind: "trash", side: "local", path: lock.path, expected: lock), confirmed: false))
        XCTAssertThrowsError(try f.trash.trash(request, owner: f.owner, bookmark: bookmark))
        XCTAssertTrue(FileManager.default.fileExists(atPath: f.storage.appendingPathComponent("lock").path))
        XCTAssertNotNil(try inspect(f))
    }
    func testFolderPopulatedDuringTrashRaceCanBeExplicitlyRecoveredWithoutTraversingChildren() throws {
        let f = try fixture(folder: true), outside = f.base.appendingPathComponent("outside")
        try Data("outside bytes".utf8).write(to: outside)
        let worker = MobileSyncTrash(directory: f.storage, beforeMove: {
            try Data("racing child".utf8).write(to: f.target.appendingPathComponent("child"))
            try FileManager.default.createSymbolicLink(at: f.target.appendingPathComponent("link"), withDestinationURL: outside)
        })
        XCTAssertThrowsError(try worker.trash(f.request, owner: f.owner, bookmark: f.bookmark))
        XCTAssertEqual(try f.trash.lookup(f.request, owner: f.owner, bookmark: f.bookmark).status, "pending")
        let retained = try inspect(f)
        XCTAssertEqual(retained.kind, "folder")
        struct Interrupted: Error {}
        let restore = MobileSyncTrash.Restore(path: "nested/recovered-tree", expected: retained)
        let interrupted = MobileSyncTrash(directory: f.storage, afterRestore: { throw Interrupted() })
        XCTAssertThrowsError(try interrupted.restore(f.request, owner: f.owner, bookmark: f.bookmark, restore: restore))
        let recovered = try f.trash.restore(f.request, owner: f.owner, bookmark: f.bookmark, restore: restore)
        let directory = f.selected.appendingPathComponent(recovered.path)
        XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent("child")), Data("racing child".utf8))
        XCTAssertEqual(try FileManager.default.destinationOfSymbolicLink(atPath: directory.appendingPathComponent("link").path), outside.path)
        XCTAssertEqual(try Data(contentsOf: outside), Data("outside bytes".utf8))
        XCTAssertEqual(try f.trash.lookup(f.request, owner: f.owner, bookmark: f.bookmark).status, "pending")
    }

}
