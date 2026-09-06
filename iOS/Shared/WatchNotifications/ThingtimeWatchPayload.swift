import Foundation

struct ThingtimeWatchNotification: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let type: String
    let actorUsername: String?
    let actorName: String?
    let targetId: String?
    let postId: String?
    let preview: String?
    let readAt: String?
    let createdAt: String

    var isUnread: Bool { readAt == nil }

    var displayActor: String {
        actorName?.nonEmpty ?? actorUsername?.nonEmpty ?? "Someone"
    }

    var actionText: String {
        switch type {
        case "friend-request": "sent you a friend request"
        case "friend-accepted": "accepted your friend request"
        case "new-follower": "followed you"
        case "post-from-followed": "shared a new post"
        case "post-from-friend": "shared a post with friends"
        case "comment": "commented on your post"
        case "reply": "replied to your comment"
        case "reaction": "reacted to your post"
        case "share": "shared your post"
        case "mention": "mentioned you"
        case "groups": "sent a group update"
        default: "sent you a Thingtime notification"
        }
    }
}

struct ThingtimeWatchSnapshot: Codable, Equatable {
    let authenticated: Bool
    let unreadCount: Int
    let notifications: [ThingtimeWatchNotification]
    let nextCursor: String?
    let syncedAt: String
    let message: String?
    let accountUsername: String?
    let phoneOrigin: String?
    let phoneBuild: String?

    init(
        authenticated: Bool,
        unreadCount: Int,
        notifications: [ThingtimeWatchNotification],
        nextCursor: String? = nil,
        syncedAt: String,
        message: String?,
        accountUsername: String? = nil,
        phoneOrigin: String? = nil,
        phoneBuild: String? = nil
    ) {
        self.authenticated = authenticated
        self.unreadCount = unreadCount
        self.notifications = notifications
        self.nextCursor = nextCursor
        self.syncedAt = syncedAt
        self.message = message
        self.accountUsername = accountUsername
        self.phoneOrigin = phoneOrigin
        self.phoneBuild = phoneBuild
    }

    static let signedOut = ThingtimeWatchSnapshot(
        authenticated: false,
        unreadCount: 0,
        notifications: [],
        nextCursor: nil,
        syncedAt: ISO8601DateFormatter().string(from: Date()),
        message: "Connect this Watch directly to your Thingtime account."
    )
}

enum ThingtimeWatchNotificationHistoryTarget: String, Codable, Sendable {
    case inbox
    case range
}

struct ThingtimeWatchNotificationHistoryRequest: Codable, Equatable, Sendable {
    let requestId: String
    let target: ThingtimeWatchNotificationHistoryTarget
    let from: String?
    let to: String?
    let cursor: String?
    let limit: Int
}

struct ThingtimeWatchNotificationHistoryPage: Codable, Equatable, Sendable {
    let requestId: String
    let target: ThingtimeWatchNotificationHistoryTarget
    let from: String?
    let to: String?
    let notifications: [ThingtimeWatchNotification]
    let unreadCount: Int
    let nextCursor: String?
}

struct ThingtimeWatchNotificationArchive: Codable, Equatable, Sendable {
    let requestId: String
    let from: String
    let to: String
    let downloadedAt: String
    let notifications: [ThingtimeWatchNotification]
}

enum ThingtimeWatchNotificationHistory {
    static let requestKind = "notification-history-request-v1"
    static let pageKind = "notification-history-page-v1"
    static let archiveRequestKind = "notification-archive-request-v1"
    static let archiveFileKind = "notification-archive-file-v1"
    static let errorKind = "notification-history-error-v1"
    static let pageSize = 10
    static let maximumArchiveNotifications = 500
    static let minimumVersions = ["api.notifications-list": "1.1.0"]

    static func requestMessage(_ request: ThingtimeWatchNotificationHistoryRequest) throws -> [String: Any] {
        [ThingtimeWatchWire.kindKey: requestKind, ThingtimeWatchWire.payloadKey: try JSONEncoder().encode(request)]
    }

