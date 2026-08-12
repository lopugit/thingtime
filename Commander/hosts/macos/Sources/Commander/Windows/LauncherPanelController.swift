import AppKit

private final class CommanderPanel: NSPanel {
  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { false }
}

enum LauncherWindowMode: String, Sendable {
  case standard = "default"
  case compact

  var size: NSSize {
    switch self {
    case .standard: NSSize(width: 780, height: 560)
    case .compact: NSSize(width: 720, height: 360)
    }
  }
}

@MainActor
final class LauncherPanelController: NSObject, NSWindowDelegate {
  private let panel: NSPanel
  private let webView: CommanderWebView
  private var contentReady = false
  private var pendingShow = false
  private var windowMode = LauncherWindowMode.standard

  init(ready: DaemonReady, bridge: CommanderNativeBridge) {
    let panel = CommanderPanel(
      contentRect: NSRect(origin: .zero, size: LauncherWindowMode.standard.size),
      styleMask: [.borderless, .nonactivatingPanel, .fullSizeContentView],
      backing: .buffered,
      defer: false
    )
    self.panel = panel
    self.webView = CommanderWebView(ready: ready, surface: "launcher", bridge: bridge)
    super.init()
    panel.delegate = self
    panel.level = .statusBar
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = false
    panel.isMovableByWindowBackground = true
    panel.hidesOnDeactivate = true
    panel.animationBehavior = .utilityWindow
    panel.contentView = webView
    webView.frame = NSRect(origin: .zero, size: LauncherWindowMode.standard.size)
    webView.autoresizingMask = [.width, .height]
    webView.firstPresentationReady = { [weak self] in
      guard let self else { return }
      self.contentReady = true
      if self.pendingShow { self.pendingShow = false; self.show() }
    }
  }

  func show() {
    guard contentReady else { pendingShow = true; return }
    centerOnActiveScreen()
    NSApp.activate(ignoringOtherApps: true)
    panel.makeKeyAndOrderFront(nil)
    webView.window?.makeFirstResponder(webView)
    webView.evaluateJavaScript("document.querySelector('input')?.focus()")
  }

  func hide() { panel.orderOut(nil) }
  func toggle() { panel.isVisible ? hide() : show() }

  func setWindowMode(_ mode: LauncherWindowMode) {
    guard mode != windowMode else { return }
    windowMode = mode
    let size = mode.size
    guard panel.isVisible else {
      panel.setContentSize(size)
      return
    }
    let oldFrame = panel.frame
    let frame = NSRect(
      x: oldFrame.midX - size.width / 2,
      y: oldFrame.maxY - size.height,
      width: size.width,
      height: size.height
    )
    panel.animator().setFrame(frame, display: true)
  }

  func shutdown() {
    pendingShow = false
    webView.firstPresentationReady = nil
    webView.shutdown()
    panel.delegate = nil
    panel.orderOut(nil)
  }

  func windowDidResignKey(_ notification: Notification) { hide() }

  private func centerOnActiveScreen() {
    let mouse = NSEvent.mouseLocation
    let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main
    guard let visible = screen?.visibleFrame else { return }
    let size = panel.frame.size
    let origin = NSPoint(x: visible.midX - size.width / 2, y: visible.maxY - size.height - min(100, visible.height * 0.12))
    panel.setFrameOrigin(origin)
  }
}
