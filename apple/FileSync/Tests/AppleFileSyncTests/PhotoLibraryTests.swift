@testable import AppleFileSync
import XCTest
import CryptoKit

private final class PhotoFixtures: PhotoResourceProvider, @unchecked Sendable {
    var permission = "full", exports = 0
    var records: [PhotoResource] = [], bytes: [String: Data] = [:]
    var onWrite: (() -> Void)?
    func access() -> String { permission }
    func inventory() throws -> [PhotoResource] {
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
    func testOriginalMultipartFingerprintStableVersionsAndRangeCache() throws {
        let provider = PhotoFixtures(), bytes = Data(repeating: 23, count: 8 * 1024 * 1024 + 31)
        let resource = provider.add("asset/1", bytes: bytes), reader = PhotoLibraryReader(provider: provider)
        let row = try XCTUnwrap(reader.scan(scope: "owner/grant").first)
        var parts = Data(SHA256.hash(data: bytes.prefix(8 * 1024 * 1024))); parts.append(Data(SHA256.hash(data: bytes.suffix(31))))
        XCTAssertEqual(row.fingerprint?.sha256, PhotoLibraryReader.hash(parts)); XCTAssertEqual(row.size, Int64(bytes.count))
        let chunk = try reader.read(scope: "owner/grant", path: resource.path, version: row.version, offset: 8 * 1024 * 1024, length: 65536)
        XCTAssertEqual(Data(base64Encoded: chunk.data), bytes.suffix(31)); XCTAssertEqual(provider.exports, 1)
        reader.discard(); XCTAssertEqual(try reader.scan(scope: "owner/grant"), [row]); XCTAssertEqual(provider.exports, 2)
        _ = try reader.read(scope: "other/grant", path: resource.path, version: row.version, offset: 0, length: 1)
        XCTAssertEqual(provider.exports, 3, "No cached file reuse across owner/grant boundaries")
        XCTAssertThrowsError(try reader.read(scope: "owner/grant", path: "../original", version: row.version, offset: 0, length: 1))
        XCTAssertThrowsError(try reader.read(scope: "owner/grant", path: resource.path, version: row.version, offset: 0, length: 65537))
    }
    func testResourcesWithSameNamesAndLivePhotoCompanionsRemainDistinct() throws {
        let provider = PhotoFixtures(); provider.add("first", bytes: Data([1])); provider.add("second", bytes: Data([2])); provider.add("first", index: 1, bytes: Data([3]))
        let reader = PhotoLibraryReader(provider: provider), rows = try reader.scan(scope: "owner/grant")
        XCTAssertEqual(Set(rows.map(\.path)).count, 3); XCTAssertEqual(Set(rows.map(\.id)).count, 3)
        for (index, row) in rows.enumerated() {
            let chunk = try reader.read(scope: "owner/grant", path: row.path, version: row.version, offset: 0, length: 4)
            XCTAssertEqual(Data(base64Encoded: chunk.data), Data([UInt8(index + 1)]))
        }
    }
    func testPermissionRevocationMissingOriginalAndChangedLibraryFailClosed() throws {
        let provider = PhotoFixtures(), resource = provider.add("first", bytes: Data([1])), reader = PhotoLibraryReader(provider: provider)
        let row = try XCTUnwrap(reader.scan(scope: "a").first)
        provider.permission = "unavailable"
        XCTAssertThrowsError(try reader.scan(scope: "a")); XCTAssertThrowsError(try reader.read(scope: "a", path: resource.path, version: row.version, offset: 0, length: 1))
        provider.permission = "limited"; provider.records = []
        XCTAssertEqual(try reader.scan(scope: "a"), []); XCTAssertThrowsError(try reader.read(scope: "a", path: resource.path, version: row.version, offset: 0, length: 1))
        provider.records = [resource]; provider.bytes = [:]; XCTAssertThrowsError(try reader.scan(scope: "a"))
        provider.bytes[resource.path] = Data([1]); provider.onWrite = { provider.records = [] }
        XCTAssertThrowsError(try reader.scan(scope: "a"))
    }
    func testMutationAndCancellationCannotReturnACompleteInventory() async throws {
        let provider = PhotoFixtures(), resource = provider.add("first", bytes: Data([1])), reader = PhotoLibraryReader(provider: provider)
        let row = try XCTUnwrap(reader.scan(scope: "a").first)
        provider.records = [PhotoResource(asset: resource.asset, index: 0, name: resource.name, revision: "v2")]
        XCTAssertThrowsError(try reader.read(scope: "a", path: row.path, version: row.version, offset: 0, length: 1))
        let worker = Task.detached { withUnsafeCurrentTask { $0?.cancel() }; return try reader.scan(scope: "a") }
        do { _ = try await worker.value; XCTFail("Cancelled scan succeeded") } catch is CancellationError { }
    }
    func testPhotoStreamMatchesOriginalAndRevocationStopsProvisionalBytes() throws {
        let provider = PhotoFixtures(), bytes = Data(repeating: 7, count: 131_079)
        let resource = provider.add("stream", bytes: bytes), reader = PhotoLibraryReader(provider: provider)
        let entry = try XCTUnwrap(reader.scan(scope: "owner/grant").first)
        var read = Data()
        let size = try reader.stream(scope: "owner/grant", path: resource.path, version: entry.version, offset: 0, length: bytes.count) { read.append($0) }
        XCTAssertEqual(size, Int64(bytes.count)); XCTAssertEqual(read, bytes)
        XCTAssertThrowsError(try reader.stream(scope: "owner/grant", path: resource.path, version: entry.version, offset: 0, length: bytes.count) { _ in provider.permission = "unavailable" })
        XCTAssertThrowsError(try reader.read(scope: "owner/grant", path: resource.path, version: entry.version, offset: 0, length: 1))
    }
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
