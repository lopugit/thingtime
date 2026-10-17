import AppKit
import CoreServices
import SwiftUI
import ThingtimePasswordCore
@main enum PasswordApp {
    @MainActor static func main() {
        if CommandLine.arguments.contains("--connect") || CommandLine.arguments.contains("--disconnect") || CommandLine.arguments.contains("--sync") {
            let disconnect = CommandLine.arguments.contains("--disconnect")
            Task { @MainActor in
                do {
                    if disconnect { PasswordSessionStore.clear(); await PasswordIdentityIndex.clearAndWait() }
                    else {
                        // The Electron parent writes only its current first-party
                        // session through stdin. No tokens in argv, files or logs.
                        guard let data = try FileHandle.standardInput.read(upToCount: 65537), data.count <= 65536 else { throw PasswordProviderError.invalidSession }
                        let decoded = try JSONDecoder().decode(ProviderSession.self, from: data)
                        let session = try ProviderSession(origin: decoded.origin, ownerId: decoded.ownerId, cookie: decoded.cookie)
                        if CommandLine.arguments.contains("--sync") {
                            guard let prior = try? PasswordSessionStore.load() else { exit(0) }
                            guard prior.origin == session.origin, prior.ownerId == session.ownerId else { PasswordSessionStore.clear(); await PasswordIdentityIndex.clearAndWait(); exit(0) }
                        }
                        let catalog = try await PasswordClient(account: session).catalog()
                        try PasswordSessionStore.save(session)
                        LSRegisterURL(Bundle.main.bundleURL as CFURL, true)
                        // Disabled AutoFill must not prevent linking the account.
                        try? await PasswordIdentityIndex.synchronize(catalog)
                    }
                    exit(0)
                } catch { exit(1) }
            }
            RunLoop.main.run()
            return
        }
        let app = NSApplication.shared
        let delegate = PasswordAppDelegate(); app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}
@MainActor final class PasswordAppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow?
    func applicationDidFinishLaunching(_ notification: Notification) {
        let content = VStack(alignment: .leading, spacing: 16) {
            Text("Thingtime Passwords").font(.title).bold()
            Text("Open Passwords in the Thingtime desktop app and select Connect Password AutoFill. Then enable Thingtime in System Settings → General → AutoFill & Passwords.")
            Button("Open Thingtime") {
                if let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.thingtime.desktop") { NSWorkspace.shared.openApplication(at: appURL, configuration: NSWorkspace.OpenConfiguration(), completionHandler: nil) }
            }
            Button("Open Password AutoFill settings") { NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.Passwords-Settings.extension")!) }
        }.padding(24).frame(width: 420)
        let window = NSWindow(contentViewController: NSHostingController(rootView: content)); window.title = "Thingtime Passwords"; window.center(); window.makeKeyAndOrderFront(nil); self.window = window
        NSApp.activate(ignoringOtherApps: true)
    }
}
