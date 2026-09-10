import SwiftUI
import UIKit
import WebKit

struct WebView: UIViewRepresentable {
    private static let nativeMessageHandlerName = "thingtimeNative"

    let url: URL
    @Binding var widgetPath: String?

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.websiteDataStore = .default()
        configuration.userContentController.addUserScript(Self.bridgeUserScript)
        configuration.userContentController.add(context.coordinator, name: Self.nativeMessageHandlerName)

        let webView = ThingtimeWKWebView(frame: .zero, configuration: configuration)
        context.coordinator.webView = webView
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = true
        webView.backgroundColor = .white
        webView.scrollView.backgroundColor = .white
        if #available(iOS 15.0, *) {
            webView.underPageBackgroundColor = .white
        }
        webView.scrollView.bounces = false
        webView.scrollView.alwaysBounceVertical = false
        webView.scrollView.alwaysBounceHorizontal = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.applyThingtimeScrollInsets(forceSafeAreaUpdate: true)
        context.coordinator.loadedRootURL = url
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        if let path = widgetPath, let target = URL(string: path, relativeTo: url)?.absoluteURL {
            context.coordinator.cancelVoice()
            context.coordinator.loadedRootURL = url
            webView.load(URLRequest(url: target))
            DispatchQueue.main.async { widgetPath = nil }
            return
        }
        guard context.coordinator.loadedRootURL != url else { return }
        WidgetStore.clear()

        context.coordinator.cancelVoice()
        context.coordinator.suspendRecordingUploads()
        context.coordinator.loadedRootURL = url
        webView.load(URLRequest(url: url))
    }

    static let bridgeUserScript = ThingtimeBridgeScript.script

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        weak var webView: WKWebView?
        var loadedRootURL: URL?
        private let lopuVoice = LopuVoiceSessionController()
        private var pendingVoiceStart = UUID()
        private var pendingRecordingSync = UUID()
        private var recordingOwnerId: String?

        func suspendRecordingUploads() { lopuVoice.suspendRecordingUploads() }

        func cancelVoice() {
            pendingVoiceStart = UUID()
            lopuVoice.stop()
        }

        override init() {
            super.init()
            lopuVoice.sendToWeb = { [weak self] type, payload in
                self?.sendToWeb(type: type, payload: payload)
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            (webView as? ThingtimeWKWebView)?.applyThingtimeScrollInsets(forceSafeAreaUpdate: true)

            if let rootURL = loadedRootURL ?? webView.url { ThingtimeNativeNotifications.shared.attach(webView: webView, rootURL: rootURL) }

            sendToWeb(type: "native-ready", payload: [
                "platform": "ios",
                "version": "1.3.0",
                "lopuVoiceVersion": "1.2.0",
                "notificationsVersion": "1.0.0",
                "watchNotifications": true
            ])
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == WebView.nativeMessageHandlerName else { return }
            guard let body = message.body as? [String: Any], let type = body["type"] as? String else {
                sendToWeb(type: "native-ack", payload: ["received": jsonCompatibleValue(message.body)])
                return
            }
            if type.hasPrefix("widget-") {
                guard message.frameInfo.isMainFrame, let current = webView?.url, let root = loadedRootURL,
                      LopuVoiceContract.sameOrigin(current, root) else { return }
                if type == "widget-state-request" {
                    sendToWeb(type: "widget-state", payload: ["enabled": WidgetStore.enabled])
                } else if type == "widget-clear" { WidgetStore.clear() }
                else if type == "widget-snapshot", let payload = body["payload"] as? [String: Any] {
                    WidgetStore.save(payload, origin: root.absoluteString)
                }
                return
            }
            switch type {
            case "notification-settings":
                guard message.frameInfo.isMainFrame, let webView, let rootURL = loadedRootURL,
                      let currentURL = webView.url, LopuVoiceContract.sameOrigin(currentURL, rootURL),
                      let payload = body["payload"] as? [String: Any], let ownerId = payload["ownerId"] as? String,
                      let action = payload["action"] as? String, ["status", "enable", "open-settings"].contains(action) else { return }
                Task { await ThingtimeNativeNotifications.shared.notificationSettings(action: action, ownerId: ownerId) }

            case "lopu-voice-start", "lopu-voice-recordings-sync":
                guard message.frameInfo.isMainFrame, let webView, let rootURL = loadedRootURL,
                      let currentURL = webView.url, LopuVoiceContract.sameOrigin(currentURL, rootURL) else { return }
                let payload = body["payload"] as? [String: Any] ?? [:]
                let ownerId = payload["ownerId"] as? String
                if recordingOwnerId != ownerId {
                    pendingVoiceStart = UUID()
                    pendingRecordingSync = UUID()
                    recordingOwnerId = ownerId
                }
                let startID = UUID()
                if type == "lopu-voice-recordings-sync" { pendingRecordingSync = startID }
                else { pendingVoiceStart = startID }
                let settings = LopuVoiceSessionController.Settings(
                    textResponse: payload["textResponse"] as? Bool ?? false,
                    transcribeMode: payload["transcribeMode"] as? Bool ?? false,
                    providerId: payload["providerId"] as? String ?? "",
                    sessionId: payload["sessionId"] as? String ?? "voice-\(UUID().uuidString)",
                    inputMode: payload["inputMode"] as? String ?? "native-transcript",
                    model: payload["model"] as? String == "__custom__" ? (payload["customModel"] as? String ?? "") : (payload["model"] as? String ?? ""),
                    effort: payload["effort"] as? String ?? "",
                    speed: payload["speed"] as? String ?? "normal",
                    chatId: payload["chatId"] as? String,
                    ownerId: payload["ownerId"] as? String
                )
                webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
                    let replyURL = URL(string: "/api/v1/lopu/voice/reply", relativeTo: rootURL)?.absoluteURL ?? rootURL
                    let scopedCookies = self?.cookies(cookies, matching: replyURL) ?? []
                    let header = HTTPCookie.requestHeaderFields(with: scopedCookies)["Cookie"] ?? ""
                    Task { @MainActor in
                        guard let self, self.loadedRootURL == rootURL,
                              let currentURL = self.webView?.url, LopuVoiceContract.sameOrigin(currentURL, rootURL),
                              (type == "lopu-voice-recordings-sync" ? self.pendingRecordingSync : self.pendingVoiceStart) == startID else { return }
                        if type == "lopu-voice-recordings-sync" {
                            self.lopuVoice.syncRecordings(ownerId: settings.ownerId, baseURL: rootURL, cookieHeader: header, autoImport: payload["autoImportRecordings"] as? Bool ?? true)
                        } else {
                            self.lopuVoice.start(settings: settings, baseURL: rootURL, cookieHeader: header)
                        }
                    }
                }
            case "lopu-voice-stop":
                cancelVoice()
            default:
                sendToWeb(type: "native-ack", payload: ["received": jsonCompatibleValue(message.body)])
            }
        }

        fileprivate func sendToWeb(type: String, payload: Any) {
            let envelope: [String: Any] = [
                "type": type,
                "payload": jsonCompatibleValue(payload),
                "sentAt": ISO8601DateFormatter().string(from: Date())
            ]

            guard
                let jsonData = try? JSONSerialization.data(withJSONObject: envelope, options: []),
                let json = String(data: jsonData, encoding: .utf8)
            else {
                return
            }

            webView?.evaluateJavaScript(
                "window.thingtimeNativeBridge?.receiveMessageFromNative(\(json));"
            )
        }

        private func cookies(_ cookies: [HTTPCookie], matching url: URL) -> [HTTPCookie] {
            guard let host = url.host?.lowercased() else { return [] }
            let requestPath = url.path.isEmpty ? "/" : url.path
            let isHTTPS = url.scheme?.lowercased() == "https"
            let now = Date()
            return cookies.filter { cookie in
                let domain = cookie.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
                let cookiePath = cookie.path.isEmpty ? "/" : cookie.path
                let domainMatches = host == domain || host.hasSuffix(".\(domain)")
                let pathMatches = requestPath == cookiePath
                    || (cookiePath.hasSuffix("/") && requestPath.hasPrefix(cookiePath))
                    || requestPath.hasPrefix("\(cookiePath)/")
                let secureMatches = !cookie.isSecure || isHTTPS
                let unexpired = cookie.expiresDate.map { $0 > now } ?? true
                return domainMatches && pathMatches && secureMatches && unexpired
            }
        }

        private func jsonCompatibleValue(_ value: Any) -> Any {
            if JSONSerialization.isValidJSONObject(["value": value]) {
                return value
            }

            return String(describing: value)
        }
    }
}

