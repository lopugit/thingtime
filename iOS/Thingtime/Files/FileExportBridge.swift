import AppleFileSync
import UIKit
import WebKit
import UniformTypeIdentifiers

/// Explicit one-file saves, using ephemeral picker access rather than a sync grant.
@MainActor
final class FileExportBridge: NSObject, UIDocumentPickerDelegate {
    static let version = "1.0.0"
    static let script = WKUserScript(source: "window.thingtimeNativeBridge.fileExportVersion = '\(version)';",
                                     injectionTime: .atDocumentStart, forMainFrameOnly: true)
    private var transport: NativeFileSession?
    private var task: Task<Void, Never>?
    private var deadline: Task<Void, Never>?
    private var generation = UUID()
    private var requestId: String?
    private var scope: FileSyncOwnerScope?
    private var cancellationReply: (() -> Void)?
    private var picker: UIDocumentPickerViewController?
    private var selection: CheckedContinuation<URL?, Error>?
    private var observer: NSObjectProtocol?

    override init() {
        super.init()
        observer = NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.suspend() }
        }
    }
    deinit { if let observer { NotificationCenter.default.removeObserver(observer) }; task?.cancel(); deadline?.cancel() }
    func suspend() {
        let reply = cancellationReply
        generation = UUID(); task?.cancel(); task = nil; clear()
        reply?()
    }
    private func clear() {
        deadline?.cancel(); deadline = nil; requestId = nil; scope = nil; cancellationReply = nil
        transport?.close(); transport = nil
        selection?.resume(throwing: CancellationError()); selection = nil
        picker?.dismiss(animated: false); picker = nil
    }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { if picker === controller { finish(nil) } }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        if picker === controller { finish(urls.count == 1 ? urls[0] : nil) }
    }
    private func finish(_ url: URL?) { selection?.resume(returning: url); selection = nil; picker = nil }
    private func choose(webView: WKWebView) async throws -> URL? {
        guard var presenter = webView.window?.rootViewController else { throw MobileFolderStore.Failure.unavailable }
        while let next = presenter.presentedViewController { presenter = next }
        guard !(presenter is UIDocumentPickerViewController), !(presenter is UIAlertController) else { throw MobileFolderStore.Failure.unavailable }
        return try await withCheckedThrowingContinuation { continuation in
            let controller = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: false)
            controller.title = "Choose where to save this version"
            controller.allowsMultipleSelection = false; controller.delegate = self
            selection = continuation; picker = controller; presenter.present(controller, animated: true)
        }
    }
    func handle(_ body: [String: Any], webView: WKWebView, root: URL, currentRoot: @escaping () -> URL?,
                cookies: @escaping ([HTTPCookie], URL) -> [HTTPCookie], reply: @escaping (String, [String: Any]) -> Void) {
        guard let payload = body["payload"] as? [String: Any], let id = payload["requestId"] as? String, UUID(uuidString: id) != nil,
              let owner = payload["ownerId"] as? String, let scope = try? FileSyncOwnerScope(ownerId: owner, url: root),
              payload["origin"] as? String == scope.origin.absoluteString, let action = payload["action"] as? String else { return }
        if action == "cancel" { if requestId == id && self.scope == scope { suspend() }; return }
        guard action == "save", let data = try? JSONSerialization.data(withJSONObject: payload), data.count <= 32_768,
              let request = try? JSONDecoder().decode(FileVersionExport.Request.self, from: data), (try? request.validate()) != nil else { return }
        let base: [String: Any] = ["requestId": id, "ownerId": owner, "origin": scope.origin.absoluteString,
            "attachmentId": request.content.attachmentId, "version": request.content.version, "size": request.content.size]
        func respond(_ saved: Bool, _ error: String? = nil) {
            var value = base; value["saved"] = saved; if let error { value["error"] = error }; reply("file-export-result", value)
        }
        guard task == nil else { respond(false, "Another file is being saved. Finish or cancel it first."); return }
        let operation = UUID(); generation = operation; requestId = id; self.scope = scope
        cancellationReply = { respond(false, "Saving was interrupted. Check Files before trying again.") }
        let check = { [weak self, weak webView] in
            try Task.checkCancellation()
            guard self?.generation == operation, currentRoot() == root, let current = webView?.url,
                  LopuVoiceContract.sameOrigin(current, root), UIApplication.shared.applicationState == .active else { throw CancellationError() }
        }
        deadline = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: 30 * 60 * 1_000_000_000) } catch { return }
            if self?.generation == operation { self?.suspend() }
        }
        task = Task { [weak self, weak webView] in
            guard let self, let webView else { return }
            defer { if self.generation == operation { self.task = nil; self.clear() } }
            do {
                try check()
                let transport = NativeFileSession(scope: scope, cookieStore: webView.configuration.websiteDataStore.httpCookieStore,
                    cookies: cookies, check: check, invalidated: { [weak self] in if self?.generation == operation { self?.suspend() } })
                self.transport = transport
                try await transport.open()
                try await transport.require([("api.auth-me", [1,0,0]), ("api.attachment-content", [1,14,0])])
                let fingerprint = try await transport.read("/api/v1/attachments/content?id=\(request.content.attachmentId)&fingerprint=1",
                    limit: 512 * 1024) { response in
                        guard response.statusCode == 200 else { throw MobileFolderStore.Failure.unavailable }
                    }
                try request.matchFingerprint(fingerprint)
                let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("FileVersionExports-v1", isDirectory: true)
                let worker = Task.detached {
                    try await FileVersionExport.Prepared.download(request, privateDirectory: directory) { offset, length in
                        try await transport.read(request.rangePath(offset: offset, length: length), limit: length) {
                            try request.validateRange($0, offset: offset, length: length)
                        }
                    }
                }
                let prepared = try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
                try check(); try await transport.verifyOwner()
                guard let selected = try await self.choose(webView: webView) else { try check(); respond(false); return }
                // Picker selection is not authorization to disclose bytes from an old account.
                try check(); try await transport.verifyOwner(); try check()
                let writer = Task.detached { try prepared.save(into: selected) }
                _ = try await withTaskCancellationHandler(operation: { try await writer.value }, onCancel: { writer.cancel() })
                try check(); try await transport.verifyOwner(); try check()
                respond(true)
            } catch {
                if self.generation == operation {
                    respond(false, "This version could not be saved and verified. Check Files before trying again; existing files were not replaced.")
                }
            }
        }
    }
}
