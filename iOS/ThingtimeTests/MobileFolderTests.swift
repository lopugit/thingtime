import XCTest
import CryptoKit
import WebKit
@testable import Thingtime

@MainActor
final class MobileFolderTests: XCTestCase {
    func testSuspendingBridgeReleasesOnlyTheMatchingPendingRequest() throws {
        let bridge = MobileFolderBridge(), webView = WKWebView()
        let root = URL(string: "https://thingtime.test")!, id = UUID().uuidString
        var replies: [[String: Any]] = []
        let verify: (MobileDevicePairing.Scope, @escaping () throws -> Void) async throws -> Void = { _, _ in XCTFail("Cancelled request reached authentication") }
        func request(_ id: String, _ action: String) {
            bridge.handle(["payload": ["requestId": id, "ownerId": "folder-test", "action": action]], webView: webView,
                root: root, currentRoot: { root }, verifyOwner: verify, reply: { _, payload in replies.append(payload) })
        }
        request(id, "scan")
        request(UUID().uuidString, "suspend"); XCTAssertTrue(replies.isEmpty)
        request(id, "suspend"); XCTAssertEqual(replies.count, 1)
        XCTAssertEqual(replies.first?["requestId"] as? String, id)
        XCTAssertEqual(replies.first?["ownerId"] as? String, "folder-test")
        XCTAssertNotNil(replies.first?["error"]); XCTAssertNil(replies.first?["roots"])
        bridge.suspend(); XCTAssertEqual(replies.count, 1)
    }
    private func fixture() throws -> (URL, MobileDevicePairing.Scope, MobileFolderStore) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("folder-test-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let scope = try MobileDevicePairing.Scope(ownerId: "folder-test-" + UUID().uuidString, url: URL(string: "https://thingtime.test")!)
        var data: Data?
        return (root, scope, MobileFolderStore(load: { _ in data }, save: { _, next in data = next }))
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
        let other = try MobileDevicePairing.Scope(ownerId: "other", url: scope.origin)
        XCTAssertThrowsError(try store.list(other)) // Injected storage returns another account's row.
        try store.remove(scope, id: a.id); XCTAssertEqual(try store.list(scope).count, 0); XCTAssertTrue(FileManager.default.fileExists(atPath: root.path))
        XCTAssertThrowsError(try store.grant(scope, id: a.id))
    }
    func testKeychainReloadStaysOnDeviceAndScopedToAccountAndOrigin() throws {
        let (root, scope, _) = try fixture(); let first = MobileFolderStore(), grant = try first.add(scope, selected: root)
        defer { try? first.remove(scope, id: grant.id) }
        let reopened = MobileFolderStore(); XCTAssertEqual(try reopened.grant(scope, id: grant.id).bookmark, grant.bookmark)
        let otherOrigin = try MobileDevicePairing.Scope(ownerId: scope.ownerId, url: URL(string: "https://elsewhere.test")!)
        XCTAssertTrue(try reopened.list(otherOrigin).isEmpty)
        XCTAssertTrue(try reopened.list(MobileDevicePairing.Scope(ownerId: "other", url: scope.origin)).isEmpty)
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
}
