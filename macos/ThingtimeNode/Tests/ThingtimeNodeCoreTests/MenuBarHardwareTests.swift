import AppKit
import XCTest
@testable import ThingtimeNodeCore
final class MenuBarHardwareTests: XCTestCase {
    @MainActor func testLiveReadOnlyInventory() throws {
        guard ProcessInfo.processInfo.environment["TT_MENU_BAR_HARDWARE_TEST"] == "1" else { throw XCTSkip("Explicit read-only hardware acceptance") }
        let start = Date()
        let snapshot = SystemMenuBar.snapshot()
        for item in snapshot.items {
            let application = try XCTUnwrap(NSRunningApplication(processIdentifier: item.processId))
            XCTAssertEqual(item.bundleId, application.bundleIdentifier)
            XCTAssertEqual(item.executablePath, application.executableURL?.path)
        }
        XCTAssertEqual(Set(snapshot.items.map(\.id)).count, snapshot.items.count)
        print("MENU_BAR_HARDWARE items=\(snapshot.items.count) accessibility=\(snapshot.accessibility) unreadable=\(snapshot.unreadableApplications) seconds=\(Date().timeIntervalSince(start))")
    }
}
