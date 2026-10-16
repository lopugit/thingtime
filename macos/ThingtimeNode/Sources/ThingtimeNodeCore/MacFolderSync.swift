import AppleFileSync
import Foundation

/// Local signed-host adapter. It is deliberately separate from remotely leased
/// commands. The desktop host must also verify its active browser account.
@MainActor
public final class MacFolderSync {
    public static let version = "1.1.0"
    public struct Conditions: Codable, Sendable {
        public let network: String
        public let charging: Bool?
        public init(network: String, charging: Bool?) { self.network = network; self.charging = charging }
        private enum CodingKeys: String, CodingKey { case network, charging }
        public func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(network, forKey: .network)
            try container.encode(charging, forKey: .charging)
        }
    }
    private struct Request: Decodable {
        let requestId: String; let ownerId: String; let deviceId: String; let origin: String; let action: String
        let rootId: String?; let path: String?; let version: String?; let offset: Int64?; let length: Int?; let data: String?
        let transfer: MobileSyncStaging.Request?; let stage: MobileSyncStaging.Stage?; let approval: MobileFolderStore.WriteApproval?
    }
    private let origin: URL
    private let store: MobileFolderStore
    private let staging: MobileSyncStaging
    private let verify: (String, String) async throws -> Void
    private let choose: () async throws -> URL?
    private let approve: (MobileFolderStore.Grant) async throws -> Bool
    private let cancelDialog: () -> Void
    private let conditions: () -> Conditions
    private var active: (id: String, owner: String, device: String, task: Task<JSONValue, Error>)?

    public init(origin: URL, store: MobileFolderStore, staging: MobileSyncStaging,
                verify: @escaping (String, String) async throws -> Void,
                choose: @escaping () async throws -> URL?, approve: @escaping (MobileFolderStore.Grant) async throws -> Bool,
                cancelDialog: @escaping () -> Void = {},
                conditions: @escaping () -> Conditions = { .init(network: "unknown", charging: nil) }) throws {
        self.origin = try FileSyncOwnerScope(ownerId: "origin-validation", url: origin).origin
        self.store = store; self.staging = staging; self.verify = verify
        self.choose = choose; self.approve = approve; self.cancelDialog = cancelDialog; self.conditions = conditions
    }

    public func suspend() { active?.task.cancel(); cancelDialog() }

    public func handle(_ payload: JSONValue) async throws -> JSONValue {
        let encoded = try JSONEncoder().encode(payload)
        guard encoded.count <= 131_072 else { throw MobileFolderStore.Failure.limit }
        let r = try JSONDecoder().decode(Request.self, from: encoded)
        guard UUID(uuidString: r.requestId) != nil, !r.deviceId.isEmpty, r.deviceId.utf8.count <= 512,
              r.origin == origin.absoluteString else { throw MobileFolderStore.Failure.invalid }
        let owner = try FileSyncOwnerScope(ownerId: r.ownerId, url: origin)
        if r.action == "suspend" {
            if let active, active.id == r.requestId, active.owner == r.ownerId, active.device == r.deviceId { suspend() }
            return .object([:])
        }
        guard active == nil else { throw ThingtimeNodeError.invalidRequest("Another folder request is running.") }
        guard ["context", "conditions", "list", "choose", "remove", "scan", "read", "stage-begin", "stage-append", "stage-finish", "write-approve", "publication-lookup", "publish"].contains(r.action) else { throw MobileFolderStore.Failure.invalid }
        let task = Task { try await self.execute(r, owner: owner) }
        active = (r.requestId, r.ownerId, r.deviceId, task)
        let timeout = Task {
            try await Task.sleep(for: .seconds(270))
            if active?.id == r.requestId { suspend() }
        }
        defer { timeout.cancel(); if active?.id == r.requestId { active = nil } }
        return try await withTaskCancellationHandler(operation: { try await task.value }, onCancel: {
            task.cancel()
            Task { @MainActor [weak self] in
                if self?.active?.id == r.requestId { self?.suspend() }
            }
        })
    }

    private func authorized(_ r: Request) async throws {
        try Task.checkCancellation(); try await verify(r.ownerId, r.deviceId); try Task.checkCancellation()
    }
    private func worker<T: Sendable>(_ work: @escaping @Sendable () throws -> T) async throws -> T {
        let task = Task.detached { try Task.checkCancellation(); return try work() }
        return try await withTaskCancellationHandler(operation: { try await task.value }, onCancel: { task.cancel() })
    }
    private func value<T: Encodable>(_ input: T) throws -> JSONValue { try JSONValue.from(input) }

    private func execute(_ r: Request, owner: FileSyncOwnerScope) async throws -> JSONValue {
        try await authorized(r)
        var result: [String: JSONValue] = ["requestId": .string(r.requestId), "ownerId": .string(r.ownerId), "deviceId": .string(r.deviceId), "origin": .string(r.origin)]
        if r.action == "context" {
            result["capabilities"] = .object(["fileAccessVersion": .string("1.1.0"), "fileStagingVersion": .string("1.0.0"), "filePublicationVersion": .string("1.1.0")])
        } else if r.action == "conditions" {
            result["conditions"] = try value(conditions())
        } else if r.action == "choose" {
            if let url = try await choose() {
                try await authorized(r)
                _ = try store.add(owner, selected: url)
            }
        } else if r.action != "list" {
            guard let root = r.rootId, UUID(uuidString: root) != nil else { throw MobileFolderStore.Failure.invalid }
            result["rootId"] = .string(root)
            if r.action == "remove" { try store.remove(owner, id: root) }
            else {
                let grant = try store.grant(owner, id: root), staging = staging
                if r.action == "write-approve" {
                    guard let approval = r.approval, approval.scope.deviceId == r.deviceId else { throw MobileFolderStore.Failure.invalid }
                    try approval.validate(owner: owner)
                    if try !store.isWriteApproved(owner, id: root, approval: approval) {
                        guard try await approve(grant) else { throw MobileFolderStore.Failure.approvalCancelled }
                        try await authorized(r)
                        try store.approveWrite(owner, grant: grant, approval: approval)
                    }
                    try await worker { try MobileFolderReader.checkAccess(bookmark: grant.bookmark) }
                    result["writeApproval"] = try value(approval)
                } else if r.action == "scan" {
                    result["entries"] = try value(await worker { try MobileFolderReader.scan(bookmark: grant.bookmark) })
                    result["complete"] = .bool(true)
                } else if r.action == "read" {
                    guard let path = r.path, let version = r.version, let offset = r.offset, let length = r.length else { throw MobileFolderStore.Failure.invalid }
                    result["path"] = .string(path)
                    result["chunk"] = try value(await worker { try MobileFolderReader.read(bookmark: grant.bookmark, path: path, version: version, offset: offset, length: length) })
                } else {
                    guard let transfer = r.transfer, transfer.rootId == root, transfer.scope.deviceId == r.deviceId else { throw MobileFolderStore.Failure.invalid }
                    try transfer.validate(owner: owner)
                    if r.action == "publish" || r.action == "publication-lookup" {
                        var stage: MobileSyncStaging.Stage?
                        if r.action == "publish" {
                            guard let approval = r.approval, approval.scope == transfer.scope, let suppliedStage = r.stage,
                                  try store.isWriteApproved(owner, id: root, approval: approval) else { throw MobileFolderStore.Failure.unavailable }
                            stage = suppliedStage
                        }
                        let publicationStage = stage
                        let receipt = try await worker {
                            try MobileFolderReader.checkAccess(bookmark: grant.bookmark)
                            if let publicationStage {
                                return MobileSyncStaging.Lookup(status: "complete", receipt: try staging.publish(transfer, owner: owner, bookmark: grant.bookmark, stage: publicationStage))
                            }
                            return try staging.lookup(transfer, owner: owner, bookmark: grant.bookmark)
                        }
                        result["publication"] = try value(receipt)
                    } else {
                        let action = r.action, offset = r.offset, encoded = r.data
                        let progress = try await worker {
                            try MobileFolderReader.checkAccess(bookmark: grant.bookmark)
                            let progress: MobileSyncStaging.Progress
                            switch action {
                            case "stage-begin": progress = try staging.begin(transfer, owner: owner)
                            case "stage-finish": progress = try staging.finish(transfer, owner: owner)
                            case "stage-append":
                                guard let offset, offset >= 0, let encoded, encoded.utf8.count <= 87_384,
                                      let bytes = Data(base64Encoded: encoded), !bytes.isEmpty, bytes.count <= 65_536 else { throw MobileFolderStore.Failure.invalid }
                                progress = try staging.append(transfer, owner: owner, offset: offset, bytes: bytes)
                            default: throw MobileFolderStore.Failure.invalid
                            }
                            try MobileFolderReader.checkAccess(bookmark: grant.bookmark)
                            return progress
                        }
                        result["staging"] = try value(progress)
                    }
                }
            }
        }
        try await authorized(r)
        result["roots"] = .array(try store.list(owner).map { .object(["id": .string($0.id), "name": .string($0.name), "publicationVersion": .string("1.0.0")]) })
        let response = JSONValue.object(result)
        // Never send a partial inventory or exceed the existing XPC frame budget.
        guard try JSONEncoder().encode(response).count <= 900_000 else { throw MobileFolderStore.Failure.limit }
        return response
    }
}
