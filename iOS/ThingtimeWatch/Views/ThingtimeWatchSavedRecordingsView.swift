import SwiftUI

struct ThingtimeWatchSavedRecordingsView: View {
    @EnvironmentObject private var store: ThingtimeWatchStore
    @ObservedObject var recorder: ThingtimeWatchAudioRecorder
    @State private var handoff: ThingtimeWatchAudioRecorder.Recording?

    var body: some View {
        List {
            if recorder.recordings.isEmpty {
                ContentUnavailableView(
                    "No saved recordings",
                    systemImage: "waveform",
                    description: Text("Record one in Thingtime first.")
                )
            } else {
                Section("Choose to upload") {
                    ForEach(recorder.recordings) { recording in
                        Button {
                            Task { await upload(recording) }
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Label(recording.displayDate, systemImage: "waveform.circle")
                                    .lineLimit(2)
                                Text("\(recording.displaySize) · \(recording.filename)")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                            }
                        }
                        .disabled(store.attachmentIsBusy)
                        .onLongPressGesture { if !store.attachmentIsBusy { handoff = recording } }
                        .swipeActions {
                            Button { handoff = recording } label: { Label("Send to Lopu", systemImage: "sparkles") }
                                .disabled(store.attachmentIsBusy)
                            Button(role: .destructive) {
                                recorder.delete(recording)
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                    }
                }
            }

            if let message = recorder.errorMessage ?? store.attachmentStatusMessage {
                Section("Status") {
                    Text(message)
                        .font(.caption2)
                        .foregroundStyle(.secondary)

                    if store.canRetryAttachments {
                        Button("Retry saved upload") { store.retryAttachmentTransfers() }
                    }
                }
            }

            ThingtimeWatchConnectionSection()

            Section {
                Text("Hold or swipe a recording for Send to Lopu. Delete removes only Thingtime’s local copy. Every successful upload is private.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Recordings")
        .confirmationDialog("Let Lopu act on this recording?", isPresented: Binding(get: { handoff != nil }, set: { if !$0 { handoff = nil } })) {
            Button("Send to Lopu") {
                guard let recording = handoff else { return }
                Task { await store.queueAttachment(fileURL: recording.url, filename: recording.filename, contentType: recording.contentType, sendToLopu: true) }
                handoff = nil
            }
            Button("Cancel", role: .cancel) { handoff = nil }
        } message: { Text("Lopu can create Things and reminders from your transcript. Check its conversation for results and confirmation requests.") }
        .onAppear { recorder.refresh() }
    }

    private func upload(_ recording: ThingtimeWatchAudioRecorder.Recording) async {
        await store.queueAttachment(
            fileURL: recording.url,
            filename: recording.filename,
            contentType: recording.contentType
        )
    }
}
