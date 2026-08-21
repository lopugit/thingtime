import AppKit

@MainActor
final class CommanderAppDelegate: NSObject, NSApplicationDelegate {
  private static let launcherHotKeyIdentifier = "launcher"
  private let daemon = DaemonSupervisor()
  private let keychain = KeychainStore()
  private let loginItem = LaunchAtLoginService()
  private var daemonReady: DaemonReady?
  private var launchers: [UUID: LauncherPanelController] = [:]
  private var launcherRecency: [UUID: UInt64] = [:]
  private var recencyCounter: UInt64 = 0
  private var settings: SettingsWindowController?
  private var statusItem: CommanderStatusItem?
  private var hotKeyRegistry: GlobalHotKeyRegistry?
  private var hotKeyShortcut: String?
  private var commandHotKeyShortcuts: [String: String] = [:]
  private var windowMode = LauncherWindowMode.standard
  private var pinningEnabled = true
  private var defaultPinned = false
  private var focusRecentOnCurrentDisplay = true
  private var hasAppliedWindowPinningSettings = false
  private var isTerminating = false

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.accessory)
    startDaemon()
  }

  func applicationWillTerminate(_ notification: Notification) {
    isTerminating = true
    tearDownRuntime(stopDaemon: true)
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    showMostRecentLauncher()
    return false
  }

  private func startDaemon() {
    daemon.start(onUnexpectedExit: { [weak self] error in
      self?.handleUnexpectedDaemonExit(error)
    }) { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let ready):
        guard self.daemon.isReadyAndRunning(pid: ready.pid) else { return }
        self.buildWindows(ready: ready)
        self.showMostRecentLauncher()
      case .failure(let error):
        self.presentStartupError(error)
      }
    }
  }

  private func buildWindows(ready: DaemonReady) {
    daemonReady = ready
    settings = SettingsWindowController(ready: ready, bridge: makeBridge(ready: ready, launcherID: nil))
    _ = try? createLauncher(show: false)
  }

  private func makeBridge(ready: DaemonReady, launcherID: UUID?) -> CommanderNativeBridge {
    CommanderNativeBridge(
      ready: ready,
      keychain: keychain,
      loginItem: loginItem,
      showLauncher: { [weak self] in self?.showLauncher(id: launcherID) },
      hideLauncher: { [weak self] in self?.launcher(id: launcherID)?.hide() },
      launcherState: { [weak self] in
        guard let self, let launcher = self.launcher(id: launcherID) else {
          throw CommanderHostError.launcherUnavailable
        }
        return launcher.statePayload
      },
      updateLauncherPin: { [weak self] pinned in
        guard let self else { throw CommanderHostError.launcherUnavailable }
        return try self.setLauncherPinned(id: launcherID, pinned: pinned)
      },
      openNewLauncherWindow: { [weak self] in
        guard let self else { throw CommanderHostError.launcherUnavailable }
        return try self.createLauncher(
          show: true,
          screen: self.activeScreen(),
          pinnedOverride: true
        ).statePayload
      },
      commandHotKeyReady: { [weak self] itemID in
        self?.launcher(id: launcherID)?.commandHotKeyReady(itemID: itemID)
      },
      pasteClipboard: { [weak self] text, preserveClipboard in
        await self?.launcher(id: launcherID)?.paste(text, preserveClipboard: preserveClipboard) ?? [
          "copied": false,
          "pasted": false,
          "requiresAccessibility": false,
        ]
      },
      pasteTargetName: { [weak self] in self?.launcher(id: launcherID)?.pasteTargetName },
      showSettings: { [weak self] tab in self?.settings?.show(tab: tab) },
      updateHotKeys: { [weak self] launcherShortcut, commandShortcuts in
        try self?.updateHotKeys(
          launcherShortcut: launcherShortcut,
          commandShortcuts: commandShortcuts
        )
      },
      updateMenuBar: { [weak self] visible in self?.setMenuBarVisible(visible) },
      updateWindowMode: { [weak self] mode in try self?.setWindowMode(mode) },
      updateWindowPinning: { [weak self] enabled, pinned, focusCurrentDisplay in
        self?.setWindowPinning(
          enabled: enabled,
          defaultPinned: pinned,
          focusRecentOnCurrentDisplay: focusCurrentDisplay
        )
      }
    )
  }

  private func createLauncher(
    show: Bool,
    screen: NSScreen? = nil,
    pinnedOverride: Bool? = nil
  ) throws -> LauncherPanelController {
    guard let ready = daemonReady else { throw CommanderHostError.launcherUnavailable }
    let id = UUID()
    let controller = LauncherPanelController(
      id: id,
      ready: ready,
      bridge: makeBridge(ready: ready, launcherID: id),
      pinned: Self.initialPinnedState(
        defaultPinned: defaultPinned,
        pinnedOverride: pinnedOverride
      ),
      pinningEnabled: pinningEnabled
    )
    controller.setWindowMode(windowMode)
    controller.didBecomeKey = { [weak self] id in self?.markRecent(id) }
    launchers[id] = controller
    markRecent(id)
    if show { controller.show(on: screen) }
    return controller
  }

  static func initialPinnedState(defaultPinned: Bool, pinnedOverride: Bool?) -> Bool {
    pinnedOverride ?? defaultPinned
  }

  private func launcher(id: UUID?) -> LauncherPanelController? {
    if let id, let launcher = launchers[id] { return launcher }
    return mostRecentLauncher()
  }

  private func mostRecentLauncher() -> LauncherPanelController? {
    let candidates: [LauncherPanelController]
    if focusRecentOnCurrentDisplay, let screenNumber = activeScreenNumber() {
      let sameScreen = launchers.values.filter { $0.screenNumber == screenNumber }
      candidates = sameScreen.isEmpty ? Array(launchers.values) : sameScreen
    } else {
      candidates = Array(launchers.values)
    }
    return candidates.max {
      (launcherRecency[$0.id] ?? 0) < (launcherRecency[$1.id] ?? 0)
    }
  }

  private func markRecent(_ id: UUID) {
    recencyCounter &+= 1
    launcherRecency[id] = recencyCounter
  }

  private func showLauncher(id: UUID?) {
    if let launcher = launcher(id: id) {
      markRecent(launcher.id)
      launcher.show(on: id == nil ? activeScreen() : nil)
      return
    }
    _ = try? createLauncher(show: true, screen: activeScreen())
  }

  private func showMostRecentLauncher() {
    guard let launcher = mostRecentLauncher() else {
      _ = try? createLauncher(show: true, screen: activeScreen())
      return
    }
    markRecent(launcher.id)
    if launcher.isPinned && launcher.isVisible { launcher.focus() }
    else { launcher.show(on: activeScreen()) }
  }

  private func toggleMostRecentLauncher() {
    guard let launcher = mostRecentLauncher() else {
      _ = try? createLauncher(show: true, screen: activeScreen())
      return
    }
    markRecent(launcher.id)
    if launcher.isPinned && launcher.isVisible { launcher.focus() }
    else { launcher.toggle() }
  }

  private func runCommandHotKey(itemID: String) {
    guard let launcher = mostRecentLauncher() else {
      guard let created = try? createLauncher(show: false) else { return }
      created.runCommandHotKey(itemID: itemID)
      return
    }
    markRecent(launcher.id)
    launcher.runCommandHotKey(itemID: itemID)
  }

  private func setLauncherPinned(id: UUID?, pinned: Bool) throws -> [String: Any] {
    guard pinningEnabled else { throw CommanderHostError.windowPinningDisabled }
    guard let launcher = launcher(id: id) else { throw CommanderHostError.launcherUnavailable }
    markRecent(launcher.id)
    return launcher.setPinned(pinned)
  }

  private func setWindowPinning(
    enabled: Bool,
    defaultPinned: Bool,
    focusRecentOnCurrentDisplay: Bool
  ) {
    let firstApplication = !hasAppliedWindowPinningSettings
    hasAppliedWindowPinningSettings = true
    pinningEnabled = enabled
    self.defaultPinned = defaultPinned
    self.focusRecentOnCurrentDisplay = focusRecentOnCurrentDisplay
    for launcher in launchers.values {
      launcher.setPinning(enabled: enabled, pinned: firstApplication ? defaultPinned : nil)
    }
  }

  private func installMenuBar() {
    statusItem = CommanderStatusItem(
      open: { [weak self] in self?.showMostRecentLauncher() },
      settings: { [weak self] in self?.settings?.show() }
    )
  }

  private func setMenuBarVisible(_ visible: Bool) {
    if visible, statusItem == nil { installMenuBar() }
    if !visible {
      statusItem?.remove()
      statusItem = nil
    }
  }

  private func updateHotKeys(
    launcherShortcut: String?,
    commandShortcuts: [String: String]?
  ) throws {
    let nextLauncherShortcut = launcherShortcut ?? hotKeyShortcut
    guard let nextLauncherShortcut, !nextLauncherShortcut.isEmpty else {
      throw HotKeyError.invalidShortcut(launcherShortcut ?? "")
    }
    let nextCommandShortcuts = commandShortcuts ?? commandHotKeyShortcuts
    guard nextCommandShortcuts[Self.launcherHotKeyIdentifier] == nil else {
      throw HotKeyError.invalidShortcut(Self.launcherHotKeyIdentifier)
    }
    if hotKeyShortcut == nextLauncherShortcut,
       commandHotKeyShortcuts == nextCommandShortcuts,
       hotKeyRegistry != nil { return }

    let previousLauncherShortcut = hotKeyShortcut
    let previousCommandShortcuts = commandHotKeyShortcuts
    hotKeyRegistry?.invalidate()
    hotKeyRegistry = nil
    do {
      hotKeyRegistry = try makeHotKeyRegistry(
        launcherShortcut: nextLauncherShortcut,
        commandShortcuts: nextCommandShortcuts
      )
      hotKeyShortcut = nextLauncherShortcut
      commandHotKeyShortcuts = nextCommandShortcuts
    } catch {
      hotKeyRegistry = nil
      do {
        hotKeyRegistry = try makeHotKeyRegistry(
          launcherShortcut: previousLauncherShortcut,
          commandShortcuts: previousCommandShortcuts
        )
        hotKeyShortcut = previousLauncherShortcut
        commandHotKeyShortcuts = previousCommandShortcuts
      } catch {
        hotKeyShortcut = nil
        commandHotKeyShortcuts = [:]
        NSLog("Commander could not restore its previous hotkeys: %@", error.localizedDescription)
      }
      throw error
    }
  }

  private func makeHotKeyRegistry(
    launcherShortcut: String?,
    commandShortcuts: [String: String]
  ) throws -> GlobalHotKeyRegistry? {
    var shortcuts = commandShortcuts
    if let launcherShortcut { shortcuts[Self.launcherHotKeyIdentifier] = launcherShortcut }
    guard !shortcuts.isEmpty else { return nil }
    return try GlobalHotKeyRegistry(shortcuts: shortcuts) { [weak self] identifier in
      guard let self else { return }
      if identifier == Self.launcherHotKeyIdentifier { toggleMostRecentLauncher() }
      else { runCommandHotKey(itemID: identifier) }
    }
  }

  private func setWindowMode(_ rawValue: String) throws {
    guard let mode = LauncherWindowMode(rawValue: rawValue) else {
      throw CommanderHostError.invalidWindowMode(rawValue)
    }
    windowMode = mode
    for launcher in launchers.values { launcher.setWindowMode(mode) }
  }

  private func activeScreen() -> NSScreen? {
    let mouse = NSEvent.mouseLocation
    return NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main
  }

  private func activeScreenNumber() -> NSNumber? {
    activeScreen()?.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber
  }

  private func tearDownRuntime(stopDaemon: Bool) {
    for launcher in launchers.values { launcher.shutdown() }
    settings?.shutdown()
    launchers.removeAll()
    launcherRecency.removeAll()
    settings = nil
    daemonReady = nil
    statusItem?.remove()
    statusItem = nil
    hotKeyRegistry?.invalidate()
    hotKeyRegistry = nil
    hotKeyShortcut = nil
    commandHotKeyShortcuts = [:]
    hasAppliedWindowPinningSettings = false
    if stopDaemon { daemon.stop() }
  }

  private func handleUnexpectedDaemonExit(_ error: DaemonError) {
    guard !isTerminating else { return }
    tearDownRuntime(stopDaemon: false)
    presentServiceError(error)
  }

  private func presentStartupError(_ error: Error) {
    NSApp.setActivationPolicy(.regular)
    NSApp.activate(ignoringOtherApps: true)
    let alert = NSAlert()
    alert.alertStyle = .critical
    alert.messageText = "Commander could not start"
    alert.informativeText = error.localizedDescription
    alert.addButton(withTitle: "Try Again")
    alert.addButton(withTitle: "Quit")
    if alert.runModal() == .alertFirstButtonReturn {
      NSApp.setActivationPolicy(.accessory)
      startDaemon()
    } else {
      NSApp.terminate(nil)
    }
  }

  private func presentServiceError(_ error: Error) {
    NSApp.setActivationPolicy(.regular)
    NSApp.activate(ignoringOtherApps: true)
    let alert = NSAlert()
    alert.alertStyle = .critical
    alert.messageText = "Commander’s service stopped"
    alert.informativeText = error.localizedDescription
    alert.addButton(withTitle: "Relaunch Service")
    alert.addButton(withTitle: "Quit")
    if alert.runModal() == .alertFirstButtonReturn {
      NSApp.setActivationPolicy(.accessory)
      startDaemon()
    } else {
      NSApp.terminate(nil)
    }
  }
}

private enum CommanderHostError: LocalizedError {
  case invalidWindowMode(String)
  case launcherUnavailable
  case windowPinningDisabled

  var errorDescription: String? {
    switch self {
    case .invalidWindowMode(let value):
      "Unsupported Commander window mode: \(value)"
    case .launcherUnavailable:
      "The Commander launcher window is unavailable."
    case .windowPinningDisabled:
      "Window pinning is disabled in Commander Settings."
    }
  }
}
