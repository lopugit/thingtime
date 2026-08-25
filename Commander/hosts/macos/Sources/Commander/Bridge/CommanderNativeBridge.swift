import AppKit
import UniformTypeIdentifiers
import UserNotifications
import WebKit

private struct BridgeRequest: Decodable {
  let id: String
  let method: String
  let params: [String: JSONValue]?
}

private enum JSONValue: Decodable {
  case string(String), bool(Bool), number(Double), object([String: JSONValue]), array([JSONValue]), null

  init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() { self = .null }
    else if let value = try? container.decode(String.self) { self = .string(value) }
    else if let value = try? container.decode(Bool.self) { self = .bool(value) }
    else if let value = try? container.decode(Double.self) { self = .number(value) }
    else if let value = try? container.decode([String: JSONValue].self) { self = .object(value) }
    else { self = .array(try container.decode([JSONValue].self)) }
  }

  var string: String? { if case .string(let value) = self { value } else { nil } }
  var bool: Bool? { if case .bool(let value) = self { value } else { nil } }
  var pid: pid_t? {
    guard case .number(let value) = self,
          value.isFinite,
          value.rounded() == value,
          value > 1,
          value <= Double(Int32.max) else { return nil }
    return pid_t(value)
  }
  var object: [String: JSONValue]? { if case .object(let value) = self { value } else { nil } }
  var array: [JSONValue]? { if case .array(let value) = self { value } else { nil } }
}

/// Submits application launches to Launch Services without waiting for its XPC reply on
/// Commander's main actor. Launch Services can occasionally take an unbounded time to
/// resolve a handler, but that must never make the launcher stop responding.
@MainActor
final class CommanderApplicationOpener {
  typealias OpenURL = (URL, NSWorkspace.OpenConfiguration, @escaping @Sendable (NSRunningApplication?, Error?) -> Void) -> Void

  private let openURL: OpenURL

  init(openURL: @escaping OpenURL = { url, configuration, completionHandler in
    NSWorkspace.shared.open(url, configuration: configuration, completionHandler: completionHandler)
  }) {
    self.openURL = openURL
  }

  func submit(_ url: URL) {
    let configuration = NSWorkspace.OpenConfiguration()
    configuration.activates = true
    openURL(url, configuration) { _, error in
      guard let error else { return }
      NSLog("Commander could not complete an application launch: \(error.localizedDescription)")
    }
  }
}

@MainActor
final class CommanderNativeBridge: NSObject, WKScriptMessageHandler, UNUserNotificationCenterDelegate {
  private static let maximumMessageBytes = 1024 * 1024
  private let keychain: KeychainStore
  private let loginItem: LaunchAtLoginService
  private let daemonURL: URL
  private let nativeToken: String
  private let showLauncher: () -> Void
  private let hideLauncher: () -> Void
  private let launcherState: () throws -> [String: Any]
  private let updateLauncherPin: (Bool) throws -> [String: Any]
  private let openNewLauncherWindow: () throws -> [String: Any]
  private let commandHotKeyReady: (String) -> Void
  private let pasteClipboard: (String, Bool) async -> [String: Any]
  private let pasteTargetName: () -> String?
  private let showSettings: (CommanderSettingsTab?) -> Void
  private let updateHotKeys: (String?, [String: String]?) throws -> Void
  private let updateMenuBar: (Bool) -> Void
  private let updateWindowMode: (String) throws -> Void
  private let updateCustomWindowResizeHandling: (Bool) -> Void
  private let updateWindowPinning: (Bool, Bool, Bool) -> Void
  private let metrics: SystemMetricsService
  private let applicationResponsiveness: ApplicationResponsivenessService
  private let applicationOpener: CommanderApplicationOpener
  private let unresponsiveApplicationController: UnresponsiveApplicationController
  private let fileIconRequests = CommanderFileIconRequestQueue()
  weak var webView: WKWebView?

