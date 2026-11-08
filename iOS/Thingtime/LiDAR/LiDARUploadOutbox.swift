import AppleFileSync
import Foundation

@MainActor
protocol LiDARUploadTransport {
    var scope: FileSyncOwnerScope { get }
    func verifyOwner() async throws
    func require(_ requirements: [(String, [Int])]) async throws
    func json(_ path: String, body: [String: Any]?, statuses: Set<Int>) async throws -> [String: Any]
    func uploadPart(_ part: any FileUploadPartSource, uploadId: String, partNumber: Int, allowsCellular: Bool) async throws
}

extension NativeFileSession: LiDARUploadTransport {}

/// One private Files operation per native capture. Store the account and origin
/// before opening the scanner, then the verified upload version before committing.
/// Only the original scope can retry or read a saved receipt.
@MainActor
final class LiDARUploadOutbox {
    struct Receipt: Codable, Equatable, Sendable {
        let fileThingId: String
        let revision: String
    }

    struct Entry: Codable {
        fileprivate let version: Int
        let id: UUID
        let scope: FileSyncOwnerScope
        fileprivate let createdAt: Date
        fileprivate(set) var capture: LiDARCapture?
        fileprivate var fingerprint: MobileFolderReader.Fingerprint?
        fileprivate var uploadId: String?
        fileprivate var staged: FileVersionExport.Content?
        fileprivate(set) var receipt: Receipt?
        fileprivate var discardedAt: Date?
        fileprivate var archiveRelocated = false

        private enum CodingKeys: String, CodingKey {
            case version, id, scope, createdAt, capture, fingerprint, uploadId, staged, receipt, discardedAt
        }

        fileprivate var operationId: String { id.uuidString.lowercased() }
        fileprivate var filename: String { "LiDAR Scan \(operationId).tar" }
    }

    enum Failure: Error, LocalizedError {
        case wrongScope, invalidCaptureID, archiveChanged, missingCapture, discarded, busy, unexpectedReceipt, savePending, approvalRequired

        var errorDescription: String? {
            switch self {
            case .wrongScope: return "Reopen Things in the account and destination that started this scan."
            case .invalidCaptureID: return "The scanner could not reserve a valid file identity."
            case .archiveChanged: return "The saved scan archive could not be verified."
            case .missingCapture: return "There is no completed archive for this scan yet."
            case .discarded: return "This scan was discarded."
            case .busy: return "This scan is already saving to Things."
            case .unexpectedReceipt: return "Things returned a different file receipt. The scan is still saved on this iPhone."
            case .savePending: return "Things could not save the scan yet. The archive is still on this iPhone."
            case .approvalRequired: return "This account needs private upload approval to save the scan to Things."
            }
        }
    }

    static let requirements: [(String, [Int])] = [
        ("api.auth-me", [1, 1, 0]),
        ("api.files", [1, 0, 0]),
        ("api.attachment-uploads", [1, 9, 0]),
        ("api.attachment-upload-parts", [1, 1, 0]),
        ("api.attachment-upload-complete", [1, 4, 0]),
        ("api.attachment-content", [1, 13, 0])
    ]
    private static var active: Set<URL> = []
    private let directory: URL
    private let archiveDirectory: URL

    init(directory: URL? = nil, archiveDirectory: URL? = nil) {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Thingtime", isDirectory: true)
        self.directory = directory ?? root.appendingPathComponent("LiDARUploadOutbox", isDirectory: true)
        self.archiveDirectory = archiveDirectory ?? root.appendingPathComponent("LiDAR", isDirectory: true)
    }

    @discardableResult
    func reserve(id: UUID = UUID(), scope: FileSyncOwnerScope) throws -> UUID {
        let operationId = id.uuidString.lowercased()
        guard operationId.range(of: "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$",
                                options: .regularExpression) != nil else { throw Failure.invalidCaptureID }
        if let existing = try read(id) {
            guard existing.scope == scope else { throw Failure.wrongScope }
            try checkDiscard(existing)
            return existing.id
        }
        try write(Entry(version: 1, id: id, scope: scope, createdAt: Date()))
        return id
    }

    func record(_ capture: LiDARCapture, scope: FileSyncOwnerScope) throws {
        var entry = try owned(capture.id, scope: scope)
        try checkDiscard(entry)
        try validate(capture, id: entry.id)
        if let existing = entry.capture {
            guard existing == capture else { throw Failure.archiveChanged }
            return
        }
        entry.capture = capture
        try write(entry)
    }

    /// Keep the original ID retired even if removing its archive fails.
    func discard(id: UUID, scope: FileSyncOwnerScope) throws {
        var entry = try owned(id, scope: scope)
        if entry.discardedAt != nil { return }
        guard entry.uploadId == nil, !Self.active.contains(location(id)) else { throw Failure.busy }
        entry.discardedAt = Date()
        try write(entry)
    }

