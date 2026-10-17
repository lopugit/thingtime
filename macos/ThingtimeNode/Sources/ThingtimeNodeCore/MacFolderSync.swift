import AppleFileSync
import Foundation

/// Local signed-host adapter. It is deliberately separate from remotely leased
/// commands. The desktop host must also verify its active browser account.
@MainActor
public final class MacFolderSync {
    public static let version = "1.3.0"
    public enum SourceSelection { case folder(URL), photos }
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
        let trash: MobileSyncTrash.Request?; let restore: MobileSyncTrash.Restore?; let cursor: String?
    }
    private let origin: URL
    private let store: MobileFolderStore
    private let staging: MobileSyncStaging
    private let trash: MobileSyncTrash?
    private let verify: (String, String) async throws -> Void
    private let choose: () async throws -> URL?
    private let chooseSource: (() async throws -> SourceSelection?)?
    private let photos: PhotoLibraryReader
    private let approve: (MobileFolderStore.Grant) async throws -> Bool
    private let approveTrash: ((MobileFolderStore.Grant) async throws -> Bool)?
    private let approveRestore: ((MobileFolderStore.Grant, MobileSyncTrash.Restore) async throws -> Bool)?
    private let cancelDialog: () -> Void
    private let conditions: () -> Conditions
    private var active: (id: String, owner: String, device: String, task: Task<JSONValue, Error>)?

    public init(origin: URL, store: MobileFolderStore, staging: MobileSyncStaging, trash: MobileSyncTrash? = nil,
                verify: @escaping (String, String) async throws -> Void,
                choose: @escaping () async throws -> URL?, approve: @escaping (MobileFolderStore.Grant) async throws -> Bool,
                chooseSource: (() async throws -> SourceSelection?)? = nil,
                photos: PhotoLibraryReader = PhotoLibraryReader(),
                approveTrash: ((MobileFolderStore.Grant) async throws -> Bool)? = nil,
                approveRestore: ((MobileFolderStore.Grant, MobileSyncTrash.Restore) async throws -> Bool)? = nil,
                cancelDialog: @escaping () -> Void = {},
                conditions: @escaping () -> Conditions = { .init(network: "unknown", charging: nil) }) throws {
        self.origin = try FileSyncOwnerScope(ownerId: "origin-validation", url: origin).origin
        self.store = store; self.staging = staging; self.verify = verify
        self.trash = trash; self.approveTrash = approveTrash; self.approveRestore = approveRestore
        self.chooseSource = chooseSource; self.photos = photos
        self.choose = choose; self.approve = approve; self.cancelDialog = cancelDialog; self.conditions = conditions
    }

    public func suspend() {
        active?.task.cancel(); cancelDialog()
        let photos = photos; Task.detached { photos.discard() }
    }

    public func handle(_ payload: JSONValue, stream: (@Sendable (Data) throws -> Void)? = nil, receive: (@Sendable (Int) throws -> Data)? = nil) async throws -> JSONValue {
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
        guard ["context", "conditions", "list", "choose", "remove", "scan", "read", "read-range", "stage-begin", "stage-append", "stage-range", "stage-finish", "write-approve", "publication-lookup", "publish", "trash", "trash-lookup", "trash-expected", "trash-inspect", "trash-restore", "trash-restore-reviewed", "trash-list"].contains(r.action) else { throw MobileFolderStore.Failure.invalid }
        guard (r.action == "read-range") == (stream != nil), (r.action == "stage-range") == (receive != nil) else { throw MobileFolderStore.Failure.invalid }
        let task = Task { try await self.execute(r, owner: owner, stream: stream, receive: receive) }
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

    private func execute(_ r: Request, owner: FileSyncOwnerScope, stream: (@Sendable (Data) throws -> Void)?, receive: (@Sendable (Int) throws -> Data)?) async throws -> JSONValue {
        try await authorized(r)
        var result: [String: JSONValue] = ["requestId": .string(r.requestId), "ownerId": .string(r.ownerId), "deviceId": .string(r.deviceId), "origin": .string(r.origin)]
        if r.action == "context" {
            var capabilities: [String: JSONValue] = ["fileAccessVersion": .string(Self.version), "fileStagingVersion": .string("1.1.0"), "filePublicationVersion": .string("1.1.0")]
            if trash != nil, approveTrash != nil { capabilities["fileTrashVersion"] = .string(approveRestore == nil ? "1.1.0" : "1.2.0") }
            result["capabilities"] = .object(capabilities)
        } else if r.action == "conditions" {
            result["conditions"] = try value(conditions())
        } else if r.action == "choose" {
            let selection: SourceSelection?
            if let chooseSource { selection = try await chooseSource() }
            else { selection = try await choose().map(SourceSelection.folder) }
            try await authorized(r)
            switch selection {
            case .folder(let url): _ = try store.add(owner, selected: url)
            case .photos:
                guard photos.access() != "unavailable" else { throw PhotoLibraryReader.Failure.unavailable }
                _ = try store.addPhotos(owner)
            case nil: break
            }
        } else if r.action != "list" {
            guard let root = r.rootId, UUID(uuidString: root) != nil else { throw MobileFolderStore.Failure.invalid }
            result["rootId"] = .string(root)
            if r.action == "remove" {
                try store.remove(owner, id: root)
                let photos = photos; try await worker { photos.discard() }
            }
            else {
                let grant = try store.grant(owner, id: root), staging = staging, photos = photos
                let photoScope = owner.key + ":" + root
                guard grant.sourceKind != "photos" || ["scan", "read", "read-range"].contains(r.action) else { throw MobileFolderStore.Failure.invalid }
                if r.action == "trash-list" {
                    guard let trash, approveRestore != nil else { throw MobileFolderStore.Failure.unavailable }
                    result["trashPage"] = try value(await worker { try trash.list(owner: owner, rootId: root, bookmark: grant.bookmark, cursor: r.cursor) })
                } else if r.action == "write-approve" {
                    guard let approval = r.approval, approval.scope.deviceId == r.deviceId else { throw MobileFolderStore.Failure.invalid }
                    try approval.validate(owner: owner)
                    if try !store.isWriteApproved(owner, id: root, approval: approval) {
                        let accepted: Bool
                        if approval.allowTrash == true {
                            guard trash != nil, let approveTrash else { throw MobileFolderStore.Failure.unavailable }
                            accepted = try await approveTrash(grant)
                        } else { accepted = try await approve(grant) }
                        guard accepted else { throw MobileFolderStore.Failure.approvalCancelled }
                        try await authorized(r)
                        try store.approveWrite(owner, grant: grant, approval: approval)
                    }
                    try await worker { try MobileFolderReader.checkAccess(bookmark: grant.bookmark) }
                    result["writeApproval"] = try value(approval)
                } else if ["trash", "trash-lookup", "trash-expected", "trash-inspect", "trash-restore", "trash-restore-reviewed", "trash-list"].contains(r.action) {
                    guard let trash, let request = r.trash, request.rootId == root, (["trash-inspect", "trash-restore-reviewed"].contains(r.action) || request.scope.deviceId == r.deviceId) else { throw MobileFolderStore.Failure.invalid }
                    try request.validate(owner: owner)
                    if r.action == "trash" || r.action == "trash-restore" {
                        guard let approval = r.approval, approval.scope == request.scope,
                              r.action != "trash" || approval.allowTrash == true,
                              try store.isWriteApproved(owner, id: root, approval: approval) else { throw MobileFolderStore.Failure.unavailable }
                    }
                    let action = r.action, restore = r.restore
                    if action == "trash-restore-reviewed" {
                        guard let restore, let approveRestore else { throw MobileFolderStore.Failure.unavailable }
                        let resumed = try await worker { try trash.resumeRestore(request, owner: owner, bookmark: grant.bookmark, restore: restore) }
                        if let resumed { result["restoredEntry"] = try value(resumed) }
                        else {
                            try await worker { try trash.reviewRestore(request, owner: owner, bookmark: grant.bookmark, restore: restore) }
                            guard try await approveRestore(grant, restore) else { throw MobileFolderStore.Failure.approvalCancelled }
                            try await authorized(r)
                            guard try store.grant(owner, id: root).bookmark == grant.bookmark else { throw MobileFolderStore.Failure.unavailable }
                            result["restoredEntry"] = try value(await worker { try trash.restore(request, owner: owner, bookmark: grant.bookmark, restore: restore) })
                        }
                    } else if action == "trash-expected" {
                        result["expectedEntry"] = try value(await worker { try trash.expected(request, owner: owner, bookmark: grant.bookmark) })
                    } else if action == "trash-inspect" {
                        let retained = try await worker { try trash.inspect(request, owner: owner, bookmark: grant.bookmark) }
                        result["retainedEntry"] = try retained.map { try value($0) } ?? .null
                        let intent = try await worker { try trash.restoration(request, owner: owner, bookmark: grant.bookmark) }
                        result["restoreIntent"] = try intent.map { try value($0) } ?? .null
                    } else if action == "trash-restore" {
                        guard let restore else { throw MobileFolderStore.Failure.invalid }
                        result["restoredEntry"] = try value(await worker { try trash.restore(request, owner: owner, bookmark: grant.bookmark, restore: restore) })
                    } else {
                        let lookup = try await worker {
                            if action == "trash" { return MobileSyncTrash.Lookup(status: "complete", receipt: try trash.trash(request, owner: owner, bookmark: grant.bookmark)) }
                            return try trash.lookup(request, owner: owner, bookmark: grant.bookmark)
                        }
                        result["trash"] = try value(lookup)
                    }
                } else if r.action == "scan" {
                    result["entries"] = try value(await worker {
                        if grant.sourceKind == "photos" { return try photos.scan(scope: photoScope) }
                        return try MobileFolderReader.scan(bookmark: grant.bookmark)
                    })
                    result["complete"] = .bool(true)
                } else if r.action == "read-range" {
                    guard let path = r.path, let version = r.version, let offset = r.offset, let length = r.length,
                          let stream else { throw MobileFolderStore.Failure.invalid }
                    let size = try await worker {
                        if grant.sourceKind == "photos" { return try photos.stream(scope: photoScope, path: path, version: version, offset: offset, length: length, receive: stream) }
                        return try MobileFolderReader.stream(bookmark: grant.bookmark, path: path, version: version,
                            offset: offset, length: length, receive: stream)
                    }
                    result["path"] = .string(path)
                    result["chunk"] = .object(["version": .string(version), "size": .number(Double(size)),
                        "offset": .number(Double(offset)), "length": .number(Double(length))])
                } else if r.action == "read" {
                    guard let path = r.path, let version = r.version, let offset = r.offset, let length = r.length else { throw MobileFolderStore.Failure.invalid }
                    result["path"] = .string(path)
                    result["chunk"] = try value(await worker {
                        if grant.sourceKind == "photos" { return try photos.read(scope: photoScope, path: path, version: version, offset: offset, length: length) }
                        return try MobileFolderReader.read(bookmark: grant.bookmark, path: path, version: version, offset: offset, length: length)
                    })
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
                        let action = r.action, offset = r.offset, encoded = r.data, length = r.length
                        let progress = try await worker {
                            try MobileFolderReader.checkAccess(bookmark: grant.bookmark)
                            let progress: MobileSyncStaging.Progress
                            switch action {
                            case "stage-begin": progress = try staging.begin(transfer, owner: owner)
                            case "stage-finish": progress = try staging.finish(transfer, owner: owner)
                            case "stage-range":
                                guard let offset, let length, let receive else { throw MobileFolderStore.Failure.invalid }
                                progress = try staging.appendStream(transfer, owner: owner, offset: offset, length: length, read: receive)
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
        result["roots"] = .array(try store.list(owner).map { grant in
            var row: [String: JSONValue] = ["id": .string(grant.id), "name": .string(grant.name)]
            if grant.sourceKind == "photos" {
                row["sourceKind"] = .string("photos"); row["photoAccess"] = .string(photos.access())
            } else { row["publicationVersion"] = .string("1.0.0") }
            return .object(row)
        })
        let response = JSONValue.object(result)
        // Never send a partial inventory or exceed the existing XPC frame budget.
        guard try JSONEncoder().encode(response).count <= 900_000 else { throw MobileFolderStore.Failure.limit }
        return response
    }
}
