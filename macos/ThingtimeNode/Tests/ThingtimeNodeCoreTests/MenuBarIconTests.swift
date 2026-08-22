import AppKit
import XCTest
@testable import ThingtimeNodeCore

@MainActor
final class MenuBarIconTests: XCTestCase {
    func testEveryBuiltInIdentifierRendersAtTheExpectedMenuBarSize() {
        for id in ThingtimeMenuBarIconID.allCases where id != .custom {
            let image = ThingtimeMenuBarIconRenderer.image(id: id)
            XCTAssertEqual(image.size.height, id.isWordmark ? 16 : 18)
            XCTAssertEqual(image.size.width, id.isWordmark ? 86 : 18)
            XCTAssertEqual(image.isTemplate, id == .treeTemplate || id == .wordmarkTemplate)
        }
    }

    func testUnknownEnvironmentValueFallsBackToPinkFourSquares() {
        XCTAssertEqual(ThingtimeMenuBarIconID(environmentValue: "unknown"), .treePink)
        XCTAssertEqual(ThingtimeMenuBarIconID(environmentValue: nil), .treePink)
    }

    func testMissingCustomImageFallsBackToColourTree() {
        let image = ThingtimeMenuBarIconRenderer.image(id: .custom, customPath: "/missing/thingtime-icon.png")
        XCTAssertEqual(image.size, NSSize(width: 18, height: 18))
        XCTAssertFalse(image.isTemplate)
    }

    func testStatusMenuUsesThingtimeCopyAndProvidesARealQuitCommand() {
        XCTAssertEqual(
            ThingtimeStatusMenuCopy.commandTitles(launchdManaged: true),
            ["Refresh Status", "Open Thingtime", "Restart Thingtime", "Quit Thingtime"]
        )
        XCTAssertEqual(
            ThingtimeStatusMenuCopy.commandTitles(launchdManaged: false),
            ["Refresh Status", "Open Thingtime", "Quit Thingtime"]
        )
        XCTAssertEqual(ThingtimeStatusMenuCopy.healthy(accountCount: 0), "Ready to pair")
        XCTAssertEqual(ThingtimeStatusMenuCopy.healthy(accountCount: 1), "Paired · Thingtime healthy")
        XCTAssertEqual(ThingtimeStatusMenuCopy.healthy(accountCount: 2), "Paired to 2 accounts · Thingtime healthy")
        XCTAssertFalse(
            (ThingtimeStatusMenuCopy.commandTitles(launchdManaged: true)
                + [ThingtimeStatusMenuCopy.degraded, ThingtimeStatusMenuCopy.unavailable])
                .contains(where: { $0.contains("Thingtime Node") })
        )
    }
}
