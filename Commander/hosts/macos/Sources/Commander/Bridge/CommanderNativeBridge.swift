import AppKit
import UniformTypeIdentifiers
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
}

@MainActor
final class CommanderNativeBridge: NSObject, WKScriptMessageHandler {
  private static let maximumMessageBytes = 1024 * 1024
  private let keychain: KeychainStore
  private let loginItem: LaunchAtLoginService
  private let daemonURL: URL
  private let nativeToken: String
  private let showLauncher: () -> Void
  private let hideLauncher: () -> Void
  private let showSettings: () -> Void
  private let updateHotKey: (String) throws -> Void
  private let updateMenuBar: (Bool) -> Void
  private let updateWindowMode: (String) throws -> Void
  weak var webView: WKWebView?

  init(
    ready: DaemonReady,
    keychain: KeychainStore,
    loginItem: LaunchAtLoginService,
    showLauncher: @escaping () -> Void,
    hideLauncher: @escaping () -> Void,
    showSettings: @escaping () -> Void,
    updateHotKey: @escaping (String) throws -> Void,
    updateMenuBar: @escaping (Bool) -> Void,
    updateWindowMode: @escaping (String) throws -> Void
  ) {
    self.daemonURL = URL(string: ready.url)!
    self.nativeToken = ready.nativeToken
    self.keychain = keychain
    self.loginItem = loginItem
    self.showLauncher = showLauncher
    self.hideLauncher = hideLauncher
    self.showSettings = showSettings
    self.updateHotKey = updateHotKey
    self.updateMenuBar = updateMenuBar
    self.updateWindowMode = updateWindowMode
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

  private func handle(_ request: BridgeRequest) async {
    do {
      let result: Any?
      switch request.method {
      case "launcher.hide": hideLauncher(); result = nil
      case "launcher.show": showLauncher(); result = nil
      case "application.quit": result = ["terminating": true]
      case "settings.open": showSettings(); result = nil
      case "application.open":
        guard let raw = request.params?["path"]?.string else { throw BridgeError.missing("path") }
        guard let url = URL(string: raw), url.scheme != nil || raw.hasPrefix("/") else { throw BridgeError.invalidURL }
        if url.scheme != nil { NSWorkspace.shared.open(url) }
        else { NSWorkspace.shared.open(URL(fileURLWithPath: raw)) }
        result = nil
      case "filesystem.reveal":
        guard let raw = request.params?["path"]?.string else { throw BridgeError.missing("path") }
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: raw)]); result = nil
      case "clipboard.write":
        guard let text = request.params?["text"]?.string else { throw BridgeError.missing("text") }
        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(text, forType: .string); result = nil
      case "extension.choose": result = chooseExtensionFolder()
      case "hotkey.update":
        guard let shortcut = request.params?["shortcut"]?.string else { throw BridgeError.missing("shortcut") }
        try updateHotKey(shortcut); result = ["registered": true]
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
              let windowMode = request.params?["windowMode"]?.string else { throw BridgeError.missing("native settings") }
        try loginItem.update(enabled: openAtLogin)
        updateMenuBar(showMenuBarIcon)
        try updateWindowMode(windowMode)
        try updateHotKey(shortcut)
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

private enum BridgeError: LocalizedError {
  case missing(String), invalidURL, unknownMethod(String), credentialMissing, invalidDaemonResponse, responseTooLarge, daemon(String)
  var errorDescription: String? {
    switch self {
    case .missing(let key): "Native request is missing \(key)."
    case .invalidURL: "The requested URL is invalid."
    case .unknownMethod(let method): "Unknown native method: \(method)"
    case .credentialMissing: "No saved credential exists for this account."
    case .invalidDaemonResponse: "The Commander service returned an invalid response."
    case .responseTooLarge: "The Commander service response exceeds the 1 MiB limit."
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
