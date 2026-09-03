import Foundation

struct ThingtimeWatchNotification: Codable, Hashable, Identifiable {
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
    let syncedAt: String
    let message: String?

    static let signedOut = ThingtimeWatchSnapshot(
        authenticated: false,
        unreadCount: 0,
        notifications: [],
        syncedAt: ISO8601DateFormatter().string(from: Date()),
        message: "Open Thingtime on your iPhone and sign in to pair this watch."
    )
}

enum ThingtimeWatchWire {
    static let kindKey = "kind"
    static let payloadKey = "payload"
    static let snapshotKind = "notification-snapshot"

    static func message(for snapshot: ThingtimeWatchSnapshot) throws -> [String: Any] {
        [kindKey: snapshotKind, payloadKey: try JSONEncoder().encode(snapshot)]
    }

    static func snapshot(from message: [String: Any]) throws -> ThingtimeWatchSnapshot? {
        guard message[kindKey] as? String == snapshotKind, let data = message[payloadKey] as? Data else {
            return nil
        }
        return try JSONDecoder().decode(ThingtimeWatchSnapshot.self, from: data)
    }
}

private extension String {
    var nonEmpty: String? {
        let value = trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }
}
