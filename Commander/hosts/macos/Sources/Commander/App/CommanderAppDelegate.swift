import AppKit

@MainActor
final class CommanderAppDelegate: NSObject, NSApplicationDelegate {
  private let daemon = DaemonSupervisor()
  private let keychain = KeychainStore()
  private let loginItem = LaunchAtLoginService()
  private var launcher: LauncherPanelController?
  private var settings: SettingsWindowController?
  private var statusItem: CommanderStatusItem?
  private var hotKey: GlobalHotKey?
  private var hotKeyShortcut: String?
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
        showSettings: { [weak self] tab in self?.settings?.show(tab: tab) },
        updateHotKey: { [weak self] shortcut in try self?.installHotKey(shortcut: shortcut) },
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

  private func installHotKey(shortcut: String) throws {
    if hotKeyShortcut == shortcut, hotKey != nil { return }
    let previousShortcut = hotKeyShortcut
    hotKey?.invalidate()
    hotKey = nil
    do {
      hotKey = try GlobalHotKey(shortcut: shortcut) { [weak self] in self?.launcher?.toggle() }
      hotKeyShortcut = shortcut
    } catch {
      hotKey = nil
      hotKeyShortcut = nil
      if let previousShortcut {
        do {
          hotKey = try GlobalHotKey(shortcut: previousShortcut) { [weak self] in self?.launcher?.toggle() }
          hotKeyShortcut = previousShortcut
        } catch {
          NSLog("Commander could not restore previous hotkey %@: %@", previousShortcut, error.localizedDescription)
        }
      }
      throw error
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
    hotKey?.invalidate()
    hotKey = nil
    hotKeyShortcut = nil
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
