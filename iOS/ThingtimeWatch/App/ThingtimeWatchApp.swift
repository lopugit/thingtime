import SwiftUI

@main
struct ThingtimeWatchApp: App {
    @WKApplicationDelegateAdaptor(ThingtimeWatchAppDelegate.self) private var appDelegate
    @StateObject private var store = ThingtimeWatchStore.shared
#if DEBUG
    @StateObject private var previewRecorder = ThingtimeWatchAudioRecorder()
#endif

    var body: some Scene {
        WindowGroup {
#if DEBUG
            if ProcessInfo.processInfo.environment["THINGTIME_WATCH_HISTORY_PREVIEW"] == "1" {
                NavigationStack { ThingtimeWatchNotificationHistoryView() }
                    .environmentObject(store)
            } else if ProcessInfo.processInfo.environment["THINGTIME_WATCH_RECORDINGS_PREVIEW"] == "1" {
                NavigationStack {
                    ThingtimeWatchSavedRecordingsView(recorder: previewRecorder)
                }
                .environmentObject(store)
            } else if ProcessInfo.processInfo.environment["THINGTIME_WATCH_ATTACHMENT_PREVIEW"] == "1" {
                NavigationStack { ThingtimeWatchAttachmentView(recorder: store.audioRecorder) }
                    .environmentObject(store)
            } else {
                ThingtimeWatchRootView()
                    .environmentObject(store)
            }
#else
            ThingtimeWatchRootView()
                .environmentObject(store)
#endif
        }
    }
}