    static func archiveRequestMessage(_ request: ThingtimeWatchNotificationHistoryRequest) throws -> [String: Any] {
        [ThingtimeWatchWire.kindKey: archiveRequestKind, ThingtimeWatchWire.payloadKey: try JSONEncoder().encode(request)]
    }

    static func request(from message: [String: Any], kind: String) throws -> ThingtimeWatchNotificationHistoryRequest? {
        guard message[ThingtimeWatchWire.kindKey] as? String == kind,
              let data = message[ThingtimeWatchWire.payloadKey] as? Data else { return nil }
        let request = try JSONDecoder().decode(ThingtimeWatchNotificationHistoryRequest.self, from: data)
        guard UUID(uuidString: request.requestId) != nil,
              request.limit >= 1,
              request.limit <= 50 else { throw ThingtimeWatchNotificationHistoryError.invalidRequest }
        return request
    }

    static func pageMessage(_ page: ThingtimeWatchNotificationHistoryPage) throws -> [String: Any] {
        [ThingtimeWatchWire.kindKey: pageKind, ThingtimeWatchWire.payloadKey: try JSONEncoder().encode(page)]
    }

    static func page(from message: [String: Any]) throws -> ThingtimeWatchNotificationHistoryPage? {
        guard message[ThingtimeWatchWire.kindKey] as? String == pageKind,
              let data = message[ThingtimeWatchWire.payloadKey] as? Data else { return nil }
        return try JSONDecoder().decode(ThingtimeWatchNotificationHistoryPage.self, from: data)
    }

    static func errorMessage(requestId: String, message: String) -> [String: Any] {
        [ThingtimeWatchWire.kindKey: errorKind, "requestId": requestId, "message": String(message.prefix(300))]
    }

    static func archiveTransferMetadata(for archive: ThingtimeWatchNotificationArchive) -> [String: Any] {
        [
            ThingtimeWatchWire.kindKey: archiveFileKind,
            "requestId": archive.requestId,
            "from": archive.from,
            "to": archive.to,
            "count": archive.notifications.count
        ]
    }
}

enum ThingtimeWatchNotificationHistoryError: LocalizedError {
    case invalidRequest

    var errorDescription: String? { "The notification history request is invalid." }
}

enum ThingtimeWatchWire {
    static let kindKey = "kind"
    static let payloadKey = "payload"
    static let snapshotKind = "notification-snapshot"
    static let connectionResultKind = "connection-result-v1"

    static let connectionRetryDelays: [TimeInterval] = [2, 5, 10]

    static func message(for snapshot: ThingtimeWatchSnapshot) throws -> [String: Any] {
        [kindKey: snapshotKind, payloadKey: try JSONEncoder().encode(snapshot)]
    }

    static func snapshot(from message: [String: Any]) throws -> ThingtimeWatchSnapshot? {
        guard message[kindKey] as? String == snapshotKind, let data = message[payloadKey] as? Data else {
            return nil
        }
        return try JSONDecoder().decode(ThingtimeWatchSnapshot.self, from: data)
    }

    static func connectionResult(ok: Bool, message: String) -> [String: Any] {
        [
            kindKey: connectionResultKind,
            "ok": ok,
            "message": String(message.prefix(300))
        ]
    }

    static func connectionResult(from message: [String: Any]) -> (ok: Bool, message: String)? {
        guard message[kindKey] as? String == connectionResultKind,
              let ok = message["ok"] as? Bool,
              let value = message["message"] as? String else { return nil }
        return (ok, value)
    }

    static func connectionRetryDelay(afterAttempt attempt: Int) -> TimeInterval? {
        guard attempt >= 0, attempt < connectionRetryDelays.count else { return nil }
        return connectionRetryDelays[attempt]
    }
}

private extension String {
    var nonEmpty: String? {
        let value = trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }
}
