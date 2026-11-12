import AppleFileSync
import Foundation

/// A device credential is retrieved from the existing scoped Keychain record
/// only for one negotiated transfer endpoint, never attached to object PUTs.
@MainActor
final class NativeDeferredUploadClient {
    static let path = "/api/v1/files/sync-transfer-admissions"
    static let feature = "api.file-sync-transfer-admissions"
    enum Failure: Error, LocalizedError {
        case sourceIndexDiscarded, incompatible, invalid, denied, expired, missing, stateChanged, configurationChanged, destinationChanged, partsRetryable, unavailable, photoPathConflict
        var terminal: Bool { [.incompatible, .invalid, .denied, .expired, .missing, .stateChanged, .configurationChanged, .destinationChanged].contains(self) }
        var errorDescription: String? {
            switch self {
            case .sourceIndexDiscarded: return "The pending Photos index was discarded. Its metadata will be rebuilt; saved copies are kept."
            case .denied: return "The paired device could not authorize this background transfer."
            case .expired: return "Background transfer authorization expired or was revoked."
            case .missing: return "The exact background transfer authorization is no longer available."
            case .stateChanged: return "The cloud transfer state changed. Its saved checkpoint was retained."
            case .configurationChanged: return "The saved backup settings changed."
            case .destinationChanged: return "The cloud backup destination changed or is unavailable."
            case .incompatible: return "Background transfers are unavailable on this server. Keep Thingtime open to continue."
            case .invalid: return "The server did not confirm the exact deferred upload."
            case .photoPathConflict: return "A cloud file at the backup path needs review. Its bytes were kept."
            case .partsRetryable, .unavailable: return "Cloud transfer paused. Its original reservation can be retried."
            }
        }
    }
    enum Operation: String, Codable, Sendable {
        case observePhotoIndex = "observe-photo-index"
        case manifest, checkPhotoRun = "check-photo-run", reservePhotoOriginal = "reserve-photo-original"
        case parts, complete, publish, revoke, revokePhotoRun = "revoke-photo-run", localGrant = "local-grant", queue
    }
    struct RequestFailure: Error {
        let failure: Failure
        let operation: Operation
    }
    nonisolated static func failure(_ error: Error) -> Failure? {
        (error as? RequestFailure)?.failure ?? error as? Failure
    }
    nonisolated static func operation(_ error: Error) -> Operation? {
        if let refusal = error as? RequestFailure { return refusal.operation }
        switch error as? NativePhotoRunActivity.SourceFailure {
        case .grantChanged, .photoAccess: return .localGrant
        case .queueChanged: return .queue
        case nil: return (error as? MobileFolderStore.Failure) == .changed ? .localGrant : nil
        }
    }
    private let record: NativeDeferredUploadRecord?
    private let scope: FileSyncOwnerScope
    private let deviceId: String
    private let minimum: [Int]
    private let session: URLSession
    private var verified = false
    private var backgroundFileSupported = false

