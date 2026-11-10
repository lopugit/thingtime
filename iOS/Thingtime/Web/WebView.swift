import SwiftUI
import UIKit
import WebKit

// A failed protected-Keychain clear fences this request until the user chooses
// another destination or explicitly retries. Ordinary SwiftUI updates cannot retry.
struct DestinationNavigationFence {
    struct Request: Equatable {
        let url: URL
        let id: UUID
    }

    enum Outcome: Equatable { case unchanged, allowed, failed, blocked }
    private(set) var loadedRootURL: URL?
    private(set) var latestRequest: Request?
    private var failedRequest: Request?

    mutating func prepare(_ request: Request, clearAuthority: () -> Bool) -> Outcome {
        latestRequest = request
        guard loadedRootURL != request.url else { return .unchanged }
        guard failedRequest != request else { return .blocked }
        if loadedRootURL != nil && !clearAuthority() {
            failedRequest = request
            return .failed
        }
        failedRequest = nil
        loadedRootURL = request.url
        return .allowed
    }
}

struct AuthenticatorSetupDelivery {
    let id = UUID()
    let url: URL
}

struct WebView: UIViewRepresentable {
    private static let nativeMessageHandlerName = "thingtimeNative"

    let url: URL
    @Binding var widgetPath: String?
    @Binding var authenticatorSetup: AuthenticatorSetupDelivery?
    var destinationRequestID = UUID()
    var onDestinationResult: (URL, UUID, URL, Bool) -> Void = { _, _, _, _ in }

    private var destinationRequest: DestinationNavigationFence.Request {
        .init(url: url, id: destinationRequestID)
    }

    private func reportDestinationResult(_ coordinator: Coordinator, succeeded: Bool) {
        let request = destinationRequest
        guard let activeURL = coordinator.loadedRootURL, coordinator.lastReportedDestinationRequest != request else { return }
        coordinator.lastReportedDestinationRequest = request
        // UIViewRepresentable updates must not synchronously mutate SwiftUI state.
        DispatchQueue.main.async { [weak coordinator] in
            guard coordinator?.destinationNavigation.latestRequest == request else { return }
            onDestinationResult(request.url, request.id, activeURL, succeeded)
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.websiteDataStore = .default()
        configuration.userContentController.addUserScript(Self.bridgeUserScript)
        configuration.userContentController.addUserScript(AuthenticatorSetupBridge.script)
        configuration.userContentController.add(context.coordinator, name: AuthenticatorSetupBridge.handler)
        configuration.userContentController.addUserScript(MobileDeviceBridge.script)
        configuration.userContentController.addUserScript(MobileFolderBridge.script)
        configuration.userContentController.addUserScript(FileExportBridge.script)
        configuration.userContentController.add(context.coordinator, name: Self.nativeMessageHandlerName)

        let webView = ThingtimeWKWebView(frame: .zero, configuration: configuration)
        context.coordinator.webView = webView
        context.coordinator.authenticatorSetup.configure(webView: webView, origin: url)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
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
        _ = context.coordinator.destinationNavigation.prepare(destinationRequest, clearAuthority: { true })
        webView.load(URLRequest(url: url))
        reportDestinationResult(context.coordinator, succeeded: true)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        let rootChanged = context.coordinator.loadedRootURL != url
        if rootChanged { context.coordinator.authenticatorSetup.cancel() }
        // Consume a pending widget request even when it cannot resolve, so a stale
        // value cannot suppress the teardown for a later destination change.
        var widgetTarget = widgetPath.flatMap { URL(string: $0, relativeTo: url)?.absoluteURL }
        if widgetPath != nil { DispatchQueue.main.async { widgetPath = nil } }
        let passwordBridge = context.coordinator.passwordBridge
        let outcome = context.coordinator.destinationNavigation.prepare(
            destinationRequest, clearAuthority: { passwordBridge.clear() }
        )
        if outcome == .failed {
            reportDestinationResult(context.coordinator, succeeded: false)
            return
        }
        guard outcome != .blocked else { return }
        if let delivery = authenticatorSetup, let loaded = context.coordinator.loadedRootURL {
            context.coordinator.authenticatorSetup.configure(webView: webView, origin: loaded)
            context.coordinator.authenticatorSetup.offer(delivery.url, deliveryID: delivery.id)
            // A second setup must not reload the current editor and discard its
            // unsaved draft. Cold/non-editor intake navigates without a seed URL.
            if webView.url?.path != "/passwords" { widgetTarget = loaded.appendingPathComponent("passwords") }
            DispatchQueue.main.async { if authenticatorSetup?.id == delivery.id { authenticatorSetup = nil } }
        }

        guard rootChanged || widgetTarget != nil else {
            reportDestinationResult(context.coordinator, succeeded: true)
            return
        }

        // A destination switch always drops the previous origin's widget content
        // and detaches its queued uploads, even when a widget tap is delivered in
        // the same update. Widget navigation alone stays within the same origin.
        if rootChanged {
            WidgetStore.clear(); context.coordinator.resetChatActivity()
        }
        context.coordinator.mobileDevice.suspend()
        context.coordinator.mobileFolders.suspend()
        context.coordinator.fileExports.suspend()
        context.coordinator.cancelVoice()
        if rootChanged { context.coordinator.suspendRecordingUploads() }
        webView.load(URLRequest(url: widgetTarget ?? url))
        reportDestinationResult(context.coordinator, succeeded: true)
    }

    static let bridgeUserScript = ThingtimeBridgeScript.script

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        weak var webView: WKWebView?
        var destinationNavigation = DestinationNavigationFence()
        var lastReportedDestinationRequest: DestinationNavigationFence.Request?
        var loadedRootURL: URL? { destinationNavigation.loadedRootURL }
        let mobileDevice = MobileDeviceBridge()
        let mobileFolders = MobileFolderBridge()
        let fileExports = FileExportBridge()
        private let lopuVoice = LopuVoiceSessionController()
        private let lopuChats = LopuChatActivityController()
        let passwordBridge = PasswordBridge()
        let authenticatorSetup = AuthenticatorSetupBridge()

        func resetChatActivity() { lopuChats.reset() }
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
            lopuChats.register = { [weak self] root, owner, activityId, token, contextKey, chats in
                await self?.registerChatActivity(root: root, owner: owner, activityId: activityId, token: token, contextKey: contextKey, chats: chats)
            }
            lopuChats.sendToWeb = { [weak self] type, payload in self?.sendToWeb(type: type, payload: payload) }
            lopuVoice.sendToWeb = { [weak self] type, payload in
                self?.sendToWeb(type: type, payload: payload)
            }
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            authenticatorSetup.navigationStarted()
            mobileDevice.suspend()
            mobileFolders.suspend()
            fileExports.suspend()
        }