private final class ThingtimeWKWebView: WKWebView {
    private var lastAppliedSafeAreaInsets: UIEdgeInsets?

    override func layoutSubviews() {
        super.layoutSubviews()
        applyThingtimeScrollInsets()
    }

    override func safeAreaInsetsDidChange() {
        super.safeAreaInsetsDidChange()
        applyThingtimeScrollInsets()
    }

    func applyThingtimeScrollInsets(forceSafeAreaUpdate: Bool = false) {
        let currentSafeAreaInsets = resolvedSafeAreaInsets()

        var contentInset = scrollView.contentInset
        contentInset.top = 0
        contentInset.left = 0
        contentInset.right = 0
        contentInset.bottom = 0
        scrollView.contentInset = contentInset

        var indicatorInsets = scrollView.verticalScrollIndicatorInsets
        indicatorInsets.top = currentSafeAreaInsets.top
        indicatorInsets.bottom = currentSafeAreaInsets.bottom
        scrollView.verticalScrollIndicatorInsets = indicatorInsets

        applyNativeSafeAreaVariables(currentSafeAreaInsets, force: forceSafeAreaUpdate)
    }

    private func resolvedSafeAreaInsets() -> UIEdgeInsets {
        var insets = safeAreaInsets

        guard let window else {
            return insets
        }

        let windowInsets = window.safeAreaInsets
        let frameInWindow = convert(bounds, to: window)
        let bottomUnsafeStart = window.bounds.height - windowInsets.bottom
        let rightUnsafeStart = window.bounds.width - windowInsets.right

        insets.top = max(insets.top, windowInsets.top - frameInWindow.minY, 0)
        insets.right = max(insets.right, frameInWindow.maxX - rightUnsafeStart, 0)
        insets.bottom = max(insets.bottom, frameInWindow.maxY - bottomUnsafeStart, 0)
        insets.left = max(insets.left, windowInsets.left - frameInWindow.minX, 0)

        if insets.top < 1, frameInWindow.minY < 1, let statusBarHeight = window.windowScene?.statusBarManager?.statusBarFrame.height {
            insets.top = max(insets.top, statusBarHeight)
        }

        return insets
    }

