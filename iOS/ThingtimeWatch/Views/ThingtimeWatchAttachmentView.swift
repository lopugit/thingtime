import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

struct ThingtimeWatchAttachmentView: View {
    @EnvironmentObject private var store: ThingtimeWatchStore
    @StateObject private var recorder = ThingtimeWatchAudioRecorder()
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
                .disabled(store.attachmentIsBusy || isImportingPhotos || recorder.isRecording)

                Button {
                    Task { await recorder.toggle() }
                } label: {
                    Label(
                        recorder.isRecording ? "Stop \(formattedDuration)" : "Record audio",
                        systemImage: recorder.isRecording ? "stop.circle.fill" : "mic.circle"
                    )
                    .foregroundStyle(recorder.isRecording ? .red : .primary)
                }
                .disabled(store.attachmentIsBusy || isImportingPhotos)
            } header: {
                Text("Add attachment")
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
                Text("Each attachment becomes a private Thing visible only to you. watchOS exposes your Photos library here; files inside other apps aren’t available to pick.")
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
                Task {
                    await store.queueAttachment(
                        fileURL: recording.url,
                        filename: recording.filename,
                        contentType: recording.contentType
                    )
                    try? FileManager.default.removeItem(at: recording.url)
                }
            }
        }
        .onDisappear {
            if recorder.isRecording { recorder.stop() }
        }
    }

    private var formattedDuration: String {
        let seconds = Int(recorder.duration.rounded(.down))
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
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
