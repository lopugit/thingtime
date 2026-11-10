import Foundation
import AppleFileSync

@main
struct EmbeddedFixture {
    static func main() async throws {
        guard RustEmbeddedInventoryTransport.isAvailable else { fatalError("Rust archive must be linked for this acceptance check") }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("thingtime-embedded-index-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: directory) }
        let source = directory.appendingPathComponent("source")
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: false)
        try Data("synthetic embedded fixture".utf8).write(to: source.appendingPathComponent("sample.txt"))
        try FileManager.default.createSymbolicLink(atPath: source.appendingPathComponent("sample-link").path, withDestinationPath: "sample.txt")
        let transport = RustEmbeddedInventoryTransport(database: directory.appendingPathComponent("index.sqlite3"))
        let inventory = MobileFolderInventory(directory: directory.appendingPathComponent("jobs"), transport: transport)
        let owner = try FileSyncOwnerScope(ownerId: "embedded-synthetic", url: URL(string: "https://thingtime.com")!)
        let scope = MobileFolderInventory.Scope(owner: owner, deviceId: "embedded-fixture", rootId: UUID().uuidString)
        let bookmark = try source.bookmarkData(options: [.withSecurityScope], includingResourceValuesForKeys: nil, relativeTo: nil)
        let entries = try await Task.detached { try inventory.legacyScan(scope, bookmark: bookmark) }.value
        guard entries.count == 2,
              entries.first(where: { $0.path == "sample.txt" })?.size == 26,
              entries.first(where: { $0.path == "sample-link" })?.symbolicLink != nil else { fatalError("Embedded inventory did not round trip file and symlink") }
        // Caller failure must unwind the producer even when output is queued.
        let request = Data("{\"version\":1,\"operation\":\"status\",\"scope\":{\"origin\":\"https://thingtime.com\",\"accountId\":\"synthetic\",\"deviceId\":\"test\",\"rootId\":\"root\"},\"generation\":\"missing\"}\n".utf8)
        enum Stop: Error { case callback }
        do { try transport.run(request: request, isCancelled: { false }) { _ in throw Stop.callback }; fatalError("Expected callback stop") }
        catch Stop.callback { }
        do { try transport.run(request: request, isCancelled: { true }) { _ in }; fatalError("Expected cancellation") }
        catch is CancellationError { }
        // Cancelling on the caller task must reach Rust while it is hashing,
        // not wait for the next completed-file output callback.
        try Data(repeating: 91, count: 16 * 1_048_576).write(to: source.appendingPathComponent("large.bin"))
        let operation = Task.detached { try inventory.legacyScan(scope, bookmark: bookmark) }
        try await Task.sleep(nanoseconds: 200_000_000)
        let cancellationStarted = Date()
        operation.cancel()
        do { _ = try await operation.value; fatalError("Expected hashing cancellation") }
        catch is CancellationError { }
        guard Date().timeIntervalSince(cancellationStarted) < 2 else { fatalError("Hashing cancellation did not settle promptly") }
        print("Embedded Rust acceptance passed: strict file + symlink inventory, callback cancellation, preflight and active hashing cancellation")
    }
}
