import SwiftUI

@main
struct ThingtimeWatchApp: App {
    @WKApplicationDelegateAdaptor(ThingtimeWatchAppDelegate.self) private var appDelegate
    @StateObject private var store = ThingtimeWatchStore.shared

    var body: some Scene {
        WindowGroup {
#if DEBUG
            if ProcessInfo.processInfo.environment["THINGTIME_WATCH_HISTORY_PREVIEW"] == "1" {
                NavigationStack { ThingtimeWatchNotificationHistoryView() }
                    .environmentObject(store)
            } else if ProcessInfo.processInfo.environment["THINGTIME_WATCH_ATTACHMENT_PREVIEW"] == "1" {
                NavigationStack { ThingtimeWatchAttachmentView() }
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
