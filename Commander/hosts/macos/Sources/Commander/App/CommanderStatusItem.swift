import AppKit

@MainActor
final class CommanderStatusItem {
  private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)

  init(open: @escaping () -> Void, settings: @escaping () -> Void) {
    item.button?.image = NSImage(systemSymbolName: "command.circle", accessibilityDescription: "Commander")
    let menu = NSMenu()
    menu.addItem(ClosureMenuItem(title: "Open Commander", keyEquivalent: "", action: open))
    menu.addItem(ClosureMenuItem(title: "Settings…", keyEquivalent: ",", action: settings))
    menu.addItem(.separator())
    menu.addItem(ClosureMenuItem(title: "Quit Commander", keyEquivalent: "q") { NSApp.terminate(nil) })
    item.menu = menu
  }

  func remove() { NSStatusBar.system.removeStatusItem(item) }
}

@MainActor
private final class ClosureMenuItem: NSMenuItem {
  private let closure: () -> Void
  init(title: String, keyEquivalent: String, action: @escaping () -> Void) {
    self.closure = action
    super.init(title: title, action: #selector(invoke), keyEquivalent: keyEquivalent)
    target = self
  }
  @available(*, unavailable) required init(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  @objc private func invoke() {
    // Run after AppKit dismisses the status menu so it cannot immediately steal
    // key status back from the launcher panel and trigger windowDidResignKey.
    perform(#selector(invokeAfterMenuDismissal), with: nil, afterDelay: 0)
  }
  @objc private func invokeAfterMenuDismissal() { closure() }
}
