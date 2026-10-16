import UIKit
import WebKit

private final class MobileDeviceRedirectPolicy: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

@MainActor
final class MobileDeviceBridge {
    static let script = WKUserScript(source: "window.thingtimeNativeBridge.devicePairingVersion = '1.0.0';",
                                     injectionTime: .atDocumentStart, forMainFrameOnly: true)
    private var task: Task<Void, Never>?
    private var generation = UUID()
    private var requestId: String?
    private var observer: NSObjectProtocol?
    private let session: URLSession
    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil; configuration.urlCredentialStorage = nil; configuration.httpShouldSetCookies = false
        session = URLSession(configuration: configuration, delegate: MobileDeviceRedirectPolicy(), delegateQueue: nil)
        observer = NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.suspend() }
        }
    }
    deinit { if let observer { NotificationCenter.default.removeObserver(observer) }; session.invalidateAndCancel(); task?.cancel() }
    func suspend() { generation = UUID(); task?.cancel(); task = nil; requestId = nil }

    func handle(_ body: [String: Any], webView: WKWebView, root: URL,
                currentRoot: @escaping () -> URL?,
                cookies: @escaping ([HTTPCookie], URL) -> [HTTPCookie],
                reply: @escaping (String, [String: Any]) -> Void) {
        guard let payload = body["payload"] as? [String: Any], let id = payload["requestId"] as? String,
              UUID(uuidString: id) != nil, let owner = payload["ownerId"] as? String,
              let action = payload["action"] as? String, ["status", "pair", "suspend"].contains(action),
              let scope = try? MobileDevicePairing.Scope(ownerId: owner, url: root) else { return }
        if action == "suspend" { if requestId == id { suspend() }; return }
        let base: [String: Any] = ["requestId": id, "ownerId": owner, "origin": scope.origin.absoluteString]
        guard task == nil else { reply("mobile-device-result", base.merging(["error": "Another device request is still running. Try again shortly."]) { _, new in new }); return }
        let operation = UUID(); generation = operation; requestId = id
        let check = { [weak self, weak webView] in
            guard self?.generation == operation, let webView, currentRoot() == root,
                  let current = webView.url, LopuVoiceContract.sameOrigin(current, root),
                  UIApplication.shared.applicationState == .active else { throw CancellationError() }
        }
        let engine = MobileDevicePairing(load: MobileDeviceKeychain.load, save: MobileDeviceKeychain.save,
            transport: { [session] request in
                let (bytes, response) = try await session.bytes(for: request)
                guard let http = response as? HTTPURLResponse else { throw MobileDevicePairing.Failure.invalid }
                var data = Data()
                for try await byte in bytes {
                    guard data.count < 512 * 1024 else { throw MobileDevicePairing.Failure.invalid }
                    data.append(byte)
                }
                return (data, http)
            }, cookie: { [weak webView] url in
                try check()
                guard let webView else { throw CancellationError() }
                let all = await webView.configuration.websiteDataStore.httpCookieStore.allCookies()
                try check()
                return HTTPCookie.requestHeaderFields(with: cookies(all, url))["Cookie"] ?? ""
            }, check: check)
        task = Task { [weak self] in
            defer { if self?.generation == operation { self?.task = nil } }
            do {
                let result: MobileDevicePairing.Status
                if action == "pair" {
                    let device = UIDevice.current
                    result = try await engine.pair(scope, descriptor: ["name": device.name, "model": device.model,
                        "osVersion": device.systemVersion, "appVersion": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"])
                } else { result = try await engine.status(scope) }
                try check()
                var response = base; response["state"] = result.state; response["deviceId"] = result.deviceId
                reply("mobile-device-result", response)
            } catch is CancellationError { }
            catch {
                guard (try? check()) != nil else { return }
                let message = (error as? MobileDevicePairing.Failure)?.errorDescription ?? "Device connection could not be checked. Retry to resume saved work."
                reply("mobile-device-result", base.merging(["error": message]) { _, new in new })
            }
        }
    }
}
