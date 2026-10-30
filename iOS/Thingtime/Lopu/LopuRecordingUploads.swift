import AVFoundation
import CryptoKit
import Foundation
#if os(iOS)
import UIKit
#endif

private final class LopuUploadRedirectPolicy: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// A local outbox contains account/origin-bound file references, never credentials.
/// Uploads reuse the canonical private attachment API and its idempotent request IDs.
@MainActor
final class LopuRecordingUploads {
    struct Context: Codable, Equatable {
        let ownerId: String
        let origin: URL
    }
    struct Entry: Codable {
        let id: String
        let sourceName: String
        let context: Context
        var uploadId: String?
        var partsSent = false
        var completedAttachmentId: String?
    }
    typealias Transport = (URLRequest) async throws -> (Data, HTTPURLResponse)
    var notify: ((String, [String: Any]) -> Void)?
    private let directory: URL
    private let outbox: URL
    private let transport: Transport
    private let legacySources: [URL]
    private var importOlder = true
    private var context: Context?
    private var cookie = ""
    private var worker: Task<Void, Never>?
    private var workerID = UUID()

    init(directory: URL? = nil, transport: Transport? = nil) {
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        self.directory = directory ?? documents.appendingPathComponent("Lopu Recordings", isDirectory: true)
        self.outbox = self.directory.appendingPathComponent(".uploads", isDirectory: true)
        self.legacySources = ((try? FileManager.default.contentsOfDirectory(at: self.directory, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey])) ?? []).filter {
            let values = try? $0.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
            return $0.lastPathComponent.hasPrefix("Lopu-") && $0.pathExtension == "caf" && values?.isRegularFile == true && values?.isSymbolicLink != true
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        let session = URLSession(configuration: configuration, delegate: LopuUploadRedirectPolicy(), delegateQueue: nil)
        self.transport = transport ?? { request in
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw UploadError.failed }
            return (data, http)
        }
    }

    static func context(ownerId: String?, baseURL: URL) -> Context? {
        guard let ownerId, !ownerId.isEmpty, ownerId.count <= 128,
              var parts = URLComponents(url: baseURL, resolvingAgainstBaseURL: false),
              ["https", "http"].contains(parts.scheme), parts.host != nil,
              parts.user == nil, parts.password == nil else { return nil }
        parts.path = ""; parts.query = nil; parts.fragment = nil
        guard let origin = parts.url else { return nil }
        return Context(ownerId: ownerId, origin: origin)
    }

    func activate(_ context: Context?, cookie: String, importOlder: Bool = true) {
        if self.context != context || self.cookie != cookie || self.importOlder != importOlder {
            workerID = UUID()
            worker?.cancel()
        }
        self.importOlder = importOlder
        self.context = context
        self.cookie = cookie
        pump()
    }

    func enqueue(source: URL, context: Context) throws {
        guard source.deletingLastPathComponent().standardizedFileURL == directory.standardizedFileURL else { throw UploadError.failed }
        guard !inventory().contains(where: { $0.sourceName == source.lastPathComponent }) else { return }
        let entry = Entry(id: UUID().uuidString, sourceName: source.lastPathComponent, context: context)
        try save(entry)
        pump()
    }

    private func save(_ entry: Entry) throws {
        try FileManager.default.createDirectory(at: outbox, withIntermediateDirectories: true)
        try JSONEncoder().encode(entry).write(to: outbox.appendingPathComponent(entry.id + ".json"), options: .atomic)
    }

    func pending() -> [Entry] { inventory().filter { $0.completedAttachmentId == nil } }

    func inventory() -> [Entry] {
        let urls = (try? FileManager.default.contentsOfDirectory(at: outbox, includingPropertiesForKeys: nil)) ?? []
        return urls.sorted { $0.lastPathComponent < $1.lastPathComponent }.compactMap { url in
            guard url.pathExtension == "json", let data = try? Data(contentsOf: url),
                  let entry = try? JSONDecoder().decode(Entry.self, from: data),
                  UUID(uuidString: entry.id) != nil, url.lastPathComponent == entry.id + ".json",
                  entry.sourceName == URL(fileURLWithPath: entry.sourceName).lastPathComponent else { return nil }
            return entry
        }
    }

    private func pump() {
        guard worker == nil, let context, !cookie.isEmpty else { return }
        let id = UUID(); workerID = id
        let cookie = self.cookie
        let importOlder = self.importOlder
        worker = Task {
#if os(iOS)
            let background = UIApplication.shared.beginBackgroundTask(withName: "Save Lopu recordings") { [weak self] in
                Task { @MainActor in if self?.workerID == id { self?.worker?.cancel() } }
            }
#endif
            defer {
#if os(iOS)
                if background != .invalid { UIApplication.shared.endBackgroundTask(background) }
#endif
                worker = nil
                if self.context != context || self.cookie != cookie || self.importOlder != importOlder { pump() }
            }
            if importOlder {
                do { try await importLegacy(context: context, cookie: cookie) }
                catch {
                    if !Task.isCancelled { notify?("lopu-voice-recording-upload", ["ownerId": context.ownerId, "state": "pending", "message": "Older recordings remain on this device. Automatic import will retry when Lopu reconnects."]) }
                }
            }
            var attempted = Set<String>()
            while !Task.isCancelled, workerID == id,
                  var entry = pending().first(where: { $0.context == context && !attempted.contains($0.id) }) {
                attempted.insert(entry.id)
                do {
                    let attachmentId = try await upload(&entry, cookie: cookie)
                    // Persist success before notification; a lost response is recovered by the same requestId.
                    entry.completedAttachmentId = attachmentId
                    try save(entry)
                    guard workerID == id, !Task.isCancelled else { return }
                    notify?("lopu-voice-recording-upload", ["ownerId": context.ownerId, "recordingId": entry.id,
                        "filename": entry.sourceName, "attachmentId": attachmentId, "state": "saved"])
                } catch {
                    guard workerID == id, !Task.isCancelled else { return }
                    notify?("lopu-voice-recording-upload", ["ownerId": context.ownerId, "recordingId": entry.id,
                        "filename": entry.sourceName, "state": "pending",
                        "message": "Saved on this iPhone. Upload to Things is pending; reopen Lopu when connected and signed into the recording's account. Check private-upload permission and available storage if it persists."])
                }
            }
        }
    }

    /// Snapshot only files that existed before this controller could start recording.
    /// Receipts also retain their first account binding after a successful upload.
    func importLegacy(context: Context, cookie: String) async throws {
        let claimed = Set(inventory().map(\.sourceName))
        let candidates = legacySources.filter { !claimed.contains($0.lastPathComponent) }
        guard !candidates.isEmpty else { return }
        let manifest = try await request(LopuVoiceContract.manifestPath, context: context, cookie: "")
        for (feature, minimum) in [("api.auth-me", [1, 0, 0]), ("api.things", [1, 7, 0])] {
            guard LopuVoiceContract.accepts(manifest, baseURL: context.origin, feature: feature, minimum: minimum) else { throw UploadError.incompatible }
        }
        let identity = try await request("/api/v1/auth/me", context: context, cookie: cookie)
        guard (identity["user"] as? [String: Any])?["id"] as? String == context.ownerId else { throw UploadError.wrongAccount }
        // Build 29 removed successful queue entries. Reconcile those files with the
        // account's existing attachment metadata before reserving any new uploads.
        var remote: [String: String] = [:]
        var cursor: String?
        var seen = Set<String>()
        repeat {
            var url = URLComponents(string: "/api/v1/things")!
            url.queryItems = [URLQueryItem(name: "thingtime", value: "attachment"), URLQueryItem(name: "limit", value: "100")]
            if let cursor { url.queryItems?.append(URLQueryItem(name: "cursor", value: cursor)) }
            let page = try await request(url.string!, context: context, cookie: cookie)
            guard let things = page["things"] as? [[String: Any]] else { throw UploadError.failed }
            for thing in things {
                guard let crystal = thing["crystal"] as? [String: Any], let name = crystal["name"] as? String,
                      let size = crystal["size"] as? Int, let id = thing["id"] as? String else { continue }
                remote["\(name):\(size)"] = id
            }
            cursor = page["nextCursor"] as? String
            if let cursor, !seen.insert(cursor).inserted { throw UploadError.failed }
        } while cursor != nil
        for source in candidates {
            try Task.checkCancellation()
            guard !inventory().contains(where: { $0.sourceName == source.lastPathComponent }) else { continue }
            guard let audio = try? AVAudioFile(forReading: source), audio.length > 0 else { continue }
            // Build 29 retained its encoded file. New imports can enqueue without
            // exporting the entire library before the first upload gets a turn.
            let encoded = source.deletingPathExtension().appendingPathExtension("m4a")
            let size = (try? encoded.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
            let hash = SHA256.hash(data: Data(source.lastPathComponent.utf8)).prefix(16)
            let bytes = Array(hash)
            let id = UUID(uuid: (bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7], bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15])).uuidString
            try Task.checkCancellation()
            try save(Entry(id: id, sourceName: source.lastPathComponent, context: context,
                           completedAttachmentId: remote["\(encoded.lastPathComponent):\(size)"]))
        }
    }

    enum UploadError: Error { case failed, wrongAccount, incompatible, unsafeUpload, http(Int) }

    func request(_ path: String, context: Context, cookie: String, body: [String: Any]? = nil) async throws -> [String: Any] {
        try Task.checkCancellation()
        let url = URL(string: path, relativeTo: context.origin)!.absoluteURL
        var request = URLRequest(url: url)
        request.timeoutInterval = 30
        request.httpMethod = body == nil ? "GET" : "POST"
        request.httpShouldHandleCookies = false
        request.setValue(cookie, forHTTPHeaderField: "Cookie")
        request.setValue(context.origin.absoluteString, forHTTPHeaderField: "Origin")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await transport(request)
        guard response.url.map({ LopuVoiceContract.sameOrigin($0, context.origin) }) == true else { throw UploadError.failed }
        guard (200..<300).contains(response.statusCode) else { throw UploadError.http(response.statusCode) }
        guard let result = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              result["ok"] as? Bool != false else { throw UploadError.failed }
        return result
    }

    func upload(_ entry: inout Entry, cookie: String) async throws -> String {
        let context = entry.context
        let manifest = try await request(LopuVoiceContract.manifestPath, context: context, cookie: "")
        for (feature, minimum) in [("api.auth-me", [1, 0, 0]), ("api.attachment-uploads", [1, 2, 0]),
                                   ("api.attachment-upload-parts", [1, 1, 0]), ("api.attachment-upload-complete", [1, 2, 0])] {
            guard LopuVoiceContract.accepts(manifest, baseURL: context.origin, feature: feature, minimum: minimum) else { throw UploadError.incompatible }
        }
        let identity = try await request("/api/v1/auth/me", context: context, cookie: cookie)
        guard (identity["user"] as? [String: Any])?["id"] as? String == context.ownerId else { throw UploadError.wrongAccount }
        if entry.partsSent, let uploadId = entry.uploadId {
            do {
                _ = try await request("/api/v1/attachments/uploads/complete", context: context, cookie: cookie, body: ["uploadId": uploadId])
                return uploadId
            } catch UploadError.http(404) {
                // An expired pending upload may have been reaped. Start with the same
                // request ID: an existing ready Thing is replayed, never duplicated.
                entry.partsSent = false
                try save(entry)
            }
        }
        let source = directory.appendingPathComponent(entry.sourceName)
        let audio = try await Self.exportAudio(source)
        let size = try audio.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size > 0 else { throw UploadError.failed }
        let started = try await request("/api/v1/attachments/uploads", context: context, cookie: cookie, body: [
            "requestId": "lopu-recording-" + entry.id, "purpose": "recording", "filename": audio.lastPathComponent,
            "contentType": "audio/mp4", "sizeBytes": size
        ])
        guard let plan = started["upload"] as? [String: Any], let uploadId = plan["id"] as? String,
              !uploadId.isEmpty else { throw UploadError.failed }
        entry.uploadId = uploadId
        try save(entry)
        if plan["state"] as? String == "ready" { return uploadId }
        guard let partSize = plan["partSizeBytes"] as? Int, partSize > 0, partSize <= 16 * 1024 * 1024,
              let count = plan["partCount"] as? Int, count == (size + partSize - 1) / partSize else { throw UploadError.failed }
        let file = try FileHandle(forReadingFrom: audio)
        defer { try? file.close() }
        for number in 1...count {
            try Task.checkCancellation()
            let bytes = try file.read(upToCount: min(partSize, size - (number - 1) * partSize)) ?? Data()
            guard !bytes.isEmpty else { throw UploadError.failed }
            let checksum = Data(SHA256.hash(data: bytes)).base64EncodedString()
            let signed = try await request("/api/v1/attachments/uploads/parts", context: context, cookie: cookie,
                body: ["uploadId": uploadId, "parts": [["partNumber": number, "checksumSha256": checksum]]])
            guard let part = (signed["parts"] as? [[String: Any]])?.first,
                  part["partNumber"] as? Int == number,
                  let value = part["url"] as? String, let url = URL(string: value),
                  url.scheme == "https", url.user == nil, url.password == nil, url.fragment == nil,
                  url.host?.hasSuffix(".amazonaws.com") == true,
                  let headers = part["headers"] as? [String: String], headers["x-amz-checksum-sha256"] == checksum,
                  headers.keys.allSatisfy({ $0.lowercased() == "x-amz-checksum-sha256" }) else { throw UploadError.unsafeUpload }
            var put = URLRequest(url: url)
            put.httpMethod = "PUT"; put.timeoutInterval = 90; put.httpShouldHandleCookies = false
            put.httpBody = bytes
            for (name, value) in headers { put.setValue(value, forHTTPHeaderField: name) }
            let (_, response) = try await transport(put)
            guard (200..<300).contains(response.statusCode), response.url == url else { throw UploadError.failed }
        }
        entry.partsSent = true
        try save(entry)
        _ = try await request("/api/v1/attachments/uploads/complete", context: context, cookie: cookie, body: ["uploadId": uploadId])
        return uploadId
    }

    static func exportAudio(_ source: URL) async throws -> URL {
        let destination = source.deletingPathExtension().appendingPathExtension("m4a")
        if FileManager.default.fileExists(atPath: destination.path) { return destination }
        let temporary = source.deletingPathExtension().appendingPathExtension("uploading.m4a")
        try? FileManager.default.removeItem(at: temporary)
        guard let exporter = AVAssetExportSession(asset: AVURLAsset(url: source), presetName: AVAssetExportPresetAppleM4A) else { throw UploadError.failed }
        exporter.outputURL = temporary; exporter.outputFileType = .m4a
        await withTaskCancellationHandler(operation: { await exporter.export() }, onCancel: { exporter.cancelExport() })
        guard exporter.status == .completed, !Task.isCancelled else { throw UploadError.failed }
        try FileManager.default.moveItem(at: temporary, to: destination)
        return destination
    }
}
