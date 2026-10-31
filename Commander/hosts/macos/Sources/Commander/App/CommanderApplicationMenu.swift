import AppKit

/// Declares the standard responder-chain selectors so Swift can build the
/// menu without dynamically constructing selector strings. The menu items
/// still have a nil target and are therefore dispatched to WebKit's focused
/// responder, rather than to an instance of this helper.
@objc private final class CommanderEditResponderActions: NSObject {
  @objc func undo(_ sender: Any?) {}
  @objc func redo(_ sender: Any?) {}
  @objc func cut(_ sender: Any?) {}
  @objc func copy(_ sender: Any?) {}
  @objc func paste(_ sender: Any?) {}
  @objc func selectAll(_ sender: Any?) {}
}

/// Commander is an accessory app, so AppKit does not create its normal main
/// menu. Supplying these standard responder-chain actions lets the focused
/// WKWebView receive macOS editing shortcuts such as Command-V and Command-A.
@MainActor
enum CommanderApplicationMenu {
  static func make() -> NSMenu {
    let mainMenu = NSMenu(title: "Commander")

    let appMenu = NSMenu(title: "Commander")
    appMenu.addItem(
      NSMenuItem(
        title: "Quit Commander",
        action: #selector(NSApplication.terminate(_:)),
        keyEquivalent: "q"
      )
    )
    let appMenuItem = NSMenuItem(title: "Commander", action: nil, keyEquivalent: "")
    appMenuItem.submenu = appMenu
    mainMenu.addItem(appMenuItem)

    let editMenu = NSMenu(title: "Edit")
    editMenu.addItem(responderItem(title: "Undo", action: #selector(CommanderEditResponderActions.undo(_:)), keyEquivalent: "z"))
    editMenu.addItem(responderItem(title: "Redo", action: #selector(CommanderEditResponderActions.redo(_:)), keyEquivalent: "Z"))
    editMenu.addItem(.separator())
    editMenu.addItem(responderItem(title: "Cut", action: #selector(CommanderEditResponderActions.cut(_:)), keyEquivalent: "x"))
    editMenu.addItem(responderItem(title: "Copy", action: #selector(CommanderEditResponderActions.copy(_:)), keyEquivalent: "c"))
    editMenu.addItem(responderItem(title: "Paste", action: #selector(CommanderEditResponderActions.paste(_:)), keyEquivalent: "v"))
    editMenu.addItem(responderItem(title: "Select All", action: #selector(CommanderEditResponderActions.selectAll(_:)), keyEquivalent: "a"))
    let editMenuItem = NSMenuItem(title: "Edit", action: nil, keyEquivalent: "")
    editMenuItem.submenu = editMenu
    mainMenu.addItem(editMenuItem)

    return mainMenu
  }

  private static func responderItem(title: String, action: Selector, keyEquivalent: String) -> NSMenuItem {
    let item = NSMenuItem(title: title, action: action, keyEquivalent: keyEquivalent)
    item.target = nil
    return item
  }
}
