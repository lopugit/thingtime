import AppKit
import SwiftUI
import WebKit

@main
struct ThingtimeWidgetsApp: App {
    @NSApplicationDelegateAdaptor(WidgetAppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var model = WidgetBrowserModel.shared
    var body: some Scene {
        Window("Thingtime Widgets", id: "main") {
            WidgetBrowser(model: model)
                .frame(minWidth: 360, minHeight: 500)
                .toolbar {
                    Button { model.open(path: "/things") } label: { Label("My Things", systemImage: "square.grid.2x2") }
                    SettingsLink { Label("Widget settings", systemImage: "slider.horizontal.3") }
                }
                .onReceive(NotificationCenter.default.publisher(for: .thingtimeWidgetAction)) { _ in model.takePending() }
                .onChange(of: scenePhase) { _, phase in if phase == .active { model.takePending() } }
                .onAppear { model.takePending() }
                .onDisappear { model.stopVoice() }
        }.defaultSize(width: 1000, height: 760)
        Settings { NavigationStack { WidgetPreferences() }.frame(width: 500, height: 600) }
    }
}
@MainActor
final class WidgetAppDelegate: NSObject, NSApplicationDelegate {
    static var openMainWindow: (() -> Void)?
    func applicationDidFinishLaunching(_ notification: Notification) { NSWindow.allowsAutomaticWindowTabbing = false }
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls where WidgetRoute.path(for: url) != nil {
            Self.openMainWindow?()
            WidgetBrowserModel.shared.open(url: url)
        }
    }
}
@MainActor
final class WidgetBrowserModel: NSObject, ObservableObject, WKScriptMessageHandler, WKNavigationDelegate {
    static let shared = WidgetBrowserModel()
    let root: URL
    lazy var webView: WKWebView = {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: "thingtimeNative")
        configuration.userContentController.addUserScript(ThingtimeBridgeScript.script)
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = self
        view.allowsBackForwardNavigationGestures = true
        view.load(URLRequest(url: root))
        return view
    }()
    private let voice = LopuVoiceSessionController()
    private var generation = UUID()
    private var syncGeneration = UUID()
    private var ownerID: String?
    override init() {
        let configured = Bundle.main.object(forInfoDictionaryKey: "ThingtimeWebURL") as? String ?? "https://thingtime.com"
        root = URL(string: configured) ?? URL(string: "https://thingtime.com")!
        super.init()
        voice.sendToWeb = { [weak self] type, payload in self?.send(type, payload) }
    }
    func stopVoice() { generation = UUID(); voice.stop() }
    func takePending() { if let url = WidgetActionInbox.take() { open(url: url) } }
    func open(url: URL) { if let path = WidgetRoute.path(for: url) { open(path: path) } }
    func open(path: String) {
        guard let target = URL(string: path, relativeTo: root)?.absoluteURL, LopuVoiceContract.sameOrigin(target, root) else { return }
        generation = UUID()
        voice.stop()
        webView.load(URLRequest(url: target))
        webView.window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if navigationAction.targetFrame?.isMainFrame != false, !LopuVoiceContract.sameOrigin(url, root) {
            if ["https", "http"].contains(url.scheme) { NSWorkspace.shared.open(url) }
            decisionHandler(.cancel)
        } else { decisionHandler(.allow) }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let current = webView.url, LopuVoiceContract.sameOrigin(current, root),
              let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        let payload = body["payload"] as? [String: Any] ?? [:]
        switch type {
        case "widget-state-request": send("widget-state", ["enabled": WidgetStore.enabled])
        case "widget-clear": WidgetStore.clear()
        case "widget-snapshot": WidgetStore.save(payload, origin: root.absoluteString)
        case "lopu-voice-stop": generation = UUID(); voice.stop()
        case "lopu-voice-start", "lopu-voice-recordings-sync":
            let owner = payload["ownerId"] as? String
            if ownerID != owner {
                generation = UUID(); syncGeneration = UUID()
                voice.stop(); voice.suspendRecordingUploads(); ownerID = owner
            }
            let token = UUID()
            if type == "lopu-voice-start" { generation = token } else { syncGeneration = token }
            let settings = LopuVoiceSessionController.Settings(
                textResponse: payload["textResponse"] as? Bool ?? false,
                transcribeMode: payload["transcribeMode"] as? Bool ?? false,
                providerId: payload["providerId"] as? String ?? "",
                sessionId: payload["sessionId"] as? String ?? UUID().uuidString,
                inputMode: payload["inputMode"] as? String ?? "native-transcript",
                model: payload["model"] as? String ?? "", effort: payload["effort"] as? String ?? "",
                speed: payload["speed"] as? String ?? "normal", chatId: payload["chatId"] as? String, ownerId: payload["ownerId"] as? String)
            webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
                Task { @MainActor in
                    guard let self, (type == "lopu-voice-start" ? self.generation : self.syncGeneration) == token, let current = self.webView.url, LopuVoiceContract.sameOrigin(current, self.root) else { return }
                    let host = self.root.host?.lowercased() ?? ""
                    let scoped = cookies.filter { cookie in
                        let domain = cookie.domain.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
                        return (host == domain || host.hasSuffix("." + domain)) && (!cookie.isSecure || self.root.scheme == "https") && (cookie.expiresDate.map { $0 > Date() } ?? true) && cookie.path == "/"
                    }
                    let header = HTTPCookie.requestHeaderFields(with: scoped)["Cookie"] ?? ""
                    if type == "lopu-voice-start" { self.voice.start(settings: settings, baseURL: self.root, cookieHeader: header) }
                    else { self.voice.syncRecordings(ownerId: settings.ownerId, baseURL: self.root, cookieHeader: header) }
                }
            }
        default: break
        }
    }
    private func send(_ type: String, _ payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: ["type": type, "payload": payload]), let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.thingtimeNativeBridge?.receiveMessageFromNative(\(json))")
    }
}
struct WidgetBrowser: NSViewRepresentable {
    @Environment(\.openWindow) private var openWindow
    @ObservedObject var model: WidgetBrowserModel
    func makeNSView(context: Context) -> WKWebView {
        WidgetAppDelegate.openMainWindow = { openWindow(id: "main") }
        return model.webView
    }
    func updateNSView(_ view: WKWebView, context: Context) {}
}
