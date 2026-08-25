import AppKit
import ApplicationServices

private final class CommanderPanel: NSPanel {
  var resizeSurfaceInset = CommanderWebView.launcherSurfaceInset
  var usesCustomWindowResizeHandling = true {
    didSet {
      if !usesCustomWindowResizeHandling { cancelResizeSession() }
    }
  }
  private var resizeSession: (
    edges: CommanderResizeEdges,
    frame: NSRect,
    mouseLocation: NSPoint
  )?

  override var canBecomeKey: Bool { true }
  // WKWebView only renders an active insertion caret when its window may be
  // main. This still behaves as a floating panel; it simply gives focused text
  // fields the normal macOS editing presentation.
  override var canBecomeMain: Bool { true }

  var hasResizeSession: Bool { resizeSession != nil }

  func cancelResizeSession() {
    guard resizeSession != nil else { return }
    resizeSession = nil
    invalidateShadow()
  }

  override func sendEvent(_ event: NSEvent) {
    // A resize gesture is valid only while Commander is receiving its drag
    // stream. Keyboard actions such as selecting an emoji with Return can
    // arrive after a matching mouse-up was missed, so never let a stale resize
    // session survive any non-drag input.
    if resizeSession != nil, event.type != .leftMouseDragged {
      let consumedMouseUp = event.type == .leftMouseUp
      cancelResizeSession()
      if consumedMouseUp { return }
    }

    switch event.type {
    case .leftMouseDown:
      cancelResizeSession()
      guard usesCustomWindowResizeHandling, styleMask.contains(.resizable) else { break }
      let mouseLocation = convertPoint(toScreen: event.locationInWindow)
      let edges = CommanderWebView.resizeEdges(
        at: mouseLocation,
        frame: frame.insetBy(
          dx: resizeSurfaceInset,
          dy: resizeSurfaceInset
        ),
        handleWidth: CommanderWebView.resizeHandleWidth
      )
      if !edges.isEmpty {
        resizeSession = (edges, frame, mouseLocation)
        return
      }
    case .leftMouseDragged:
      guard usesCustomWindowResizeHandling, let resizeSession else { break }
      setFrame(
        CommanderWebView.resizedFrame(
          from: resizeSession.frame,
          edges: resizeSession.edges,
          startingMouseLocation: resizeSession.mouseLocation,
          mouseLocation: convertPoint(toScreen: event.locationInWindow),
          minimumSize: minSize
        ),
        display: true
      )
      invalidateShadow()
      return
    case .leftMouseUp:
      break
    default: break
    }
    super.sendEvent(event)
  }

  override func performDrag(with event: NSEvent) {
    // The web UI's draggable regions use AppKit's drag loop. It must never
    // inherit an earlier edge-resize session.
    cancelResizeSession()
    super.performDrag(with: event)
  }

  override func resignKey() {
    cancelResizeSession()
    super.resignKey()
  }

  override func cancelOperation(_ sender: Any?) {
    cancelResizeSession()
    super.cancelOperation(sender)
  }

  override func orderOut(_ sender: Any?) {
    cancelResizeSession()
    super.orderOut(sender)
  }

  override func close() {
    cancelResizeSession()
    super.close()
  }
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

  var minimumSize: NSSize {
    switch self {
    case .standard: NSSize(width: 520, height: 300)
    case .compact: NSSize(width: 480, height: 240)
    }
  }
}

@MainActor
final class LauncherPanelController: NSObject, NSWindowDelegate {
  private static let launcherOpenedScript =
    "window.dispatchEvent(new CustomEvent('commander:launcher-opened'))"
  private let panel: CommanderPanel
  private let webView: CommanderWebView
  let id: UUID
  var didBecomeKey: ((UUID) -> Void)?
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
  private var requestedScreen: NSScreen?
  private(set) var isPinned: Bool
  private var pinningEnabled: Bool

