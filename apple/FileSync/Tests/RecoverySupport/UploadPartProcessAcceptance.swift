import AppleFileSync
import Foundation
import Darwin

/// Crashes only the disposable fixture process, never an installed application.
@MainActor
public enum UploadPartProcessAcceptance {
    private struct Fixture: Codable {
        let request: FileUploadPartStore.Request
        let bookmark: Data
        let process: Int32
    }
    private enum Failure: Error { case invalid }
    private static func require(_ condition: Bool) throws { guard condition else { throw Failure.invalid } }
    private static func bytes() -> Data { Data((0..<131_079).map { UInt8($0 % 251) }) }
    public static func run(phase: String, scenario: String, root: URL) throws {
        guard ["prepare", "verify"].contains(phase), ["upload-part-ready", "upload-part-incomplete"].contains(scenario) else { throw Failure.invalid }
        let selected = root.appendingPathComponent("selected"), storage = root.appendingPathComponent("private")
        let target = selected.appendingPathComponent("sample.bin"), checkpoint = root.appendingPathComponent("fixture.json")
        let proof = root.appendingPathComponent("exit.json")
        let exit = {
            try Data("{\"pid\":\(getpid())}".utf8).write(to: proof, options: .atomic)
            Darwin._exit(77)
        }
        if phase == "prepare" {
            try FileManager.default.createDirectory(at: selected, withIntermediateDirectories: true)
            try bytes().write(to: target)
            let scope = try FileSyncOwnerScope(ownerId: "upload-process", url: URL(string: "https://process.invalid")!)
            var grants: Data?
            let grantStore = MobileFolderStore(load: { _ in grants }, save: { _, value in grants = value })
            let bookmark = try grantStore.add(scope, selected: selected).bookmark
            guard let source = try MobileFolderReader.scan(bookmark: bookmark).first else { throw Failure.invalid }
            let request = FileUploadPartStore.Request(scope: scope, rootId: UUID().uuidString,
                grantHash: PhotoLibraryReader.hash(bookmark), uploadId: "original-upload", requestId: "original-request",
                source: source, partNumber: 1, offset: 0, length: source.size)
            try JSONEncoder().encode(Fixture(request: request, bookmark: bookmark, process: getpid())).write(to: checkpoint, options: .atomic)
            let store = FileUploadPartStore(directory: storage, afterPayloadFlushed: scenario == "upload-part-incomplete" ? exit : nil)
            _ = try store.prepare(request) { offset, length, receive in
                try MobileFolderReader.stream(bookmark: bookmark, path: source.path, version: source.version, offset: offset, length: length, receive: receive)
            }
            try exit()
            throw Failure.invalid
        }
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: checkpoint))
        try require(fixture.process != getpid())
        // Same source reauthorization as the native bridge before using any cache.
        _ = try MobileFolderReader.read(bookmark: fixture.bookmark, path: fixture.request.source.path,
            version: fixture.request.source.version, offset: 0, length: 1)
        var calls = 0
        let store = FileUploadPartStore(directory: storage)
        let part = try store.prepare(fixture.request) { offset, length, receive in
            calls += 1
            guard scenario == "upload-part-incomplete" else { throw Failure.invalid }
            return try MobileFolderReader.stream(bookmark: fixture.bookmark, path: fixture.request.source.path,
                version: fixture.request.source.version, offset: offset, length: length, receive: receive)
        }
        try require(part.reused == (scenario == "upload-part-ready"))
        try require(calls == (scenario == "upload-part-ready" ? 0 : 1))
        try require(Data(contentsOf: part.url) == bytes()); try require(part.sha256 == PhotoLibraryReader.hash(bytes()))
        // Cached bytes never bypass a host's live source version check.
        try Data("changed after interruption".utf8).write(to: target)
        do {
            _ = try MobileFolderReader.read(bookmark: fixture.bookmark, path: fixture.request.source.path,
                version: fixture.request.source.version, offset: 0, length: 1)
            throw Failure.invalid
        } catch is Failure { throw Failure.invalid } catch { }
        try require(Data(contentsOf: part.url) == bytes())
        try store.release(fixture.request)
        try require(!FileManager.default.fileExists(atPath: part.url.path))
    }
}
