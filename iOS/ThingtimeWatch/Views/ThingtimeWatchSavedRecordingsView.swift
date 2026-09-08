import SwiftUI

struct ThingtimeWatchSavedRecordingsView: View {
    @EnvironmentObject private var store: ThingtimeWatchStore
    @ObservedObject var recorder: ThingtimeWatchAudioRecorder

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
                        .swipeActions {
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
                Text("Swipe a row to delete only Thingtime’s local copy. Every successful upload is private.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Recordings")
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
