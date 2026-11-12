import XCTest
import AppleFileSync

final class SharedRustInventoryTests: XCTestCase {
    private final class Reply: @unchecked Sendable { var value: Data? }

    func testEmbeddedRuntimeAndCoverageAreReal() throws {
        XCTAssertTrue(RustEmbeddedInventoryTransport.isAvailable)
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: temporary) }
        let transport = RustEmbeddedInventoryTransport(database: temporary.appendingPathComponent("index.sqlite3"))
        let reply = Reply()
        try transport.run(request: Data("{\"version\":1,\"operation\":\"capabilities\"}\n".utf8), isCancelled: { false }) { reply.value = $0 }
        let object = try XCTUnwrap(try JSONSerialization.jsonObject(with: XCTUnwrap(reply.value)) as? [String: Any])
        XCTAssertEqual(object["version"] as? Int, 1)
        XCTAssertEqual(object["strictCoverage"] as? Bool, false, "iOS must not claim a reliable recursive filesystem event fence")
    }

    func testEmbeddedBackupPagesSurviveAdapterRestart() async throws {
        XCTAssertTrue(RustEmbeddedInventoryTransport.isAvailable)
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: temporary) }
        let source = temporary.appendingPathComponent("source")
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        let bytes = Data("synthetic iOS Rust bytes".utf8)
        try bytes.write(to: source.appendingPathComponent("sample.txt"))
        try FileManager.default.createDirectory(at: source.appendingPathComponent("empty"), withIntermediateDirectories: false)
        let bookmark = try source.bookmarkData(options: [.minimalBookmark], includingResourceValuesForKeys: nil, relativeTo: nil)
        let database = temporary.appendingPathComponent("index.sqlite3")
        let jobs = temporary.appendingPathComponent("jobs")
        let inventory = MobileFolderInventory(directory: jobs, transport: RustEmbeddedInventoryTransport(database: database), database: database)
        let owner = try FileSyncOwnerScope(ownerId: "synthetic-ios-test", url: URL(string: "https://example.test")!)
        let scope = MobileFolderInventory.Scope(owner: owner, deviceId: "simulator-fixture", rootId: UUID().uuidString)
        let capture = try await Task.detached { () throws -> MobileFolderInventory.Capture in
            let prepared = try inventory.prepareBackup(scope, id: UUID().uuidString, generation: UUID().uuidString, bookmark: bookmark)
            try inventory.sealBackup(scope, capture: prepared, bookmark: bookmark)
            return prepared
        }.value
        let reopened = MobileFolderInventory(directory: jobs, transport: RustEmbeddedInventoryTransport(database: database), database: database)
        let page = try reopened.read(scope, capture: capture, bookmark: bookmark, offset: 0)
        XCTAssertEqual(Set(page.entries.map(\.path)), Set(["sample.txt", "empty"]))
        XCTAssertEqual(page.entries.first(where: { $0.path == "sample.txt" })?.size, Int64(bytes.count))
        XCTAssertNil(page.nextOffset)
    }
}
