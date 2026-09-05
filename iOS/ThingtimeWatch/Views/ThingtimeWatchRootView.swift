import SwiftUI
import UserNotifications

struct ThingtimeWatchRootView: View {
    @EnvironmentObject private var store: ThingtimeWatchStore
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack {
            Group {
                if store.selectedAccount == nil {
                    signedOutView
                } else {
                    notificationsView
                }
            }
            .navigationDestination(for: ThingtimeWatchFavorite.self) { favorite in
                destination(for: favorite)
            }
        }
        .containerBackground(.black.gradient, for: .navigation)
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { store.requestRefresh() }
        }
    }

    private var signedOutView: some View {
        List {
            Section {
                VStack(spacing: 7) {
                    Text("🦄")
                        .font(.system(size: 36))
                        .accessibilityHidden(true)
                    Text("Connect Thingtime")
                        .font(.headline)
                    Label(store.connectionState.title, systemImage: store.connectionState.systemImage)
                        .font(.caption.bold())
                    Text(store.connectionMessage ?? store.snapshot.message ?? "Connect directly from this Watch.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
            }

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
                    Button {
                        store.openPairingPage()
                    } label: {
                        Label("Open Thingtime", systemImage: "safari")
                    }
                    Text("Sign in and approve this Watch. Pairing continues automatically.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            } else {
                Section {
                    Button {
                        store.requestPairing()
                    } label: {
                        HStack(spacing: 8) {
                            if store.isPairing { ProgressView() }
                            else { Image(systemName: "link.badge.plus") }
                            Text(store.isPairing ? "Creating code…" : "Connect account")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.purple)
                    .disabled(store.isPairing)
                }
            }

            if !store.accounts.isEmpty {
                Section("Already on this Watch") {
                    NavigationLink { ThingtimeWatchAccountSwitcherView() } label: {
                        Label("Choose an account", systemImage: "person.2.circle")
                    }
                }
            }

            Section { notificationPermissionButton }
        }
        .navigationTitle("Thingtime")
    }

    private var notificationsView: some View {
        List {
            if let account = store.selectedAccount {
                Section {
                    NavigationLink {
                        ThingtimeWatchAccountSwitcherView()
                    } label: {
                        ThingtimeWatchAccountLabel(account: account, connectionState: store.connectionState)
                    }
                }
            }

            Section("Create") {
                NavigationLink {
                    ThingtimeWatchAttachmentView(recorder: store.audioRecorder)
                } label: {
                    Label("Add private Thing", systemImage: "paperclip.circle.fill")
                }

                ForEach(store.favorites) { favorite in
                    if favorite == .record {
                        Button {
                            store.audioRecorder.record()
                        } label: {
                            Label(favorite.title, systemImage: favorite.systemImage)
                        }
                        .disabled(store.audioRecorder.isPresenting || store.attachmentIsBusy)
                    } else {
                        NavigationLink(value: favorite) {
                            Label(favorite.title, systemImage: favorite.systemImage)
                        }
                    }
                }
            }

            Section("Notifications") {
                HStack {
                    Label("Latest", systemImage: "bell.fill")
                    Spacer()
                    if store.snapshot.unreadCount > 0 {
                        Text("\(store.snapshot.unreadCount)")
                            .font(.caption.bold())
                            .padding(.horizontal, 7)
                            .padding(.vertical, 3)
                            .background(.purple, in: Capsule())
                            .foregroundStyle(.white)
                    }
                }
                NavigationLink {
                    ThingtimeWatchNotificationHistoryView()
                } label: {
                    Label("Notification history", systemImage: "calendar.badge.clock")
                }
            }

            if store.snapshot.notifications.isEmpty {
                ContentUnavailableView("All caught up", systemImage: "rainbow", description: Text("New Thingtime notifications will appear here."))
            } else {
                ForEach(store.snapshot.notifications) { notification in
                    Button {
                        store.markRead(id: notification.id)
                    } label: {
                        NotificationRow(notification: notification)
                    }
                    .buttonStyle(.plain)
                }

                if store.canLoadOlderInbox {
                    Button("Load previous 10") { store.requestOlderNotifications() }
                        .disabled(store.historyIsLoading)
                }
            }

            ThingtimeWatchConnectionSection()

            Section {
                NavigationLink { ThingtimeWatchSettingsView() } label: {
                    Label("Settings", systemImage: "gearshape.fill")
                }
            }

            if store.notificationAuthorization != .authorized && store.notificationAuthorization != .provisional {
                Section { notificationPermissionButton }
            }
        }
        .listStyle(.carousel)
        .navigationTitle("Thingtime")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { store.requestRefresh() } label: { Image(systemName: "arrow.clockwise") }
                    .accessibilityLabel("Refresh Thingtime connection")
                    .disabled(store.isCheckingConnection)
            }
        }
        .onAppear {
            store.audioRecorder.completedRecording = { recording in
                Task {
                    await store.queueAttachment(fileURL: recording.url, filename: recording.filename, contentType: recording.contentType)
                }
            }
        }
    }

    @ViewBuilder
    private func destination(for favorite: ThingtimeWatchFavorite) -> some View {
        switch favorite {
        case .record:
            ThingtimeWatchAttachmentView(recorder: store.audioRecorder)
        case .savedRecordings:
            ThingtimeWatchSavedRecordingsView(recorder: store.audioRecorder)
        case .photos:
            ThingtimeWatchAttachmentView(recorder: store.audioRecorder)
        case .history:
            ThingtimeWatchNotificationHistoryView()
        }
    }

    @ViewBuilder
    private var notificationPermissionButton: some View {
        if store.notificationAuthorization == .notDetermined {
            Button("Enable alerts") { Task { await store.enableAlerts() } }
        } else if store.notificationAuthorization == .denied {
            Text("Alerts are off in Watch Settings.")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
    }
}

struct ThingtimeWatchAccountLabel: View {
    let account: ThingtimeWatchAccount
    let connectionState: ThingtimeWatchStore.ConnectionState

    var body: some View {
        HStack(spacing: 9) {
            AsyncImage(url: account.resolvedAvatarURL()) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Image(systemName: "person.crop.circle.fill")
                    .resizable()
                    .foregroundStyle(.purple)
            }
            .frame(width: 32, height: 32)
            .clipShape(Circle())

            VStack(alignment: .leading, spacing: 2) {
                Text(account.displayUsername)
                    .font(.caption.bold())
                    .lineLimit(1)
                Text(account.domain)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 3)
            Image(systemName: connectionState.systemImage)
                .foregroundStyle(connectionState == .connected ? .green : .secondary)
                .accessibilityLabel(connectionState.title)
        }
    }
}

struct NotificationRow: View {
    let notification: ThingtimeWatchNotification
    var showsDate = false

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Circle()
                .fill(notification.isUnread ? Color.purple : Color.clear)
                .frame(width: 7, height: 7)
                .padding(.top, 5)

            VStack(alignment: .leading, spacing: 3) {
                Text(notification.displayActor)
                    .font(.caption.bold())
                    .lineLimit(1)
                Text(notification.actionText)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                if let preview = notification.preview, !preview.isEmpty {
                    Text(preview)
                        .font(.caption2)
                        .lineLimit(2)
                }
                if showsDate {
                    Text(notification.createdAt.formattedNotificationDate)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                }
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(notification.displayActor) \(notification.actionText)")
        .accessibilityHint(notification.isUnread ? "Marks this notification as read" : "Already read")
    }
}

private extension String {
    var formattedNotificationDate: String {
        guard let date = ISO8601DateFormatter().date(from: self) else { return self }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}

#Preview("Signed out") {
    ThingtimeWatchRootView()
        .environmentObject(ThingtimeWatchStore.shared)
}
