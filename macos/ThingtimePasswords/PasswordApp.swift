import AppKit
import CoreServices
import SwiftUI
import ThingtimePasswordCore
@main enum PasswordApp {
    @MainActor static func main() {
        if CommandLine.arguments.contains("--connect") || CommandLine.arguments.contains("--disconnect") || CommandLine.arguments.contains("--sync") {
            let disconnect = CommandLine.arguments.contains("--disconnect")
            let detailedStatus = CommandLine.arguments.contains("--connection-status-v1")
            Task { @MainActor in
                do {
                    var status = PasswordConnectionStatus.disconnected
                    if disconnect {
                        // This CLI is the Electron lifecycle adapter. Only the
                        // companion's own explicit Disconnect may clear its link.
                        guard PasswordHostConnectionAuthority.canDisconnect(try PasswordSessionStore.loadIfPresent()) else {
                            exit(PasswordConnectionStatus.disconnected.exitCode(detailed: detailedStatus))
                        }
                        try PasswordSessionStore.clear(); await PasswordIdentityIndex.clearAndWait()
                    }
                    else {
                        // The Electron parent writes only its current first-party
                        // session through stdin. No tokens in argv, files or logs.
                        guard let data = try FileHandle.standardInput.read(upToCount: 65537), data.count <= 65536 else { throw PasswordProviderError.invalidSession }
                        let decoded = try JSONDecoder().decode(ProviderSession.self, from: data)
                        let session = try ProviderSession(origin: decoded.origin, ownerId: decoded.ownerId, cookie: decoded.cookie)
                        let baseline = try PasswordSessionStore.loadIfPresent()
                        if CommandLine.arguments.contains("--sync") {
                            guard PasswordHostConnectionAuthority.canSynchronize(baseline, incoming: session) else {
                                // An automatic sync has no authority over another
                                // app/account connection. Leave it untouched.
                                exit(PasswordConnectionStatus.disconnected.exitCode(detailed: detailedStatus))
                            }
                        }
                        let catalog = try await PasswordClient(account: session).catalog()
                        guard try PasswordSessionStore.loadIfPresent() == baseline else { throw PasswordProviderError.invalidSession }
                        try PasswordSessionStore.save(session)
                        LSRegisterURL(Bundle.main.bundleURL as CFURL, true)
                        status = try await PasswordIdentityIndex.synchronizeConnection(catalog) {
                            guard try PasswordSessionStore.load() == session else { throw PasswordProviderError.invalidSession }
                        }
                    }
                    DistributedNotificationCenter.default().postNotificationName(.init("com.thingtime.passwords.destination-changed"), object: nil, userInfo: nil, deliverImmediately: true)
                    exit(status.exitCode(detailed: detailedStatus))
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
