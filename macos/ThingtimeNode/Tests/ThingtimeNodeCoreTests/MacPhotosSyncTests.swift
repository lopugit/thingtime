import XCTest
import Foundation
import CryptoKit
import AppleFileSync
@testable import ThingtimeNodeCore

private final class MacPhotoFixture: PhotoResourceProvider, @unchecked Sendable {
    private let lock = NSLock()
    private var permission = "full", revision = "v1"
    let bytes = Data((0..<(8 * 1024 * 1024 + 17)).map { UInt8($0 % 251) })
    func access() -> String { lock.lock(); defer { lock.unlock() }; return permission }
    func setAccess(_ value: String) { lock.lock(); permission = value; lock.unlock() }
    func change() { lock.lock(); revision = "v2"; lock.unlock() }
    func inventory() throws -> [PhotoResource] {
        lock.lock(); defer { lock.unlock() }
        guard permission != "unavailable" else { throw PhotoLibraryReader.Failure.unavailable }
        return [.init(asset: "synthetic-original", index: 0, name: "original.png", revision: revision)]
    }
    func validate(_ resource: PhotoResource) throws {
        guard try inventory().contains(resource) else { throw PhotoLibraryReader.Failure.changed }
    }
    func write(_ resource: PhotoResource, to url: URL) throws { try validate(resource); try bytes.write(to: url) }
}
private final class MacPhotoBytes: @unchecked Sendable { var value = Data() }

