import AppKit
import XCTest
@testable import ThingtimeNodeCore

@MainActor
final class MenuBarIconTests: XCTestCase {
    func testEveryBuiltInIdentifierRendersAtTheExpectedMenuBarSize() {
        for id in ThingtimeMenuBarIconID.allCases where id != .custom {
            let image = ThingtimeMenuBarIconRenderer.image(id: id)
            XCTAssertEqual(image.size.height, id.isWordmark ? 20 : 18)
            XCTAssertEqual(image.size.width, id.isWordmark ? 108 : 18)
            XCTAssertEqual(image.isTemplate, id == .treeTemplate || id == .wordmarkTemplate)
        }
    }

    func testUnknownEnvironmentValueFallsBackToColourTree() {
        XCTAssertEqual(ThingtimeMenuBarIconID(environmentValue: "unknown"), .treeColor)
        XCTAssertEqual(ThingtimeMenuBarIconID(environmentValue: nil), .treeColor)
    }

    func testMissingCustomImageFallsBackToColourTree() {
        let image = ThingtimeMenuBarIconRenderer.image(id: .custom, customPath: "/missing/thingtime-icon.png")
        XCTAssertEqual(image.size, NSSize(width: 18, height: 18))
        XCTAssertFalse(image.isTemplate)
    }
}