        // OAuth consent must run in the system browser. Explicit new-window web
        // links retain this app's signed-in page for the session-bound completion.
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            guard navigationAction.targetFrame == nil,
                  navigationAction.navigationType == .linkActivated,
                  let target = navigationAction.request.url,
                  ["https", "http"].contains(target.scheme?.lowercased() ?? ""),
                  target.user == nil, target.password == nil else { return nil }
            UIApplication.shared.open(target)
            return nil
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            (webView as? ThingtimeWKWebView)?.applyThingtimeScrollInsets(forceSafeAreaUpdate: true)

            if let rootURL = loadedRootURL ?? webView.url { ThingtimeNativeNotifications.shared.attach(webView: webView, rootURL: rootURL) }

            sendToWeb(type: "native-ready", payload: [
                "platform": "ios",
                "version": "1.3.0",
                "lopuVoiceVersion": "1.3.0",
                "lopuChatActivityVersion": "1.0.0",
                "notificationsVersion": "1.0.0",
                "devicePairingVersion": "1.0.0",
                "fileAccessVersion": MobileFolderBridge.accessVersion,
                "fileUploadVersion": MobileFolderBridge.uploadVersion,
                "fileExportVersion": FileExportBridge.version,
                "fileStagingVersion": MobileFolderBridge.stagingVersion, "filePublicationVersion": MobileFolderBridge.publicationVersion,
                "watchNotifications": true
            ])
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            if message.name == AuthenticatorSetupBridge.handler { authenticatorSetup.handle(message); return }
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
            if type == "password-provider" {
                guard message.frameInfo.isMainFrame, let webView, let root = loadedRootURL,
                      let current = webView.url, LopuVoiceContract.sameOrigin(current, root),
                      let frameURL = message.frameInfo.request.url, LopuVoiceContract.sameOrigin(frameURL, root),
                      let payload = body["payload"] as? [String: Any], let action = payload["action"] as? String else { return }
                passwordBridge.handle(action: action, ownerId: payload["ownerId"] as? String, webView: webView, root: root) { [weak self] ok, message, status in
                    var response: [String: Any] = ["ok": ok, "message": message, "requestId": payload["requestId"] as? String ?? ""]
                    if let status {
                        response["state"] = status.rawValue
                        response["linked"] = status != .disconnected
                        response["indexSynchronized"] = status == .synchronized
                    }
                    self?.sendToWeb(type: "password-provider-result", payload: response)
                }
                return
            }
            switch type {
            case "file-export":
                guard message.frameInfo.isMainFrame, let webView, let root = loadedRootURL,
                      let current = webView.url, LopuVoiceContract.sameOrigin(current, root),
                      let frame = message.frameInfo.request.url, LopuVoiceContract.sameOrigin(frame, root) else { return }
                fileExports.handle(body, webView: webView, root: root,
                    currentRoot: { [weak self] in self?.loadedRootURL },
                    cookies: { [weak self] values, url in self?.cookies(values, matching: url) ?? [] },
                    reply: { [weak self] type, payload in self?.sendToWeb(type: type, payload: payload) })
            case "mobile-files":
                guard message.frameInfo.isMainFrame, let webView, let root = loadedRootURL,
                      let current = webView.url, LopuVoiceContract.sameOrigin(current, root),
                      let frame = message.frameInfo.request.url, LopuVoiceContract.sameOrigin(frame, root) else { return }
                mobileFolders.handle(body, webView: webView, root: root,
                    currentRoot: { [weak self] in self?.loadedRootURL },
                    cookies: { [weak self] values, url in self?.cookies(values, matching: url) ?? [] },
                    verifyOwner: { [weak self, weak webView] scope, check in
                        guard let self, let webView else { throw CancellationError() }
                        try await self.mobileDevice.verifyOwner(scope, webView: webView,
                            cookies: { [weak self] values, url in self?.cookies(values, matching: url) ?? [] }, check: check)
                    }, verifyDevice: { [weak self, weak webView] scope, deviceId, check in
                        guard let self, let webView else { throw CancellationError() }
                        try await self.mobileDevice.verifyDevice(scope, deviceId: deviceId, webView: webView,
                            cookies: { [weak self] values, url in self?.cookies(values, matching: url) ?? [] }, check: check)
                    }, reply: { [weak self] type, payload in self?.sendToWeb(type: type, payload: payload) })
            case "mobile-device":
                guard message.frameInfo.isMainFrame, let webView, let root = loadedRootURL,
                      let current = webView.url, LopuVoiceContract.sameOrigin(current, root),
                      let frame = message.frameInfo.request.url, LopuVoiceContract.sameOrigin(frame, root) else { return }
                mobileDevice.handle(body, webView: webView, root: root,
                    currentRoot: { [weak self] in self?.loadedRootURL },
                    cookies: { [weak self] values, url in self?.cookies(values, matching: url) ?? [] },
                    reply: { [weak self] type, payload in self?.sendToWeb(type: type, payload: payload) })
            case "lopu-chat-activity-sync":
                guard message.frameInfo.isMainFrame, let webView, let root = loadedRootURL,
                      let current = webView.url, LopuVoiceContract.sameOrigin(current, root),
                      let frameURL = message.frameInfo.request.url, LopuVoiceContract.sameOrigin(frameURL, root),
                      let payload = body["payload"] as? [String: Any],
                      let snapshot = LopuChatActivitySnapshot(payload: payload) else { return }
                lopuChats.sync(snapshot, root: root)
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
                    ownerId: payload["ownerId"] as? String,
                    history: LopuVoiceHistory.bounded(payload["history"] as? [[String: String]] ?? [])
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

        private func registerChatActivity(root: URL, owner: String, activityId: String, token: String?, contextKey: String, chats: [LopuChatActivitySnapshot.Chat]) async {
            guard let webView, loadedRootURL == root, let current = webView.url,
                  LopuVoiceContract.sameOrigin(current, root) else { return }
            var body: [String: Any] = ["ownerId": owner, "activityId": activityId, "contextKey": contextKey]
            if let token {
                body["token"] = token
#if DEBUG
                body["environment"] = "sandbox"
#else
                body["environment"] = "production"
#endif
                body["chats"] = chats.map { ["chatId": $0.chatId, "status": $0.status, "management": $0.management] }
            }
            guard let data = try? JSONSerialization.data(withJSONObject: body), let json = String(data: data, encoding: .utf8) else { return }
            // Cookie and selected-data-source ownership stay inside the current
            // first-party web session. Never persist or transfer its credentials.
            _ = try? await webView.callAsyncJavaScript(
                """
                if (location.origin !== expectedOrigin) return false;
                const manifestResponse = await fetch('/.well-known/thingtime-capabilities.json', {signal: AbortSignal.timeout(10000)});
                const manifest = await manifestResponse.json();
                const version = manifest.features?.['api.lopu-live-activity']?.version;
                if (!manifestResponse.ok || manifest.schemaVersion !== 1 || manifest.origin !== expectedOrigin || !/^1\\.\\d+\\.\\d+$/.test(version ?? '')) return false;
                if (location.origin !== expectedOrigin) return false;
                const response = await fetch('/api/v1/lopu/live-activity', {
                  method, credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(10000),
                  headers: {'Content-Type':'application/json', Accept:'application/json'}, body: bodyJSON
                });
                return response.ok;
                """,
                arguments: ["expectedOrigin": root.scheme! + "://" + root.host! + (root.port.map { ":\($0)" } ?? ""),
                            "bodyJSON": json, "method": token == nil ? "DELETE" : "POST"],
                in: nil, contentWorld: .page
            )
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
