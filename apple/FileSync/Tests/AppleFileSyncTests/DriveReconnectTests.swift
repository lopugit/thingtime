@testable import AppleFileSync
import Foundation
import XCTest
import Darwin
import CryptoKit

final class DriveReconnectTests: XCTestCase {
    func testPersistentAliasSurvivesReuseOfAnOlderAttachmentNumber() throws {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent("tt-alias-reuse-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: base) }
        try NativeSymbolicLinks.$receiptDirectory.withValue(base.appendingPathComponent("receipts")) {
            let source = base.appendingPathComponent("source"), journal = source.appendingPathComponent("private-journal")
            try FileManager.default.createDirectory(at: journal, withIntermediateDirectories: true)
            let parent = open(source.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            let directory = open(journal.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            XCTAssertGreaterThanOrEqual(parent, 0); XCTAssertGreaterThanOrEqual(directory, 0)
            defer { close(parent); close(directory) }
            try NativeSymbolicLinks.register(directory, link: nil, journal: true)
            try NativeSymbolicLinks.create(parent, name: "portable-link", link: .init(target: Data("elsewhere".utf8)), forceUnsupported: true)
            for record in try FileManager.default.contentsOfDirectory(at: base.appendingPathComponent("receipts"), includingPropertiesForKeys: nil) {
                let file = record.appendingPathComponent("record.json")
                var row = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as! [String: Any]
                let continuity = try XCTUnwrap(row["continuity"] as? String)
                guard record.lastPathComponent == NativeSymbolicLinks.hash(Data(("persistent:" + continuity).utf8)) else { continue }
                // Keep current-A and stable-B aliases for the same verified
                // persistent object, as after B -> A attachment-number reuse.
                let identity = try XCTUnwrap(row["identity"] as? String)
                row["identity"] = "999999:" + identity.split(separator: ":").last!
                try JSONSerialization.data(withJSONObject: row).write(to: file)
            }
            let owner = try FileSyncOwnerScope(ownerId: "synthetic", url: URL(string: "https://fixture.invalid")!)
            let scope = MobileFolderInventory.Scope(owner: owner, deviceId: "synthetic", rootId: UUID().uuidString)
            let bookmark = try FolderBookmark.create(source), inventory = try RustIndexFixture.inventory(directory: base.appendingPathComponent("cache"))
            let capture = try inventory.prepareBackup(scope, id: UUID().uuidString, generation: UUID().uuidString, bookmark: bookmark)
            try inventory.sealBackup(scope, capture: capture, bookmark: bookmark)
            XCTAssertEqual(capture.coverage, "full")
            let entries = try inventory.read(scope, capture: capture, bookmark: bookmark, offset: 0).entries
            XCTAssertEqual(entries.map(\.path), ["portable-link"])
            XCTAssertEqual(try XCTUnwrap(entries.first?.symbolicLink).target(), Data("elsewhere".utf8))
        }
    }
    func testKnownMismatchedUUIDCannotBorrowCurrentDeviceIdentity() throws {
        let base = FileManager.default.temporaryDirectory.appendingPathComponent("tt-receipt-uuid-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: base) }
        try NativeSymbolicLinks.$receiptDirectory.withValue(base.appendingPathComponent("receipts")) {
            let source = base.appendingPathComponent("source"), journal = source.appendingPathComponent("private-journal")
            try FileManager.default.createDirectory(at: journal, withIntermediateDirectories: true)
            let parent = open(source.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            let directory = open(journal.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            XCTAssertGreaterThanOrEqual(parent, 0); XCTAssertGreaterThanOrEqual(directory, 0)
            defer { close(parent); close(directory) }
            try NativeSymbolicLinks.register(directory, link: nil, journal: true)
            try NativeSymbolicLinks.create(parent, name: "portable-link", link: .init(target: Data("elsewhere".utf8)), forceUnsupported: true)
            for record in try FileManager.default.contentsOfDirectory(at: base.appendingPathComponent("receipts"), includingPropertiesForKeys: nil) {
                let file = record.appendingPathComponent("record.json")
                var row = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as! [String: Any]
                guard let continuity = row["continuity"] as? String else { return XCTFail("Fixture needs a measured UUID anchor") }
                if record.lastPathComponent == NativeSymbolicLinks.hash(Data(("persistent:" + continuity).utf8)) {
                    try FileManager.default.removeItem(at: record)
                } else {
                    row["continuity"] = "different-volume:" + continuity
                    try JSONSerialization.data(withJSONObject: row).write(to: file)
                }
            }
            XCTAssertFalse(NativeSymbolicLinks.isOwnedJournal(parent, name: "private-journal"))
            XCTAssertThrowsError(try NativeSymbolicLinks.checkedOwnedJournal(parent, name: "private-journal"))
            let link = openat(parent, "portable-link", O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
            XCTAssertGreaterThanOrEqual(link, 0); defer { close(link) }
            XCTAssertNil(try NativeSymbolicLinks.bytes(link), "A known UUID mismatch must not reinterpret an ordinary file as a portable link")
            let owner = try FileSyncOwnerScope(ownerId: "synthetic", url: URL(string: "https://fixture.invalid")!)
            let scope = MobileFolderInventory.Scope(owner: owner, deviceId: "synthetic", rootId: UUID().uuidString)
            let bookmark = try FolderBookmark.create(source), inventory = try RustIndexFixture.inventory(directory: base.appendingPathComponent("cache"))
            let capture = try inventory.prepareBackup(scope, id: UUID().uuidString, generation: UUID().uuidString, bookmark: bookmark)
            try inventory.sealBackup(scope, capture: capture, bookmark: bookmark)
            XCTAssertEqual(capture.coverage, "partial")
            let entries = try inventory.read(scope, capture: capture, bookmark: bookmark, offset: 0).entries
            XCTAssertFalse(entries.contains { $0.path.hasPrefix("private-journal") })
            XCTAssertNil(entries.first { $0.path == "portable-link" }?.symbolicLink)
        }
    }
    func testDeletedSelectedFolderOnMountedVolumeIsNotAnOfflineRetry() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("tt-deleted-bookmark-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        let bookmark = try FolderBookmark.create(root)
        try FileManager.default.removeItem(at: root)
        var stale = false
        do {
            _ = try FolderBookmark.resolve(bookmark, stale: &stale)
            XCTAssertTrue(stale, "A deleted root must not resolve as a current grant")
        } catch {
            if case FolderReconnectFailure.offline = error { XCTFail("Deletion on an online volume must not become an endless volume retry") }
        }
    }
    /// Uses only images and mountpoints created by this test. Never eject a
    /// user drive. Opt in because hdiutil is unavailable in sandboxed CI.
    func testRealRemountInvalidatesRetainedNativeInventory() throws {
        try remountFixture(legacy: false)
    }
    func testExistingBookmarkMigratesLegacyCaptureAfterRealRemount() throws {
        try remountFixture(legacy: true)
    }
    func testCrossVolumePreparedDownloadRecoversAfterRemount() throws {
        try remountFixture(legacy: false, publicationPhase: "prepared")
    }
    func testCrossVolumePublishedDownloadRecoversLostReceiptAfterRemount() throws {
        try remountFixture(legacy: false, publicationPhase: "published")
    }
    func testCrossVolumeTwoStepDisplacementRecoversAfterRemount() throws {
        try remountFixture(legacy: false, publicationPhase: "displaced")
    }
    func testLaterEditAfterRemountRetainsUncertainPublication() throws {
        try remountFixture(legacy: false, publicationPhase: "edited")
    }
    func testReplacedJournalAfterRemountIsRefused() throws {
        try remountFixture(legacy: false, publicationPhase: "replaced-journal")
    }
    func testSameMountpointRemountReconcilesWithoutChangingGrant() throws {
        try remountFixture(legacy: false, sameMountpoint: true)
    }
    func testCompletedJournalAndPortableLinkStayPrivateAndTypedAfterRemount() throws {
        try remountFixture(legacy: false, publicationPhase: "completed")
    }
    func testCurrentAttachmentMigratesLegacyJournalAndLinkReceiptsBeforeReconnect() throws {
        try remountFixture(legacy: false, publicationPhase: "legacy-receipts")
    }
    func testUnboundLegacyJournalRemainsUnreadableInsteadOfUploadingPrivateBytes() throws {
        try remountFixture(legacy: false, publicationPhase: "unbound-legacy")
    }
    func testAbandonedCaptureRemainsInterruptedAfterRealRemount() throws {
        try remountFixture(legacy: false, abandoned: true)
    }
    private func remountFixture(legacy: Bool, publicationPhase: String? = nil, sameMountpoint: Bool = false, abandoned: Bool = false) throws {
        guard ProcessInfo.processInfo.environment["THINGTIME_TEST_DRIVE_REMOUNT"] == "1" else {
            throw XCTSkip("Set THINGTIME_TEST_DRIVE_REMOUNT=1 for disposable APFS remount acceptance")
        }
        let base = FileManager.default.temporaryDirectory.appendingPathComponent("tt-native-remount-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        try NativeSymbolicLinks.$receiptDirectory.withValue(base.appendingPathComponent("receipts")) {
        var mounted: [String] = []
        func run(_ args: [String]) throws -> Data {
            let process = Process(), output = Pipe(), errors = Pipe()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/hdiutil"); process.arguments = args
            process.standardOutput = output; process.standardError = errors
            try process.run()
            let data = output.fileHandleForReading.readDataToEndOfFile()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else { throw NSError(domain: "Synthetic diskimage command", code: Int(process.terminationStatus)) }
            return data
        }
        func attach(_ image: String, at name: String) throws -> URL {
            let path = base.appendingPathComponent(name)
            if !FileManager.default.fileExists(atPath: path.path) {
                try FileManager.default.createDirectory(at: path, withIntermediateDirectories: false)
            }
            let data = try run(["attach", "-nobrowse", "-noautoopen", "-mountpoint", path.path, "-plist", base.appendingPathComponent(image + ".sparseimage").path])
            let plist = try PropertyListSerialization.propertyList(from: data, format: nil) as! [String: Any]
            let entries = plist["system-entities"] as! [[String: Any]]
            mounted.append(entries.first!["dev-entry"] as! String)
            return path
        }
        func detachLast() throws { _ = try run(["detach", mounted.last!]); mounted.removeLast() }
        defer {
            for device in mounted.reversed() { _ = try? run(["detach", device]) }
            if mounted.isEmpty { try? FileManager.default.removeItem(at: base) }
        }
        for image in ["original", "holder"] {
            _ = try run(["create", "-size", "128m", "-type", "SPARSE", "-fs", "APFS", "-volname", "TT-Synthetic-" + image, base.appendingPathComponent(image).path])
        }
        let first = try attach("original", at: "a").appendingPathComponent("selected")
        try FileManager.default.createDirectory(at: first, withIntermediateDirectories: false)
        try Data("synthetic bytes".utf8).write(to: first.appendingPathComponent("sample"))
        let bookmark = try FolderBookmark.create(first)
        let scope = MobileFolderInventory.Scope(owner: try FileSyncOwnerScope(ownerId: "synthetic", url: URL(string: "https://fixture.invalid")!), deviceId: "synthetic", rootId: UUID().uuidString)
        let target = first.deletingLastPathComponent().appendingPathComponent("target")
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: false)
        let targetBookmark = try FolderBookmark.create(target), storage = base.appendingPathComponent("staging")
        let bytes = Data(repeating: 91, count: 131_079)
        let source = MobileFolderReader.Entry(path: "received.bin", id: "synthetic-cloud", version: "v1", kind: "file", size: Int64(bytes.count),
            sha256: SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined(), fingerprint: nil)
        if publicationPhase != nil { try Data("original displaced bytes".utf8).write(to: target.appendingPathComponent(source.path)) }
        let expected = try MobileFolderReader.inspect(bookmark: targetBookmark, path: source.path)
        let stagingScope = MobileSyncStaging.Scope(origin: scope.owner.origin.absoluteString, ownerId: scope.owner.ownerId, dataPlane: "home", rootId: scope.rootId, deviceId: scope.deviceId)
        let request = MobileSyncStaging.Request(scope: stagingScope, rootId: UUID().uuidString, operation: .init(id: UUID().uuidString,
            mutation: .init(kind: "copy", from: "remote", path: source.path, source: source, expectedTarget: expected), confirmed: false))
        let staging = MobileSyncStaging(directory: storage)
        _ = try staging.begin(request, owner: scope.owner)
        _ = try staging.append(request, owner: scope.owner, offset: 0, bytes: bytes.prefix(65_536))
        var preparedStage: MobileSyncStaging.Stage?
        if let publicationPhase {
            _ = try staging.append(request, owner: scope.owner, offset: 65_536, bytes: bytes.subdata(in: 65_536..<131_072))
            _ = try staging.append(request, owner: scope.owner, offset: 131_072, bytes: bytes.suffix(7))
            preparedStage = try XCTUnwrap(staging.finish(request, owner: scope.owner).stage)
            struct FixtureInterruption: Error {}
            var reached = false
            let stop = { reached = true; throw FixtureInterruption() }
            let interrupted = MobileSyncStaging(directory: storage,
                afterPublication: ["published", "edited"].contains(publicationPhase) ? stop : nil,
                beforePublication: ["prepared", "replaced-journal"].contains(publicationPhase) ? stop : nil,
                afterDisplacement: publicationPhase == "displaced" ? stop : nil,
                exchangeSupported: publicationPhase == "displaced" ? { _ in false } : nil)
            if ["completed", "legacy-receipts", "unbound-legacy"].contains(publicationPhase) {
                _ = try interrupted.publish(request, owner: scope.owner, bookmark: targetBookmark, stage: preparedStage!)
                let fd = open(target.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
                XCTAssertGreaterThanOrEqual(fd, 0); defer { close(fd) }
                try NativeSymbolicLinks.create(fd, name: "portable-link", link: .init(target: Data("received.bin".utf8)), forceUnsupported: true)
                if ["legacy-receipts", "unbound-legacy"].contains(publicationPhase) {
                    for file in try FileManager.default.contentsOfDirectory(at: base.appendingPathComponent("receipts"), includingPropertiesForKeys: nil) {
                        let recordURL = file.appendingPathComponent("record.json")
                        var row = try JSONSerialization.jsonObject(with: Data(contentsOf: recordURL)) as! [String: Any]
                        guard let continuity = row["continuity"] as? String else { continue }
                        if file.lastPathComponent == NativeSymbolicLinks.hash(Data(("persistent:" + continuity).utf8)) {
                            try FileManager.default.removeItem(at: file)
                        } else {
                            row.removeValue(forKey: "continuity")
                            try JSONSerialization.data(withJSONObject: row).write(to: recordURL)
                        }
                    }
                    if publicationPhase == "legacy-receipts" {
                    let migration = try RustIndexFixture.inventory(directory: base.appendingPathComponent("receipt-migration"))
                    let migrationScope = MobileFolderInventory.Scope(owner: scope.owner, deviceId: scope.deviceId, rootId: UUID().uuidString)
                    let migrated = try migration.prepareBackup(migrationScope, id: UUID().uuidString, generation: UUID().uuidString, bookmark: targetBookmark)
                    try migration.sealBackup(migrationScope, capture: migrated, bookmark: targetBookmark)
                    }
                }
            } else {
                XCTAssertThrowsError(try interrupted.publish(request, owner: scope.owner, bookmark: targetBookmark, stage: preparedStage!))
                XCTAssertTrue(reached, "Cross-volume regular publication must reach the intended atomic-rename boundary")
            }
        }
        let inventory = try RustIndexFixture.inventory(directory: base.appendingPathComponent("cache"))
        let capture = try inventory.prepareBackup(scope, id: UUID().uuidString, generation: UUID().uuidString, bookmark: bookmark)
        try inventory.sealBackup(scope, capture: capture, bookmark: bookmark)
        let before = try inventory.read(scope, capture: capture, bookmark: bookmark, offset: 0)
        XCTAssertEqual(before.entries.map(\.path), ["sample"])
        if abandoned { try inventory.abandonBackup(scope, capture: capture, bookmark: bookmark) }
        if legacy {
            // Model a capture written by the previous released app. The
            // original picker bookmark remains byte-for-byte unchanged.
            let files = FileManager.default.enumerator(at: base.appendingPathComponent("cache"), includingPropertiesForKeys: nil)!
            for case let file as URL in files where file.lastPathComponent == "record.json" {
                var record = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as! [String: Any]
                guard record["rootIdentity"] != nil else { continue }
                record.removeValue(forKey: "rootContinuity"); record.removeValue(forKey: "rootPath")
                try JSONSerialization.data(withJSONObject: record).write(to: file)
            }
        }
        try detachLast()
        do {
            var stale = false
            _ = try URL(resolvingBookmarkData: bookmark, options: [.withoutUI, .withoutMounting, .withSecurityScope], relativeTo: nil, bookmarkDataIsStale: &stale)
            XCTFail("Detached synthetic source unexpectedly resolved")
        } catch {
            let failure = error as NSError
            print("OFFLINE REPRO: domain=\(failure.domain) code=\(failure.code)")
        }
        let replacement = try attach("holder", at: sameMountpoint ? "holder-mount" : "a").appendingPathComponent("selected")
        try FileManager.default.createDirectory(at: replacement, withIntermediateDirectories: false)
        try Data("synthetic bytes".utf8).write(to: replacement.appendingPathComponent("sample"))
        XCTAssertThrowsError(try MobileFolderReader.checkAccess(bookmark: bookmark), "Same path/name/bytes on a replacement volume must never inherit the grant")
        _ = try attach("original", at: sameMountpoint ? "a" : "b")
        var stale = false
        let resolved = try FolderBookmark.resolve(bookmark, stale: &stale)
        XCTAssertFalse(stale)
        XCTAssertEqual(try Data(contentsOf: resolved.appendingPathComponent("sample")), Data("synthetic bytes".utf8))
        if abandoned {
            let status = try XCTUnwrap(inventory.backupStatus(scope, id: capture.id, bookmark: bookmark))
            XCTAssertEqual(status.state, "interrupted"); XCTAssertEqual(status.generation, capture.generation)
            XCTAssertEqual(try inventory.backupStatus(scope, id: capture.id, bookmark: bookmark)?.generation, capture.generation)
            XCTAssertThrowsError(try inventory.read(scope, capture: capture, bookmark: bookmark, offset: 0))
            try detachLast(); try detachLast(); return
        }
        XCTAssertThrowsError(try inventory.read(scope, capture: capture, bookmark: bookmark, offset: 0)) { error in
            guard case FolderReconnectFailure.remounted = error else { return XCTFail("Expected verified remount, got \(error)") }
        }
        XCTAssertNil(try inventory.backupStatus(scope, id: capture.id, bookmark: bookmark))
        let fresh = try inventory.prepareBackup(scope, id: capture.id, generation: UUID().uuidString, bookmark: bookmark)
        try inventory.sealBackup(scope, capture: fresh, bookmark: bookmark)
        let after = try inventory.read(scope, capture: fresh, bookmark: bookmark, offset: 0)
        XCTAssertNotEqual(capture.generation, fresh.generation)
        XCTAssertEqual(after.entries.map(\.path), before.entries.map(\.path))
        XCTAssertEqual(after.entries.first?.fingerprint, before.entries.first?.fingerprint)
        XCTAssertNotEqual(after.entries.first?.id, before.entries.first?.id)
        XCTAssertThrowsError(try inventory.read(scope, capture: capture, bookmark: bookmark, offset: 0))
        print("ACCEPTANCE: exact original bookmarked volume reindexed after real remount; new generation and inode namespace, same fingerprint, old snapshot refused")
        if preparedStage == nil {
            XCTAssertEqual(try staging.begin(request, owner: scope.owner).received, 65_536, "The saved transfer offset must survive volume availability changes")
            _ = try staging.append(request, owner: scope.owner, offset: 65_536, bytes: bytes.subdata(in: 65_536..<131_072))
            _ = try staging.append(request, owner: scope.owner, offset: 131_072, bytes: bytes.suffix(7))
            preparedStage = try XCTUnwrap(staging.finish(request, owner: scope.owner).stage)
        }
        var staleTarget = false
        let returnedTarget = try FolderBookmark.resolve(targetBookmark, stale: &staleTarget)
        XCTAssertFalse(staleTarget)
        if publicationPhase == "unbound-legacy" {
            let targetScope = MobileFolderInventory.Scope(owner: scope.owner, deviceId: scope.deviceId, rootId: UUID().uuidString)
            let targetCapture = try inventory.prepareBackup(targetScope, id: UUID().uuidString, generation: UUID().uuidString, bookmark: targetBookmark)
            try inventory.sealBackup(targetScope, capture: targetCapture, bookmark: targetBookmark)
            XCTAssertEqual(targetCapture.coverage, "partial")
            XCTAssertGreaterThan(targetCapture.totalSkipped ?? 0, 0)
            let entries = try inventory.read(targetScope, capture: targetCapture, bookmark: targetBookmark, offset: 0).entries
            XCTAssertFalse(entries.contains { $0.path.hasPrefix(".thingtime-link-journal-") })
            XCTAssertThrowsError(try MobileFolderReader.scan(bookmark: targetBookmark))
            try detachLast(); try detachLast(); return
        }
        if ["completed", "legacy-receipts"].contains(publicationPhase ?? "") {
            // Deliberately scan BEFORE historical operation lookup: completed
            // receipts must not need an effectful lookup to protect journals.
            let targetScope = MobileFolderInventory.Scope(owner: scope.owner, deviceId: scope.deviceId, rootId: UUID().uuidString)
            let targetCapture = try inventory.prepareBackup(targetScope, id: UUID().uuidString, generation: UUID().uuidString, bookmark: targetBookmark)
            try inventory.sealBackup(targetScope, capture: targetCapture, bookmark: targetBookmark)
            let targetEntries = try inventory.read(targetScope, capture: targetCapture, bookmark: targetBookmark, offset: 0).entries
            XCTAssertEqual(Set(targetEntries.map(\.path)), ["received.bin", "portable-link"])
            XCTAssertEqual(try XCTUnwrap(targetEntries.first { $0.path == "portable-link" }?.symbolicLink).target(), Data("received.bin".utf8))
            XCTAssertEqual(Set(try MobileFolderReader.scan(bookmark: targetBookmark).map(\.path)), ["received.bin", "portable-link"])
        }
        if publicationPhase == "edited" {
            let edited = Data("later user edit".utf8)
            try edited.write(to: returnedTarget.appendingPathComponent(source.path))
            XCTAssertEqual(try staging.lookup(request, owner: scope.owner, bookmark: targetBookmark).status, "pending")
            XCTAssertThrowsError(try staging.publish(request, owner: scope.owner, bookmark: targetBookmark, stage: preparedStage!))
            XCTAssertEqual(try Data(contentsOf: returnedTarget.appendingPathComponent(source.path)), edited)
            try detachLast(); try detachLast(); return
        }
        if publicationPhase == "replaced-journal" {
            let journal = returnedTarget.appendingPathComponent(".thingtime-link-journal-" + request.operation.id)
            let retained = returnedTarget.appendingPathComponent("retained-original-journal")
            try FileManager.default.moveItem(at: journal, to: retained)
            try FileManager.default.createDirectory(at: journal, withIntermediateDirectories: false)
            try FileManager.default.copyItem(at: retained.appendingPathComponent(".thingtime-owned-journal"), to: journal.appendingPathComponent(".thingtime-owned-journal"))
            XCTAssertThrowsError(try staging.lookup(request, owner: scope.owner, bookmark: targetBookmark))
            XCTAssertEqual(try Data(contentsOf: returnedTarget.appendingPathComponent(source.path)), Data("original displaced bytes".utf8))
            try detachLast(); try detachLast(); return
        }
        let recovered = try staging.lookup(request, owner: scope.owner, bookmark: targetBookmark)
        print("RECOVERY PHASE: \(publicationPhase ?? "staged") lookup=\(recovered.status)")
        XCTAssertEqual(recovered.status, ["published", "completed", "legacy-receipts"].contains(publicationPhase ?? "") ? "complete" : "missing")
        let receipt = try staging.publish(request, owner: scope.owner, bookmark: targetBookmark, stage: preparedStage!)
        XCTAssertEqual(receipt.operationId, request.operation.id)
        if publicationPhase == "published" { XCTAssertEqual(receipt, recovered.receipt) }
        XCTAssertEqual(try Data(contentsOf: returnedTarget.appendingPathComponent(source.path)), bytes)
        XCTAssertEqual(try staging.lookup(request, owner: scope.owner, bookmark: targetBookmark).receipt, receipt)
        print("ACCEPTANCE: cross-volume regular download retained its staged offset and exact publication receipt through remount")
        try detachLast(); try detachLast()
        }
    }
}
