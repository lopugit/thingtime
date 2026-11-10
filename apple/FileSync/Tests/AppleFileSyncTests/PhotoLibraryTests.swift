@testable import AppleFileSync
import XCTest
import CryptoKit
import Photos

private class PhotoFixtures: PhotoResourceProvider, @unchecked Sendable {
    var permission = "full", exports = 0, inventoryCalls = 0
    var records: [PhotoResource] = [], bytes: [String: Data] = [:], iCloud: [String: Data] = [:]
    var downloads = 0
    var membershipRevision: UInt64?
    var attempts: [String] = []
    var onWrite: (() -> Void)?
    var onDownload: ((PhotoOriginalDownloadControl) throws -> Void)?
    func access() -> String { permission }
    func membershipStamp() -> UInt64? { membershipRevision }
    func inventory() throws -> [PhotoResource] {
        inventoryCalls += 1
        guard permission != "unavailable" else { throw PhotoLibraryReader.Failure.unavailable }
        return records
    }
    func validate(_ resource: PhotoResource) throws {
        guard permission != "unavailable", records.contains(resource) else { throw PhotoLibraryReader.Failure.changed }
    }
    func write(_ resource: PhotoResource, to url: URL) throws {
        try validate(resource); exports += 1; attempts.append(resource.path)
        guard let bytes = bytes[resource.path] else { throw PhotoLibraryReader.Failure.cloudOriginal }
        try bytes.write(to: url); onWrite?()
    }
    func download(_ resource: PhotoResource, to url: URL, control: PhotoOriginalDownloadControl) throws {
        try validate(resource); try control.authorize()
        guard let original = iCloud[resource.path] else { throw PhotoLibraryReader.Failure.cloudOriginal }
        downloads += 1
        try onDownload?(control)
        try original.write(to: url)
        control.progress(1)
    }
    @discardableResult func add(_ asset: String, index: Int = 0, bytes: Data, revision: String = "v1",
                                captured: Double? = nil, modified: Double? = nil, kind: String? = nil) -> PhotoResource {
        let r = PhotoResource(asset: asset, index: index, name: "same-original.jpg", revision: revision,
            capturedAt: captured.map { Date(timeIntervalSince1970: $0) }, modifiedAt: modified.map { Date(timeIntervalSince1970: $0) }, assetKind: kind)
        records.append(r); self.bytes[r.path] = bytes; membershipRevision = membershipRevision.map { $0 + 1 }; return r
    }
}
private final class OrderedPhotoFixtures: PhotoFixtures, OrderedPhotoResourceProvider, @unchecked Sendable {
    var discovered = [String]()
    private final class Inventory: OrderedPhotoInventory {
        let source: OrderedPhotoFixtures
        let groups: [[PhotoResource]]
        private(set) var checkpoint: OrderedPhotoCheckpoint
        private var latest: PhotoLibraryReader.InventoryProgress.Item?

        init(_ source: OrderedPhotoFixtures, resuming: OrderedPhotoCheckpoint?) {
            self.source = source
            groups = PhotoBackupAssetOrder.groups(source.records)
            let token = source.token
            checkpoint = token == resuming?.libraryToken ? (resuming ?? .init(libraryToken: token)) : .init(libraryToken: token)
        }
        var progress: PhotoLibraryReader.InventoryProgress {
            .init(inspected: checkpoint.dated, total: groups.count, indexed: checkpoint.indexed, latest: latest)
        }
        func isCurrent() throws -> Bool { source.token == checkpoint.libraryToken }
        func next() throws -> [PhotoResource]? {
            guard checkpoint.dated < groups.count else { return nil }
            let resources = groups[checkpoint.dated], asset = resources[0]
            source.discovered.append(asset.asset)
            checkpoint.dated += 1
            if asset.assetKind == "video" { checkpoint.indexed.videos += 1 }
            else { checkpoint.indexed.photos += 1 }
            checkpoint.indexed.files += resources.count
            latest = .init(kind: asset.assetKind == "video" ? .video : .photo, capturedAt: asset.capturedAt)
            return resources
        }
    }
    private var token: Data { Data(String(membershipRevision ?? 0).utf8) }
    func orderedInventory(resuming: OrderedPhotoCheckpoint?) throws -> any OrderedPhotoInventory {
        Inventory(self, resuming: resuming)
    }
    func orderedResources(identifiers: [String]) throws -> [[PhotoResource]] {
        identifiers.map { id in records.filter { $0.asset == id }.sorted { $0.index < $1.index } }
    }
}

