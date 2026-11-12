#if os(macOS)
import AppKit
import XCTest

@MainActor final class PasswordApplicationMenuTests: XCTestCase {
    func testNativeEditingCommandsUseFocusedResponderAndStandardShortcuts() throws {
        let menu = PasswordApplicationMenu.make()
        let edit = try XCTUnwrap(menu.item(withTitle: "Edit")?.submenu)
        XCTAssertTrue(edit.autoenablesItems)
        let commands: [(String, String, String, NSEvent.ModifierFlags)] = [
            ("Undo", "undo:", "z", .command),
            ("Redo", "redo:", "z", [.command, .shift]),
            ("Cut", "cut:", "x", .command),
            ("Copy", "copy:", "c", .command),
            ("Paste", "paste:", "v", .command),
            ("Select All", "selectAll:", "a", .command),
        ]
        for (title, selector, key, modifiers) in commands {
            let item = try XCTUnwrap(edit.item(withTitle: title))
            XCTAssertEqual(item.action.map(NSStringFromSelector), selector, title)
            XCTAssertEqual(item.keyEquivalent, key, title)
            XCTAssertEqual(item.keyEquivalentModifierMask, modifiers, title)
            XCTAssertNil(item.target, "\(title) must use the active responder, not a credential adapter")
        }
    }

    func testQuitUsesNormalApplicationTermination() throws {
        let application = try XCTUnwrap(PasswordApplicationMenu.make().item(at: 0)?.submenu)
        let quit = try XCTUnwrap(application.item(withTitle: "Quit Thingtime Passwords"))
        XCTAssertEqual(quit.action, #selector(NSApplication.terminate(_:)))
        XCTAssertEqual(quit.keyEquivalent, "q")
        XCTAssertEqual(quit.keyEquivalentModifierMask, .command)
        XCTAssertNil(quit.target)
    }
}
#endif
