import AppleFileSync
import ARKit
import SwiftUI
import UIKit
import WebKit

/// Foreground, origin- and account-bound scanner controller. Large scan bytes
/// never cross JavaScript: the native multipart client publishes the local TAR.
@MainActor
final class LiDARBridge {
    static let version = "1.0.0"
    static let script = WKUserScript(source: "window.thingtimeNativeBridge.lidarVersion = '1.0.0';",
                                    injectionTime: .atDocumentStart, forMainFrameOnly: true)
    private let outbox = LiDARUploadOutbox()
    private var generation = UUID()
    private var task: Task<Void, Never>?
    private var session: NativeFileSession?
    private var scope: FileSyncOwnerScope?
    private var activeID: UUID?
    private var startRequest: String?
    private var statusRequest: String?
    private var snapshot: [String: Any]?
    private var reply: ((String, Any) -> Void)?
    private weak var scanner: UIViewController?
    private weak var notice: UIViewController?
    private weak var shareSheet: UIViewController?
    private weak var webView: WKWebView?
    private var nativePresentation = false
    private var accountLabel: String?

    static var supported: Bool { ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) }

    func invalidate() {
        generation = UUID(); task?.cancel(); task = nil
        session?.close(); session = nil
        scanner?.dismiss(animated: false); scanner = nil
        notice?.dismiss(animated: false); notice = nil
        shareSheet?.dismiss(animated: false); shareSheet = nil
        scope = nil; activeID = nil; startRequest = nil; statusRequest = nil
        snapshot = nil; reply = nil
    }

    func handle(_ body: [String: Any], webView: WKWebView, root: URL,
                currentRoot: @escaping () -> URL?, cookies: @escaping ([HTTPCookie], URL) -> [HTTPCookie],
                reply: @escaping (String, Any) -> Void) {
        guard let payload = body["payload"] as? [String: Any],
              let request = payload["requestId"] as? String, UUID(uuidString: request) != nil,
              let owner = payload["ownerId"] as? String,
              let origin = payload["origin"] as? String, let requestedOrigin = URL(string: origin),
              LopuVoiceContract.sameOrigin(requestedOrigin, root),
              let action = payload["action"] as? String,
              ["status", "start", "retry", "suspend"].contains(action),
              let requestedScope = try? FileSyncOwnerScope(ownerId: owner, url: root) else { return }
        if action == "suspend" {
            if scope == requestedScope { invalidate() }
            reply("lidar-scan-result", ["requestId": request, "ownerId": owner,
                "origin": requestedScope.origin.absoluteString, "state": "cancelled", "supported": Self.supported])
            return
        }
        if let scope, scope != requestedScope { invalidate() }
        self.webView = webView; self.reply = reply
        if action == "status", scope == requestedScope, session != nil {
            statusRequest = request
            if let snapshot { emit(snapshot) }
            return
        }
        if task != nil || scanner != nil {
            reply("lidar-scan-result", ["requestId": request, "ownerId": owner,
                "origin": requestedScope.origin.absoluteString, "state": "error", "supported": Self.supported,
                "error": "A scan or save is already in progress."])
            return
        }
        if action == "retry", (payload["scanId"] as? String).flatMap(UUID.init(uuidString:)) == nil {
            reply("lidar-scan-result", ["requestId": request, "ownerId": owner,
                "origin": requestedScope.origin.absoluteString, "state": "error", "supported": Self.supported,
                "error": "Select the exact saved scan to retry."])
            return
        }
        nativePresentation = false
        begin(scope: requestedScope, request: request, action: action,
              retryID: (payload["scanId"] as? String).flatMap(UUID.init(uuidString:)),
              webView: webView, root: root, currentRoot: currentRoot, cookies: cookies)
    }

    /// Drawer and deep links use the current WebView's live identity. No URL or
    /// caller-supplied account can choose the destination of a local capture.
    func openFromNative(webView: WKWebView, root: URL, currentRoot: @escaping () -> URL?,
                        cookies: @escaping ([HTTPCookie], URL) -> [HTTPCookie],
                        reply: @escaping (String, Any) -> Void) {
        guard task == nil, scanner == nil else { return }
        self.webView = webView; self.reply = reply; nativePresentation = true
        guard Self.supported else {
            showMessage("LiDAR unavailable", "LiDAR scanning requires a supported iPhone Pro or iPad Pro.")
            return
        }
        let operation = UUID(); generation = operation
        task = Task { [weak self, weak webView] in
            guard let self, let webView else { return }
            do {
                guard let origin = URLComponents(url: root, resolvingAgainstBaseURL: false),
                      let scheme = origin.scheme, let host = origin.host else { throw CancellationError() }
                let expectedOrigin = scheme + "://" + host + (origin.port.map { ":\($0)" } ?? "")
                let value = try await webView.callAsyncJavaScript("""
                    if (location.origin !== expectedOrigin) throw new Error('destination');
                    const manifestResponse = await fetch('/.well-known/thingtime-capabilities.json', {redirect:'error',signal:AbortSignal.timeout(10000)});
                    const manifest = await manifestResponse.json();
                    const version = manifest.features?.['api.auth-me']?.version;
                    if (!manifestResponse.ok || manifest.origin !== expectedOrigin || manifest.schemaVersion !== 1 || !/^1\\.\\d+\\.\\d+$/.test(version ?? '')) throw new Error('capability');
                    const response = await fetch('/api/v1/auth/me', {credentials:'same-origin',redirect:'error',headers:{'X-Thingtime-Expected-Data-Plane':'home'},signal:AbortSignal.timeout(10000)});
                    const body = await response.json();
                    if (!response.ok || !body.user || body.user.accountKind !== 'user' || body.user.temporary || body.user.isCharacter) throw new Error('identity');
                    return body.user.id;
                    """, arguments: ["expectedOrigin": expectedOrigin], in: nil, contentWorld: .page)
                guard generation == operation, currentRoot() == root,
                      let current = webView.url, LopuVoiceContract.sameOrigin(current, root),
                      let owner = value as? String else { throw CancellationError() }
                task = nil
                let target = try FileSyncOwnerScope(ownerId: owner, url: root)
                begin(scope: target, request: UUID().uuidString, action: "start", retryID: nil,
                      webView: webView, root: root, currentRoot: currentRoot, cookies: cookies)
            } catch {
                guard generation == operation else { return }
                task = nil
                showMessage("Sign in to save scans", "Sign in to your Thingtime Home account at the selected destination, then open Scan again. Your existing local scans are kept.")
            }
        }
    }

    private func begin(scope target: FileSyncOwnerScope, request: String, action: String, retryID: UUID?,
                       webView: WKWebView, root: URL, currentRoot: @escaping () -> URL?,
                       cookies: @escaping ([HTTPCookie], URL) -> [HTTPCookie]) {
        session?.close(); session = nil
        snapshot = nil
        scope = target; startRequest = action == "status" ? nil : request
        statusRequest = action == "status" ? request : nil
        let operation = UUID(); generation = operation
        let check = { [weak self, weak webView] in
            try Task.checkCancellation()
            guard self?.generation == operation, currentRoot() == root,
                  let current = webView?.url, LopuVoiceContract.sameOrigin(current, root),
                  UIApplication.shared.applicationState != .background else { throw CancellationError() }
        }
        let transport = NativeFileSession(scope: target, cookieStore: webView.configuration.websiteDataStore.httpCookieStore,
            cookies: cookies, check: check, invalidated: { [weak self] in
                guard self?.generation == operation else { return }; self?.invalidate()
            })
        session = transport
        task = Task { [weak self] in
            guard let self else { return }
            do {
                try await transport.open(); try await transport.require([("api.auth-me", [1, 0, 0])]); try check()
                let identity = try await transport.json("/api/v1/auth/me")
                try check()
                let user = identity["user"] as? [String: Any]
                guard user?["isCharacter"] as? Bool != true else { throw MobileDevicePairing.Failure.identity }
                let name = (user?["username"] as? String) ?? (user?["displayName"] as? String) ?? target.ownerId
                accountLabel = name + " · " + (target.origin.host ?? target.origin.absoluteString)
                if action == "status" || action == "retry" {
                    let entries = try outbox.entries(scope: target)
                    if action == "retry", !entries.contains(where: { $0.id == retryID }) {
                        task = nil; emit(["state": "error", "error": "This scan is not available in the selected account."])
                        return
                    }
                    let pending = entries.filter { $0.receipt == nil && (retryID == nil || $0.id == retryID) }
                    var pendingID: UUID?
                    for candidate in pending {
                        let capture = try await outbox.recover(id: candidate.id, scope: target)
                        try check()
                        if capture != nil { pendingID = candidate.id; break }
                    }
                    task = nil
                    if let pendingID {
                        if action == "retry" {
                            save(id: pendingID, scope: target, transport: transport, operation: operation, check: check)
                        } else {
                            emit(["state": "pending", "scanId": pendingID.uuidString.lowercased(),
                                  "error": "Saved on this device. Retry saving this scan to your Things."])
                        }
                    } else if let retryID, let saved = entries.first(where: { $0.id == retryID })?.receipt {
                        emit(["state": "saved", "scanId": retryID.uuidString.lowercased(), "fileThingId": saved.fileThingId])
                    } else if let latest = entries.last(where: { $0.receipt != nil }), let receipt = latest.receipt {
                        emit(["state": "saved", "scanId": latest.id.uuidString.lowercased(), "fileThingId": receipt.fileThingId])
                    } else { emit(["state": "idle"]) }
                    return
                }
                guard Self.supported else {
                    task = nil; emit(["state": "error", "error": "LiDAR scanning requires a supported iPhone Pro or iPad Pro."]); return
                }
                let id = UUID(uuidString: request)!
                if let existing = try outbox.entries(scope: target).first(where: { $0.id == id }), existing.capture != nil || existing.receipt != nil {
                    task = nil; save(id: id, scope: target, transport: transport, operation: operation, check: check); return
                }
                _ = try outbox.reserve(id: id, scope: target)
                try check(); task = nil; activeID = id
                present(id: id, scope: target, transport: transport, operation: operation, check: check)
            } catch {
                guard generation == operation else { return }; task = nil
                emit(["state": "error", "error": "The scanner could not verify your account or saved scan. Sign in to the selected Thingtime Home account and retry."])
                if nativePresentation { showMessage("Scanner unavailable", "Sign in to your Thingtime Home account at this destination and retry. Local scans are kept.") }
            }
        }
    }

    private func present(id: UUID, scope target: FileSyncOwnerScope, transport: NativeFileSession,
                         operation: UUID, check: @escaping () throws -> Void) {
        guard let presenter = presenter(), presenter.presentedViewController == nil else {
            emit(["state": "error", "error": "Close the open sheet and try Scan again."]); return
        }
        let view = LiDARScannerView(captureID: id, accountLabel: accountLabel, onDiscard: { [outbox] in
            try outbox.discard(id: id, scope: target)
        }, onSaved: { [weak self] capture in
            guard let self else { return }
            // Persist under the ORIGINAL reservation even after account or scene
            // cancellation. Upload authorization is checked independently below.
            do { try self.outbox.record(capture, scope: target) }
            catch {
                if self.generation == operation {
                    self.emit(["state": "pending", "scanId": id.uuidString.lowercased(), "error": "The scan is saved on this device. Its upload could not be queued; reopen Scan to retry."])
                }
                return
            }
            guard self.generation == operation else { return }
            self.scanner?.dismiss(animated: true); self.scanner = nil
            self.save(id: id, scope: target, transport: transport, operation: operation, check: check)
        }, onClose: { [weak self] in
            guard let self, self.generation == operation else { return }
            self.scanner?.dismiss(animated: true); self.scanner = nil
            if self.task == nil { self.emit(["state": "cancelled", "scanId": id.uuidString.lowercased()]) }
        })
        let controller = UIHostingController(rootView: view)
        controller.modalPresentationStyle = .fullScreen; controller.isModalInPresentation = true
        scanner = controller
        emit(["state": "capturing", "scanId": id.uuidString.lowercased()])
        presenter.present(controller, animated: true)
    }

    private func save(id: UUID, scope target: FileSyncOwnerScope, transport: NativeFileSession,
                      operation: UUID, check: @escaping () throws -> Void) {
        emit(["state": "saving", "scanId": id.uuidString.lowercased()])
        task = Task { [weak self] in
            guard let self else { return }
            do {
                let receipt = try await outbox.upload(id: id, scope: target, session: transport, check: check, progress: { [weak self] done, total in
                    guard let self, self.generation == operation, self.scope == target, (try? check()) != nil else { return }
                    self.emit(["state": "saving", "scanId": id.uuidString.lowercased(), "bytesUploaded": done, "totalBytes": total])
                })
                try check(); task = nil
                emit(["state": "saved", "scanId": id.uuidString.lowercased(), "fileThingId": receipt.fileThingId])
                if nativePresentation {
                    let capture = (try? outbox.entries(scope: target))?.first(where: { $0.id == id })?.capture
                    showMessage(capture?.isPartial == true ? "Partial scan saved" : "Scan saved",
                                capture?.isPartial == true ? (capture?.statusDetail ?? "Recording was interrupted. The captured portion is saved on this device and in your Things.") : "The original scan is saved on this device and in your private Things.",
                                fileThingId: receipt.fileThingId, archiveURL: capture?.archiveURL)
                }
            } catch {
                guard generation == operation else { return }; task = nil
                let reason = (error as? LiDARUploadOutbox.Failure)?.errorDescription
                    ?? "Cloud saving is pending; retry when connected to the same account."
                emit(["state": "pending", "scanId": id.uuidString.lowercased(), "error": "Saved on this device. " + reason])
                if nativePresentation {
                    showMessage("Scan saved on this device", reason + " Open Things in this app to retry.",
                                archiveURL: (try? outbox.entries(scope: target))?.first(where: { $0.id == id })?.capture?.archiveURL)
                }
            }
        }
    }

    private func emit(_ value: [String: Any]) {
        guard let scope else { return }
        var enriched = value
        if let id = (value["scanId"] as? String).flatMap(UUID.init(uuidString:)),
           let capture = (try? outbox.entry(id: id, scope: scope))?.capture {
            enriched["isPartial"] = capture.isPartial
            if let detail = capture.statusDetail { enriched["detail"] = detail }
        }
        let stateChanged = snapshot?["state"] as? String != enriched["state"] as? String
            || snapshot?["scanId"] as? String != enriched["scanId"] as? String
        snapshot = enriched
        for request in Set([startRequest, statusRequest].compactMap { $0 }) {
            var payload = enriched; payload["requestId"] = request; payload["ownerId"] = scope.ownerId
            payload["origin"] = scope.origin.absoluteString; payload["supported"] = Self.supported
            reply?("lidar-scan-result", payload)
        }
        if nativePresentation, stateChanged {
            reply?("lidar-scan-changed", ["ownerId": scope.ownerId, "origin": scope.origin.absoluteString])
        }
    }
    private func presenter() -> UIViewController? {
        var current = webView?.window?.rootViewController
        while let presented = current?.presentedViewController { current = presented }
        return current
    }
    private func showMessage(_ title: String, _ message: String, fileThingId: String? = nil, archiveURL: URL? = nil) {
        guard let presenter = presenter() else { return }
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        let operation = generation, target = scope
        let current = { [weak self] in
            guard let self, self.generation == operation, self.scope == target else { return false }
            if let origin = target?.origin {
                guard let url = self.webView?.url, LopuVoiceContract.sameOrigin(url, origin) else { return false }
            }
            return true
        }
        notice = alert
        if let id = fileThingId, UUID(uuidString: id) != nil, let origin = scope?.origin {
            alert.addAction(UIAlertAction(title: "View in Things", style: .default) { [weak self] _ in
                guard current() else { return }
                self?.webView?.load(URLRequest(url: origin.appendingPathComponent("thing/\(id)")))
            })
        }
        if let archiveURL {
            alert.addAction(UIAlertAction(title: "Share local archive", style: .default) { [weak self, weak alert] _ in
                guard current() else { return }
                alert?.dismiss(animated: true) {
                    guard current(), let host = self?.presenter() else { return }
                    let share = UIActivityViewController(activityItems: [archiveURL], applicationActivities: nil)
                    self?.shareSheet = share
                    share.popoverPresentationController?.sourceView = host.view
                    share.popoverPresentationController?.sourceRect = CGRect(x: host.view.bounds.midX, y: host.view.bounds.midY, width: 1, height: 1)
                    host.present(share, animated: true)
                }
            })
        }
        alert.addAction(UIAlertAction(title: "Done", style: .cancel))
        presenter.present(alert, animated: true)
    }
}
