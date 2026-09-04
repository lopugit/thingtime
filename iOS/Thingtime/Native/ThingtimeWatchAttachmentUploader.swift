import CryptoKit
import Foundation
import WebKit
import WatchConnectivity

@MainActor
final class ThingtimeWatchAttachmentUploader {
    struct Result: Sendable {
        let requestId: String
        let filename: String
        let ok: Bool
        let message: String

        var transferDictionary: [String: Any] {
            [
                "kind": ThingtimeWatchAttachmentTransfer.resultKind,
                "requestId": requestId,
                "filename": filename,
                "ok": ok,
                "message": message
            ]
        }
    }

    var resultHandler: ((Result) -> Void)?

    private weak var webView: WKWebView?
    private var isProcessing = false
    private var needsAnotherPass = false

    func attach(webView: WKWebView) {
        self.webView = webView
        processPending()
    }

    func processPending() {
        guard webView != nil else { return }
        guard !isProcessing else {
            needsAnotherPass = true
            return
        }
        isProcessing = true
        Task {
            defer {
                isProcessing = false
                if needsAnotherPass {
                    needsAnotherPass = false
                    processPending()
                }
            }
            for pending in Self.loadPending() {
                do {
                    try await upload(pending)
                    Self.remove(pending)
                    resultHandler?(Result(
                        requestId: pending.metadata.requestId,
                        filename: pending.metadata.filename,
                        ok: true,
                        message: "Saved \(pending.metadata.filename) as a private Thing."
                    ))
                } catch {
                    resultHandler?(Result(
                        requestId: pending.metadata.requestId,
                        filename: pending.metadata.filename,
                        ok: false,
                        message: error.localizedDescription
                    ))
                }
            }
        }
    }

    nonisolated static func persistIncoming(_ file: WCSessionFile) throws -> ThingtimeWatchAttachmentMetadata {
        let metadata = try ThingtimeWatchAttachmentTransfer.metadata(from: file.metadata)
        let values = try file.fileURL.resourceValues(forKeys: [.fileSizeKey])
        guard Int64(values.fileSize ?? -1) == metadata.sizeBytes else {
            throw ThingtimeWatchAttachmentUploadError.fileChanged
        }

        let manager = FileManager.default
        try manager.createDirectory(at: inboxDirectory, withIntermediateDirectories: true)
        let payload = payloadURL(for: metadata)
        if manager.fileExists(atPath: payload.path) { try manager.removeItem(at: payload) }
        try manager.copyItem(at: file.fileURL, to: payload)
        try JSONEncoder().encode(metadata).write(to: metadataURL(for: metadata), options: .atomic)
        return metadata
    }

    private func upload(_ pending: Pending) async throws {
        let data = try await Task.detached(priority: .userInitiated) {
            try Self.loadFile(pending)
        }.value

        try await verifyCapabilities()
        let start = try await requestJSON(
            path: "/api/v1/attachments/uploads",
            method: "POST",
            body: [
                "requestId": pending.metadata.requestId,
                "filename": pending.metadata.filename,
                "contentType": pending.metadata.contentType,
                "sizeBytes": pending.metadata.sizeBytes,
                "purpose": "post"
            ]
        )
        let upload = try start.requiredDictionary("upload")
        let attachmentId = try upload.requiredString("id")
        let partSize = try upload.requiredInt("partSizeBytes")
        let partCount = try upload.requiredInt("partCount")
        guard partSize > 0, partCount > 0, partCount <= 20 else {
            throw ThingtimeWatchAttachmentUploadError.invalidServerResponse
        }

        let preparedParts = try await Task.detached(priority: .userInitiated) {
            try Self.prepareParts(data: data, partSize: partSize, partCount: partCount)
        }.value

        var requestedParts: [[String: Any]] = []
        var payloads: [Int: Data] = [:]
        for part in preparedParts {
            payloads[part.number] = part.data
            requestedParts.append([
                "partNumber": part.number,
                "checksumSha256": part.checksum
            ])
        }

        let signed = try await requestJSON(
            path: "/api/v1/attachments/uploads/parts",
            method: "POST",
            body: ["uploadId": attachmentId, "parts": requestedParts]
        )
        guard let signedParts = signed["parts"] as? [[String: Any]], signedParts.count == partCount else {
            throw ThingtimeWatchAttachmentUploadError.invalidServerResponse
        }
        for signedPart in signedParts {
            let partNumber = try signedPart.requiredInt("partNumber")
            let urlString = try signedPart.requiredString("url")
            guard let url = URL(string: urlString), let payload = payloads[partNumber] else {
                throw ThingtimeWatchAttachmentUploadError.invalidServerResponse
            }
            let headers = signedPart["headers"] as? [String: String] ?? [:]
            try await uploadPart(payload, to: url, headers: headers)
        }

        let completed = try await requestJSON(
            path: "/api/v1/attachments/uploads/complete",
            method: "POST",
            body: ["uploadId": attachmentId]
        )
        let attachment = try completed.requiredDictionary("attachment")
        let completedAttachmentId = try attachment.requiredString("id")
        let thingId = "watch-upload-\(pending.metadata.requestId)"
        do {
            _ = try await requestJSON(
                path: "/api/v1/things",
                method: "POST",
                body: [
                    "shareId": thingId,
                    "thingtime": ["post"],
                    "crystal": [
                        "type": "text",
                        "text": "Uploaded from Apple Watch: \(pending.metadata.filename)"
                    ],
                    "acl": ["tt:user"],
                    "attachmentIds": [completedAttachmentId],
                    "tags": ["apple-watch", "attachment"]
                ]
            )
        } catch let error as ThingtimeWatchAttachmentUploadError where error.status == 409 {
            let existing = try await requestJSON(
                path: "/api/v1/things?id=\(thingId)",
                method: "GET",
                body: nil
            )
            guard existing["thing"] != nil || existing["post"] != nil else { throw error }
        }
    }

