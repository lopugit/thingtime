import Foundation
import UserNotifications
import WatchConnectivity
import WatchKit

@MainActor
final class ThingtimeWatchStore: NSObject, ObservableObject {
    static let shared = ThingtimeWatchStore()

    @Published private(set) var snapshot: ThingtimeWatchSnapshot = .signedOut
    @Published private(set) var notificationAuthorization: UNAuthorizationStatus = .notDetermined
    @Published private(set) var connectionMessage: String?

    private let session: WCSession? = WCSession.isSupported() ? .default : nil
    private var deviceToken: String?

    private override init() {
        super.init()
    }

    func activate() {
        session?.delegate = self
        session?.activate()
        if let context = session?.receivedApplicationContext {
            apply(context)
        }
        Task { await refreshAuthorizationStatus() }
    }

    func requestRefresh() {
        send(["kind": "refresh"])
    }

    func requestPairing() {
        connectionMessage = "Open Thingtime on your iPhone and sign in. This watch will pair automatically."
        send(["kind": "pair"])
    }

    func markRead(id: String) {
        guard let index = snapshot.notifications.firstIndex(where: { $0.id == id }) else { return }
        let current = snapshot.notifications[index]
        guard current.isUnread else { return }

        var notifications = snapshot.notifications
        notifications[index] = ThingtimeWatchNotification(
            id: current.id,
            type: current.type,
            actorUsername: current.actorUsername,
            actorName: current.actorName,
            targetId: current.targetId,
            postId: current.postId,
            preview: current.preview,
            readAt: ISO8601DateFormatter().string(from: Date()),
            createdAt: current.createdAt
        )
        snapshot = ThingtimeWatchSnapshot(
            authenticated: true,
            unreadCount: max(0, snapshot.unreadCount - 1),
            notifications: notifications,
            syncedAt: snapshot.syncedAt,
            message: nil
        )
        send(["kind": "mark-read", "ids": [id]], guaranteed: true)
    }

    func enableAlerts() async {
        do {
            _ = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
            await refreshAuthorizationStatus()
            WKApplication.shared().registerForRemoteNotifications()
        } catch {
            connectionMessage = "Thingtime could not request notification permission."
        }
    }

    func setDeviceToken(_ token: String) {
        deviceToken = token
        sendDeviceToken()
    }

    func recordRegistrationFailure(_ error: Error) {
#if DEBUG
        connectionMessage = "Push registration is unavailable in this build."
#endif
    }

    private func refreshAuthorizationStatus() async {
        notificationAuthorization = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    private func sendDeviceToken() {
        guard let deviceToken else { return }
        send(["kind": "register-device", "token": deviceToken], guaranteed: true)
    }

    private func send(_ message: [String: Any], guaranteed: Bool = false) {
        guard let session else { return }
        if guaranteed {
            session.transferUserInfo(message)
        }
        if session.isReachable {
            session.sendMessage(message, replyHandler: nil) { [weak self] _ in
                Task { @MainActor in self?.connectionMessage = "Waiting for Thingtime on iPhone…" }
            }
        }
    }

    private func apply(_ message: [String: Any]) {
        do {
            guard let incoming = try ThingtimeWatchWire.snapshot(from: message) else { return }
            snapshot = incoming
            connectionMessage = incoming.message
        } catch {
            connectionMessage = "Thingtime sent an unreadable watch update."
        }
    }
}

extension ThingtimeWatchStore: WCSessionDelegate {
    nonisolated func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        Task { @MainActor in
            if let context = session.receivedApplicationContext as [String: Any]? {
                self.apply(context)
            }
            self.sendDeviceToken()
            self.requestRefresh()
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        Task { @MainActor in self.apply(applicationContext) }
    }
}
