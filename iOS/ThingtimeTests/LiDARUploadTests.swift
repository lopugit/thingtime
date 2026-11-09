import AppleFileSync
import CryptoKit
import XCTest
@testable import Thingtime

@MainActor
final class LiDARUploadTests: XCTestCase {
    func testOfflineArchiveRemainsPendingAndLostCommitReplaysExactPayload() async throws {
        let fixture = try LiDARUploadFixture()
        defer { fixture.remove() }
        let scope = try FileSyncOwnerScope(ownerId: "scanner", url: URL(string: "https://scans.test")!)
        let outbox = fixture.outbox()
        let id = try outbox.reserve(scope: scope)
        var interrupted: LiDARCaptureStore? = try fixture.startCapture(id: id, bytes: 124)
        let originalURL = try XCTUnwrap(interrupted?.archiveURL)
        let original = try Data(contentsOf: originalURL)
        // The process died before it could seal the TAR or invoke the callback.
        interrupted = nil
        let recoveredValue = try await fixture.outbox().recover(id: id, scope: scope)
        let recovered = try XCTUnwrap(recoveredValue)
        XCTAssertNotEqual(recovered.archiveURL, originalURL)
        XCTAssertEqual(try Data(contentsOf: originalURL), original)
        let bytes = try Data(contentsOf: recovered.archiveURL)
        let server = FakeLiDARServer(scope: scope, id: id, bytes: bytes)
        server.offline = true
        do {
            _ = try await fixture.outbox().upload(id: id, scope: scope, session: server)
            XCTFail("An offline capture was reported as saved")
        } catch let error as URLError { XCTAssertEqual(error.code, .notConnectedToInternet) }
        XCTAssertNil(try fixture.outbox().entries(scope: scope).first?.receipt)
        XCTAssertEqual(try Data(contentsOf: recovered.archiveURL), bytes)
        XCTAssertEqual(try Data(contentsOf: originalURL), original)

        server.offline = false
        server.loseCommit = true
        do {
            _ = try await fixture.outbox().upload(id: id, scope: scope, session: server)
            XCTFail("A lost commit response was reported as saved")
        } catch let error as URLError { XCTAssertEqual(error.code, .networkConnectionLost) }
        XCTAssertNil(try fixture.outbox().entries(scope: scope).first?.receipt)
        let receipt = try await fixture.outbox().upload(id: id, scope: scope, session: server)
        XCTAssertEqual(receipt.fileThingId, id.uuidString.lowercased())
        XCTAssertEqual(server.uploads, 1)
        XCTAssertEqual(server.commits.count, 2)
        XCTAssertEqual(server.commits.first, server.commits.last)
        XCTAssertEqual(try fixture.outbox().entries(scope: scope).first?.receipt, receipt)
        XCTAssertEqual(try Data(contentsOf: recovered.archiveURL), bytes)
        XCTAssertEqual(try Data(contentsOf: originalURL), original)
    }

    func testChangedAccountOriginAndTransportCannotAccessCapture() async throws {
        let fixture = try LiDARUploadFixture()
        defer { fixture.remove() }
        let origin = URL(string: "https://scans.test")!
        let scope = try FileSyncOwnerScope(ownerId: "scanner", url: origin)
        let otherOwner = try FileSyncOwnerScope(ownerId: "other", url: origin)
        let otherOrigin = try FileSyncOwnerScope(ownerId: scope.ownerId, url: URL(string: "https://other.test")!)
        let outbox = fixture.outbox(), id = try outbox.reserve(scope: scope)
        let capture = try fixture.capture(id: id, bytes: 10)
        try outbox.record(capture, scope: scope)
        for other in [otherOwner, otherOrigin] {
            XCTAssertTrue(try outbox.entries(scope: other).isEmpty)
            XCTAssertThrowsError(try outbox.reserve(id: id, scope: other))
            XCTAssertThrowsError(try outbox.record(capture, scope: other))
            do {
                _ = try await outbox.recover(id: id, scope: other)
                XCTFail("A foreign account was allowed to recover a local archive")
            } catch LiDARUploadOutbox.Failure.wrongScope {}
            let server = FakeLiDARServer(scope: other, id: id, bytes: Data())
            do {
                _ = try await outbox.upload(id: id, scope: scope, session: server)
                XCTFail("An out-of-scope session was allowed")
            } catch LiDARUploadOutbox.Failure.wrongScope {}
            XCTAssertTrue(server.calls.isEmpty)
        }
    }

