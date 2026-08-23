import AppKit

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
    editMenu.addItem(responderItem(title: "Undo", action: Selector(("undo:")), keyEquivalent: "z"))
    editMenu.addItem(responderItem(title: "Redo", action: Selector(("redo:")), keyEquivalent: "Z"))
    editMenu.addItem(.separator())
    editMenu.addItem(responderItem(title: "Cut", action: Selector(("cut:")), keyEquivalent: "x"))
    editMenu.addItem(responderItem(title: "Copy", action: Selector(("copy:")), keyEquivalent: "c"))
    editMenu.addItem(responderItem(title: "Paste", action: Selector(("paste:")), keyEquivalent: "v"))
    editMenu.addItem(responderItem(title: "Select All", action: Selector(("selectAll:")), keyEquivalent: "a"))
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
