import SwiftUI

@main
struct ThingtimeApp: App {
    @UIApplicationDelegateAdaptor(ThingtimeAppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    @State private var shareError: String?
    @State private var drainingShares = false

    var body: some Scene {
        WindowGroup {
            ThingtimeWebView()
                .task { await drainShares() }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { Task { await drainShares() } }
                }
                .alert("Shared files are waiting", isPresented: Binding(
                    get: { shareError != nil }, set: { if !$0 { shareError = nil } }
                )) {
                    Button("Try Again") { Task { await drainShares() } }
                    Button("Later", role: .cancel) { shareError = nil }
                } message: {
                    Text(shareError ?? "")
                }
        }
    }

    @MainActor private func drainShares() async {
        guard !drainingShares else { return }
        drainingShares = true
        defer { drainingShares = false }
        let error = await Task.detached(priority: .utility) { () -> String? in
            do {
                // An unavailable group (for example an unsigned test host) is
                // not evidence that saved batches exist. Never present a false
                // startup alert that also interrupts the host's active scene.
                let documents = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                try ShareInbox.drainAvailable(to: documents.appendingPathComponent("Shared", isDirectory: true))
                return nil
            } catch {
                return "Your saved shares are still in local storage. Unlock this device and try again. If the problem continues, free some storage and reopen Thingtime."
            }
        }.value
        shareError = error
    }
}