    func testDamagedSealedArchiveCannotEstablishItsFirstUploadFingerprint() async throws {
        let fixture = try LiDARUploadFixture()
        defer { fixture.remove() }
        let scope = try FileSyncOwnerScope(ownerId: "scanner", url: URL(string: "https://scans.test")!)
        let outbox = fixture.outbox(), id = try outbox.reserve(scope: scope)
        let capture = try fixture.capture(id: id, bytes: 36)
        try outbox.record(capture, scope: scope)
        var bytes = try Data(contentsOf: capture.archiveURL)
        let file = try FileHandle(forReadingFrom: capture.archiveURL)
        let first = try XCTUnwrap(LiDARTarArchive.nextEntry(in: file, offset: 0, length: UInt64(bytes.count)))
        try file.close()
        // Preserve the size, capture header, manifest, and its receipt. Only
        // traversing the sealed TAR finds this damaged camera entry header.
        bytes[Int(first.nextOffset)] ^= 1
        try bytes.write(to: capture.archiveURL)
        let server = FakeLiDARServer(scope: scope, id: id, bytes: bytes)
        do {
            _ = try await outbox.upload(id: id, scope: scope, session: server)
            XCTFail("A damaged archive was accepted before its first fingerprint")
        } catch LiDARUploadOutbox.Failure.archiveChanged {}
        XCTAssertFalse(server.calls.contains("/api/v1/attachments/uploads"))
        XCTAssertEqual(server.uploads, 0)
        XCTAssertTrue(server.commits.isEmpty)
        XCTAssertEqual(try Data(contentsOf: capture.archiveURL), bytes)
    }

    func testPendingArchiveFollowsOnlyItsReservedPathAfterSandboxRelocation() async throws {
        let fixture = try LiDARUploadFixture()
        defer { fixture.remove() }
        let scope = try FileSyncOwnerScope(ownerId: "scanner", url: URL(string: "https://scans.test")!)
        let outbox = fixture.outbox(), id = try outbox.reserve(scope: scope)
        let capture = try fixture.capture(id: id, bytes: 61)
        try outbox.record(capture, scope: scope)
        let original = try Data(contentsOf: capture.archiveURL)
        let relocatedArchives = fixture.directory.appendingPathComponent("new-archives", isDirectory: true)
        try FileManager.default.moveItem(at: fixture.archives, to: relocatedArchives)
        let reopened = LiDARUploadOutbox(directory: fixture.directory.appendingPathComponent("outbox", isDirectory: true),
                                        archiveDirectory: relocatedArchives)
        let relocated = try XCTUnwrap(reopened.entries(scope: scope).first?.capture)
        XCTAssertEqual(relocated.id, id)
        XCTAssertEqual(relocated.archiveURL.deletingLastPathComponent().deletingLastPathComponent().path, relocatedArchives.path)
        XCTAssertFalse(FileManager.default.fileExists(atPath: capture.archiveURL.path))
        XCTAssertThrowsError(try reopened.record(capture, scope: scope))
        let transport = FakeLiDARServer(scope: scope, id: id, bytes: original)
        var altered = original
        let identity = try XCTUnwrap(altered.range(of: Data(id.uuidString.utf8)))
        altered.replaceSubrange(identity, with: Data(UUID().uuidString.utf8))
        try altered.write(to: relocated.archiveURL)
        do {
            _ = try await reopened.upload(id: id, scope: scope, session: transport)
            XCTFail("A relocated archive with another capture identity was accepted")
        } catch LiDARUploadOutbox.Failure.archiveChanged {}
        XCTAssertEqual(transport.uploads, 0)
        try original.write(to: relocated.archiveURL)
        let receipt = try await reopened.upload(id: id, scope: scope, session: transport)
        XCTAssertEqual(receipt.fileThingId, id.uuidString.lowercased())
        XCTAssertEqual(try Data(contentsOf: relocated.archiveURL), original)
    }

