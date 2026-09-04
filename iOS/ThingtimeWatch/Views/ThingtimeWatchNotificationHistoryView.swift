import SwiftUI

struct ThingtimeWatchNotificationHistoryView: View {
    private enum Period: String, CaseIterable, Identifiable {
        case date = "One date"
        case range = "Date range"

        var id: String { rawValue }
    }

    @EnvironmentObject private var store: ThingtimeWatchStore
    @State private var period: Period = .date
    @State private var selectedDate = Date()
    @State private var rangeStart = Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? Date()
    @State private var rangeEnd = Date()

    init() {
#if DEBUG
        let previewPeriod: Period = ProcessInfo.processInfo.environment["THINGTIME_WATCH_HISTORY_RANGE_PREVIEW"] == "1"
            ? .range
            : .date
        _period = State(initialValue: previewPeriod)
#endif
    }

    var body: some View {
        List {
            Section("Period") {
                Picker("Choose period", selection: $period) {
                    ForEach(Period.allCases) { option in Text(option.rawValue).tag(option) }
                }

                if period == .date {
                    DatePicker("Date", selection: $selectedDate, in: ...Date(), displayedComponents: .date)
                } else {
                    DatePicker("From", selection: $rangeStart, in: ...rangeEnd, displayedComponents: .date)
                    DatePicker("Through", selection: $rangeEnd, in: rangeStart...Date(), displayedComponents: .date)
                }
            }

            Section("Fetch") {
                Button {
                    let window = selectedWindow
                    store.fetchHistory(from: window.from, to: window.to)
                } label: {
                    Label("Fetch first 10", systemImage: "clock.arrow.circlepath")
                }
                .disabled(store.historyIsLoading)

                Button {
                    let window = selectedWindow
                    store.downloadHistory(from: window.from, to: window.to)
                } label: {
                    Label("Download whole period", systemImage: "arrow.down.circle.fill")
                }
                .disabled(store.historyIsLoading)
            }

            if let message = store.historyStatusMessage {
                Section("Status") {
                    Text(message)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            if !store.historyNotifications.isEmpty {
                Section("Notifications") {
                    ForEach(store.historyNotifications) { notification in
                        Button {
                            store.markRead(id: notification.id)
                        } label: {
                            NotificationRow(notification: notification, showsDate: true)
                        }
                        .buttonStyle(.plain)
                    }

                    if store.canLoadMoreHistory {
                        Button(store.downloadedHistoryCount > 0 ? "Show 10 more" : "Fetch 10 more") {
                            store.loadMoreHistory()
                        }
                        .disabled(store.historyIsLoading)
                    }
                }
            }

            Section {
                Text("Download saves every available notification in the period on this Watch for offline viewing. Thingtime retains up to your latest 500 notifications.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("History")
    }

    private var selectedWindow: (from: String, to: String) {
        let calendar = Calendar.current
        let first = period == .date ? selectedDate : min(rangeStart, rangeEnd)
        let last = period == .date ? selectedDate : max(rangeStart, rangeEnd)
        let start = calendar.startOfDay(for: first)
        let endStart = calendar.startOfDay(for: last)
        let end = calendar.date(byAdding: .day, value: 1, to: endStart) ?? endStart
        let formatter = ISO8601DateFormatter()
        return (formatter.string(from: start), formatter.string(from: end))
    }
}

#Preview {
    NavigationStack { ThingtimeWatchNotificationHistoryView() }
        .environmentObject(ThingtimeWatchStore.shared)
}
