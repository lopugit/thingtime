import CryptoKit
import Foundation
import Security
import WatchKit

struct ThingtimeWatchPairingRequest: Equatable, Sendable {
    let pairingID: String
    let deviceCode: String
    let userCode: String
    let expiresAt: String
    let verificationURL: URL
    let credential: String
}

struct ThingtimeWatchSyncResult: Sendable {
    let account: ThingtimeWatchAccount
    let notifications: [ThingtimeWatchNotification]
    let unreadCount: Int
    let nextCursor: String?
    let serverTime: String
}

struct ThingtimeWatchUploadResult: Sendable {
    let thingID: String
    let attachmentID: String
}

struct ThingtimeWatchAPIClient: Sendable {
    let origin: URL
    let credential: String?

    init(origin: String, credential: String? = nil) throws {
        guard let url = URL(string: origin), url.scheme == "https", url.host != nil else {
            throw ThingtimeWatchAPIError.invalidOrigin
        }
        self.origin = url
        self.credential = credential
    }

    func startPairing() async throws -> ThingtimeWatchPairingRequest {
        let credential = try Self.newCredential()
        let device = await Self.deviceDescriptor()
        let json = try await requestJSON(
            path: "/api/v1/watch/pairing",
            method: "POST",
            body: ["op": "start", "device": device],
            authenticated: false
        )
        let pairing = try json.requiredDictionary("pairing")
        let pairingID = try pairing.requiredString("pairingId")
        let deviceCode = try pairing.requiredString("deviceCode")
        let userCode = try pairing.requiredString("userCode")
        let expiresAt = try pairing.requiredString("expiresAt")
        let path = try pairing.requiredString("verificationPath")
        guard let verificationURL = URL(string: path, relativeTo: origin)?.absoluteURL else {
            throw ThingtimeWatchAPIError.invalidResponse
        }
        return ThingtimeWatchPairingRequest(
            pairingID: pairingID,
            deviceCode: deviceCode,
            userCode: userCode,
            expiresAt: expiresAt,
            verificationURL: verificationURL,
            credential: credential
        )
    }

    func claimPairing(_ pairing: ThingtimeWatchPairingRequest) async throws -> ThingtimeWatchAccount {
        let json = try await requestJSON(
            path: "/api/v1/watch/pairing",
            method: "POST",
            body: [
                "op": "claim",
                "pairingId": pairing.pairingID,
                "deviceCode": pairing.deviceCode,
                "credential": pairing.credential
            ],
            authenticated: false
        )
        let user = try json.requiredDictionary("user")
        let device = try json.requiredDictionary("device")
        let userID = try user.requiredString("id")
        let deviceID = try device.requiredString("id")
        return ThingtimeWatchAccount(
            id: Self.accountID(origin: origin.absoluteString, userID: userID, deviceID: deviceID),
            origin: Self.normalizedOrigin(origin),
            userId: userID,
            deviceId: deviceID,
            username: try user.requiredString("username"),
            displayName: user["displayName"] as? String,
            avatarURL: user["avatarUrl"] as? String
        )
    }

    func sync(account: ThingtimeWatchAccount, cursor: String? = nil, from: String? = nil, to: String? = nil, limit: Int = 25) async throws -> ThingtimeWatchSyncResult {
        var body: [String: Any] = [
            "limit": max(1, min(50, limit)),
            "batteryLevel": await Self.batteryLevel(),
            "lowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled
        ]
        if let cursor { body["cursor"] = cursor }
        if let from { body["from"] = from }
        if let to { body["to"] = to }
        let json = try await requestJSON(path: "/api/v1/watch/sync", method: "POST", body: body)
        let rawAccount = try json.requiredDictionary("account")
        let rawDevice = try json.requiredDictionary("device")
        let notificationsData = try JSONSerialization.data(withJSONObject: json["notifications"] as? [[String: Any]] ?? [])
        let notifications = try JSONDecoder().decode([ThingtimeWatchNotification].self, from: notificationsData)
        let refreshed = ThingtimeWatchAccount(
            id: account.id,
            origin: account.origin,
            userId: try rawAccount.requiredString("id"),
            deviceId: try rawDevice.requiredString("id"),
            username: try rawAccount.requiredString("username"),
            displayName: rawAccount["displayName"] as? String,
            avatarURL: rawAccount["avatarUrl"] as? String
        )
        return ThingtimeWatchSyncResult(
            account: refreshed,
            notifications: notifications,
            unreadCount: json.int("unreadCount") ?? 0,
            nextCursor: json["nextCursor"] as? String,
            serverTime: try json.requiredString("serverTime")
        )
    }

    func markRead(ids: [String]) async throws {
        guard !ids.isEmpty else { return }
        _ = try await requestJSON(
            path: "/api/v1/watch/sync",
            method: "POST",
            body: [
                "op": "mark-read",
                "ids": Array(ids.prefix(100)),
                "batteryLevel": await Self.batteryLevel(),
                "lowPowerMode": ProcessInfo.processInfo.isLowPowerModeEnabled
            ]
        )
    }

