import AppleFileSync
import UIKit
import WebKit
import UniformTypeIdentifiers

/// Explicit one-file saves, using ephemeral picker access rather than a sync grant.
@MainActor
final class FileExportBridge: NSObject, UIDocumentPickerDelegate, WKHTTPCookieStoreObserver {
    static let version = "1.0.0"
    static let script = WKUserScript(source: "window.thingtimeNativeBridge.fileExportVersion = '\(version)';",
                                     injectionTime: .atDocumentStart, forMainFrameOnly: true)
    private let session: URLSession
    private var task: Task<Void, Never>?
    private var deadline: Task<Void, Never>?
    private var generation = UUID()
    private var requestId: String?
    private var scope: FileSyncOwnerScope?
    private var cancellationReply: (() -> Void)?
    private var picker: UIDocumentPickerViewController?
    private var selection: CheckedContinuation<URL?, Error>?
    private var observer: NSObjectProtocol?
    private var cookieStore: WKHTTPCookieStore?
    private var cookieURL: URL?
    private var pinnedCookie: String?
    private var filterCookies: (([HTTPCookie], URL) -> [HTTPCookie])?

    override init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil; configuration.urlCredentialStorage = nil
        configuration.httpShouldSetCookies = false; configuration.urlCache = nil
        session = URLSession(configuration: configuration, delegate: MobileDeviceRedirectPolicy(), delegateQueue: nil)
        super.init()
        observer = NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.suspend() }
        }
    }
    deinit { if let observer { NotificationCenter.default.removeObserver(observer) }; task?.cancel(); deadline?.cancel(); session.invalidateAndCancel() }
    func suspend() {
        let reply = cancellationReply
        generation = UUID(); task?.cancel(); task = nil; clear()
        reply?()
    }
    private func clear() {
        deadline?.cancel(); deadline = nil; requestId = nil; scope = nil; cancellationReply = nil
        cookieStore?.remove(self); cookieStore = nil; cookieURL = nil; pinnedCookie = nil; filterCookies = nil
        selection?.resume(throwing: CancellationError()); selection = nil
        picker?.dismiss(animated: false); picker = nil
    }
    // Only authentication changes invalidate work; unrelated cookies may refresh.
    static func authenticationCookie(_ cookies: [HTTPCookie]) throws -> String {
        let matches = cookies.filter { $0.name == "tt_auth" }
        guard matches.count == 1, let value = matches.first?.value, !value.isEmpty, value.utf8.count <= 16_384,
              value.unicodeScalars.allSatisfy({ (0x21...0x7e).contains($0.value) && !";,\\\"".unicodeScalars.contains($0) }) else {
            throw MobileDevicePairing.Failure.identity
        }
        return "tt_auth=" + value
    }
    func cookiesDidChange(in cookieStore: WKHTTPCookieStore) {
        let operation = generation
        Task { [weak self] in
            guard let self, let url = self.cookieURL, let filter = self.filterCookies, let pinned = self.pinnedCookie else { return }
            let all = await cookieStore.allCookies()
            guard self.generation == operation else { return }
            if (try? Self.authenticationCookie(filter(all, url))) != pinned { self.suspend() }
        }
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
        cookieStore = webView.configuration.websiteDataStore.httpCookieStore; cookieStore?.add(self)
        cookieURL = scope.origin.appendingPathComponent("api/v1/auth/me"); filterCookies = cookies
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
                let all = await webView.configuration.websiteDataStore.httpCookieStore.allCookies(); try check()
                self.pinnedCookie = try Self.authenticationCookie(cookies(all, self.cookieURL!))
                let manifest = try await self.json(LopuVoiceContract.manifestPath, scope: scope, check: check)
                guard LopuVoiceContract.accepts(manifest, baseURL: scope.origin, feature: "api.auth-me", minimum: [1,0,0]),
                      LopuVoiceContract.accepts(manifest, baseURL: scope.origin, feature: "api.attachment-content", minimum: [1,14,0]) else { throw MobileDevicePairing.Failure.incompatible }
                try await self.verifyOwner(scope, check: check)
                let fingerprint = try await self.read("/api/v1/attachments/content?id=\(request.content.attachmentId)&fingerprint=1", scope: scope,
                    limit: 512 * 1024, check: check) { response in
                        guard response.statusCode == 200 else { throw MobileFolderStore.Failure.unavailable }
                    }
                try request.matchFingerprint(fingerprint)
                let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("FileVersionExports-v1", isDirectory: true)
                let worker = Task.detached {
                    try await FileVersionExport.Prepared.download(request, privateDirectory: directory) { offset, length in
                        try await self.read(request.rangePath(offset: offset, length: length), scope: scope, limit: length, check: check) {
                            try request.validateRange($0, offset: offset, length: length)
                        }
                    }
                }
                let prepared = try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
                try check(); try await self.verifyOwner(scope, check: check)
                guard let selected = try await self.choose(webView: webView) else { try check(); respond(false); return }
                // Picker selection is not authorization to disclose bytes from an old account.
                try check(); try await self.verifyOwner(scope, check: check); try check()
                let writer = Task.detached { try prepared.save(into: selected) }
                _ = try await withTaskCancellationHandler(operation: { try await writer.value }, onCancel: { writer.cancel() })
                try check(); try await self.verifyOwner(scope, check: check); try check()
                respond(true)
            } catch {
                if self.generation == operation {
                    respond(false, "This version could not be saved and verified. Check Files before trying again; existing files were not replaced.")
                }
            }
        }
    }
    private func verifyOwner(_ scope: FileSyncOwnerScope, check: @escaping () throws -> Void) async throws {
        let identity = try await json("/api/v1/auth/me", scope: scope, check: check)
        guard let user = identity["user"] as? [String: Any], user["id"] as? String == scope.ownerId,
              user["accountKind"] as? String == "user", user["temporary"] as? Bool != true else { throw MobileDevicePairing.Failure.identity }
    }
    private func json(_ path: String, scope: FileSyncOwnerScope, check: @escaping () throws -> Void) async throws -> [String: Any] {
        let data = try await read(path, scope: scope, limit: 512 * 1024, check: check) {
            guard $0.statusCode == 200 else { throw MobileFolderStore.Failure.unavailable }
        }
        guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw MobileFolderStore.Failure.invalid }; return value
    }
    private func read(_ path: String, scope: FileSyncOwnerScope, limit: Int, check: @escaping () throws -> Void,
                      validate: @escaping @Sendable (HTTPURLResponse) throws -> Void) async throws -> Data {
        try check()
        guard let store = cookieStore, let filter = filterCookies, let pinned = pinnedCookie,
              let url = URL(string: path, relativeTo: scope.origin)?.absoluteURL, LopuVoiceContract.sameOrigin(url, scope.origin) else { throw CancellationError() }
        let all = await store.allCookies(); try check()
        guard try Self.authenticationCookie(filter(all, url)) == pinned else { throw MobileDevicePairing.Failure.identity }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        request.setValue(pinned, forHTTPHeaderField: "Cookie"); request.setValue(scope.origin.absoluteString, forHTTPHeaderField: "Origin")
        request.setValue(scope.ownerId, forHTTPHeaderField: "X-Thingtime-Expected-Actor")
        request.setValue("home", forHTTPHeaderField: "X-Thingtime-Expected-Data-Plane")
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        let immutableRequest = request
        let reader = Task.detached { [session] in
            let (bytes, response) = try await session.bytes(for: immutableRequest)
            guard let http = response as? HTTPURLResponse, http.url == url else { throw MobileFolderStore.Failure.invalid }
            try validate(http)
            var data = Data(); data.reserveCapacity(min(limit, FileVersionExport.rangeBytes))
            for try await byte in bytes {
                try Task.checkCancellation()
                guard data.count < limit else { throw MobileFolderStore.Failure.limit }; data.append(byte)
            }
            return data
        }
        let data = try await withTaskCancellationHandler(operation: { try await reader.value }, onCancel: { reader.cancel() })
        try check()
        let latest = await store.allCookies(); try check()
        guard try Self.authenticationCookie(filter(latest, url)) == pinned else { throw MobileDevicePairing.Failure.identity }
        return data
    }
}
