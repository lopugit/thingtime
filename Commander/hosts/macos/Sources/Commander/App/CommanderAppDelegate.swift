import AppKit

@MainActor
final class CommanderAppDelegate: NSObject, NSApplicationDelegate {
  private static let launcherHotKeyIdentifier = "launcher"
  private let daemon = DaemonSupervisor()
  private let keychain = KeychainStore()
  private let loginItem = LaunchAtLoginService()
  private var launcher: LauncherPanelController?
  private var settings: SettingsWindowController?
  private var statusItem: CommanderStatusItem?
  private var hotKeyRegistry: GlobalHotKeyRegistry?
  private var hotKeyShortcut: String?
  private var commandHotKeyShortcuts: [String: String] = [:]
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
    launcher?.show()
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
        self.launcher?.show()
      case .failure(let error):
        self.presentStartupError(error)
      }
    }
  }

  private func buildWindows(ready: DaemonReady) {
    func makeBridge() -> CommanderNativeBridge {
      CommanderNativeBridge(
        ready: ready,
        keychain: keychain,
        loginItem: loginItem,
        showLauncher: { [weak self] in self?.launcher?.show() },
        hideLauncher: { [weak self] in self?.launcher?.hide() },
        commandHotKeyReady: { [weak self] itemID in
          self?.launcher?.commandHotKeyReady(itemID: itemID)
        },
        pasteClipboard: { [weak self] text in
          await self?.launcher?.paste(text) ?? [
            "copied": false,
            "pasted": false,
            "requiresAccessibility": false,
          ]
        },
        pasteTargetName: { [weak self] in self?.launcher?.pasteTargetName },
        showSettings: { [weak self] tab in self?.settings?.show(tab: tab) },
        updateHotKeys: { [weak self] launcherShortcut, commandShortcuts in
          try self?.updateHotKeys(
            launcherShortcut: launcherShortcut,
            commandShortcuts: commandShortcuts
          )
        },
        updateMenuBar: { [weak self] visible in self?.setMenuBarVisible(visible) },
        updateWindowMode: { [weak self] mode in try self?.setWindowMode(mode) }
      )
    }
    launcher = LauncherPanelController(ready: ready, bridge: makeBridge())
    settings = SettingsWindowController(ready: ready, bridge: makeBridge())
  }

  private func installMenuBar() {
    statusItem = CommanderStatusItem(
      open: { [weak self] in self?.launcher?.show() },
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
      if identifier == Self.launcherHotKeyIdentifier { launcher?.toggle() }
      else { launcher?.runCommandHotKey(itemID: identifier) }
    }
  }

  private func setWindowMode(_ rawValue: String) throws {
    guard let mode = LauncherWindowMode(rawValue: rawValue) else {
      throw CommanderHostError.invalidWindowMode(rawValue)
    }
    launcher?.setWindowMode(mode)
  }

  private func tearDownRuntime(stopDaemon: Bool) {
    launcher?.shutdown()
    settings?.shutdown()
    launcher = nil
    settings = nil
    statusItem?.remove()
    statusItem = nil
    hotKeyRegistry?.invalidate()
    hotKeyRegistry = nil
    hotKeyShortcut = nil
    commandHotKeyShortcuts = [:]
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

  var errorDescription: String? {
    switch self {
    case .invalidWindowMode(let value):
      "Unsupported Commander window mode: \(value)"
    }
  }
}
