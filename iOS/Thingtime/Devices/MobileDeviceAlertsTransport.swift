import CoreFoundation
import Foundation

@MainActor
final class MobileDeviceAlertsTransport {
    let client: MobileDeviceNodeTransport
    convenience init() { self.init(client: .make()) }
    init(client: MobileDeviceNodeTransport) { self.client = client }
    static let requirements = ["api.devices-node-commands": [1, 11, 0], "api.devices-node-push": [1, 0, 0],
        "api.devices-node-media": [1, 0, 0], "api.devices-node-alert-sounds": [1, 0, 0]]
    func registerPush(scope: MobileDevicePairing.Scope, token: String, environment: String, topic: String,
                      cacheGeneration: String, check: () throws -> Void) async throws {
        _ = try await client.request(scope, "/api/v1/devices/node/push", body: MobileDevicePairing.json([
            "token": token, "environment": environment, "topic": topic, "cacheGeneration": cacheGeneration]), check: check)
    }
    func claim(scope: MobileDevicePairing.Scope, check: () throws -> Void) async throws -> MobileDeviceCommandWorker.Command? {
        let response = try await client.request(scope, "/api/v1/devices/node/commands",
            body: MobileDevicePairing.json(["op": "claim", "waitMs": 0]), check: check)
        guard let value = response["command"] as? [String: Any] else { return nil }
        guard let id = value["id"] as? String, !id.isEmpty, let kind = value["kind"] as? String,
              let input = value["input"] as? [String: Any], let needsApproval = value["requiresApproval"] as? Bool,
              let approvalState = value["approvalState"] as? String, let lease = value["leaseId"] as? String, !lease.isEmpty,
              let expiry = value["leaseExpiresAt"] as? String, let expiresAt = MobileDevicePairing.date(expiry) else {
            throw MobileDevicePairing.Failure.invalid
        }
        return .init(id: id, kind: kind, input: input, leaseId: lease, leaseExpiresAt: expiresAt,
            approved: needsApproval ? approvalState == "approved" : approvalState == "not-required")
    }
    func heartbeat(_ command: MobileDeviceCommandWorker.Command, scope: MobileDevicePairing.Scope,
                   check: () throws -> Void) async throws -> Date {
        let result = try await client.request(scope, "/api/v1/devices/node/commands", body: MobileDevicePairing.json([
            "op": "heartbeat", "commandId": command.id, "leaseId": command.leaseId]), check: check)
        guard let text = result["leaseExpiresAt"] as? String, let date = MobileDevicePairing.date(text) else { throw MobileDevicePairing.Failure.invalid }
        return date
    }
    func report(_ command: MobileDeviceCommandWorker.Command, eventId: String, status: String,
                scope: MobileDevicePairing.Scope, check: () throws -> Void) async throws {
        _ = try await client.request(scope, "/api/v1/devices/node/commands", body: MobileDevicePairing.json([
            "op": "report", "commandId": command.id, "leaseId": command.leaseId,
            "eventId": eventId, "status": status]), check: check)
    }
    func prepared(_ command: MobileDeviceCommandWorker.Command, soundId: String, duration: Double,
                  cacheGeneration: String, scope: MobileDevicePairing.Scope, check: () throws -> Void) async throws {
        _ = try await client.request(scope, "/api/v1/devices/node/alert-sounds", body: MobileDevicePairing.json([
            "commandId": command.id, "leaseId": command.leaseId, "cacheGeneration": cacheGeneration,
            "soundId": soundId, "durationSeconds": duration, "format": "caf", "status": "ready"]), check: check)
    }
    private func mediaMetadata(_ command: MobileDeviceCommandWorker.Command, scope: MobileDevicePairing.Scope,
                               check: () throws -> Void) async throws -> [String: Any] {
        try await client.request(scope, "/api/v1/devices/node/media", body: MobileDevicePairing.json([
            "commandId": command.id, "leaseId": command.leaseId]), check: check)
    }
    func authorizeMedia(_ command: MobileDeviceCommandWorker.Command, scope: MobileDevicePairing.Scope,
                        attachmentId: String, versionId: String, check: () throws -> Void) async throws {
        let metadata = try await mediaMetadata(command, scope: scope, check: check)
        guard metadata["attachmentId"] as? String == attachmentId,
              metadata["versionId"] as? String == versionId else { throw MobileDevicePairing.Failure.invalid }
    }
    func download(_ command: MobileDeviceCommandWorker.Command, scope: MobileDevicePairing.Scope,
                  check: @escaping () throws -> Void) async throws -> URL {
        let result = try await mediaMetadata(command, scope: scope, check: check)
        guard let attachment = command.input["attachmentId"] as? String,
              let version = command.input["versionId"] as? String,
              result["attachmentId"] as? String == attachment, result["versionId"] as? String == version,
              let raw = result["url"] as? String, let url = URL(string: raw),
              url.user == nil, url.password == nil, url.fragment == nil,
              let expiry = result["expiresAt"] as? String, let expiresAt = MobileDevicePairing.date(expiry), expiresAt > Date(),
              let size = result["size"] as? NSNumber, CFGetTypeID(size) != CFBooleanGetTypeID(), size.int64Value >= 0,
              size.doubleValue == Double(size.int64Value) else { throw MobileDevicePairing.Failure.invalid }
        let local = ["localhost", "127.0.0.1", "::1"].contains(url.host?.lowercased() ?? "")
        guard url.scheme == "https" || (url.scheme == "http" && local && LopuVoiceContract.sameOrigin(url, scope.origin)) else {
            throw MobileDevicePairing.Failure.destination
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil; configuration.urlCredentialStorage = nil; configuration.httpShouldSetCookies = false
        let session = URLSession(configuration: configuration, delegate: MobileDeviceRedirectPolicy(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        // The private signed storage URL never receives the node bearer or cookies.
        let (bytes, response) = try await session.bytes(for: URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
        try check()
        guard let http = response as? HTTPURLResponse, http.statusCode == 200, http.url == url else { throw MobileDevicePairing.Failure.invalid }
        let root = URL.cachesDirectory.appendingPathComponent("DeviceMedia", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        let file = root.appendingPathComponent(UUID().uuidString)
        guard FileManager.default.createFile(atPath: file.path, contents: nil,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]) else { throw MobileDevicePairing.Failure.storage }
        var complete = false
        defer { if !complete { try? FileManager.default.removeItem(at: file) } }
        let handle = try FileHandle(forWritingTo: file); defer { try? handle.close() }
        var buffer = Data(), count: Int64 = 0
        for try await byte in bytes {
            buffer.append(byte); count += 1
            guard count <= size.int64Value else { throw MobileDevicePairing.Failure.invalid }
            if buffer.count == 64 * 1024 {
                try check(); try Task.checkCancellation()
                try handle.write(contentsOf: buffer); buffer.removeAll(keepingCapacity: true)
            }
        }
        try check(); try Task.checkCancellation()
        if !buffer.isEmpty { try handle.write(contentsOf: buffer) }
        guard count == size.int64Value else { throw MobileDevicePairing.Failure.invalid }
        try handle.synchronize(); complete = true
        return file
    }
}
