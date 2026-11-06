import UIKit
import UserNotifications
import WebKit

@MainActor
final class MobileDeviceLocationBridge {
    static let script = WKUserScript(source: "window.thingtimeNativeBridge.deviceLocationVersion = '1.0.0';",
                                     injectionTime: .atDocumentStart, forMainFrameOnly: true)
    private let verifier = MobileDeviceBridge()
    private var task: Task<Void, Never>?
    private var generation = UUID()
    private var pendingScope: MobileDevicePairing.Scope?
    private var observedScope: MobileDevicePairing.Scope?
    private var statusChanged: (() -> Void)?
    private var observers: [NSObjectProtocol] = []
    init() {
        for name in [MobileDeviceLocation.authorizationChangedNotification, UIScene.didActivateNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.statusChanged?() }
            })
        }
    }
    deinit { for observer in observers { NotificationCenter.default.removeObserver(observer) }; task?.cancel() }
    func invalidate() {
        generation = UUID(); task?.cancel(); task = nil; pendingScope = nil; observedScope = nil; statusChanged = nil
        MobileDeviceLocation.shared.suspendAuthorization()
    }
    func handle(_ body: [String: Any], webView: WKWebView, root: URL,
                currentRoot: @escaping () -> URL?, cookies: @escaping ([HTTPCookie], URL) -> [HTTPCookie],
                reply: @escaping (String, [String: Any]) -> Void) {
        guard let payload = body["payload"] as? [String: Any],
              let id = payload["requestId"] as? String, UUID(uuidString: id) != nil,
              let owner = payload["ownerId"] as? String,
              let action = payload["action"] as? String,
              ["status", "enable", "disable", "request-permission", "request-notification-permission", "open-settings"].contains(action),
              let scope = try? MobileDevicePairing.Scope(ownerId: owner, url: root) else { return }
        let base: [String: Any] = ["requestId": id, "ownerId": owner, "origin": scope.origin.absoluteString]
        func respond(_ value: [String: Any]) { reply("mobile-device-location-result", base.merging(value) { _, new in new }) }
        if action == "disable" {
            if pendingScope == scope || observedScope == scope {
                generation = UUID(); task?.cancel(); task = nil; pendingScope = nil; observedScope = nil; statusChanged = nil
            }
            MobileDeviceLocation.shared.disable(matching: scope)
            respond(MobileDeviceLocation.shared.status(for: scope)); return
        }
        guard task == nil else { respond(["error": "Another location request is still running. Try again shortly."]); return }
        let operation = UUID(); generation = operation; pendingScope = scope
        let identityCheck = { [weak self, weak webView] in
            try Task.checkCancellation()
            guard self?.generation == operation, let current = webView?.url, currentRoot() == root,
                  LopuVoiceContract.sameOrigin(current, root) else { throw CancellationError() }
        }
        let check = {
            try identityCheck()
            guard UIApplication.shared.applicationState == .active else { throw CancellationError() }
        }
        task = Task { [weak self] in
            guard let self else { return }
            defer { if generation == operation { task = nil; pendingScope = nil } }
            do {
                try check()
                try await verifier.verifyOwner(scope, webView: webView, cookies: cookies, check: check)
                guard let record = try MobileDeviceKeychain.load(scope), let device = record.deviceId, !record.revoked else { throw MobileDevicePairing.Failure.revoked }
                try await verifier.verifyDevice(scope, deviceId: device, webView: webView, cookies: cookies, check: check)
                try check()
                MobileDeviceLocation.shared.verified(scope)
                observedScope = scope
                statusChanged = {
                    guard (try? identityCheck()) != nil else { return }
                    Task { @MainActor in
                        let settings = await UNUserNotificationCenter.current().notificationSettings()
                        guard (try? identityCheck()) != nil else { return }
                        var status = MobileDeviceLocation.shared.status(for: scope)
                        status["ownerId"] = owner; status["origin"] = scope.origin.absoluteString
                        switch settings.authorizationStatus {
                        case .authorized: status["notificationAuthorization"] = "allowed"
                        case .provisional, .ephemeral: status["notificationAuthorization"] = "quiet"
                        case .denied: status["notificationAuthorization"] = "denied"
                        default: status["notificationAuthorization"] = "not-requested"
                        }
                        reply("mobile-device-location-changed", status)
                    }
                }
                switch action {
                case "enable":
                    guard let collectionId = payload["collectionId"] as? String else { throw MobileDevicePairing.Failure.invalid }
                    try await MobileDeviceLocationTransport.make().verifyCollection(collectionId, scope: scope, check: check)
                    try check()
                    try MobileDeviceLocation.shared.enable(scope, collectionId: collectionId)
                case "request-permission":
                    MobileDeviceLocation.shared.requestPermission(always: payload["always"] as? Bool == true)
                case "request-notification-permission":
                    await ThingtimeNativeNotifications.shared.notificationSettings(action: "enable", ownerId: scope.ownerId)
                    try identityCheck()
                    MobileDeviceAlerts.shared.approve(scope)
                case "open-settings":
                    respond(MobileDeviceLocation.shared.status(for: scope))
                    if let url = URL(string: UIApplication.openSettingsURLString) { await UIApplication.shared.open(url) }
                    return
                default: MobileDeviceLocation.shared.flush()
                }
                try identityCheck()
                var status = MobileDeviceLocation.shared.status(for: scope)
                let notificationSettings = await UNUserNotificationCenter.current().notificationSettings()
                try identityCheck()
                switch notificationSettings.authorizationStatus {
                case .authorized: status["notificationAuthorization"] = "allowed"
                case .provisional, .ephemeral: status["notificationAuthorization"] = "quiet"
                case .denied: status["notificationAuthorization"] = "denied"
                default: status["notificationAuthorization"] = "not-requested"
                }
                respond(status)
            } catch is CancellationError { }
            catch {
                guard (try? check()) != nil else { return }
                respond(["error": "Location could not be configured. Verify this device connection and retry."])
            }
        }
    }
}
