import AppKit

enum CommanderSettingsTab: String, Sendable {
  case general, extensions, search, activity, sync, account, advanced, about
}

@MainActor
final class SettingsWindowController: NSObject, NSWindowDelegate {
  private let window: NSWindow
  private let webView: CommanderWebView
  private var contentReady = false
  private var pendingTab: CommanderSettingsTab?

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
    webView.firstPresentationReady = { [weak self] in
      self?.contentReady = true
      self?.dispatchPendingTab()
    }
  }

  func show(tab: CommanderSettingsTab? = nil) {
    if let tab { pendingTab = tab }
    NSApp.setActivationPolicy(.regular)
    NSApp.activate(ignoringOtherApps: true)
    window.makeKeyAndOrderFront(nil)
    dispatchPendingTab()
  }

  func windowWillClose(_ notification: Notification) {
    NSApp.setActivationPolicy(.accessory)
  }

  func shutdown() {
    webView.firstPresentationReady = nil
    webView.shutdown()
    window.delegate = nil
    window.orderOut(nil)
  }

  private func dispatchPendingTab() {
    guard contentReady, let tab = pendingTab else { return }
    pendingTab = nil
    let script = Self.settingsTabScript(tab)
    Task { [weak webView] in _ = try? await webView?.evaluateJavaScript(script) }
  }

  private static func settingsTabScript(_ tab: CommanderSettingsTab) -> String {
    "window.dispatchEvent(new CustomEvent('commander:settings-tab',{detail:'\(tab.rawValue)'}))"
  }

  static func settingsTabScriptForTesting(_ tab: CommanderSettingsTab) -> String {
    settingsTabScript(tab)
  }
}
