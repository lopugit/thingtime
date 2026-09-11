import SwiftUI
import WidgetKit

struct ThingEntry: TimelineEntry {
    let date: Date
    let configuration: ThingWidgetConfiguration
    let snapshot: WidgetSnapshot?
}
struct ThingProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> ThingEntry { .init(date: Date(), configuration: .init(), snapshot: nil) }
    func snapshot(for configuration: ThingWidgetConfiguration, in context: Context) async -> ThingEntry {
        .init(date: Date(), configuration: configuration, snapshot: WidgetStore.read())
    }
    func timeline(for configuration: ThingWidgetConfiguration, in context: Context) async -> Timeline<ThingEntry> {
        let now = Date()
        let snapshot = WidgetStore.read(now: now)
        let entry = ThingEntry(date: now, configuration: configuration, snapshot: snapshot)
        // An explicit expiry entry removes content even if background refresh is delayed.
        let expiry = snapshot?.date.addingTimeInterval(1800) ?? now.addingTimeInterval(1800)
        return Timeline(entries: [entry, ThingEntry(date: expiry, configuration: configuration, snapshot: nil)], policy: .after(expiry))
    }
}
private var homeFamilies: [WidgetFamily] { [.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge] }
private var actionFamilies: [WidgetFamily] {
    #if os(iOS)
    return homeFamilies + [.accessoryCircular, .accessoryRectangular, .accessoryInline]
    #else
    return homeFamilies
    #endif
}
struct ThingtimeActionWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "thingtime.action", intent: ThingWidgetConfiguration.self, provider: ThingProvider()) { entry in
            ActionWidgetView(action: entry.configuration.action, title: entry.configuration.customTitle)
                .containerBackground(.background, for: .widget)
        }.configurationDisplayName("Quick Action").description("One tap to transcribe, talk, create, search, or browse.").supportedFamilies(actionFamilies)
    }
}
struct ThingtimeDashboardWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "thingtime.dashboard", intent: ThingWidgetConfiguration.self, provider: ThingProvider()) { entry in
            DashboardWidgetView(entry: entry).containerBackground(.background, for: .widget)
        }.configurationDisplayName("Thingtime Dashboard").description("Lopu and your everyday actions, together.").supportedFamilies(homeFamilies)
    }
}
struct ThingtimeRenderWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "thingtime.thing", intent: ThingWidgetConfiguration.self, provider: ThingProvider()) { entry in
            RenderThingWidgetView(entry: entry).containerBackground(.background, for: .widget)
        }.configurationDisplayName("Render a Thing").description("Choose a Thing and display its card, note, or value.").supportedFamilies(actionFamilies)
    }
}
struct ThingtimeRecentWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "thingtime.recent", intent: ThingWidgetConfiguration.self, provider: ThingProvider()) { entry in
            RecentThingsWidgetView(entry: entry).containerBackground(.background, for: .widget)
        }.configurationDisplayName("Recent Things").description("Return to the Things you recently created.").supportedFamilies(homeFamilies)
    }
}
struct ActionWidgetView: View {
    @Environment(\.widgetFamily) private var systemFamily
    @Environment(\.widgetPreviewFamily) private var previewFamily
    private var family: WidgetFamily { previewFamily ?? systemFamily }
    let action: WidgetAction
    var title = ""
    var body: some View {
        Group {
            if family.thingtimeInline { Label(title.isEmpty ? action.title : title, systemImage: action.symbol) }
            else if family.thingtimeCircular { Image(systemName: action.symbol).font(.title2) }
            else {
                VStack(alignment: .leading, spacing: 8) {
                    Image(systemName: action.symbol).font(family.thingtimeRectangular ? .body : .largeTitle).widgetAccentable()
                    if !family.thingtimeRectangular { Spacer(minLength: 0) }
                    Text(title.isEmpty ? action.title : title).font(.headline).lineLimit(2).minimumScaleFactor(0.8)
                    if !family.thingtimeRectangular { Text("Thingtime").font(.caption).foregroundStyle(.secondary) }
                }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            }
        }.widgetURL(action.url).accessibilityLabel(title.isEmpty ? action.title : title)
    }
}
struct DashboardWidgetView: View {
    @Environment(\.widgetFamily) private var systemFamily
    @Environment(\.widgetPreviewFamily) private var previewFamily
    private var family: WidgetFamily { previewFamily ?? systemFamily }
    let entry: ThingEntry
    var body: some View {
        if family == .systemSmall { ActionWidgetView(action: entry.configuration.action) }
        else {
            VStack(alignment: .leading, spacing: 12) {
                Label(entry.configuration.customTitle.isEmpty ? "Thingtime" : entry.configuration.customTitle, systemImage: "sparkles").font(.headline).lineLimit(1)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: family == .systemMedium ? 4 : 2), spacing: 10) {
                    ForEach(Array(WidgetAction.allCases.prefix(family == .systemMedium ? 4 : 8)), id: \.self) { action in
                        Link(destination: action.url) {
                            VStack(spacing: 5) {
                                Image(systemName: action.symbol).font(.title2).widgetAccentable()
                                Text(action.title).font(.caption).lineLimit(2).multilineTextAlignment(.center)
                            }.frame(maxWidth: .infinity, minHeight: 48)
                        }.buttonStyle(.plain)
                    }
                }
                Spacer(minLength: 0)
            }.widgetURL(entry.configuration.action.url)
        }
    }
}
struct RenderThingWidgetView: View {
    @Environment(\.widgetFamily) private var systemFamily
    @Environment(\.widgetPreviewFamily) private var previewFamily
    private var family: WidgetFamily { previewFamily ?? systemFamily }
    let entry: ThingEntry
    private var thing: WidgetThing? {
        guard entry.configuration.showContent, let id = entry.configuration.thing?.id else { return nil }
        return entry.snapshot?.things.first { $0.id == id }
    }
    var body: some View {
        if let thing {
            VStack(alignment: .leading, spacing: 8) {
                if family.thingtimeCircular { Image(systemName: "doc.text").font(.title2) }
                else {
                    Text(entry.configuration.customTitle.isEmpty ? thing.title : entry.configuration.customTitle)
                        .font(.headline).lineLimit(2)
                    if !family.thingtimeInline {
                        if entry.configuration.layout == .value {
                            Text(thing.value.isEmpty ? "—" : thing.value).font(.largeTitle.bold()).minimumScaleFactor(0.5).lineLimit(2)
                        } else {
                            Text(thing.text.isEmpty ? thing.kind : thing.text).font(entry.configuration.layout == .note ? .body : .caption)
                                .foregroundStyle(.secondary).lineLimit(family == .systemLarge || family == .systemExtraLarge ? 12 : 4)
                        }
                        Spacer(minLength: 0)
                    }
                }
            }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .privacySensitive().widgetURL(thing.url)
        } else {
            ActionWidgetView(action: .things, title: entry.configuration.showContent ? "Open to refresh your Thing" : "Choose a Thing in Edit Widget")
        }
    }
}
struct RecentThingsWidgetView: View {
    @Environment(\.widgetFamily) private var systemFamily
    @Environment(\.widgetPreviewFamily) private var previewFamily
    private var family: WidgetFamily { previewFamily ?? systemFamily }
    let entry: ThingEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(entry.configuration.customTitle.isEmpty ? "Recent Things" : entry.configuration.customTitle, systemImage: "clock").font(.headline).lineLimit(1)
            if entry.configuration.showContent, let snapshot = entry.snapshot, !snapshot.things.isEmpty {
                ForEach(Array(snapshot.things.prefix(family == .systemSmall ? 2 : family == .systemMedium ? 3 : 7))) { thing in
                    Link(destination: thing.url) {
                        HStack {
                            Image(systemName: "doc.text").foregroundStyle(.secondary)
                            Text(thing.title).font(.subheadline).lineLimit(1)
                            Spacer(minLength: 0)
                        }
                    }.privacySensitive()
                }
                Text(snapshot.date, style: .time).font(.caption2).foregroundStyle(.secondary)
            } else {
                Text("Enable content in Widgets settings, then turn on Show content in Edit Widget.").font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }.widgetURL(WidgetAction.things.url)
    }
}

private extension WidgetFamily {
    var thingtimeInline: Bool {
#if os(iOS)
        return self == .accessoryInline
#else
        return false
#endif
    }
    var thingtimeCircular: Bool {
#if os(iOS)
        return self == .accessoryCircular
#else
        return false
#endif
    }
    var thingtimeRectangular: Bool {
#if os(iOS)
        return self == .accessoryRectangular
#else
        return false
#endif
    }
}

private struct WidgetPreviewFamilyKey: EnvironmentKey { static let defaultValue: WidgetFamily? = nil }
extension EnvironmentValues {
    var widgetPreviewFamily: WidgetFamily? {
        get { self[WidgetPreviewFamilyKey.self] }
        set { self[WidgetPreviewFamilyKey.self] = newValue }
    }
}