  init(
    id: UUID = UUID(),
    ready: DaemonReady,
    bridge: CommanderNativeBridge,
    pinned: Bool = false,
    pinningEnabled: Bool = true
  ) {
    let panel = CommanderPanel(
      contentRect: NSRect(origin: .zero, size: LauncherWindowMode.standard.size),
      styleMask: [.borderless, .nonactivatingPanel, .resizable, .fullSizeContentView],
      backing: .buffered,
      defer: false
    )
    self.id = id
    self.panel = panel
    self.webView = CommanderWebView(ready: ready, surface: "launcher", bridge: bridge)
    self.isPinned = pinningEnabled && pinned
    self.pinningEnabled = pinningEnabled
    super.init()
    panel.delegate = self
    panel.level = .statusBar
    panel.collectionBehavior = Self.collectionBehavior(pinned: self.isPinned)
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = true
    panel.isMovableByWindowBackground = true
    // A nonactivating panel can be automatically hidden while AppKit still reports
    // it as visible. Commander owns dismissal through windowDidResignKey instead.
    panel.hidesOnDeactivate = false
    panel.animationBehavior = .utilityWindow
    panel.minSize = LauncherWindowMode.standard.minimumSize
    panel.contentView = webView
    panel.contentView?.wantsLayer = true
    panel.contentView?.layer?.backgroundColor = NSColor.clear.cgColor
    panel.contentView?.superview?.wantsLayer = true
    panel.contentView?.superview?.layer?.backgroundColor = NSColor.clear.cgColor
    webView.frame = NSRect(origin: .zero, size: LauncherWindowMode.standard.size)
    webView.autoresizingMask = [.width, .height]
    webView.maskToSurface(inset: CommanderWebView.launcherSurfaceInset, cornerRadius: 19)
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

  func show(on screen: NSScreen? = nil) {
    requestedScreen = screen
    requestShow(commandItemID: nil)
  }

  func focus() {
    guard contentReady else {
      show()
      return
    }
    present(reposition: false)
  }

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
    present(reposition: true)
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

  private func present(reposition: Bool) {
    isPresented = true
    if reposition { center(on: requestedScreen) }
    requestedScreen = nil
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
    panel.cancelResizeSession()
    panel.orderOut(nil)
  }

  var pasteTargetName: String? {
    guard let pasteTarget, !pasteTarget.isTerminated else { return nil }
    return pasteTarget.localizedName
  }

  func paste(_ text: String, preserveClipboard: Bool) async -> [String: Any] {
    let previousClipboard = preserveClipboard ? PasteboardSnapshot.capture() : nil
    NSPasteboard.general.clearContents()
    let wrotePasteValue = NSPasteboard.general.setString(text, forType: .string)
    var result: [String: Any] = [
      "copied": wrotePasteValue && !preserveClipboard,
      "pasted": false,
      "requiresAccessibility": false,
    ]
    if let pasteTargetName { result["targetApplication"] = pasteTargetName }
    guard wrotePasteValue else {
      previousClipboard?.restore()
      return result
    }
    guard AXIsProcessTrusted() else {
      result["requiresAccessibility"] = true
      previousClipboard?.restore()
      return result
    }
    guard let pasteTarget, !pasteTarget.isTerminated else {
      previousClipboard?.restore()
      return result
    }

    hide()
    _ = pasteTarget.activate(options: [.activateAllWindows])
    try? await Task.sleep(for: .milliseconds(120))

    guard let source = CGEventSource(stateID: .hidSystemState),
          let keyDown = CGEvent(keyboardEventSource: source, virtualKey: 0x09, keyDown: true),
          let keyUp = CGEvent(keyboardEventSource: source, virtualKey: 0x09, keyDown: false) else {
      previousClipboard?.restore()
      return result
    }
    keyDown.flags = .maskCommand
    keyUp.flags = .maskCommand
    keyDown.post(tap: .cghidEventTap)
    keyUp.post(tap: .cghidEventTap)
    result["pasted"] = true
    if let previousClipboard {
      try? await Task.sleep(for: .milliseconds(180))
      previousClipboard.restore()
    }
    return result
  }
  func toggle() {
    if NSApp.isHidden {
      show()
    } else if isPinned && isPresented && panel.isVisible {
      focus()
    } else if (isPresented && panel.isVisible) || pendingShow || showPending {
      hide()
    } else {
      show()
    }
  }

  func setPinning(enabled: Bool, pinned: Bool? = nil) {
    pinningEnabled = enabled
    isPinned = enabled && (pinned ?? isPinned)
    panel.collectionBehavior = Self.collectionBehavior(pinned: isPinned)
    dispatchWindowState()
  }

  @discardableResult
  func setPinned(_ pinned: Bool) -> [String: Any] {
    isPinned = pinningEnabled && pinned
    panel.collectionBehavior = Self.collectionBehavior(pinned: isPinned)
    dispatchWindowState()
    return statePayload
  }

  var statePayload: [String: Any] {
    [
      "windowId": id.uuidString.lowercased(),
      "pinned": isPinned,
      "pinningEnabled": pinningEnabled,
    ]
  }

  var isVisible: Bool { panel.isVisible && isPresented }

  var screenNumber: NSNumber? {
    let screen = panel.screen ?? NSScreen.screens.max { left, right in
      NSIntersectionRect(left.frame, panel.frame).width * NSIntersectionRect(left.frame, panel.frame).height
        < NSIntersectionRect(right.frame, panel.frame).width * NSIntersectionRect(right.frame, panel.frame).height
    }
    return screen?.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber
  }

  func setWindowMode(_ mode: LauncherWindowMode) {
    guard mode != windowMode else { return }
    windowMode = mode
    panel.minSize = mode.minimumSize
    let surfaceInset: CGFloat = mode == .compact ? 12 : CommanderWebView.launcherSurfaceInset
    panel.resizeSurfaceInset = surfaceInset
    webView.maskToSurface(inset: surfaceInset, cornerRadius: 19)
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

  func setCustomWindowResizeHandling(_ enabled: Bool) {
    panel.usesCustomWindowResizeHandling = enabled
    webView.usesCustomWindowResizeHandling = enabled
  }

  func shutdown() {
    hide()
    commandPresentationFallback?.cancel()
    webView.firstPresentationReady = nil
    webView.shutdown()
    panel.delegate = nil
  }

  func windowDidResignKey(_ notification: Notification) {
    panel.cancelResizeSession()
    guard !fileDragInProgress else { return }
    guard !isPinned else { return }
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

  func windowDidBecomeKey(_ notification: Notification) {
    panel.cancelResizeSession()
    didBecomeKey?(id)
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
  var customWindowResizeHandlingEnabledForTesting: Bool {
    panel.usesCustomWindowResizeHandling && webView.usesCustomWindowResizeHandling
  }
  var resizeSessionActiveForTesting: Bool { panel.hasResizeSession }
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
      if !isPinned { hide() }
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

  private func center(on preferredScreen: NSScreen?) {
    let mouse = NSEvent.mouseLocation
    let screen = preferredScreen
      ?? NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) }
      ?? NSScreen.main
    guard let visible = screen?.visibleFrame else { return }
    let size = panel.frame.size
    let origin = NSPoint(x: visible.midX - size.width / 2, y: visible.maxY - size.height - min(100, visible.height * 0.12))
    panel.setFrameOrigin(origin)
    panel.invalidateShadow()
  }

  private func dispatchWindowState() {
    guard let data = try? JSONSerialization.data(withJSONObject: statePayload),
          let json = String(data: data, encoding: .utf8) else { return }
    webView.evaluateJavaScript(
      "window.dispatchEvent(new CustomEvent('commander:window-state',{detail:\(json)}))"
    )
  }

  private static func collectionBehavior(pinned: Bool) -> NSWindow.CollectionBehavior {
    var behavior: NSWindow.CollectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    if !pinned { behavior.insert(.transient) }
    return behavior
  }
}

private struct PasteboardSnapshot {
  let items: [[NSPasteboard.PasteboardType: Data]]

  static func capture() -> PasteboardSnapshot {
    let items = NSPasteboard.general.pasteboardItems?.map { item in
      Dictionary(uniqueKeysWithValues: item.types.compactMap { type in
        item.data(forType: type).map { (type, $0) }
      })
    } ?? []
    return PasteboardSnapshot(items: items)
  }

  func restore() {
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    let restored = items.map { values in
      let item = NSPasteboardItem()
      for (type, data) in values { item.setData(data, forType: type) }
      return item
    }
    if !restored.isEmpty { pasteboard.writeObjects(restored) }
  }
}
