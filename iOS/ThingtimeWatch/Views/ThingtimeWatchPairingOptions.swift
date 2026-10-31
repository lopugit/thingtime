import SwiftUI

struct ThingtimeWatchPairingOptions: View {
    @EnvironmentObject private var store: ThingtimeWatchStore
    var body: some View {
        Section("Approve using") {
            Picker("Account", selection: Binding(get: { store.approvalMethod }, set: { store.setApprovalMethod($0) })) {
                ForEach(ThingtimeWatchApprovalMethod.allCases) { method in
                    Text(method.title).tag(method)
                }
            }
            if store.approvalMethod == .username && store.pendingPairing == nil {
                TextField("Username", text: $store.pairingUsername)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
        }
    }
}
