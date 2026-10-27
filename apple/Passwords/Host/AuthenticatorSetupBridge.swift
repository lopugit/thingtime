import Foundation
import WebKit
import ThingtimePasswordCore

/// A separately versioned, narrow bridge. It never exposes provider-session
/// credentials, and verifies the visible WKWebView's own browser session.
@MainActor final class AuthenticatorSetupBridge {
    static let version = "1.0.0"
    static let handler = "thingtimeAuthenticatorSetup"
    static let script = WKUserScript(source: """
      (() => {
        const documentNonce = crypto.randomUUID();
        let activeScope;
        Object.defineProperty(window, 'thingtimeAuthenticatorSetup', {value: Object.freeze({version: '1.0.0', documentNonce,
          scopeMatches: (ownerId, nonce) => activeScope?.ownerId === ownerId && activeScope?.nonce === nonce && activeScope?.dataPlane === 'home',
          postMessage(message) {
            if (message.operation === 'ready') activeScope = {ownerId: message.ownerId, nonce: message.nonce, dataPlane: message.dataPlane};
            if (message.operation === 'cancel' && activeScope?.nonce === message.nonce) activeScope = undefined;
            window.webkit.messageHandlers.thingtimeAuthenticatorSetup.postMessage({...message, documentNonce});
          }}), writable: false, configurable: false});
      })();
      window.dispatchEvent(new Event('thingtime:authenticator-setup-ready'));
      """, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    private(set) var inbox = AuthenticatorSetupInbox()
    private var generation = UUID()
    private var origin: URL?
    private var expectedOwner: String?
    private weak var web: WKWebView?
    private var lastNonce: String?
    private var lastOwner: String?
    private var lastPlane: String?
    private var lastFrame: WKFrameInfo?
    private var lastDocumentNonce: String?
    private var verification: Task<Void, Never>?
    private var offeredDelivery: UUID?
    private var expiry: Task<Void, Never>?
    var onStatus: ((String) -> Void)?
    var destinationIsCurrent: (() -> Bool)?
    private var statusMessage: String?
    private func report(_ message: String) {
        statusMessage = message; onStatus?(message)
        if let nonce = lastNonce, let owner = lastOwner { emit(kind: "status", nonce: nonce, owner: owner, message: message) }
    }

    static func canonicalOrigin(_ value: URL) -> URL? {
        guard value.scheme == "https", value.host != nil, value.user == nil, value.password == nil,
              value.query == nil, value.fragment == nil, value.path.isEmpty || value.path == "/" else { return nil }
        return URL(string: value.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
    }
    static func sameOrigin(_ url: URL, _ origin: URL) -> Bool {
        url.scheme == origin.scheme && url.host?.lowercased() == origin.host?.lowercased() && (url.port ?? 443) == (origin.port ?? 443) && url.user == nil && url.password == nil
    }
    func configure(webView: WKWebView, origin: URL, expectedOwner: String? = nil) {
        let canonical = Self.canonicalOrigin(origin)
        if (self.origin != nil && self.origin != canonical) || (inbox.binding != nil && self.expectedOwner != expectedOwner) { cancel() }
        self.web = webView; self.origin = canonical; self.expectedOwner = expectedOwner
    }
    func offer(_ url: URL, deliveryID: UUID = UUID()) {
        guard deliveryID != offeredDelivery else { return }
        offeredDelivery = deliveryID
        do {
            guard try inbox.offer(url.absoluteString) else { report("Finish or cancel the pending setup before opening another code."); return }
            expiry?.cancel()
            let request = inbox.requestID
            expiry = Task { [weak self] in
                do { try await Task.sleep(for: .seconds(600)) } catch { return }
                guard let self, self.inbox.requestID == request else { return }
                let nonce = self.lastNonce, owner = self.lastOwner
                self.cancel()
                if let nonce, let owner, let request { self.emit(kind: "expired", nonce: nonce, owner: owner, id: request, message: "The pending setup expired. Open the setup code again.") }
                self.report("The pending setup expired. Open the setup code again when you are ready.")
            }
            guard origin != nil else { report("Setup is held only in memory while the configured destination is unavailable. Unlock this device and reactivate this window to retry."); return }
            report("Sign in to the displayed Thingtime destination, then review the pending setup in Passwords.")
            announce()
        } catch { report("This link is not a supported TOTP setup code. HOTP and migration links are not supported.") }
    }
    func navigationStarted() {
        generation = UUID(); verification?.cancel(); verification = nil
        inbox.navigationStarted(); lastNonce = nil; lastOwner = nil; lastPlane = nil; lastFrame = nil; lastDocumentNonce = nil
    }
    func cancel() {
        generation = UUID(); verification?.cancel(); verification = nil; expiry?.cancel(); expiry = nil; inbox.cancel()
        // Keep only the frame/document hint so a later warm setup can request
        // a fresh authenticated handshake after Cancel. No owner/authority survives.
        lastNonce = nil; lastOwner = nil; lastPlane = nil
    }
    private func validPage(_ web: WKWebView, _ root: URL) -> Bool {
        guard let url = web.url else { return false }
        return Self.sameOrigin(url, root) && url.path == "/passwords" && url.query == nil && url.fragment == nil
    }
    func handle(_ message: WKScriptMessage) {
        guard message.name == Self.handler,
              let web, message.webView === web, let root = origin,
              AuthenticatorSetupPage.permits(root: root, page: web.url, frame: message.frameInfo.request.url,
                  isMainFrame: message.frameInfo.isMainFrame, securityScheme: message.frameInfo.securityOrigin.protocol,
                  securityHost: message.frameInfo.securityOrigin.host, securityPort: message.frameInfo.securityOrigin.port),
              let body = message.body as? [String: String], body["version"] == Self.version,
              let operation = body["operation"], let nonce = body["nonce"], UUID(uuidString: nonce) != nil,
              let documentNonce = body["documentNonce"], UUID(uuidString: documentNonce) != nil else { return }
        guard destinationIsCurrent?() ?? true else { cancel(); report("The linked destination or account changed. Reopen setup after signing in to the current destination."); return }
        if operation == "cancel" {
            if lastNonce == nonce && lastDocumentNonce == documentNonce { cancel() }
            return
        }
        guard let owner = body["ownerId"], !owner.isEmpty, body["dataPlane"] == "home",
              expectedOwner == nil || owner == expectedOwner else { cancel(); return }
        if let lastNonce, lastNonce != nonce || lastOwner != owner || lastPlane != "home" || lastDocumentNonce != documentNonce { cancel(); return }
        guard operation == "ready" || operation == "consume" else { return }
        lastNonce = nonce; lastOwner = owner; lastPlane = "home"; lastFrame = message.frameInfo; lastDocumentNonce = documentNonce
        let current = generation
        verification?.cancel()
        verification = Task { [weak self, weak web] in
            guard let self, let web else { return }
            do {
                try await Self.verifySession(web: web, root: root, owner: owner)
                guard !Task.isCancelled, self.destinationIsCurrent?() ?? true, AuthenticatorSetupDeliveryGate.permits(capturedGeneration: current, currentGeneration: self.generation, capturedDocument: documentNonce, currentDocument: self.lastDocumentNonce), self.validPage(web, root), self.lastNonce == nonce else { return }
                let binding = AuthenticatorSetupInbox.Binding(owner: owner, nonce: nonce, generation: current)
                if operation == "ready" {
                    if let id = self.inbox.bind(binding, expectedOwner: self.expectedOwner, dataPlane: "home") { self.emit(kind: "available", nonce: nonce, owner: owner, id: id) }
                    if let status = self.statusMessage { self.emit(kind: "status", nonce: nonce, owner: owner, message: status) }
                } else if let text = body["requestId"], let id = UUID(uuidString: text) {
                    if let setup = self.inbox.consume(id, binding: binding) {
                        self.expiry?.cancel(); self.expiry = nil
                        self.emit(kind: "setup", nonce: nonce, owner: owner, id: id, setup: setup.uri)
                        self.report("Review the draft and select Save. Nothing has been saved automatically.")
                    } else {
                        self.emit(kind: "unavailable", nonce: nonce, owner: owner, id: id)
                    }
                }
            } catch {
                guard !Task.isCancelled, current == self.generation else { return }
                self.emit(kind: "unavailable", nonce: nonce, owner: owner)
                self.report("Sign in to the configured account on this destination and retry in Passwords.")
            }
        }
    }
    private func announce() {
        guard let web, let root = origin, validPage(web, root), let frame = lastFrame, let document = lastDocumentNonce else { return }
        web.callAsyncJavaScript("""
          if (location.origin === expectedOrigin && location.pathname === '/passwords' && !location.search && !location.hash && window.thingtimeAuthenticatorSetup?.documentNonce === expectedDocument) {
            window.dispatchEvent(new Event('thingtime:authenticator-setup-ready'));
          }
          """, arguments: ["expectedOrigin": root.absoluteString, "expectedDocument": document], in: frame, in: .page, completionHandler: nil)
    }
    private func emit(kind: String, nonce: String, owner: String, id: UUID? = nil, setup: String? = nil, message: String? = nil) {
        guard let web, let root = origin, validPage(web, root), let frame = lastFrame, let document = lastDocumentNonce else { return }
        var detail: [String: String] = ["kind": kind, "nonce": nonce, "ownerId": owner]
        detail["requestId"] = id?.uuidString; detail["setup"] = setup; detail["message"] = message
        // Target the captured main frame and check its document again at execution
        // time. Returning to the same URL does not grant the new document access.
        web.callAsyncJavaScript("""
          if (location.origin === expectedOrigin && location.pathname === '/passwords' && !location.search && !location.hash && window.thingtimeAuthenticatorSetup?.documentNonce === expectedDocument) {
            if (window.thingtimeAuthenticatorSetup.scopeMatches(detail.ownerId, detail.nonce)) { window.dispatchEvent(new CustomEvent('thingtime:authenticator-setup', {detail: detail})); }
          }
          """, arguments: ["detail": detail, "expectedOrigin": root.absoluteString, "expectedDocument": document], in: frame, in: .page, completionHandler: nil)
    }
    private final class NoRedirect: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
        func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
    }
    private static func verifySession(web: WKWebView, root: URL, owner: String) async throws {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil; config.urlCache = nil; config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 15; config.timeoutIntervalForResource = 20
        let session = URLSession(configuration: config, delegate: NoRedirect(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        var request = URLRequest(url: root.appendingPathComponent(".well-known/thingtime-capabilities.json"))
        let (manifestData, manifestResponse) = try await session.data(for: request)
        guard let response = manifestResponse as? HTTPURLResponse, response.statusCode == 200, response.url == request.url,
              AuthenticatorSetupAuthority.manifest(manifestData, origin: root) else { throw PasswordProviderError.unavailable }
        let cookies = await web.configuration.websiteDataStore.httpCookieStore.allCookies()
        let matches: (HTTPCookie) -> Bool = { cookie in
            let domain = cookie.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: ".")), host = root.host!.lowercased()
            return cookie.name == "tt_auth" && cookie.isSecure && cookie.isHTTPOnly && cookie.path == "/" && (host == domain || host.hasSuffix("." + domain)) && (cookie.expiresDate.map { $0 > Date() } ?? true)
        }
        let auth = cookies.filter(matches)
        guard auth.count == 1 else { throw PasswordProviderError.invalidSession }
        request = URLRequest(url: root.appendingPathComponent("api/v1/passwords"))
        request.setValue(HTTPCookie.requestHeaderFields(with: auth)["Cookie"], forHTTPHeaderField: "Cookie")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        let (data, reply) = try await session.data(for: request)
        guard let response = reply as? HTTPURLResponse, response.statusCode == 200, response.url == request.url,
              AuthenticatorSetupAuthority.owner(data, expected: owner) else { throw PasswordProviderError.invalidSession }
        let after = await web.configuration.websiteDataStore.httpCookieStore.allCookies()
        let afterAuth = after.filter(matches)
        guard afterAuth.count == 1, afterAuth[0].value == auth[0].value else { throw PasswordProviderError.invalidSession }

    }
}