  init(
    ready: DaemonReady,
    keychain: KeychainStore,
    loginItem: LaunchAtLoginService,
    showLauncher: @escaping () -> Void,
    hideLauncher: @escaping () -> Void,
    launcherState: @escaping () throws -> [String: Any] = {
      ["windowId": "default", "pinned": false, "pinningEnabled": false]
    },
    updateLauncherPin: @escaping (Bool) throws -> [String: Any] = { _ in
      ["windowId": "default", "pinned": false, "pinningEnabled": false]
    },
    openNewLauncherWindow: @escaping () throws -> [String: Any] = {
      ["windowId": "default", "pinned": false, "pinningEnabled": false]
    },
    commandHotKeyReady: @escaping (String) -> Void = { _ in },
    pasteClipboard: @escaping (String, Bool) async -> [String: Any] = { _, _ in
      ["copied": false, "pasted": false, "requiresAccessibility": false]
    },
    pasteTargetName: @escaping () -> String? = { nil },
    showSettings: @escaping (CommanderSettingsTab?) -> Void,
    updateHotKeys: @escaping (String?, [String: String]?) throws -> Void,
    updateMenuBar: @escaping (Bool) -> Void,
    updateWindowMode: @escaping (String) throws -> Void,
    updateCustomWindowResizeHandling: @escaping (Bool) -> Void = { _ in },
    updateWindowPinning: @escaping (Bool, Bool, Bool) -> Void = { _, _, _ in },
    applicationOpener: CommanderApplicationOpener = CommanderApplicationOpener()
  ) {
    self.daemonURL = URL(string: ready.url)!
    self.nativeToken = ready.nativeToken
    self.keychain = keychain
    self.loginItem = loginItem
    self.showLauncher = showLauncher
    self.hideLauncher = hideLauncher
    self.launcherState = launcherState
    self.updateLauncherPin = updateLauncherPin
    self.openNewLauncherWindow = openNewLauncherWindow
    self.commandHotKeyReady = commandHotKeyReady
    self.pasteClipboard = pasteClipboard
    self.pasteTargetName = pasteTargetName
    self.showSettings = showSettings
    self.updateHotKeys = updateHotKeys
    self.updateMenuBar = updateMenuBar
    self.updateWindowMode = updateWindowMode
    self.updateCustomWindowResizeHandling = updateCustomWindowResizeHandling
    self.updateWindowPinning = updateWindowPinning
    self.applicationOpener = applicationOpener
    let applicationResponsiveness = ApplicationResponsivenessService()
    self.applicationResponsiveness = applicationResponsiveness
    self.metrics = SystemMetricsService(
      daemonPID: ready.pid,
      applicationResponsiveness: applicationResponsiveness
    )
    self.unresponsiveApplicationController = UnresponsiveApplicationController(
      responsiveness: applicationResponsiveness,
      submitLaunch: { applicationOpener.submit($0) }
    )
    super.init()
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    let requestID = (message.body as? [String: Any])?["id"] as? String
    guard message.frameInfo.isMainFrame,
          message.frameInfo.request.url?.commanderExactOrigin == daemonURL.commanderExactOrigin else {
      NSLog("Commander rejected a native bridge request outside the pinned daemon origin.")
      return
    }
    guard JSONSerialization.isValidJSONObject(message.body),
          let data = try? JSONSerialization.data(withJSONObject: message.body) else {
      replyIfPossible(id: requestID, error: "The native request is not valid JSON.")
      return
    }
    guard data.count <= Self.maximumMessageBytes else {
      replyIfPossible(id: requestID, error: "The native request exceeds Commander’s 1 MiB limit.")
      return
    }
    do {
      let request = try JSONDecoder().decode(BridgeRequest.self, from: data)
      if request.method == "window.beginDrag" {
        beginWindowDrag(requestID: request.id)
        return
      }
      if request.method == "filesystem.beginDrag" {
        beginFileDrag(request)
        return
      }
      Task { @MainActor in await self.handle(request) }
    } catch {
      replyIfPossible(id: requestID, error: "The native request is malformed: \(error.localizedDescription)")
    }
  }

  private func beginWindowDrag(requestID: String) {
    guard let window = webView?.window,
          let event = NSApp.currentEvent,
          event.type == .leftMouseDown else {
      reply(id: requestID, ok: false, result: nil, error: "The Commander window cannot begin dragging from this event.")
      return
    }
    reply(id: requestID, ok: true, result: nil, error: nil)
    window.performDrag(with: event)
  }

  private func beginFileDrag(_ request: BridgeRequest) {
    guard let path = request.params?["path"]?.string else {
      reply(id: request.id, ok: false, result: nil, error: BridgeError.missing("path").localizedDescription)
      return
    }
    guard let webView = webView as? CommanderWebView else {
      reply(
        id: request.id,
        ok: false,
        result: nil,
        error: "The Commander drag source is unavailable."
      )
      return
    }
    do {
      try webView.prepareFileDrag(path: path)
      reply(id: request.id, ok: true, result: ["prepared": true], error: nil)
    } catch {
      reply(id: request.id, ok: false, result: nil, error: error.localizedDescription)
    }
  }

