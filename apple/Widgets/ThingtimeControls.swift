#if os(iOS)
import SwiftUI
import WidgetKit

@available(iOS 18.0, *)
struct ThingtimeTranscribeControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "thingtime.control.transcribe") {
            ControlWidgetButton(action: OpenThingtimeAction(.transcribe)) { Label("Transcribe", systemImage: "waveform") }
        }.displayName("Transcribe with Lopu").description("Open Thingtime and start a transcription session.")
    }
}
@available(iOS 18.0, *)
struct ThingtimeVoiceControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "thingtime.control.voice") {
            ControlWidgetButton(action: OpenThingtimeAction(.voice)) { Label("Talk to Lopu", systemImage: "mic.fill") }
        }.displayName("Talk to Lopu").description("Open a Lopu voice conversation.")
    }
}
@available(iOS 18.0, *)
struct ThingtimeNewControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "thingtime.control.new") {
            ControlWidgetButton(action: OpenThingtimeAction(.newThing)) { Label("New Thing", systemImage: "plus") }
        }.displayName("New Thing").description("Choose a schema and create a Thing.")
    }
}
@available(iOS 18.0, *)
struct ThingtimeSearchControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "thingtime.control.search") {
            ControlWidgetButton(action: OpenThingtimeAction(.search)) { Label("Search Things", systemImage: "magnifyingglass") }
        }.displayName("Search Things").description("Find something in your Things.")
    }
}
#endif
