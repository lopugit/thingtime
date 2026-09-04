import PhotosUI
import SwiftUI

struct ThingtimeWatchAttachmentView: View {
    @EnvironmentObject private var store: ThingtimeWatchStore
    @StateObject private var recorder = ThingtimeWatchAudioRecorder()
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
                    Label("Record with Apple", systemImage: "mic.circle")
                }
                .disabled(isBusy)

            } header: {
                Text("Add attachment")
            }

            Section("Recording") {
                Toggle("Upload after saving", isOn: $autoUploadRecordings)
            }

            if !recorder.recordings.isEmpty {
                Section("Saved on this Watch") {
                    ForEach(recorder.recordings) { recording in
                        Button {
                            Task { await upload(recording) }
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Label("Upload recording", systemImage: "arrow.up.circle")
                                Text("\(recording.displayDate) · \(recording.displaySize)")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .disabled(isBusy)
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

                    if !store.attachmentIsBusy && store.attachmentStatusMessage?.contains("Couldn’t") == true {
                        Button("Try again") { store.retryAttachmentTransfers() }
                    }
                }
            }

            Section {
                Text("Each upload becomes a private Thing. Apple keeps Voice Memos inside its app, so an existing memo can’t be imported directly on Watch; sync it to iPhone and upload it in Thingtime there.")
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
    NavigationStack { ThingtimeWatchAttachmentView() }
        .environmentObject(ThingtimeWatchStore.shared)
}
