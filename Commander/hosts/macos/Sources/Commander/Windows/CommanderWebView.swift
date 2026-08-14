import AppKit
import WebKit

@MainActor
final class CommanderWebView: WKWebView, WKNavigationDelegate {
  override var isOpaque: Bool { false }

  var firstPresentationReady: (() -> Void)? {
    didSet {
      if presentationReady { firstPresentationReady?() }
    }
  }
  private var hasCommittedContent = false
  private var presentationReady = false
  private let allowedOrigin: String
  private var surfaceMask: (inset: CGFloat, cornerRadius: CGFloat)?

  init(ready: DaemonReady, surface: String, bridge: CommanderNativeBridge) {
    self.allowedOrigin = URL(string: ready.url)!.commanderOrigin
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    configuration.preferences.isElementFullscreenEnabled = false
    configuration.defaultWebpagePreferences.allowsContentJavaScript = true
    configuration.userContentController.add(bridge, name: "commander")
    super.init(frame: .zero, configuration: configuration)
    bridge.webView = self
    navigationDelegate = self
    Self.makeCanvasTransparent(self)
    allowsMagnification = false
    let url = URL(string: "\(ready.url)/\(surface).html?token=\(ready.sessionToken)")!
    load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10))
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func layout() {
    super.layout()
    updateSurfaceMask()
  }

  func maskToSurface(inset: CGFloat, cornerRadius: CGFloat) {
    surfaceMask = (inset, cornerRadius)
    updateSurfaceMask()
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    Self.makeCanvasTransparent(webView)
    guard !hasCommittedContent else { return }
    hasCommittedContent = true
    // A hidden WKWebView may suppress requestAnimationFrame indefinitely. The
    // completed navigation is the safe gate for ordering its panel onscreen.
    presentationReady = true
    firstPresentationReady?()
  }

  func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
    guard let url = navigationAction.request.url else { return .cancel }
    if url.commanderOrigin == allowedOrigin { return .allow }
    NSWorkspace.shared.open(url)
    return .cancel
  }

  func shutdown() {
    stopLoading()
    firstPresentationReady = nil
    navigationDelegate = nil
    configuration.userContentController.removeScriptMessageHandler(forName: "commander")
  }

  private static func makeCanvasTransparent(_ webView: WKWebView) {
    // WebKit can otherwise composite its rectangular page canvas behind the
    // rounded launcher surface even when the containing NSPanel is clear.
    webView.underPageBackgroundColor = .clear
    webView.setValue(false, forKey: "drawsBackground")
    webView.wantsLayer = true
    webView.layer?.backgroundColor = NSColor.clear.cgColor
    clearBackgroundDrawing(in: webView)
  }

  private static func clearBackgroundDrawing(in view: NSView) {
    if let scrollView = view as? NSScrollView {
      scrollView.drawsBackground = false
      scrollView.backgroundColor = .clear
    }
    if let clipView = view as? NSClipView {
      clipView.drawsBackground = false
      clipView.backgroundColor = .clear
    }
    view.subviews.forEach(clearBackgroundDrawing)
  }

  private func updateSurfaceMask() {
    guard let surfaceMask, let layer else { return }
    let shape = (layer.mask as? CAShapeLayer) ?? CAShapeLayer()
    shape.frame = bounds
    shape.path = CGPath(
      roundedRect: bounds.insetBy(dx: surfaceMask.inset, dy: surfaceMask.inset),
      cornerWidth: surfaceMask.cornerRadius,
      cornerHeight: surfaceMask.cornerRadius,
      transform: nil
    )
    layer.mask = shape
  }
}

private extension URL {
  var commanderOrigin: String {
    let defaultPort = scheme == "https" ? 443 : 80
    return "\(scheme ?? "")://\(host ?? ""):\(port ?? defaultPort)"
  }
}
