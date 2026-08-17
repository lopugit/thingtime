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
  private var pendingCommandItemID: String?
  private var showPending = false
  private var showRequestID: UInt = 0
  private var windowMode = LauncherWindowMode.standard
  private var pasteTarget: NSRunningApplication?
  private var fileDragInProgress = false
  private var isPresented = false
  private var commandPresentationItemID: String?
  private var commandPresentationFallback: Task<Void, Never>?

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
    // A nonactivating panel can be automatically hidden while AppKit still reports
    // it as visible. Commander owns dismissal through windowDidResignKey instead.
    panel.hidesOnDeactivate = false
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
      if self.pendingShow {
        let commandItemID = self.pendingCommandItemID
        self.pendingShow = false
        self.pendingCommandItemID = nil
        self.requestShow(commandItemID: commandItemID)
      }
    }
    webView.fileDragSessionChanged = { [weak self] active, completed in
      self?.fileDragSessionChanged(active: active, completed: completed)
    }
  }

  func show() { requestShow(commandItemID: nil) }

  func runCommandHotKey(itemID: String) { requestShow(commandItemID: itemID) }

  private func requestShow(commandItemID: String?) {
    rememberPasteTarget()
    guard contentReady else {
      pendingShow = true
      pendingCommandItemID = commandItemID
      return
    }
    pendingShow = false
    pendingCommandItemID = nil
    showPending = true
    showRequestID &+= 1
    let requestID = showRequestID
    if let commandItemID {
      beginCommandHotKeyPresentation(itemID: commandItemID)
    } else {
      cancelCommandHotKeyPresentation()
    }
    present()
    Task { [weak self] in
      guard let self else { return }
      _ = try? await self.webView.evaluateJavaScript(Self.launcherOpenedScript)
      if let commandItemID {
        _ = try? await self.webView.evaluateJavaScript(Self.commandHotKeyScript(itemID: commandItemID))
      }
      await Task.yield()
      guard self.showPending, self.showRequestID == requestID else { return }
      self.showPending = false
      self.focusCurrentInput()
    }
  }

  private func present() {
    isPresented = true
    centerOnActiveScreen()
    NSApp.unhide(nil)
    NSApp.activate(ignoringOtherApps: true)
    panel.makeKeyAndOrderFront(nil)
    webView.window?.makeFirstResponder(webView)
    focusCurrentInput()
  }

  func hide() {
    pendingShow = false
    pendingCommandItemID = nil
    showPending = false
    showRequestID &+= 1
    isPresented = false
    cancelCommandHotKeyPresentation()
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
  func toggle() {
    if NSApp.isHidden {
      show()
    } else if (isPresented && panel.isVisible) || pendingShow || showPending {
      hide()
    } else {
      show()
    }
  }

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
    commandPresentationFallback?.cancel()
    webView.firstPresentationReady = nil
    webView.shutdown()
    panel.delegate = nil
  }

  func windowDidResignKey(_ notification: Notification) {
    guard !fileDragInProgress else { return }
    let commandPresentationWasActive = commandPresentationItemID != nil
    let hasOtherKeyWindow = NSApp.keyWindow.map { $0 !== panel } ?? false
    if !Self.shouldRestoreAfterResign(
      commandPresentationActive: commandPresentationWasActive,
      applicationIsActive: NSApp.isActive,
      hasOtherKeyWindow: hasOtherKeyWindow
    ) {
      hide()
      return
    }
    Task { @MainActor [weak self] in
      await Task.yield()
      guard let self, self.isPresented, !self.fileDragInProgress else { return }
      if self.panel.isKeyWindow { return }
      let hasOtherKeyWindow = NSApp.keyWindow.map { $0 !== self.panel } ?? false
      if Self.shouldRestoreAfterResign(
        commandPresentationActive: commandPresentationWasActive
          || self.commandPresentationItemID != nil,
        applicationIsActive: NSApp.isActive,
        hasOtherKeyWindow: hasOtherKeyWindow
      ) {
        self.restoreCommandPresentationFocus()
        return
      }
      self.hide()
    }
  }

  func beginCommandHotKeyPresentation(itemID: String) {
    isPresented = true
    commandPresentationFallback?.cancel()
    commandPresentationItemID = itemID
    commandPresentationFallback = Task { @MainActor [weak self] in
      try? await Task.sleep(for: .seconds(1))
      guard !Task.isCancelled else { return }
      self?.commandHotKeyReady(itemID: itemID)
    }
  }

  func commandHotKeyReady(itemID: String) {
    guard commandPresentationItemID == itemID else { return }
    commandPresentationFallback?.cancel()
    commandPresentationFallback = nil
    commandPresentationItemID = nil
    guard isPresented else { return }
    restoreCommandPresentationFocus()
  }

  var commandPresentationItemIDForTesting: String? { commandPresentationItemID }

  static func shouldRestoreAfterResign(
    commandPresentationActive: Bool,
    applicationIsActive: Bool,
    hasOtherKeyWindow: Bool
  ) -> Bool {
    commandPresentationActive || (applicationIsActive && !hasOtherKeyWindow)
  }

  var panelForTesting: NSPanel { panel }
  static var launcherOpenedScriptForTesting: String { launcherOpenedScript }
  static func commandHotKeyScriptForTesting(itemID: String) -> String {
    commandHotKeyScript(itemID: itemID)
  }

  private static func commandHotKeyScript(itemID: String) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: itemID, options: [.fragmentsAllowed]),
          let encoded = String(data: data, encoding: .utf8) else { return "" }
    return "window.dispatchEvent(new CustomEvent('commander:command-hotkey',{detail:\(encoded)}))"
  }

  private func rememberPasteTarget() {
    guard let active = NSWorkspace.shared.frontmostApplication,
          active.processIdentifier != ProcessInfo.processInfo.processIdentifier,
          !active.isTerminated else { return }
    pasteTarget = active
  }

  private func fileDragSessionChanged(active: Bool, completed: Bool) {
    fileDragInProgress = active
    guard !active else { return }
    if completed {
      hide()
    } else if panel.isVisible {
      NSApp.activate(ignoringOtherApps: true)
      panel.makeKeyAndOrderFront(nil)
      panel.makeFirstResponder(webView)
    }
  }

  private func cancelCommandHotKeyPresentation() {
    commandPresentationFallback?.cancel()
    commandPresentationFallback = nil
    commandPresentationItemID = nil
  }

  private func restoreCommandPresentationFocus() {
    guard isPresented else { return }
    NSApp.unhide(nil)
    NSApp.activate(ignoringOtherApps: true)
    panel.makeKeyAndOrderFront(nil)
    panel.makeFirstResponder(webView)
    focusCurrentInput()
  }

  private func focusCurrentInput() {
    webView.evaluateJavaScript("document.querySelector('input')?.focus()")
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
