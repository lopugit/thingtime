import Foundation
import UIKit
import UserNotifications
import WatchConnectivity
import WebKit

@MainActor
final class ThingtimeNativeNotifications: NSObject {
    static let shared = ThingtimeNativeNotifications()

    private weak var webView: WKWebView?
    private var phoneDeviceToken: String?
    private var watchDeviceToken: String?
    private var refreshTimer: Timer?
    private var isRefreshing = false
    private var requestedAuthorization = false

    private let session: WCSession? = WCSession.isSupported() ? .default : nil

    private override init() {
        super.init()
    }

    func activate() {
        session?.delegate = self
        session?.activate()
    }

    func attach(webView: WKWebView) {
        self.webView = webView
        refreshTimer?.invalidate()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.refresh() }
        }
        Task { await refresh() }
    }

    func setPhoneDeviceToken(_ token: String) {
        phoneDeviceToken = token
        Task { await registerPendingDevices() }
    }

    func recordRegistrationFailure(_ error: Error) {
#if DEBUG
        print("[ThingtimeNativeNotifications] APNs registration unavailable: \(error.localizedDescription)")
#endif
    }

    func receivedRemoteNotification(_ userInfo: [AnyHashable: Any]) {
        Task { await refresh() }
    }

    func openRemoteNotification(_ userInfo: [AnyHashable: Any]) {
        guard let path = userInfo["url"] as? String else {
            Task { await refresh() }
            return
        }
        navigateWebView(to: path)
    }

    private func navigateWebView(to path: String) {
        guard let webView, let baseURL = webView.url, let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else { return }
        guard url.origin == baseURL.origin else { return }
        webView.load(URLRequest(url: url))
    }

    private func requestNotificationAuthorizationIfNeeded() async {
        guard !requestedAuthorization else { return }
        requestedAuthorization = true
        do {
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
            if granted {
                UIApplication.shared.registerForRemoteNotifications()
            }
        } catch {
            recordRegistrationFailure(error)
        }
    }

    private func refresh() async {
        guard !isRefreshing, let webView else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        do {
            let result = try await webView.callAsyncJavaScript(
                """
                const response = await fetch('/api/v1/notifications?limit=20', {
                  credentials: 'same-origin',
                  headers: { Accept: 'application/json' }
                });
                return JSON.stringify({ status: response.status, body: await response.text() });
                """,
                arguments: [:],
                in: nil,
                contentWorld: .page
            )

            guard let raw = result as? String,
                  let envelopeData = raw.data(using: .utf8),
                  let envelope = try JSONSerialization.jsonObject(with: envelopeData) as? [String: Any],
                  let status = envelope["status"] as? Int,
                  let body = envelope["body"] as? String else {
                throw NativeBridgeError.invalidResponse
            }

            guard status == 200 else {
                if status == 401 { publish(.signedOut) }
                return
            }

            guard let bodyData = body.data(using: .utf8) else { throw NativeBridgeError.invalidResponse }
            let response = try JSONDecoder().decode(NotificationsResponse.self, from: bodyData)
            let snapshot = ThingtimeWatchSnapshot(
                authenticated: response.ok,
                unreadCount: response.unreadCount,
                notifications: response.notifications,
                syncedAt: ISO8601DateFormatter().string(from: Date()),
                message: nil
            )
            publish(snapshot)
            await requestNotificationAuthorizationIfNeeded()
            await registerPendingDevices()
        } catch {
#if DEBUG
            print("[ThingtimeNativeNotifications] refresh failed: \(error.localizedDescription)")
#endif
        }
    }

    private func registerPendingDevices() async {
        guard let webView else { return }
        var devices: [[String: String]] = []
        let environment = Self.apnsEnvironment
        if let phoneDeviceToken {
            devices.append(["token": phoneDeviceToken, "platform": "ios", "environment": environment])
        }
        if let watchDeviceToken {
            devices.append(["token": watchDeviceToken, "platform": "watchos", "environment": environment])
        }
        guard !devices.isEmpty,
              let data = try? JSONSerialization.data(withJSONObject: ["devices": devices]),
              let json = String(data: data, encoding: .utf8) else { return }

        do {
            _ = try await webView.callAsyncJavaScript(
                """
                const response = await fetch('/api/v1/notifications/devices', {
                  method: 'POST',
                  credentials: 'same-origin',
                  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                  body: devicesJSON
                });
                return response.status;
                """,
                arguments: ["devicesJSON": json],
                in: nil,
                contentWorld: .page
            )
        } catch {
#if DEBUG
            print("[ThingtimeNativeNotifications] device sync failed: \(error.localizedDescription)")
#endif
        }
    }

    private func markRead(ids: [String]) async {
        guard let webView, !ids.isEmpty,
              let data = try? JSONSerialization.data(withJSONObject: ["ids": Array(ids.prefix(50))]),
              let json = String(data: data, encoding: .utf8) else { return }
        do {
            _ = try await webView.callAsyncJavaScript(
                """
                const response = await fetch('/api/v1/notifications/read', {
                  method: 'POST', credentials: 'same-origin',
                  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                  body: readJSON
                });
                return response.status;
                """,
                arguments: ["readJSON": json],
                in: nil,
                contentWorld: .page
            )
            await refresh()
        } catch {
#if DEBUG
            print("[ThingtimeNativeNotifications] mark-read failed: \(error.localizedDescription)")
#endif
        }
    }

    private func publish(_ snapshot: ThingtimeWatchSnapshot) {
        guard let message = try? ThingtimeWatchWire.message(for: snapshot) else { return }
        do {
            try session?.updateApplicationContext(message)
        } catch {
#if DEBUG
            print("[ThingtimeNativeNotifications] watch snapshot failed: \(error.localizedDescription)")
#endif
        }
    }

    private func handleWatchMessage(_ message: [String: Any], reply: (([String: Any]) -> Void)? = nil) {
        switch message["kind"] as? String {
        case "register-device":
            if let token = message["token"] as? String {
                watchDeviceToken = token
                Task { await registerPendingDevices() }
            }
        case "mark-read":
            let ids = message["ids"] as? [String] ?? []
            Task { await markRead(ids: ids) }
        case "refresh", "pair":
            Task { await refresh() }
        default:
            break
        }
        reply?(["ok": true])
    }

    private static var apnsEnvironment: String {
#if DEBUG
        "sandbox"
#else
        "production"
#endif
    }
}

extension ThingtimeNativeNotifications: WCSessionDelegate {
    nonisolated func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {}

    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}

    nonisolated func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        Task { @MainActor in self.handleWatchMessage(message) }
    }

    nonisolated func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        Task { @MainActor in self.handleWatchMessage(message, reply: replyHandler) }
    }

    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        Task { @MainActor in self.handleWatchMessage(userInfo) }
    }
}

private struct NotificationsResponse: Decodable {
    let ok: Bool
    let notifications: [ThingtimeWatchNotification]
    let unreadCount: Int
}

private enum NativeBridgeError: Error {
    case invalidResponse
}

private extension URL {
    var origin: String {
        guard let scheme, let host else { return absoluteString }
        let suffix = port.map { ":\($0)" } ?? ""
        return "\(scheme)://\(host)\(suffix)"
    }
}
