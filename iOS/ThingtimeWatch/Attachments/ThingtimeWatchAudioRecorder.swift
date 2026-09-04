import Foundation
import WatchKit

@MainActor
final class ThingtimeWatchAudioRecorder: ObservableObject {
    struct Recording: Identifiable, Equatable, Sendable {
        let url: URL
        let filename: String
        let contentType: String
        let createdAt: Date
        let sizeBytes: Int64

        var id: String { url.path }

        var displayDate: String {
            createdAt.formatted(date: .abbreviated, time: .shortened)
        }

        var displaySize: String {
            ByteCountFormatter.string(fromByteCount: sizeBytes, countStyle: .file)
        }
    }

    @Published private(set) var isPresenting = false
    @Published private(set) var recordings: [Recording] = []
    @Published private(set) var errorMessage: String?

    var completedRecording: ((Recording) -> Void)?

    private let maximumDuration: TimeInterval = 10 * 60

    init() {
        refresh()
    }

    func record() {
        guard !isPresenting else { return }
        errorMessage = nil

        do {
            let outputURL = try makeOutputURL()
            guard let controller = WKApplication.shared().visibleInterfaceController
                ?? WKApplication.shared().rootInterfaceController else {
                throw RecordingError.recorderUnavailable
            }

            isPresenting = true
            let options: [String: Any] = [
                WKAudioRecorderControllerOptionsActionTitleKey: "Save",
                WKAudioRecorderControllerOptionsAlwaysShowActionTitleKey: true,
                WKAudioRecorderControllerOptionsAutorecordKey: true,
                WKAudioRecorderControllerOptionsMaximumDurationKey: maximumDuration
            ]

            controller.presentAudioRecorderController(
                withOutputURL: outputURL,
                preset: .highQualityAudio,
                options: options
            ) { [weak self] didSave, error in
                Task { @MainActor [weak self] in
                    self?.complete(outputURL: outputURL, didSave: didSave, error: error)
                }
            }
        } catch {
            errorMessage = "Couldn’t open Apple’s recorder: \(error.localizedDescription)"
            isPresenting = false
        }
    }

    func delete(_ recording: Recording) {
        do {
            try FileManager.default.removeItem(at: recording.url)
            refresh()
        } catch {
            errorMessage = "Couldn’t delete the recording: \(error.localizedDescription)"
        }
    }

    func refresh() {
        do {
            recordings = try Self.loadRecordings()
        } catch {
            recordings = []
            errorMessage = "Couldn’t read saved recordings: \(error.localizedDescription)"
        }
    }

    private func complete(outputURL: URL, didSave: Bool, error: Error?) {
        isPresenting = false

        if let error {
            errorMessage = "Couldn’t save the recording: \(error.localizedDescription)"
            try? FileManager.default.removeItem(at: outputURL)
            return
        }

        guard didSave else {
            try? FileManager.default.removeItem(at: outputURL)
            return
        }

        refresh()
        guard let recording = recordings.first(where: { $0.url == outputURL }) else {
            errorMessage = "The recording was saved, but Thingtime couldn’t prepare it."
            return
        }
        completedRecording?(recording)
    }

    private func makeOutputURL() throws -> URL {
        let directory = try Self.recordingsDirectory()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let filename = "Apple-Watch-Audio-\(Self.timestamp())-\(UUID().uuidString.prefix(6)).m4a"
        return directory.appendingPathComponent(filename)
    }

    nonisolated private static func loadRecordings() throws -> [Recording] {
        let directory = try recordingsDirectory()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let keys: Set<URLResourceKey> = [.contentModificationDateKey, .fileSizeKey, .isRegularFileKey]
        let urls = try FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: Array(keys),
            options: [.skipsHiddenFiles]
        )

        return try urls.compactMap { url in
            guard url.pathExtension.lowercased() == "m4a" else { return nil }
            let values = try url.resourceValues(forKeys: keys)
            guard values.isRegularFile == true, let size = values.fileSize, size > 0 else { return nil }
            return Recording(
                url: url,
                filename: url.lastPathComponent,
                contentType: "audio/mp4",
                createdAt: values.contentModificationDate ?? .distantPast,
                sizeBytes: Int64(size)
            )
        }
        .sorted { $0.createdAt > $1.createdAt }
    }

    nonisolated private static func recordingsDirectory() throws -> URL {
        guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            throw RecordingError.storageUnavailable
        }
        return base.appendingPathComponent("ThingtimeWatchRecordings", isDirectory: true)
    }

    nonisolated private static func timestamp() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return formatter.string(from: Date())
    }
}

private enum RecordingError: LocalizedError {
    case recorderUnavailable
    case storageUnavailable

    var errorDescription: String? {
        switch self {
        case .recorderUnavailable:
            "Apple’s recorder isn’t available right now. Please reopen Thingtime and try again."
        case .storageUnavailable:
            "Recording storage isn’t available on this Apple Watch."
        }
    }
}
