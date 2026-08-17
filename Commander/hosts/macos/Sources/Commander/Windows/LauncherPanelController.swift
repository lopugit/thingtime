import AppKit
import ApplicationServices

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
  private static let launcherOpenedScript =
    "window.dispatchEvent(new CustomEvent('commander:launcher-opened'))"
  private let panel: NSPanel
  private let webView: CommanderWebView
  private var contentReady = false
  private var pendingShow = false
  private var showPending = false
  private var showRequestID: UInt = 0
  private var windowMode = LauncherWindowMode.standard
  private var pasteTarget: NSRunningApplication?

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
    panel.hasShadow = true
    panel.isMovableByWindowBackground = true
    panel.hidesOnDeactivate = true
    panel.animationBehavior = .utilityWindow
    panel.contentView = webView
    panel.contentView?.wantsLayer = true
    panel.contentView?.layer?.backgroundColor = NSColor.clear.cgColor
    panel.contentView?.superview?.wantsLayer = true
    panel.contentView?.superview?.layer?.backgroundColor = NSColor.clear.cgColor
    webView.frame = NSRect(origin: .zero, size: LauncherWindowMode.standard.size)
    webView.autoresizingMask = [.width, .height]
    webView.maskToSurface(inset: 18, cornerRadius: 19)
    webView.firstPresentationReady = { [weak self] in
      guard let self else { return }
      self.contentReady = true
      if self.pendingShow { self.pendingShow = false; self.show() }
    }
  }

  func show() {
    rememberPasteTarget()
    guard contentReady else { pendingShow = true; return }
    pendingShow = false
    showPending = true
    showRequestID &+= 1
    let requestID = showRequestID
    Task { [weak self] in
      guard let self else { return }
      _ = try? await self.webView.evaluateJavaScript(Self.launcherOpenedScript)
      await Task.yield()
      guard self.showPending, self.showRequestID == requestID else { return }
      self.showPending = false
      self.present()
    }
  }

  private func present() {
    centerOnActiveScreen()
    NSApp.activate(ignoringOtherApps: true)
    panel.makeKeyAndOrderFront(nil)
    webView.window?.makeFirstResponder(webView)
    webView.evaluateJavaScript("document.querySelector('input')?.focus()")
  }

  func hide() {
    pendingShow = false
    showPending = false
    showRequestID &+= 1
    panel.orderOut(nil)
  }

  var pasteTargetName: String? {
    guard let pasteTarget, !pasteTarget.isTerminated else { return nil }
    return pasteTarget.localizedName
  }

  func paste(_ text: String) async -> [String: Any] {
    NSPasteboard.general.clearContents()
    let copied = NSPasteboard.general.setString(text, forType: .string)
    var result: [String: Any] = [
      "copied": copied,
      "pasted": false,
      "requiresAccessibility": false,
    ]
    if let pasteTargetName { result["targetApplication"] = pasteTargetName }
    guard copied else { return result }
    guard AXIsProcessTrusted() else {
      result["requiresAccessibility"] = true
      return result
    }
    guard let pasteTarget, !pasteTarget.isTerminated else { return result }

    hide()
    _ = pasteTarget.activate(options: [.activateAllWindows])
    try? await Task.sleep(for: .milliseconds(120))

    guard let source = CGEventSource(stateID: .hidSystemState),
          let keyDown = CGEvent(keyboardEventSource: source, virtualKey: 0x09, keyDown: true),
          let keyUp = CGEvent(keyboardEventSource: source, virtualKey: 0x09, keyDown: false) else {
      return result
    }
    keyDown.flags = .maskCommand
    keyUp.flags = .maskCommand
    keyDown.post(tap: .cghidEventTap)
    keyUp.post(tap: .cghidEventTap)
    result["pasted"] = true
    return result
  }
  func toggle() { panel.isVisible || pendingShow || showPending ? hide() : show() }

  func setWindowMode(_ mode: LauncherWindowMode) {
    guard mode != windowMode else { return }
    windowMode = mode
    webView.maskToSurface(inset: mode == .compact ? 12 : 18, cornerRadius: 19)
    let size = mode.size
    guard panel.isVisible else {
      panel.setContentSize(size)
      panel.invalidateShadow()
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
    panel.invalidateShadow()
  }

  func shutdown() {
    hide()
    webView.firstPresentationReady = nil
    webView.shutdown()
    panel.delegate = nil
  }

  func windowDidResignKey(_ notification: Notification) { hide() }

  var panelForTesting: NSPanel { panel }
  static var launcherOpenedScriptForTesting: String { launcherOpenedScript }

  private func rememberPasteTarget() {
    guard let active = NSWorkspace.shared.frontmostApplication,
          active.processIdentifier != ProcessInfo.processInfo.processIdentifier,
          !active.isTerminated else { return }
    pasteTarget = active
  }

  private func centerOnActiveScreen() {
    let mouse = NSEvent.mouseLocation
    let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main
    guard let visible = screen?.visibleFrame else { return }
    let size = panel.frame.size
    let origin = NSPoint(x: visible.midX - size.width / 2, y: visible.maxY - size.height - min(100, visible.height * 0.12))
    panel.setFrameOrigin(origin)
    panel.invalidateShadow()
  }
}
