@testable import AppleFileSync
import Foundation
import XCTest
@testable import Thingtime

private final class CachePhotoProvider: PhotoResourceProvider, @unchecked Sendable {
    var resources: [PhotoResource] = (0..<5).map { PhotoResource(asset: "cache-original-\($0)", index: 0, name: "original.png", revision: "one") }
    var permission = "full"
    var exports = 0, inventoryCalls = 0, exportSeconds = 0.0
    var urls: [String: URL] = [:]
    var revisedBytes: [String: Data] = [:]
    let bytes = Data(repeating: 0x73, count: 512 * 1024)
    func access() -> String { permission }
    func inventory() throws -> [PhotoResource] { inventoryCalls += 1; return resources }
    func validate(_ resource: PhotoResource) throws { guard permission == "full", resources.contains(resource) else { throw PhotoLibraryReader.Failure.changed } }
    func write(_ resource: PhotoResource, to url: URL) throws {
        try validate(resource); let start = Date(); try (revisedBytes[resource.path] ?? bytes).write(to: url)
        exports += 1; exportSeconds += Date().timeIntervalSince(start); urls[resource.path] = url
    }
}
@MainActor
final class PhotoOriginalCacheTests: XCTestCase {
    func testFiveConcurrentOriginalsReuseVerifiedBytesBetweenParts() async throws {
        let provider = CachePhotoProvider(), directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let reader = PhotoLibraryReader(provider: provider, transport: RustEmbeddedInventoryTransport(database: directory.appendingPathComponent("index.sqlite3")))
        let owner = try FileSyncOwnerScope(ownerId: "cache-owner", url: URL(string: "https://cache.test")!)
        let scope = PhotoLibraryReader.Scope(owner: owner, deviceId: "cache-device", rootId: "cache-grant")
        let began = Date(), entries = try await Task.detached { try reader.scan(scope: scope) }.value
        let prepared = Date()
        XCTAssertEqual(entries.count, 5)
        // Lookahead prepares five other originals while these siblings wait.
        let lookahead = (5..<10).map { PhotoResource(asset: "cache-original-\($0)", index: 0, name: "original.png", revision: "one") }
        provider.resources.append(contentsOf: lookahead)
        for resource in lookahead { _ = try await Task.detached { try reader.inspect(scope: scope, path: resource.path) }.value }
        let warmed = Date(), inventoriesBeforeRepeats = provider.inventoryCalls
        for _ in 0..<3 {
            try await withThrowingTaskGroup(of: Void.self) { group in
                for entry in entries { group.addTask {
                    // The production staging guard is this exact one-byte read;
                    // each sibling then consumes another part of its original.
                    let chunk = try reader.read(scope: scope, path: entry.path, version: entry.version, offset: 0, length: 1)
                    XCTAssertEqual(Data(base64Encoded: chunk.data), provider.bytes.prefix(1))
                    _ = try reader.stream(scope: scope, path: entry.path, version: entry.version, offset: 1, length: 32) { XCTAssertEqual($0, provider.bytes.subdata(in: 1..<33)) }
                } }
                try await group.waitForAll()
            }
        }
        print("IOS_ORIGINAL_CACHE_MEASURE: exports=\(provider.exports) exportSeconds=\(provider.exportSeconds) preparationSeconds=\(prepared.timeIntervalSince(began)) lookaheadSeconds=\(warmed.timeIntervalSince(prepared)) repeatedSeconds=\(Date().timeIntervalSince(warmed))")
        XCTAssertEqual(provider.inventoryCalls, inventoriesBeforeRepeats, "Switching cached siblings must not enumerate the library again")
        XCTAssertEqual(provider.exports, 10, "Five admitted original resources must not repeatedly export/hash each other's unchanged bytes")
    }
    private func fixture(_ provider: CachePhotoProvider, count: Int = 10, bytes: Int64 = 128 * 1024 * 1024) throws -> (PhotoLibraryReader, PhotoLibraryReader.Scope, URL) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let reader = PhotoLibraryReader(provider: provider, transport: RustEmbeddedInventoryTransport(database: directory.appendingPathComponent("index.sqlite3")), maximumCachedOriginals: count, reusableOriginalBytes: bytes)
        let owner = try FileSyncOwnerScope(ownerId: "cache-owner", url: URL(string: "https://cache.test")!)
        return (reader, .init(owner: owner, deviceId: "cache-device", rootId: "cache-grant"), directory)
    }
    func testOversizedOriginalReusesUntilCompetitionAndEvictsWithoutSizeRejection() throws {
        let provider = CachePhotoProvider(); provider.resources = Array(provider.resources.prefix(1))
        let (reader, scope, directory) = try fixture(provider, bytes: 1024)
        defer { reader.discard(); try? FileManager.default.removeItem(at: directory) }
        let entry = try XCTUnwrap(reader.scan(scope: scope).first)
        let firstURL = try XCTUnwrap(provider.urls[entry.path])
        for _ in 0..<3 { _ = try reader.read(scope: scope, path: entry.path, version: entry.version, offset: 1, length: 16) }
        XCTAssertEqual(provider.exports, 1); XCTAssertTrue(FileManager.default.fileExists(atPath: firstURL.path))
        let other = PhotoResource(asset: "competing", index: 0, name: "other.png", revision: "one")
        provider.resources.append(other)
        let next = try XCTUnwrap(reader.inspect(scope: scope, path: other.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: firstURL.path))
        _ = try reader.read(scope: scope, path: next.path, version: next.version, offset: 0, length: 1)
        XCTAssertEqual(provider.exports, 2)
    }
    func testCountScopeDiscardAndTamperFencesPreserveExactOriginals() throws {
        let provider = CachePhotoProvider()
        let (reader, scope, directory) = try fixture(provider, count: 2)
        defer { reader.discard(); try? FileManager.default.removeItem(at: directory) }
        let entries = try reader.scan(scope: scope)
        let urls = provider.urls
        XCTAssertEqual(urls.values.filter { FileManager.default.fileExists(atPath: $0.path) }.count, 2)
        let last = try XCTUnwrap(entries.last), url = try XCTUnwrap(provider.urls[last.path])
        try Data([1,2,3]).write(to: url)
        XCTAssertThrowsError(try reader.read(scope: scope, path: last.path, version: last.version, offset: 0, length: 1))
        XCTAssertTrue(urls.values.allSatisfy { !FileManager.default.fileExists(atPath: $0.path) }, "A changed cached stamp clears every reusable original")
        _ = try reader.read(scope: scope, path: last.path, version: last.version, offset: 0, length: 1)
        let restoredURL = try XCTUnwrap(provider.urls[last.path])
        let other = PhotoLibraryReader.Scope(owner: scope.owner, deviceId: "other-device", rootId: scope.rootId)
        _ = try reader.inspect(scope: other, path: last.path)
        XCTAssertFalse(FileManager.default.fileExists(atPath: restoredURL.path))
        reader.discard()
        XCTAssertTrue(provider.urls.values.allSatisfy { !FileManager.default.fileExists(atPath: $0.path) })
    }
    func testCurrentRevisionRemovalAndPermissionAreRecheckedOnCacheHits() throws {
        let provider = CachePhotoProvider(); provider.resources = Array(provider.resources.prefix(1))
        let (reader, scope, directory) = try fixture(provider)
        defer { reader.discard(); try? FileManager.default.removeItem(at: directory) }
        let old = try XCTUnwrap(reader.scan(scope: scope).first), resource = provider.resources[0]
        provider.resources[0] = PhotoResource(asset: resource.asset, index: resource.index, name: resource.name, revision: "two")
        provider.revisedBytes[resource.path] = Data(repeating: 0x19, count: provider.bytes.count)
        XCTAssertThrowsError(try reader.read(scope: scope, path: old.path, version: old.version, offset: 0, length: 1))
        let current = try XCTUnwrap(reader.inspect(scope: scope, path: old.path))
        XCTAssertNotEqual(current.version, old.version)
        let changed = try reader.read(scope: scope, path: current.path, version: current.version, offset: 0, length: 1)
        XCTAssertEqual(Data(base64Encoded: changed.data), Data([0x19]))
        provider.permission = "unavailable"
        XCTAssertThrowsError(try reader.read(scope: scope, path: current.path, version: current.version, offset: 0, length: 1))
        provider.permission = "full"; provider.resources.removeAll()
        XCTAssertThrowsError(try reader.read(scope: scope, path: current.path, version: current.version, offset: 0, length: 1))
    }

    func testEvictionNeverDeletesBorrowedCloudOriginalAndReleaseOwnsItsCleanup() throws {
        let provider = CachePhotoProvider(); provider.resources = Array(provider.resources.prefix(1))
        let (reader, scope, directory) = try fixture(provider, count: 2)
        defer { reader.discard(); try? FileManager.default.removeItem(at: directory) }
        let resource = provider.resources[0]
        var prepared: PhotoLibraryReader.PreparedCloudOriginal? = try reader.prepareDeferredCloudOriginal(scope: scope, resource: resource, control: nil)
        let borrowedURL = try XCTUnwrap(provider.urls[resource.path])
        let request = PhotoBackupQueueRequest(epoch: UUID(), configurationId: "photos", configurationRevision: "one")
        let id = UUID().uuidString.lowercased()
        let capture = try reader.prepareCapture(scope: scope, id: id, generation: id, allowCloudGaps: true,
            queueRequest: request, startWithSingleAsset: true, preparedDeferred: prepared)
        _ = try reader.sealCapture(scope: scope, capture: capture)
        for index in 0..<3 {
            let competitor = PhotoResource(asset: "cloud-competitor-\(index)", index: 0, name: "other.png", revision: "one")
            provider.resources.append(competitor)
            _ = try reader.inspect(scope: scope, path: competitor.path)
        }
        XCTAssertTrue(FileManager.default.fileExists(atPath: borrowedURL.path), "Reusable cache eviction does not own this pinned cloud directory")
        reader.discard()
        XCTAssertTrue(FileManager.default.fileExists(atPath: borrowedURL.path))
        reader.releaseDeferredCloudOriginal(try XCTUnwrap(prepared)); prepared = nil
        XCTAssertFalse(FileManager.default.fileExists(atPath: borrowedURL.path))
    }
    func testDeinitReleasesEveryOwnedOriginalDirectory() throws {
        let provider = CachePhotoProvider()
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        var reader: PhotoLibraryReader? = PhotoLibraryReader(provider: provider, transport: RustEmbeddedInventoryTransport(database: directory.appendingPathComponent("index.sqlite3")))
        let scope = PhotoLibraryReader.Scope(owner: try FileSyncOwnerScope(ownerId: "cache-owner", url: URL(string: "https://cache.test")!), deviceId: "device", rootId: "grant")
        _ = try reader?.scan(scope: scope)
        XCTAssertEqual(provider.urls.values.filter { FileManager.default.fileExists(atPath: $0.path) }.count, 5)
        reader = nil
        XCTAssertTrue(provider.urls.values.allSatisfy { !FileManager.default.fileExists(atPath: $0.path) })
    }

}