final class PhotoLibraryTests: XCTestCase {
    func testPhotoExportFailuresDescribeTheActualRecoveryWithoutLeakingNativeDetails() {
        let cases: [(String, Int, PhotoLibraryReader.Failure)] = [
            (PHPhotosErrorDomain, PHPhotosError.Code.networkAccessRequired.rawValue, .cloudOriginal),
            (PHPhotosErrorDomain, PHPhotosError.Code.accessRestricted.rawValue, .unavailable),
            (PHPhotosErrorDomain, PHPhotosError.Code.accessUserDenied.rawValue, .unavailable),
            (PHPhotosErrorDomain, PHPhotosError.Code.notEnoughSpace.rawValue, .storageFull),
            (NSCocoaErrorDomain, CocoaError.fileWriteOutOfSpace.rawValue, .storageFull),
            (PHPhotosErrorDomain, PHPhotosError.Code.internalError.rawValue, .readFailed),
            ("unrelated-domain", PHPhotosError.Code.networkAccessRequired.rawValue, .readFailed)
        ]
        for (domain, code, expected) in cases {
            let native = NSError(domain: domain, code: code, userInfo: [NSLocalizedDescriptionKey: "private asset /owner/photo.jpg"])
            let failure = PhotoLibraryReader.exportFailure(native)
            XCTAssertEqual((failure as? PhotoLibraryReader.Failure)?.errorDescription, expected.errorDescription)
            XCTAssertFalse(failure.localizedDescription.contains("private asset"))
        }
        XCTAssertTrue(PhotoLibraryReader.exportFailure(NSError(domain: PHPhotosErrorDomain,
            code: PHPhotosError.Code.userCancelled.rawValue)) is CancellationError)
        XCTAssertTrue(PhotoLibraryReader.exportFailure(CancellationError()) is CancellationError)
    }
    #if os(macOS)
    private func makeReader(_ provider: PhotoFixtures, queueDirectory: URL? = nil) throws -> PhotoLibraryReader {
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
        ), queueDirectory: queueDirectory ?? directory.appendingPathComponent("photo-queue"))
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
    func testUnavailableOriginalRetryKeepsCompletedObservationsAndEveryResource() throws {
        let provider = PhotoFixtures()
        provider.add("first", bytes: Data([1]))
        provider.add("first", index: 1, bytes: Data([2]))
        provider.records.sort { $0.path < $1.path }
        let missing = provider.records[1], original = provider.bytes.removeValue(forKey: provider.records[1].path)!
        let reader = try makeReader(provider)
        XCTAssertThrowsError(try reader.scan(scope: "retry-owner/grant")) { error in
            XCTAssertEqual((error as? PhotoLibraryReader.Failure)?.errorDescription,
                PhotoLibraryReader.Failure.cloudOriginal.errorDescription)
        }
        XCTAssertEqual(provider.exports, 2)
        provider.bytes[missing.path] = original
        let rows = try reader.scan(scope: "retry-owner/grant")
        XCTAssertEqual(rows.count, 2, "A failed scan must never turn into an empty successful backup")
        XCTAssertEqual(provider.exports, 3, "Retry should retain the completed original observation")
        for row in rows {
            let chunk = try reader.read(scope: "retry-owner/grant", path: row.path, version: row.version, offset: 0, length: 4)
            XCTAssertEqual(Data(base64Encoded: chunk.data), provider.bytes[row.path])
        }
    }
    func testCloudOnlyCompanionDoesNotBlockAvailableOriginalsAndReturnsAfterDownload() throws {
        let provider = PhotoFixtures()
        let still = provider.add("live", bytes: Data([1, 2]))
        let companion = provider.add("live", index: 1, bytes: Data([3, 4]))
        let later = provider.add("other", bytes: Data([5]))
        provider.bytes.removeValue(forKey: companion.path)
        let owner = try FileSyncOwnerScope(ownerId: "photos", url: URL(string: "https://fixture.invalid")!)
        let scope = PhotoLibraryReader.Scope(owner: owner, deviceId: "device", rootId: UUID().uuidString)
        let reader = try makeReader(provider), id = UUID().uuidString.lowercased()
        let prepared = try reader.prepareCapture(scope: scope, id: id, generation: id, allowCloudGaps: true)
        XCTAssertEqual(prepared.coverage, "partial"); XCTAssertEqual(prepared.totalSkipped, 1)
        XCTAssertThrowsError(try reader.page(scope: scope, capture: prepared, offset: 0))
        let sealed = try reader.sealCapture(scope: scope, capture: prepared)
        XCTAssertThrowsError(try reader.status(scope: scope, id: id))
        XCTAssertEqual(try reader.status(scope: scope, id: id, allowCloudGaps: true), sealed)
        let gaps = try reader.readSkipped(scope: scope, capture: sealed, offset: 0)
        XCTAssertEqual(gaps.skipped.map(\.path), [companion.path])
        XCTAssertEqual(gaps.skipped.map(\.reason), [.cloudOriginal])
        let entries = try reader.page(scope: scope, capture: sealed, offset: 0).entries
        XCTAssertEqual(Set(entries.map(\.path)), Set([still.path, later.path]))
        for entry in entries {
            let chunk = try reader.read(scope: scope, path: entry.path, version: entry.version, offset: 0, length: 4)
            XCTAssertEqual(Data(base64Encoded: chunk.data), provider.bytes[entry.path])
        }
        provider.bytes[companion.path] = Data([3, 4])
        let next = UUID().uuidString.lowercased()
        let preparedFull = try reader.prepareCapture(scope: scope, id: next, generation: next, allowCloudGaps: true)
        let full = try reader.sealCapture(scope: scope, capture: preparedFull)
        XCTAssertEqual(full.coverage, "full"); XCTAssertEqual(full.totalSkipped, 0)
        XCTAssertEqual(try reader.page(scope: scope, capture: full, offset: 0).entries.count, 3)
        XCTAssertEqual(try reader.readSkipped(scope: scope, capture: full, offset: 0).skipped.count, 0)
        provider.permission = "unavailable"
        XCTAssertThrowsError(try reader.readSkipped(scope: scope, capture: sealed, offset: 0))
    }

    func testExplicitCloudDownloadPreservesCompanionBytesAndRefusesWithoutLivePolicy() throws {
        let provider = PhotoFixtures()
        let still = provider.add("live", bytes: Data([1]))
        let companion = provider.add("live", index: 1, bytes: Data([2, 3, 4]))
        let original = try XCTUnwrap(provider.bytes.removeValue(forKey: companion.path))
        provider.iCloud[companion.path] = original
        let owner = try FileSyncOwnerScope(ownerId: "photos", url: URL(string: "https://fixture.invalid")!)
        let scope = PhotoLibraryReader.Scope(owner: owner, deviceId: "device", rootId: UUID().uuidString)
        let reader = try makeReader(provider), localID = UUID().uuidString.lowercased()
        let local = try reader.prepareCapture(scope: scope, id: localID, generation: localID, allowCloudGaps: true)
        XCTAssertEqual(local.totalSkipped, 1); XCTAssertEqual(provider.downloads, 0)
        _ = try reader.sealCapture(scope: scope, capture: local)
        let deniedID = UUID().uuidString.lowercased()
        XCTAssertThrowsError(try reader.prepareCapture(scope: scope, id: deniedID, generation: deniedID, allowCloudGaps: true,
            download: .init(authorize: { throw CancellationError() })))
        XCTAssertEqual(provider.downloads, 0)
        let id = UUID().uuidString.lowercased()
        let allowed = PhotoOriginalDownloadControl(authorize: {})
        let prepared = try reader.prepareCapture(scope: scope, id: id, generation: id, allowCloudGaps: true, download: allowed)
        let full = try reader.sealCapture(scope: scope, capture: prepared)
        XCTAssertEqual(full.coverage, "full")
        XCTAssertEqual(provider.downloads, 1)
        let entries = try reader.page(scope: scope, capture: full, offset: 0).entries
        XCTAssertEqual(Set(entries.map(\.path)), Set([still.path, companion.path]))
        let movie = try XCTUnwrap(entries.first { $0.path == companion.path })
        reader.discard() // PhotoKit may evict the original before upload.
        XCTAssertThrowsError(try reader.read(scope: scope, path: movie.path, version: movie.version, offset: 0, length: 1))
        let bytes = try reader.read(scope: scope, path: movie.path, version: movie.version, offset: 0, length: 4, download: allowed)
        XCTAssertEqual(Data(base64Encoded: bytes.data), original)
        XCTAssertEqual(provider.downloads, 2)
    }

    func testCloudCaptureBudgetDefersRemainingResourcesWithoutTruncatingTheLibrary() throws {
        let provider = PhotoFixtures()
        let resources = (0..<6).map { provider.add("original-\($0)", bytes: Data([UInt8($0 + 1)])) }
        for resource in resources { provider.iCloud[resource.path] = provider.bytes.removeValue(forKey: resource.path) }
        let owner = try FileSyncOwnerScope(ownerId: "photos", url: URL(string: "https://fixture.invalid")!)
        let scope = PhotoLibraryReader.Scope(owner: owner, deviceId: "device", rootId: UUID().uuidString)
        let reader = try makeReader(provider), allowed = PhotoOriginalDownloadControl(authorize: {})
        var totals: [Int] = []
        for _ in 0..<2 {
            let id = UUID().uuidString.lowercased()
            let prepared = try reader.prepareCapture(scope: scope, id: id, generation: id, allowCloudGaps: true,
                download: allowed, maximumCloudDownloads: 4)
            let sealed = try reader.sealCapture(scope: scope, capture: prepared)
            totals.append(sealed.totalEntries)
            XCTAssertEqual(sealed.totalEntries + (sealed.totalSkipped ?? -1), resources.count)
            XCTAssertEqual(try reader.readSkipped(scope: scope, capture: sealed, offset: 0).totalSkipped, resources.count - sealed.totalEntries)
        }
        XCTAssertEqual(totals, [4, 6])
        XCTAssertEqual(provider.downloads, 6)
    }

    func testNewestMixedOriginalsAndCompanionsAdvanceWithCachedMembershipAndNewArrival() throws {
        let provider = PhotoFixtures()
        provider.membershipRevision = 0
        let older = (0..<37).map { provider.add("older-\($0)", bytes: Data([UInt8($0 + 1)]), captured: Double($0)) }
        let newest = provider.add("newest-live", bytes: Data([88]), captured: 100)
        let companion = provider.add("newest-live", index: 1, bytes: Data([89]), captured: 100)
        provider.iCloud[newest.path] = provider.bytes.removeValue(forKey: newest.path)
        provider.iCloud[companion.path] = provider.bytes.removeValue(forKey: companion.path)
        let owner = try FileSyncOwnerScope(ownerId: "ordered-photos", url: URL(string: "https://fixture.invalid")!)
        let scope = PhotoLibraryReader.Scope(owner: owner, deviceId: "device", rootId: UUID().uuidString)
        let queue = PhotoBackupQueueRequest(epoch: UUID(), configurationId: "photos", configurationRevision: "r1")
        let reader = try makeReader(provider), allow = PhotoOriginalDownloadControl(authorize: {})
        func capture() throws -> MobileFolderInventory.Capture {
            let id = UUID().uuidString.lowercased()
            return try reader.sealCapture(scope: scope, capture: reader.prepareCapture(scope: scope, id: id, generation: id,
                allowCloudGaps: true, download: allow, queueRequest: queue))
        }
        let first = try capture(), firstBatch = try XCTUnwrap(first.photoQueue)
        XCTAssertEqual(firstBatch.assetKeys.count, 4)
        XCTAssertEqual(firstBatch.pending, 34)
        XCTAssertEqual(provider.attempts, [newest.path, companion.path, older[36].path, older[35].path, older[34].path])
        XCTAssertEqual(provider.downloads, 2)
        XCTAssertEqual(provider.inventoryCalls, 1)
        XCTAssertEqual(try reader.page(scope: scope, capture: first, offset: 0).entries.count, 5)
        XCTAssertEqual(try reader.status(scope: scope, id: first.id, allowCloudGaps: true, queueRequest: queue), first)
        XCTAssertEqual(provider.inventoryCalls, 1, "Sealing, status and paging use the same PhotoKit membership stamp")
        let arriving = provider.add("arrival", bytes: Data([90]), captured: 110)
        try reader.finishQueueBatch(scope: scope, request: queue, batchId: firstBatch.id)
        try reader.finishQueueBatch(scope: scope, request: queue, batchId: firstBatch.id)
        let second = try capture()
        XCTAssertEqual(provider.attempts[5], arriving.path, "A newer arrival precedes the previous backlog")
        var next = second
        var number = 2
        while true {
            let batch = try XCTUnwrap(next.photoQueue)
            try reader.finishQueueBatch(scope: scope, request: queue, batchId: batch.id)
            if batch.pending == 0 { break }
            next = try capture(); number += 1
        }
        XCTAssertEqual(number, 10)
        XCTAssertEqual(Set(provider.attempts).count, 40)
        XCTAssertEqual(provider.inventoryCalls, 2, "Ten batches and one membership change require only two whole-library reads")
    }

    func testSingleNewestAssetIsReadyBeforeLaterAssetsAndAliasReopenPreservesItsReceipt() throws {
        let provider = PhotoFixtures()
        let newest = provider.add("live", bytes: Data([9]), captured: 90, kind: "photo")
        let companion = provider.add("live", index: 1, bytes: Data([8]), captured: 90, kind: "photo")
        let older = (0..<5).map { provider.add("old-\($0)", bytes: Data([7]), captured: Double($0), kind: "video") }
        let files = FileManager.default
        let base = files.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let real = base.appendingPathComponent("real", isDirectory: true)
        let alias = base.appendingPathComponent("alias", isDirectory: true)
        try files.createDirectory(at: real, withIntermediateDirectories: true)
        defer { try? files.removeItem(at: base) }
        try files.createSymbolicLink(at: alias, withDestinationURL: real)
        let owner = try FileSyncOwnerScope(ownerId: "photos", url: URL(string: "https://fixture.invalid")!)
        let scope = PhotoLibraryReader.Scope(owner: owner, deviceId: "fixture", rootId: UUID().uuidString)
        let queue = PhotoBackupQueueRequest(epoch: UUID(), configurationId: "photos", configurationRevision: "r1")
        let oldSelection = PhotoBackupQueue(directory: alias.appendingPathComponent("legacy"), request: queue)
        XCTAssertEqual(try oldSelection.select(revision: "library", resources: provider.records).assets.count, 4)
        let refined = try oldSelection.select(revision: "library", resources: provider.records, replaceStale: true, startWithSingleAsset: true)
        XCTAssertEqual(refined.assets.flatMap(\.resources), [newest, companion])
        var indexed: PhotoLibraryReader.IndexedLibrary?
        var prepared: [Int] = []
        func capture(_ reader: PhotoLibraryReader) throws -> PhotoBackupQueueBatch {
            let id = UUID().uuidString.lowercased()
            let result = try reader.prepareCapture(scope: scope, id: id, generation: id, allowCloudGaps: true,
                queueRequest: queue, startWithSingleAsset: true, activity: {
                    switch $0 {
                    case .indexed(let counts): indexed = counts
                    case .checking(let complete, _, _): prepared.append(complete)
                    case .enumerating, .hashing: break
                    }
                })
            return try XCTUnwrap(reader.sealCapture(scope: scope, capture: result).photoQueue)
        }
        let reader = try makeReader(provider, queueDirectory: alias)
        let first = try capture(reader)
        XCTAssertEqual(first.pending, 5)
        XCTAssertEqual(indexed?.photos, 1)
        XCTAssertEqual(indexed?.videos, 5)
        XCTAssertEqual(indexed?.files, 7)
        XCTAssertEqual(prepared, [0, 1, 2])
        XCTAssertEqual(provider.attempts, [newest.path, companion.path])
        try reader.finishQueueBatch(scope: scope, request: queue, batchId: first.id)

        let reopened = try makeReader(provider, queueDirectory: alias)
        let next = try capture(reopened)
        XCTAssertEqual(next.assetKeys.count, 4)
        XCTAssertEqual(next.pending, 1)
        XCTAssertEqual(Array(provider.attempts.dropFirst(2)), older.suffix(4).reversed().map(\.path))

        let outcomes = try XCTUnwrap(files.enumerator(at: real, includingPropertiesForKeys: nil))
        let record = try XCTUnwrap(outcomes.compactMap { $0 as? URL }.first { $0.deletingLastPathComponent().lastPathComponent == "attempts" })
        try files.moveItem(at: record, to: record.deletingLastPathComponent().appendingPathComponent("wrong.json"))
        XCTAssertThrowsError(try capture(makeReader(provider, queueDirectory: alias)))
    }

    func testOrderedCaptureSealsFirstGroupBeforeFullDiscoveryAndResumesExactCursor() throws {
        let provider = OrderedPhotoFixtures()
        provider.membershipRevision = 0
        let companion = provider.add("newest", index: 1, bytes: Data([8]), captured: 90, kind: "video")
        let newest = provider.add("newest", bytes: Data([9]), captured: 90, kind: "video")
        let older = (0..<8).map { provider.add("older-\($0)", bytes: Data([UInt8($0 + 1)]), captured: Double($0), kind: "photo") }
        let owner = try FileSyncOwnerScope(ownerId: "ordered", url: URL(string: "https://fixture.invalid")!)
        let scope = PhotoLibraryReader.Scope(owner: owner, deviceId: "device", rootId: UUID().uuidString)
        let request = PhotoBackupQueueRequest(epoch: UUID(), configurationId: "photos", configurationRevision: "r1")
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("ordered-photo-queue-" + UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }

        func capture(_ reader: PhotoLibraryReader, observed: (PhotoLibraryReader.InventoryProgress) -> Void = { _ in }) throws -> PhotoBackupQueueBatch {
            let id = UUID().uuidString.lowercased()
            let capture = try reader.prepareCapture(scope: scope, id: id, generation: id, allowCloudGaps: true,
                queueRequest: request, startWithSingleAsset: true, activity: {
                    if case .enumerating(let update) = $0 { observed(update) }
                })
            return try XCTUnwrap(reader.sealCapture(scope: scope, capture: capture).photoQueue)
        }

        let initial = try makeReader(provider, queueDirectory: directory)
        var firstDiscovery: PhotoLibraryReader.InventoryProgress?
        let first = try capture(initial) { if $0.latest != nil { firstDiscovery = $0 } }
        XCTAssertEqual(firstDiscovery?.inspected, 1)
        XCTAssertEqual(firstDiscovery?.total, 9)
        XCTAssertEqual(firstDiscovery?.indexed.files, 2)
        XCTAssertEqual(firstDiscovery?.latest?.kind, .video)
        XCTAssertEqual(first.remainingKnown, false)
        XCTAssertEqual(provider.discovered, ["newest"])
        XCTAssertEqual(provider.attempts, [newest.path, companion.path])
        XCTAssertEqual(provider.inventoryCalls, 0)

        let restarted = try makeReader(provider, queueDirectory: directory)
        XCTAssertEqual(try restarted.queueBatchEntries(scope: scope, request: request, batchId: first.id).map(\.path),
                       [newest.path, companion.path])
        XCTAssertEqual(provider.discovered, ["newest"], "Exact retained resources reopen without scanning")
        try restarted.finishQueueBatch(scope: scope, request: request, batchId: first.id)
        let next = try capture(restarted)
        XCTAssertEqual(next.assetKeys.count, 4)
        XCTAssertEqual(next.remainingKnown, false)
        XCTAssertEqual(provider.discovered, ["newest"] + older.suffix(4).reversed().map(\.asset))
        try restarted.finishQueueBatch(scope: scope, request: request, batchId: next.id)

        let later = provider.add("added", bytes: Data([99]), modified: 100, kind: "photo")
        let changed = try capture(restarted)
        XCTAssertEqual(try restarted.queueBatchEntries(scope: scope, request: request, batchId: changed.id).first?.path, later.path)
        XCTAssertEqual(provider.attempts.filter { $0 == newest.path }.count, 1)
        XCTAssertEqual(provider.inventoryCalls, 0)
    }

    func testNewestCloudOriginalWaitsWithoutBlockingReadyOrderedBatches() async throws {
        let provider = OrderedPhotoFixtures()
        provider.membershipRevision = 0
        let cloudBytes = Data([9, 6, 3])
        let cloud = provider.add("cloud-newest", bytes: cloudBytes, captured: 90, kind: "photo")
        provider.iCloud[cloud.path] = provider.bytes.removeValue(forKey: cloud.path)
        let local = (0..<9).map { provider.add("local-\($0)", bytes: Data([UInt8($0 + 1)]), captured: Double($0), kind: "photo") }
        let owner = try FileSyncOwnerScope(ownerId: "ordered-cloud", url: URL(string: "https://fixture.invalid")!)
        let scope = PhotoLibraryReader.Scope(owner: owner, deviceId: "device", rootId: UUID().uuidString)
        let request = PhotoBackupQueueRequest(epoch: UUID(), configurationId: "photos", configurationRevision: "r1")
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("ordered-cloud-queue-" + UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let started = DispatchSemaphore(value: 0), allowFinish = DispatchSemaphore(value: 0)
        provider.onDownload = { control in
            control.progress(0.01)
            started.signal()
            guard allowFinish.wait(timeout: .now() + 15) == .success else { throw PhotoLibraryReader.Failure.readFailed }
            try control.authorize()
        }

        func capture(_ reader: PhotoLibraryReader, prepared: PhotoLibraryReader.PreparedCloudOriginal? = nil) throws -> PhotoBackupQueueBatch {
            let id = UUID().uuidString.lowercased()
            let capture = try reader.prepareCapture(scope: scope, id: id, generation: id, allowCloudGaps: true, queueRequest: request,
                startWithSingleAsset: true, preparedDeferred: prepared)
            return try XCTUnwrap(reader.sealCapture(scope: scope, capture: capture).photoQueue)
        }

        let initial = try makeReader(provider, queueDirectory: directory)
        let firstAttempt = Date(timeIntervalSince1970: 1_800_000_000)
        XCTAssertNil(try initial.nextDeferredCloudOriginal(scope: scope, request: request, now: firstAttempt))
        let deferred = try capture(initial)
        XCTAssertEqual(deferred.unavailable, 1)
        XCTAssertEqual(deferred.remainingKnown, false)
        XCTAssertTrue(try initial.queueBatchEntries(scope: scope, request: request, batchId: deferred.id).isEmpty)
        try initial.finishQueueBatch(scope: scope, request: request, batchId: deferred.id)
        XCTAssertEqual(try initial.nextDeferredCloudOriginal(scope: scope, request: request, now: firstAttempt), cloud)

        let reopened = try makeReader(provider, queueDirectory: directory)
        XCTAssertTrue(try reopened.hasDeferredCloudOriginals(scope: scope, request: request))
        XCTAssertNil(try reopened.nextDeferredCloudOriginal(scope: scope, request: request, now: firstAttempt.addingTimeInterval(299)))
        let retry = firstAttempt.addingTimeInterval(300)
        let candidate = try XCTUnwrap(reopened.nextDeferredCloudOriginal(scope: scope, request: request, now: retry))
        XCTAssertEqual(candidate, cloud)
        XCTAssertNil(try reopened.nextDeferredCloudOriginal(scope: scope, request: request, now: retry))
        let read = Task.detached {
            try reopened.prepareDeferredCloudOriginal(scope: scope, resource: candidate,
                control: .init(authorize: { try Task.checkCancellation() }))
        }
        defer { allowFinish.signal(); read.cancel() }
        let fetching = await Task.detached { started.wait(timeout: .now() + 5) == .success }.value
        XCTAssertTrue(fetching)
        var readyPaths: [String] = []
        for count in [4, 4, 1] {
            let ready = try capture(reopened)
            let entries = try reopened.queueBatchEntries(scope: scope, request: request, batchId: ready.id)
            XCTAssertEqual(entries.count, count)
            readyPaths.append(contentsOf: entries.map(\.path))
            try reopened.finishQueueBatch(scope: scope, request: request, batchId: ready.id)
        }
        XCTAssertEqual(readyPaths, local.reversed().map(\.path))
        let incomplete = try capture(reopened)
        XCTAssertTrue(incomplete.assetKeys.isEmpty)
        XCTAssertEqual(incomplete.unavailable, 1)
        try reopened.finishQueueBatch(scope: scope, request: request, batchId: incomplete.id)

        allowFinish.signal()
        let prepared = try await read.value
        let recovered = try capture(reopened, prepared: prepared)
        let original = try XCTUnwrap(reopened.queueBatchEntries(scope: scope, request: request, batchId: recovered.id).first)
        XCTAssertEqual(original.path, cloud.path)
        let part = try reopened.read(scope: scope, path: original.path, version: original.version, offset: 0, length: cloudBytes.count)
        XCTAssertEqual(Data(base64Encoded: part.data), cloudBytes)
        try reopened.finishQueueBatch(scope: scope, request: request, batchId: recovered.id)
        reopened.releaseDeferredCloudOriginal(prepared)
        let complete = try capture(reopened)
        XCTAssertTrue(complete.assetKeys.isEmpty)
        XCTAssertEqual(complete.unavailable, 0)
        XCTAssertFalse(try reopened.hasDeferredCloudOriginals(scope: scope, request: request))
        XCTAssertEqual(provider.downloads, 1)
    }

    func testDeferredCompanionsGetATurnAndLocalReprobeDoesNotUseNetwork() throws {
        let provider = OrderedPhotoFixtures()
        provider.membershipRevision = 0
        let newest = provider.add("live", bytes: Data([1]), captured: 90)
        let companion = provider.add("live", index: 1, bytes: Data([2]), captured: 90)
        let older = provider.add("older", bytes: Data([3]), captured: 80)
        for resource in [newest, companion, older] { provider.iCloud[resource.path] = provider.bytes.removeValue(forKey: resource.path) }
        let owner = try FileSyncOwnerScope(ownerId: "deferred-companions", url: URL(string: "https://fixture.invalid")!)
        let scope = PhotoLibraryReader.Scope(owner: owner, deviceId: "device", rootId: UUID().uuidString)
        let request = PhotoBackupQueueRequest(epoch: UUID(), configurationId: "photos", configurationRevision: "r1")
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("deferred-companions-" + UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let reader = try makeReader(provider, queueDirectory: directory)

        func capture(_ reader: PhotoLibraryReader, prepared: PhotoLibraryReader.PreparedCloudOriginal? = nil) throws -> PhotoBackupQueueBatch {
            let id = UUID().uuidString.lowercased()
            let capture = try reader.prepareCapture(scope: scope, id: id, generation: id, allowCloudGaps: true,
                queueRequest: request, startWithSingleAsset: true, preparedDeferred: prepared)
            return try XCTUnwrap(reader.sealCapture(scope: scope, capture: capture).photoQueue)
        }

        for _ in 0..<2 {
            let batch = try capture(reader)
            try reader.finishQueueBatch(scope: scope, request: request, batchId: batch.id)
        }
        let first = Date(timeIntervalSince1970: 1_800_000_000)
        let firstCandidate = try XCTUnwrap(reader.nextDeferredCloudOriginal(scope: scope, request: request, now: first))
        XCTAssertTrue([newest, companion].contains(firstCandidate))

        let reopened = try makeReader(provider, queueDirectory: directory)
        let second = try XCTUnwrap(reopened.nextDeferredCloudOriginal(scope: scope, request: request, now: first.addingTimeInterval(300)))
        XCTAssertEqual(second, firstCandidate == newest ? companion : newest)
        let third = try XCTUnwrap(reopened.nextDeferredCloudOriginal(scope: scope, request: request, now: first.addingTimeInterval(600)))
        XCTAssertEqual(third, older)
        provider.bytes[older.path] = provider.iCloud[older.path]
        let local = try reopened.prepareDeferredCloudOriginal(scope: scope, resource: third, control: nil)
        let resolved = try capture(reopened, prepared: local)
        XCTAssertEqual(try reopened.queueBatchEntries(scope: scope, request: request, batchId: resolved.id).map(\.path), [older.path])
        try reopened.finishQueueBatch(scope: scope, request: request, batchId: resolved.id)
        reopened.releaseDeferredCloudOriginal(local)
        XCTAssertEqual(provider.downloads, 0)
        XCTAssertTrue(try reopened.hasDeferredCloudOriginals(scope: scope, request: request))
        XCTAssertEqual(try capture(reopened).unavailable, 2)
    }

    func testDiscardedSelectionWithOrphanedDeferredRecordDoesNotBlockLocalBackup() throws {
        let provider = OrderedPhotoFixtures()
        provider.membershipRevision = 0
        let stale = provider.add("removed-cloud", bytes: Data([1]), captured: 90)
        provider.iCloud[stale.path] = provider.bytes.removeValue(forKey: stale.path)
        let local = provider.add("local", bytes: Data([2]), captured: 80)
        let owner = try FileSyncOwnerScope(ownerId: "orphaned-cloud", url: URL(string: "https://fixture.invalid")!)
        let scope = PhotoLibraryReader.Scope(owner: owner, deviceId: "device", rootId: UUID().uuidString)
        let request = PhotoBackupQueueRequest(epoch: UUID(), configurationId: "photos", configurationRevision: "r1")
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("orphaned-cloud-" + UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let reader = try makeReader(provider, queueDirectory: directory)

        func capture(_ reader: PhotoLibraryReader) throws -> PhotoBackupQueueBatch {
            let id = UUID().uuidString.lowercased()
            let capture = try reader.prepareCapture(scope: scope, id: id, generation: id, allowCloudGaps: true, queueRequest: request,
                startWithSingleAsset: true)
            return try XCTUnwrap(reader.sealCapture(scope: scope, capture: capture).photoQueue)
        }

        let gap = try capture(reader)
        let files = FileManager.default
        let namespace = try XCTUnwrap(files.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).first)
        let epoch = namespace.appendingPathComponent(request.epoch.uuidString.lowercased())
        let selectionFile = epoch.appendingPathComponent("current.json")
        let selection = try Data(contentsOf: selectionFile)
        try reader.finishQueueBatch(scope: scope, request: request, batchId: gap.id)
        // Retain only what would exist after the deferred write but before the
        // attempt, acknowledgement and cursor writes.
        for path in ["attempts", "completed.json", "ordered-cursor.json"] {
            try files.removeItem(at: epoch.appendingPathComponent(path))
        }
        try selection.write(to: selectionFile)
        provider.records.removeAll { $0 == stale }
        provider.membershipRevision = 10

        let reopened = try makeReader(provider, queueDirectory: directory)
        XCTAssertNil(try reopened.nextDeferredCloudOriginal(scope: scope, request: request))
        let ready = try capture(reopened)
        XCTAssertEqual(try reopened.queueBatchEntries(scope: scope, request: request, batchId: ready.id).map(\.path), [local.path])
        try reopened.finishQueueBatch(scope: scope, request: request, batchId: ready.id)
        XCTAssertTrue(try reopened.hasDeferredCloudOriginals(scope: scope, request: request))
        XCTAssertNil(try reopened.nextDeferredCloudOriginal(scope: scope, request: request))
        XCTAssertFalse(try reopened.hasDeferredCloudOriginals(scope: scope, request: request))
        XCTAssertEqual(try capture(reopened).unavailable, 0)
    }

    func testWiFiOnlyNewestUnavailableRemainsInExactQueueAcrossReopen() throws {
        let provider = PhotoFixtures()
        provider.membershipRevision = 0
        let newest = provider.add("newest", bytes: Data([7]), captured: 90)
        provider.iCloud[newest.path] = provider.bytes.removeValue(forKey: newest.path)
        for n in 0..<6 { provider.add("older-\(n)", bytes: Data([UInt8(n + 1)]), captured: Double(n)) }
        let owner = try FileSyncOwnerScope(ownerId: "ordered-wifi", url: URL(string: "https://fixture.invalid")!)
        let scope = PhotoLibraryReader.Scope(owner: owner, deviceId: "device", rootId: UUID().uuidString)
        let request = PhotoBackupQueueRequest(epoch: UUID(), configurationId: "photos", configurationRevision: "r1")
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("photo-queue-reopen-" + UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        func capture(_ reader: PhotoLibraryReader) throws -> MobileFolderInventory.Capture {
            let id = UUID().uuidString.lowercased()
            return try reader.sealCapture(scope: scope, capture: reader.prepareCapture(scope: scope, id: id, generation: id,
                allowCloudGaps: true, queueRequest: request))
        }
        let reader = try makeReader(provider, queueDirectory: directory)
        let first = try capture(reader), firstBatch = try XCTUnwrap(first.photoQueue)
        XCTAssertEqual(provider.attempts.first, newest.path)
        XCTAssertEqual(try reader.readSkipped(scope: scope, capture: first, offset: 0).skipped.map(\.path), [newest.path])
        XCTAssertEqual(firstBatch.unavailable, 1); XCTAssertEqual(firstBatch.pending, 3)
        let reopened = try makeReader(provider, queueDirectory: directory)
        let recovered = try capture(reopened)
        XCTAssertEqual(recovered.photoQueue, firstBatch)
        XCTAssertEqual(provider.attempts.filter { $0 == newest.path }.count, 1)
        try reopened.finishQueueBatch(scope: scope, request: request, batchId: firstBatch.id)
        let last = try capture(reopened), lastBatch = try XCTUnwrap(last.photoQueue)
        XCTAssertEqual(last.totalEntries, 3); XCTAssertEqual(lastBatch.pending, 0); XCTAssertEqual(lastBatch.unavailable, 1)
        try reopened.finishQueueBatch(scope: scope, request: request, batchId: lastBatch.id)
        let empty = try capture(reopened), terminal = try XCTUnwrap(empty.photoQueue)
        XCTAssertTrue(terminal.assetKeys.isEmpty); XCTAssertEqual(terminal.unavailable, 1)
        try reopened.finishQueueBatch(scope: scope, request: request, batchId: terminal.id)
        XCTAssertEqual(provider.downloads, 0)

        // The same PhotoKit identity/version can become available without a
        // library metadata change. The next normal run retries it by epoch.
        provider.bytes[newest.path] = provider.iCloud.removeValue(forKey: newest.path)
        let retry = PhotoBackupQueueRequest(epoch: UUID(), configurationId: "photos", configurationRevision: "r1")
        let id = UUID().uuidString.lowercased()
        let refreshed = try reopened.sealCapture(scope: scope, capture: reopened.prepareCapture(scope: scope, id: id,
            generation: id, allowCloudGaps: true, queueRequest: retry))
        XCTAssertEqual(refreshed.photoQueue?.unavailable, 0)
        XCTAssertTrue(try reopened.page(scope: scope, capture: refreshed, offset: 0).entries.contains { $0.path == newest.path })
        XCTAssertEqual(provider.attempts.filter { $0 == newest.path }.count, 2)
    }

    func testChangedSelectedAssetStartsNewUnacknowledgedBatchWithoutDroppingKnownReceipt() throws {
        let provider = PhotoFixtures()
        provider.membershipRevision = 0
        for n in 0..<8 { provider.add("asset-\(n)", bytes: Data([UInt8(n)]), captured: Double(n)) }
        let reader = try makeReader(provider)
        let owner = try FileSyncOwnerScope(ownerId: "ordered-change", url: URL(string: "https://fixture.invalid")!)
        let scope = PhotoLibraryReader.Scope(owner: owner, deviceId: "device", rootId: UUID().uuidString)
        let queue = PhotoBackupQueueRequest(epoch: UUID(), configurationId: "photos", configurationRevision: "r1")
        func capture() throws -> MobileFolderInventory.Capture {
            let id = UUID().uuidString.lowercased()
            return try reader.sealCapture(scope: scope, capture: reader.prepareCapture(scope: scope, id: id, generation: id,
                allowCloudGaps: true, queueRequest: queue))
        }
        let prior = try XCTUnwrap(try capture().photoQueue)
        try reader.finishQueueBatch(scope: scope, request: queue, batchId: prior.id)
        let interrupted = try capture(), stale = try XCTUnwrap(interrupted.photoQueue)
        let deleted = try XCTUnwrap(provider.records.first { $0.asset == "asset-3" })
        provider.records.removeAll { $0 == deleted }
        provider.membershipRevision = (provider.membershipRevision ?? 0) + 1
        XCTAssertThrowsError(try reader.page(scope: scope, capture: interrupted, offset: 0))
        let refreshed = try capture(), latest = try XCTUnwrap(refreshed.photoQueue)
        XCTAssertNotEqual(latest.id, stale.id)
        XCTAssertEqual(latest.assetKeys.count, 3)
        XCTAssertTrue(Set(latest.assetKeys).isDisjoint(with: prior.assetKeys))
        XCTAssertThrowsError(try reader.finishQueueBatch(scope: scope, request: queue, batchId: stale.id))
        XCTAssertEqual(try reader.queueBatchEntries(scope: scope, request: queue, batchId: latest.id).count, 3)
        try reader.finishQueueBatch(scope: scope, request: queue, batchId: latest.id)
    }

    func testRetirementKeepsActiveAndLastTerminalEpochForLostAcknowledgement() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("photo-epoch-retention-" + UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        func request() -> PhotoBackupQueueRequest {
            .init(epoch: UUID(), configurationId: "photos", configurationRevision: "r1")
        }
        func path(_ request: PhotoBackupQueueRequest) -> URL {
            root.appendingPathComponent(request.epoch.uuidString.lowercased())
        }
        func complete(_ request: PhotoBackupQueueRequest) throws -> UUID {
            let queue = PhotoBackupQueue(directory: path(request), request: request)
            let work = try queue.select(revision: "empty", resources: [])
            let batch = try queue.prepare(work, unavailable: [], entries: [])
            try queue.finish(batch.id)
            return batch.id
        }
        let old = request(), recent = request(), paused = request(), next = request()
        _ = try complete(old)
        let final = try complete(recent)
        let interrupted = PhotoBackupQueue(directory: path(paused), request: paused)
        _ = try interrupted.select(revision: "empty", resources: [])
        PhotoBackupQueue.pruneFinishedEpochs(in: root, protecting: next.epoch)
        XCTAssertFalse(FileManager.default.fileExists(atPath: path(old).path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: path(recent).path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: path(paused).path))
        let reopened = PhotoBackupQueue(directory: path(recent), request: recent)
        XCTAssertEqual(try reopened.entriesForVerification(final), [])
        XCTAssertNoThrow(try reopened.finish(final))
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
