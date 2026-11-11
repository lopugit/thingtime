import AuthenticationServices
import Foundation
import WebKit
import ThingtimePasswordCore

/// Uses the WebView's authenticated session only inside native memory. No
/// credential or Keychain read is ever returned through the web bridge.
@MainActor final class PasswordProviderBridge {
    static let version = "1.1.0"
    static let script = WKUserScript(source: """
      (() => {
        const bridge = window.thingtimeNativeBridge, send = bridge.postMessage.bind(bridge);
        const documentNonce = crypto.randomUUID();
        Object.defineProperty(window, 'thingtimePasswordDocument', {value: documentNonce});
        bridge.passwordsVersion = '1.1.0';
        bridge.postMessage = message => send(message?.type === 'password-provider'
          ? {...message, payload: {...message.payload, documentNonce}} : message);
      })();
      """, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    private var generation = UUID()
    private var operation: Task<Void, Never>?
    private var lastEnablementRequest: Date?
    private let retirement = PasswordHostRetirementQueue()

    private static func javascript(_ web: WKWebView, _ source: String, arguments: [String: Any], frame: WKFrameInfo) async throws -> Any {
        try await withCheckedThrowingContinuation { continuation in
            web.callAsyncJavaScript(source, arguments: arguments, in: frame, in: .page) { result in
                continuation.resume(with: result)
            }
        }
    }

    func invalidate() { generation = UUID(); operation?.cancel(); operation = nil; retirement.cancel() }

    func handle(_ message: WKScriptMessage, web: WKWebView, root: URL, currentRoot: @escaping () -> URL?) {
        guard message.webView === web, message.frameInfo.isMainFrame,
              let page = web.url, let frame = message.frameInfo.request.url,
              PasswordHostRequestScope.permitsTransport(root: root, page: page, frame: frame,
                securityScheme: message.frameInfo.securityOrigin.protocol,
                securityHost: message.frameInfo.securityOrigin.host, securityPort: message.frameInfo.securityOrigin.port),
              let body = message.body as? [String: Any], let payload = body["payload"] as? [String: Any],
              let parsed = PasswordHostBridgeRequest(payload) else { return }
        let action = parsed.action, owner = parsed.ownerId, request = parsed.requestId, document = parsed.documentNonce
        let captured = generation, targetFrame = message.frameInfo
        if root.scheme != "https" {
            web.callAsyncJavaScript("""
              if (window.thingtimePasswordDocument === expectedDocument && location.origin === expectedOrigin) {
                window.dispatchEvent(new CustomEvent('thingtime:native-message', {detail: {type: 'password-provider-result', payload: result}}));
              }
              """, arguments: ["expectedDocument": document, "expectedOrigin": root.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")),
                "result": ["requestId": request, "ok": true, "connection": "unsupportedOrigin"]], in: targetFrame, in: .page, completionHandler: nil)
            return
        }
        // Keep one mutation ordered through all awaits. A repeated request cannot
        // replace a pending Connect or a system enablement prompt.
        guard operation == nil else {
            if action == "sync", owner.isEmpty,
               retirement.enqueue({ [weak self, weak web] in
                   guard let self, let web else { return }
                   self.handle(message, web: web, root: root, currentRoot: currentRoot)
               }) { return }
            web.callAsyncJavaScript("""
              if (window.thingtimePasswordDocument === expectedDocument && location.origin === expectedOrigin) {
                window.dispatchEvent(new CustomEvent('thingtime:native-message', {detail: {type: 'password-provider-result', payload: result}}));
              }
              """, arguments: ["expectedDocument": document, "expectedOrigin": root.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")),
                "result": ["requestId": request, "ok": false, "message": "Password AutoFill is finishing another request. Retry when it finishes."]], in: targetFrame, in: .page, completionHandler: nil)
            return
        }
        operation = Task { [weak self, weak web] in
            guard let self, let web else { return }
            defer {
                if self.generation == captured {
                    self.operation = nil
                    self.retirement.drain()
                }
            }
            @MainActor func checkDocument() async throws {
                guard !Task.isCancelled, self.generation == captured, currentRoot() == root,
                      let current = web.url, AuthenticatorSetupBridge.sameOrigin(current, root) else { throw PasswordProviderError.sessionChanged }
                let valid = try await Self.javascript(web, "return window.thingtimePasswordDocument === expectedDocument && location.origin === expectedOrigin;",
                    arguments: ["expectedDocument": document, "expectedOrigin": root.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))], frame: targetFrame)
                guard valid as? Bool == true, !Task.isCancelled, self.generation == captured, currentRoot() == root else { throw PasswordProviderError.sessionChanged }
            }
            var responseCookie: String?
            @MainActor func currentSession() async throws -> ProviderSession {
                try await checkDocument()
                // Home-plane ownership, exact-origin capability and cookie
                // rotation are verified independently of JS-supplied ownerId.
                try await AuthenticatorSetupBridge.verifySession(web: web, root: root, owner: owner)
                let cookies = await web.configuration.websiteDataStore.httpCookieStore.allCookies()
                let cookie = try PasswordHostRequestScope.authenticationCookie(cookies, origin: root)
                let session = try ProviderSession(origin: root, ownerId: owner, cookie: cookie)
                _ = try await PasswordClient(account: session).catalog()
                try await PasswordHostCommitFence.verify(expected: session, generation: captured,
                    checkDocument: checkDocument,
                    cookies: { await web.configuration.websiteDataStore.httpCookieStore.allCookies() },
                    currentGeneration: { self.generation }, destinationIsCurrent: {
                        currentRoot() == root && web.url.map { AuthenticatorSetupBridge.sameOrigin($0, root) } == true
                    })
                responseCookie = cookie
                return session
            }
            @MainActor func reply(_ result: [String: Any]) async {
                guard (try? await checkDocument()) != nil else { return }
                if let responseCookie {
                    let cookies = await web.configuration.websiteDataStore.httpCookieStore.allCookies()
                    guard !Task.isCancelled, self.generation == captured, currentRoot() == root,
                          (try? PasswordHostRequestScope.authenticationCookie(cookies, origin: root)) == responseCookie else { return }
                }
                var result = result; result["requestId"] = request
                // Captured frame plus nonce prevents same-URL replacement from
                // receiving any previous document's completion.
                _ = try? await Self.javascript(web, """
                  if (window.thingtimePasswordDocument === expectedDocument && location.origin === expectedOrigin) {
                    window.dispatchEvent(new CustomEvent('thingtime:native-message', {detail: {type: 'password-provider-result', payload: result}}));
                  }
                  """, arguments: ["expectedDocument": document, "expectedOrigin": root.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), "result": result], frame: targetFrame)
            }
            do {
                if owner.isEmpty {
                    guard action == "sync" else { throw PasswordProviderError.invalidSession }
                    try await checkDocument()
                    let cookies = await web.configuration.websiteDataStore.httpCookieStore.allCookies()
                    guard !Task.isCancelled, self.generation == captured, currentRoot() == root else { throw PasswordProviderError.sessionChanged }
                    // React's initial unknown identity is not logout. Retire a
                    // host-owned link only after the actual first-party cookie
                    // disappears; never retire another origin or companion.
                    let hasCookie = cookies.contains { cookie in
                        let domain = cookie.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
                        let host = root.host?.lowercased() ?? ""
                        return cookie.name == "tt_auth" && (host == domain || host.hasSuffix("." + domain))
                            && (cookie.expiresDate.map { $0 > Date() } ?? true)
                    }
                    guard !hasCookie else { await reply(["ok": true, "connection": "unavailable"]); return }
                    let baseline = try PasswordSessionStore.loadIfPresent()
                    guard PasswordHostConnectionAuthority.canDisconnect(baseline, expectedOrigin: root) else {
                        await reply(["ok": true, "connection": "differentSession"]); return
                    }
                    try PasswordSessionStore.clear()
                    await PasswordIdentityIndex.clearAndWait()
                    await reply(["ok": true, "connection": "disconnected"]); return
                }
                var session = try await currentSession()
                let baseline = try PasswordSessionStore.loadIfPresent()
                let optOutKey = "password-provider-opt-out:\(root.absoluteString):\(owner)"
                if action == "status" {
                    await reply(["ok": true, "connection": PasswordConnectionStatus.current(for: session).rawValue]); return
                }
                if action == "disconnect" {
                    guard baseline == nil || (baseline?.ownerId == owner && PasswordHostConnectionAuthority.canDisconnect(baseline, expectedOrigin: root)) else { throw PasswordProviderError.sessionChanged }
                    // No awaits between the final authority comparison and write.
                    session = try await currentSession()
                    guard try PasswordSessionStore.loadIfPresent() == baseline else { throw PasswordProviderError.sessionChanged }
                    try PasswordSessionStore.clear()
                    UserDefaults.standard.set(true, forKey: optOutKey)
                    await PasswordIdentityIndex.clearAndWait()
                    await reply(["ok": true, "connection": "disconnected"]); return
                }
                var enabled = await PasswordIdentityIndex.isEnabled()
                if action == "connect", !enabled {
                    if #available(iOS 18, *) {
                        // Apple's API requires ten seconds between prompts.
                        guard self.lastEnablementRequest.map({ Date().timeIntervalSince($0) >= 10 }) ?? true else { throw PasswordProviderError.unavailable }
                        self.lastEnablementRequest = Date()
                        enabled = await ASSettingsHelper.requestToTurnOnCredentialProviderExtension()
                    }
                    guard enabled else {
                        await reply(["ok": false, "message": "Enable Thingtime in Settings → AutoFill & Passwords, then return and connect."]); return
                    }
                }
                // Explicit Connect can select the verified visible account.
                // Background sync never replaces another account or overrides
                // an explicit Disconnect, even when the OS provider is enabled.
                if action == "sync" {
                    guard PasswordHostConnectionAuthority.canSynchronize(baseline, incoming: session, providerEnabled: enabled,
                        optedOut: UserDefaults.standard.bool(forKey: optOutKey)) else { throw PasswordProviderError.sessionChanged }
                }
                let catalog = try await PasswordClient(account: session).catalog()
                let verified = try await currentSession()
                guard verified == session, try PasswordSessionStore.loadIfPresent() == baseline else { throw PasswordProviderError.sessionChanged }
                try PasswordSessionStore.save(verified)
                if action == "connect" { UserDefaults.standard.removeObject(forKey: optOutKey) }
                // The main actor serializes host requests; the shared index queue
                // ensures a later disconnect clears any earlier submitted sync.
                do { try await PasswordIdentityIndex.synchronize(catalog) }
                catch {
                    await reply(["ok": true, "connection": "connected", "message": "Connected. AutoFill suggestions could not refresh; return to Passwords and retry."]); return
                }
                await reply(["ok": true, "connection": "connected"])
            } catch {
                await reply(["ok": false, "message": "Password AutoFill could not verify this account and destination. Sign in again or retry."])
            }
        }
    }
}
