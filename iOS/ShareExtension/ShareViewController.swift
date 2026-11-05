import UIKit
import WebKit

/// The normal web composer runs inside the supported Share extension surface.
/// Original bytes stay durable in the App Group until a successful composer receipt.
final class ShareViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private let titleLabel = UILabel()
    private let messageLabel = UILabel()
    private let progressView = UIProgressView(progressViewStyle: .default)
    private let retryButton = UIButton(type: .system)
    private let cancelButton = UIButton(type: .system)
    private let status = UIStackView()
    private let webContainer = UIView()
    private var webView: WKWebView?
    private var bridge: ShareComposerBridge?
    private var cancellation: ShareImportCancellation?
    private var saving = false
    private var batchId: UUID?
    private var origin: URL?
    private var generation = UUID()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        titleLabel.text = "New post"
        titleLabel.font = .preferredFont(forTextStyle: .headline)
        titleLabel.adjustsFontForContentSizeCategory = true
        titleLabel.numberOfLines = 0
        titleLabel.accessibilityTraits = .header
        messageLabel.font = .preferredFont(forTextStyle: .subheadline)
        messageLabel.adjustsFontForContentSizeCategory = true
        messageLabel.numberOfLines = 0
        progressView.accessibilityLabel = "Preparing shared content"
        retryButton.configuration = .plain()
        retryButton.setTitle("Try Again", for: .normal)
        retryButton.addTarget(self, action: #selector(retryTapped), for: .touchUpInside)
        cancelButton.configuration = .plain()
        cancelButton.setTitle("Cancel", for: .normal)
        cancelButton.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        let header = UIStackView(arrangedSubviews: [titleLabel, cancelButton])
        header.spacing = 12
        cancelButton.setContentHuggingPriority(.required, for: .horizontal)
        cancelButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        status.axis = .vertical; status.spacing = 8
        [messageLabel, progressView, retryButton].forEach(status.addArrangedSubview)
        let stack = UIStackView(arrangedSubviews: [header, status, webContainer])
        stack.axis = .vertical; stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            stack.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            webContainer.heightAnchor.constraint(greaterThanOrEqualToConstant: 0)
        ])
        preferredContentSize = CGSize(width: 560, height: 760)
        guard let configured = Bundle.main.object(forInfoDictionaryKey: "ThingtimeWebURL") as? String,
              let url = URL(string: configured), !ShareComposerSession.origin(url).isEmpty else {
            showError("The Thingtime destination is unavailable. Your source has not been changed.")
            return
        }
        origin = url
        startPreparing()
    }
    private func startPreparing() {
        guard !saving, let origin else { return }
        saving = true; generation = UUID()
        let attempt = generation
        status.isHidden = false; messageLabel.text = "Preparing shared content…"
        progressView.progress = 0; progressView.isHidden = false
        retryButton.isHidden = true; cancelButton.isEnabled = true
        let token = ShareImportCancellation(); cancellation = token
        let items = extensionContext?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
        let sources = items.flatMap { $0.attachments ?? [] }.map { ProviderShareItem(provider: $0) }
        let text = items.compactMap { $0.attributedContentText?.string }.filter { !$0.isEmpty }
        Task {
            do {
                let importer = ShareItemImporter(inbox: try ShareInbox.shared(), cancellation: token)
                let id = try await importer.save(sources, additionalText: text, composerOrigin: origin) { [weak self] completed, total in
                    Task { @MainActor in
                        guard let self, self.generation == attempt, self.saving else { return }
                        self.progressView.setProgress(Float(completed) / Float(total), animated: !UIAccessibility.isReduceMotionEnabled)
                    }
                }
                guard generation == attempt else { return }
                saving = false; batchId = id
                showComposer()
            } catch is CancellationError {
                saving = false
                extensionContext?.cancelRequest(withError: CocoaError(.userCancelled))
            } catch { saving = false; showError(error.localizedDescription) }
        }
    }
    private func showComposer() {
        guard let origin, let batchId, let target = ShareComposerSession.composerURL(origin: origin, requestId: batchId) else { return }
        if let webView { status.isHidden = false; progressView.isHidden = true; messageLabel.text = "Opening your post…"; retryButton.isHidden = true; webView.load(URLRequest(url: target)); return }
        let bridge = ShareComposerBridge(origin: origin, requestId: batchId)
        bridge.onComplete = { [weak self] in self?.extensionContext?.completeRequest(returningItems: nil) }
        self.bridge = bridge
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: ShareComposerBridge.name)
        configuration.userContentController.addUserScript(ShareComposerBridge.script(origin: origin))
        let webView = WKWebView(frame: .zero, configuration: configuration)
        self.webView = webView; bridge.webView = webView
        webView.navigationDelegate = self; webView.uiDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.backgroundColor = .systemBackground
        webContainer.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: webContainer.leadingAnchor), webView.trailingAnchor.constraint(equalTo: webContainer.trailingAnchor),
            webView.topAnchor.constraint(equalTo: webContainer.topAnchor), webView.bottomAnchor.constraint(equalTo: webContainer.bottomAnchor)
        ])
        progressView.isHidden = true; messageLabel.text = "Opening your post…"
        webView.load(URLRequest(url: target))
    }
    private func showError(_ message: String) {
        status.isHidden = false; progressView.isHidden = true
        messageLabel.text = message; retryButton.isHidden = false; cancelButton.isEnabled = true
        UIAccessibility.post(notification: .announcement, argument: message)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { status.isHidden = true; titleLabel.text = "Thingtime" }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { showError("Couldn’t open your post. Your shared content is safe on this device. Try again when connected.") }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { self.webView(webView, didFail: navigation, withError: error) }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { showError("The composer was interrupted. Your shared content is safe. Try again to continue.") }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url, url.user == nil, url.password == nil,
              url.scheme == "https" || (origin.map { ShareComposerSession.origin(url) == ShareComposerSession.origin($0) } == true) else { decisionHandler(.cancel); return }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard navigationAction.targetFrame == nil, let url = navigationAction.request.url, url.scheme == "https", url.user == nil, url.password == nil else { return nil }
        webView.load(navigationAction.request)
        return nil
    }
    @objc private func retryTapped() { if batchId != nil { showComposer() } else { startPreparing() } }
    @objc private func cancelTapped() {
        if saving { cancellation?.cancel(); cancelButton.isEnabled = false }
        else { extensionContext?.completeRequest(returningItems: nil) } // Keep the durable draft for recovery.
    }
    deinit { cancellation?.cancel() }
}
