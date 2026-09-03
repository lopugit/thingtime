import SwiftUI

@main
struct ThingtimeApp: App {
    @UIApplicationDelegateAdaptor(ThingtimeAppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            ThingtimeWebView()
        }
    }
}
