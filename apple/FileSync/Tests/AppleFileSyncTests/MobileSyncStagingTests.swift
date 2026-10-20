@testable import AppleFileSync
import XCTest
import CryptoKit

@MainActor
final class MobileSyncStagingTests: XCTestCase {
    func fixture(_ bytes: Data, folder: Bool = false) throws -> (URL, FileSyncOwnerScope, MobileSyncStaging.Request) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("staging-test-" + UUID().uuidString, isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let owner = try FileSyncOwnerScope(ownerId: "staging-test", url: URL(string: "https://thingtime.test")!)
        let scope = MobileSyncStaging.Scope(origin: owner.origin.absoluteString, ownerId: owner.ownerId, dataPlane: "home", rootId: "config", deviceId: "device")
        var digest = SHA256(); let partSize = 8 * 1024 * 1024
        for offset in stride(from: 0, to: bytes.count, by: partSize) { digest.update(data: Data(SHA256.hash(data: bytes.subdata(in: offset..<min(bytes.count, offset + partSize))))) }
        let fingerprint = bytes.isEmpty || folder ? nil : MobileFolderReader.Fingerprint(partSizeBytes: Int64(partSize),
            partCount: (bytes.count + partSize - 1) / partSize, sha256: digest.finalize().map { String(format: "%02x", $0) }.joined())
        let entry = MobileFolderReader.Entry(path: "nested/file.bin", id: "cloud-file", version: "cloud-v1", kind: folder ? "folder" : "file",
            size: folder ? 0 : Int64(bytes.count), sha256: folder || fingerprint != nil ? nil : SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined(), fingerprint: fingerprint)
        let op = MobileSyncStaging.Operation(id: UUID().uuidString.lowercased(),
            mutation: .init(kind: "copy", from: "remote", path: entry.path, source: entry, expectedTarget: nil), confirmed: false)
        return (root, owner, .init(scope: scope, rootId: UUID().uuidString.lowercased(), operation: op))
    }
    private func publicationFixture(_ bytes: Data, prior: Data? = nil, folder: Bool = false) throws -> (URL, URL, FileSyncOwnerScope, MobileSyncStaging.Request, Data, MobileSyncStaging.Stage) {
        let (root, owner, original) = try fixture(bytes, folder: folder)
        let selected = root.appendingPathComponent("selected"), storage = root.appendingPathComponent("private")
        try FileManager.default.createDirectory(at: selected.appendingPathComponent("nested"), withIntermediateDirectories: true)
        if let prior { try prior.write(to: selected.appendingPathComponent(original.operation.mutation.path)) }
        let bookmark = try FolderBookmark.create(selected)
        let expected = try MobileFolderReader.scan(bookmark: bookmark).first { $0.path == original.operation.mutation.path }
        let request = MobileSyncStaging.Request(scope: original.scope, rootId: original.rootId, operation: .init(id: original.operation.id,
            mutation: .init(kind: "copy", from: "remote", path: original.operation.mutation.path, source: original.operation.mutation.source, expectedTarget: expected), confirmed: false))
        let staging = MobileSyncStaging(directory: storage)
        _ = try staging.begin(request, owner: owner)
        for offset in stride(from: 0, to: bytes.count, by: 65_536) { _ = try staging.append(request, owner: owner, offset: Int64(offset), bytes: bytes.subdata(in: offset..<min(bytes.count, offset + 65_536))) }
        return (storage, selected, owner, request, bookmark, try XCTUnwrap(staging.finish(request, owner: owner).stage))
    }
    func testEmptyRegularFileRestoresWithoutBytesAndRecoversExactReceipt() throws {
        for prior: Data? in [nil, Data("prior content".utf8)] {
            let (storage, selected, owner, request, bookmark, stage) = try publicationFixture(Data(), prior: prior)
            XCTAssertEqual(stage.entry.kind, "file"); XCTAssertEqual(stage.entry.size, 0)
            XCTAssertNil(stage.entry.fingerprint)
            XCTAssertEqual(stage.entry.sha256, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
            let staging = MobileSyncStaging(directory: storage)
            let receipt = try staging.publish(request, owner: owner, bookmark: bookmark, stage: stage)
            let destination = selected.appendingPathComponent(request.operation.mutation.path)
            XCTAssertEqual(try destination.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile, true)
            XCTAssertEqual(try Data(contentsOf: destination), Data())
            XCTAssertEqual(receipt.operationId, request.operation.id); XCTAssertEqual(receipt.scope, request.scope)
            let checked = try MobileFolderReader.read(bookmark: bookmark, path: receipt.entry.path, version: receipt.entry.version, offset: 0, length: 1)
            XCTAssertEqual(checked.size, 0); XCTAssertEqual(checked.data, "")
            XCTAssertThrowsError(try MobileFolderReader.read(bookmark: bookmark, path: receipt.entry.path, version: "stale-version", offset: 0, length: 1))
            let restarted = MobileSyncStaging(directory: storage)
            XCTAssertEqual(try restarted.lookup(request, owner: owner, bookmark: bookmark).receipt, receipt)
            try Data("later user edit".utf8).write(to: destination)
            XCTAssertEqual(try restarted.publish(request, owner: owner, bookmark: bookmark, stage: stage), receipt)
            XCTAssertEqual(try Data(contentsOf: destination), Data("later user edit".utf8))
        }
    }
    func testPublicationCreatesAndReplacesAtomicallyRetainingPriorBytes() throws {
        for prior: Data? in [nil, Data("original".utf8)] {
            let bytes = Data(repeating: 42, count: 131_079)
            let (storage, selected, owner, request, bookmark, stage) = try publicationFixture(bytes, prior: prior)
            let staging = MobileSyncStaging(directory: storage)
            XCTAssertEqual(try staging.lookup(request, owner: owner, bookmark: bookmark).status, "missing")
            let receipt = try staging.publish(request, owner: owner, bookmark: bookmark, stage: stage)
            XCTAssertEqual(try Data(contentsOf: selected.appendingPathComponent(request.operation.mutation.path)), bytes)
            XCTAssertEqual(receipt.entry, try MobileFolderReader.scan(bookmark: bookmark).first { $0.path == request.operation.mutation.path })
            let retained = storage.appendingPathComponent(stage.token).appendingPathComponent("publication")
            if let prior { XCTAssertEqual(try Data(contentsOf: retained), prior) }
            else { XCTAssertFalse(FileManager.default.fileExists(atPath: retained.path)) }
            try Data("later local edit".utf8).write(to: selected.appendingPathComponent(request.operation.mutation.path))
            XCTAssertEqual(try MobileSyncStaging(directory: storage).lookup(request, owner: owner, bookmark: bookmark).receipt, receipt)
            XCTAssertEqual(try MobileSyncStaging(directory: storage).publish(request, owner: owner, bookmark: bookmark, stage: stage), receipt)
            XCTAssertEqual(try Data(contentsOf: selected.appendingPathComponent(request.operation.mutation.path)), Data("later local edit".utf8))
        }
    }
    func testInterruptedPublicationRecoversWithoutRepeatingSwap() throws {
        struct Interrupted: Error {}
        for prior: Data? in [nil, Data("original".utf8)] {
            let bytes = Data("download".utf8)
            let (storage, selected, owner, request, bookmark, stage) = try publicationFixture(bytes, prior: prior)
            let staging = MobileSyncStaging(directory: storage, afterPublication: { throw Interrupted() })
            XCTAssertThrowsError(try staging.publish(request, owner: owner, bookmark: bookmark, stage: stage))
            let lookup = try MobileSyncStaging(directory: storage).lookup(request, owner: owner, bookmark: bookmark)
            XCTAssertEqual(lookup.status, "complete"); XCTAssertEqual(lookup.receipt?.entry.fingerprint, stage.entry.fingerprint)
            XCTAssertEqual(try Data(contentsOf: selected.appendingPathComponent(request.operation.mutation.path)), bytes)
            XCTAssertEqual(try MobileSyncStaging(directory: storage).publish(request, owner: owner, bookmark: bookmark, stage: stage), lookup.receipt)
        }
    }
    func testPublicationAndRecoveryAcrossWideAncestorsRetainAliasChecks() throws {
        for wideParent in [false, true] {
            let bytes = Data("wide-folder-download".utf8)
            let (storage, selected, owner, request, bookmark, stage) = try publicationFixture(bytes)
            let wide = wideParent ? selected.appendingPathComponent("nested") : selected
            for index in 0...10_000 {
                try Data().write(to: wide.appendingPathComponent("sibling-\(index)"))
            }
            let staging = MobileSyncStaging(directory: storage)
            let receipt = try staging.publish(request, owner: owner, bookmark: bookmark, stage: stage)
            XCTAssertEqual(try Data(contentsOf: selected.appendingPathComponent(request.operation.mutation.path)), bytes)
            XCTAssertEqual(try MobileSyncStaging(directory: storage).lookup(request, owner: owner, bookmark: bookmark).receipt, receipt)
            XCTAssertEqual(receipt.entry, try MobileFolderReader.inspect(bookmark: bookmark, path: request.operation.mutation.path))
            XCTAssertThrowsError(try NativeFileDestination.coordinated(bookmark: bookmark, path: "NESTED/file.bin") { _, _ in
                XCTFail("An alternate ancestor spelling must never reach the mutation")
            })
            XCTAssertThrowsError(try NativeFileDestination.coordinated(bookmark: bookmark, path: "nested/FILE.bin") { _, _ in
                XCTFail("An alternate target spelling must never reach the mutation")
            })
        }
    }
    func testPublicationRefusesLocalChangesAndSymlinkEscape() throws {
        let bytes = Data("download".utf8)
        for prior: Data? in [nil, Data("original".utf8)] {
            let (storage, selected, owner, request, bookmark, stage) = try publicationFixture(bytes, prior: prior)
            let target = selected.appendingPathComponent(request.operation.mutation.path)
            try Data("local edit".utf8).write(to: target)
            XCTAssertThrowsError(try MobileSyncStaging(directory: storage).publish(request, owner: owner, bookmark: bookmark, stage: stage))
            XCTAssertEqual(try Data(contentsOf: target), Data("local edit".utf8))
        }
        let (storage, selected, owner, request, bookmark, stage) = try publicationFixture(bytes)
        let outside = storage.deletingLastPathComponent().appendingPathComponent("outside")
        try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
        try FileManager.default.removeItem(at: selected.appendingPathComponent("nested"))
        try FileManager.default.createSymbolicLink(at: selected.appendingPathComponent("nested"), withDestinationURL: outside)
        XCTAssertThrowsError(try MobileSyncStaging(directory: storage).publish(request, owner: owner, bookmark: bookmark, stage: stage))
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: outside.path).isEmpty)
    }
    func testCrashThenLocalEditRemainsPendingAndPreservesBothVersions() throws {
        struct Interrupted: Error {}
        let (storage, selected, owner, request, bookmark, stage) = try publicationFixture(Data("download".utf8), prior: Data("original".utf8))
        XCTAssertThrowsError(try MobileSyncStaging(directory: storage, afterPublication: { throw Interrupted() }).publish(request, owner: owner, bookmark: bookmark, stage: stage))
        let target = selected.appendingPathComponent(request.operation.mutation.path)
        try Data("local edit".utf8).write(to: target)
        let staging = MobileSyncStaging(directory: storage)
        XCTAssertEqual(try staging.lookup(request, owner: owner, bookmark: bookmark).status, "pending")
        XCTAssertThrowsError(try staging.publish(request, owner: owner, bookmark: bookmark, stage: stage))
        XCTAssertEqual(try Data(contentsOf: target), Data("local edit".utf8))
        XCTAssertEqual(try Data(contentsOf: storage.appendingPathComponent(stage.token).appendingPathComponent("publication")), Data("original".utf8))
        XCTAssertEqual(try Data(contentsOf: storage.appendingPathComponent(stage.token).appendingPathComponent("payload")), Data("download".utf8))
    }
    func testRacingUncoordinatedWriterIsRetainedAndNotReportedAsSuccess() throws {
        let (storage, selected, owner, request, bookmark, stage) = try publicationFixture(Data("download".utf8), prior: Data("original".utf8))
        let target = selected.appendingPathComponent(request.operation.mutation.path)
        let staging = MobileSyncStaging(directory: storage, beforePublication: { try Data("racing edit".utf8).write(to: target, options: .atomic) })
        XCTAssertThrowsError(try staging.publish(request, owner: owner, bookmark: bookmark, stage: stage))
        XCTAssertEqual(try staging.lookup(request, owner: owner, bookmark: bookmark).status, "pending")
        XCTAssertEqual(try Data(contentsOf: storage.appendingPathComponent(stage.token).appendingPathComponent("publication")), Data("racing edit".utf8))
        XCTAssertEqual(try Data(contentsOf: target), Data("download".utf8))
    }
    func testPublicationCreatesEmptyFolders() throws {
        let (storage, selected, owner, request, bookmark, stage) = try publicationFixture(Data(), folder: true)
        let receipt = try MobileSyncStaging(directory: storage).publish(request, owner: owner, bookmark: bookmark, stage: stage)
        XCTAssertEqual(receipt.entry.kind, "folder")
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(atPath: selected.appendingPathComponent(request.operation.mutation.path).path).isEmpty)
    }
    func testMultipartStagingResumesAfterReopenAndVerifiesEveryByte() throws {
        let bytes = Data(repeating: 13, count: 8 * 1024 * 1024 + 17)
        let (root, owner, request) = try fixture(bytes)
        var stage = MobileSyncStaging(directory: root)
        XCTAssertEqual(try stage.begin(request, owner: owner).received, 0)
        let first = bytes.prefix(65_536)
        XCTAssertEqual(try stage.append(request, owner: owner, offset: 0, bytes: first).received, 65_536)
        stage = MobileSyncStaging(directory: root)
        XCTAssertEqual(try stage.begin(request, owner: owner).received, 65_536)
        XCTAssertEqual(try stage.append(request, owner: owner, offset: 0, bytes: first).received, 65_536)
        XCTAssertThrowsError(try stage.append(request, owner: owner, offset: 0, bytes: Data(repeating: 7, count: first.count)))
        for offset in stride(from: 65_536, to: bytes.count, by: 65_536) {
            _ = try stage.append(request, owner: owner, offset: Int64(offset), bytes: bytes.subdata(in: offset..<min(bytes.count, offset + 65_536)))
        }
        let done = try XCTUnwrap(stage.finish(request, owner: owner).stage)
        XCTAssertEqual(done.entry.fingerprint, request.operation.mutation.source.fingerprint)
        XCTAssertEqual(done.operationId, request.operation.id); XCTAssertEqual(done.scope, request.scope)
        let encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(done)) as! [String: Any]
        XCTAssertTrue((encoded["entry"] as? [String: Any])?["sha256"] is NSNull)
        XCTAssertEqual(try MobileSyncStaging(directory: root).finish(request, owner: owner).stage, done)
        XCTAssertEqual(try MobileSyncStaging(directory: root).begin(request, owner: owner).stage, done)
        // No caller-selected destination was created by staging.
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("nested/file.bin").path))
    }
    func testCrashAfterBytesBeforeCheckpointDiscardsOnlyUnacknowledgedTail() throws {
        let bytes = Data([1, 2, 3]), (root, owner, request) = try fixture(bytes)
        struct LostCheckpoint: Error {}
        let interrupted = MobileSyncStaging(directory: root, afterBytesFlushed: { throw LostCheckpoint() })
        _ = try interrupted.begin(request, owner: owner)
        XCTAssertThrowsError(try interrupted.append(request, owner: owner, offset: 0, bytes: bytes))
        let resumed = MobileSyncStaging(directory: root)
        XCTAssertEqual(try resumed.begin(request, owner: owner).received, 0)
        XCTAssertThrowsError(try resumed.finish(request, owner: owner))
        _ = try resumed.append(request, owner: owner, offset: 0, bytes: bytes)
        XCTAssertNotNil(try resumed.finish(request, owner: owner).stage)
    }
    func testScopeOperationRangesAndChecksumsFailClosed() throws {
        let bytes = Data([1, 2, 3]), (root, owner, request) = try fixture(bytes), stage = MobileSyncStaging(directory: root)
        _ = try stage.begin(request, owner: owner)
        XCTAssertThrowsError(try stage.begin(request, owner: FileSyncOwnerScope(ownerId: "other", url: owner.origin)))
        XCTAssertThrowsError(try stage.begin(request, owner: FileSyncOwnerScope(ownerId: owner.ownerId, url: URL(string: "https://other.test")!)))
        var object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as! [String: Any]
        var operation = object["operation"] as! [String: Any], mutation = operation["mutation"] as! [String: Any], source = mutation["source"] as! [String: Any]
        source["version"] = "different"; mutation["source"] = source; operation["mutation"] = mutation; object["operation"] = operation
        let changed = try JSONDecoder().decode(MobileSyncStaging.Request.self, from: JSONSerialization.data(withJSONObject: object))
        XCTAssertThrowsError(try stage.begin(changed, owner: owner))
        for offset: Int64 in [-1, 1, 4] { XCTAssertThrowsError(try stage.append(request, owner: owner, offset: offset, bytes: Data([1]))) }
        XCTAssertThrowsError(try stage.append(request, owner: owner, offset: 0, bytes: Data(repeating: 1, count: 65_537)))
        _ = try stage.append(request, owner: owner, offset: 0, bytes: Data([1, 2, 9]))
        XCTAssertThrowsError(try stage.finish(request, owner: owner))
        XCTAssertNil(try stage.begin(request, owner: owner).stage)
    }
    func testEmptyFilesFoldersAndCorruptCompletedPayloads() throws {
        for folder in [false, true] {
            let (root, owner, request) = try fixture(Data(), folder: folder), stage = MobileSyncStaging(directory: root)
            _ = try stage.begin(request, owner: owner)
            let result = try XCTUnwrap(stage.finish(request, owner: owner).stage)
            XCTAssertEqual(result.entry.kind, folder ? "folder" : "file")
            let payload = root.appendingPathComponent(result.token).appendingPathComponent("payload")
            if folder { try Data([1]).write(to: payload.appendingPathComponent("unexpected")) }
            else { try Data([1]).write(to: payload) }
            XCTAssertThrowsError(try stage.begin(request, owner: owner))
        }
    }
    func testSymlinkPayloadNeverWritesOutsidePrivateStaging() throws {
        let (root, owner, request) = try fixture(Data([1])), stage = MobileSyncStaging(directory: root)
        _ = try stage.begin(request, owner: owner)
        let child = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil).first { $0.lastPathComponent != "lock" })
        let outside = root.appendingPathComponent("sentinel")
        try Data([9]).write(to: outside)
        let payload = child.appendingPathComponent("payload")
        try FileManager.default.removeItem(at: payload)
        try FileManager.default.createSymbolicLink(at: payload, withDestinationURL: outside)
        XCTAssertThrowsError(try stage.append(request, owner: owner, offset: 0, bytes: Data([1])))
        XCTAssertEqual(try Data(contentsOf: outside), Data([9]))
    }
    func testConcurrentReceiverInstancesDeduplicateTheSameChunk() async throws {
        let bytes = Data([1, 2, 3]), (root, owner, request) = try fixture(bytes)
        let first = MobileSyncStaging(directory: root), second = MobileSyncStaging(directory: root)
        _ = try first.begin(request, owner: owner)
        let left = Task.detached { try first.append(request, owner: owner, offset: 0, bytes: bytes) }
        let right = Task.detached { try second.append(request, owner: owner, offset: 0, bytes: bytes) }
        let a = try await left.value, b = try await right.value
        XCTAssertEqual(a.received, 3); XCTAssertEqual(b.received, 3)
        XCTAssertNotNil(try second.finish(request, owner: owner).stage)
    }

    func testStreamCheckpointReplayAndInterruptedTailRecovery() throws {
        let bytes = Data(repeating: 79, count: 2 * 1024 * 1024 + 17)
        let (root, owner, request) = try fixture(bytes), staging = MobileSyncStaging(directory: root)
        _ = try staging.begin(request, owner: owner)
        var frames = 0
        XCTAssertThrowsError(try staging.appendStream(request, owner: owner, offset: 0, length: bytes.count) { wanted in
            frames += 1
            if frames == 2 { throw CancellationError() }
            return Data(bytes.prefix(wanted))
        })
        XCTAssertEqual(try MobileSyncStaging(directory: root).begin(request, owner: owner).received, 0)
        var offset = 0
        let complete = try staging.appendStream(request, owner: owner, offset: 0, length: bytes.count) { wanted in
            defer { offset += wanted }; return bytes.subdata(in: offset..<offset + wanted)
        }
        XCTAssertEqual(complete.received, Int64(bytes.count)); XCTAssertNil(complete.stage)
        offset = 0
        let replay = try MobileSyncStaging(directory: root).appendStream(request, owner: owner, offset: 0, length: bytes.count) { wanted in
            defer { offset += wanted }; return bytes.subdata(in: offset..<offset + wanted)
        }
        XCTAssertEqual(replay.received, complete.received)
        XCTAssertThrowsError(try staging.appendStream(request, owner: owner, offset: 0, length: bytes.count) { Data(repeating: 80, count: $0) })
        XCTAssertNotNil(try staging.finish(request, owner: owner).stage)
    }
    func testStreamFlushCrashTruncationAndInvalidFramesCannotAdvanceCheckpoint() throws {
        let bytes = Data(repeating: 83, count: 131_073)
        let (root, owner, request) = try fixture(bytes)
        let staging = MobileSyncStaging(directory: root, afterBytesFlushed: { throw CancellationError() })
        _ = try staging.begin(request, owner: owner)
        XCTAssertThrowsError(try staging.appendStream(request, owner: owner, offset: 0, length: bytes.count) { Data(repeating: 83, count: $0) })
        let restarted = MobileSyncStaging(directory: root)
        XCTAssertEqual(try restarted.begin(request, owner: owner).received, 0)
        for change in [-1, 1] {
            XCTAssertThrowsError(try restarted.appendStream(request, owner: owner, offset: 0, length: bytes.count) { Data(count: $0 + change) })
            XCTAssertEqual(try restarted.begin(request, owner: owner).received, 0)
        }
        for length in [0, -1, MobileFolderReader.maximumStreamBytes + 1] {
            XCTAssertThrowsError(try restarted.appendStream(request, owner: owner, offset: 0, length: length) { _ in XCTFail(); return Data() })
        }
    }

}
