import CryptoKit
import Foundation
import XCTest
@testable import AppleFileSync

final class ManagedFileReplicaTests: XCTestCase {
    func testVerifiedReplicaIsIsolatedAndEvictionCannotRemoveChangedOrUnauthorizedBytes() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = ManagedFileReplica(directory: directory)
        let owner = try FileSyncOwnerScope(ownerId: "account", url: XCTUnwrap(URL(string: "https://fixture.invalid")))
        let scope = try ManagedFileReplica.Scope(owner: owner, dataPlane: "home", deviceId: "one", thingId: "file")
        let other = try ManagedFileReplica.Scope(owner: owner, dataPlane: "home", deviceId: "two", thingId: "file")
        let bytes = Data("the exact cloud bytes".utf8)
        let request = request(bytes)
        let prepared = try await FileVersionExport.Prepared.download(request, privateDirectory: store.stagingDirectory) { offset, count in
            bytes[Int(offset)..<(Int(offset) + count)]
        }
        XCTAssertThrowsError(try store.publish(prepared, scope: scope) { throw CancellationError() })
        let url = store.localURL(scope, content: request.content)
        XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
        try store.publish(prepared, scope: scope) {}
        XCTAssertEqual(try Data(contentsOf: url), bytes)
        XCTAssertFalse(try ManagedFileReplica.hasCopy(at: store.localURL(other, content: request.content), size: Int64(bytes.count)))
        let verified = try XCTUnwrap(ManagedFileReplica.verify(at: url, request: request))
        XCTAssertEqual(try ManagedFileReplica.checkedURL(verified), url)
        XCTAssertThrowsError(try ManagedFileReplica.evict(verified) { throw CancellationError() })
        XCTAssertEqual(try Data(contentsOf: url), bytes)

        let changed = Data(repeating: 1, count: bytes.count)
        try changed.write(to: url, options: .atomic)
        XCTAssertThrowsError(try ManagedFileReplica.checkedURL(verified))
        XCTAssertThrowsError(try ManagedFileReplica.evict(verified) {})
        XCTAssertEqual(try Data(contentsOf: url), changed)
        XCTAssertThrowsError(try ManagedFileReplica.verify(at: url, request: request))

        try bytes.write(to: url, options: .atomic)
        let reverified = try XCTUnwrap(ManagedFileReplica.verify(at: url, request: request))
        try ManagedFileReplica.evict(reverified) {}
        try ManagedFileReplica.evict(reverified) {}
        XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
    }

    func testEmptyReplicaPublishesWithoutRequestingARange() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = ManagedFileReplica(directory: directory)
        let owner = try FileSyncOwnerScope(ownerId: "account", url: XCTUnwrap(URL(string: "https://fixture.invalid")))
        let scope = try ManagedFileReplica.Scope(owner: owner, dataPlane: "home", deviceId: "one", thingId: "empty")
        let request = request(Data())
        let prepared = try await FileVersionExport.Prepared.download(request, privateDirectory: store.stagingDirectory) { _, _ in
            XCTFail("Empty objects have no ranges")
            return Data()
        }
        try store.publish(prepared, scope: scope) {}
        let url = store.localURL(scope, content: request.content)
        XCTAssertEqual(try Data(contentsOf: url).count, 0)
        XCTAssertNotNil(try ManagedFileReplica.verify(at: url, request: request))
    }

    private func request(_ bytes: Data) -> FileVersionExport.Request {
        let partDigests = bytes.isEmpty ? Data() : Data(SHA256.hash(data: bytes))
        let digest = SHA256.hash(data: partDigests).map { String(format: "%02x", $0) }.joined()
        return .init(name: "bytes", content: .init(attachmentId: "attachment", version: String(repeating: "a", count: 64),
            size: Int64(bytes.count), fingerprint: .init(partSizeBytes: 8 * 1024 * 1024, partCount: bytes.isEmpty ? 0 : 1, sha256: digest)))
    }
}
