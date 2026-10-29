import AppleFileSync
import Foundation
import CryptoKit
import Darwin

/// Test-only fixture shared by the Mac child executable and iOS test host.
/// The caller owns its disposable directory. No credentials or user files are used.
@MainActor
public enum PublicationProcessAcceptance {
    private struct Fixture: Codable {
        let request: MobileSyncStaging.Request
        let stage: MobileSyncStaging.Stage
        let bookmark: Data
        let process: Int32
        let scenario: String
    }
    private static func bytes() -> Data { Data(repeating: 37, count: 8 * 1024 * 1024 + 17) }
    private static func hash(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
    public static func run(phase: String, scenario: String, root: URL) throws {
        guard ["prepare", "verify"].contains(phase), ["create", "replace", "edit"].contains(scenario) else { throw Failure.invalid }
        let selected = root.appendingPathComponent("selected"), storage = root.appendingPathComponent("private"),
            checkpoint = root.appendingPathComponent("fixture.json"), proof = root.appendingPathComponent("after-rename.json")
        let owner = try FileSyncOwnerScope(ownerId: "process-acceptance", url: URL(string: "https://process.invalid")!)
        if phase == "prepare" {
            // XCTest can relaunch a crashed test host. Never replace the evidence
            // from its original process or execute the publication a second time.
            if FileManager.default.fileExists(atPath: proof.path) { throw Failure.invalid }
            try FileManager.default.createDirectory(at: selected, withIntermediateDirectories: true)
            let target = selected.appendingPathComponent("sample.bin")
            if scenario != "create" { try Data("original local version".utf8).write(to: target) }
            var grants: Data?
            let store = MobileFolderStore(load: { _ in grants }, save: { _, value in grants = value })
            let bookmark = try store.add(owner, selected: selected).bookmark
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
            let stage = try unwrap(receiver.finish(request, owner: owner).stage)
            try JSONEncoder().encode(Fixture(request: request, stage: stage, bookmark: bookmark, process: getpid(), scenario: scenario)).write(to: checkpoint, options: .atomic)
            let publisher = MobileSyncStaging(directory: storage, afterPublication: {
                try Data("{\"renamed\":true,\"pid\":\(getpid())}".utf8).write(to: proof, options: .atomic)
                // No Swift defer, XCTest teardown, application shutdown or receipt
                // recovery is allowed to run in this process after publication.
                _exit(77)
            })
            _ = try publisher.publish(request, owner: owner, bookmark: bookmark, stage: stage)
            throw Failure.invalid
        }
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: checkpoint))
        try equal(fixture.scenario, scenario); try different(fixture.process, getpid())
        try check(FileManager.default.fileExists(atPath: proof.path))
        let operationRoot = storage.appendingPathComponent(fixture.stage.token)
        let before = try JSONSerialization.jsonObject(with: Data(contentsOf: operationRoot.appendingPathComponent("record.json"))) as! [String: Any]
        try absent((before["publication"] as? [String: Any])?["receipt"], "No earlier process may have recovered the receipt")
        let target = selected.appendingPathComponent("sample.bin")
        try equal(hash(try Data(contentsOf: target)), hash(bytes()))
        if scenario == "edit" { try Data("edited after process exit".utf8).write(to: target, options: .atomic) }
        let receiver = MobileSyncStaging(directory: storage)
        let recovered = try receiver.lookup(fixture.request, owner: owner, bookmark: fixture.bookmark)
        if scenario == "edit" {
            try equal(recovered.status, "pending"); try absent(recovered.receipt)
            try rejects { try receiver.publish(fixture.request, owner: owner, bookmark: fixture.bookmark, stage: fixture.stage) }
            try equal(try Data(contentsOf: target), Data("edited after process exit".utf8))
        } else {
            try equal(recovered.status, "complete")
            let receipt = try unwrap(recovered.receipt)
            try equal(receipt.operationId, fixture.request.operation.id)
            try equal(receipt.entry.fingerprint, fixture.request.operation.mutation.source.fingerprint)
            try Data("later edit after receipt".utf8).write(to: target, options: .atomic)
            try equal(try receiver.publish(fixture.request, owner: owner, bookmark: fixture.bookmark, stage: fixture.stage), receipt)
            try equal(try Data(contentsOf: target), Data("later edit after receipt".utf8))
        }
        if scenario != "create" {
            try equal(try Data(contentsOf: operationRoot.appendingPathComponent("publication")), Data("original local version".utf8))
        }
        try equal(hash(try Data(contentsOf: operationRoot.appendingPathComponent("payload"))), hash(bytes()))
        try FileManager.default.removeItem(at: root)
    }
    private enum Failure: Error { case invalid, assertion(String) }
    private static func equal<T: Equatable>(_ a: T, _ b: T) throws { guard a == b else { throw Failure.assertion("Values differ") } }
    private static func different<T: Equatable>(_ a: T, _ b: T) throws { guard a != b else { throw Failure.assertion("Process did not change") } }
    private static func check(_ value: Bool) throws { guard value else { throw Failure.assertion("Required proof missing") } }
    private static func absent(_ value: Any?, _ reason: String = "Expected no value") throws { guard value == nil else { throw Failure.assertion(reason) } }
    private static func unwrap<T>(_ value: T?) throws -> T { guard let value else { throw Failure.invalid }; return value }
    private static func rejects<T>(_ work: () throws -> T) throws {
        do { _ = try work() } catch { return }
        throw Failure.assertion("Unsafe publication was accepted")
    }
}
