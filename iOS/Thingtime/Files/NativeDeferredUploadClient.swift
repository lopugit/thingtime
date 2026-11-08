import AppleFileSync
import Foundation

/// A device credential is retrieved from the existing scoped Keychain record
/// only for one negotiated transfer endpoint, never attached to object PUTs.
@MainActor
final class NativeDeferredUploadClient {
    static let path = "/api/v1/files/sync-transfer-admissions"
    static let feature = "api.file-sync-transfer-admissions"
    enum Failure: Error, LocalizedError {
        case incompatible, invalid, denied, partsRetryable, unavailable, photoPathConflict
        var terminal: Bool { self == .incompatible || self == .invalid || self == .denied }
        var errorDescription: String? {
            switch self {
            case .denied: return "Background transfer permission changed. Reopen this sync connection to resume."
            case .incompatible: return "Background transfers are unavailable on this server. Keep Thingtime open to continue."
            case .invalid: return "The server did not confirm the exact deferred upload."
            case .photoPathConflict: return "A cloud file at the backup path needs review. Its bytes were kept."
            case .partsRetryable, .unavailable: return "Cloud transfer paused. Its original reservation can be retried."
            }
        }
    }
    private let record: NativeDeferredUploadRecord?
    private let scope: FileSyncOwnerScope
    private let deviceId: String
    private let minimum: [Int]
    private let session: URLSession
    private var verified = false

    init(record: NativeDeferredUploadRecord) {
        self.record = record
        scope = record.scope; deviceId = record.configuration.deviceId
        minimum = record.request.publication == nil ? [1, 0, 0] : [1, 1, 0]
        let configuration = Self.configuration(allowsCellular: record.configuration.network == "any")
        session = URLSession(configuration: configuration, delegate: MobileDeviceRedirectPolicy(), delegateQueue: nil)
    }
    init(photoRun: NativePhotoRunRecord) {
        record = nil; scope = photoRun.scope; deviceId = photoRun.authorization.scope.deviceId; minimum = photoRun.nativeOwnsRun ? [1, 3, 0] : [1, 2, 0]
        let configuration = Self.configuration(allowsCellular: photoRun.authorization.configuration.network == "any")
        session = URLSession(configuration: configuration, delegate: MobileDeviceRedirectPolicy(), delegateQueue: nil)
    }
    deinit { session.invalidateAndCancel() }

    private static func configuration(allowsCellular: Bool) -> URLSessionConfiguration {
        let c = URLSessionConfiguration.ephemeral
        c.httpCookieStorage = nil; c.urlCredentialStorage = nil
        c.httpShouldSetCookies = false; c.urlCache = nil
        c.allowsCellularAccess = allowsCellular
        return c
    }

    func requireCapability() async throws {
        guard !verified else { return }
        let manifest = try await read(LopuVoiceContract.manifestPath, body: nil)
        guard LopuVoiceContract.accepts(manifest, baseURL: scope.origin, feature: Self.feature, minimum: minimum) else {
            throw Failure.incompatible
        }
        verified = true
    }

    func request(action: String, parts: [[String: Any]]? = nil) async throws -> [String: Any] {
        guard let record else { throw Failure.invalid }
        try await requireCapability()
        var payload: [String: Any] = ["action": action, "admissionId": record.admissionId]
        if let parts { payload["parts"] = parts }
        let result = try await read(Self.path, body: payload)
        if action == "complete" {
            guard let attachment = result["attachment"] as? [String: Any],
                  attachment["id"] as? String == record.request.uploadId else { throw Failure.invalid }
        }
        if action == "publish" { try validatePublication(result) }
        return result
    }

    func photoRunRequest(_ body: [String: Any]) async throws -> [String: Any] {
        guard record == nil else { throw Failure.invalid }
        try await requireCapability()
        return try await read(Self.path, body: body)
    }

