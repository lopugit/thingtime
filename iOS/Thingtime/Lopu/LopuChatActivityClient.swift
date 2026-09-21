import ActivityKit
import UIKit

/// Narrow adapter makes lifecycle races testable without APNs/device entitlements.
@MainActor
struct LopuChatActivityClient {
    typealias Content = ActivityContent<LopuChatActivityAttributes.ContentState>
    struct Handle {
        let id: String
        let state: () -> ActivityState
        let update: (Content) async -> Void
        let end: (Content?, ActivityUIDismissalPolicy) async -> Void
        let observeToken: (@escaping (String) async -> Void) -> Task<Void, Never>
    }
    var activities: () -> [Handle]
    var request: (Content) throws -> Handle
    var enabled: () -> Bool
    var foreground: () -> Bool

    static var system: Self {
        .init(activities: { Activity<LopuChatActivityAttributes>.activities.map(wrap) }, request: { content in
            wrap(try Activity.request(attributes: LopuChatActivityAttributes(startedAt: Date()), content: content, pushType: .token))
        }, enabled: { ActivityAuthorizationInfo().areActivitiesEnabled }, foreground: { UIApplication.shared.applicationState == .active })
    }

    private static func wrap(_ activity: Activity<LopuChatActivityAttributes>) -> Handle {
        .init(id: activity.id, state: { activity.activityState }, update: { await activity.update($0) },
              end: { await activity.end($0, dismissalPolicy: $1) }, observeToken: { receive in
            Task {
                for await bytes in activity.pushTokenUpdates {
                    guard !Task.isCancelled else { return }
                    await receive(bytes.map { String(format: "%02x", $0) }.joined())
                }
            }
        })
    }
}
