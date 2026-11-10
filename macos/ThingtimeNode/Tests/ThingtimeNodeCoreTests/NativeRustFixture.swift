import AppleFileSync
import Foundation

enum NativeRustFixture {
    static func helper() throws -> URL {
        let project = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let binary = ProcessInfo.processInfo.environment["THINGTIME_TEST_COMMANDER_INDEXER"]
            .map { URL(fileURLWithPath: $0) }
            ?? project.appendingPathComponent("filesystem-indexer/target/debug/commander-indexer")
        guard FileManager.default.isExecutableFile(atPath: binary.path) else {
            throw NSError(domain: "Run macos/ThingtimeNode/scripts/test-commander-backup.sh to build the fixture indexer.", code: 1)
        }
        return binary
    }
    static func inventory(directory: URL) throws -> MobileFolderInventory {
        try MobileFolderInventory(directory: directory, transport: transport(directory: directory))
    }
    static func transport(directory: URL) throws -> RustProcessInventoryTransport {
        try RustProcessInventoryTransport(helper: helper(), database: directory.appendingPathComponent("private-index.sqlite3"))
    }
}