    func testAccountFenceStopsUploadAndFingerprintRefusesModifiedArchiveOnRetry() async throws {
        let fixture = try LiDARUploadFixture()
        defer { fixture.remove() }
        let scope = try FileSyncOwnerScope(ownerId: "scanner", url: URL(string: "https://scans.test")!)
        let outbox = fixture.outbox(), id = try outbox.reserve(scope: scope)
        let capture = try fixture.capture(id: id, bytes: 36)
        try outbox.record(capture, scope: scope)
        var bytes = try Data(contentsOf: capture.archiveURL)
        let server = FakeLiDARServer(scope: scope, id: id, bytes: bytes)
        let start = "/api/v1/attachments/uploads"
        do {
            _ = try await outbox.upload(id: id, scope: scope, session: server, check: {
                if server.calls.contains(start) { throw CancellationError() }
            })
            XCTFail("An old view was allowed to continue")
        } catch is CancellationError {}
        XCTAssertEqual(server.uploads, 0)
        XCTAssertTrue(server.commits.isEmpty)
        bytes[512] ^= 1
        try bytes.write(to: capture.archiveURL)
        do {
            _ = try await fixture.outbox().upload(id: id, scope: scope, session: server)
            XCTFail("Modified bytes were accepted under the original operation")
        } catch LiDARUploadOutbox.Failure.archiveChanged {}
        XCTAssertEqual(server.calls.filter { $0 == start }.count, 1)
        XCTAssertEqual(server.uploads, 0)
    }

    func testDiscardTombstonePreventsRecoveryAndUploadWhenArchiveDeletionFails() async throws {
        let fixture = try LiDARUploadFixture()
        defer { fixture.remove() }
        let scope = try FileSyncOwnerScope(ownerId: "scanner", url: URL(string: "https://scans.test")!)
        let outbox = fixture.outbox(), id = try outbox.reserve(scope: scope)
        let capture = try fixture.capture(id: id, bytes: 44)
        try outbox.record(capture, scope: scope)
        // Leave the actual file in place to model a failure to remove it.
        try outbox.discard(id: id, scope: scope)
        let reopened = fixture.outbox()
        XCTAssertTrue(FileManager.default.fileExists(atPath: capture.archiveURL.path))
        XCTAssertTrue(try reopened.entries(scope: scope).isEmpty)
        let recovered = try await reopened.recover(id: id, scope: scope)
        XCTAssertNil(recovered)
        XCTAssertThrowsError(try reopened.reserve(id: id, scope: scope))
        XCTAssertThrowsError(try reopened.record(capture, scope: scope))
        let server = FakeLiDARServer(scope: scope, id: id, bytes: Data())
        do {
            _ = try await reopened.upload(id: id, scope: scope, session: server)
            XCTFail("A deliberately discarded archive was uploaded")
        } catch LiDARUploadOutbox.Failure.discarded {}
        XCTAssertTrue(server.calls.isEmpty)
    }

    func testRecorderDiscardMarkerAloneHidesInterruptedCapture() async throws {
        let fixture = try LiDARUploadFixture()
        defer { fixture.remove() }
        let scope = try FileSyncOwnerScope(ownerId: "scanner", url: URL(string: "https://scans.test")!)
        let id = try fixture.outbox().reserve(scope: scope)
        let capture = try fixture.startCapture(id: id, bytes: 37)
        XCTAssertThrowsError(try capture.discard(uploadDisabled: false, removeArchive: { _ in
            throw CocoaError(.fileWriteNoPermission)
        }))
        XCTAssertTrue(FileManager.default.fileExists(atPath: capture.archiveURL.path))
        let reopened = fixture.outbox()
        XCTAssertTrue(try reopened.entries(scope: scope).isEmpty)
        let recovered = try await reopened.recover(id: id, scope: scope)
        XCTAssertNil(recovered)
        let server = FakeLiDARServer(scope: scope, id: id, bytes: Data())
        do {
            _ = try await reopened.upload(id: id, scope: scope, session: server)
            XCTFail("The recorder's discarded capture was uploaded")
        } catch LiDARUploadOutbox.Failure.discarded {}
        XCTAssertTrue(server.calls.isEmpty)
    }
}

@MainActor
struct LiDARUploadFixture {
    let directory: URL
    let archives: URL

    init() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("lidar-upload-test-" + UUID().uuidString, isDirectory: true)
        archives = directory.appendingPathComponent("archives", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
    }

    func outbox() -> LiDARUploadOutbox {
        LiDARUploadOutbox(directory: directory.appendingPathComponent("outbox", isDirectory: true), archiveDirectory: archives)
    }

    func capture(id: UUID, bytes: Int) throws -> LiDARCapture {
        try startCapture(id: id, bytes: bytes).finalize(detail: nil, worldMapStatus: "unavailable")
    }

