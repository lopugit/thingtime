import AppleFileSync
import Foundation

/// Compound byte transport only. Never owns a sync reservation or publishes a file.
/// Eligibility follows the existing bounded reader; larger sources use multipart.
enum MacSingleUploadOperation {
    struct Request: Decodable, Sendable {
        let source: MobileFolderReader.Entry
        let uploadId: String; let requestId: String
        let authorization: JSONValue
        func policy(owner: FileSyncOwnerScope, root: String, device: String, limits: SyncResourceLimits?) throws -> (String, Bool) {
            try MobileFolderBulkReader.validate([source])
            guard !uploadId.isEmpty, !requestId.isEmpty else { throw MobileFolderStore.Failure.invalid }
            let a = try BatchJSON.object(authorization, keys: ["id", "updatedAt", "scope", "configuration"])
            let s = try BatchJSON.object(BatchJSON.required(a, "scope"), keys: ["origin", "ownerId", "rootId", "deviceId", "dataPlane"])
            let c = try BatchJSON.object(BatchJSON.required(a, "configuration"), keys: ["configurationVersion", "name", "deviceId", "localRootId", "remoteFolderId", "sourceKind", "mode", "paused", "propagateDeletes", "network", "chargingOnly", "excludedPaths", "ignoreRules", "resourceLimits"])
            guard s["ownerId"] == .string(owner.ownerId), s["origin"] == .string(owner.origin.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))),
                  s["deviceId"] == .string(device), s["dataPlane"] == .string("home"), s["rootId"] == a["id"],
                  c["localRootId"] == .string(root), c["deviceId"] == .string(device), c["paused"] == .bool(false),
                  [JSONValue.string("backup"), .string("upload"), .string("two-way")].contains(c["mode"] ?? .null),
                  c["sourceKind"] == nil || c["sourceKind"] == .string("folder") else { throw MobileFolderStore.Failure.changed }
            let policy = try c["resourceLimits"].map { try JSONDecoder().decode(SyncResourceLimits.self, from: JSONEncoder().encode($0)) }
            guard policy == limits else { throw MobileFolderStore.Failure.changed }
            let exclusions = try MobileFolderReader.canonicalExclusions(BatchJSON.array(BatchJSON.required(c, "excludedPaths")).map { try BatchJSON.text($0) })
            let key = source.path.precomposedStringWithCanonicalMapping.lowercased()
            let ignore = try MobileFolderIgnoreRules(c["ignoreRules"].map { try BatchJSON.text($0) } ?? "")
            guard !exclusions.contains(where: { key == $0 || key.hasPrefix($0 + "/") }), !ignore.ignores(source.path, isDirectory: false) else { throw MobileFolderStore.Failure.changed }
            let network = try BatchJSON.string(c, "network")
            guard ["any", "wifi"].contains(network) else { throw MobileFolderStore.Failure.invalid }
            return (network, try BatchJSON.bool(c, "chargingOnly"))
        }
    }
    static func run(_ request: Request, check: @escaping @Sendable () async throws -> Void,
                    read: @escaping @Sendable (String?) async throws -> MobileFolderBulkReader.Payload,
                    callback: @escaping MacUploadBatchOperation.Callback) async throws -> JSONValue {
        func call(_ frame: JSONValue, timeout: TimeInterval = 60) async throws -> JSONValue {
            try await check()
            let payload = Task { try await callback(frame, timeout) }
            let monitor = Task {
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .seconds(1)); try await check() }
                    catch { payload.cancel(); return }
                }
            }
            defer { monitor.cancel() }
            let value = try await withTaskCancellationHandler(operation: { try await payload.value }, onCancel: { payload.cancel() })
            try await check(); return value
        }
        func verifyContent(_ value: JSONValue) throws -> JSONValue {
            let c = try BatchJSON.object(value, keys: ["attachmentId", "version", "size", "fingerprint"])
            guard c["attachmentId"] == .string(request.uploadId), c["size"] == .number(Double(request.source.size)),
                  try BatchJSON.string(c, "version").range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
                  try JSONDecoder().decode(MobileFolderReader.Fingerprint.self, from: JSONEncoder().encode(BatchJSON.required(c, "fingerprint"))) == request.source.fingerprint else { throw MobileFolderStore.Failure.changed }
            return value
        }
        try await check()
        let payload = try await read(nil), sha = payload.sha256
        let prepared = try BatchJSON.object(await call(.object(["kind": .string("prepare-ready"), "checksums": .array([.object(["ordinal": .number(0), "sha256": .string(sha)])])])), keys: ["ready", "content"])
        let content: JSONValue
        if prepared["ready"] == .bool(true) {
            content = try verifyContent(BatchJSON.required(prepared, "content"))
        } else {
            guard prepared["ready"] == .bool(false), prepared["content"] == nil else { throw MobileFolderStore.Failure.invalid }
            for offset in stride(from: 0, to: payload.bytes.count, by: 65_536) {
                let end = min(offset + 65_536, payload.bytes.count)
                let ack = try await call(.object(["kind": .string("chunk"), "ordinal": .number(0), "offset": .number(Double(offset)), "data": .string(payload.bytes.subdata(in: offset..<end).base64EncodedString())]), timeout: 5)
                guard ack == .object(["accepted": .bool(true)]) else { throw MobileFolderStore.Failure.invalid }
            }
            // Reopen strongly after emission, after PUT, and after stored proof.
            _ = try await read(sha)
            let ack = try BatchJSON.object(await call(.object(["kind": .string("put-ready"), "ordinal": .number(0), "sha256": .string(sha)]), timeout: .infinity), keys: ["status", "payloadBytes"])
            guard ack["status"] == .string("unknown") || (ack["status"] == .string("accepted") && ack["payloadBytes"] == .number(Double(request.source.size))) else { throw MobileFolderStore.Failure.invalid }
            _ = try await read(sha)
            let verified = try BatchJSON.object(await call(.object(["kind": .string("verify-ready")])), keys: ["content"])
            content = try verifyContent(BatchJSON.required(verified, "content"))
        }
        _ = try await read(sha); try await check()
        return content
    }
}
