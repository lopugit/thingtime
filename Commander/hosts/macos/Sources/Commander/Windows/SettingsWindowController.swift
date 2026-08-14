import AppKit

@MainActor
final class SettingsWindowController: NSObject, NSWindowDelegate {
  private let window: NSWindow
  private let webView: CommanderWebView

  init(ready: DaemonReady, bridge: CommanderNativeBridge) {
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 960, height: 650),
      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
      backing: .buffered,
      defer: false
    )
    self.window = window
    self.webView = CommanderWebView(ready: ready, surface: "settings", bridge: bridge)
    super.init()
    window.delegate = self
    window.title = "Commander Settings"
    window.titleVisibility = .hidden
    window.titlebarAppearsTransparent = true
    window.isMovableByWindowBackground = true
    window.isReleasedWhenClosed = false
    window.minSize = NSSize(width: 760, height: 520)
    window.contentView = webView
    window.center()
  }

  func show() {
    NSApp.setActivationPolicy(.regular)
    NSApp.activate(ignoringOtherApps: true)
    window.makeKeyAndOrderFront(nil)
  }

  func windowWillClose(_ notification: Notification) {
    NSApp.setActivationPolicy(.accessory)
  }

  func shutdown() {
    webView.shutdown()
    window.delegate = nil
    window.orderOut(nil)
  }
}
