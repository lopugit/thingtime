#if THINGTIME_LOCAL_DEVELOPMENT
import SwiftUI
import WebKit
import UIKit

/// Opt-in simulator development lane only. Hosted builds do not compile this path.
@MainActor final class ThingtimeLocalRuntime: ObservableObject {
    static let shared = ThingtimeLocalRuntime()
    @Published private(set) var ready = false
    @Published private(set) var failure: String?
    private var started = false
    private var observationRunning = false
    private var editedThingId: String?
    private var ownedDeviceProfile = false
    private let profileOriginKey = "thingtime.local-development.owned-device-origin"
    private let profileInitializedKey = "thingtime.local-development.device-home-initialized"
    private var navigationEvents: [[String: Any]] = []
    private(set) var offlineRules: WKContentRuleList?
    private let files = FileManager.default
    var work: URL { files.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("ThingtimeLocalDevelopment", isDirectory: true) }
    var origin: URL? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "ThingtimeWebURL") as? String,
              let url = URL(string: value), url.scheme == "http", url.host == "127.0.0.1",
              url.port != nil, url.user == nil, url.password == nil,
              url.path.isEmpty || url.path == "/", url.query == nil, url.fragment == nil else { return nil }
        return url
    }

    func start() async {
        guard !started else { return }; started = true
        do {
            guard let origin,
                  let script = Bundle.main.url(forResource: "entry", withExtension: "mjs", subdirectory: "LocalRuntime") else {
                throw LocalError.invalidConfiguration
            }
            try files.createDirectory(at: work, withIntermediateDirectories: true)
            if let saved = UserDefaults.standard.string(forKey: profileOriginKey) {
                ownedDeviceProfile = saved == origin.absoluteString
            } else {
                let store = WKWebsiteDataStore.default()
                let records = await withCheckedContinuation { continuation in
                    store.fetchDataRecords(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes()) { continuation.resume(returning: $0) }
                }
                let cookies = await withCheckedContinuation { continuation in
                    store.httpCookieStore.getAllCookies { continuation.resume(returning: $0) }
                }
                if records.isEmpty && cookies.isEmpty {
                    ownedDeviceProfile = true
                    UserDefaults.standard.set(origin.absoluteString, forKey: profileOriginKey)
                }
            }
            try? files.removeItem(at: work.appendingPathComponent("runtime.json"))
            // Scoped offline acceptance: only this development WebView's external
            // HTTP(S) resources are blocked; host/other simulators are untouched.
            let escaped = NSRegularExpression.escapedPattern(for: origin.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
            let rules: [[String: Any]] = [
                ["trigger": ["url-filter": "^https?://"], "action": ["type": "block"]],
                ["trigger": ["url-filter": "^" + escaped + "/"], "action": ["type": "ignore-previous-rules"]]
            ]
            let encoded = String(data: try JSONSerialization.data(withJSONObject: rules), encoding: .utf8)!
            offlineRules = try await WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "thingtime-local-development-offline", encodedContentRuleList: encoded)
            ThingtimeLocalNode.startScript(script.path, work: work.path, origin: origin.absoluteString)
            let deadline = ContinuousClock.now.advanced(by: .seconds(90))
            while ContinuousClock.now < deadline {
                if let bytes = try? Data(contentsOf: work.appendingPathComponent("runtime.json")),
                   let report = try JSONSerialization.jsonObject(with: bytes) as? [String: Any] {
                    guard report["ready"] as? Bool == true, report["origin"] as? String == origin.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")) else { throw LocalError.startupFailed }
                    let configuration = URLSessionConfiguration.ephemeral
                    configuration.timeoutIntervalForRequest = 10
                    let session = URLSession(configuration: configuration)
                    defer { session.invalidateAndCancel() }
                    let (data, response) = try await session.data(from: origin.appendingPathComponent(".well-known/thingtime-capabilities.json"))
                    let manifest = try JSONSerialization.jsonObject(with: data) as? [String: Any]
                    guard (response as? HTTPURLResponse)?.statusCode == 200,
                          manifest?["origin"] as? String == report["origin"] as? String,
                          manifest?["schemaVersion"] as? Int == 1 else { throw LocalError.startupFailed }
                    let (pageData, pageResponse) = try await session.data(from: origin.appendingPathComponent("things"))
                    let document = String(data: pageData, encoding: .utf8) ?? ""
                    guard (pageResponse as? HTTPURLResponse)?.statusCode == 200, document.contains("<div id=\"root\"") else { throw LocalError.startupFailed }
                    recordNavigation("native-urlsession-things-200", url: origin.appendingPathComponent("things"))
                    ready = true; return
                }
                try await Task.sleep(for: .milliseconds(200))
            }
            throw LocalError.startupFailed
        } catch {
            let receipt: [String: Any] = ["ready": false, "stage": "native-startup", "error": String(describing: error), "cloudFallback": false]
            if let data = try? JSONSerialization.data(withJSONObject: receipt, options: [.prettyPrinted]) {
                try? files.createDirectory(at: work, withIntermediateDirectories: true)
                try? data.write(to: work.appendingPathComponent("startup-error.json"), options: .atomic)
            }
            failure = "Local Thingtime could not start. Reopen this development app after checking its runtime receipt. No cloud fallback was selected." }
    }

    /// Separate native feature contract. It grants only explicit anonymous local
    /// content selection in this owned development profile, never API identity.
    func deviceHomeProof(store: WKWebsiteDataStore) async -> [String: Any] {
        guard ready, ownedDeviceProfile, let origin else { return ["canInitialize": false] }
        let cookies = await withCheckedContinuation { continuation in
            store.httpCookieStore.getAllCookies { continuation.resume(returning: $0) }
        }
        guard cookies.isEmpty else { return ["canInitialize": false] }
        return ["featureVersion": ThingtimeLocalWorkspaceFence.featureVersion, "origin": origin.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")),
                "profile": UserDefaults.standard.bool(forKey: profileInitializedKey) ? "device-only" : "fresh-owned", "canInitialize": true]
    }

    /// Called synchronously on MainActor only after the owning live document
    /// and negotiated capability have been revalidated after the cookie await.
    func commitDeviceHomeSelection() { UserDefaults.standard.set(true, forKey: profileInitializedKey) }

    func recordNavigation(_ stage: String, url: URL?, error: Error? = nil) {
        let state = UIApplication.shared.applicationState
        let stateLabel = state == .active ? "active" : state == .inactive ? "inactive" : "background"
        var item: [String: Any] = ["stage": stage, "at": Date().timeIntervalSince1970, "applicationState": stateLabel]
        if let origin, let url {
            item["originMatched"] = LopuVoiceContract.sameOrigin(url, origin)
            item["path"] = ["/", "/things"].contains(url.path) ? url.path : "other"
        }
        if let error { let native = error as NSError; item["errorDomain"] = native.domain; item["errorCode"] = native.code }
        navigationEvents.append(item)
        if let data = try? JSONSerialization.data(withJSONObject: navigationEvents, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: work.appendingPathComponent("navigation.json"), options: .atomic)
        }
    }

    func observe(_ webView: WKWebView) {
        guard let origin, let url = webView.url, LopuVoiceContract.sameOrigin(url, origin) else { return }
        guard !observationRunning else { return }; observationRunning = true
        guard let script = Bundle.main.url(forResource: "acceptance", withExtension: "js", subdirectory: "LocalRuntime"),
              let source = try? String(contentsOf: script, encoding: .utf8) else { return }
        let phase = editedThingId == nil ? "create-edit" : "reload-read"
        webView.callAsyncJavaScript(source, arguments: ["expectedOrigin": origin.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), "phase": phase, "expectedThingId": editedThingId ?? ""], in: nil, in: .page) { [weak self] result in
            guard let self else { return }
            let report: [String: Any]
            switch result {
            case .success(let value): report = value as? [String: Any] ?? ["error": "Invalid WebView observation"]
            case .failure(let error): report = ["error": error.localizedDescription]
            }
            if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) {
                let filename = phase == "create-edit" ? "ui-edit.json" : "webview.json"
                try? data.write(to: self.work.appendingPathComponent(filename), options: .atomic)
                if phase == "create-edit", report["passed"] as? Bool == true, let id = report["thingId"] as? String {
                    self.editedThingId = id; self.observationRunning = false; webView.reload()
                } else if phase == "create-edit" {
                    try? data.write(to: self.work.appendingPathComponent("webview.json"), options: .atomic)
                }
            }
        }
    }
    private enum LocalError: Error { case invalidConfiguration, startupFailed }
}

