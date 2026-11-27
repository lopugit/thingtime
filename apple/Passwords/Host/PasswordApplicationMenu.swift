#if os(macOS)
import AppKit

// Declare standard selectors without owning their implementation. Nil menu
// targets let AppKit route each action to WebKit's focused responder.
@objc private final class PasswordEditResponderActions: NSObject {
    @objc func undo(_ sender: Any?) {}
    @objc func redo(_ sender: Any?) {}
    @objc func cut(_ sender: Any?) {}
    @objc func copy(_ sender: Any?) {}
    @objc func paste(_ sender: Any?) {}
    @objc func selectAll(_ sender: Any?) {}
}

/// LSUIElement companions do not receive a standard main menu automatically.
/// Keep keyboard editing native: no clipboard reads, event monitors or JS.
@MainActor enum PasswordApplicationMenu {
    static func make() -> NSMenu {
        let menu = NSMenu(title: "Thingtime Passwords")
        let application = NSMenu(title: "Thingtime Passwords")
        application.addItem(item("Quit Thingtime Passwords", #selector(NSApplication.terminate(_:)), "q"))
        let applicationItem = NSMenuItem(title: "Thingtime Passwords", action: nil, keyEquivalent: "")
        applicationItem.submenu = application
        menu.addItem(applicationItem)

        let edit = NSMenu(title: "Edit")
        edit.addItem(item("Undo", #selector(PasswordEditResponderActions.undo(_:)), "z"))
        edit.addItem(item("Redo", #selector(PasswordEditResponderActions.redo(_:)), "z", [.command, .shift]))
        edit.addItem(.separator())
        edit.addItem(item("Cut", #selector(PasswordEditResponderActions.cut(_:)), "x"))
        edit.addItem(item("Copy", #selector(PasswordEditResponderActions.copy(_:)), "c"))
        edit.addItem(item("Paste", #selector(PasswordEditResponderActions.paste(_:)), "v"))
        edit.addItem(item("Select All", #selector(PasswordEditResponderActions.selectAll(_:)), "a"))
        let editItem = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
        editItem.submenu = edit
        menu.addItem(editItem)
        return menu
    }

    private static func item(_ title: String, _ action: Selector, _ key: String, _ modifiers: NSEvent.ModifierFlags = .command) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.keyEquivalentModifierMask = modifiers
        item.target = nil
        return item
    }
}
#endif
