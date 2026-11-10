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
                    if disconnect { PasswordSessionStore.clear(); await PasswordIdentityIndex.clearAndWait() }
                    else {
                        // The Electron parent writes only its current first-party
                        // session through stdin. No tokens in argv, files or logs.
                        guard let data = try FileHandle.standardInput.read(upToCount: 65537), data.count <= 65536 else { throw PasswordProviderError.invalidSession }
                        let decoded = try JSONDecoder().decode(ProviderSession.self, from: data)
                        let session = try ProviderSession(origin: decoded.origin, ownerId: decoded.ownerId, cookie: decoded.cookie)
                        if CommandLine.arguments.contains("--status") {
                            FileHandle.standardOutput.write(try JSONEncoder().encode(PasswordConnectionStatus.current(for: session)))
                            exit(0)
                        }
                        if CommandLine.arguments.contains("--sync") {
                            guard let prior = try? PasswordSessionStore.load() else { exit(0) }
                            guard prior.origin == session.origin, prior.ownerId == session.ownerId else { PasswordSessionStore.clear(); await PasswordIdentityIndex.clearAndWait(); exit(0) }
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
    func applicationDidFinishLaunching(_ notification: Notification) {
        let content = VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                if let url = Bundle.main.url(forResource: "ThingtimeTree", withExtension: "png"), let tree = NSImage(contentsOf: url) {
                    Image(nsImage: tree).resizable().interpolation(.none).scaledToFit().frame(width: 40, height: 40).accessibilityHidden(true)
                }
                Text("Thingtime").font(.title).bold()
            }
            Text("Open Passwords in the Thingtime desktop app and select Connect Password AutoFill. Then enable Thingtime in System Settings → General → AutoFill & Passwords.")
                .fixedSize(horizontal: false, vertical: true)
            Button("Open Thingtime") {
                if let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.thingtime.desktop") { NSWorkspace.shared.openApplication(at: appURL, configuration: NSWorkspace.OpenConfiguration(), completionHandler: nil) }
            }
            Button("Open Password AutoFill settings") { NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.Passwords-Settings.extension")!) }
        }.padding(24).frame(width: 420)
        let window = NSWindow(contentViewController: NSHostingController(rootView: content)); window.title = "Thingtime"; window.center(); window.makeKeyAndOrderFront(nil); self.window = window
        NSApp.activate(ignoringOtherApps: true)
    }
    func applicationDidFinishLaunching(_ notification: Notification) { LSRegisterURL(Bundle.main.bundleURL as CFURL, true); _ = showEditor() }
    func application(_ application: NSApplication, open urls: [URL]) {
        let editor = showEditor()
        for url in urls { editor.receive(url) }
    }
    func applicationDidBecomeActive(_ notification: Notification) { editor?.retryDestination() }
    func applicationWillTerminate(_ notification: Notification) { editor?.cancelSetup() }
}
