import XCTest
import CryptoKit
import Darwin
@testable import Thingtime

/// Opt-in, destructive only to this suite's disposable application-support
/// directory. The prepare phase deliberately exits the TEST HOST after rename,
/// without unwinding Swift scopes or saving a publication receipt. A separate
/// xcodebuild invocation must then recover the immutable operation.
@MainActor
final class MobilePublicationProcessTests: XCTestCase {
    private struct Fixture: Codable {
        let request: MobileSyncStaging.Request
        let stage: MobileSyncStaging.Stage
        let bookmark: Data
        let process: Int32
        let scenario: String
    }
    private var root: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MobilePublicationProcessAcceptance", isDirectory: true)
    }
    private func bytes() -> Data { Data(repeating: 37, count: 8 * 1024 * 1024 + 17) }
    private func hash(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
    func testRecoveryAcrossActualProcessExit() throws {
        let env = ProcessInfo.processInfo.environment
        guard let phase = env["THINGTIME_PUBLICATION_PROCESS_PHASE"], ["prepare", "verify"].contains(phase),
              let scenario = env["THINGTIME_PUBLICATION_PROCESS_SCENARIO"], ["create", "replace", "edit"].contains(scenario) else {
            throw XCTSkip("Run scripts/test-mobile-publication-process.sh for actual process-exit acceptance")
        }
        let selected = root.appendingPathComponent("selected"), storage = root.appendingPathComponent("private"),
            checkpoint = root.appendingPathComponent("fixture.json"), proof = root.appendingPathComponent("after-rename.json")
        let owner = try MobileDevicePairing.Scope(ownerId: "process-acceptance", url: URL(string: "https://process.invalid")!)
        if phase == "prepare" {
            // XCTest can relaunch a crashed test host. Never replace the evidence
            // from its original process or execute the publication a second time.
            if FileManager.default.fileExists(atPath: proof.path) { throw XCTSkip("Original process exited; run the separate verify phase") }
            try? FileManager.default.removeItem(at: root)
            try FileManager.default.createDirectory(at: selected, withIntermediateDirectories: true)
            let target = selected.appendingPathComponent("sample.bin")
            if scenario != "create" { try Data("original local version".utf8).write(to: target) }
            let bookmark = try selected.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
            let expected = try MobileFolderReader.scan(bookmark: bookmark).first
            let content = bytes(), partSize = 8 * 1024 * 1024
            var digests = Data(SHA256.hash(data: content.prefix(partSize))); digests.append(Data(SHA256.hash(data: content.suffix(17))))
            let source = MobileFolderReader.Entry(path: "sample.bin", id: "cloud-source", version: "cloud-v1", kind: "file", size: Int64(content.count), sha256: nil,
                fingerprint: .init(partSizeBytes: Int64(partSize), partCount: 2, sha256: hash(digests)))
            let scope = MobileSyncStaging.Scope(origin: owner.origin.absoluteString, ownerId: owner.ownerId, dataPlane: "home", rootId: "process-connection", deviceId: "process-device")
            let request = MobileSyncStaging.Request(scope: scope, rootId: UUID().uuidString.lowercased(), operation: .init(id: UUID().uuidString.lowercased(),
                mutation: .init(kind: "copy", from: "remote", path: source.path, source: source, expectedTarget: expected), confirmed: false))
            let receiver = MobileSyncStaging(directory: storage)
            _ = try receiver.begin(request, owner: owner)
            for offset in stride(from: 0, to: content.count, by: 65_536) {
                _ = try receiver.append(request, owner: owner, offset: Int64(offset), bytes: content.subdata(in: offset..<min(content.count, offset + 65_536)))
            }
            let stage = try XCTUnwrap(receiver.finish(request, owner: owner).stage)
            try JSONEncoder().encode(Fixture(request: request, stage: stage, bookmark: bookmark, process: getpid(), scenario: scenario)).write(to: checkpoint, options: .atomic)
            let publisher = MobileSyncStaging(directory: storage, afterPublication: {
                try Data("{\"renamed\":true,\"pid\":\(getpid())}".utf8).write(to: proof, options: .atomic)
                // No Swift defer, XCTest teardown, application shutdown or receipt
                // recovery is allowed to run in this process after publication.
                _exit(77)
            })
            _ = try publisher.publish(request, owner: owner, bookmark: bookmark, stage: stage)
            XCTFail("The test host should have exited at the publication boundary")
            return
        }
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: checkpoint))
        XCTAssertEqual(fixture.scenario, scenario); XCTAssertNotEqual(fixture.process, getpid())
        XCTAssertTrue(FileManager.default.fileExists(atPath: proof.path))
        let operationRoot = storage.appendingPathComponent(fixture.stage.token)
        let before = try JSONSerialization.jsonObject(with: Data(contentsOf: operationRoot.appendingPathComponent("record.json"))) as! [String: Any]
        XCTAssertNil((before["publication"] as? [String: Any])?["receipt"], "No earlier process may have recovered the receipt")
        let target = selected.appendingPathComponent("sample.bin")
        XCTAssertEqual(hash(try Data(contentsOf: target)), hash(bytes()))
        if scenario == "edit" { try Data("edited after process exit".utf8).write(to: target, options: .atomic) }
        let receiver = MobileSyncStaging(directory: storage)
        let recovered = try receiver.lookup(fixture.request, owner: owner, bookmark: fixture.bookmark)
        if scenario == "edit" {
            XCTAssertEqual(recovered.status, "pending"); XCTAssertNil(recovered.receipt)
            XCTAssertThrowsError(try receiver.publish(fixture.request, owner: owner, bookmark: fixture.bookmark, stage: fixture.stage))
            XCTAssertEqual(try Data(contentsOf: target), Data("edited after process exit".utf8))
        } else {
            XCTAssertEqual(recovered.status, "complete")
            let receipt = try XCTUnwrap(recovered.receipt)
            XCTAssertEqual(receipt.operationId, fixture.request.operation.id)
            XCTAssertEqual(receipt.entry.fingerprint, fixture.request.operation.mutation.source.fingerprint)
            try Data("later edit after receipt".utf8).write(to: target, options: .atomic)
            XCTAssertEqual(try receiver.publish(fixture.request, owner: owner, bookmark: fixture.bookmark, stage: fixture.stage), receipt)
            XCTAssertEqual(try Data(contentsOf: target), Data("later edit after receipt".utf8))
        }
        if scenario != "create" {
            XCTAssertEqual(try Data(contentsOf: operationRoot.appendingPathComponent("publication")), Data("original local version".utf8))
        }
        XCTAssertEqual(hash(try Data(contentsOf: operationRoot.appendingPathComponent("payload"))), hash(bytes()))
        try FileManager.default.removeItem(at: root)
    }
}