  private func handle(_ request: BridgeRequest) async {
    do {
      let result: Any?
      switch request.method {
      case "launcher.hide": hideLauncher(); result = nil
      case "launcher.show": showLauncher(); result = nil
      case "launcher.state": result = try launcherState()
      case "launcher.pin":
        guard let pinned = request.params?["pinned"]?.bool else { throw BridgeError.missing("pinned") }
        result = try updateLauncherPin(pinned)
      case "launcher.openNewWindow": result = try openNewLauncherWindow()
      case "launcher.commandReady":
        guard let itemID = request.params?["itemId"]?.string,
              itemID.hasPrefix("extension:"),
              itemID.count <= 512 else { throw BridgeError.missing("itemId") }
        commandHotKeyReady(itemID); result = ["ready": true]
      case "application.quit": result = ["terminating": true]
      case "settings.open":
        let requestedTab: CommanderSettingsTab?
        if let rawTab = request.params?["tab"]?.string {
          guard let tab = CommanderSettingsTab(rawValue: rawTab) else {
            throw BridgeError.invalidSettingsTab(rawTab)
          }
          requestedTab = tab
        } else {
          requestedTab = nil
        }
        showSettings(requestedTab); result = nil
      case "application.open":
        guard let raw = request.params?["path"]?.string else { throw BridgeError.missing("path") }
        guard let url = URL(string: raw), url.scheme != nil || raw.hasPrefix("/") else { throw BridgeError.invalidURL }
        applicationOpener.submit(url.scheme != nil ? url : URL(fileURLWithPath: raw))
        result = ["submitted": true]
      case "application.control":
        guard let pid = request.params?["pid"]?.pid,
              let actionName = request.params?["action"]?.string,
              let action = ApplicationControlAction(rawValue: actionName) else {
          throw BridgeError.invalidApplicationControl
        }
        result = try unresponsiveApplicationController.perform(pid: pid, action: action)
      case "application.pasteTarget":
        result = pasteTargetName().map { ["name": $0] } ?? [:]
      case "filesystem.reveal":
        guard let raw = request.params?["path"]?.string else { throw BridgeError.missing("path") }
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: raw)]); result = nil
      case "filesystem.icon":
        guard let path = request.params?["path"]?.string else { throw BridgeError.missing("path") }
        result = ["dataUrl": try await fileIconRequests.dataURL(for: path)]
      case "filesystem.copy":
        guard let path = request.params?["path"]?.string else { throw BridgeError.missing("path") }
        let url = try CommanderWebView.validatedFileURL(for: path)
        NSPasteboard.general.clearContents()
        guard NSPasteboard.general.writeObjects([url as NSURL]) else { throw BridgeError.pasteboardWrite }
        result = ["copied": true]
      case "filesystem.trash":
        guard let path = request.params?["path"]?.string else { throw BridgeError.missing("path") }
        let url = try CommanderWebView.validatedDestructiveFileURL(for: path)
        var destination: NSURL?
        try FileManager.default.trashItem(at: url, resultingItemURL: &destination)
        result = ["trashed": true]
      case "filesystem.delete":
        guard let path = request.params?["path"]?.string else { throw BridgeError.missing("path") }
        let url = try CommanderWebView.validatedDestructiveFileURL(for: path)
        let confirmation = NSAlert()
        confirmation.alertStyle = .critical
        confirmation.messageText = "Delete \(url.lastPathComponent) immediately?"
        confirmation.informativeText = "This cannot be undone. Move the item to Trash instead if you may need it later."
        confirmation.addButton(withTitle: "Cancel")
        confirmation.addButton(withTitle: "Delete Immediately")
        guard confirmation.runModal() == .alertSecondButtonReturn else {
          result = ["deleted": false]
          break
        }
        try FileManager.default.removeItem(at: url)
        result = ["deleted": true]
      case "system.metrics": result = metrics.snapshot()
      case "permission.fullDiskAccess": result = ["granted": FullDiskAccessService.isGranted]
      case "notification.show":
        guard let id = request.params?["id"]?.string,
              let title = request.params?["title"]?.string,
              let body = request.params?["body"]?.string,
              !id.isEmpty,
              id.count <= 256,
              !title.isEmpty,
              title.count <= 160,
              body.count <= 1_024 else { throw BridgeError.invalidNotification }
        try await showNotification(id: id, title: title, body: body)
        result = ["shown": true]
      case "clipboard.write":
        guard let text = request.params?["text"]?.string else { throw BridgeError.missing("text") }
        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(text, forType: .string); result = nil
      case "clipboard.paste":
        guard let text = request.params?["text"]?.string else { throw BridgeError.missing("text") }
        result = await pasteClipboard(text, request.params?["preserveClipboard"]?.bool ?? false)
      case "extension.choose": result = chooseExtensionFolder()
      case "hotkey.update":
        guard let shortcut = request.params?["shortcut"]?.string else { throw BridgeError.missing("shortcut") }
        try updateHotKeys(shortcut, nil); result = ["registered": true]
      case "commandHotkeys.update":
        let shortcuts = try decodeCommandShortcuts(request.params?["shortcuts"])
        try updateHotKeys(nil, shortcuts); result = ["registered": true]
      case "loginItem.update":
        guard let enabled = request.params?["enabled"]?.bool else { throw BridgeError.missing("enabled") }
        try loginItem.update(enabled: enabled); result = nil
      case "menuBar.update":
        guard let enabled = request.params?["enabled"]?.bool else { throw BridgeError.missing("enabled") }
        updateMenuBar(enabled); result = nil
      case "settings.applyNative":
        guard let shortcut = request.params?["hotkey"]?.string,
              let openAtLogin = request.params?["openAtLogin"]?.bool,
              let showMenuBarIcon = request.params?["showMenuBarIcon"]?.bool,
              let windowMode = request.params?["windowMode"]?.string,
              let windowPinning = request.params?["windowPinning"]?.object,
              let pinningEnabled = windowPinning["enabled"]?.bool,
              let defaultPinned = windowPinning["defaultPinned"]?.bool,
              let focusRecentOnCurrentDisplay = windowPinning["focusRecentOnCurrentDisplay"]?.bool else {
          throw BridgeError.missing("native settings")
        }
        let commandShortcuts = try decodeCommandShortcuts(request.params?["commandShortcuts"])
        try loginItem.update(enabled: openAtLogin)
        updateMenuBar(showMenuBarIcon)
        try updateWindowMode(windowMode)
        updateCustomWindowResizeHandling(request.params?["useCustomWindowResizeHandling"]?.bool ?? true)
        updateWindowPinning(pinningEnabled, defaultPinned, focusRecentOnCurrentDisplay)
        try updateHotKeys(shortcut, commandShortcuts)
        result = ["applied": true]
      case "credential.claim":
        let key = try credentialKey(request)
        let accountID = key.accountID
        let token = try await claimCredential(accountID: accountID)
        try keychain.store(token: token, issuer: key.issuer, clientID: key.clientID, accountID: accountID)
        try await acknowledgeCredential(accountID: accountID)
        result = nil
      case "credential.unlock":
        let key = try credentialKey(request)
        guard let token = try keychain.read(issuer: key.issuer, clientID: key.clientID, accountID: key.accountID) else { throw BridgeError.credentialMissing }
        try await unlockCredential(accountID: key.accountID, token: token)
        result = nil
      case "credential.delete":
        let key = try credentialKey(request)
        try keychain.delete(issuer: key.issuer, clientID: key.clientID, accountID: key.accountID); result = nil
      case "credential.environments":
        guard let values = request.params?["accountIds"]?.array,
              !values.isEmpty,
              values.count <= 64 else { throw BridgeError.missing("accountIds") }
        let accountIDs = try Set(values.map { value -> String in
          guard let accountID = value.string,
                !accountID.isEmpty,
                accountID.count <= 256 else { throw BridgeError.missing("accountIds") }
          return accountID
        })
        let environments = try keychain.environments(for: accountIDs)
        result = ["environments": environments.map { environment in
          [
            "accountId": environment.accountID,
            "baseUrl": environment.issuer,
            "clientId": environment.clientID,
          ]
        }]
      default: throw BridgeError.unknownMethod(request.method)
      }
      reply(id: request.id, ok: true, result: result, error: nil)
      if request.method == "application.quit" { NSApp.terminate(nil) }
    } catch {
      reply(id: request.id, ok: false, result: nil, error: error.localizedDescription)
    }
  }

  private func credentialKey(_ request: BridgeRequest) throws -> (issuer: String, clientID: String, accountID: String) {
    guard let issuer = request.params?["issuer"]?.string,
          let clientID = request.params?["clientId"]?.string,
          let accountID = request.params?["accountId"]?.string,
          !issuer.isEmpty, !clientID.isEmpty, !accountID.isEmpty else { throw BridgeError.missing("issuer/clientId/accountId") }
    return (issuer, clientID, accountID)
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    completionHandler([.banner, .sound])
  }

  private func showNotification(id: String, title: String, body: String) async throws {
    let center = UNUserNotificationCenter.current()
    center.delegate = self
    var settings = await center.notificationSettings()
    if settings.authorizationStatus == .notDetermined {
      let granted = try await center.requestAuthorization(options: [.alert, .sound])
      guard granted else { throw BridgeError.notificationsDenied }
      settings = await center.notificationSettings()
    }
    guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else {
      throw BridgeError.notificationsDenied
    }
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    content.sound = .default
    try await center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
  }

  private func decodeCommandShortcuts(_ value: JSONValue?) throws -> [String: String] {
    guard let object = value?.object else { throw BridgeError.missing("command shortcuts") }
    guard object.count <= 256 else { throw BridgeError.invalidCommandShortcuts }
    var shortcuts: [String: String] = [:]
    for (itemID, value) in object {
      guard itemID.hasPrefix("extension:"),
            itemID.count <= 512,
            let shortcut = value.string,
            !shortcut.isEmpty,
            shortcut.count <= 128 else { throw BridgeError.invalidCommandShortcuts }
      shortcuts[itemID] = shortcut
    }
    return shortcuts
  }

  private func claimCredential(accountID: String) async throws -> String {
    let body = try await daemonRequest(path: "/api/native/credentials/claim", method: "POST", body: ["accountId": accountID])
    guard let token = body["token"] as? String, !token.isEmpty else { throw BridgeError.invalidDaemonResponse }
    return token
  }

  private func unlockCredential(accountID: String, token: String) async throws {
    _ = try await daemonRequest(path: "/api/native/credentials", method: "PUT", body: ["accountId": accountID, "token": token])
  }

  private func acknowledgeCredential(accountID: String) async throws {
    _ = try await daemonRequest(path: "/api/native/credentials/ack", method: "POST", body: ["accountId": accountID])
  }

  private func daemonRequest(path: String, method: String, body: [String: String]) async throws -> [String: Any] {
    var request = URLRequest(url: daemonURL.appendingPathComponent(path))
    request.httpMethod = method
    request.timeoutInterval = 10
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(nativeToken, forHTTPHeaderField: "X-Commander-Native")
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse else { throw BridgeError.invalidDaemonResponse }
    guard data.count <= Self.maximumMessageBytes else { throw BridgeError.responseTooLarge }
    let value = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    guard (200..<300).contains(http.statusCode) else {
      throw BridgeError.daemon(value?["error"] as? String ?? "Commander service request failed")
    }
    guard let value else { throw BridgeError.invalidDaemonResponse }
    return value
  }

  private func chooseExtensionFolder() -> [String: Any]? {
    let warning = NSAlert()
    warning.alertStyle = .warning
    warning.messageText = "Only sideload extensions you trust"
    warning.informativeText = "Commander can inspect an extension without running its build script. Building or running Raycast extension code uses your Commander and Node user privileges, including filesystem and network access."
    warning.addButton(withTitle: "Cancel")
    warning.addButton(withTitle: "Inspect Only")
    warning.addButton(withTitle: "Build & Add…")
    let consent = warning.runModal()
    guard consent != .alertFirstButtonReturn else { return nil }

    let panel = NSOpenPanel()
    panel.title = "Choose a Raycast Extension Folder or ZIP"
    panel.prompt = "Sideload"
    panel.canChooseDirectories = true
    panel.canChooseFiles = true
    panel.allowedContentTypes = [.zip]
    panel.treatsFilePackagesAsDirectories = false
    panel.allowsMultipleSelection = false
    return panel.runModal() == .OK ? panel.url.map {
      ["path": $0.path, "allowUntrustedBuildScripts": consent == .alertThirdButtonReturn]
    } : nil
  }

  private func replyIfPossible(id: String?, error: String) {
    guard let id, !id.isEmpty else { return }
    reply(id: id, ok: false, result: nil, error: error)
  }

  private func reply(id: String, ok: Bool, result: Any?, error: String?) {
    var payload: [String: Any] = ["id": id, "ok": ok]
    if let result { payload["result"] = result }
    if let error { payload["error"] = error }
    guard let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) else { return }
    webView?.evaluateJavaScript("window.commanderNativeReply(\(json))")
  }
}

