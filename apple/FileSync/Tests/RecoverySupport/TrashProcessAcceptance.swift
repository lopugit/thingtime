import AppleFileSync
import Foundation
import CryptoKit
import Darwin

/// Disposable fixture only. The prepare phase exits its own child process
/// between filesystem publication and receipt persistence.
@MainActor
public enum TrashProcessAcceptance {
    private struct Fixture: Codable {
        let request: MobileSyncTrash.Request
        let bookmark: Data
        let process: Int32
        let scenario: String
        let restore: MobileSyncTrash.Restore?
    }
    private enum Failure: Error { case invalid }
    private static func require(_ condition: Bool) throws {
        guard condition else { throw Failure.invalid }
    }
    private static func bytes() -> Data { Data((0..<131_079).map { UInt8($0 % 251) }) }
    private static func hash(_ value: Data) -> Data { Data(SHA256.hash(data: value)) }
    public static func run(phase: String, scenario: String, root: URL) throws {
        guard ["prepare", "verify"].contains(phase), ["trash-file", "trash-folder", "trash-recreated", "trash-restore"].contains(scenario) else { throw Failure.invalid }
        let selected = root.appendingPathComponent("selected"), storage = root.appendingPathComponent("private")
        let target = selected.appendingPathComponent("sample"), checkpoint = root.appendingPathComponent("fixture.json")
        let proof = root.appendingPathComponent("after-rename.json")
        let owner = try FileSyncOwnerScope(ownerId: "trash-process", url: URL(string: "https://process.invalid")!)
        if phase == "prepare" {
            guard !FileManager.default.fileExists(atPath: proof.path) else { throw Failure.invalid }
            try FileManager.default.createDirectory(at: selected, withIntermediateDirectories: true)
            if scenario == "trash-folder" { try FileManager.default.createDirectory(at: target, withIntermediateDirectories: false) }
            else { try bytes().write(to: target) }
            var grants: Data?
            let store = MobileFolderStore(load: { _ in grants }, save: { _, value in grants = value })
            let grant = try store.add(owner, selected: selected)
            guard let expected = try MobileFolderReader.scan(bookmark: grant.bookmark).first else { throw Failure.invalid }
            let scope = MobileSyncStaging.Scope(origin: owner.origin.absoluteString, ownerId: owner.ownerId, dataPlane: "home",
                rootId: "process-connection", deviceId: "process-device")
            let request = MobileSyncTrash.Request(scope: scope, rootId: grant.id, operation: .init(id: UUID().uuidString.lowercased(),
                mutation: .init(kind: "trash", side: "local", path: expected.path, expected: expected), confirmed: false))
            let exitAfterRename = {
                try Data("{\"renamed\":true,\"pid\":\(getpid())}".utf8).write(to: proof, options: .atomic)
                Darwin._exit(79)
            }
            var restoration: MobileSyncTrash.Restore?
            if scenario == "trash-restore" {
                let worker = MobileSyncTrash(directory: storage)
                _ = try worker.trash(request, owner: owner, bookmark: grant.bookmark)
                guard let retained = try worker.inspect(request, owner: owner, bookmark: grant.bookmark) else { throw Failure.invalid }
                restoration = .init(path: "sample", expected: retained)
            }
            try JSONEncoder().encode(Fixture(request: request, bookmark: grant.bookmark, process: getpid(), scenario: scenario,
                restore: restoration)).write(to: checkpoint, options: .atomic)
            if let restoration {
                _ = try MobileSyncTrash(directory: storage, afterRestore: exitAfterRename).restore(request, owner: owner,
                    bookmark: grant.bookmark, restore: restoration)
            } else {
                _ = try MobileSyncTrash(directory: storage, afterMove: exitAfterRename).trash(request, owner: owner, bookmark: grant.bookmark)
            }
            throw Failure.invalid
        }
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: checkpoint))
        try require(fixture.process != getpid()); try require(fixture.scenario == scenario)
        let directories = try FileManager.default.contentsOfDirectory(at: storage, includingPropertiesForKeys: nil).filter { $0.lastPathComponent != "lock" }
        try require(directories.count == 1)
        let record = try JSONSerialization.jsonObject(with: Data(contentsOf: directories[0].appendingPathComponent("record.json"))) as? [String: Any]
        let worker = MobileSyncTrash(directory: storage)
        if let restoration = fixture.restore {
            try require((record?["restoration"] as? [String: Any])?["receipt"] == nil)
            let receipt = try worker.restore(fixture.request, owner: owner, bookmark: fixture.bookmark, restore: restoration)
            try require(hash(Data(contentsOf: target)) == hash(bytes()))
            try Data("later local change".utf8).write(to: target, options: .atomic)
            try require(worker.restore(fixture.request, owner: owner, bookmark: fixture.bookmark, restore: restoration) == receipt)
            try require(Data(contentsOf: target) == Data("later local change".utf8))
        } else {
            try require(record?["receipt"] == nil)
            if scenario == "trash-recreated" { try Data("new local file".utf8).write(to: target) }
            let lookup = try worker.lookup(fixture.request, owner: owner, bookmark: fixture.bookmark)
            try require(lookup.status == "complete")
            try require(worker.trash(fixture.request, owner: owner, bookmark: fixture.bookmark) == lookup.receipt)
            guard let retained = try worker.inspect(fixture.request, owner: owner, bookmark: fixture.bookmark) else { throw Failure.invalid }
            let path = scenario == "trash-recreated" ? "recovered" : "sample"
            _ = try worker.restore(fixture.request, owner: owner, bookmark: fixture.bookmark, restore: .init(path: path, expected: retained))
            if scenario == "trash-folder" { try require(FileManager.default.contentsOfDirectory(atPath: target.path).isEmpty) }
            else { try require(hash(Data(contentsOf: selected.appendingPathComponent(path))) == hash(bytes())) }
            if scenario == "trash-recreated" { try require(Data(contentsOf: target) == Data("new local file".utf8)) }
        }
    }
}
