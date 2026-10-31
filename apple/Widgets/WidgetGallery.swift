import SwiftUI
import WidgetKit

/// Uses the actual widget views so desktop and mobile layout checks exercise
/// the same text limits, spacing and dynamic-type behavior as WidgetKit.
struct WidgetGallery: View {
    private var entry: ThingEntry {
        var configuration = ThingWidgetConfiguration()
        configuration.showContent = true
        configuration.thing = WidgetThingEntity(id: "sample", title: "An idea worth keeping")
        return ThingEntry(date: Date(), configuration: configuration, snapshot: WidgetSnapshot(owner: "preview", origin: "preview", date: Date(), things: [
            WidgetThing(id: "sample", title: "An idea worth keeping", text: "A quiet space for thoughts, notes, and the next thing you want to make.", kind: "Note", value: "42"),
            WidgetThing(id: "sample2", title: "A very long Thing title that should stay within the widget bounds", text: "", kind: "Note", value: "")
        ]))
    }
    var body: some View {
        ScrollView([.vertical]) {
            VStack(alignment: .leading, spacing: 24) {
                Text("A little Thingtime, everywhere.").font(.title.bold())
                Text("Layout previews · sample content").foregroundStyle(.secondary)
                ActionWidgetView(action: .transcribe).environment(\.widgetPreviewFamily, .systemSmall).frame(width: 138, height: 138).padding(16).background(.quaternary, in: RoundedRectangle(cornerRadius: 22))
                DashboardWidgetView(entry: entry).environment(\.widgetPreviewFamily, .systemMedium).frame(maxWidth: 330).frame(height: 145).padding(16).background(.quaternary, in: RoundedRectangle(cornerRadius: 22))
                RenderThingWidgetView(entry: entry).environment(\.widgetPreviewFamily, .systemMedium).frame(maxWidth: 330).frame(height: 145).padding(16).background(.quaternary, in: RoundedRectangle(cornerRadius: 22))
                DashboardWidgetView(entry: entry).environment(\.widgetPreviewFamily, .systemLarge).frame(maxWidth: 330).frame(height: 350).padding(16).background(.quaternary, in: RoundedRectangle(cornerRadius: 22))
                RecentThingsWidgetView(entry: entry).environment(\.widgetPreviewFamily, .systemLarge).frame(maxWidth: 330).frame(height: 280).padding(16).background(.quaternary, in: RoundedRectangle(cornerRadius: 22))
            }.padding(20).frame(maxWidth: .infinity, alignment: .center)
        }.navigationTitle("Widget gallery")
    }
}
