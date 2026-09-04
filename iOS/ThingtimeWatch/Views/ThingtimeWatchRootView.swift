import SwiftUI
import UserNotifications

struct ThingtimeWatchRootView: View {
    @EnvironmentObject private var store: ThingtimeWatchStore
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if store.snapshot.authenticated {
                notificationsView
            } else {
                signedOutView
            }
        }
        .containerBackground(.black.gradient, for: .navigation)
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { store.requestRefresh() }
        }
    }

    private var signedOutView: some View {
        ScrollView {
            VStack(spacing: 10) {
                Text("🦄")
                    .font(.system(size: 40))
                    .accessibilityHidden(true)

                Text("Pair Thingtime")
                    .font(.headline)

                Label(store.phoneConnectionState.title, systemImage: store.phoneConnectionState.systemImage)
                    .font(.caption.bold())

                Text(store.connectionMessage ?? store.snapshot.message ?? "Open Thingtime on your iPhone and sign in.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                Button {
                    store.requestPairing()
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
                .buttonStyle(.borderedProminent)
                .tint(.purple)
                .disabled(store.isCheckingPhoneConnection)

                if let lastCheck = store.lastConnectionCheckAt {
                    Text("Last check \(lastCheck.formatted(.relative(presentation: .named)))")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }

                if let lastContact = store.lastPhoneContactAt {
                    Text("Last reply \(lastContact.formatted(.relative(presentation: .named)))")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }

                Text(signedOutBuildSummary)
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                if let origin = store.snapshot.phoneOrigin {
                    Text("Origin: \(URL(string: origin)?.host ?? origin)")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .multilineTextAlignment(.center)
                }

                notificationPermissionButton
            }
            .padding(.horizontal, 8)
        }
    }

    private var signedOutBuildSummary: String {
        let watchBuild = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?"
        guard let phoneBuild = store.snapshot.phoneBuild else {
            return "Watch build \(watchBuild) · iPhone build unknown"
        }
        return "Watch build \(watchBuild) · iPhone build \(phoneBuild)"
    }

    private var notificationsView: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        Label("Thingtime", systemImage: "sparkles")
                            .font(.headline)
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
                }

                Section("Create") {
                    NavigationLink {
                        ThingtimeWatchAttachmentView()
                    } label: {
                        Label("Add private Thing", systemImage: "paperclip.circle.fill")
                    }
                }

                Section("Notifications") {
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
                        Button("Load previous 10") {
                            store.requestOlderNotifications()
                        }
                        .disabled(store.historyIsLoading)
                    }
                }

                ThingtimeWatchConnectionSection()

                if store.notificationAuthorization != .authorized && store.notificationAuthorization != .provisional {
                    Section { notificationPermissionButton }
                }
            }
            .listStyle(.carousel)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { store.requestRefresh() } label: { Image(systemName: "arrow.clockwise") }
                        .accessibilityLabel("Refresh notifications")
                }
            }
        }
    }

    @ViewBuilder
    private var notificationPermissionButton: some View {
        if store.notificationAuthorization == .notDetermined {
            Button("Enable alerts") {
                Task { await store.enableAlerts() }
            }
        } else if store.notificationAuthorization == .denied {
            Text("Alerts are off in Watch Settings.")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
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