    private func verifyCapabilities() async throws {
        let manifest = try await requestJSON(
            path: "/.well-known/thingtime-capabilities.json",
            method: "GET",
            body: nil
        )
        guard let features = manifest["features"] as? [String: Any] else {
            throw ThingtimeWatchAttachmentUploadError.incompatibleServer("Thingtime’s capability manifest is unavailable.")
        }
        for (feature, minimum) in ThingtimeWatchUploadRequirements.minimumVersions {
            let raw = features[feature]
            let actual = raw as? String ?? (raw as? [String: Any])?["version"] as? String
            guard let actual, ThingtimeWatchUploadRequirements.satisfies(actual: actual, minimum: minimum) else {
                throw ThingtimeWatchAttachmentUploadError.incompatibleServer("This Thingtime needs a newer attachment API for Apple Watch uploads.")
            }
        }
    }

    private func requestJSON(path: String, method: String, body: [String: Any]?) async throws -> [String: Any] {
        guard let webView else { throw ThingtimeWatchAttachmentUploadError.openPhone }
        let bodyJSON: String
        if let body {
            let data = try JSONSerialization.data(withJSONObject: body)
            guard let encoded = String(data: data, encoding: .utf8) else {
                throw ThingtimeWatchAttachmentUploadError.invalidServerResponse
            }
            bodyJSON = encoded
        } else {
            bodyJSON = ""
        }
        let result = try await webView.callAsyncJavaScript(
            """
            const options = {
              method: httpMethod,
              credentials: 'same-origin',
              headers: { Accept: 'application/json' }
            };
            if (bodyJSON) {
              options.headers['Content-Type'] = 'application/json';
              options.body = bodyJSON;
            }
            const response = await fetch(requestPath, options);
            return JSON.stringify({ status: response.status, body: await response.text() });
            """,
            arguments: ["requestPath": path, "httpMethod": method, "bodyJSON": bodyJSON],
            in: nil,
            contentWorld: .page
        )
        guard let raw = result as? String,
              let envelopeData = raw.data(using: .utf8),
              let envelope = try JSONSerialization.jsonObject(with: envelopeData) as? [String: Any],
              let status = envelope["status"] as? Int,
              let responseBody = envelope["body"] as? String,
              let responseData = responseBody.data(using: .utf8),
              let json = try JSONSerialization.jsonObject(with: responseData) as? [String: Any] else {
            throw ThingtimeWatchAttachmentUploadError.invalidServerResponse
        }
        guard (200..<300).contains(status), json["ok"] as? Bool != false else {
            let message = json["error"] as? String ?? "Thingtime returned HTTP \(status)."
            throw ThingtimeWatchAttachmentUploadError.server(status: status, message: message)
        }
        return json
    }