    private func validatePublication(_ result: [String: Any]) throws {
        struct Receipt: Decodable {
            struct File: Decodable {
                struct Content: Decodable { let attachmentId: String; let size: Int64; let fingerprint: MobileFolderReader.Fingerprint }
                let id: String; let name: String; let folderId: String; let revision: String; let trashed: Bool; let content: Content
            }
            let file: File; let replayed: Bool
        }
        let receipt = try JSONDecoder().decode(Receipt.self, from: JSONSerialization.data(withJSONObject: result))
        guard let record else { throw Failure.invalid }
        let file = receipt.file, source = record.request.source
        guard let publication = record.request.publication, !file.id.isEmpty, !file.revision.isEmpty, !file.trashed,
              publication.fileId.map({ $0 == file.id }) ?? true,
              file.name == source.path, file.folderId == record.configuration.remoteFolderId,
              file.content.attachmentId == record.request.uploadId, file.content.size == source.size,
              file.content.fingerprint == source.fingerprint else { throw Failure.invalid }
    }

    func send(part: FileUploadPartStore.Part, partNumber: Int, conditions: NativePhotoDownloadConditions, check: () throws -> Void,
              account: (NativePhotoTransferBytes) throws -> Void) async throws {
        guard let record else { throw Failure.invalid }
        let signed = try await request(action: "parts", parts: [["partNumber": partNumber, "checksumSha256": part.checksumSha256]])
        let allowsCellular = record.configuration.network == "any"
        var request = try NativeFileSession.signedUploadRequest(signed, origin: record.scope.origin, checksum: part.checksumSha256,
            length: part.length, partNumber: partNumber)
        request.allowsCellularAccess = allowsCellular
        try check()
        let configuration = Self.configuration(allowsCellular: allowsCellular)
        do {
            if record.configuration.managedPhotos != nil {
                try await NativeManagedPhotoPartTransfer.shared.send(request, file: part.url, length: part.length, configuration: configuration,
                    scope: record.scope, authorization: record.request.authorization, conditions: conditions, account: account)
            } else {
                try await NativeFileUpload().send(request, file: part.url, configuration: configuration)
            }
        }
        catch let error as URLError where !allowsCellular && error.networkUnavailableReason == .cellular {
            throw NativeUploadAuthorization.Wait.wifi
        }
        try check()
    }

    private func read(_ path: String, body: [String: Any]?) async throws -> [String: Any] {
        try Task.checkCancellation()
        guard let url = URL(string: path, relativeTo: scope.origin)?.absoluteURL,
              LopuVoiceContract.sameOrigin(url, scope.origin) else { throw Failure.invalid }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        request.httpShouldHandleCookies = false
        if let body {
            guard let device = try MobileDeviceKeychain.load(scope), device.scope == scope,
                  !device.revoked, device.deviceId == deviceId,
                  device.credential.range(of: "^ttnode_[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else { throw Failure.denied }
            request.httpMethod = "POST"
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("Bearer " + device.credential, forHTTPHeaderField: "Authorization")
        }
        let (bytes, response) = try await session.bytes(for: request)
        guard let http = response as? HTTPURLResponse, http.url == url else { throw Failure.invalid }
        if [401, 403, 404, 410].contains(http.statusCode) { throw Failure.denied }
        if http.statusCode == 429 || http.statusCode >= 500 { throw Failure.unavailable }
        var data = Data()
        for try await byte in bytes {
            try Task.checkCancellation()
            guard data.count < (body == nil ? 512 * 1024 : 65_536) else { throw Failure.invalid }
            data.append(byte)
        }
        let result = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        if http.statusCode == 409 {
            let error = result?["error"] as? [String: Any]
            if result?["code"] as? String == "photo_path_conflict" || error?["code"] as? String == "photo_path_conflict" {
                throw Failure.photoPathConflict
            }
            if result?["code"] as? String == "upload_parts_retryable" ||
                result?["error"] as? String == "upload_parts_retryable" || error?["code"] as? String == "upload_parts_retryable" {
                throw Failure.partsRetryable
            }
            throw Failure.denied
        }
        guard (200..<300).contains(http.statusCode), let result,
              body == nil || result["ok"] as? Bool == true else { throw Failure.invalid }
        return result
    }
}
