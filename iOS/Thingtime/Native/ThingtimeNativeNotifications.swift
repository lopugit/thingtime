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
    private let attachmentUploader = ThingtimeWatchAttachmentUploader()

    private let session: WCSession? = WCSession.isSupported() ? .default : nil

    private override init() {
        super.init()
        attachmentUploader.resultHandler = { [weak self] result in
            self?.sendAttachmentResult(result)
        }
    }

    func activate() {
        session?.delegate = self
        session?.activate()
    }

    func attach(webView: WKWebView) {
        self.webView = webView
        attachmentUploader.attach(webView: webView)
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

    @discardableResult
    private func refresh() async -> RefreshOutcome {
        guard let webView else {
            return .failure("Open Thingtime on your iPhone to reconnect this Watch.")
        }
        guard !isRefreshing else {
            return .failure("Thingtime on iPhone is already checking your connection. Try again in a moment.")
        }
        isRefreshing = true
        defer { isRefreshing = false }

        do {
            let result = try await webView.callAsyncJavaScript(
                """
                const response = await fetch('/api/v1/notifications?limit=10', {
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
                if status == 401 {
                    publish(.signedOut)
                    return .snapshot(.signedOut)
                }
                return .failure("The iPhone reached Thingtime, but notification refresh returned HTTP \(status).")
            }

            guard let bodyData = body.data(using: .utf8) else { throw NativeBridgeError.invalidResponse }
            let response = try JSONDecoder().decode(NotificationsResponse.self, from: bodyData)
            let snapshot = ThingtimeWatchSnapshot(
                authenticated: response.ok,
                unreadCount: response.unreadCount,
                notifications: response.notifications,
                nextCursor: response.nextCursor,
                syncedAt: ISO8601DateFormatter().string(from: Date()),
                message: nil
            )
            publish(snapshot)
            await requestNotificationAuthorizationIfNeeded()
            await registerPendingDevices()
            attachmentUploader.processPending()
            return .snapshot(snapshot)
        } catch {
#if DEBUG
            print("[ThingtimeNativeNotifications] refresh failed: \(error.localizedDescription)")
#endif
            return .failure("Thingtime on iPhone couldn’t refresh. Check its connection, then retry from the Watch.")
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

    private func sendAttachmentResult(_ result: ThingtimeWatchAttachmentUploader.Result) {
        let message = result.transferDictionary
        session?.transferUserInfo(message)
        guard session?.isReachable == true else { return }
        session?.sendMessage(message, replyHandler: nil) { error in
#if DEBUG
            print("[ThingtimeNativeNotifications] immediate watch result failed: \(error.localizedDescription)")
#endif
        }
    }

    private func sendGuaranteedWatchMessage(_ message: [String: Any]) {
        guard let session else { return }
        guard session.isReachable else {
            session.transferUserInfo(message)
            return
        }
        session.sendMessage(message, replyHandler: nil) { error in
            session.transferUserInfo(message)
#if DEBUG
            print("[ThingtimeNativeNotifications] immediate watch message failed: \(error.localizedDescription)")
#endif
        }
    }

    private func fetchNotificationHistory(_ request: ThingtimeWatchNotificationHistoryRequest) async {
        do {
            try await verifyHistoryCapabilities()
            let response = try await notificationPage(request: request, limit: request.limit, cursor: request.cursor)
            let page = ThingtimeWatchNotificationHistoryPage(
                requestId: request.requestId,
                target: request.target,
                from: request.from,
                to: request.to,
                notifications: response.notifications,
                unreadCount: response.unreadCount,
                nextCursor: response.nextCursor
            )
            sendGuaranteedWatchMessage(try ThingtimeWatchNotificationHistory.pageMessage(page))
        } catch {
            sendGuaranteedWatchMessage(ThingtimeWatchNotificationHistory.errorMessage(
                requestId: request.requestId,
                message: error.localizedDescription
            ))
        }
    }

    private func downloadNotificationArchive(_ request: ThingtimeWatchNotificationHistoryRequest) async {
        do {
            guard let from = request.from, let to = request.to else {
                throw NativeBridgeError.invalidHistoryWindow
            }
            try await verifyHistoryCapabilities()
            var notifications: [ThingtimeWatchNotification] = []
            var cursor: String?
            var seenCursors = Set<String>()
            repeat {
                let response = try await notificationPage(request: request, limit: 50, cursor: cursor)
                notifications.append(contentsOf: response.notifications)
                cursor = response.nextCursor
                if let cursor, !seenCursors.insert(cursor).inserted {
                    throw NativeBridgeError.repeatedHistoryCursor
                }
            } while cursor != nil && notifications.count < ThingtimeWatchNotificationHistory.maximumArchiveNotifications

            if notifications.count > ThingtimeWatchNotificationHistory.maximumArchiveNotifications {
                notifications = Array(notifications.prefix(ThingtimeWatchNotificationHistory.maximumArchiveNotifications))
            }
            let archive = ThingtimeWatchNotificationArchive(
                requestId: request.requestId,
                from: from,
                to: to,
                downloadedAt: ISO8601DateFormatter().string(from: Date()),
                notifications: notifications
            )
            let fileURL = try Self.persistNotificationArchive(archive)
            guard let session else { throw NativeBridgeError.watchUnavailable }
            session.transferFile(fileURL, metadata: ThingtimeWatchNotificationHistory.archiveTransferMetadata(for: archive))
        } catch {
            sendGuaranteedWatchMessage(ThingtimeWatchNotificationHistory.errorMessage(
                requestId: request.requestId,
                message: error.localizedDescription
            ))
        }
    }

    private func notificationPage(
        request: ThingtimeWatchNotificationHistoryRequest,
        limit: Int,
        cursor: String?
    ) async throws -> NotificationsResponse {
        var components = URLComponents()
        components.path = "/api/v1/notifications"
        components.queryItems = [URLQueryItem(name: "limit", value: String(limit))]
        if let from = request.from { components.queryItems?.append(URLQueryItem(name: "from", value: from)) }
        if let to = request.to { components.queryItems?.append(URLQueryItem(name: "to", value: to)) }
        if let cursor { components.queryItems?.append(URLQueryItem(name: "cursor", value: cursor)) }
        guard let path = components.string else { throw NativeBridgeError.invalidResponse }
        let json = try await fetchJSON(path: path)
        let data = try JSONSerialization.data(withJSONObject: json)
        return try JSONDecoder().decode(NotificationsResponse.self, from: data)
    }

    private func verifyHistoryCapabilities() async throws {
        let manifest = try await fetchJSON(path: "/.well-known/thingtime-capabilities.json")
        guard let features = manifest["features"] as? [String: Any] else {
            throw NativeBridgeError.historyUnavailable
        }
        for (feature, minimum) in ThingtimeWatchNotificationHistory.minimumVersions {
            let raw = features[feature]
            let actual = raw as? String ?? (raw as? [String: Any])?["version"] as? String
            guard let actual, ThingtimeWatchUploadRequirements.satisfies(actual: actual, minimum: minimum) else {
                throw NativeBridgeError.historyUnavailable
            }
        }
    }

    private func fetchJSON(path: String) async throws -> [String: Any] {
        guard let webView else { throw NativeBridgeError.openPhone }
        let result = try await webView.callAsyncJavaScript(
            """
            const response = await fetch(requestPath, {
              credentials: 'same-origin',
              headers: { Accept: 'application/json' }
            });
            return JSON.stringify({ status: response.status, body: await response.text() });
            """,
            arguments: ["requestPath": path],
            in: nil,
            contentWorld: .page
        )
        guard let raw = result as? String,
              let envelopeData = raw.data(using: .utf8),
              let envelope = try JSONSerialization.jsonObject(with: envelopeData) as? [String: Any],
              let status = envelope["status"] as? Int,
              let responseBody = envelope["body"] as? String,
              let responseData = responseBody.data(using: .utf8),
              let json = try JSONSerialization.jsonObject(with: responseData) as? [String: Any] else {
            throw NativeBridgeError.invalidResponse
        }
        guard (200..<300).contains(status), json["ok"] as? Bool != false else {
            if status == 401 { throw NativeBridgeError.openPhone }
            throw NativeBridgeError.server(json["error"] as? String ?? "Thingtime returned HTTP \(status).")
        }
        return json
    }

    nonisolated private static func persistNotificationArchive(_ archive: ThingtimeWatchNotificationArchive) throws -> URL {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("NotificationArchiveOutbox", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent(archive.requestId).appendingPathExtension("json")
        try JSONEncoder().encode(archive).write(to: url, options: .atomic)
        return url
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
            Task {
                let outcome = await refresh()
                guard let reply else { return }
                switch outcome {
                case let .snapshot(snapshot):
                    if var message = try? ThingtimeWatchWire.message(for: snapshot) {
                        message["ok"] = true
                        reply(message)
                    } else {
                        reply(ThingtimeWatchWire.connectionResult(
                            ok: false,
                            message: "Thingtime on iPhone couldn’t prepare its Watch status."
                        ))
                    }
                case let .failure(message):
                    reply(ThingtimeWatchWire.connectionResult(ok: false, message: message))
                }
            }
            return
        case ThingtimeWatchNotificationHistory.requestKind:
            if let request = try? ThingtimeWatchNotificationHistory.request(
                from: message,
                kind: ThingtimeWatchNotificationHistory.requestKind
            ) {
                Task { await fetchNotificationHistory(request) }
            }
        case ThingtimeWatchNotificationHistory.archiveRequestKind:
            if let request = try? ThingtimeWatchNotificationHistory.request(
                from: message,
                kind: ThingtimeWatchNotificationHistory.archiveRequestKind
            ) {
                Task { await downloadNotificationArchive(request) }
            }
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

    nonisolated func session(_ session: WCSession, didReceive file: WCSessionFile) {
        do {
            _ = try ThingtimeWatchAttachmentUploader.persistIncoming(file)
            Task { @MainActor in self.attachmentUploader.processPending() }
        } catch {
#if DEBUG
            print("[ThingtimeNativeNotifications] incoming watch attachment failed: \(error.localizedDescription)")
#endif
        }
    }

    nonisolated func session(
        _ session: WCSession,
        fileTransfer: WCSessionFileTransfer,
        didFinishWithError error: Error?
    ) {
        guard fileTransfer.file.metadata?[ThingtimeWatchWire.kindKey] as? String == ThingtimeWatchNotificationHistory.archiveFileKind,
              error == nil else { return }
        try? FileManager.default.removeItem(at: fileTransfer.file.fileURL)
    }
}

private struct NotificationsResponse: Decodable {
    let ok: Bool
    let notifications: [ThingtimeWatchNotification]
    let unreadCount: Int
    let nextCursor: String?
}

private enum RefreshOutcome {
    case snapshot(ThingtimeWatchSnapshot)
    case failure(String)
}

private enum NativeBridgeError: LocalizedError {
    case invalidResponse
    case invalidHistoryWindow
    case repeatedHistoryCursor
    case watchUnavailable
    case historyUnavailable
    case openPhone
    case server(String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse: "Thingtime returned an unreadable notification response."
        case .invalidHistoryWindow: "Choose a valid notification date or range."
        case .repeatedHistoryCursor: "Thingtime repeated a notification page. Try the download again."
        case .watchUnavailable: "The paired Apple Watch is unavailable."
        case .historyUnavailable: "This Thingtime needs the notification history API before the Watch can download a period."
        case .openPhone: "Open Thingtime on your iPhone and sign in to fetch notification history."
        case let .server(message): message
        }
    }
}

private extension URL {
    var origin: String {
        guard let scheme, let host else { return absoluteString }
        let suffix = port.map { ":\($0)" } ?? ""
        return "\(scheme)://\(host)\(suffix)"
    }
}
