import AppKit
import XCTest
@testable import Commander

@MainActor
final class CommanderApplicationMenuTests: XCTestCase {
  func testIncludesResponderChainPasteAndSelectAllCommands() {
    let mainMenu = CommanderApplicationMenu.make()
    let editMenu = mainMenu.item(withTitle: "Edit")?.submenu

    let paste = editMenu?.item(withTitle: "Paste")
    XCTAssertEqual(paste?.action.map(NSStringFromSelector), "paste:")
    XCTAssertEqual(paste?.keyEquivalent, "v")
    XCTAssertNil(paste?.target)

    let selectAll = editMenu?.item(withTitle: "Select All")
    XCTAssertEqual(selectAll?.action.map(NSStringFromSelector), "selectAll:")
    XCTAssertEqual(selectAll?.keyEquivalent, "a")
    XCTAssertNil(selectAll?.target)
  }
}
