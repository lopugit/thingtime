import AppKit
import CoreServices
import CryptoKit
import SwiftUI
import ThingtimePasswordCore
@main enum PasswordApp {
    private struct Retirement: Decodable { let origin: URL }
    private static func optOutKey(_ session: ProviderSession) -> String {
        let identity = session.origin.absoluteString + "\n" + session.ownerId
        return "autofill.disconnected." + SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    @MainActor static func main() {
        if CommandLine.arguments.contains("--connect") || CommandLine.arguments.contains("--disconnect") || CommandLine.arguments.contains("--sync") || CommandLine.arguments.contains("--status") {
            let disconnect = CommandLine.arguments.contains("--disconnect")
            Task { @MainActor in
                do {
                    let automatic = CommandLine.arguments.contains("--automatic")
                    let baseline = try PasswordSessionStore.loadIfPresent()
                    if disconnect {
                        if automatic {
                            guard let data = try FileHandle.standardInput.read(upToCount: 65537), data.count <= 65536 else { throw PasswordProviderError.invalidSession }
                            let retirement = try JSONDecoder().decode(Retirement.self, from: data)
                            guard PasswordHostConnectionAuthority.canDisconnect(baseline, expectedOrigin: retirement.origin) else { exit(0) }
                        }
                        if !automatic, let baseline { UserDefaults.standard.set(true, forKey: optOutKey(baseline)) }
                        try PasswordSessionStore.clear(); await PasswordIdentityIndex.clearAndWait()
                    } else {
                        // Only this app's first-party session travels through stdin.
                        guard let data = try FileHandle.standardInput.read(upToCount: 65537), data.count <= 65536 else { throw PasswordProviderError.invalidSession }
                        let decoded = try JSONDecoder().decode(ProviderSession.self, from: data)
                        let session = try ProviderSession(origin: decoded.origin, ownerId: decoded.ownerId, cookie: decoded.cookie)
                        if CommandLine.arguments.contains("--status") {
                            FileHandle.standardOutput.write(try JSONEncoder().encode(PasswordConnectionStatus.current(for: session)))
                            exit(0)
                        }
                        if CommandLine.arguments.contains("--sync") {
                            let enabled = await PasswordIdentityIndex.isEnabled()
                            guard PasswordHostConnectionAuthority.canSynchronize(baseline, incoming: session, providerEnabled: enabled, optedOut: UserDefaults.standard.bool(forKey: optOutKey(session))) else { exit(0) }
                        }
                        let catalog = try await PasswordClient(account: session).catalog()
                        // A companion link may have changed while the network ran.
                        guard try PasswordSessionStore.loadIfPresent() == baseline else { throw PasswordProviderError.sessionChanged }
                        try PasswordSessionStore.save(session)
                        UserDefaults.standard.removeObject(forKey: optOutKey(session))
                        LSRegisterURL(Bundle.main.bundleURL as CFURL, true)
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
