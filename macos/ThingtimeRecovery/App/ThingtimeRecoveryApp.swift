import AppKit
import SwiftUI

@main
struct ThingtimeRecoveryApp: App {
    @StateObject private var store: RecoveryStore

    // Keep startup deterministic. The implicit memberwise initializer generated
    // for an App-owned StateObject can unwrap its backing storage before SwiftUI
    // has installed it, which surfaced as a launch-time SIGTRAP in production.
    init() {
        _store = StateObject(wrappedValue: RecoveryStore())
    }

    var body: some Scene {
        WindowGroup("Thingtime Recovery") {
            RecoveryContentView(store: store)
                .frame(minWidth: 940, minHeight: 610)
                .task { await store.refresh() }
        }
        .commands {
            CommandGroup(after: .appInfo) {
                Button("Refresh Releases") { Task { await store.refresh() } }
                    .keyboardShortcut("r", modifiers: .command)
            }
        }
    }
}
