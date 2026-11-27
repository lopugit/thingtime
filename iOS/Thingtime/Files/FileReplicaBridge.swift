import AppleFileSync
import UIKit
import UniformTypeIdentifiers
import WebKit

/// Explicit, policy-bound operations for one app-managed file on this iPhone.
/// The page supplies identity and revision expectations, never a local path.
@MainActor
final class FileReplicaBridge {
    static let version = "1.0.0"
    static let script = WKUserScript(source: "window.thingtimeNativeBridge.fileReplicaVersion = '\(version)';",
                                    injectionTime: .atDocumentStart, forMainFrameOnly: true)
    typealias VerifyDevice = (FileSyncOwnerScope, String, @escaping () throws -> Void) async throws -> Void

    private struct Policy: Decodable, Equatable {
        struct Source: Decodable, Equatable { let id: String; let revision: String; let sourceHash: String }
        struct Preference: Decodable, Equatable {
            let revision: String?; let cloudSync: Bool; let defaultLocalAvailability: String
            let automaticDownloadDeviceId: String?
        }
        struct Device: Decodable, Equatable {
            let id: String; let kind: String; let revision: String?; let localAvailability: String
        }
        let ok: Bool; let canEdit: Bool; let source: Source; let policy: Preference; let device: Device

        var canKeep: Bool {
            guard policy.cloudSync, device.localAvailability != "cloud-only" else { return false }
            if let selected = policy.automaticDownloadDeviceId { return selected == device.id }
            return device.localAvailability == "keep" || policy.defaultLocalAvailability == "keep"
        }
        var canEvict: Bool { policy.cloudSync && device.localAvailability == "cloud-only" && device.revision != nil }
    }

