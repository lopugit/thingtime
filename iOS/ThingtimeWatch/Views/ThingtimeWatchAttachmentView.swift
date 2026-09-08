import PhotosUI
import SwiftUI

struct ThingtimeWatchAttachmentView: View {
    @EnvironmentObject private var store: ThingtimeWatchStore
    @ObservedObject var recorder: ThingtimeWatchAudioRecorder
    @AppStorage("watch.attachments.autoUploadRecordings") private var autoUploadRecordings = true
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var isImportingPhotos = false

    var body: some View {
        List {
            Section {
                PhotosPicker(
                    selection: $photoItems,
                    maxSelectionCount: 5,
                    matching: .images
                ) {
                    Label("Photos & screenshots", systemImage: "photo.on.rectangle.angled")
                }
                .disabled(isBusy)

                Button {
                    recorder.record()
                } label: {
                    Label("Record", systemImage: "mic.circle")
                }
                .disabled(isBusy)

                NavigationLink {
                    ThingtimeWatchSavedRecordingsView(recorder: recorder)
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Label("Choose saved recording", systemImage: "waveform.badge.magnifyingglass")
                        Text(recorder.recordings.isEmpty
                            ? "No Thingtime recordings yet"
                            : "\(recorder.recordings.count) on this Watch")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                .disabled(recorder.recordings.isEmpty)

            } header: {
                Text("Add attachment")
            }

            Section("Recording") {
                Toggle("Upload after saving", isOn: $autoUploadRecordings)
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
                Text("Choose saved recording lists audio previously made with Thingtime’s Apple recorder. Apple keeps the separate Voice Memos library private; sync those memos to iPhone, export one to Files, then upload it in Thingtime there.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Private Thing")
        .onChange(of: photoItems) { _, items in
            guard !items.isEmpty else { return }
            Task { await importPhotos(items) }
        }
        .onAppear {
            recorder.completedRecording = { recording in
                guard autoUploadRecordings else { return }
                Task { await upload(recording) }
            }
            recorder.refresh()
        }
    }

    private var isBusy: Bool {
        store.attachmentIsBusy || isImportingPhotos || recorder.isPresenting
    }

    private func upload(_ recording: ThingtimeWatchAudioRecorder.Recording) async {
        await store.queueAttachment(
            fileURL: recording.url,
            filename: recording.filename,
            contentType: recording.contentType
        )
    }

    private func importPhotos(_ items: [PhotosPickerItem]) async {
        isImportingPhotos = true
        defer {
            photoItems = []
            isImportingPhotos = false
        }

        for (index, item) in items.enumerated() {
            guard let data = try? await item.loadTransferable(type: Data.self), !data.isEmpty else { continue }
            let contentType = item.supportedContentTypes.first ?? .data
            let extensionName = contentType.preferredFilenameExtension ?? "bin"
            let kind = contentType.conforms(to: .image) ? "Screenshot" : "Video"
            let filename = "Apple-Watch-\(kind)-\(Self.timestamp())-\(index + 1).\(extensionName)"
            await store.queueAttachment(
                data: data,
                filename: filename,
                contentType: contentType.preferredMIMEType ?? "application/octet-stream"
            )
        }
    }

    private static func timestamp() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return formatter.string(from: Date())
    }
}

#Preview {
    NavigationStack { ThingtimeWatchAttachmentView(recorder: ThingtimeWatchStore.shared.audioRecorder) }
        .environmentObject(ThingtimeWatchStore.shared)
}
