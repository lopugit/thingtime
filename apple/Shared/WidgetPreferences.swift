import SwiftUI

struct WidgetPreferences: View {
    @State private var enabled = WidgetStore.enabled
    var body: some View {
        Form {
            Section("Thing content") {
                Toggle("Show my Things in widgets", isOn: $enabled)
                    .onChange(of: enabled) { _, value in WidgetStore.setEnabled(value) }
                Text("Off by default. When enabled, up to 50 recent Things are copied from your signed-in app to this device’s widget storage. Content may be visible on your desktop or Lock Screen. Copies expire after 30 minutes without a refresh.")
                    .font(.caption).foregroundStyle(.secondary)
                Button("Clear widget content") { WidgetStore.clear() }
            }
            Section("Make it yours") {
                NavigationLink("Preview widget layouts") { WidgetGallery() }
                Text("Add Thingtime widgets from the system widget gallery. Edit a widget to choose an action, a Thing, a title, and a card, note, or value layout. Open My Things to refresh the available selection.")
                Text("On iPhone, add Lopu, New Thing, or Search from Control Centre’s Add a Control gallery. Drag a control’s resize handle for the sizes offered by iOS.")
                Text("Voice actions open Thingtime and start listening after sign-in and microphone permission. New Thing opens the schema chooser; New Folder opens its naming dialog.")
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Widgets")
        .frame(minWidth: 280, minHeight: 360)
    }
}
