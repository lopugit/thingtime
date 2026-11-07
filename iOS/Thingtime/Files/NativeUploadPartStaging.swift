import AppleFileSync
import Foundation

/// Shared source/version checks for foreground and deferred native transfers.
/// A part's URL is borrowed only until the serialized upload/release finishes.
struct NativeUploadPartStaging: Sendable {
    static let inventoryIdentity: String = {
        let key = "thingtime.filesystem-inventory-installation"
        if let value = UserDefaults.standard.string(forKey: key), UUID(uuidString: value) != nil { return "local-ios:" + value }
        let value = UUID().uuidString
        UserDefaults.standard.set(value, forKey: key)
        return "local-ios:" + value
    }()

    let scope: FileSyncOwnerScope
    let grant: MobileFolderStore.Grant
    let photos: PhotoLibraryReader
    let store: FileUploadPartStore
    let download: PhotoOriginalDownloadControl?
    init(scope: FileSyncOwnerScope, grant: MobileFolderStore.Grant, photos: PhotoLibraryReader, store: FileUploadPartStore,
         download: PhotoOriginalDownloadControl? = nil) {
        self.scope = scope; self.grant = grant; self.photos = photos; self.store = store; self.download = download
    }
    var grantRevision: String { Self.grantRevision(grant) }
    static func grantRevision(_ grant: MobileFolderStore.Grant) -> String {
        PhotoLibraryReader.hash(Data((grant.sourceKind ?? "folder").utf8) + grant.bookmark)
    }

    private var photoScope: PhotoLibraryReader.Scope {
        .init(owner: scope, deviceId: Self.inventoryIdentity, rootId: grant.id)
    }

    func verify(_ source: MobileFolderReader.Entry) async throws {
        let worker = Task.detached {
            if grant.sourceKind == "photos" {
                _ = try photos.read(scope: photoScope, path: source.path, version: source.version, offset: 0, length: 1, download: download)
            } else {
                _ = try MobileFolderReader.read(bookmark: grant.bookmark, path: source.path, version: source.version, offset: 0, length: 1)
            }
        }
        try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
    }

    func prepare(_ request: NativeUploadPartRequest) async throws -> (FileUploadPartStore.Request, FileUploadPartStore.Part) {
        let retained = FileUploadPartStore.Request(scope: scope, rootId: grant.id, grantHash: grantRevision,
            uploadId: request.uploadId, requestId: request.requestId, source: request.source,
            partNumber: request.partNumber, offset: request.offset, length: request.length)
        let worker = Task.detached {
            try store.prepare(retained) { offset, length, receive in
                if grant.sourceKind == "photos" {
                    return try photos.stream(scope: photoScope, path: request.source.path, version: request.source.version, offset: offset, length: length, download: download, receive: receive)
                }
                return try MobileFolderReader.stream(bookmark: grant.bookmark, path: request.source.path, version: request.source.version, offset: offset, length: length, receive: receive)
            }
        }
        let part = try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
        return (retained, part)
    }

    func release(_ retained: FileUploadPartStore.Request) async throws {
        let worker = Task.detached { try store.release(retained) }
        try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
    }
}
