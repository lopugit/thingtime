import SwiftUI

/// Code approval happens in a phone/computer browser; watchOS cannot host this sign-in page.
struct ThingtimeWatchPairingSection: View {
    @EnvironmentObject private var store: ThingtimeWatchStore
    let pairing: ThingtimeWatchPairingRequest

    var body: some View {
        if let delivery = store.approvalDeliveryMessage {
            Section("Quick approval") {
                Text(delivery).font(.caption2)
                if store.approvalMethod == .phone {
                    Button("Send to iPhone") { store.sendPendingApproval() }
                }
            }
        }

        Section("Or use this short link") {
            Text("On your phone or computer, go to:")
                .font(.caption2)
            Text((pairing.verificationURL.host ?? "Thingtime") + "/pair/" + pairing.userCode)
                .font(.caption2.monospaced())
                .fixedSize(horizontal: false, vertical: true)
        }

        Section("Approval code") {
            Text(pairing.userCode)
                .font(.title2.monospaced().bold())
                .minimumScaleFactor(0.75)
                .lineLimit(1)
                .frame(maxWidth: .infinity)
            Text("Sign in and approve this Watch. The short link prefills the code. Keep this app open. Codes last 5 minutes.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }

        Section("Finish connecting") {
            Text(store.connectionMessage ?? "Waiting for approval…")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Button { store.retryPairingApproval() } label: {
                Label("Check approval", systemImage: "arrow.clockwise")
            }
            .disabled(store.connectionState == .checking)
            Button("Create new code") { store.requestPairing() }
        }
    }
}
