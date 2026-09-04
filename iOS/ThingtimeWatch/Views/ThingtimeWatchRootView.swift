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

                Text(store.connectionMessage ?? store.snapshot.message ?? "Open Thingtime on your iPhone and sign in.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                Button("I’m signed in") {
                    store.requestPairing()
                }
                .buttonStyle(.borderedProminent)
                .tint(.purple)

                notificationPermissionButton
            }
            .padding(.horizontal, 8)
        }
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
                }

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

private struct NotificationRow: View {
    let notification: ThingtimeWatchNotification

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
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(notification.displayActor) \(notification.actionText)")
        .accessibilityHint(notification.isUnread ? "Marks this notification as read" : "Already read")
    }
}

#Preview("Signed out") {
    ThingtimeWatchRootView()
        .environmentObject(ThingtimeWatchStore.shared)
}
