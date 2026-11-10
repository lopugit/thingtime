import AppKit
import WebKit
import ThingtimePasswordCore

/// Native shell controls navigate to the existing connection/settings flows;
/// the editor itself is composed from the ordinary editable PasswordManager.
@MainActor final class PasswordSetupEditor: NSViewController, WKNavigationDelegate, WKScriptMessageHandler {
    private let setup = AuthenticatorSetupBridge()
    private var browser: WKWebView?
    private let status = NSTextField(wrappingLabelWithString: "Sign in normally in this private window. Setup codes remain in memory until you review and save them.")
    private var origin: URL?
    private var owner: String?
    override func loadView() {
        let stack = NSStackView(); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 12; stack.edgeInsets = NSEdgeInsets(top: 12, left: 16, bottom: 12, right: 16)
        let controls = NSStackView(views: [NSButton(title: "Open Thingtime", target: self, action: #selector(openThingtime)), NSButton(title: "Open Password AutoFill settings", target: self, action: #selector(openSettings))])
        controls.orientation = .vertical; controls.alignment = .leading; controls.spacing = 8
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
            old.stopLoading(); old.navigationDelegate = nil
            old.configuration.userContentController.removeScriptMessageHandler(forName: AuthenticatorSetupBridge.handler)
            (view as? NSStackView)?.removeArrangedSubview(old); old.removeFromSuperview()
        }
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.addUserScript(AuthenticatorSetupBridge.script)
        configuration.userContentController.add(self, name: AuthenticatorSetupBridge.handler)
        let web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self; web.translatesAutoresizingMaskIntoConstraints = false
        (view as? NSStackView)?.addArrangedSubview(web)
        NSLayoutConstraint.activate([web.widthAnchor.constraint(equalTo: view.widthAnchor, constant: -32), web.heightAnchor.constraint(greaterThanOrEqualToConstant: 400)])
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
            status.stringValue = "Destination: \(destination.origin.absoluteString). Sign in normally to review setup codes. Native AutoFill credentials are not reused in this window."
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
    func cancelSetup() { setup.cancel() }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) { setup.handle(message) }
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { setup.navigationStarted() }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let target = action.request.url, let origin else { decisionHandler(.cancel); return }
        if AuthenticatorSetupBridge.sameOrigin(target, origin) { decisionHandler(.allow); return }
        if action.navigationType == .linkActivated, ["https", "http"].contains(target.scheme ?? ""), target.user == nil, target.password == nil { NSWorkspace.shared.open(target) }
        decisionHandler(.cancel)
    }
    deinit { DistributedNotificationCenter.default().removeObserver(self) }
}
