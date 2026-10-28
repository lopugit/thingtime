import AppKit
import SwiftUI

@main
struct ThingtimeRecoveryApp: App {
    @StateObject private var store: RecoveryStore
    @StateObject private var integrations: AIIntegrationStore
    @Environment(\.scenePhase) private var scenePhase

    // Keep startup deterministic. The implicit memberwise initializer generated
    // for an App-owned StateObject can unwrap its backing storage before SwiftUI
    // has installed it, which surfaced as a launch-time SIGTRAP in production.
    init() {
        _store = StateObject(wrappedValue: RecoveryStore())
        _integrations = StateObject(wrappedValue: AIIntegrationStore())
    }

    var body: some Scene {
        WindowGroup("Thingtime Recovery") {
            // Bound the split view to the actual window viewport. A long native
            // list must not contribute its full fitting height to the hosting
            // view and center oversized content outside a restored small window.
            GeometryReader { viewport in
                RecoveryContentView(store: store, integrations: integrations)
                    .padding(.top, viewport.safeAreaInsets.top)
                    .padding(.bottom, viewport.safeAreaInsets.bottom)
                    .frame(width: viewport.size.width, height: viewport.size.height, alignment: .topLeading)
                    .clipped()
            }
                .frame(minWidth: 940, minHeight: 610)
                .task { await store.refresh() }
                .task {
                    await integrations.checkNow()
                    while !Task.isCancelled {
                        do { try await Task.sleep(nanoseconds: 300_000_000_000) }
                        catch { break }
                        await integrations.checkNow()
                    }
                }
                .onChange(of: scenePhase) { phase in
                    if phase == .active { Task { await integrations.checkNow() } }
                }
        }
        .defaultSize(width: 1120, height: 760)
        .windowResizability(.contentMinSize)
        .commands {
            CommandGroup(after: .appInfo) {
                Button("Check AI Apps") { Task { await integrations.checkNow() } }
                    .disabled(integrations.isWorking)
                Button("Refresh Releases") { Task { await store.refresh() } }
                    .keyboardShortcut("r", modifiers: .command)
            }
        }
    }
}
