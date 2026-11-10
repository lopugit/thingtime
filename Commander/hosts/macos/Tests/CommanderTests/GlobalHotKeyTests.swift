import Carbon
import XCTest
@testable import Commander

@MainActor
final class GlobalHotKeyTests: XCTestCase {
  func testParsesCommandShortcutKeysAndModifiers() throws {
    let parsed = try GlobalHotKeyRegistry.parse("Command+Option+E")

    XCTAssertEqual(parsed.keyCode, UInt32(kVK_ANSI_E))
    XCTAssertNotEqual(parsed.modifiers & UInt32(cmdKey), 0)
    XCTAssertNotEqual(parsed.modifiers & UInt32(optionKey), 0)
  }

  func testRejectsUnmodifiedAndUnknownShortcuts() {
    XCTAssertThrowsError(try GlobalHotKeyRegistry.parse("E"))
    XCTAssertThrowsError(try GlobalHotKeyRegistry.parse("Command+NotAKey"))
  }
}
