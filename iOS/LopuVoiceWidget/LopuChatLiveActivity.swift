import ActivityKit
import SwiftUI
import WidgetKit

struct LopuChatLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: LopuChatActivityAttributes.self) { context in
            HStack(spacing: 12) {
                Text("🦄").font(.title2)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title(context.state)).font(.headline)
                    Text(detail(context.state, stale: context.isStale))
                        .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
                Spacer(minLength: 0)
                Image(systemName: context.state.activeCount > 0 ? "bubble.left.and.bubble.right" : "checkmark.circle")
            }
            .padding()
            .activityBackgroundTint(Color(uiColor: .systemBackground))
            .activitySystemActionForegroundColor(.primary)
            .widgetURL(WidgetAction.chat.url)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { Text("🦄").font(.title2) }
                DynamicIslandExpandedRegion(.center) { Text(title(context.state)).font(.headline).lineLimit(2) }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(detail(context.state, stale: context.isStale)).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
            } compactLeading: { Text("🦄") } compactTrailing: {
                Text(context.isStale ? "…" : "\(context.state.activeCount)").monospacedDigit()
            } minimal: { Text("🦄") }
            .widgetURL(WidgetAction.chat.url)
        }
    }

    private func title(_ state: LopuChatActivityAttributes.ContentState) -> String {
        if state.activeCount == 0 { return state.phase == "needs-attention" ? "Lopu needs your attention" : "Lopu finished" }
        return state.activeCount == 1 ? "Lopu · 1 chat" : "Lopu · \(state.activeCount) chats"
    }

    private func detail(_ state: LopuChatActivityAttributes.ContentState, stale: Bool) -> String {
        if state.activeCount == 0 { return "Open Thingtime to see the result." }
        if stale { return "Open Thingtime for the latest status." }
        if state.phase == "retrying" { return "Resuming work…" }
        if state.serverCount == state.activeCount { return "Working on the server." }
        if state.serverCount > 0 { return "Some chats need Thingtime open." }
        return "Keep Thingtime open for locally managed chats."
    }
}
