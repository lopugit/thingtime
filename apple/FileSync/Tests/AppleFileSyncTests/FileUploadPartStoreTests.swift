import XCTest
import CryptoKit
@testable import AppleFileSync

final class FileUploadPartStoreTests: XCTestCase {
    private let bytes = Data(repeating: 42, count: 131_079)
    private func fixture() throws -> URL {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        return root
    }
    private func request(owner: String = "owner", origin: String = "https://test.invalid", root: String = "11111111-1111-4111-8111-111111111111",
                         grant: String = String(repeating: "a", count: 64), upload: String = "upload", version: String = "version") throws -> FileUploadPartStore.Request {
        return .init(scope: try .init(ownerId: owner, url: URL(string: origin)!), rootId: root, grantHash: grant,
            uploadId: upload, requestId: "request", source: .init(path: "file.bin", id: "file", version: version, kind: "file",
                size: Int64(bytes.count), sha256: nil, fingerprint: .init(partSizeBytes: 8_388_608, partCount: 1,
                    sha256: PhotoLibraryReader.hash(Data(SHA256.hash(data: bytes))))), partNumber: 1, offset: 0, length: Int64(bytes.count))
    }
    private func stream(_ offset: Int64, _ length: Int, _ receive: (Data) throws -> Void) throws -> Int64 {
        for at in stride(from: 0, to: length, by: 65_536) {
            let start = Int(offset) + at
            try receive(bytes.subdata(in: start..<min(start + 65_536, Int(offset) + length)))
        }
        return Int64(bytes.count)
    }
    func testDurableReuseAndExplicitRelease() throws {
        let root = try fixture(), request = try request()
        let first = try FileUploadPartStore(directory: root).prepare(request, stream: stream)
        XCTAssertFalse(first.reused)
        let resumed = try FileUploadPartStore(directory: root).prepare(request) { _, _, _ in XCTFail("Recaptured committed part"); return 0 }
        XCTAssertTrue(resumed.reused); XCTAssertEqual(try Data(contentsOf: resumed.url), bytes)
        XCTAssertEqual(first.sha256, resumed.sha256)
        XCTAssertEqual(try FileManager.default.attributesOfItem(atPath: resumed.url.path)[.posixPermissions] as? NSNumber, 0o600)
        try FileUploadPartStore(directory: root).release(request)
        XCTAssertFalse(FileManager.default.fileExists(atPath: resumed.url.path))
        try FileUploadPartStore(directory: root).release(request)
    }
    #if os(iOS)
    func testDeviceFileProtectionAfterCapture() throws {
        #if targetEnvironment(simulator)
        throw XCTSkip("The tested simulator returns no file-protection attribute; physical iOS verification is required")
        #else
        let part = try FileUploadPartStore(directory: fixture()).prepare(request(), stream: stream)
        let protection = try FileManager.default.attributesOfItem(atPath: part.url.path)[.protectionKey]
        XCTAssertEqual(protection as? String, FileProtectionType.completeUntilFirstUserAuthentication.rawValue)
        #endif
    }
    #endif
    func testChangedGrantAndSourceRefusedUnderSameIdentity() throws {
        let root = try fixture(), store = FileUploadPartStore(directory: root), original = try request()
        let part = try store.prepare(original, stream: stream)
        for changed in [try request(grant: String(repeating: "b", count: 64)), try request(version: "new-version")] {
            XCTAssertThrowsError(try store.prepare(changed, stream: stream))
            XCTAssertThrowsError(try store.release(changed))
        }
        XCTAssertEqual(try Data(contentsOf: part.url), bytes)
        let other = try store.prepare(request(owner: "other-owner"), stream: stream)
        XCTAssertNotEqual(other.url, part.url); XCTAssertFalse(other.reused)
    }
    func testCorruptionAndLinkedPayloadsRefused() throws {
        for mutation in ["corrupt", "truncate", "symlink", "hardlink"] {
            let root = try fixture(), store = FileUploadPartStore(directory: root), request = try request()
            let part = try store.prepare(request, stream: stream)
            let external = root.deletingLastPathComponent().appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: external) }
            switch mutation {
            case "corrupt": try Data(repeating: 1, count: bytes.count).write(to: part.url)
            case "truncate": try Data([1]).write(to: part.url)
            case "symlink":
                try bytes.write(to: external); try FileManager.default.removeItem(at: part.url)
                try FileManager.default.createSymbolicLink(at: part.url, withDestinationURL: external)
            default: try FileManager.default.linkItem(at: part.url, to: external)
            }
            XCTAssertThrowsError(try store.prepare(request) { _, _, _ in XCTFail("Replaced suspect payload"); return 0 }, mutation)
        }
    }
    func testIncompleteCaptureAndPreRecordOrphanRecoverWithoutTrustingBytes() throws {
        let root = try fixture(), store = FileUploadPartStore(directory: root), request = try request()
        XCTAssertThrowsError(try store.prepare(request) { _, _, receive in try receive(Data([1])); throw CancellationError() })
        let recovered = try store.prepare(request, stream: stream)
        XCTAssertFalse(recovered.reused); XCTAssertEqual(try Data(contentsOf: recovered.url), bytes)
        let orphan = root.appendingPathComponent(String(repeating: "b", count: 64))
        try FileManager.default.createDirectory(at: orphan, withIntermediateDirectories: false)
        _ = try store.prepare(request)
            { _, _, _ in XCTFail("Recaptured committed part"); return 0 }
        XCTAssertFalse(FileManager.default.fileExists(atPath: orphan.path))
    }
    func testCountAndByteLimitsPreserveExistingPartsAndReleaseBudget() throws {
        for store in [FileUploadPartStore(directory: try fixture(), maximumParts: 1),
                      FileUploadPartStore(directory: try fixture(), maximumBytes: Int64(bytes.count))] {
            let first = try request(), second = try request(upload: "second")
            let part = try store.prepare(first, stream: stream)
            XCTAssertThrowsError(try store.prepare(second, stream: stream)) { error in
                guard case FileUploadPartStore.Failure.capacity = error else { return XCTFail("Wrong capacity failure: \(error)") }
            }
            XCTAssertEqual(try Data(contentsOf: part.url), bytes)
            try store.release(first)
            XCTAssertFalse(try store.prepare(second, stream: stream).reused)
        }
    }
    func testGrantCleanupIsOwnerOriginAndRootScoped() throws {
        let store = FileUploadPartStore(directory: try fixture()), first = try request()
        let others = [try request(owner: "other"), try request(origin: "https://other.invalid"),
                      try request(root: "22222222-2222-4222-8222-222222222222")]
        let part = try store.prepare(first, stream: stream)
        let parts = try others.map { try store.prepare($0, stream: stream) }
        try store.remove(scope: first.scope, rootId: first.rootId)
        XCTAssertFalse(FileManager.default.fileExists(atPath: part.url.path))
        for other in parts { XCTAssertEqual(try Data(contentsOf: other.url), bytes) }
    }
}
