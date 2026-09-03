import SwiftUI

@main
struct ThingtimeWatchApp: App {
    @WKApplicationDelegateAdaptor(ThingtimeWatchAppDelegate.self) private var appDelegate
    @StateObject private var store = ThingtimeWatchStore.shared

    var body: some Scene {
        WindowGroup {
            ThingtimeWatchRootView()
                .environmentObject(store)
        }
    }
}
