import SwiftUI

struct ThingtimeWatchConnectionSection: View {
    @EnvironmentObject private var store: ThingtimeWatchStore

    var body: some View {
        Section("iPhone connection") {
            Label(store.phoneConnectionState.title, systemImage: store.phoneConnectionState.systemImage)

            if let username = store.snapshot.accountUsername, !username.isEmpty {
                Label("@\(username)", systemImage: "person.crop.circle.fill")
                    .font(.caption.bold())
            }

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

            if let lastCheck = store.lastConnectionCheckAt {
                Text("Last check \(lastCheck.formatted(.relative(presentation: .named)))")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            Button {
                store.requestRefresh()
            } label: {
                HStack(spacing: 8) {
                    if store.isCheckingPhoneConnection {
                        ProgressView()
                    } else {
                        Image(systemName: "arrow.clockwise")
                    }
                    Text(store.isCheckingPhoneConnection ? "Checking…" : "Check & refresh")
                }
            }
            .disabled(store.isCheckingPhoneConnection)

            Text(buildSummary)
                .font(.caption2)
                .foregroundStyle(buildsMatch ? Color.secondary : Color.orange)

            if let origin = store.snapshot.phoneOrigin {
                Text("Origin: \(displayOrigin(origin))")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .lineLimit(2)
            }

            if !buildsMatch {
                Text("The iPhone and Watch apps differ. Update Thingtime on the Watch, then retry.")
                    .font(.caption2)
                    .foregroundStyle(.orange)
            }
        }
    }

    private var watchBuild: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?"
    }

    private var buildsMatch: Bool {
        guard let phoneBuild = store.snapshot.phoneBuild else { return true }
        return phoneBuild == watchBuild
    }

    private var buildSummary: String {
        guard let phoneBuild = store.snapshot.phoneBuild else { return "Watch build \(watchBuild) · iPhone build unknown" }
        return "Watch build \(watchBuild) · iPhone build \(phoneBuild)"
    }

    private func displayOrigin(_ value: String) -> String {
        URL(string: value)?.host ?? value
    }
}
