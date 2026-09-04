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
            let formatter = DateFormatter()
            formatter.locale = .autoupdatingCurrent
            formatter.setLocalizedDateFormatFromTemplate("dMMMhm")
            return formatter.string(from: createdAt)
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

        Task { [weak self] in
            guard let self else { return }
            for attempt in 0..<12 {
                if let recording = try? Self.recording(at: outputURL) {
                    self.refresh()
                    self.errorMessage = nil
                    self.completedRecording?(recording)
                    return
                }
                if attempt < 11 {
                    try? await Task.sleep(for: .milliseconds(250))
                }
            }
            self.refresh()
            self.errorMessage = "The recording is still saved on this Watch. Open Choose saved recording, then retry its upload."
        }
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

        return urls.compactMap { try? recording(at: $0, keys: keys) }
        .sorted { $0.createdAt > $1.createdAt }
    }

    nonisolated private static func recording(
        at url: URL,
        keys: Set<URLResourceKey> = [.contentModificationDateKey, .fileSizeKey, .isRegularFileKey]
    ) throws -> Recording? {
        guard url.pathExtension.lowercased() == "m4a" else { return nil }
        let values = try url.resourceValues(forKeys: keys)
        guard values.isRegularFile == true, let size = values.fileSize, size > 0 else { return nil }
        let normalizedURL = url.standardizedFileURL
        return Recording(
            url: normalizedURL,
            filename: normalizedURL.lastPathComponent,
            contentType: "audio/mp4",
            createdAt: values.contentModificationDate ?? .distantPast,
            sizeBytes: Int64(size)
        )
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