    private func applyNativeSafeAreaVariables(_ insets: UIEdgeInsets, force: Bool) {
        if !force, let lastAppliedSafeAreaInsets, lastAppliedSafeAreaInsets.isApproximatelyEqual(to: insets) {
            return
        }

        lastAppliedSafeAreaInsets = insets

        let script = """
        (() => {
          const root = document.documentElement;
          if (!root) return;
          const values = {
            top: '\(Self.cssPixels(insets.top))',
            right: '\(Self.cssPixels(insets.right))',
            bottom: '\(Self.cssPixels(insets.bottom))',
            left: '\(Self.cssPixels(insets.left))'
          };
          root.style.setProperty('--thingtime-native-safe-area-top', values.top);
          root.style.setProperty('--thingtime-native-safe-area-right', values.right);
          root.style.setProperty('--thingtime-native-safe-area-bottom', values.bottom);
          root.style.setProperty('--thingtime-native-safe-area-left', values.left);
          root.style.setProperty('--thingtime-safe-area-top', values.top);
          root.style.setProperty('--thingtime-safe-area-right', values.right);
          root.style.setProperty('--thingtime-safe-area-bottom', values.bottom);
          root.style.setProperty('--thingtime-safe-area-left', values.left);
        })();
        """

        evaluateJavaScript(script, completionHandler: nil)
    }

    private static func cssPixels(_ value: CGFloat) -> String {
        "\(Int(ceil(value)))px"
    }
}

private extension UIEdgeInsets {
    func isApproximatelyEqual(to other: UIEdgeInsets) -> Bool {
        abs(top - other.top) < 0.5
            && abs(right - other.right) < 0.5
            && abs(bottom - other.bottom) < 0.5
            && abs(left - other.left) < 0.5
    }
}
