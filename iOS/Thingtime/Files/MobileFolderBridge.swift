import AppleFileSync
import Network
import UIKit
import WebKit
import UniformTypeIdentifiers

@MainActor
final class MobileFolderBridge: NSObject, UIDocumentPickerDelegate {
    static let accessVersion = "1.1.1"
    static let stagingVersion = "1.2.0"
    static let publicationVersion = "1.0.0"
    static let trashVersion = "1.0.0"
    static let script = WKUserScript(source: "window.thingtimeNativeBridge.fileAccessVersion = '\(accessVersion)'; window.thingtimeNativeBridge.fileStagingVersion = '\(stagingVersion)'; window.thingtimeNativeBridge.filePublicationVersion = '\(publicationVersion)'; window.thingtimeNativeBridge.fileTrashVersion = '\(trashVersion)';", injectionTime: .atDocumentStart, forMainFrameOnly: true)
    private let store: MobileFolderStore
    private let staging: MobileSyncStaging
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
    init(store: MobileFolderStore? = nil, staging: MobileSyncStaging = MobileSyncStaging(), trash: MobileSyncTrash = MobileSyncTrash()) {
        self.store = store ?? MobileFolderStore(); self.staging = staging; self.trash = trash
        super.init()
        UIDevice.current.isBatteryMonitoringEnabled = true
        networkMonitor.pathUpdateHandler = { [weak self] path in
            let kind = path.status != .satisfied ? "offline" : path.usesInterfaceType(.cellular) ? "cellular" : path.usesInterfaceType(.wifi) ? "wifi" : path.usesInterfaceType(.wiredEthernet) ? "ethernet" : "unknown"
            Task { @MainActor in self?.networkKind = kind }
        }
        networkMonitor.start(queue: DispatchQueue(label: "com.thingtime.sync-network"))
        observer = NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.suspend() }
        }
    }
    deinit { networkMonitor.cancel(); if let observer { NotificationCenter.default.removeObserver(observer) }; task?.cancel() }
    func suspend() {
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
        guard var presenter = webView.window?.rootViewController else { throw MobileFolderStore.Failure.unavailable }
        while let next = presenter.presentedViewController { presenter = next }
        guard !(presenter is UIDocumentPickerViewController), !(presenter is UIAlertController) else { throw MobileFolderStore.Failure.unavailable }
        return try await withCheckedThrowingContinuation { continuation in
            var message = "This sync connection on \(grant.scope.origin.absoluteString) can add and replace files in this folder while the app is open. Replaced copies are retained privately on this device. Removing or choosing the folder again clears this permission."
            if allowTrash { message += " Files deleted in other connected locations can also be moved into Thingtime's private recovery storage. Restoring a retained file never overwrites an existing file." }
            let dialog = UIAlertController(title: allowTrash ? "Allow downloads and recoverable deletions in \(grant.name)?" : "Allow downloads to \(grant.name)?",
                message: message, preferredStyle: .alert)
            approvalContinuation = continuation; approvalDialog = dialog
            for (title, approved) in [("Cancel", false), (allowTrash ? "Allow sync and trash" : "Allow downloads", true)] {
                dialog.addAction(UIAlertAction(title: title, style: approved ? .default : .cancel) { [weak self, weak dialog] _ in
                    guard let self, let dialog, self.approvalDialog === dialog else { return }
                    self.approvalContinuation?.resume(returning: approved); self.approvalContinuation = nil; self.approvalDialog = nil
                })
            }
            presenter.present(dialog, animated: true)
        }
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
                reply: @escaping (String, [String: Any]) -> Void) {
        guard let payload = body["payload"] as? [String: Any], let id = payload["requestId"] as? String, UUID(uuidString: id) != nil,
              let owner = payload["ownerId"] as? String, let action = payload["action"] as? String,
              ["list", "choose", "remove", "scan", "read", "conditions", "suspend", "stage-begin", "stage-append", "stage-download", "stage-finish", "write-approve", "publish", "publication-lookup", "trash", "trash-lookup", "trash-inspect", "trash-restore"].contains(action),
              let scope = try? MobileDevicePairing.Scope(ownerId: owner, url: root) else { return }
        if action == "suspend" { if requestId == id { suspend() }; return }
        let base: [String: Any] = ["requestId": id, "ownerId": owner, "origin": scope.origin.absoluteString]
        guard task == nil else { reply("mobile-files-result", base.merging(["error": "Another folder request is running."]) { _, new in new }); return }
        let operation = UUID(); generation = operation; requestId = id
        cancellationReply = { reply("mobile-files-result", base.merging(["error": "Folder access paused. Try again when the app is active."]) { _, new in new }) }
        let check = { [weak self, weak webView] in
            try Task.checkCancellation()
            guard self?.generation == operation, let webView, currentRoot() == root,
                  let current = webView.url, LopuVoiceContract.sameOrigin(current, root), UIApplication.shared.applicationState == .active else { throw CancellationError() }
        }
        task = Task { [weak self, weak webView] in
            guard let self, let webView else { return }
            defer { if self.generation == operation { self.task = nil; self.requestId = nil; self.cancellationReply = nil; self.transport?.close(); self.transport = nil } }
            do {
                try check(); try await verifyOwner(scope, check); try check()
                var result: [String: Any] = [:]
                if action == "conditions" {
                    let battery = UIDevice.current.batteryState
                    let charging: Any = battery == .unknown ? NSNull() : (battery == .charging || battery == .full)
                    result["conditions"] = ["network": self.networkKind, "charging": charging]
                } else if action == "choose" {
                    if let url = try await self.choose(webView: webView) {
                        try check(); try await verifyOwner(scope, check); try check()
                        _ = try self.store.add(scope, selected: url)
                    }
                } else if action != "list" {
                    guard let rootId = payload["rootId"] as? String, UUID(uuidString: rootId) != nil else { throw MobileFolderStore.Failure.invalid }
                    if action == "remove" { try self.store.remove(scope, id: rootId) }
                    else {
                        let grant = try self.store.grant(scope, id: rootId)
                        if action == "write-approve" {
                            let approval = try self.decode(payload["approval"], as: MobileFolderStore.WriteApproval.self)
                            try approval.validate(owner: scope)
                            if try !self.store.isWriteApproved(scope, id: rootId, approval: approval) {
                                guard try await self.approve(grant: grant, allowTrash: approval.allowTrash == true, webView: webView) else { throw MobileFolderStore.Failure.approvalCancelled }
                                try check(); try await verifyOwner(scope, check); try check()
                                try self.store.approveWrite(scope, grant: grant, approval: approval)
                            }
                            result = ["rootId": rootId, "writeApproval": try JSONSerialization.jsonObject(with: JSONEncoder().encode(approval))]
                        } else if ["trash", "trash-lookup", "trash-inspect", "trash-restore"].contains(action) {
                            let request = try self.decode(payload["trash"], as: MobileSyncTrash.Request.self)
                            try request.validate(owner: scope)
                            guard request.rootId == rootId else { throw MobileFolderStore.Failure.invalid }
                            if action == "trash" || action == "trash-restore" {
                                let approval = try self.decode(payload["approval"], as: MobileFolderStore.WriteApproval.self)
                                guard approval.scope == request.scope, action != "trash" || approval.allowTrash == true,
                                      try self.store.isWriteApproved(scope, id: rootId, approval: approval) else { throw MobileFolderStore.Failure.unavailable }
                            }
                            let trash = self.trash
                            if action == "trash-inspect" {
                                let worker = Task.detached { try trash.inspect(request, owner: scope, bookmark: grant.bookmark) }
                                let retained = try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
                                result = ["rootId": rootId, "retainedEntry": try retained.map { try JSONSerialization.jsonObject(with: JSONEncoder().encode($0)) } ?? NSNull()]
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
                            let worker = Task.detached { try MobileFolderReader.scan(bookmark: grant.bookmark) }
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
                            let worker = Task.detached { try MobileFolderReader.read(bookmark: grant.bookmark, path: path, version: version, offset: offset.int64Value, length: length.intValue) }
                            let chunk = try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
                            result = ["rootId": rootId, "path": path, "chunk": try JSONSerialization.jsonObject(with: JSONEncoder().encode(chunk))]
                        }
                    }
                }
                try check(); try await verifyOwner(scope, check); try check()
                result["roots"] = try self.store.list(scope).map { ["id": $0.id, "name": $0.name] }
                reply("mobile-files-result", base.merging(result) { _, new in new })
            } catch is CancellationError { }
            catch {
                guard (try? check()) != nil else { return }
                let error = (error as? MobileFolderStore.Failure)?.errorDescription ?? (error as? MobileDevicePairing.Failure)?.errorDescription ?? "Folder access failed. Your selections were preserved; try again."
                reply("mobile-files-result", base.merging(["error": error]) { _, new in new })
            }
        }
    }
}
