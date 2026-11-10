import SwiftUI

struct ThingtimeWatchConnectionSection: View {
    @EnvironmentObject private var store: ThingtimeWatchStore

    var body: some View {
        Section("Direct connection") {
            Label(store.connectionState.title, systemImage: store.connectionState.systemImage)
                .foregroundStyle(store.connectionState == .connected ? .green : .primary)

            if let account = store.selectedAccount {
                ThingtimeWatchAccountLabel(account: account, connectionState: store.connectionState)
            }

            if let message = store.connectionMessage {
                Text(message)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            if let lastContact = store.lastServerContactAt {
                Text("Last live reply \(lastContact.formatted(.relative(presentation: .named)))")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            if let lastCheck = store.lastConnectionCheckAt {
                Text("Last refresh check \(lastCheck.formatted(.relative(presentation: .named)))")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            Button {
                store.requestRefresh()
            } label: {
                HStack(spacing: 8) {
                    if store.isCheckingConnection { ProgressView() }
                    else { Image(systemName: "arrow.clockwise") }
                    Text(store.isCheckingConnection ? "Checking…" : "Check & refresh")
                }
            }
            .disabled(store.isCheckingConnection || store.selectedAccount == nil)

            Text("Watch build \(watchBuild) · direct HTTPS")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private var watchBuild: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?"
    }
}
