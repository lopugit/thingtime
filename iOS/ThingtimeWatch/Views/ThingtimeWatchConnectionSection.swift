import SwiftUI

struct ThingtimeWatchConnectionSection: View {
    @EnvironmentObject private var store: ThingtimeWatchStore

    var body: some View {
        Section("iPhone connection") {
            Label(store.phoneConnectionState.title, systemImage: store.phoneConnectionState.systemImage)

            if let message = store.connectionMessage {
                Text(message)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            if let lastContact = store.lastPhoneContactAt {
                Text("Last reply \(lastContact.formatted(.relative(presentation: .named)))")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            if store.canRetryPhoneConnection {
                Button {
                    store.retryPhoneConnection()
                } label: {
                    Label("Retry connection", systemImage: "arrow.clockwise")
                }
            }
        }
    }
}