    func registerPushToken(_ token: String) async throws {
        _ = try await requestJSON(
            path: "/api/v1/notifications/devices",
            method: "POST",
            body: [
                "devices": [[
                    "token": token,
                    "platform": "watchos",
                    "environment": Self.pushEnvironment
                ]]
            ]
        )
    }

    func upload(data: Data, metadata: ThingtimeWatchAttachmentMetadata) async throws -> ThingtimeWatchUploadResult {
        guard Int64(data.count) == metadata.sizeBytes else { throw ThingtimeWatchAPIError.fileChanged }
        try await verifyCapabilities()
        let start: [String: Any]
        do {
            start = try await requestJSON(
                path: "/api/v1/attachments/uploads",
                method: "POST",
                body: [
                    "requestId": metadata.requestId,
                    "filename": metadata.filename,
                    "contentType": metadata.contentType,
                    "sizeBytes": metadata.sizeBytes,
                    "purpose": "post"
                ]
            )
        } catch let error as ThingtimeWatchAPIError where error.isCompletedUploadRetry {
            return try await createPrivateThing(metadata: metadata, requestIDs: [metadata.requestId])
        }
        let upload = try start.requiredDictionary("upload")
        let attachmentID = try upload.requiredString("id")
        let partSize = try upload.requiredInt("partSizeBytes")
        let partCount = try upload.requiredInt("partCount")
        guard partSize > 0, (1...20).contains(partCount) else { throw ThingtimeWatchAPIError.invalidResponse }
        let parts = try Self.prepareParts(data: data, partSize: partSize, partCount: partCount)
        let signed = try await requestJSON(
            path: "/api/v1/attachments/uploads/parts",
            method: "POST",
            body: [
                "uploadId": attachmentID,
                "parts": parts.map { ["partNumber": $0.number, "checksumSha256": $0.checksum] }
            ]
        )
        guard let signedParts = signed["parts"] as? [[String: Any]], signedParts.count == partCount else {
            throw ThingtimeWatchAPIError.invalidResponse
        }
        for signedPart in signedParts {
            let number = try signedPart.requiredInt("partNumber")
            let urlString = try signedPart.requiredString("url")
            guard let url = URL(string: urlString), let part = parts.first(where: { $0.number == number }) else {
                throw ThingtimeWatchAPIError.invalidResponse
            }
            try await uploadPart(part.data, to: url, headers: signedPart["headers"] as? [String: String] ?? [:])
        }
        let completed = try await requestJSON(
            path: "/api/v1/attachments/uploads/complete",
            method: "POST",
            body: ["uploadId": attachmentID]
        )
        let completedAttachmentID = try completed.requiredDictionary("attachment").requiredString("id")
        return try await createPrivateThing(metadata: metadata, attachmentIDs: [completedAttachmentID])
    }

    private func createPrivateThing(
        metadata: ThingtimeWatchAttachmentMetadata,
        attachmentIDs: [String]? = nil,
        requestIDs: [String]? = nil
    ) async throws -> ThingtimeWatchUploadResult {
        let shareID = "watch-upload-\(metadata.requestId)"
        var body: [String: Any] = [
            "shareId": shareID,
            "filenames": [metadata.filename]
        ]
        if let attachmentIDs { body["attachmentIds"] = attachmentIDs }
        if let requestIDs { body["requestIds"] = requestIDs }
        let created = try await requestJSON(
            path: "/api/v1/watch/things",
            method: "POST",
            body: body
        )
        let post = try created.requiredDictionary("post")
        let thingID = (post["id"] as? String) ?? (post["shareId"] as? String) ?? shareID
        let returnedAttachmentID = (post["attachments"] as? [[String: Any]])?.first?["id"] as? String
        let attachmentID = returnedAttachmentID ?? attachmentIDs?.first ?? requestIDs?.first ?? metadata.requestId
        return ThingtimeWatchUploadResult(thingID: thingID, attachmentID: attachmentID)
    }

    private func verifyCapabilities() async throws {
        let json = try await requestJSON(path: "/.well-known/thingtime-capabilities.json", method: "GET", body: nil, authenticated: false)
        guard let features = json["features"] as? [String: Any] else {
            throw ThingtimeWatchAPIError.incompatible("Thingtime’s capability manifest is unavailable.")
        }
        for (feature, minimum) in Self.minimumFeatures {
            let value = features[feature]
            let actual = value as? String ?? (value as? [String: Any])?["version"] as? String
            guard let actual, ThingtimeWatchUploadRequirements.satisfies(actual: actual, minimum: minimum) else {
                throw ThingtimeWatchAPIError.incompatible("This Thingtime needs a newer direct Apple Watch API.")
            }
        }
    }

