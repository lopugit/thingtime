import AppleFileSync
import CryptoKit
import Foundation

/// The shared v1 length-prefixed descriptor. This digest binds observations;
/// it grants no authorization and never replaces either fresh identity check.
struct MacUploadBatchDescriptor: Sendable {
    struct Member: Sendable { let ordinal: Int; let operationId: String; let source: MobileFolderReader.Entry }
    let raw: JSONValue, digest: String, batchId: String, origin: String, ownerId: String, deviceId: String
    let connectionId: String, localRootId: String, network: String, chargingOnly: Bool
    let members: [Member]
    let canonicalBytes: Data

    init(_ batch: JSONValue) throws {
        let b = try BatchJSON.object(batch, keys: ["descriptor", "digest"])
        raw = try BatchJSON.required(b, "descriptor"); digest = try BatchJSON.string(b, "digest")
        let d = try BatchJSON.object(raw, keys: ["version", "batchId", "scope", "configuration", "members"])
        guard d["version"] == .number(1), try JSONEncoder().encode(raw).count <= 327_680 else { throw MobileFolderStore.Failure.invalid }
        batchId = try BatchJSON.string(d, "batchId"); guard UUID(uuidString: batchId) != nil else { throw MobileFolderStore.Failure.invalid }
        let scope = try BatchJSON.object(BatchJSON.required(d, "scope"), keys: ["origin", "ownerId", "dataPlane", "rootId", "deviceId"])
        origin = try BatchJSON.string(scope, "origin"); ownerId = try BatchJSON.string(scope, "ownerId")
        deviceId = try BatchJSON.string(scope, "deviceId"); connectionId = try BatchJSON.string(scope, "rootId")
        guard scope["dataPlane"] == .string("home") else { throw MobileFolderStore.Failure.invalid }
        let saved = try BatchJSON.object(BatchJSON.required(d, "configuration"), keys: ["id", "updatedAt", "configuration"])
        let c = try BatchJSON.object(BatchJSON.required(saved, "configuration"), keys: ["configurationVersion", "name", "deviceId", "localRootId", "sourceKind", "remoteFolderId", "mode", "paused", "propagateDeletes", "network", "chargingOnly", "excludedPaths", "ignoreRules"])
        localRootId = try BatchJSON.string(c, "localRootId"); network = try BatchJSON.string(c, "network"); chargingOnly = try BatchJSON.bool(c, "chargingOnly")
        let remote = try BatchJSON.string(c, "remoteFolderId"), mode = try BatchJSON.string(c, "mode")
        let updated = try BatchJSON.string(saved, "updatedAt"), savedId = try BatchJSON.string(saved, "id")
        guard savedId == connectionId, try BatchJSON.string(c, "deviceId") == deviceId,
              [JSONValue.number(1), .number(2)].contains(c["configurationVersion"] ?? .null), c["paused"] == .bool(false), c["propagateDeletes"] == .bool(false),
              ["backup", "upload"].contains(mode), c["sourceKind"] == nil || c["sourceKind"] == .string("folder"),
              ["any", "wifi", "unmetered"].contains(network), !updated.isEmpty else { throw MobileFolderStore.Failure.invalid }
        let excluded = try BatchJSON.array(BatchJSON.required(c, "excludedPaths")).map { try BatchJSON.text($0) }
        let exclusions = try MobileFolderReader.canonicalExclusions(excluded)
        let ignoreText = (try c["ignoreRules"].map { try BatchJSON.text($0) } ?? "").replacingOccurrences(of: "\r\n", with: "\n")
        guard ignoreText.isEmpty || c["configurationVersion"] == .number(2) else { throw MobileFolderStore.Failure.invalid }
        let ignore = try MobileFolderIgnoreRules(ignoreText)
        let rows = try BatchJSON.array(BatchJSON.required(d, "members"))
        guard !rows.isEmpty, rows.count <= 256 else { throw MobileFolderStore.Failure.limit }
        var fields = ["thingtime-upload-batch-v1", batchId, origin, ownerId, "home", connectionId, deviceId, savedId, updated,
                      ignoreText.isEmpty ? "1" : "2", try BatchJSON.string(c, "name").trimmingCharacters(in: .whitespacesAndNewlines), deviceId, localRootId, "folder", remote, mode, "0", "0", network, chargingOnly ? "1" : "0",
                      String(excluded.count)] + excluded + [ignoreText, String(rows.count)]
        var parsed: [Member] = [], operations = Set<String>(), destinations = Set<String>()
        for (index, row) in rows.enumerated() {
            let member = try BatchJSON.object(row, keys: ["ordinal", "write"])
            guard member["ordinal"] == .number(Double(index)) else { throw MobileFolderStore.Failure.invalid }
            let write = try BatchJSON.object(BatchJSON.required(member, "write"), keys: ["operation", "scope", "folderId", "before", "cloudRootId"])
            guard write["scope"] == .object(scope), write["before"] == .null, try BatchJSON.string(write, "cloudRootId") == remote else { throw MobileFolderStore.Failure.invalid }
            let folder = try BatchJSON.string(write, "folderId")
            let operation = try BatchJSON.object(BatchJSON.required(write, "operation"), keys: ["id", "mutation", "confirmed"])
            let operationId = try BatchJSON.string(operation, "id")
            guard UUID(uuidString: operationId) != nil, operation["confirmed"] == .bool(false), operations.insert(operationId).inserted else { throw MobileFolderStore.Failure.invalid }
            let mutation = try BatchJSON.object(BatchJSON.required(operation, "mutation"), keys: ["kind", "path", "from", "source", "expectedTarget"])
            guard mutation["kind"] == .string("copy"), mutation["from"] == .string("local"), mutation["expectedTarget"] == .null else { throw MobileFolderStore.Failure.invalid }
            let sourceValue = try BatchJSON.required(mutation, "source")
            let sourceObject = try BatchJSON.object(sourceValue, keys: ["path", "id", "version", "kind", "size", "sha256", "fingerprint"])
            _ = try BatchJSON.object(BatchJSON.required(sourceObject, "fingerprint"), keys: ["algorithm", "partSizeBytes", "partCount", "sha256"])
            let source = try JSONDecoder().decode(MobileFolderReader.Entry.self, from: JSONEncoder().encode(sourceValue))
            let key = source.path.precomposedStringWithCanonicalMapping.lowercased()
            guard mutation["path"] == .string(source.path), sourceObject["sha256"] == .null,
                  !exclusions.contains(where: { key == $0 || key.hasPrefix($0 + "/") }), !ignore.ignores(source.path, isDirectory: false),
                  destinations.insert(folder + "\u{0}" + key.split(separator: "/").last!).inserted else { throw MobileFolderStore.Failure.invalid }
            guard let f = source.fingerprint else { throw MobileFolderStore.Failure.invalid }
            fields += [String(index), operationId, remote, folder, source.path, source.id, source.version, String(source.size), source.sha256 ?? "", f.algorithm, String(f.partSizeBytes), String(f.partCount), f.sha256]
            parsed.append(Member(ordinal: index, operationId: operationId, source: source))
        }
        try MobileFolderBulkReader.validate(parsed.map(\.source)); members = parsed
        canonicalBytes = Data(fields.map { "\($0.utf8.count):\($0)" }.joined().utf8)
        guard SHA256.hash(data: canonicalBytes).map({ String(format: "%02x", $0) }).joined() == digest else { throw MobileFolderStore.Failure.invalid }
    }
}

enum BatchJSON {
    static func required(_ o: [String: JSONValue], _ k: String) throws -> JSONValue { guard let v = o[k] else { throw MobileFolderStore.Failure.invalid }; return v }
    static func object(_ v: JSONValue, keys: Set<String>) throws -> [String: JSONValue] { guard case .object(let o) = v, Set(o.keys).isSubset(of: keys) else { throw MobileFolderStore.Failure.invalid }; return o }
    static func array(_ v: JSONValue) throws -> [JSONValue] { guard case .array(let a) = v else { throw MobileFolderStore.Failure.invalid }; return a }
    static func text(_ v: JSONValue) throws -> String { guard case .string(let s) = v else { throw MobileFolderStore.Failure.invalid }; return s }
    static func string(_ o: [String: JSONValue], _ k: String) throws -> String { let s = try text(required(o, k)); guard !s.isEmpty, s.utf8.count <= 16_384 else { throw MobileFolderStore.Failure.invalid }; return s }
    static func bool(_ o: [String: JSONValue], _ k: String) throws -> Bool { guard case .bool(let b) = try required(o, k) else { throw MobileFolderStore.Failure.invalid }; return b }
}