@MainActor final class MacPhotosSyncTests: XCTestCase {
    private let origin = URL(string: "https://sync.test")!
    private var directory: URL!
    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("mac-photo-test-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try FileManager.default.removeItem(at: directory) }
    private func request(_ action: String, _ fields: [String: JSONValue] = [:]) -> JSONValue {
        .object(["action": .string(action), "requestId": .string(UUID().uuidString), "ownerId": .string("owner"),
                 "deviceId": .string("device"), "origin": .string(origin.absoluteString)].merging(fields) { _, value in value })
    }
    private func service(_ provider: MacPhotoFixture, choose: @escaping () async throws -> MacFolderSync.SourceSelection? = { .photos },
                         verify: @escaping (String, String) async throws -> Void = { owner, device in
                             guard owner == "owner", device == "device" else { throw MobileFolderStore.Failure.unavailable }
                         }) throws -> MacFolderSync {
        var saved: [String: Data] = [:]
        return try MacFolderSync(origin: origin,
            store: MobileFolderStore(load: { saved[$0.key] }, save: { saved[$0.key] = $1 }),
            staging: MobileSyncStaging(directory: directory.appendingPathComponent("stage")), verify: verify,
            choose: { XCTFail("Legacy folder picker must not run"); return nil }, approve: { _ in XCTFail("Photos must never request write approval"); return true },
            chooseSource: choose, photos: PhotoLibraryReader(provider: provider))
    }
    private func root(_ service: MacFolderSync) async throws -> String {
        let response = try await service.handle(request("choose")).decode([String: JSONValue].self)
        let rows = try XCTUnwrap(response["roots"]).decode([[String: JSONValue]].self)
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(Set(rows[0].keys), ["id", "name", "sourceKind", "photoAccess"])
        XCTAssertEqual(rows[0]["sourceKind"], .string("photos")); XCTAssertEqual(rows[0]["photoAccess"], .string("full"))
        return try XCTUnwrap(rows[0]["id"]).decode(String.self)
    }
    private func entry(_ service: MacFolderSync, root: String) async throws -> MobileFolderReader.Entry {
        let result = try await service.handle(request("scan", ["rootId": .string(root)])).decode([String: JSONValue].self)
        XCTAssertEqual(result["complete"], .bool(true))
        return try XCTUnwrap(result["entries"]).decode([MobileFolderReader.Entry].self)[0]
    }
    private func rejects(_ operation: () async throws -> JSONValue) async {
        do { _ = try await operation(); XCTFail("Unsafe request accepted") } catch { }
    }
    func testOriginalBinaryStreamUsesSharedFingerprintsAndReadOnlyGrant() async throws {
        let fixture = MacPhotoFixture(), service = try service(fixture), root = try await root(service)
        let original = try await entry(service, root: root)
        XCTAssertEqual(original.size, Int64(fixture.bytes.count)); XCTAssertEqual(original.fingerprint?.partCount, 2)
        let received = MacPhotoBytes()
        let fields: [String: JSONValue] = ["rootId": .string(root), "path": .string(original.path), "version": .string(original.version), "offset": .number(0), "length": .number(Double(original.size))]
        let result = try await service.handle(request("read-range", fields), stream: { received.value.append($0) }).decode([String: JSONValue].self)
        XCTAssertEqual(received.value, fixture.bytes); XCTAssertNotNil(result["chunk"])
        for action in ["write-approve", "stage-begin", "stage-append", "stage-finish", "publish", "publication-lookup", "trash", "trash-list", "trash-restore-reviewed"] {
            await rejects { try await service.handle(self.request(action, ["rootId": .string(root)])) }
        }
        _ = try await service.handle(request("remove", ["rootId": .string(root)]))
        await rejects { try await service.handle(self.request("read-range", fields), stream: { _ in XCTFail("Removed grant emitted bytes") }) }
    }
    func testRevokedPermissionIsVisibleAndNeverAnEmptySuccessfulScan() async throws {
        let fixture = MacPhotoFixture(), service = try service(fixture), root = try await root(service)
        fixture.setAccess("limited")
        let limited = try await service.handle(request("list")).decode([String: JSONValue].self)
        XCTAssertEqual(try limited["roots"]?.decode([[String: JSONValue]].self)[0]["photoAccess"], .string("limited"))
        fixture.setAccess("unavailable")
        await rejects { try await service.handle(self.request("scan", ["rootId": .string(root)])) }
        let unavailable = try await service.handle(request("list")).decode([String: JSONValue].self)
        XCTAssertEqual(try unavailable["roots"]?.decode([[String: JSONValue]].self)[0]["photoAccess"], .string("unavailable"))
    }
    func testMidStreamRevocationAndSourceMutationRefuseCompletion() async throws {
        let fixture = MacPhotoFixture(), service = try service(fixture), root = try await root(service)
        let original = try await entry(service, root: root)
        let fields: [String: JSONValue] = ["rootId": .string(root), "path": .string(original.path), "version": .string(original.version), "offset": .number(0), "length": .number(Double(original.size))]
        await rejects { try await service.handle(self.request("read-range", fields), stream: { _ in fixture.setAccess("unavailable") }) }
        fixture.setAccess("full"); fixture.change()
        await rejects { try await service.handle(self.request("read-range", fields), stream: { _ in XCTFail("Changed source emitted bytes") }) }
    }
    func testCancelledOrStaleSourceChoiceCannotSavePhotoGrant() async throws {
        let fixture = MacPhotoFixture()
        let cancelled = try service(fixture, choose: { nil })
        let value = try await cancelled.handle(request("choose")).decode([String: JSONValue].self)
        XCTAssertEqual(value["roots"], .array([]))
        var valid = true
        let stale = try service(fixture, choose: { valid = false; return .photos }, verify: { _, _ in if !valid { throw MobileFolderStore.Failure.unavailable } })
        await rejects { try await stale.handle(self.request("choose")) }
        valid = true
        let fresh = try await stale.handle(request("list")).decode([String: JSONValue].self)
        XCTAssertEqual(fresh["roots"], .array([]))
        fixture.setAccess("unavailable")
        let denied = try service(fixture)
        await rejects { try await denied.handle(self.request("choose")) }
        let deniedRoots = try await denied.handle(request("list")).decode([String: JSONValue].self)
        XCTAssertEqual(deniedRoots["roots"], .array([]))
    }
}
