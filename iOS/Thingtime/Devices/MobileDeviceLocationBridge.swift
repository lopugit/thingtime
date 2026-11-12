import UIKit
import UserNotifications
import WebKit

@MainActor
final class MobileDeviceLocationBridge {
    static let script = WKUserScript(source: "window.thingtimeNativeBridge.deviceLocationVersion = '1.2.0';",
                                     injectionTime: .atDocumentStart, forMainFrameOnly: true)
    typealias Verification = (MobileDevicePairing.Scope, WKWebView, @escaping ([HTTPCookie], URL) -> [HTTPCookie], @escaping () throws -> Void) async throws -> Void
    private let location: MobileDeviceLocation
    private let verify: Verification
    private let appIsActive: () -> Bool
    private var task: Task<Void, Never>?
    private var generation = UUID()
    private var pendingScope: MobileDevicePairing.Scope?
    private var observedScope: MobileDevicePairing.Scope?
    private var statusChanged: (() -> Void)?
    private var observers: [NSObjectProtocol] = []
    convenience init() {
        let verifier = MobileDeviceBridge()
        self.init(location: .shared, verify: { scope, webView, cookies, check in
            try await verifier.verifyOwner(scope, webView: webView, cookies: cookies, check: check)
            guard let record = try MobileDeviceKeychain.load(scope), let device = record.deviceId, !record.revoked else { throw MobileDevicePairing.Failure.revoked }
            try await verifier.verifyDevice(scope, deviceId: device, webView: webView, cookies: cookies, check: check)
        })
    }
    init(location: MobileDeviceLocation,
         appIsActive: @escaping () -> Bool = { UIApplication.shared.applicationState == .active },
         verify: @escaping Verification) {
        self.location = location; self.appIsActive = appIsActive; self.verify = verify
        for name in [MobileDeviceLocation.authorizationChangedNotification, UIScene.didActivateNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.statusChanged?() }
            })
        }
    }
    deinit { for observer in observers { NotificationCenter.default.removeObserver(observer) }; task?.cancel() }
    func invalidate() {
        generation = UUID(); task?.cancel(); task = nil; pendingScope = nil; observedScope = nil; statusChanged = nil
        location.suspendAuthorization()
    }
    func handle(_ body: [String: Any], webView: WKWebView, root: URL,
                currentRoot: @escaping () -> URL?, cookies: @escaping ([HTTPCookie], URL) -> [HTTPCookie],
                reply: @escaping (String, [String: Any]) -> Void) {
        guard let payload = body["payload"] as? [String: Any],
              let id = payload["requestId"] as? String, UUID(uuidString: id) != nil,
              let owner = payload["ownerId"] as? String,
              let action = payload["action"] as? String,
              ["status", "enable", "disable", "suspend", "request-permission", "request-notification-permission", "open-settings"].contains(action),
              let scope = try? MobileDevicePairing.Scope(ownerId: owner, url: root) else { return }
        let base: [String: Any] = ["requestId": id, "ownerId": owner, "origin": scope.origin.absoluteString]
        func respond(_ value: [String: Any]) { reply("mobile-device-location-result", base.merging(value) { _, new in new }) }
        if action == "disable" || action == "suspend" {
            if pendingScope == scope || observedScope == scope {
                generation = UUID(); task?.cancel(); task = nil; pendingScope = nil; observedScope = nil; statusChanged = nil
            }
            if action == "disable" { location.disable(matching: scope) }
            else { location.suspendAuthorization(matching: scope) }
            respond(location.status(for: scope)); return
        }
        guard task == nil else { respond(["error": "Another location request is still running. Try again shortly."]); return }
        let operation = UUID(); generation = operation; pendingScope = scope
        let identityCheck = { [weak self, weak webView] in
            try Task.checkCancellation()
            guard self?.generation == operation, let current = webView?.url, currentRoot() == root,
                  LopuVoiceContract.sameOrigin(current, root) else { throw CancellationError() }
        }
        let check = { [appIsActive] in
            try identityCheck()
            guard appIsActive() else { throw CancellationError() }
        }
        task = Task { [weak self] in
            guard let self else { return }
            defer { if generation == operation { task = nil; pendingScope = nil } }
            do {
                try check()
                try await verify(scope, webView, cookies, check)
                try check()
                location.verified(scope)
                observedScope = scope
                statusChanged = { [weak self] in
                    guard self != nil, (try? identityCheck()) != nil else { return }
                    Task { @MainActor [weak self] in
                        guard let self else { return }
                        let settings = await UNUserNotificationCenter.current().notificationSettings()
                        guard (try? identityCheck()) != nil else { return }
                        var status = self.location.status(for: scope)
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
                    try location.enable(scope, collectionId: collectionId)
                case "request-permission":
                    location.requestPermission(always: payload["always"] as? Bool == true)
                case "request-notification-permission":
                    await ThingtimeNativeNotifications.shared.notificationSettings(action: "enable", ownerId: scope.ownerId)
                    try identityCheck()
                    MobileDeviceAlerts.shared.approve(scope)
                case "open-settings":
                    respond(location.status(for: scope))
                    if let url = URL(string: UIApplication.openSettingsURLString) { await UIApplication.shared.open(url) }
                    return
                default: location.flush()
                }
                try identityCheck()
                var status = location.status(for: scope)
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