/// Finder icon lookup and PNG encoding use AppKit, so they must remain on the
/// main actor. Cache and coalesce by canonical path, then admit just one
/// AppKit render per run-loop turn. This keeps every result row eligible for a
/// real Finder icon without turning a broad search into a main-thread burst.
@MainActor
final class CommanderFileIconRequestQueue {
  private static let maximumCachedIcons = 512
  private static let maximumCachedIconBytes = 24 * 1024 * 1024

  private let renderer: (String) throws -> String
  private let cache = NSCache<NSString, NSString>()
  private var jobs: [String] = []
  private var waiters: [String: [CheckedContinuation<String, Error>]] = [:]
  private var scheduled = false

  init(renderer: ((String) throws -> String)? = nil) {
    self.renderer = renderer ?? { path in
      try CommanderWebView.fileIconDataURL(for: path)
    }
    cache.countLimit = Self.maximumCachedIcons
    cache.totalCostLimit = Self.maximumCachedIconBytes
  }

  func dataURL(for path: String) async throws -> String {
    let canonicalPath = try CommanderWebView.validatedFileURL(for: path).standardizedFileURL.path
    let cacheKey = canonicalPath as NSString
    if let cached = cache.object(forKey: cacheKey) {
      return cached as String
    }
    return try await withCheckedThrowingContinuation { continuation in
      if waiters[canonicalPath] != nil {
        waiters[canonicalPath]?.append(continuation)
      } else {
        waiters[canonicalPath] = [continuation]
        jobs.append(canonicalPath)
      }
      scheduleNext()
    }
  }