    private static var active: Set<ManagedFileReplica.Scope> = []
    private static let replicaStore: ManagedFileReplica = {
        let store = ManagedFileReplica(directory: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Thingtime/ManagedFileReplicas-v1", isDirectory: true))
        // No replica operation has started in this process. Remove only
        // unfinished downloads left in this store's private staging area.
        try? FileManager.default.removeItem(at: store.stagingDirectory)
        return store
    }()
    private var local: ManagedFileReplica { Self.replicaStore }
    private let lidar = LiDARUploadOutbox()
    private var operation = UUID()
    private var task: Task<Void, Never>?
    private var transport: NativeFileSession?
    private var activeRequest: String?
    private var activeScope: ManagedFileReplica.Scope?
    private static let admissions = FileReplicaAdmissionStore(directory:
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Thingtime/FileReplicaAdmissions-v1", isDirectory: true))
    private static var revokedSessions: [String: UUID] = [:]
    private enum CloudCheck { case session, file, none }
    private weak var shareSheet: UIViewController?
    private var shareGeneration = UUID()
    private var observer: NSObjectProtocol?

    init() {
        observer = NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification,
            object: nil, queue: .main) { [weak self] _ in Task { @MainActor in self?.suspend() } }
    }
    deinit { if let observer { NotificationCenter.default.removeObserver(observer) }; task?.cancel() }

    func suspend() {
        operation = UUID()
        clearOperation()
        shareGeneration = UUID()
        shareSheet?.dismiss(animated: false); shareSheet = nil
    }

    private func clearOperation() {
        task?.cancel(); task = nil
        transport?.close(); transport = nil
        activeRequest = nil; activeScope = nil
    }

    func handle(_ body: [String: Any], webView: WKWebView, root: URL,
                currentRoot: @escaping () -> URL?, cookies: @escaping ([HTTPCookie], URL) -> [HTTPCookie],
                verifyDevice: @escaping VerifyDevice, reply: @escaping (String, Any) -> Void) {
        guard let payload = body["payload"] as? [String: Any],
              let request = payload["requestId"] as? String, UUID(uuidString: request) != nil,
              let action = payload["action"] as? String, ["status", "keep", "evict", "open", "cancel"].contains(action),
              let owner = payload["ownerId"] as? String, let identity = try? FileSyncOwnerScope(ownerId: owner, url: root),
              payload["origin"] as? String == identity.origin.absoluteString,
              payload["dataPlane"] as? String == "home", let device = payload["deviceId"] as? String,
              let thing = payload["thingId"] as? String,
              let scope = try? ManagedFileReplica.Scope(owner: identity, dataPlane: "home", deviceId: device, thingId: thing)
        else { return }
        if action == "cancel" {
            if activeRequest == request, activeScope == scope { suspend() }
            return
        }
        let base: [String: Any] = ["requestId": request, "ownerId": owner, "origin": identity.origin.absoluteString,
                                   "dataPlane": "home", "deviceId": device, "thingId": thing]
        func respond(_ state: String, file: NativeCloudFile? = nil, retained: Bool = false, error: String? = nil) {
            var result = base
            result["state"] = state; result["fileRevision"] = file?.revision
            if state == "present" || state == "saved" { result["bytes"] = file?.content.size }
            if retained { result["retainedOriginal"] = true }
            if let error { result["error"] = error }
            reply("file-replica-result", result)
        }
        guard task == nil, Self.active.insert(scope).inserted else {
            respond("error", error: "A local file operation is already running."); return
        }
        let attempt = UUID(); operation = attempt
        activeScope = scope; activeRequest = request
        let check = { [weak self, weak webView] in
            try Task.checkCancellation()
            guard self?.operation == attempt, currentRoot() == root, let current = webView?.url,
                  LopuVoiceContract.sameOrigin(current, root), UIApplication.shared.applicationState == .active
            else { throw CancellationError() }
        }
        let session = NativeFileSession(scope: identity, cookieStore: webView.configuration.websiteDataStore.httpCookieStore,
            cookies: cookies, check: check, invalidated: { [weak self] in
                if self?.operation == attempt { self?.suspend() }
            })
        transport = session
        task = Task { [weak self] in
            defer { Self.active.remove(scope); if self?.operation == attempt { self?.clearOperation() } }
            guard let self else { return }
            var cookie: FileReplicaCookieBinding?
            var generation: UUID?
            var cloudCheck = CloudCheck.session
            do {
                let current = try await Self.currentCookie(webView, scope: identity, cookies: cookies)
                try check()
                cookie = current
                let sessionKey = Self.admissions.sessionKey(scope, current)
                let startingGeneration = Self.revokedSessions[sessionKey]
                generation = startingGeneration
                let checkAdmission = {
                    try check()
                    guard Self.revokedSessions[sessionKey] == startingGeneration else {
                        throw MobileFolderStore.Failure.unavailable
                    }
                }
                let saveAdmission = { (file: NativeCloudFile) in
                    let live = try await Self.currentCookie(webView, scope: identity, cookies: cookies)
                    guard current.matches(live, now: Date()), try await session.currentSessionDigest() == live.digest else {
                        throw MobileDevicePairing.Failure.identity
                    }
                    try checkAdmission()
                    try Self.checkLocalPairing(scope)
                    try Self.admissions.save(scope, file: file, cookie: live)
                }

                try await session.open()
                try await session.require([("api.auth-me", [1, 1, 0]), ("api.files", [1, 0, 0]),
                    ("api.attachment-content", [1, 14, 0]), ("api.things-storage-policy", [1, 0, 0])])
                try await verifyDevice(identity, device, check)
                cloudCheck = .file
                let path = "/api/v1/things/storage-policy?id=\(thing)&deviceId=\(device)"
                let policy = try await Self.readPolicy(session, path: path, scope: scope)
                if action == "keep" || action == "evict" {
                    guard payload["sourceRevision"] as? String == policy.source.revision,
                          Self.matches(payload["policyRevision"], policy.policy.revision),
                          Self.matches(payload["deviceRevision"], policy.device.revision),
                          action == "keep" ? policy.canKeep : policy.canEvict
                    else { throw MobileFolderStore.Failure.changed }
                }
                let file = try await Self.readFile(session, id: thing, revision: policy.source.revision)
                if action == "open", let expected = payload["sourceRevision"] as? String, expected != file.revision {
                    throw MobileFolderStore.Failure.changed
                }
                let nativeRequest = FileVersionExport.Request(name: "bytes", content: file.content)
                try nativeRequest.validate()
                let managed = local.localURL(scope, content: file.content)
                let original = try lidar.replicaOriginal(for: file, scope: identity)
                let urls = [managed] + [original.url].compactMap { $0 }
                try check()
                cloudCheck = .none
                if action == "open" {
                    try await showLocalCopy(file, scope: scope, cookie: current, webView: webView, root: root,
                                            currentRoot: currentRoot, cookies: cookies, check: checkAdmission) {
                        try await saveAdmission(file)
                    }
                    respond("opened", file: file)
                    return
                }
                if action == "status" {
                    let present = try urls.contains { try ManagedFileReplica.hasCopy(at: $0, size: file.content.size) }
                    if present { try await saveAdmission(file) }
                    else { try Self.admissions.remove(scope, cookie: current) }
                    respond(present ? "present" : "missing", file: file, retained: original.retainedOriginal)
                    return
                }

                let worker = Task.detached(priority: .utility) {
                    try urls.compactMap { try ManagedFileReplica.verify(at: $0, request: nativeRequest) }
                }
                let copies = try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
                try check()
                let confirm = {
                    cloudCheck = .session
                    try await verifyDevice(identity, device, check)
                    cloudCheck = .file
                    try await file.check(using: session)
                    let proof = try await session.read("/api/v1/attachments/content?id=\(file.content.attachmentId)&fingerprint=1",
                                                       limit: 512 * 1024) { response in
                        guard response.statusCode == 200 else { throw MobileFolderStore.Failure.unavailable }
                    }
                    try nativeRequest.matchFingerprint(proof)
                    guard try await Self.readPolicy(session, path: path, scope: scope) == policy else {
                        throw MobileFolderStore.Failure.changed
                    }
                    try checkAdmission()
                    cloudCheck = .none
                }
                if action == "evict" {
                    try await confirm()
                    for copy in copies { try ManagedFileReplica.evict(copy, check: check) }
                    try Self.admissions.remove(scope, cookie: current)
                    respond("evicted", file: file, retained: original.retainedOriginal)
                } else if !copies.isEmpty {
                    try await confirm()
                    try await saveAdmission(file)
                    respond("saved", file: file, retained: original.retainedOriginal)
                } else {
                    let staging = local.stagingDirectory
                    let download = Task.detached(priority: .utility) {
                        try await FileVersionExport.Prepared.download(nativeRequest, privateDirectory: staging) { offset, length in
                            try await session.read(nativeRequest.rangePath(offset: offset, length: length), limit: length) {
                                try nativeRequest.validateRange($0, offset: offset, length: length)
                            }
                        }
                    }
                    cloudCheck = .file
                    let prepared = try await withTaskCancellationHandler(operation: { try await download.value }, onCancel: { download.cancel() })
                    try await confirm()
                    _ = try await session.currentSessionDigest()
                    try local.publish(prepared, scope: scope, check: checkAdmission)
                    try await saveAdmission(file)
                    respond("saved", file: file, retained: original.retainedOriginal)
                }
            } catch let error as URLError where (action == "open" || action == "status") &&
                cloudCheck != .none {
                do {
                    let live = try await Self.currentCookie(webView, scope: identity, cookies: cookies)
                    try check()
                    guard let cookie, cookie.matches(live, now: Date()),
                          Self.revokedSessions[Self.admissions.sessionKey(scope, live)] == generation else {
                        throw MobileDevicePairing.Failure.identity
                    }
                    try Self.checkLocalPairing(scope)
                    let admission = try Self.admissions.recoverOffline(scope, cookie: live,
                        expectedRevision: payload["sourceRevision"] as? String, after: error)
                    let file = admission.file
                    if action == "open" {
                        try await showLocalCopy(file, scope: scope, cookie: live, webView: webView, root: root,
                                                currentRoot: currentRoot, cookies: cookies, check: check) {}
                        respond("opened", file: file)
                    } else {
                        let original = try lidar.replicaOriginal(for: file, scope: identity)
                        let paths = [local.localURL(scope, content: file.content)] + [original.url].compactMap { $0 }
                        let present = try paths.contains { try ManagedFileReplica.hasCopy(at: $0, size: file.content.size) }
                        respond(present ? "present" : "missing", file: file, retained: original.retainedOriginal)
                    }
                } catch {
                    if self.operation == attempt {
                        respond("error", error: "Reconnect to verify the current account before opening this local copy.")
                    }
                }
            } catch {
                // Cancellation and transport failures do not convey revocation.
                // A non-transport refusal during verification clears the exact
                // cookie's session or selected file before an offline retry.
                if let cookie, !(error is CancellationError), !(error is URLError) {
                    switch cloudCheck {
                    case .session:
                        Self.revokedSessions[Self.admissions.sessionKey(scope, cookie)] = UUID()
                        try? Self.admissions.revoke(scope, cookie: cookie)
                    case .file: try? Self.admissions.remove(scope, cookie: cookie)
                    case .none: break
                    }
                }
                if self.operation == attempt {
                    respond("error", error: "The file, device, or storage choice could not be verified. Check the current state and retry.")
                }
            }
        }
    }

    private func showLocalCopy(_ file: NativeCloudFile, scope: ManagedFileReplica.Scope, cookie: FileReplicaCookieBinding,
                               webView: WKWebView, root: URL, currentRoot: @escaping () -> URL?,
                               cookies: @escaping ([HTTPCookie], URL) -> [HTTPCookie], check: () throws -> Void,
                               prepareAdmission: () async throws -> Void) async throws {
        let request = FileVersionExport.Request(name: "bytes", content: file.content)
        let original = try lidar.replicaOriginal(for: file, scope: scope.owner)
        let paths = [local.localURL(scope, content: file.content)] + [original.url].compactMap { $0 }
        let worker = Task.detached(priority: .utility) {
            for path in paths {
                if let verified = try ManagedFileReplica.verify(at: path, request: request) { return verified }
            }
            throw MobileFolderStore.Failure.unavailable
        }
        let verified = try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
        try await prepareAdmission()
        let live = try await Self.currentCookie(webView, scope: scope.owner, cookies: cookies)
        guard cookie.matches(live, now: Date()),
              let host = webView.window?.rootViewController, host.presentedViewController == nil
        else { throw MobileFolderStore.Failure.unavailable }
        try check()
        try Self.checkLocalPairing(scope)
        let admission = try Self.admissions.load(scope, cookie: live, expectedRevision: file.revision)
        guard admission.file == file else { throw MobileFolderStore.Failure.changed }
        let presentation = UUID(); shareGeneration = presentation
        let item = NSItemProvider()
        item.suggestedName = file.name
        let ext = (file.name as NSString).pathExtension
        let type = UTType(filenameExtension: ext) ?? .data
        item.registerFileRepresentation(forTypeIdentifier: type.identifier, visibility: .all) { [weak self, weak webView] done in
            Task { @MainActor in
                do {
                    guard let self, let webView, self.shareGeneration == presentation else { throw CancellationError() }
                    let currentCookie = try await Self.currentCookie(webView, scope: scope.owner, cookies: cookies)
                    guard currentRoot() == root, let current = webView.url, LopuVoiceContract.sameOrigin(current, root),
                          self.shareGeneration == presentation, cookie.matches(currentCookie, now: Date()),
                          try Self.admissions.load(scope, cookie: currentCookie, expectedRevision: file.revision).file == file
                    else { throw CancellationError() }
                    try Self.checkLocalPairing(scope)
                    done(try ManagedFileReplica.checkedURL(verified), false, nil)
                } catch { done(nil, false, error) }
            }
            return nil
        }
        let sheet = UIActivityViewController(activityItemsConfiguration: UIActivityItemsConfiguration(itemProviders: [item]))
        sheet.popoverPresentationController?.sourceView = host.view
        sheet.popoverPresentationController?.sourceRect = CGRect(x: host.view.bounds.midX, y: host.view.bounds.midY, width: 1, height: 1)
        shareSheet = sheet
        host.present(sheet, animated: true)
    }

    private static func checkLocalPairing(_ scope: ManagedFileReplica.Scope) throws {
        guard let pairing = try MobileDeviceKeychain.load(scope.owner),
              pairing.scope == scope.owner, pairing.deviceId == scope.deviceId, !pairing.revoked
        else { throw MobileDevicePairing.Failure.revoked }
    }

    private static func currentCookie(_ webView: WKWebView, scope: FileSyncOwnerScope,
                                      cookies: ([HTTPCookie], URL) -> [HTTPCookie]) async throws -> FileReplicaCookieBinding {
        let all = await webView.configuration.websiteDataStore.httpCookieStore.allCookies()
        let matching = cookies(all, scope.origin.appendingPathComponent("api/v1/auth/me"))
        let header = try NativeFileSession.authenticationCookie(matching)
        return FileReplicaCookieBinding(header: header, expiresAt: matching.first { $0.name == "tt_auth" }?.expiresDate)
    }

    private static func matches(_ value: Any?, _ revision: String?) -> Bool {
        if let revision { return value as? String == revision }
        return value is NSNull
    }

    private static func readPolicy(_ session: NativeFileSession, path: String, scope: ManagedFileReplica.Scope) async throws -> Policy {
        let data = try JSONSerialization.data(withJSONObject: try await session.json(path))
        let result = try JSONDecoder().decode(Policy.self, from: data)
        guard result.ok, result.canEdit, result.source.id == scope.thingId,
              ManagedFileReplica.Scope.validIdentifier(result.source.revision),
              result.device.id == scope.deviceId, result.device.kind == "paired",
              ["inherit", "keep", "cloud-only"].contains(result.device.localAvailability),
              ["inherit", "keep", "on-demand"].contains(result.policy.defaultLocalAvailability)
        else { throw MobileFolderStore.Failure.changed }
        return result
    }

    private static func readFile(_ session: NativeFileSession, id: String, revision: String) async throws -> NativeCloudFile {
        let response = try await session.json("/api/v1/files?id=\(id)")
        guard response["ok"] as? Bool == true, let raw = response["file"] as? [String: Any] else {
            throw MobileFolderStore.Failure.changed
        }
        let file = try JSONDecoder().decode(NativeCloudFile.self, from: JSONSerialization.data(withJSONObject: raw))
        guard file.id == id, file.revision == revision, !file.trashed else { throw MobileFolderStore.Failure.changed }
        return file
    }
}
