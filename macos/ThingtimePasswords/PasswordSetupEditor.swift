import AppKit
import WebKit
import ThingtimePasswordCore

/// Native shell controls navigate to the existing connection/settings flows;
/// the editor itself is composed from the ordinary editable PasswordManager.
@MainActor final class PasswordSetupEditor: NSViewController, WKNavigationDelegate, WKScriptMessageHandler, WKHTTPCookieStoreObserver {
    private let setup = AuthenticatorSetupBridge()
    private var browser: WKWebView?
    private let status = NSTextField(wrappingLabelWithString: "Sign in normally in this private window. Setup codes remain in memory until you review and save them.")
    private var origin: URL?
    private var owner: String?
    private let connectionIntent = PasswordConnectionIntent()
    private var connectionTask: Task<Void, Never>?
    private var linkedWebSession: ProviderSession?
    private lazy var connectButton = NSButton(title: "Connect Password AutoFill", target: self, action: #selector(connectAutoFill))
    private lazy var cancelConnectionButton = NSButton(title: "Cancel connection", target: self, action: #selector(cancelConnection))
    override func loadView() {
        let stack = NSStackView(); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 12; stack.edgeInsets = NSEdgeInsets(top: 12, left: 16, bottom: 12, right: 16)
        let controls = NSStackView(views: [connectButton, cancelConnectionButton, NSButton(title: "Disconnect Password AutoFill", target: self, action: #selector(disconnectAutoFill)), NSButton(title: "Open Thingtime", target: self, action: #selector(openThingtime)), NSButton(title: "Open Password AutoFill settings", target: self, action: #selector(openSettings))])
        controls.orientation = .vertical; controls.alignment = .leading; controls.spacing = 8
        cancelConnectionButton.isHidden = true
        status.maximumNumberOfLines = 0
        stack.addArrangedSubview(controls); stack.addArrangedSubview(status); view = stack
        setup.onStatus = { [weak self] value in self?.status.stringValue = value }
        setup.destinationIsCurrent = { [weak self] in
            guard let self else { return false }
            if self.destinationMatches() { return true }
            self.retryDestination(); return false
        }
        DistributedNotificationCenter.default().addObserver(self, selector: #selector(destinationChanged), name: .init("com.thingtime.passwords.destination-changed"), object: nil)
        retryDestination()
    }
    @objc private func openThingtime() {
        if let app = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.thingtime.desktop") { NSWorkspace.shared.openApplication(at: app, configuration: NSWorkspace.OpenConfiguration(), completionHandler: nil) }
    }
    @objc private func openSettings() { NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.Passwords-Settings.extension")!) }
    @objc private func cancelConnection() {
        let wasConnecting = !connectButton.isEnabled
        connectionIntent.cancel(); connectionTask?.cancel(); connectionTask = nil
        connectButton.isEnabled = true; cancelConnectionButton.isHidden = true
        if wasConnecting { status.stringValue = "Connection cancelled. Choose Connect Password AutoFill to try again." }
    }
    @objc private func disconnectAutoFill() {
        cancelConnection(); linkedWebSession = nil
        do {
            try PasswordSessionStore.clear()
            Task { await PasswordIdentityIndex.clearAndWait() }
            status.stringValue = PasswordConnectionStatus.disconnected.message
            destinationChangedNotification()
        } catch { status.stringValue = (error as? PasswordProviderError ?? .unavailable).recoveryMessage }
    }
    private func destinationChangedNotification() {
        DistributedNotificationCenter.default().postNotificationName(.init("com.thingtime.passwords.destination-changed"), object: nil, userInfo: nil, deliverImmediately: true)
    }
    @objc private func connectAutoFill() {
        guard let web = browser, let root = origin else { return }
        cancelConnection()
        let captured = connectionIntent.begin(), expectedOwner = owner
        connectButton.isEnabled = false; cancelConnectionButton.isHidden = false
        status.stringValue = "Checking this window’s signed-in account before connecting Password AutoFill…"
        connectionTask = Task { [weak self, weak web] in
            guard let self, let web else { return }
            var saved: ProviderSession?
            do {
                let baseline = try PasswordSessionStore.loadIfPresent()
                guard baseline?.origin == nil || baseline?.origin == root,
                      baseline?.ownerId == expectedOwner else { throw PasswordProviderError.accountMismatch }
                let cookie = try PasswordWebConnectionAuthority.cookie(await web.configuration.websiteDataStore.httpCookieStore.allCookies(), origin: root)
                @MainActor func verify(_ stored: ProviderSession?) async throws {
                    try self.connectionIntent.verify(captured)
                    guard self.browser === web, self.origin == root, self.owner == expectedOwner,
                          let url = web.url, AuthenticatorSetupBridge.sameOrigin(url, root), url.path == "/passwords",
                          url.query == nil, url.fragment == nil,
                          try PasswordSessionStore.loadIfPresent() == stored else { throw PasswordProviderError.invalidSession }
                    let currentCookie = try PasswordWebConnectionAuthority.cookie(await web.configuration.websiteDataStore.httpCookieStore.allCookies(), origin: root)
                    try self.connectionIntent.verify(captured)
                    guard currentCookie == cookie, self.browser === web, self.origin == root, self.owner == expectedOwner,
                          let currentURL = web.url, AuthenticatorSetupBridge.sameOrigin(currentURL, root), currentURL.path == "/passwords",
                          currentURL.query == nil, currentURL.fragment == nil,
                          try PasswordSessionStore.loadIfPresent() == stored else { throw PasswordProviderError.invalidSession }
                }
                try await verify(baseline)
                let session = try await PasswordClient.webSession(origin: root, cookie: cookie, expectedOwner: expectedOwner)
                let catalog = try await PasswordClient(account: session).catalog()
                try await self.connectionIntent.commit(captured, verifyAuthority: { try await verify(baseline) }, save: {
                    try PasswordSessionStore.save(session); saved = session
                })
                let result = try await PasswordIdentityIndex.synchronizeConnection(catalog) { try await verify(session) }
                try await verify(session)
                self.linkedWebSession = session
                // The same authenticated document remains visible after linking;
                // update only its expected owner, without seeding another store.
                self.owner = session.ownerId
                self.setup.configure(webView: web, origin: root, expectedOwner: session.ownerId)
                self.status.stringValue = result.message
                self.destinationChangedNotification()
            } catch {
                // Undo only this attempt's link. Never erase a newer connection
                // established by the main app or another explicit native action.
                if let saved, (try? PasswordSessionStore.loadIfPresent()) == saved {
                    try? PasswordSessionStore.clear(); await PasswordIdentityIndex.clearAndWait()
                }
                if (try? self.connectionIntent.verify(captured)) != nil {
                    self.status.stringValue = (error as? PasswordProviderError ?? .unavailable).recoveryMessage
                }
            }
            if (try? self.connectionIntent.verify(captured)) != nil {
                self.connectButton.isEnabled = true; self.cancelConnectionButton.isHidden = true
            }
        }
    }
    func cookiesDidChange(in cookieStore: WKHTTPCookieStore) {
        guard let web = browser, cookieStore === web.configuration.websiteDataStore.httpCookieStore,
              let linked = linkedWebSession else { return }
        Task { [weak self, weak web] in
            let cookies = await cookieStore.allCookies()
            guard let self, let web, self.browser === web, self.linkedWebSession == linked else { return }
            guard (try? PasswordWebConnectionAuthority.cookie(cookies, origin: linked.origin)) != linked.cookie else { return }
            self.cancelConnection(); self.linkedWebSession = nil
            if (try? PasswordSessionStore.loadIfPresent()) == linked {
                try? PasswordSessionStore.clear(); await PasswordIdentityIndex.clearAndWait()
                self.status.stringValue = "This window’s sign-in changed. Sign in and choose Connect Password AutoFill again."
                self.destinationChangedNotification()
            }
        }
    }
    @objc private func destinationChanged() { retryDestination() }
    private func selectedDestination() throws -> (origin: URL, owner: String?) {
        let linked = try PasswordSessionStore.destination()
        let configured = (Bundle.main.object(forInfoDictionaryKey: "ThingtimeWebURL") as? String).flatMap(URL.init(string:))
        guard let target = linked?.origin ?? configured, let origin = AuthenticatorSetupBridge.canonicalOrigin(target) else { throw PasswordProviderError.invalidSession }
        return (origin, linked?.ownerId)
    }
    private func destinationMatches() -> Bool {
        guard let destination = try? selectedDestination() else { return false }
        return destination.origin == origin && destination.owner == owner
    }
    private func replaceBrowser() -> WKWebView {
        if let old = browser {
            cancelConnection(); linkedWebSession = nil
            old.stopLoading(); old.navigationDelegate = nil
            old.configuration.websiteDataStore.httpCookieStore.remove(self)
            old.configuration.userContentController.removeScriptMessageHandler(forName: AuthenticatorSetupBridge.handler)
            (view as? NSStackView)?.removeArrangedSubview(old); old.removeFromSuperview()
        }
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.websiteDataStore.httpCookieStore.add(self)
        configuration.userContentController.addUserScript(AuthenticatorSetupBridge.script)
        configuration.userContentController.add(self, name: AuthenticatorSetupBridge.handler)
        let web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self; web.translatesAutoresizingMaskIntoConstraints = false
        (view as? NSStackView)?.addArrangedSubview(web)
        NSLayoutConstraint.activate([web.widthAnchor.constraint(equalTo: view.widthAnchor, constant: -32), web.heightAnchor.constraint(greaterThanOrEqualToConstant: 260)])
        browser = web; return web
    }
    func retryDestination() {
        guard isViewLoaded else { return }
        do {
            let destination = try selectedDestination()
            guard destination.origin != origin || destination.owner != owner || browser == nil else { return }
            // Refresh the complete ephemeral session on connection changes;
            // neither cookies nor pending setup can cross to the new owner.
            if origin != nil { setup.cancel() }
            let web = replaceBrowser()
            origin = destination.origin; owner = destination.owner
            setup.configure(webView: web, origin: destination.origin, expectedOwner: destination.owner)
            status.stringValue = "Destination: \(destination.origin.absoluteString). Sign in here, then choose Connect Password AutoFill. This private window can also review setup codes."
            web.load(URLRequest(url: destination.origin.appendingPathComponent("passwords")))
        } catch {
            if origin != nil {
                setup.cancel(); browser?.stopLoading()
                browser?.configuration.userContentController.removeScriptMessageHandler(forName: AuthenticatorSetupBridge.handler)
                browser?.removeFromSuperview(); browser = nil; origin = nil; owner = nil
            }
            status.stringValue = "The configured destination is unavailable. Unlock this device and reactivate this window to retry. No setup code is forwarded to another origin."
        }
    }
    func receive(_ url: URL) {
        loadViewIfNeeded(); retryDestination()
        setup.offer(url)
        guard let origin, let browser else { return }
        if browser.url?.path != "/passwords", browser.url?.path != "/login" { browser.load(URLRequest(url: origin.appendingPathComponent("passwords"))) }
    }
    func cancelSetup() { setup.cancel(); cancelConnection() }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) { setup.handle(message) }
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { setup.navigationStarted(); cancelConnection() }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let target = action.request.url, let origin else { decisionHandler(.cancel); return }
        if AuthenticatorSetupBridge.sameOrigin(target, origin) { decisionHandler(.allow); return }
        if action.navigationType == .linkActivated, ["https", "http"].contains(target.scheme ?? ""), target.user == nil, target.password == nil { NSWorkspace.shared.open(target) }
        decisionHandler(.cancel)
    }
    deinit { DistributedNotificationCenter.default().removeObserver(self) }
}
