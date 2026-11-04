import Foundation
@testable import AppleFileSync
import XCTest

enum RustIndexFixture {
    static func executable() throws -> URL {
        let project = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        let helper = ProcessInfo.processInfo.environment["THINGTIME_TEST_COMMANDER_INDEXER"]
            .map { URL(fileURLWithPath: $0) }
            ?? project.appendingPathComponent("filesystem-indexer/target/debug/commander-indexer")
        guard FileManager.default.isExecutableFile(atPath: helper.path) else {
            throw NSError(domain: "Run macos/ThingtimeNode/scripts/test-commander-backup.sh to build the fixture indexer.", code: 1)
        }
        return helper
    }

    static func inventory(directory: URL, helper: URL? = nil) throws -> MobileFolderInventory {
        let database = directory.deletingLastPathComponent().appendingPathComponent(".shared-index/filesystem-index.sqlite3")
        return try MobileFolderInventory(directory: directory, commanderIndexer: helper ?? executable(), database: database)
    }
}
