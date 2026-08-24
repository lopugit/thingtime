import AppKit
import SwiftUI

@main
struct ThingtimeRecoveryApp: App {
    @StateObject private var store = RecoveryStore()

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