  private func scheduleNext() {
    guard !scheduled, !jobs.isEmpty else { return }
    scheduled = true
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(8)) { [weak self] in
      self?.renderNext()
    }
  }

  private func renderNext() {
    guard !jobs.isEmpty else {
      scheduled = false
      return
    }
    let path = jobs.removeFirst()
    let continuations = waiters.removeValue(forKey: path) ?? []
    scheduled = false
    do {
      let dataURL = try renderer(path)
      cache.setObject(
        dataURL as NSString,
        forKey: path as NSString,
        cost: dataURL.lengthOfBytes(using: .utf8)
      )
      continuations.forEach { $0.resume(returning: dataURL) }
    } catch {
      continuations.forEach { $0.resume(throwing: error) }
    }
    scheduleNext()
  }
}

private enum BridgeError: LocalizedError {
  case missing(String), invalidURL, invalidSettingsTab(String), invalidCommandShortcuts, invalidNotification, invalidApplicationControl, notificationsDenied, unknownMethod(String), credentialMissing, invalidDaemonResponse, responseTooLarge, pasteboardWrite, daemon(String)
  var errorDescription: String? {
    switch self {
    case .missing(let key): "Native request is missing \(key)."
    case .invalidURL: "The requested URL is invalid."
    case .invalidSettingsTab(let tab): "Unsupported Commander settings tab: \(tab)"
    case .invalidCommandShortcuts: "The command shortcut map is invalid."
    case .invalidNotification: "The notification details are invalid."
    case .invalidApplicationControl: "The application control request is invalid."
    case .notificationsDenied: "Commander notifications are disabled in macOS Settings."
    case .unknownMethod(let method): "Unknown native method: \(method)"
    case .credentialMissing: "No saved credential exists for this account."
    case .invalidDaemonResponse: "The Commander service returned an invalid response."
    case .responseTooLarge: "The Commander service response exceeds the 1 MiB limit."
    case .pasteboardWrite: "Commander could not place that item on the clipboard."
    case .daemon(let message): message
    }
  }
}

private extension URL {
  var commanderExactOrigin: String {
    let defaultPort = scheme == "https" ? 443 : 80
    return "\(scheme?.lowercased() ?? "")://\(host?.lowercased() ?? ""):\(port ?? defaultPort)"
  }
}