    func startCapture(id: UUID, bytes: Int) throws -> LiDARCaptureStore {
        let store = try LiDARCaptureStore(
            header: .init(captureID: id, startedAt: Date(), nominalFramesPerSecond: 30, videoWidth: bytes, videoHeight: 1,
                          sceneDepthEnabled: true, smoothedSceneDepthEnabled: false, meshReconstruction: "none", systemVersion: "synthetic"),
            directory: archives.appendingPathComponent(id.uuidString.lowercased(), isDirectory: true))
        try store.data("frames/00000000/camera-plane-0.bin", Data(repeating: 0x4c, count: bytes))
        try store.data("frames/00000000/scene-depth-plane-0.bin", Data([0, 0, 128, 63]))
        try store.json("frames/00000000/frame.json", ["index": 0])
        store.commit()
        return store
    }

    func remove() { try? FileManager.default.removeItem(at: directory) }
}

@MainActor
private final class FakeLiDARServer: LiDARUploadTransport {
    let scope: FileSyncOwnerScope
    let bytes: Data
    var offline = false
    var loseCommit = false
    var calls: [String] = []
    var uploads = 0
    var commits: [Data] = []
    private let id: String
    private let attachment = "att_fixture"
    private let contentVersion = String(repeating: "a", count: 64)
    private var file: [String: Any]?

    init(scope: FileSyncOwnerScope, id: UUID, bytes: Data) {
        self.scope = scope
        self.id = id.uuidString.lowercased()
        self.bytes = bytes
    }

    func verifyOwner() async throws { calls.append("auth") }

    func require(_ requirements: [(String, [Int])]) async throws {
        if offline { throw URLError(.notConnectedToInternet) }
        XCTAssertEqual(requirements.map(\.0), LiDARUploadOutbox.requirements.map(\.0))
        calls.append("manifest")
    }

    func uploadPart(_ part: any FileUploadPartSource, uploadId: String, partNumber: Int, allowsCellular: Bool) async throws {
        XCTAssertEqual(uploadId, attachment)
        XCTAssertEqual(partNumber, 1)
        XCTAssertEqual(try Data(contentsOf: part.url), bytes)
        XCTAssertEqual(part.checksumSha256, Data(SHA256.hash(data: bytes)).base64EncodedString())
        uploads += 1
    }

    func json(_ path: String, body: [String: Any]?, statuses: Set<Int>) async throws -> [String: Any] {
        calls.append(path)
        XCTAssertEqual(calls.first, "manifest")
        let name = "LiDAR Scan \(id).tar"
        let sha = SHA256.hash(data: Data(SHA256.hash(data: bytes))).map { String(format: "%02x", $0) }.joined()
        let fingerprint: [String: Any] = ["algorithm": "sha256-parts-v1", "partSizeBytes": 8 * 1024 * 1024, "partCount": 1, "sha256": sha]
        switch path {
        case "/api/v1/attachments/uploads":
            XCTAssertEqual(body?["requestId"] as? String, id)
            XCTAssertEqual(body?["purpose"] as? String, "file")
            XCTAssertEqual(body?["filename"] as? String, name)
            return ["ok": true, "upload": ["id": attachment, "partSizeBytes": NSNumber(value: 8 * 1024 * 1024), "partCount": 1]]
        case "/api/v1/attachments/uploads/complete":
            XCTAssertEqual(body?["uploadId"] as? String, attachment)
            return ["ok": true]
        case "/api/v1/attachments/content?id=\(attachment)&fingerprint=1":
            return ["ok": true, "id": attachment, "version": contentVersion, "size": bytes.count, "fingerprint": fingerprint]
        case "/api/v1/files?id=\(id)&operationId=\(id)":
            if let file { return ["ok": true, "receipt": ["file": file]] }
            return ["ok": true, "receipt": NSNull()]
        case "/api/v1/files":
            let payload = try XCTUnwrap(body)
            XCTAssertEqual(payload["id"] as? String, id)
            XCTAssertEqual(payload["operationId"] as? String, id)
            XCTAssertTrue(payload["folderId"] is NSNull)
            XCTAssertTrue(payload["expectedRevision"] is NSNull)
            XCTAssertEqual(payload["attachmentId"] as? String, attachment)
            XCTAssertEqual(payload["contentVersion"] as? String, contentVersion)
            commits.append(try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]))
            let replayed = file != nil
            file = ["id": id, "revision": "verified-revision", "name": name, "folderId": NSNull(), "trashed": false,
                    "content": ["attachmentId": attachment, "version": contentVersion, "size": bytes.count, "fingerprint": fingerprint]]
            if loseCommit {
                loseCommit = false
                throw URLError(.networkConnectionLost)
            }
            return ["ok": true, "replayed": replayed, "file": try XCTUnwrap(file)]
        default:
            XCTFail("Unexpected upload route")
            throw URLError(.unsupportedURL)
        }
    }
}
