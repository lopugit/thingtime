@testable import AppleFileSync
import XCTest
import CryptoKit

private final class PhotoFixtures: PhotoResourceProvider, @unchecked Sendable {
    var permission = "full", exports = 0, inventoryCalls = 0
    var records: [PhotoResource] = [], bytes: [String: Data] = [:]
    var onWrite: (() -> Void)?
    func access() -> String { permission }
    func inventory() throws -> [PhotoResource] {
        inventoryCalls += 1
        guard permission != "unavailable" else { throw PhotoLibraryReader.Failure.unavailable }
        return records
    }
    func validate(_ resource: PhotoResource) throws {
        guard permission != "unavailable", records.contains(resource) else { throw PhotoLibraryReader.Failure.changed }
    }
    func write(_ resource: PhotoResource, to url: URL) throws {
        try validate(resource); exports += 1
        guard let bytes = bytes[resource.path] else { throw PhotoLibraryReader.Failure.cloudOriginal }
        try bytes.write(to: url); onWrite?()
    }
    @discardableResult func add(_ asset: String, index: Int = 0, bytes: Data, revision: String = "v1") -> PhotoResource {
        let r = PhotoResource(asset: asset, index: index, name: "same-original.jpg", revision: revision)
        records.append(r); self.bytes[r.path] = bytes; return r
    }
}
final class PhotoLibraryTests: XCTestCase {
    #if os(macOS)
    private func makeReader(_ provider: PhotoFixtures) throws -> PhotoLibraryReader {
        let environmentPath = ProcessInfo.processInfo.environment["THINGTIME_TEST_COMMANDER_INDEXER"]
        let checkout = (0..<5).reduce(URL(fileURLWithPath: #filePath)) { url, _ in url.deletingLastPathComponent() }
        let helper = environmentPath.map { URL(fileURLWithPath: $0) }
            ?? checkout.appendingPathComponent("filesystem-indexer/target/debug/commander-indexer")
        guard FileManager.default.isExecutableFile(atPath: helper.path) else {
            XCTFail("Build commander-indexer or set THINGTIME_TEST_COMMANDER_INDEXER to run the PhotoKit inventory tests.")
            throw RustInventoryTransportFailure.unavailable
        }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("photo-index-fixture-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        return PhotoLibraryReader(provider: provider, transport: RustProcessInventoryTransport(
            helper: helper, database: directory.appendingPathComponent("filesystem-index.sqlite3")
        ))
    }

    func testOriginalMultipartFingerprintStableVersionsAndRangeCache() throws {
        let provider = PhotoFixtures(), bytes = Data(repeating: 23, count: 8 * 1024 * 1024 + 31)
        let resource = provider.add("asset/1", bytes: bytes), reader = try makeReader(provider)
        let row = try XCTUnwrap(reader.scan(scope: "owner/grant").first)
        var parts = Data(SHA256.hash(data: bytes.prefix(8 * 1024 * 1024))); parts.append(Data(SHA256.hash(data: bytes.suffix(31))))
        XCTAssertEqual(row.fingerprint?.sha256, PhotoLibraryReader.hash(parts)); XCTAssertEqual(row.size, Int64(bytes.count))
        let chunk = try reader.read(scope: "owner/grant", path: resource.path, version: row.version, offset: 8 * 1024 * 1024, length: 65536)
        XCTAssertEqual(Data(base64Encoded: chunk.data), bytes.suffix(31)); XCTAssertEqual(provider.exports, 1)
        reader.discard(); XCTAssertEqual(try reader.scan(scope: "owner/grant"), [row]); XCTAssertEqual(provider.exports, 1)
        _ = try reader.read(scope: "other/grant", path: resource.path, version: row.version, offset: 0, length: 1)
        XCTAssertEqual(provider.exports, 2, "No cached file reuse across owner/grant boundaries")
        XCTAssertThrowsError(try reader.read(scope: "owner/grant", path: "../original", version: row.version, offset: 0, length: 1))
        XCTAssertThrowsError(try reader.read(scope: "owner/grant", path: resource.path, version: row.version, offset: 0, length: 65537))
    }
    func testResourcesWithSameNamesAndLivePhotoCompanionsRemainDistinct() throws {
        let provider = PhotoFixtures(); provider.add("first", bytes: Data([1])); provider.add("second", bytes: Data([2])); provider.add("first", index: 1, bytes: Data([3]))
        let owner = try FileSyncOwnerScope(ownerId: "photos", url: URL(string: "https://fixture.invalid")!)
        let scope = PhotoLibraryReader.Scope(owner: owner, deviceId: "fixture", rootId: UUID().uuidString)
        let reader = try makeReader(provider), rows = try reader.scan(scope: scope)
        XCTAssertEqual(Set(rows.map(\.path)).count, 3); XCTAssertEqual(Set(rows.map(\.id)).count, 3)
        for (index, row) in rows.enumerated() {
            let chunk = try reader.read(scope: scope, path: row.path, version: row.version, offset: 0, length: 4)
            XCTAssertEqual(Data(base64Encoded: chunk.data), Data([UInt8(index + 1)]))
        }
    }
    func testPermissionRevocationMissingOriginalAndChangedLibraryFailClosed() throws {
        let provider = PhotoFixtures(), resource = provider.add("first", bytes: Data([1])), reader = try makeReader(provider)
        let row = try XCTUnwrap(reader.scan(scope: "a").first)
        provider.permission = "unavailable"
        XCTAssertThrowsError(try reader.scan(scope: "a")); XCTAssertThrowsError(try reader.read(scope: "a", path: resource.path, version: row.version, offset: 0, length: 1))
        provider.permission = "limited"; provider.records = []
        XCTAssertEqual(try reader.scan(scope: "a"), []); XCTAssertThrowsError(try reader.read(scope: "a", path: resource.path, version: row.version, offset: 0, length: 1))
        provider.records = [resource]; provider.bytes = [:]; XCTAssertThrowsError(try reader.scan(scope: "cold"))
        provider.bytes[resource.path] = Data([1]); provider.onWrite = { provider.records = [] }
        XCTAssertThrowsError(try reader.scan(scope: "cold"))
    }
    func testMutationAndCancellationCannotReturnACompleteInventory() async throws {
        let provider = PhotoFixtures(), resource = provider.add("first", bytes: Data([1])), reader = try makeReader(provider)
        let row = try XCTUnwrap(reader.scan(scope: "a").first)
        provider.records = [PhotoResource(asset: resource.asset, index: 0, name: resource.name, revision: "v2")]
        XCTAssertThrowsError(try reader.read(scope: "a", path: row.path, version: row.version, offset: 0, length: 1))
        let worker = Task.detached { withUnsafeCurrentTask { $0?.cancel() }; return try reader.scan(scope: "a") }
        do { _ = try await worker.value; XCTFail("Cancelled scan succeeded") } catch is CancellationError { }
    }
    func testPhotoStreamMatchesOriginalAndRevocationStopsProvisionalBytes() throws {
        let provider = PhotoFixtures(), bytes = Data(repeating: 7, count: 131_079)
        let resource = provider.add("stream", bytes: bytes), reader = try makeReader(provider)
        let entry = try XCTUnwrap(reader.scan(scope: "owner/grant").first)
        var read = Data()
        let size = try reader.stream(scope: "owner/grant", path: resource.path, version: entry.version, offset: 0, length: bytes.count) { read.append($0) }
        XCTAssertEqual(size, Int64(bytes.count)); XCTAssertEqual(read, bytes)
        XCTAssertThrowsError(try reader.stream(scope: "owner/grant", path: resource.path, version: entry.version, offset: 0, length: bytes.count) { _ in provider.permission = "unavailable" })
        XCTAssertThrowsError(try reader.read(scope: "owner/grant", path: resource.path, version: entry.version, offset: 0, length: 1))
    }
    func testPagedPhotoCaptureRejectsMembershipChangeBeforeFinalPage() throws {
        let provider = PhotoFixtures()
        provider.add("first", bytes: Data([1]))
        provider.add("second", bytes: Data([2]))
        let reader = try makeReader(provider)
        let owner = try FileSyncOwnerScope(ownerId: "photos", url: URL(string: "https://fixture.invalid")!)
        let scope = PhotoLibraryReader.Scope(owner: owner, deviceId: "device", rootId: UUID().uuidString)
        let capture = try reader.capture(scope: scope, id: UUID().uuidString)
        XCTAssertEqual(capture.totalEntries, 2)
        let first = try reader.page(scope: scope, capture: capture, offset: 0, pageSize: 1)
        XCTAssertEqual(first.nextOffset, 1)
        XCTAssertEqual(first.entries.count, 1)
        XCTAssertEqual(try reader.inspect(scope: scope, path: first.entries[0].path), first.entries[0])
        provider.add("new", bytes: Data([3]))
        XCTAssertThrowsError(try reader.page(scope: scope, capture: capture, offset: 1, pageSize: 1))
        let next = try reader.capture(scope: scope, id: UUID().uuidString)
        let refreshed = try reader.page(scope: scope, capture: next, offset: 0)
        XCTAssertEqual(refreshed.entries.count, 3)
        XCTAssertNil(refreshed.nextOffset)
        XCTAssertEqual(provider.exports, 3, "The next generation should export only the new original")
        try reader.discard(scope: scope, capture: next)
        let calls = provider.inventoryCalls
        XCTAssertEqual(try reader.inspect(scope: scope, path: refreshed.entries[0].path), refreshed.entries[0])
        XCTAssertEqual(provider.inventoryCalls, calls, "An authorized path hint avoids enumerating the whole library")
        XCTAssertThrowsError(try reader.page(scope: scope, capture: next, offset: 0))
    }

    func testReadReobservesOriginalAndRejectsChangedBytesAfterLogicalCacheHit() throws {
        let provider = PhotoFixtures()
        let resource = provider.add("first", bytes: Data([1]))
        let reader = try makeReader(provider)
        let row = try XCTUnwrap(reader.scan(scope: "owner/grant").first)
        reader.discard()
        provider.bytes[resource.path] = Data([2])
        XCTAssertEqual(try reader.scan(scope: "owner/grant"), [row])
        XCTAssertEqual(provider.exports, 1)
        XCTAssertThrowsError(try reader.read(scope: "owner/grant", path: row.path, version: row.version, offset: 0, length: 1))
        XCTAssertEqual(provider.exports, 2)
        let refreshed = try XCTUnwrap(reader.scan(scope: "owner/grant").first)
        XCTAssertNotEqual(refreshed.version, row.version)
    }

    func testBackgroundPhotoPreparationIsUnpublishedAndCancellable() async throws {
        let provider = PhotoFixtures()
        provider.add("slow-original", bytes: Data([1]))
        let reader = try makeReader(provider)
        let owner = try FileSyncOwnerScope(ownerId: "photos", url: URL(string: "https://fixture.invalid")!)
        let foreign = try FileSyncOwnerScope(ownerId: "other", url: owner.origin)
        let scope = PhotoLibraryReader.Scope(owner: owner, deviceId: "device", rootId: UUID().uuidString)
        let foreignScope = PhotoLibraryReader.Scope(owner: foreign, deviceId: scope.deviceId, rootId: scope.rootId)
        let id = UUID().uuidString.lowercased()
        let entered = DispatchSemaphore(value: 0), release = DispatchSemaphore(value: 0)
        provider.onWrite = { entered.signal(); _ = release.wait(timeout: .now() + 5) }
        let worker = Task.detached { try reader.prepareCapture(scope: scope, id: id, generation: id) }
        defer { worker.cancel(); release.signal() }
        XCTAssertEqual(entered.wait(timeout: .now() + 5), .success)
        // Status is available while the original export is blocked. Neither
        // the active owner nor a different identity receives provisional rows.
        XCTAssertNil(try reader.status(scope: scope, id: id))
        XCTAssertNil(try reader.status(scope: foreignScope, id: id))
        worker.cancel(); release.signal()
        do { _ = try await worker.value; XCTFail("Cancelled preparation completed") }
        catch is CancellationError {}
        let cancelled = MobileFolderInventory.Capture(id: id, generation: id, totalEntries: 0)
        try reader.discard(scope: scope, capture: cancelled)
        XCTAssertThrowsError(try reader.page(scope: scope, capture: cancelled, offset: 0))

        provider.onWrite = nil
        let replacement = UUID().uuidString.lowercased()
        var progress: [Int] = []
        let prepared = try reader.prepareCapture(scope: scope, id: replacement, generation: replacement, progress: { progress.append($0) })
        XCTAssertEqual(progress, [1])
        XCTAssertNil(try reader.status(scope: scope, id: replacement))
        XCTAssertThrowsError(try reader.sealCapture(scope: foreignScope, capture: prepared))
        XCTAssertEqual(try reader.sealCapture(scope: scope, capture: prepared), prepared)
        XCTAssertEqual(try reader.status(scope: scope, id: replacement), prepared)
    }

    func testUnavailableIndexerNeverFallsBackToSwift() throws {
        let provider = PhotoFixtures()
        provider.add("first", bytes: Data([1]))
        let missing = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let reader = PhotoLibraryReader(provider: provider, transport: RustProcessInventoryTransport(helper: missing))
        XCTAssertThrowsError(try reader.scan(scope: "owner/grant")) {
            guard case RustInventoryTransportFailure.unavailable = $0 else { return XCTFail("Unexpected error: \($0)") }
        }
    }

    #endif

    @MainActor func testPhotoGrantReloadScopeAndWriteRefusal() throws {
        var data: Data?
        let scope = try FileSyncOwnerScope(ownerId: "photos", url: URL(string: "https://thingtime.test")!)
        let store = MobileFolderStore(load: { _ in data }, save: { _, next in data = next })
        let grant = try store.addPhotos(scope)
        XCTAssertEqual(try store.addPhotos(scope).id, grant.id); XCTAssertEqual(try store.grant(scope, id: grant.id).sourceKind, "photos")
        XCTAssertTrue(grant.bookmark.isEmpty)
        let approval = MobileFolderStore.WriteApproval(scope: .init(origin: scope.origin.absoluteString, ownerId: scope.ownerId, dataPlane: "home", rootId: "connection", deviceId: "device"), configurationRevision: "1", configurationHash: String(repeating: "a", count: 64))
        XCTAssertThrowsError(try store.approveWrite(scope, grant: grant, approval: approval))
        let forged = MobileFolderStore.Grant(id: grant.id, scope: scope, name: grant.name, bookmark: Data())
        XCTAssertThrowsError(try store.approveWrite(scope, grant: forged, approval: approval))
        XCTAssertThrowsError(try store.list(FileSyncOwnerScope(ownerId: "other", url: scope.origin)))
        try store.remove(scope, id: grant.id); XCTAssertTrue(try store.list(scope).isEmpty)
    }
}