struct ThingtimeLocalDevelopmentRoot<Content: View>: View {
    @ObservedObject private var runtime = ThingtimeLocalRuntime.shared
    @ViewBuilder var content: () -> Content
    @Environment(\.scenePhase) private var scenePhase
    @State private var admitted = false
    private func admitIfReady() {
        guard !admitted, runtime.ready, scenePhase == .active, UIApplication.shared.applicationState == .active else { return }
        runtime.recordNavigation("wk-admitted-active", url: runtime.origin)
        admitted = true
    }
    var body: some View {
        Group {
            // Admission is one-shot: backgrounding never tears down an active editor.
            if admitted { content() }
            else {
                VStack(alignment: .leading, spacing: 12) {
                    if let failure = runtime.failure { Text(failure).foregroundStyle(.secondary) }
                    else { HStack(spacing: 8) { ProgressView().controlSize(.small); Text("Starting local Thingtime").foregroundStyle(.secondary) }.accessibilityElement(children: .combine) }
                }.padding().frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading).background(Color.white)
            }
        }
        .onAppear { runtime.recordNavigation("scene-initial-\(scenePhase)", url: runtime.origin); admitIfReady() }
        .onChange(of: scenePhase) { _, phase in runtime.recordNavigation("scene-\(phase)", url: runtime.origin); admitIfReady() }
        .onChange(of: runtime.ready) { _, _ in admitIfReady() }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            runtime.recordNavigation("application-became-active", url: runtime.origin); admitIfReady()
        }
        .task { await runtime.start(); admitIfReady() }
    }
}
#endif
