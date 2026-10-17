import AppleFileSync
import Network
import Photos
import UIKit
import WebKit
import UniformTypeIdentifiers

@MainActor
final class MobileFolderBridge: NSObject, UIDocumentPickerDelegate {
    static let uploadVersion = "1.3.0"
    static let accessVersion = "1.1.1"
    static let stagingVersion = "1.2.0"
    static let publicationVersion = "1.0.0"
    static let trashVersion = "1.2.0"
    static let script = WKUserScript(source: "window.thingtimeNativeBridge.fileUploadVersion = '\(uploadVersion)'; window.thingtimeNativeBridge.fileAccessVersion = '\(accessVersion)'; window.thingtimeNativeBridge.fileStagingVersion = '\(stagingVersion)'; window.thingtimeNativeBridge.filePublicationVersion = '\(publicationVersion)'; window.thingtimeNativeBridge.fileTrashVersion = '\(trashVersion)';", injectionTime: .atDocumentStart, forMainFrameOnly: true)
    private let photos = PhotoLibraryReader()
    private var photoPermissionPending = false
    private var sourceChoice: CheckedContinuation<Bool?, Error>?
    private let store: MobileFolderStore
    private let staging: MobileSyncStaging
    private let uploadParts: FileUploadPartStore
    private let trash: MobileSyncTrash
    private let networkMonitor = NWPathMonitor()
    private var networkKind = "unknown"
    private var task: Task<Void, Never>?
    private var transport: NativeFileSession?
    private var generation = UUID()
    private var requestId: String?
    private var cancellationReply: (() -> Void)?
    private var approvalDialog: UIAlertController?
    private var approvalContinuation: CheckedContinuation<Bool, Error>?
    private var picker: UIDocumentPickerViewController?
    private var selection: CheckedContinuation<URL?, Error>?
    private var observer: NSObjectProtocol?
    private var foregroundObserver: NSObjectProtocol?
    private var foregroundWait: CheckedContinuation<Void, Error>?
    private var background: NativeUploadBackgroundLease?
    init(store: MobileFolderStore? = nil, staging: MobileSyncStaging = MobileSyncStaging(), trash: MobileSyncTrash = MobileSyncTrash(), uploadParts: FileUploadPartStore = FileUploadPartStore()) {
        self.store = store ?? MobileFolderStore(); self.staging = staging; self.trash = trash; self.uploadParts = uploadParts
        super.init()
        UIDevice.current.isBatteryMonitoringEnabled = true
        networkMonitor.pathUpdateHandler = { [weak self] path in
            let kind = path.status != .satisfied ? "offline" : path.usesInterfaceType(.cellular) ? "cellular" : path.usesInterfaceType(.wifi) ? "wifi" : path.usesInterfaceType(.wiredEthernet) ? "ethernet" : "unknown"
            Task { @MainActor in self?.networkKind = kind }
        }
        networkMonitor.start(queue: DispatchQueue(label: "com.thingtime.sync-network"))
        foregroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.foregroundWait?.resume(); self?.foregroundWait = nil }
        }
        observer = NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in if self?.photoPermissionPending != true && self?.background?.canContinue != true { self?.suspend() } }
        }
    }
    private func awaitForeground() async throws {
        try Task.checkCancellation()
        if UIApplication.shared.applicationState == .active { return }
        try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                if Task.isCancelled { continuation.resume(throwing: CancellationError()) }
                else if UIApplication.shared.applicationState == .active { continuation.resume() }
                else { foregroundWait = continuation }
            }
        }, onCancel: { Task { @MainActor [weak self] in
            self?.foregroundWait?.resume(throwing: CancellationError()); self?.foregroundWait = nil
        } })
        try Task.checkCancellation()
    }
    deinit { if let foregroundObserver { NotificationCenter.default.removeObserver(foregroundObserver) }; networkMonitor.cancel(); if let observer { NotificationCenter.default.removeObserver(observer) }; task?.cancel() }
    func suspend() {
        background?.finish(success: false); background = nil
        foregroundWait?.resume(throwing: CancellationError()); foregroundWait = nil
        sourceChoice?.resume(throwing: CancellationError()); sourceChoice = nil
        let photos = self.photos; Task.detached { photos.discard() }
        let cancelled = cancellationReply; cancellationReply = nil
        generation = UUID(); task?.cancel(); task = nil; requestId = nil
        transport?.close(); transport = nil
        selection?.resume(throwing: CancellationError()); selection = nil; picker?.dismiss(animated: false); picker = nil
        approvalContinuation?.resume(throwing: CancellationError()); approvalContinuation = nil
        approvalDialog?.dismiss(animated: false); approvalDialog = nil
        cancelled?()
    }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { if picker === controller { finishSelection(nil) } }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        if picker === controller { finishSelection(urls.count == 1 ? urls[0] : nil) }
    }
    private func finishSelection(_ url: URL?) { selection?.resume(returning: url); selection = nil; picker = nil }
    private func chooseSource(webView: WKWebView) async throws -> Bool? {
        guard var presenter = webView.window?.rootViewController else { throw MobileFolderStore.Failure.unavailable }
        while let next = presenter.presentedViewController { presenter = next }
        guard !(presenter is UIAlertController) else { throw MobileFolderStore.Failure.unavailable }
        return try await withCheckedThrowingContinuation { continuation in
            let dialog = UIAlertController(title: "Choose backup source", message: nil, preferredStyle: .alert)
            sourceChoice = continuation; approvalDialog = dialog
            for (label, choice) in [("Existing folder", Optional(false)), ("Photo library (backup)", Optional(true)), ("Cancel", nil)] {
                dialog.addAction(UIAlertAction(title: label, style: choice == nil ? .cancel : .default) { [weak self, weak dialog] _ in
                    guard let self, self.approvalDialog === dialog else { return }
                    self.sourceChoice?.resume(returning: choice); self.sourceChoice = nil; self.approvalDialog = nil
                })
            }
            presenter.present(dialog, animated: true)
        }
    }
    private func authorizePhotos(webView: WKWebView) async throws -> Bool {
        guard try await presentApproval(title: "Back up photo originals?", message: "Choose which photos and videos Thingtime can read. Original resources include embedded metadata and Live Photo video. Saved cloud copies remain after device deletion. Nothing uploads until you configure and start a backup. Originals must currently be downloaded on this device.", button: "Choose photo access", webView: webView) else { return false }
        photoPermissionPending = true
        defer { photoPermissionPending = false }
        let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        for _ in 0..<50 where UIApplication.shared.applicationState != .active { try await Task.sleep(nanoseconds: 100_000_000) }
        guard status == .authorized || status == .limited else { throw PhotoLibraryReader.Failure.unavailable }
        return true
    }
    private func choose(webView: WKWebView) async throws -> URL? {
        guard var presenter = webView.window?.rootViewController else { throw MobileFolderStore.Failure.unavailable }
        while let next = presenter.presentedViewController { presenter = next }
        guard !(presenter is UIDocumentPickerViewController) else { throw MobileFolderStore.Failure.unavailable }
        return try await withCheckedThrowingContinuation { continuation in
            let controller = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
            controller.allowsMultipleSelection = false; controller.delegate = self
            selection = continuation; picker = controller; presenter.present(controller, animated: true)
        }
    }
    private func approve(grant: MobileFolderStore.Grant, allowTrash: Bool, webView: WKWebView) async throws -> Bool {
        var message = "This sync connection on \(grant.scope.origin.absoluteString) can add and replace files in this folder while the app is open. Replaced copies are retained privately on this device. Removing or choosing the folder again clears this permission."
        if allowTrash { message += " Files deleted in other connected locations can also be moved into Thingtime's private recovery storage. Restoring a retained file never overwrites an existing file." }
        return try await presentApproval(title: allowTrash ? "Allow downloads and recoverable deletions in \(grant.name)?" : "Allow downloads to \(grant.name)?",
            message: message, button: allowTrash ? "Allow sync and trash" : "Allow downloads", webView: webView)
    }
    private func presentApproval(title: String, message: String, button: String, webView: WKWebView) async throws -> Bool {
        guard var presenter = webView.window?.rootViewController else { throw MobileFolderStore.Failure.unavailable }
        while let next = presenter.presentedViewController { presenter = next }
        guard !(presenter is UIDocumentPickerViewController), !(presenter is UIAlertController) else { throw MobileFolderStore.Failure.unavailable }
        return try await withCheckedThrowingContinuation { continuation in
            let dialog = UIAlertController(title: title, message: message, preferredStyle: .alert)
            approvalContinuation = continuation; approvalDialog = dialog
            for (label, approved) in [("Cancel", false), (button, true)] {
                dialog.addAction(UIAlertAction(title: label, style: approved ? .default : .cancel) { [weak self, weak dialog] _ in
                    guard let self, let dialog, self.approvalDialog === dialog else { return }
                    self.approvalContinuation?.resume(returning: approved); self.approvalContinuation = nil; self.approvalDialog = nil
                })
            }
            presenter.present(dialog, animated: true)
        }
    }
    private func uploadPart(_ request: NativeUploadPartRequest, scope: FileSyncOwnerScope,
                            rootId: String, grant: MobileFolderStore.Grant,
                            transport: NativeFileSession, current: @escaping () throws -> Void) async throws -> String {
        let photos = self.photos
        let uploadParts = self.uploadParts
        let retained = FileUploadPartStore.Request(scope: scope, rootId: rootId,
            grantHash: PhotoLibraryReader.hash(Data((grant.sourceKind ?? "folder").utf8) + grant.bookmark),
            uploadId: request.uploadId, requestId: request.requestId, source: request.source,
            partNumber: request.partNumber, offset: request.offset, length: request.length)
        try retained.validate()
        // Revalidate the live source even when its exact part
        // was retained by a previous interrupted app process.
        let verifySource: @Sendable () throws -> Void = {
            if grant.sourceKind == "photos" {
                _ = try photos.read(scope: scope.key + ":" + grant.id, path: request.source.path, version: request.source.version, offset: 0, length: 1)
            } else {
                _ = try MobileFolderReader.read(bookmark: grant.bookmark, path: request.source.path, version: request.source.version, offset: 0, length: 1)
            }
        }
        let before = Task.detached { try verifySource() }
        try await withTaskCancellationHandler(operation: { try await before.value }, onCancel: { before.cancel() })
        try current(); try await transport.verifyOwner()
        // Replay the original reservation before allocating disk
        // or obtaining a fresh signed URL. No credentials persist.
        let started = try await transport.json("/api/v1/attachments/uploads", body: ["requestId": request.requestId,
            "filename": String(request.source.path.split(separator: "/").last ?? ""), "contentType": "application/octet-stream",
            "sizeBytes": request.source.size, "purpose": "file"])
        let ready = try request.verifyPlan(started)
        let worker = Task.detached {
            try uploadParts.prepare(retained) { offset, length, receive in
                if grant.sourceKind == "photos" {
                    return try photos.stream(scope: scope.key + ":" + grant.id, path: request.source.path, version: request.source.version, offset: offset, length: length, receive: receive)
                }
                return try MobileFolderReader.stream(bookmark: grant.bookmark, path: request.source.path, version: request.source.version, offset: offset, length: length, receive: receive)
            }
        }
        let part = try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
        try current(); try await transport.verifyOwner()
        if !ready { try await transport.uploadPart(part, uploadId: request.uploadId, partNumber: request.partNumber) }
        try current()
        let verify = Task.detached { try verifySource() }
        try await withTaskCancellationHandler(operation: { try await verify.value }, onCancel: { verify.cancel() })
        try current(); try await transport.verifyOwner()
        let release = Task.detached { try uploadParts.release(retained) }
        try await withTaskCancellationHandler(operation: { try await release.value }, onCancel: { release.cancel() })
        try current()
        return part.sha256
    }
    private func decode<T: Decodable>(_ value: Any?, as type: T.Type) throws -> T {
        guard let value = value as? [String: Any] else { throw MobileFolderStore.Failure.invalid }
        let data = try JSONSerialization.data(withJSONObject: value)
        guard data.count <= 32_768 else { throw MobileFolderStore.Failure.limit }
        return try JSONDecoder().decode(type, from: data)
    }
    private static func integer(_ value: Any?) -> Int64? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite, number.doubleValue >= 0, number.doubleValue <= 9_007_199_254_740_991,
              number.doubleValue.rounded() == number.doubleValue else { return nil }
        return number.int64Value
    }
    func handle(_ body: [String: Any], webView: WKWebView, root: URL, currentRoot: @escaping () -> URL?,
                cookies: (([HTTPCookie], URL) -> [HTTPCookie])? = nil,
                verifyOwner: @escaping (MobileDevicePairing.Scope, @escaping () throws -> Void) async throws -> Void,
                verifyDevice: ((MobileDevicePairing.Scope, String, @escaping () throws -> Void) async throws -> Void)? = nil,
                reply: @escaping (String, [String: Any]) -> Void) {
        guard let payload = body["payload"] as? [String: Any], let id = payload["requestId"] as? String, UUID(uuidString: id) != nil,
              let owner = payload["ownerId"] as? String, let action = payload["action"] as? String,
              ["list", "choose", "remove", "scan", "read", "upload-part", "upload-file", "conditions", "suspend", "stage-begin", "stage-append", "stage-download", "stage-finish", "write-approve", "publish", "publication-lookup", "trash", "trash-lookup", "trash-expected", "trash-inspect", "trash-restore", "trash-list", "trash-restore-reviewed"].contains(action),
              let scope = try? MobileDevicePairing.Scope(ownerId: owner, url: root) else { return }
        if action == "suspend" { if requestId == id { suspend() }; return }
        let base: [String: Any] = ["requestId": id, "ownerId": owner, "origin": scope.origin.absoluteString]
        guard task == nil else { reply("mobile-files-result", base.merging(["error": "Another folder request is running."]) { _, new in new }); return }
        let operation = UUID(); generation = operation; requestId = id
        cancellationReply = { reply("mobile-files-result", base.merging(["error": "Folder access paused. Try again when the app is active."]) { _, new in new }) }
        let check = { [weak self, weak webView] in
            try Task.checkCancellation()
            guard self?.generation == operation, let webView, currentRoot() == root,
                  let current = webView.url, LopuVoiceContract.sameOrigin(current, root), (UIApplication.shared.applicationState == .active || self?.background?.canContinue == true) else { throw CancellationError() }
        }
        task = Task { [weak self, weak webView] in
            guard let self, let webView else { return }
            defer { if self.generation == operation { self.background?.finish(success: false); self.background = nil; self.task = nil; self.requestId = nil; self.cancellationReply = nil; self.transport?.close(); self.transport = nil } }
            do {
                try check(); try await verifyOwner(scope, check); try check()
                var result: [String: Any] = [:]
                if action == "conditions" {
                    let battery = UIDevice.current.batteryState
                    let charging: Any = battery == .unknown ? NSNull() : (battery == .charging || battery == .full)
                    result["conditions"] = ["network": self.networkKind, "charging": charging]
                } else if action == "choose" {
                    if let photoSource = try await self.chooseSource(webView: webView) {
                        if photoSource {
                            if try await self.authorizePhotos(webView: webView) {
                                try check(); try await verifyOwner(scope, check); try check()
                                _ = try self.store.addPhotos(scope)
                            }
                        } else if let url = try await self.choose(webView: webView) {
                            try check(); try await verifyOwner(scope, check); try check()
                            _ = try self.store.add(scope, selected: url)
                        }
                    }
                } else if action != "list" {
                    guard let rootId = payload["rootId"] as? String, UUID(uuidString: rootId) != nil else { throw MobileFolderStore.Failure.invalid }
                    if action == "remove" {
                        try self.store.remove(scope, id: rootId)
                        let uploadParts = self.uploadParts
                        let cleanup = Task.detached { try uploadParts.remove(scope: scope, rootId: rootId) }
                        try await withTaskCancellationHandler(operation: { try await cleanup.value }, onCancel: { cleanup.cancel() })
                    }
                    else {
                        let grant = try self.store.grant(scope, id: rootId)
                        guard grant.sourceKind != "photos" || ["scan", "read", "upload-part", "upload-file"].contains(action) else { throw MobileFolderStore.Failure.invalid }
                        if action == "upload-part" || action == "upload-file" {
                            guard let cookies else { throw MobileFolderStore.Failure.unavailable }
                            let fileRequest = action == "upload-file" ? try self.decode(payload["upload"], as: NativeUploadFileRequest.self) : nil
                            let request = try fileRequest?.part(1) ?? self.decode(payload["upload"], as: NativeUploadPartRequest.self)
                            try request.validate()
                            let photos = self.photos
                            let current = {
                                try check()
                                let latest = try self.store.grant(scope, id: rootId)
                                guard latest.bookmark == grant.bookmark, latest.sourceKind == grant.sourceKind,
                                      grant.sourceKind != "photos" || photos.access() != "unavailable" else { throw MobileFolderStore.Failure.unavailable }
                            }
                            let transport = NativeFileSession(scope: scope, cookieStore: webView.configuration.websiteDataStore.httpCookieStore,
                                cookies: cookies, check: current, invalidated: { [weak self] in if self?.generation == operation { self?.suspend() } })
                            self.transport = transport; try await transport.open()
                            try await transport.require([("api.auth-me", [1,0,0]), ("api.attachment-uploads", [1,5,0]), ("api.attachment-upload-parts", [1,1,0])])
                            if let fileRequest {
                                try await transport.require([("api.attachment-upload-complete", [1,4,0])])
                                guard let verifyDevice else { throw MobileFolderStore.Failure.unavailable }
                                let authorization = fileRequest.authorization
                                try authorization.validate(owner: scope, rootId: rootId, photos: grant.sourceKind == "photos")
                                try await transport.require([("api.things", [1,35,0])])
                                self.background = await NativeUploadBackgroundCoordinator.shared.begin(size: request.source.size, expired: { [weak self] in
                                    if self?.generation == operation { self?.suspend() }
                                })
                                try current()
                                reply("mobile-files-started", base.merging(["rootId": rootId, "uploadId": fileRequest.uploadId,
                                    "operationId": fileRequest.requestId, "version": request.source.version,
                                    "size": request.source.size, "background": self.background?.canContinue == true]) { _, new in new })
                                try await NativeFileUploadJob.run(fileRequest, check: current, authorize: {
                                    try current()
                                    try await verifyDevice(scope, authorization.scope.deviceId, current)
                                    let saved = try await transport.json("/api/v1/things?id=" + authorization.id)
                                    try current()
                                    let battery = UIDevice.current.batteryState
                                    try authorization.verify(saved, network: self.networkKind, charging: battery == .charging || battery == .full)
                                }, json: { path, body in
                                    try await transport.json(path, body: body)
                                }, upload: { part in
                                    try await self.uploadPart(part, scope: scope, rootId: rootId, grant: grant, transport: transport, current: current)
                                }, progress: { received in
                                    self.background?.progress(received)
                                    reply("mobile-files-progress", base.merging(["rootId": rootId, "uploadId": fileRequest.uploadId,
                                        "operationId": fileRequest.requestId, "version": request.source.version,
                                        "size": request.source.size, "received": received]) { _, new in new })
                                })
                                self.background?.finish(success: true); self.background = nil
                                // The attachment is durable, but publication still belongs to
                                // the shared Timeline runner. Hold its small reply until the
                                // WebView is active and revalidate the owner before delivery.
                                transport.close(); self.transport = nil
                                try await self.awaitForeground()
                                try check(); try await verifyOwner(scope, check); try check()
                                result = ["rootId": rootId, "uploadedFile": ["uploadId": request.uploadId, "requestId": request.requestId,
                                    "version": request.source.version, "size": request.source.size,
                                    "fingerprint": try JSONSerialization.jsonObject(with: JSONEncoder().encode(request.source.fingerprint!))]]
                            } else {
                                let digest = try await self.uploadPart(request, scope: scope, rootId: rootId, grant: grant, transport: transport, current: current)
                                result = ["rootId": rootId, "uploadedPart": ["uploadId": request.uploadId, "requestId": request.requestId,
                                    "partNumber": request.partNumber, "offset": request.offset, "length": request.length,
                                    "version": request.source.version, "size": request.source.size, "sha256": digest]]
                            }
                        } else if action == "trash-list" {
                            let trash = self.trash
                            let cursor = payload["cursor"] as? String
                            guard payload["cursor"] == nil || payload["cursor"] is String else { throw MobileFolderStore.Failure.invalid }
                            let worker = Task.detached { try trash.list(owner: scope, rootId: rootId, bookmark: grant.bookmark, cursor: cursor) }
                            let page = try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
                            result = ["rootId": rootId, "trashPage": try JSONSerialization.jsonObject(with: JSONEncoder().encode(page))]
                        } else if action == "write-approve" {
                            let approval = try self.decode(payload["approval"], as: MobileFolderStore.WriteApproval.self)
                            try approval.validate(owner: scope)
                            if try !self.store.isWriteApproved(scope, id: rootId, approval: approval) {
                                guard try await self.approve(grant: grant, allowTrash: approval.allowTrash == true, webView: webView) else { throw MobileFolderStore.Failure.approvalCancelled }
                                try check(); try await verifyOwner(scope, check); try check()
                                try self.store.approveWrite(scope, grant: grant, approval: approval)
                            }
                            result = ["rootId": rootId, "writeApproval": try JSONSerialization.jsonObject(with: JSONEncoder().encode(approval))]
                        } else if ["trash", "trash-lookup", "trash-expected", "trash-inspect", "trash-restore", "trash-list", "trash-restore-reviewed"].contains(action) {
                            let request = try self.decode(payload["trash"], as: MobileSyncTrash.Request.self)
                            try request.validate(owner: scope)
                            guard request.rootId == rootId else { throw MobileFolderStore.Failure.invalid }
                            if action == "trash" || action == "trash-restore" {
                                let approval = try self.decode(payload["approval"], as: MobileFolderStore.WriteApproval.self)
                                guard approval.scope == request.scope, action != "trash" || approval.allowTrash == true,
                                      try self.store.isWriteApproved(scope, id: rootId, approval: approval) else { throw MobileFolderStore.Failure.unavailable }
                            }
                            let trash = self.trash
                            if action == "trash-restore-reviewed" {
                                let restore = try self.decode(payload["restore"], as: MobileSyncTrash.Restore.self)
                                let pending = Task.detached { try trash.resumeRestore(request, owner: scope, bookmark: grant.bookmark, restore: restore) }
                                let resumed = try await withTaskCancellationHandler(operation: { try await pending.value }, onCancel: { pending.cancel() })
                                if let resumed { result = ["rootId": rootId, "restoredEntry": try JSONSerialization.jsonObject(with: JSONEncoder().encode(resumed))] }
                                else {
                                    let review = Task.detached { try trash.reviewRestore(request, owner: scope, bookmark: grant.bookmark, restore: restore) }
                                    try await withTaskCancellationHandler(operation: { try await review.value }, onCancel: { review.cancel() })
                                    guard try await self.presentApproval(title: "Restore this \(restore.expected.kind) to \(grant.name)?",
                                        message: "Restore \(restore.expected.path) as \(restore.path) in this selected folder on \(scope.origin.absoluteString). Existing files are never overwritten.",
                                        button: "Restore", webView: webView) else { throw MobileFolderStore.Failure.approvalCancelled }
                                    try check(); try await verifyOwner(scope, check); try check()
                                    guard try self.store.grant(scope, id: rootId).bookmark == grant.bookmark else { throw MobileFolderStore.Failure.unavailable }
                                    let worker = Task.detached { try trash.restore(request, owner: scope, bookmark: grant.bookmark, restore: restore) }
                                    let restored = try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
                                    result = ["rootId": rootId, "restoredEntry": try JSONSerialization.jsonObject(with: JSONEncoder().encode(restored))]
                                }
                            } else if action == "trash-expected" {
                                let worker = Task.detached { try trash.expected(request, owner: scope, bookmark: grant.bookmark) }
                                let expected = try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
                                result = ["rootId": rootId, "expectedEntry": try JSONSerialization.jsonObject(with: JSONEncoder().encode(expected))]
                            } else if action == "trash-inspect" {
                                let worker = Task.detached { try trash.inspect(request, owner: scope, bookmark: grant.bookmark) }
                                let retained = try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
                                result = ["rootId": rootId, "retainedEntry": try retained.map { try JSONSerialization.jsonObject(with: JSONEncoder().encode($0)) } ?? NSNull()]
                                let stateWorker = Task.detached { try trash.restoration(request, owner: scope, bookmark: grant.bookmark) }
                                let intent = try await withTaskCancellationHandler(operation: { try await stateWorker.value }, onCancel: { stateWorker.cancel() })
                                result["restoreIntent"] = try intent.map { try JSONSerialization.jsonObject(with: JSONEncoder().encode($0)) } ?? NSNull()
                            } else if action == "trash-restore" {
                                let restore = try self.decode(payload["restore"], as: MobileSyncTrash.Restore.self)
                                let worker = Task.detached { try trash.restore(request, owner: scope, bookmark: grant.bookmark, restore: restore) }
                                let restored = try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
                                result = ["rootId": rootId, "restoredEntry": try JSONSerialization.jsonObject(with: JSONEncoder().encode(restored))]
                            } else {
                                let worker = Task.detached {
                                    if action == "trash" { return MobileSyncTrash.Lookup(status: "complete", receipt: try trash.trash(request, owner: scope, bookmark: grant.bookmark)) }
                                    return try trash.lookup(request, owner: scope, bookmark: grant.bookmark)
                                }
                                let lookup = try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
                                result = ["rootId": rootId, "trash": try JSONSerialization.jsonObject(with: JSONEncoder().encode(lookup))]
                            }
                        } else if action == "publish" || action == "publication-lookup" {
                            let request = try self.decode(payload["transfer"], as: MobileSyncStaging.Request.self)
                            try request.validate(owner: scope)
                            guard request.rootId == rootId else { throw MobileFolderStore.Failure.invalid }
                            var stage: MobileSyncStaging.Stage?
                            if action == "publish" {
                                let approval = try self.decode(payload["approval"], as: MobileFolderStore.WriteApproval.self)
                                guard approval.scope == request.scope, try self.store.isWriteApproved(scope, id: rootId, approval: approval) else { throw MobileFolderStore.Failure.unavailable }
                                stage = try self.decode(payload["stage"], as: MobileSyncStaging.Stage.self)
                            }
                            let staged = stage, staging = self.staging
                            let worker = Task.detached {
                                try MobileFolderReader.checkAccess(bookmark: grant.bookmark)
                                if let staged {
                                    let receipt = try staging.publish(request, owner: scope, bookmark: grant.bookmark, stage: staged)
                                    return MobileSyncStaging.Lookup(status: "complete", receipt: receipt)
                                }
                                return try staging.lookup(request, owner: scope, bookmark: grant.bookmark)
                            }
                            let lookup = try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
                            result = ["rootId": rootId, "publication": try JSONSerialization.jsonObject(with: JSONEncoder().encode(lookup))]
                        } else if action.hasPrefix("stage-") {
                            guard let transfer = payload["transfer"] as? [String: Any] else { throw MobileFolderStore.Failure.invalid }
                            let encoded = try JSONSerialization.data(withJSONObject: transfer)
                            guard encoded.count <= 32_768 else { throw MobileFolderStore.Failure.limit }
                            let request = try JSONDecoder().decode(MobileSyncStaging.Request.self, from: encoded)
                            try request.validate(owner: scope)
                            guard request.rootId == rootId else { throw MobileFolderStore.Failure.invalid }
                            if action == "stage-download" {
                                guard let cookies, let offset = Self.integer(payload["offset"]),
                                      let length = Self.integer(payload["length"]), length > 0, length <= FileVersionExport.rangeBytes else { throw MobileFolderStore.Failure.invalid }
                                let file = try self.decode(payload["cloudFile"], as: NativeCloudFile.self)
                                try file.validate(source: request.operation.mutation.source)
                                let path = try file.download.rangePath(offset: offset, length: Int(length))
                                let current = {
                                    try check()
                                    guard try self.store.grant(scope, id: rootId).bookmark == grant.bookmark else { throw MobileFolderStore.Failure.unavailable }
                                }
                                let transport = NativeFileSession(scope: scope, cookieStore: webView.configuration.websiteDataStore.httpCookieStore,
                                    cookies: cookies, check: current, invalidated: { [weak self] in if self?.generation == operation { self?.suspend() } })
                                self.transport = transport
                                try await transport.open()
                                try await transport.require([("api.auth-me", [1,0,0]), ("api.files", [1,0,0]), ("api.attachment-content", [1,14,0])])
                                try await file.check(using: transport)
                                let bytes = try await transport.read(path, limit: Int(length)) {
                                    try file.download.validateRange($0, offset: offset, length: Int(length))
                                }
                                guard bytes.count == Int(length) else { throw MobileFolderStore.Failure.changed }
                                try await file.check(using: transport); try await transport.verifyOwner(); try current()
                                let staging = self.staging
                                let worker = Task.detached {
                                    try MobileFolderReader.checkAccess(bookmark: grant.bookmark)
                                    var consumed = 0
                                    let progress = try staging.appendStream(request, owner: scope, offset: offset, length: bytes.count) { wanted in
                                        defer { consumed += wanted }; return bytes.subdata(in: consumed..<(consumed + wanted))
                                    }
                                    try MobileFolderReader.checkAccess(bookmark: grant.bookmark)
                                    return progress
                                }
                                let progress = try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
                                try current(); try await transport.verifyOwner()
                                result = ["rootId": rootId, "staging": try JSONSerialization.jsonObject(with: JSONEncoder().encode(progress))]
                            } else {
                                var offset: Int64 = 0, bytes = Data()
                                if action == "stage-append" {
                                    guard let number = payload["offset"] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
                                          number.doubleValue.isFinite, number.doubleValue >= 0, number.doubleValue <= 9_007_199_254_740_991,
                                          number.doubleValue.rounded() == number.doubleValue, let encodedBytes = payload["data"] as? String,
                                          encodedBytes.utf8.count <= 87_384, let decoded = Data(base64Encoded: encodedBytes),
                                          !decoded.isEmpty, decoded.count <= MobileFolderReader.maximumReadBytes else { throw MobileFolderStore.Failure.invalid }
                                    offset = number.int64Value; bytes = decoded
                                }
                                let chunkOffset = offset, chunkBytes = bytes, staging = self.staging
                                let worker = Task.detached {
                                    try MobileFolderReader.checkAccess(bookmark: grant.bookmark)
                                    let progress: MobileSyncStaging.Progress
                                    switch action {
                                    case "stage-begin": progress = try staging.begin(request, owner: scope)
                                    case "stage-append": progress = try staging.append(request, owner: scope, offset: chunkOffset, bytes: chunkBytes)
                                    default: progress = try staging.finish(request, owner: scope)
                                    }
                                    try MobileFolderReader.checkAccess(bookmark: grant.bookmark)
                                    return progress
                                }
                                let progress = try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
                                result = ["rootId": rootId, "staging": try JSONSerialization.jsonObject(with: JSONEncoder().encode(progress))]
                            }
                        } else if action == "scan" {
                            let photos = self.photos
                            let worker = Task.detached { try grant.sourceKind == "photos" ? photos.scan(scope: scope.key + ":" + grant.id) : MobileFolderReader.scan(bookmark: grant.bookmark) }
                            let entries = try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
                            var encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(entries)) as! [[String: Any]]
                            for i in encoded.indices where encoded[i]["sha256"] == nil { encoded[i]["sha256"] = NSNull() }
                            result = ["rootId": rootId, "complete": true, "entries": encoded]
                        } else {
                            guard let path = payload["path"] as? String, let version = payload["version"] as? String,
                                  version.utf8.count <= 512, let offset = payload["offset"] as? NSNumber,
                                  let length = payload["length"] as? NSNumber,
                                  CFGetTypeID(offset) != CFBooleanGetTypeID(), CFGetTypeID(length) != CFBooleanGetTypeID(),
                                  offset.doubleValue.isFinite, offset.doubleValue >= 0, offset.doubleValue <= 9_007_199_254_740_991,
                                  offset.doubleValue.rounded() == offset.doubleValue, length.doubleValue.isFinite,
                                  length.doubleValue.rounded() == length.doubleValue, length.doubleValue > 0,
                                  length.doubleValue <= Double(MobileFolderReader.maximumReadBytes) else { throw MobileFolderStore.Failure.invalid }
                            let photos = self.photos
                            let worker = Task.detached { try grant.sourceKind == "photos" ? photos.read(scope: scope.key + ":" + grant.id, path: path, version: version, offset: offset.int64Value, length: length.intValue) : MobileFolderReader.read(bookmark: grant.bookmark, path: path, version: version, offset: offset.int64Value, length: length.intValue) }
                            let chunk = try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
                            result = ["rootId": rootId, "path": path, "chunk": try JSONSerialization.jsonObject(with: JSONEncoder().encode(chunk))]
                        }
                    }
                }
                try check(); try await verifyOwner(scope, check); try check()
                result["roots"] = try self.store.list(scope).map { grant -> [String: Any] in
                    var row: [String: Any] = ["id": grant.id, "name": grant.name]
                    if grant.sourceKind == "photos" { row["sourceKind"] = "photos"; row["photoAccess"] = self.photos.access() }
                    return row
                }
                reply("mobile-files-result", base.merging(result) { _, new in new })
            } catch is CancellationError { }
            catch {
                guard (try? check()) != nil else { return }
                let error = (error as? FileUploadPartStore.Failure)?.errorDescription ?? (error as? PhotoLibraryReader.Failure)?.errorDescription ?? (error as? MobileFolderStore.Failure)?.errorDescription ?? (error as? MobileDevicePairing.Failure)?.errorDescription ?? "Folder access failed. Your selections were preserved; try again."
                reply("mobile-files-result", base.merging(["error": error]) { _, new in new })
            }
        }
    }
}
