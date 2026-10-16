import Network
import UIKit
import WebKit
import UniformTypeIdentifiers

@MainActor
final class MobileFolderBridge: NSObject, UIDocumentPickerDelegate {
    static let accessVersion = "1.1.1"
    static let stagingVersion = "1.0.0"
    static let script = WKUserScript(source: "window.thingtimeNativeBridge.fileAccessVersion = '\(accessVersion)'; window.thingtimeNativeBridge.fileStagingVersion = '\(stagingVersion)';", injectionTime: .atDocumentStart, forMainFrameOnly: true)
    private let store: MobileFolderStore
    private let staging: MobileSyncStaging
    private let networkMonitor = NWPathMonitor()
    private var networkKind = "unknown"
    private var task: Task<Void, Never>?
    private var generation = UUID()
    private var requestId: String?
    private var cancellationReply: (() -> Void)?
    private var picker: UIDocumentPickerViewController?
    private var selection: CheckedContinuation<URL?, Error>?
    private var observer: NSObjectProtocol?
    init(store: MobileFolderStore? = nil, staging: MobileSyncStaging = MobileSyncStaging()) {
        self.store = store ?? MobileFolderStore(); self.staging = staging
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
        selection?.resume(throwing: CancellationError()); selection = nil; picker?.dismiss(animated: false); picker = nil
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
    func handle(_ body: [String: Any], webView: WKWebView, root: URL, currentRoot: @escaping () -> URL?,
                verifyOwner: @escaping (MobileDevicePairing.Scope, @escaping () throws -> Void) async throws -> Void,
                reply: @escaping (String, [String: Any]) -> Void) {
        guard let payload = body["payload"] as? [String: Any], let id = payload["requestId"] as? String, UUID(uuidString: id) != nil,
              let owner = payload["ownerId"] as? String, let action = payload["action"] as? String,
              ["list", "choose", "remove", "scan", "read", "conditions", "suspend", "stage-begin", "stage-append", "stage-finish"].contains(action),
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
            defer { if self.generation == operation { self.task = nil; self.requestId = nil; self.cancellationReply = nil } }
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
                        if action.hasPrefix("stage-") {
                            guard let transfer = payload["transfer"] as? [String: Any] else { throw MobileFolderStore.Failure.invalid }
                            let encoded = try JSONSerialization.data(withJSONObject: transfer)
                            guard encoded.count <= 32_768 else { throw MobileFolderStore.Failure.limit }
                            let request = try JSONDecoder().decode(MobileSyncStaging.Request.self, from: encoded)
                            try request.validate(owner: scope)
                            guard request.rootId == rootId else { throw MobileFolderStore.Failure.invalid }
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