    private func requestJSON(path: String, method: String, body: [String: Any]?, authenticated: Bool = true) async throws -> [String: Any] {
        guard let url = URL(string: path, relativeTo: origin)?.absoluteURL else { throw ThingtimeWatchAPIError.invalidOrigin }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if authenticated {
            guard let credential, !credential.isEmpty else { throw ThingtimeWatchAPIError.signedOut }
            request.setValue("Bearer \(credential)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw ThingtimeWatchAPIError.invalidResponse }
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard (200..<300).contains(http.statusCode), json["ok"] as? Bool != false else {
            throw ThingtimeWatchAPIError.server(
                status: http.statusCode,
                code: json["code"] as? String,
                message: json["error"] as? String ?? "Thingtime returned HTTP \(http.statusCode)."
            )
        }
        return json
    }

    private func uploadPart(_ data: Data, to url: URL, headers: [String: String]) async throws {
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.timeoutInterval = 90
        request.setValue(String(data.count), forHTTPHeaderField: "Content-Length")
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        let (_, response) = try await URLSession.shared.upload(for: request, from: data)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw ThingtimeWatchAPIError.partUpload
        }
    }

    private struct PreparedPart: Sendable {
        let number: Int
        let data: Data
        let checksum: String
    }

    private static let minimumFeatures = [
        "api.attachment-uploads": "1.1.0",
        "api.attachment-upload-parts": "1.1.0",
        "api.attachment-upload-complete": "1.1.0",
        "api.watch-things": "1.0.0"
    ]

    private static var pushEnvironment: String {
#if DEBUG
        "sandbox"
#else
        "production"
#endif
    }

    private static func prepareParts(data: Data, partSize: Int, partCount: Int) throws -> [PreparedPart] {
        try (1...partCount).map { number in
            let lower = (number - 1) * partSize
            let upper = min(lower + partSize, data.count)
            guard lower < upper else { throw ThingtimeWatchAPIError.invalidResponse }
            let payload = data.subdata(in: lower..<upper)
            return PreparedPart(number: number, data: payload, checksum: Data(SHA256.hash(data: payload)).base64EncodedString())
        }
    }

    private static func newCredential() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw ThingtimeWatchAPIError.randomness
        }
        return "ttnode_" + Data(bytes).base64URLEncodedString()
    }

    @MainActor
    private static func deviceDescriptor() -> [String: Any] {
        let device = WKInterfaceDevice.current()
        return [
            "name": device.name.isEmpty ? "Apple Watch" : device.name,
            "platform": "watchos",
            "model": device.model,
            "osVersion": device.systemVersion,
            "appVersion": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?"
        ]
    }

    @MainActor
    private static func batteryLevel() -> Double {
        let device = WKInterfaceDevice.current()
        device.isBatteryMonitoringEnabled = true
        return max(0, Double(device.batteryLevel))
    }

    private static func accountID(origin: String, userID: String, deviceID: String) -> String {
        Data("\(origin.lowercased())\u{0}\(userID)\u{0}\(deviceID)".utf8).base64URLEncodedString()
    }

    private static func normalizedOrigin(_ url: URL) -> String {
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.path = ""
        components?.query = nil
        components?.fragment = nil
        return components?.url?.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")) ?? url.absoluteString
    }
}

enum ThingtimeWatchAPIError: LocalizedError {
    case invalidOrigin
    case invalidResponse
    case signedOut
    case randomness
    case fileChanged
    case partUpload
    case incompatible(String)
    case server(status: Int, code: String?, message: String)

    var isAuthorizationPending: Bool {
        if case let .server(_, code, _) = self { return code == "authorization_pending" }
        return false
    }

    var isUnauthorized: Bool {
        if case let .server(status, _, _) = self { return status == 401 }
        return false
    }

    var isCompletedUploadRetry: Bool {
        if case let .server(status, code, _) = self { return status == 409 && code == "upload_unavailable" }
        return false
    }

    var errorDescription: String? {
        switch self {
        case .invalidOrigin: "Choose a secure Thingtime domain."
        case .invalidResponse: "Thingtime returned an unreadable response."
        case .signedOut: "Choose or connect a Thingtime account first."
        case .randomness: "This Watch couldn’t create a secure pairing credential."
        case .fileChanged: "The saved attachment changed before it could upload."
        case .partUpload: "The attachment bytes couldn’t reach Thingtime."
        case let .incompatible(message): message
        case let .server(status, _, message): status == 401 ? "This Watch account needs to be connected again." : message
        }
    }
}

private extension Data {
    func base64URLEncodedString() -> String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}

private extension Dictionary where Key == String, Value == Any {
    func requiredString(_ key: String) throws -> String {
        guard let value = self[key] as? String, !value.isEmpty else { throw ThingtimeWatchAPIError.invalidResponse }
        return value
    }

    func requiredInt(_ key: String) throws -> Int {
        if let value = self[key] as? Int { return value }
        if let value = self[key] as? NSNumber { return value.intValue }
        throw ThingtimeWatchAPIError.invalidResponse
    }

    func int(_ key: String) -> Int? {
        if let value = self[key] as? Int { return value }
        return (self[key] as? NSNumber)?.intValue
    }

    func requiredDictionary(_ key: String) throws -> [String: Any] {
        guard let value = self[key] as? [String: Any] else { throw ThingtimeWatchAPIError.invalidResponse }
        return value
    }
}
