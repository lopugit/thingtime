import ActivityKit
import Foundation

struct LopuVoiceActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var phase: String
        var text: String
        var transcribeMode: Bool
    }

    var sessionId: String
    var startedAt: Date
}
