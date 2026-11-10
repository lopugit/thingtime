import XCTest
@testable import Thingtime

@MainActor
final class MobilePublicationProcessTests: XCTestCase {
    func testRecoveryAcrossActualProcessExit() throws {
        let env = ProcessInfo.processInfo.environment
        guard let phase = env["THINGTIME_PUBLICATION_PROCESS_PHASE"],
              let scenario = env["THINGTIME_PUBLICATION_PROCESS_SCENARIO"] else {
            throw XCTSkip("Run scripts/test-mobile-publication-process.sh for actual process-exit acceptance")
        }
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MobilePublicationProcessAcceptance", isDirectory: true)
        if phase == "prepare", FileManager.default.fileExists(atPath: root.appendingPathComponent("after-rename.json").path) {
            throw XCTSkip("Original process exited; run the separate verify phase")
        }
        try PublicationProcessAcceptance.run(phase: phase, scenario: scenario, root: root)
    }
}