    private func uploadPart(_ data: Data, to url: URL, headers: [String: String]) async throws {
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue(String(data.count), forHTTPHeaderField: "Content-Length")
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        let (_, response) = try await URLSession.shared.upload(for: request, from: data)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw ThingtimeWatchAttachmentUploadError.partUploadFailed
        }
    }

    private struct Pending: Sendable {
        let metadata: ThingtimeWatchAttachmentMetadata
        let payloadURL: URL
    }

    private struct PreparedPart: Sendable {
        let number: Int
        let data: Data
        let checksum: String
    }

    nonisolated private static func loadFile(_ pending: Pending) throws -> Data {
        let data = try Data(contentsOf: pending.payloadURL, options: .mappedIfSafe)
        guard Int64(data.count) == pending.metadata.sizeBytes else {
            throw ThingtimeWatchAttachmentUploadError.fileChanged
        }
        return data
    }

    nonisolated private static func prepareParts(data: Data, partSize: Int, partCount: Int) throws -> [PreparedPart] {
        try (1...partCount).map { partNumber in
            let lower = (partNumber - 1) * partSize
            let upper = min(lower + partSize, data.count)
            guard lower < upper else { throw ThingtimeWatchAttachmentUploadError.invalidServerResponse }
            let payload = data.subdata(in: lower..<upper)
            return PreparedPart(
                number: partNumber,
                data: payload,
                checksum: Data(SHA256.hash(data: payload)).base64EncodedString()
            )
        }
    }

    nonisolated private static var inboxDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("WatchAttachmentInbox", isDirectory: true)
    }

    nonisolated private static func payloadURL(for metadata: ThingtimeWatchAttachmentMetadata) -> URL {
        let suffix = URL(fileURLWithPath: metadata.filename).pathExtension
        return inboxDirectory.appendingPathComponent(metadata.requestId)
            .appendingPathExtension(suffix.isEmpty ? "payload" : suffix)
    }

    nonisolated private static func metadataURL(for metadata: ThingtimeWatchAttachmentMetadata) -> URL {
        inboxDirectory.appendingPathComponent(metadata.requestId).appendingPathExtension("json")
    }

    nonisolated private static func loadPending() -> [Pending] {
        guard let files = try? FileManager.default.contentsOfDirectory(at: inboxDirectory, includingPropertiesForKeys: nil) else { return [] }
        return files.filter { $0.pathExtension == "json" }.compactMap { url in
            guard let data = try? Data(contentsOf: url),
                  let metadata = try? JSONDecoder().decode(ThingtimeWatchAttachmentMetadata.self, from: data) else { return nil }
            let payload = payloadURL(for: metadata)
            guard FileManager.default.fileExists(atPath: payload.path) else { return nil }
            return Pending(metadata: metadata, payloadURL: payload)
        }
    }

    nonisolated private static func remove(_ pending: Pending) {
        try? FileManager.default.removeItem(at: pending.payloadURL)
        try? FileManager.default.removeItem(at: metadataURL(for: pending.metadata))
    }
}

private enum ThingtimeWatchAttachmentUploadError: LocalizedError {
    case openPhone
    case fileChanged
    case invalidServerResponse
    case incompatibleServer(String)
    case server(status: Int, message: String)
    case partUploadFailed

    var status: Int? {
        if case let .server(status, _) = self { return status }
        return nil
    }

    var errorDescription: String? {
        switch self {
        case .openPhone: "Open Thingtime on your iPhone and sign in to finish the upload."
        case .fileChanged: "The queued Apple Watch attachment changed before it could upload."
        case .invalidServerResponse: "Thingtime returned an unreadable attachment response."
        case let .incompatibleServer(message): message
        case let .server(status, message):
            status == 401 ? "Open Thingtime on your iPhone and sign in to finish the upload." : message
        case .partUploadFailed: "The attachment bytes couldn’t be uploaded. Try again with your iPhone online."
        }
    }
}

private extension Dictionary where Key == String, Value == Any {
    func requiredString(_ key: String) throws -> String {
        guard let value = self[key] as? String, !value.isEmpty else {
            throw ThingtimeWatchAttachmentUploadError.invalidServerResponse
        }
        return value
    }

    func requiredInt(_ key: String) throws -> Int {
        if let value = self[key] as? Int { return value }
        if let value = self[key] as? NSNumber { return value.intValue }
        throw ThingtimeWatchAttachmentUploadError.invalidServerResponse
    }

    func requiredDictionary(_ key: String) throws -> [String: Any] {
        guard let value = self[key] as? [String: Any] else {
            throw ThingtimeWatchAttachmentUploadError.invalidServerResponse
        }
        return value
    }
}