    init(record: NativeDeferredUploadRecord) {
        self.record = record
        scope = record.scope; deviceId = record.configuration.deviceId
        minimum = [1, 7, 0]
        let configuration = Self.configuration(allowsCellular: record.configuration.network == "any")
        session = URLSession(configuration: configuration, delegate: MobileDeviceRedirectPolicy(), delegateQueue: nil)
    }
    init(photoRun: NativePhotoRunRecord) {
        record = nil; scope = photoRun.scope; deviceId = photoRun.authorization.scope.deviceId; minimum = photoRun.nativeOwnsRun ? [1, 8, 0] : [1, 2, 0]
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
            throw RequestFailure(failure: .incompatible, operation: .manifest)
        }
        backgroundFileSupported = LopuVoiceContract.accepts(manifest, baseURL: scope.origin, feature: Self.feature, minimum: [1, 5, 0])
        verified = true
    }

    func request(action: String, parts: [[String: Any]]? = nil) async throws -> [String: Any] {
        guard let record else { throw Failure.invalid }
        try await requireCapability()
        var payload: [String: Any] = ["action": action, "admissionId": record.admissionId]
        if let parts { payload["parts"] = parts }
        if action == "parts" { payload["reconcileAcceptedParts"] = true }
        if action == "parts", backgroundFileSupported, record.photoRunId != nil { payload["transport"] = "background-file-v1" }
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

    func publishSourceIndex(_ page: PhotoSourceIndexPage, runId: String) async throws -> String {
        var body = try JSONSerialization.jsonObject(with: JSONEncoder().encode(page)) as! [String: Any]
        body["action"] = "observe-photo-index"; body["runId"] = runId
        let result = try await photoRunRequest(body)
        guard let receipt = result["receipt"] as? [String: Any], receipt["sequence"] as? Int == page.sequence,
              receipt["requestId"] as? String == page.requestId, let indexId = receipt["indexId"] as? String, indexId.range(of: "^sync-source-index-[a-f0-9]{64}$", options: .regularExpression) != nil else { throw Failure.invalid }
        return indexId
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
              account: @escaping (NativePhotoTransferBytes, UUID?) throws -> Void) async throws {
        guard let record else { throw Failure.invalid }
        let signed = try await request(action: "parts", parts: [["partNumber": partNumber, "checksumSha256": part.checksumSha256]])
        let allowsCellular = record.configuration.network == "any"
        var request = try NativeFileSession.signedUploadRequest(signed, origin: record.scope.origin, checksum: part.checksumSha256,
            length: part.length, partNumber: partNumber)
        if try NativeFileSession.alreadyUploaded(signed) { try check(); return }
        request.allowsCellularAccess = allowsCellular
        try check()
        let configuration = Self.configuration(allowsCellular: allowsCellular)
        do {
            do {
                try await NativeManagedPhotoPartTransfer.shared.send(request, file: part.url, length: part.length, configuration: configuration,
                    scope: record.scope, authorization: record.request.authorization, conditions: conditions,
                    signedExpiry: try NativeFileSession.signedUploadExpiry(signed, partNumber: partNumber),
                    background: record.configuration.managedPhotos != nil && backgroundFileSupported ? try NativeBackgroundPhotoTransport.parse(signed, request: request, partNumber: partNumber) : nil,
                    record: record, partNumber: partNumber, checksum: part.checksumSha256,
                    accountOnce: { try account($0, $1) }, account: { try account($0, nil) })
            }
        }
        catch let error as URLError where !allowsCellular && error.networkUnavailableReason == .cellular {
            throw NativeUploadAuthorization.Wait.wifi
        }
        try check()
    }

    private func read(_ path: String, body: [String: Any]?) async throws -> [String: Any] {
        do { return try await performRead(path, body: body) }
        catch let failure as Failure {
            guard let operation = body == nil ? Operation.manifest : (body?["action"] as? String).flatMap(Operation.init(rawValue:)) else { throw failure }
            throw RequestFailure(failure: failure, operation: operation)
        }
    }

    private func performRead(_ path: String, body: [String: Any]?) async throws -> [String: Any] {
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
        if [401, 403].contains(http.statusCode) { throw Failure.denied }
        if http.statusCode == 404 { throw Failure.missing }
        if http.statusCode == 410 { throw Failure.expired }
        if http.statusCode == 413 || http.statusCode == 429 || http.statusCode >= 500 { throw Failure.unavailable }
        var data = Data()
        for try await byte in bytes {
            try Task.checkCancellation()
            guard data.count < (body == nil ? 512 * 1024 : 65_536) else { throw Failure.invalid }
            data.append(byte)
        }
        let result = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        if http.statusCode == 409 {
            throw Self.conflictFailure(result)
        }
        guard (200..<300).contains(http.statusCode), let result,
              body == nil || result["ok"] as? Bool == true else { throw Failure.invalid }
        return result
    }

    /// Only registered codes affect recovery. Raw server text never enters a
    /// journal, progress reply, log or user-visible diagnostic.
    static func conflictFailure(_ result: [String: Any]?) -> Failure {
        let error = result?["error"] as? [String: Any]
        let code = result?["code"] as? String ?? error?["code"] as? String
        if code == "source_index_discarded" { return .sourceIndexDiscarded }
        if code == "sync_configuration_changed" { return .configurationChanged }
        if code == "sync_destination_changed" { return .destinationChanged }
        if result?["code"] as? String == "photo_path_conflict" || error?["code"] as? String == "photo_path_conflict" {
            return .photoPathConflict
        }
        if result?["code"] as? String == "upload_parts_retryable" ||
            result?["error"] as? String == "upload_parts_retryable" || error?["code"] as? String == "upload_parts_retryable" {
            return .partsRetryable
        }
        return .stateChanged
    }
}
