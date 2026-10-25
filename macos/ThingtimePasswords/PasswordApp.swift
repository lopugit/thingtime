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
                    if disconnect { try PasswordSessionStore.clear(); await PasswordIdentityIndex.clearAndWait() }
                    else {
                        // The Electron parent writes only its current first-party
                        // session through stdin. No tokens in argv, files or logs.
                        guard let data = try FileHandle.standardInput.read(upToCount: 65537), data.count <= 65536 else { throw PasswordProviderError.invalidSession }
                        let decoded = try JSONDecoder().decode(ProviderSession.self, from: data)
                        let session = try ProviderSession(origin: decoded.origin, ownerId: decoded.ownerId, cookie: decoded.cookie)
                        if CommandLine.arguments.contains("--sync") {
                            guard let prior = try? PasswordSessionStore.load() else { exit(0) }
                            guard prior.origin == session.origin, prior.ownerId == session.ownerId else {
                                try PasswordSessionStore.clear(); await PasswordIdentityIndex.clearAndWait()
                                DistributedNotificationCenter.default().postNotificationName(.init("com.thingtime.passwords.destination-changed"), object: nil, userInfo: nil, deliverImmediately: true)
                                exit(0)
                            }
                        }
                        let catalog = try await PasswordClient(account: session).catalog()
                        try PasswordSessionStore.save(session)
                        LSRegisterURL(Bundle.main.bundleURL as CFURL, true)
                        // Disabled AutoFill must not prevent linking the account.
                        try? await PasswordIdentityIndex.synchronize(catalog)
                    }
                    DistributedNotificationCenter.default().postNotificationName(.init("com.thingtime.passwords.destination-changed"), object: nil, userInfo: nil, deliverImmediately: true)
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
    private var editor: PasswordSetupEditor?
    private func showEditor() -> PasswordSetupEditor {
        if let editor { window?.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true); return editor }
        let editor = PasswordSetupEditor()
        let window = NSWindow(contentViewController: editor)
        window.title = "Thingtime Passwords"; window.setContentSize(NSSize(width: 1000, height: 760)); window.minSize = NSSize(width: 360, height: 520)
        window.styleMask.insert([.resizable, .miniaturizable]); window.center(); window.makeKeyAndOrderFront(nil)
        self.editor = editor; self.window = window; NSApp.activate(ignoringOtherApps: true)
        return editor
    }
    func applicationDidFinishLaunching(_ notification: Notification) { LSRegisterURL(Bundle.main.bundleURL as CFURL, true); _ = showEditor() }
    func application(_ application: NSApplication, open urls: [URL]) {
        let editor = showEditor()
        for url in urls { editor.receive(url) }
    }
    func applicationDidBecomeActive(_ notification: Notification) { editor?.retryDestination() }
    func applicationWillTerminate(_ notification: Notification) { editor?.cancelSetup() }
}
