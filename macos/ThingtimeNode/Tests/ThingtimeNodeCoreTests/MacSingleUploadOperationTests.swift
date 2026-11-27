import AppleFileSync
import Foundation
import XCTest
@testable import ThingtimeNodeCore

@MainActor final class MacSingleUploadOperationTests: XCTestCase {
    func testStrongSourceReplacementTruncationAndGrowthAtEveryCallbackBoundary() async throws {
        for phase in ["ready", "prepare-ready", "chunk", "put-ready", "verify-ready"] {
            for mutation in ["replace", "truncate", "grow"] {
                let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
                try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
                defer { try? FileManager.default.removeItem(at: root) }
                let path = root.appendingPathComponent("file")
                try Data(repeating: 65, count: 65537).write(to: path)
                var saved: Data?
                let store = MobileFolderStore(load: { _ in saved }, save: { _, data in saved = data })
                let owner = try FileSyncOwnerScope(ownerId: "owner", url: URL(string: "https://sync.test")!)
                let grant = try store.add(owner, selected: root)
                let source = try XCTUnwrap(MobileFolderReader.inspect(bookmark: grant.bookmark, path: "file"))
                let request = MacSingleUploadOperation.Request(source: source, uploadId: "upload", requestId: "original-operation", authorization: .null)
                do {
                    _ = try await MacSingleUploadOperation.run(request, check: {}, read: { sha in
                        try MobileFolderBulkReader.read(bookmark: grant.bookmark, expected: source, sha256: sha)
                    }, callback: { frame, _ in
                        let row = try frame.decode([String: JSONValue].self)
                        if row["kind"] == .string(phase == "ready" ? "prepare-ready" : phase) {
                            if mutation == "replace" { try Data(repeating: 66, count: 65537).write(to: path, options: .atomic) }
                            else { let file = try FileHandle(forWritingTo: path); defer { try? file.close() }
                                try file.truncate(atOffset: mutation == "grow" ? 65538 : 10)
                            }
                        }
                        switch row["kind"] {
                        case .string("prepare-ready"):
                            if phase == "ready" { return .object(["ready": .bool(true), "content": .object(["attachmentId": .string("upload"), "version": .string(String(repeating: "c", count: 64)), "size": .number(Double(source.size)), "fingerprint": try JSONValue.from(source.fingerprint!)])]) }
                            return .object(["ready": .bool(false)])
                        case .string("chunk"): return .object(["accepted": .bool(true)])
                        case .string("put-ready"): return .object(["status": .string("accepted"), "payloadBytes": .number(Double(source.size))])
                        case .string("verify-ready"): return .object(["content": .object(["attachmentId": .string("upload"), "version": .string(String(repeating: "c", count: 64)), "size": .number(Double(source.size)), "fingerprint": try JSONValue.from(source.fingerprint!)])])
                        default: throw MobileFolderStore.Failure.invalid
                        }
                    })
                    XCTFail("Source change survived \(phase) / \(mutation)")
                } catch { /* Never returns verified content for publication. */ }
            }
        }
    }

    func testServiceKeepsFreshEntryExitIdentityAndRefusesGrantLoss() async throws {
        for revoke in [false, true] {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: root) }
            try Data("payload".utf8).write(to: root.appendingPathComponent("file"))
            var saved: Data?
            let store = MobileFolderStore(load: { _ in saved }, save: { _, data in saved = data })
            let owner = try FileSyncOwnerScope(ownerId: "owner", url: URL(string: "https://sync.test")!)
            let grant = try store.add(owner, selected: root)
            let source = try XCTUnwrap(MobileFolderReader.inspect(bookmark: grant.bookmark, path: "file"))
            let scope: JSONValue = .object(["origin": .string("https://sync.test"), "ownerId": .string("owner"), "deviceId": .string("device"), "dataPlane": .string("home"), "rootId": .string("connection")])
            let approval: JSONValue = .object(["id": .string("connection"), "updatedAt": .string("2026-11-06T00:00:00Z"), "scope": scope, "configuration": .object([
                "configurationVersion": .number(1), "name": .string("Sync"), "localRootId": .string(grant.id), "remoteFolderId": .string("cloud"), "deviceId": .string("device"), "mode": .string("two-way"), "paused": .bool(false), "propagateDeletes": .bool(false), "network": .string("wifi"), "chargingOnly": .bool(false), "excludedPaths": .array([])])])
            var identities = 0
            let service = try MacFolderSync(origin: URL(string: "https://sync.test")!, store: store,
                staging: MobileSyncStaging(directory: root.appendingPathComponent("staging")), verify: { _, _ in identities += 1 }, choose: { nil }, approve: { _ in false }, conditions: { .init(network: "wifi", charging: true) })
            let content: JSONValue = .object(["attachmentId": .string("upload"), "version": .string(String(repeating: "c", count: 64)), "size": .number(Double(source.size)), "fingerprint": try JSONValue.from(source.fingerprint!)])
            let request: JSONValue = .object(["requestId": .string(UUID().uuidString), "ownerId": .string("owner"), "origin": .string("https://sync.test"), "deviceId": .string("device"), "rootId": .string(grant.id), "action": .string("upload-single"), "upload": .object(["source": try JSONValue.from(source), "uploadId": .string("upload"), "requestId": .string("original"), "authorization": approval])])
            do {
                let result = try await service.handle(request, batchCallback: { _, _ in
                    if revoke { try await MainActor.run { try store.remove(owner, id: grant.id) } }
                    return .object(["ready": .bool(true), "content": content])
                })
                XCTAssertFalse(revoke)
                XCTAssertEqual(try result.decode([String: JSONValue].self)["uploadedSingle"], content)
                XCTAssertEqual(identities, 2)
            } catch { XCTAssertTrue(revoke) }
        }
    }
}