    /// Call only for a reservation that is no longer being recorded.
    @discardableResult
    func recover(id: UUID, scope: FileSyncOwnerScope) async throws -> LiDARCapture? {
        let entry = try owned(id, scope: scope)
        if try isDiscarded(entry) { return nil }
        if let capture = entry.capture { return capture }
        guard let capture = try await LiDARUploadArchive.recover(id: id, directory: archiveFolder(id)) else { return nil }
        try Task.checkCancellation()
        let current = try owned(id, scope: scope)
        if try isDiscarded(current) { return nil }
        if let recorded = current.capture { return recorded }
        try record(capture, scope: scope)
        return capture
    }

    func entry(id: UUID, scope: FileSyncOwnerScope) throws -> Entry {
        let entry = try owned(id, scope: scope)
        try checkDiscard(entry)
        return entry
    }

    func entries(scope: FileSyncOwnerScope) throws -> [Entry] {
        let urls: [URL]
        do { urls = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) }
        catch let error as CocoaError where error.code == .fileReadNoSuchFile || error.code == .fileNoSuchFile { return [] }
        return urls.compactMap { url in
            guard url.pathExtension == "json", let id = UUID(uuidString: url.deletingPathExtension().lastPathComponent),
                  let entry = try? read(id), entry.scope == scope, (try? isDiscarded(entry)) == false else { return nil }
            return entry
        }.sorted { $0.createdAt < $1.createdAt }
    }

    func upload(id: UUID, scope: FileSyncOwnerScope, session: any LiDARUploadTransport,
                check: () throws -> Void = {}, progress: (Int64, Int64) -> Void = { _, _ in }) async throws -> Receipt {
        var entry = try owned(id, scope: scope)
        guard session.scope == scope else { throw Failure.wrongScope }
        try checkDiscard(entry)
        guard let capture = entry.capture else { throw Failure.missingCapture }
        let key = location(id)
        guard Self.active.insert(key).inserted else { throw Failure.busy }
        defer { Self.active.remove(key) }

        func checkActive() throws {
            try Task.checkCancellation()
            try check()
            try checkDiscard(entry)
        }
        try checkActive()
        try await session.require(Self.requirements)
        try checkActive()
        try await session.verifyOwner()
        try checkActive()
        if let receipt = entry.receipt { return receipt }

        func json(_ path: String, _ body: [String: Any]? = nil, statuses: Set<Int> = [200]) async throws -> [String: Any] {
            try checkActive()
            let result = try await session.json(path, body: body, statuses: statuses)
            try checkActive()
            guard result["ok"] as? Bool == true else {
                if result["code"] as? String == "private_uploads_not_approved" { throw Failure.approvalRequired }
                throw Failure.savePending
            }
            return result
        }

        let files = "/api/v1/files"
        let uploads = "/api/v1/attachments/uploads"
        let lookup = files + "?id=\(entry.operationId)&operationId=\(entry.operationId)"
        let previous = try await json(lookup)
        let replay: NativeCloudFile?
        if previous["receipt"] is NSNull {
            replay = nil
        } else {
            guard let raw = previous["receipt"] as? [String: Any] else { throw Failure.unexpectedReceipt }
            replay = try Self.file(raw, for: entry)
        }

        if entry.staged == nil {
            if entry.archiveRelocated { try await LiDARUploadArchive.verifyRelocated(capture); try checkActive() }
            let archive = try await LiDARUploadArchive.inspect(capture)
            try checkActive()
            if let recorded = entry.fingerprint, recorded != archive.fingerprint { throw Failure.archiveChanged }
            entry.fingerprint = archive.fingerprint
            try write(entry)

            let start = try await json(uploads, ["requestId": entry.operationId, "filename": entry.filename,
                "contentType": "application/x-tar", "sizeBytes": capture.byteCount, "purpose": "file"], statuses: [200, 403, 409])
            guard let plan = start["upload"] as? [String: Any], let uploadId = plan["id"] as? String,
                  Self.identifier(uploadId), entry.uploadId == nil || entry.uploadId == uploadId,
                  plan["partSizeBytes"] as? Int64 == archive.fingerprint.partSizeBytes,
                  plan["partCount"] as? Int == archive.fingerprint.partCount else { throw Failure.unexpectedReceipt }
            entry.uploadId = uploadId
            try write(entry)

            if plan["state"] as? String != "ready" {
                for number in 1...archive.fingerprint.partCount {
                    let part = try await archive.part(number, capture: capture)
                    defer { part.discard() }
                    try checkActive()
                    try await session.uploadPart(part, uploadId: uploadId, partNumber: number, allowsCellular: true)
                    try checkActive()
                    progress(Int64(number - 1) * archive.fingerprint.partSizeBytes + part.length, capture.byteCount)
                }
                _ = try await json(uploads + "/complete", ["uploadId": uploadId])
            }

            let verified = try await json("/api/v1/attachments/content?id=\(uploadId)&fingerprint=1")
            guard verified["id"] as? String == uploadId else { throw Failure.unexpectedReceipt }
            var content = verified
            content["attachmentId"] = uploadId
            let staged = try Self.decode(FileVersionExport.Content.self, content)
            try FileVersionExport.Request(name: entry.filename, content: staged).validate()
            guard staged.size == capture.byteCount, staged.fingerprint == archive.fingerprint else { throw Failure.unexpectedReceipt }
            entry.staged = staged
            try write(entry)
        }

        guard let staged = entry.staged else { throw Failure.unexpectedReceipt }
        progress(capture.byteCount, capture.byteCount)
        // Fresh owner check immediately before the only operation that publishes
        // a File Thing. The server also verifies the pinned actor and Home plane.
        try await session.verifyOwner()
        let result = try await json(files, ["id": entry.operationId, "operationId": entry.operationId,
            "expectedRevision": NSNull(), "name": entry.filename, "folderId": NSNull(), "trashed": false,
            "attachmentId": staged.attachmentId, "contentVersion": staged.version])
        let committed = try Self.file(result, for: entry)
        if let replay {
            guard result["replayed"] as? Bool == true, replay == committed else { throw Failure.unexpectedReceipt }
        } else {
            let confirmed = try await json(lookup)
            guard let raw = confirmed["receipt"] as? [String: Any], try Self.file(raw, for: entry) == committed else {
                throw Failure.unexpectedReceipt
            }
        }
        try checkActive()
        let receipt = Receipt(fileThingId: committed.id, revision: committed.revision)
        entry.receipt = receipt
        try write(entry)
        return receipt
    }

    private func owned(_ id: UUID, scope: FileSyncOwnerScope) throws -> Entry {
        guard let entry = try read(id), entry.scope == scope else { throw Failure.wrongScope }
        return entry
    }

    private func isDiscarded(_ entry: Entry) throws -> Bool {
        if entry.discardedAt != nil { return true }
        return try LiDARCaptureStore.isDiscarded(id: entry.id, directory: archiveFolder(entry.id))
    }

    private func checkDiscard(_ entry: Entry) throws {
        if try isDiscarded(entry) { throw Failure.discarded }
    }

    private func location(_ id: UUID) -> URL {
        directory.appendingPathComponent(id.uuidString.lowercased() + ".json")
    }

    private func read(_ id: UUID) throws -> Entry? {
        let url = location(id)
        let data: Data
        do { data = try Data(contentsOf: url) }
        catch let error as CocoaError where error.code == .fileReadNoSuchFile { return nil }
        var entry = try JSONDecoder().decode(Entry.self, from: data)
        guard entry.id == id, entry.version == 1,
              try FileSyncOwnerScope(ownerId: entry.scope.ownerId, url: entry.scope.origin) == entry.scope else { throw Failure.wrongScope }
        if let capture = entry.capture {
            // iOS may move Application Support when it installs an update.
            // Derive the actual source path exclusively from the reserved ID.
            let current = LiDARCapture(id: capture.id, archiveURL: archiveFolder(id).appendingPathComponent("scan.tar"),
                startedAt: capture.startedAt, finishedAt: capture.finishedAt, frameCount: capture.frameCount,
                byteCount: capture.byteCount, isPartial: capture.isPartial, statusDetail: capture.statusDetail)
            try validate(current, id: id)
            entry.archiveRelocated = current.archiveURL.standardizedFileURL != capture.archiveURL.standardizedFileURL
            entry.capture = current
        }
        if let receipt = entry.receipt {
            guard receipt.fileThingId == entry.operationId, Self.identifier(receipt.revision), entry.staged != nil else {
                throw Failure.unexpectedReceipt
            }
        }
        return entry
    }

    private func write(_ entry: Entry) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        var privateDirectory = directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try privateDirectory.setResourceValues(values)
        try JSONEncoder().encode(entry).write(to: location(entry.id), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    private func validate(_ capture: LiDARCapture, id: UUID) throws {
        guard capture.id == id, capture.byteCount > 0, capture.frameCount >= 0, capture.archiveURL.isFileURL,
              capture.archiveURL.standardizedFileURL == archiveFolder(id).appendingPathComponent("scan.tar").standardizedFileURL else {
            throw Failure.archiveChanged
        }
    }

    private func archiveFolder(_ id: UUID) -> URL {
        archiveDirectory.appendingPathComponent(id.uuidString.lowercased(), isDirectory: true)
    }

    private static func identifier(_ value: String) -> Bool {
        value.range(of: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$", options: .regularExpression) != nil
    }

    private static func decode<T: Decodable>(_ type: T.Type, _ raw: [String: Any]) throws -> T {
        try JSONDecoder().decode(type, from: JSONSerialization.data(withJSONObject: raw))
    }

    private static func file(_ response: [String: Any], for entry: Entry) throws -> NativeCloudFile {
        guard let raw = response["file"] as? [String: Any], let staged = entry.staged else { throw Failure.unexpectedReceipt }
        let file = try decode(NativeCloudFile.self, raw)
        guard file.id == entry.operationId, identifier(file.revision), file.name == entry.filename, file.folderId == nil,
              !file.trashed, file.content == staged else { throw Failure.unexpectedReceipt }
        return file
    }
}
