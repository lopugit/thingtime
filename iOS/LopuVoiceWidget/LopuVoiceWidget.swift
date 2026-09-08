import ActivityKit
import SwiftUI
import WidgetKit

@main
struct ThingtimeLopuWidgetBundle: WidgetBundle {
    var body: some Widget {
        LopuVoiceLiveActivity()
    }
}
struct LopuVoiceLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: LopuVoiceActivityAttributes.self) { context in
            HStack(spacing: 12) {
                Text("🦄")
                    .font(.title2)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Lopu · \(context.state.phase)")
                        .font(.headline)
                    Text(context.state.text.isEmpty ? "Voice session is active" : context.state.text)
                        .font(.caption)
                        .lineLimit(2)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                if context.state.transcribeMode {
                    Image(systemName: "quote.bubble.fill")
                        .foregroundStyle(.purple)
                        .accessibilityLabel("Transcribe mode")
                } else {
                    Image(systemName: "waveform")
                        .symbolEffect(.variableColor.iterative)
                        .foregroundStyle(.purple)
                        .accessibilityLabel("Voice conversation")
                }
            }
            .padding(.horizontal, 4)
            .activityBackgroundTint(Color(uiColor: .systemBackground))
            .activitySystemActionForegroundColor(.primary)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text("🦄")
                        .font(.title2)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(spacing: 2) {
                        Text("Lopu · \(context.state.phase)")
                            .font(.headline)
                        Text(context.state.text.isEmpty ? "Voice session is active" : context.state.text)
                            .font(.caption2)
                            .lineLimit(2)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Image(systemName: context.state.transcribeMode ? "quote.bubble.fill" : "waveform")
                        .foregroundStyle(.purple)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text("Open Thingtime to change session settings or stop Lopu.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            } compactLeading: {
                Text("🦄")
            } compactTrailing: {
                Image(systemName: context.state.transcribeMode ? "quote.bubble" : "waveform")
            } minimal: {
                Text("🦄")
            }
            .widgetURL(URL(string: "https://thingtime.com/lopu"))
            .keylineTint(.purple)
        }
    }
}
