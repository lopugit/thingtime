@testable import AppleFileSync
import XCTest
import Darwin

@MainActor final class NativeSymbolicLinkTests: XCTestCase {
    override func invokeTest() {
        let receipts = FileManager.default.temporaryDirectory.appendingPathComponent("thingtime-link-receipts-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: receipts) }
        NativeSymbolicLinks.$receiptDirectory.withValue(receipts) { super.invokeTest() }
    }
    func directory() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("thingtime-links-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }; return url
    }
    func testScanReadBrokenLoopAbsoluteAndNonUTF8LinksNeverResolveTargets() throws {
        let root = try directory(), bookmark = try FolderBookmark.create(root)
        let fd = open(root.path, O_RDONLY | O_DIRECTORY); defer { close(fd) }
        let targets = [Data("../outside-do-not-read".utf8), Data("loop".utf8), Data("/private/nonexistent-source".utf8), Data([0xff, 0xfe, 0x2f, 0x61])]
        for (index, target) in targets.enumerated() { try NativeSymbolicLinks.create(fd, name: index == 1 ? "loop" : "link-\(index)", link: NativeSymbolicLink(target: target)) }
        let rows = try MobileFolderReader.scan(bookmark: bookmark)
        XCTAssertEqual(rows.count, targets.count)
        for row in rows {
            let bytes = try XCTUnwrap(row.symbolicLink).target()
            XCTAssertEqual(row.size, Int64(bytes.count))
            XCTAssertEqual(try MobileFolderReader.inspect(bookmark: bookmark, path: row.path), row)
            let chunk = try MobileFolderReader.read(bookmark: bookmark, path: row.path, version: row.version, offset: 0, length: 65_536)
            XCTAssertEqual(Data(base64Encoded: chunk.data), bytes)
            XCTAssertEqual(try MobileFolderBulkReader.read(bookmark: bookmark, expected: row).bytes, bytes)
        }
        XCTAssertThrowsError(try MobileFolderReader.inspect(bookmark: bookmark, path: "loop/child"))
    }
    func fixture(target: Data, prior: Bool, fallback: Bool, sourceLink: Bool = true, regularPrior: Bool = false, destinationRoot: URL? = nil) throws -> (URL, URL, FileSyncOwnerScope, MobileSyncStaging.Request, Data, MobileSyncStaging.Stage) {
        let root = try directory(), selected = destinationRoot?.appendingPathComponent("thingtime-selected-" + UUID().uuidString) ?? root.appendingPathComponent("selected"), storage = root.appendingPathComponent("private")
        try FileManager.default.createDirectory(at: selected, withIntermediateDirectories: true)
        if destinationRoot != nil { addTeardownBlock { try? FileManager.default.removeItem(at: selected) } }
        let bookmark = try FolderBookmark.create(selected)
        if prior {
            if regularPrior { try Data("prior-regular-bytes".utf8).write(to: selected.appendingPathComponent("link")) }
            else { try FileManager.default.createSymbolicLink(atPath: selected.appendingPathComponent("link").path, withDestinationPath: "../old-missing") }
        }
        let before = try MobileFolderReader.inspect(bookmark: bookmark, path: "link")
        let owner = try FileSyncOwnerScope(ownerId: "link-fixture", url: URL(string: "https://fixture.invalid")!)
        let scope = MobileSyncStaging.Scope(origin: owner.origin.absoluteString, ownerId: owner.ownerId, dataPlane: "home", rootId: "config", deviceId: "fixture")
        let source = MobileFolderReader.Entry(path: "link", id: "remote-link", version: "v1", kind: "file", size: Int64(target.count), sha256: nil,
            fingerprint: NativeSymbolicLinks.fingerprint(target), symbolicLink: sourceLink ? try NativeSymbolicLink(target: target) : nil)
        let request = MobileSyncStaging.Request(scope: scope, rootId: UUID().uuidString,
            operation: .init(id: UUID().uuidString, mutation: .init(kind: "copy", from: "remote", path: "link", source: source, expectedTarget: before), confirmed: false))
        let staging = MobileSyncStaging(directory: storage, unsupportedLinks: fallback)
        _ = try staging.begin(request, owner: owner); _ = try staging.append(request, owner: owner, offset: 0, bytes: target)
        return (storage, selected, owner, request, bookmark, try XCTUnwrap(staging.finish(request, owner: owner).stage))
    }
    func testPublicationReplacementRestartRecoveryAndPortableFallback() throws {
        struct Interrupted: Error {}
        for fallback in [false, true] { for prior in [false, true] {
            let target = Data([0xff, 0x2f, 0x61])
            let (storage, selected, owner, request, bookmark, stage) = try fixture(target: target, prior: prior, fallback: fallback)
            let interrupted = MobileSyncStaging(directory: storage, afterPublication: { throw Interrupted() }, unsupportedLinks: fallback)
            XCTAssertThrowsError(try interrupted.publish(request, owner: owner, bookmark: bookmark, stage: stage))
            let restarted = MobileSyncStaging(directory: storage)
            let receipt = try XCTUnwrap(restarted.lookup(request, owner: owner, bookmark: bookmark).receipt)
            XCTAssertEqual(receipt.entry.symbolicLink, request.operation.mutation.source.symbolicLink)
            XCTAssertEqual(try MobileFolderReader.inspect(bookmark: bookmark, path: "link"), receipt.entry)
            XCTAssertEqual(try restarted.publish(request, owner: owner, bookmark: bookmark, stage: stage), receipt)
            let rows = try MobileFolderReader.scan(bookmark: bookmark)
            XCTAssertEqual(rows.map(\.path), ["link"])
            if fallback {
                let bytes = try Data(contentsOf: selected.appendingPathComponent("link"))
                let json = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
                XCTAssertEqual(json["tags"] as? [String], ["former-symbolic-link"])
                try bytes.write(to: selected.appendingPathComponent("copied-envelope"))
                XCTAssertNil(try MobileFolderReader.inspect(bookmark: bookmark, path: "copied-envelope")?.symbolicLink)
            }
        } }
    }
    func testRegularToLinkAndLinkToRegularKeepDisplacedInodeAcrossLostReply() throws {
        struct Interrupted: Error {}
        for sourceLink in [false, true] {
            let bytes = Data("replacement-content".utf8)
            let (storage, selected, owner, request, bookmark, stage) = try fixture(target: bytes, prior: true, fallback: false, sourceLink: sourceLink, regularPrior: sourceLink)
            let prior = try XCTUnwrap(request.operation.mutation.expectedTarget)
            XCTAssertThrowsError(try MobileSyncStaging(directory: storage, afterPublication: { throw Interrupted() }).publish(request, owner: owner, bookmark: bookmark, stage: stage))
            let restored = MobileSyncStaging(directory: storage)
            let receipt = try XCTUnwrap(restored.lookup(request, owner: owner, bookmark: bookmark).receipt)
            XCTAssertEqual(receipt.entry.symbolicLink, request.operation.mutation.source.symbolicLink)
            XCTAssertEqual(try MobileFolderReader.inspect(bookmark: bookmark, path: "link"), receipt.entry)
            let journal = selected.appendingPathComponent(".thingtime-link-journal-" + request.operation.id)
            let fd = open(journal.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW); defer { close(fd) }
            let old = try XCTUnwrap(NativeSymbolicLinks.openEntry(fd, name: "publication")); defer { close(old) }
            XCTAssertEqual(NativeSymbolicLinks.identity(try MobileFolderReader.info(old)), prior.id)
            try NativeFileDestination.verifyContent(old, source: prior)
            XCTAssertEqual(try restored.publish(request, owner: owner, bookmark: bookmark, stage: stage), receipt)
        }
    }
    func testPermissionsFullDiskAndCollisionsNeverBecomeFallbacks() throws {
        let root = try directory(), fd = open(root.path, O_RDONLY | O_DIRECTORY); defer { close(fd) }
        let link = try NativeSymbolicLink(target: Data("missing".utf8))
        for code in [EACCES, EPERM, ENOSPC, EDQUOT, EIO, EEXIST, EINVAL] {
            XCTAssertThrowsError(try NativeSymbolicLinks.create(fd, name: "candidate", link: link, syscall: { _, _, _ in errno = code; return -1 }))
            var info = stat(); XCTAssertNotEqual(fstatat(fd, "candidate", &info, AT_SYMLINK_NOFOLLOW), 0)
        }
    }
    func testTrashRestartAndRestorePreserveLinkAndFallbackMetadata() throws {
        struct Interrupted: Error {}
        for fallback in [false, true] {
            let (storage, selected, owner, publication, bookmark, stage) = try fixture(target: Data("../broken".utf8), prior: false, fallback: fallback)
            let receipt = try MobileSyncStaging(directory: storage, unsupportedLinks: fallback).publish(publication, owner: owner, bookmark: bookmark, stage: stage)
            let request = MobileSyncTrash.Request(scope: publication.scope, rootId: publication.rootId,
                operation: .init(id: UUID().uuidString, mutation: .init(kind: "trash", side: "local", path: "link", expected: receipt.entry), confirmed: false))
            let trashStore = storage.deletingLastPathComponent().appendingPathComponent("trash")
            let interrupted = MobileSyncTrash(directory: trashStore, afterMove: { throw Interrupted() })
            XCTAssertThrowsError(try interrupted.trash(request, owner: owner, bookmark: bookmark))
            let trash = MobileSyncTrash(directory: trashStore)
            XCTAssertEqual(try trash.lookup(request, owner: owner, bookmark: bookmark).status, "complete")
            XCTAssertNil(try MobileFolderReader.inspect(bookmark: bookmark, path: "link"))
            let expected = try XCTUnwrap(trash.inspect(request, owner: owner, bookmark: bookmark))
            XCTAssertEqual(expected.symbolicLink, receipt.entry.symbolicLink)
            XCTAssertEqual(try trash.list(owner: owner, rootId: request.rootId, bookmark: bookmark).items.count, 1)
            let restore = MobileSyncTrash.Restore(path: "link", expected: expected)
            XCTAssertThrowsError(try MobileSyncTrash(directory: trashStore, afterRestore: { throw Interrupted() }).restore(request, owner: owner, bookmark: bookmark, restore: restore))
            let restored = try MobileSyncTrash(directory: trashStore).restore(request, owner: owner, bookmark: bookmark, restore: restore)
            XCTAssertEqual(restored.symbolicLink, receipt.entry.symbolicLink)
            XCTAssertEqual(try MobileFolderReader.scan(bookmark: bookmark).map(\.path), ["link"])
            XCTAssertEqual(try MobileFolderReader.inspect(bookmark: bookmark, path: "link"), restored)
            XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: selected.path).filter { !$0.hasPrefix(".thingtime-link-") }, ["link"])
        }
    }
    func testExplicitDownloadRehydratesSameTargetFallbackOnCapableFilesystem() throws {
        let bytes = Data("../unchanged-target".utf8)
        let (storage, _, owner, original, bookmark, stage) = try fixture(target: bytes, prior: false, fallback: true)
        let fallback = try MobileSyncStaging(directory: storage, unsupportedLinks: true).publish(original, owner: owner, bookmark: bookmark, stage: stage)
        let request = MobileSyncStaging.Request(scope: original.scope, rootId: original.rootId,
            operation: .init(id: UUID().uuidString, mutation: .init(kind: "copy", from: "remote", path: "link", source: original.operation.mutation.source, expectedTarget: fallback.entry), confirmed: false))
        let explicit = MobileSyncStaging(directory: storage)
        _ = try explicit.begin(request, owner: owner); _ = try explicit.append(request, owner: owner, offset: 0, bytes: bytes)
        let prepared = try XCTUnwrap(explicit.finish(request, owner: owner).stage)
        let receipt = try explicit.publish(request, owner: owner, bookmark: bookmark, stage: prepared)
        try MobileFolderReader.access(bookmark) { root in
            var actual = stat(); XCTAssertEqual(fstatat(root, "link", &actual, AT_SYMLINK_NOFOLLOW), 0)
            XCTAssertEqual(actual.st_mode & S_IFMT, S_IFLNK)
        }
        XCTAssertEqual(receipt.entry.symbolicLink, fallback.entry.symbolicLink)
    }
    func testOnlyVerifiedJournalIdentityIsHiddenAndOutsideTargetIsUntouched() throws {
        let selected = try directory(), outside = try directory().appendingPathComponent("sentinel")
        try Data("outside-original".utf8).write(to: outside)
        let userJournal = selected.appendingPathComponent(".thingtime-link-journal-user-folder")
        try FileManager.default.createDirectory(at: userJournal, withIntermediateDirectories: true)
        try Data("user-content".utf8).write(to: userJournal.appendingPathComponent("keep"))
        try FileManager.default.createSymbolicLink(atPath: selected.appendingPathComponent("outside-link").path, withDestinationPath: outside.path)
        let bookmark = try FolderBookmark.create(selected), rows = try MobileFolderReader.scan(bookmark: bookmark)
        XCTAssertTrue(rows.contains { $0.path == ".thingtime-link-journal-user-folder/keep" })
        let link = try XCTUnwrap(rows.first { $0.path == "outside-link" })
        let payload = try MobileFolderBulkReader.read(bookmark: bookmark, expected: link)
        XCTAssertEqual(payload.bytes, Data(outside.path.utf8))
        XCTAssertEqual(try Data(contentsOf: outside), Data("outside-original".utf8))
    }
    func testMountedUnsupportedFilesystemCrossVolumePublicationAndTrashRecovery() throws {
        guard let path = ProcessInfo.processInfo.environment["THINGTIME_SYMLINK_TEST_DESTINATION"] else {
            throw XCTSkip("Requires explicitly mounted task-owned unsupported filesystem")
        }
        struct Interrupted: Error {}
        for rawTarget in [false, true] { for forceFallback in [false, true] {
        let bytes = rawTarget ? Data([0xff, 0xfe, 0x2f, 0x61]) : Data("../preserved-raw-target".utf8), mounted = URL(fileURLWithPath: path)
        let (storage, selected, owner, first, bookmark, stage) = try fixture(target: bytes, prior: false, fallback: forceFallback, destinationRoot: mounted)
        let sourceDevice = (try FileManager.default.attributesOfFileSystem(forPath: storage.path))[.systemNumber] as? NSNumber
        let destinationDevice = (try FileManager.default.attributesOfFileSystem(forPath: selected.path))[.systemNumber] as? NSNumber
        XCTAssertNotEqual(sourceDevice, destinationDevice)
        XCTAssertThrowsError(try MobileSyncStaging(directory: storage, afterPublication: { throw Interrupted() }, unsupportedLinks: forceFallback).publish(first, owner: owner, bookmark: bookmark, stage: stage))
        var receipt = try XCTUnwrap(MobileSyncStaging(directory: storage).lookup(first, owner: owner, bookmark: bookmark).receipt)
        XCTAssertNotNil(receipt.entry.symbolicLink)
        if forceFallback || rawTarget {
            let envelope = try Data(contentsOf: selected.appendingPathComponent("link"))
            XCTAssertEqual((try JSONSerialization.jsonObject(with: envelope) as? [String: Any])?["tags"] as? [String], ["former-symbolic-link"])
        }
        for link in [false, true] {
            let source = MobileFolderReader.Entry(path: "link", id: "remote", version: UUID().uuidString, kind: "file", size: Int64(bytes.count), sha256: nil,
                fingerprint: NativeSymbolicLinks.fingerprint(bytes), symbolicLink: link ? try NativeSymbolicLink(target: bytes) : nil)
            let request = MobileSyncStaging.Request(scope: first.scope, rootId: first.rootId,
                operation: .init(id: UUID().uuidString, mutation: .init(kind: "copy", from: "remote", path: "link", source: source, expectedTarget: receipt.entry), confirmed: false))
            let staging = MobileSyncStaging(directory: storage, afterPublication: { throw Interrupted() }, unsupportedLinks: forceFallback)
            _ = try staging.begin(request, owner: owner); _ = try staging.append(request, owner: owner, offset: 0, bytes: bytes)
            let prepared = try XCTUnwrap(staging.finish(request, owner: owner).stage)
            XCTAssertThrowsError(try staging.publish(request, owner: owner, bookmark: bookmark, stage: prepared))
            receipt = try XCTUnwrap(MobileSyncStaging(directory: storage).lookup(request, owner: owner, bookmark: bookmark).receipt)
            XCTAssertEqual(receipt.entry.symbolicLink, source.symbolicLink)
            XCTAssertEqual(try MobileFolderReader.inspect(bookmark: bookmark, path: "link"), receipt.entry)
        }
        let request = MobileSyncTrash.Request(scope: first.scope, rootId: first.rootId,
            operation: .init(id: UUID().uuidString, mutation: .init(kind: "trash", side: "local", path: "link", expected: receipt.entry), confirmed: false))
        let trashStore = storage.deletingLastPathComponent().appendingPathComponent("trash")
        XCTAssertThrowsError(try MobileSyncTrash(directory: trashStore, afterMove: { throw Interrupted() }).trash(request, owner: owner, bookmark: bookmark))
        let trash = MobileSyncTrash(directory: trashStore)
        XCTAssertEqual(try trash.lookup(request, owner: owner, bookmark: bookmark).status, "complete")
        let retained = try XCTUnwrap(trash.inspect(request, owner: owner, bookmark: bookmark))
        let restore = MobileSyncTrash.Restore(path: "link", expected: retained)
        XCTAssertThrowsError(try MobileSyncTrash(directory: trashStore, afterRestore: { throw Interrupted() }).restore(request, owner: owner, bookmark: bookmark, restore: restore))
        let restored = try MobileSyncTrash(directory: trashStore).restore(request, owner: owner, bookmark: bookmark, restore: restore)
        XCTAssertEqual(restored.symbolicLink, first.operation.mutation.source.symbolicLink)
        XCTAssertEqual(try MobileFolderReader.scan(bookmark: bookmark).map(\.path), ["link"])
        } }
    }
    func testMountedFATDisplacementInterruptionResumesAndRefusesConcurrentWriter() throws {
        guard let path = ProcessInfo.processInfo.environment["THINGTIME_SYMLINK_TEST_DESTINATION"] else { throw XCTSkip("Requires explicitly mounted task-owned FAT filesystem") }
        struct Interrupted: Error {}
        for concurrent in [false, true] {
            let bytes = Data("../old-target".utf8), mounted = URL(fileURLWithPath: path)
            let (storage, selected, owner, first, bookmark, stage) = try fixture(target: bytes, prior: false, fallback: true, destinationRoot: mounted)
            let prior = try MobileSyncStaging(directory: storage, unsupportedLinks: true).publish(first, owner: owner, bookmark: bookmark, stage: stage)
            let source = MobileFolderReader.Entry(path: "link", id: "remote", version: "new-regular", kind: "file", size: Int64(bytes.count), sha256: nil, fingerprint: NativeSymbolicLinks.fingerprint(bytes))
            let request = MobileSyncStaging.Request(scope: first.scope, rootId: first.rootId,
                operation: .init(id: UUID().uuidString, mutation: .init(kind: "copy", from: "remote", path: "link", source: source, expectedTarget: prior.entry), confirmed: false))
            let staging = MobileSyncStaging(directory: storage, afterDisplacement: { throw Interrupted() })
            _ = try staging.begin(request, owner: owner); _ = try staging.append(request, owner: owner, offset: 0, bytes: bytes)
            let prepared = try XCTUnwrap(staging.finish(request, owner: owner).stage)
            XCTAssertThrowsError(try staging.publish(request, owner: owner, bookmark: bookmark, stage: prepared)) { XCTAssertTrue($0 is Interrupted) }
            XCTAssertNil(try MobileFolderReader.inspect(bookmark: bookmark, path: "link"))
            let restarted = MobileSyncStaging(directory: storage)
            if concurrent {
                let userBytes = Data("concurrent-writer".utf8)
                try userBytes.write(to: selected.appendingPathComponent("link"))
                XCTAssertThrowsError(try restarted.publish(request, owner: owner, bookmark: bookmark, stage: prepared))
                XCTAssertEqual(try restarted.lookup(request, owner: owner, bookmark: bookmark).status, "pending")
                XCTAssertEqual(try Data(contentsOf: selected.appendingPathComponent("link")), userBytes)
            } else {
                let receipt = try restarted.publish(request, owner: owner, bookmark: bookmark, stage: prepared)
                XCTAssertNil(receipt.entry.symbolicLink)
                XCTAssertEqual(try Data(contentsOf: selected.appendingPathComponent("link")), bytes)
            }
            let journal = selected.appendingPathComponent(".thingtime-link-journal-" + request.operation.id)
            let fd = open(journal.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW); defer { close(fd) }
            let old = try XCTUnwrap(NativeSymbolicLinks.openEntry(fd, name: "displaced")); defer { close(old) }
            XCTAssertEqual(NativeSymbolicLinks.identity(try MobileFolderReader.info(old)), prior.entry.id)
            try NativeFileDestination.verifyContent(old, source: prior.entry)
        }
    }
    func testInvalidTargetsAndParentEscapeRefuse() throws {
        XCTAssertThrowsError(try NativeSymbolicLink(target: Data()))
        XCTAssertThrowsError(try NativeSymbolicLink(target: Data([0])))
        let (_, selected, owner, request, bookmark, stage) = try fixture(target: Data("missing".utf8), prior: false, fallback: false)
        try FileManager.default.createSymbolicLink(atPath: selected.appendingPathComponent(".thingtime-link-journal-" + request.operation.id).path, withDestinationPath: "/tmp")
        let storage = selected.deletingLastPathComponent().appendingPathComponent("private")
        XCTAssertThrowsError(try MobileSyncStaging(directory: storage).publish(request, owner: owner, bookmark: bookmark, stage: stage))
        XCTAssertNil(try MobileFolderReader.inspect(bookmark: bookmark, path: "link"))
    }
}
