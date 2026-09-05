import SwiftUI

struct ThingtimeWatchAccountSwitcherView: View {
    @EnvironmentObject private var store: ThingtimeWatchStore

    var body: some View {
        List {
            if store.accounts.isEmpty {
                ContentUnavailableView("No accounts", systemImage: "person.crop.circle.badge.plus", description: Text("Connect a Thingtime account first."))
            } else {
                Section("Accounts") {
                    ForEach(store.accounts) { account in
                        Button {
                            store.selectAccount(account.id)
                        } label: {
                            HStack {
                                ThingtimeWatchAccountLabel(account: account, connectionState: account.id == store.selectedAccountID ? store.connectionState : .ready)
                                if account.id == store.selectedAccountID {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(.green)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            Section {
                NavigationLink { ThingtimeWatchAddAccountView() } label: {
                    Label("Add account", systemImage: "person.crop.circle.badge.plus")
                }
            }
        }
        .navigationTitle("Accounts")
    }
}

struct ThingtimeWatchAddAccountView: View {
    @EnvironmentObject private var store: ThingtimeWatchStore

    var body: some View {
        List {
            Section("Domain") {
                Picker("Thingtime", selection: Binding(
                    get: { store.pairingDomain },
                    set: { store.setPairingDomain($0) }
                )) {
                    ForEach(ThingtimeWatchDomain.availableCases) { domain in
                        Text(domain.title).tag(domain)
                    }
                }
            }

            if let pairing = store.pendingPairing {
                Section("Approval code") {
                    Text(pairing.userCode)
                        .font(.title2.monospaced().bold())
                        .frame(maxWidth: .infinity)
                    Button { store.openPairingPage() } label: {
                        Label("Open Thingtime", systemImage: "safari")
                    }
                    Text(store.connectionMessage ?? "Approve this Watch in Thingtime.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            } else {
                Section {
                    Button { store.requestPairing() } label: {
                        HStack {
                            if store.isPairing { ProgressView() }
                            else { Image(systemName: "link.badge.plus") }
                            Text(store.isPairing ? "Creating code…" : "Connect another account")
                        }
                    }
                    .disabled(store.isPairing)
                }
            }
        }
        .navigationTitle("Add account")
    }
}

struct ThingtimeWatchSettingsView: View {
    @EnvironmentObject private var store: ThingtimeWatchStore

    var body: some View {
        List {
            Section("General") {
                NavigationLink { ThingtimeWatchFavoriteSettingsView() } label: {
                    Label("Favourite actions", systemImage: "star.fill")
                }
                NavigationLink { ThingtimeWatchAccountSwitcherView() } label: {
                    Label("Switch account", systemImage: "person.2.circle")
                }
            }

            if let account = store.selectedAccount {
                Section("Current account") {
                    ThingtimeWatchAccountLabel(account: account, connectionState: store.connectionState)
                    LabeledContent("Domain", value: account.domain)
                    LabeledContent("Device", value: String(account.deviceId.prefix(8)))
                    Button(role: .destructive) {
                        store.removeAccount(account.id)
                    } label: {
                        Label("Remove from Watch", systemImage: "trash")
                    }
                }
            }

            Section {
                NavigationLink { ThingtimeWatchAddAccountView() } label: {
                    Label("Add account", systemImage: "person.crop.circle.badge.plus")
                }
            }

            ThingtimeWatchConnectionSection()
        }
        .navigationTitle("Settings")
    }
}

struct ThingtimeWatchFavoriteSettingsView: View {
    @EnvironmentObject private var store: ThingtimeWatchStore

    var body: some View {
        List {
            Section {
                Text("Enabled actions appear directly under Add private Thing on the first screen. Record is enabled by default.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Section("Show on first screen") {
                ForEach(ThingtimeWatchFavorite.allCases) { favorite in
                    Toggle(isOn: Binding(
                        get: { store.favorites.contains(favorite) },
                        set: { store.setFavorite(favorite, enabled: $0) }
                    )) {
                        Label(favorite.title, systemImage: favorite.systemImage)
                    }
                }
            }
        }
        .navigationTitle("Favourites")
    }
}

#Preview {
    NavigationStack { ThingtimeWatchSettingsView() }
        .environmentObject(ThingtimeWatchStore.shared)
}
