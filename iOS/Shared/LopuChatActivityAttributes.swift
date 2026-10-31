import ActivityKit
import Foundation

/// Deliberately contains no account, chat titles, messages or tool output.
struct LopuChatActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var activeCount: Int
        var serverCount: Int
        var phase: String
    }

    var startedAt: Date
}
