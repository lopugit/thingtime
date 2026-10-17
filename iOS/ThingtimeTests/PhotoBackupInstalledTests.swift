import XCTest
import WebKit
import UIKit
import Photos
import CryptoKit
import AppleFileSync
@testable import Thingtime

@MainActor
final class PhotoBackupInstalledTests: XCTestCase {
    private func webView(in view: UIView) -> WKWebView? {
        if let web = view as? WKWebView { return web }
        return view.subviews.lazy.compactMap { self.webView(in: $0) }.first
    }
    private func awaitTrue(_ web: WKWebView, _ expression: String, seconds: Int = 300) async throws {
        let deadline = Date().addingTimeInterval(TimeInterval(seconds))
        var tick = 0
        while Date() < deadline {
            tick += 1
            if tick > 0 && tick % 40 == 0 {
                let status = try? await web.evaluateJavaScript("JSON.stringify({url:location.href,buttons:Array.from(document.querySelectorAll('button')).filter(e=>['Upload now','Stop transfer','Choose folder','Check connection','Connecting…'].includes(e.textContent.trim())).map(e=>({text:e.textContent,disabled:e.disabled})),status:Array.from(document.querySelectorAll('[role=status],[role=alert]')).map(e=>e.textContent)})")
                print("IOS_PHOTO_WAIT: \(expression) ATTACHED: \(web.window != nil) STATUS: \(status as? String ?? "unavailable")")
            }
            if (try? await web.evaluateJavaScript(expression)) as? Bool == true { return }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        throw NSError(domain: "PhotoBackupAcceptance", code: 1, userInfo: [NSLocalizedDescriptionKey: "Timed out waiting for installed photo backup interaction"])
    }
    func testOriginalPhotosBackup() async throws {
        let env = ProcessInfo.processInfo.environment
        guard env["THINGTIME_PHOTO_BACKUP_TEST"] == "1", let base = env["THINGTIME_DEVICE_TEST_ORIGIN"],
              let origin = URL(string: base), origin.scheme == "http", ["localhost", "127.0.0.1"].contains(origin.host ?? ""),
              let username = env["THINGTIME_DEVICE_TEST_USERNAME"], let password = env["THINGTIME_DEVICE_TEST_PASSWORD"] else {
            throw XCTSkip("Run opt-in installed photo backup acceptance with a disposable loopback account")
        }
        XCTAssertEqual(Bundle.main.object(forInfoDictionaryKey: "ThingtimeWebURL") as? String, base)
        let configuration = URLSessionConfiguration.ephemeral, session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        func api(_ path: String, body: [String: Any]? = nil) async throws -> [String: Any] {
            var request = URLRequest(url: URL(string: path, relativeTo: origin)!.absoluteURL)
            request.setValue(base, forHTTPHeaderField: "Origin"); request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            if let body { request.httpMethod = "POST"; request.httpBody = try JSONSerialization.data(withJSONObject: body) }
            let (data, response) = try await session.data(for: request)
            guard (200..<300).contains((response as? HTTPURLResponse)?.statusCode ?? 0),
                  let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw NSError(domain: "PhotoBackupAcceptance", code: 2, userInfo: [NSLocalizedDescriptionKey: "Fixture API refused \(path.components(separatedBy: "?")[0]) (HTTP \((response as? HTTPURLResponse)?.statusCode ?? 0))"])
            }
            return result
        }
        _ = try await api("/api/v1/login", body: ["username": username, "password": password])
        let identity = try await api("/api/v1/auth/me"), owner = try XCTUnwrap((identity["user"] as? [String: Any])?["id"] as? String)
        var found: WKWebView?
        for _ in 0..<600 {
            found = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
                .filter(\.isKeyWindow).compactMap { self.webView(in: $0) }.first
            if let web = found, !web.isLoading, (try? await web.evaluateJavaScript("location.origin")) as? String == base { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        let web = try XCTUnwrap(found)
        let existing = try await web.callAsyncJavaScript("return await (await fetch('/api/v1/auth/me')).json()", arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
        if let current = (existing?["user"] as? [String: Any])?["id"] as? String, current != owner { throw XCTSkip("Preserve the simulator's other signed-in account") }
        let cookies = configuration.httpCookieStorage?.cookies(for: origin) ?? []; XCTAssertFalse(cookies.isEmpty)
        for cookie in cookies { await web.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) }

        let scope = try FileSyncOwnerScope(ownerId: owner, url: origin), store = MobileFolderStore()
        let prior = try store.list(scope).first { $0.sourceKind == "photos" }
        guard prior == nil || prior?.id == env["THINGTIME_PHOTO_RESUME_GRANT"] else { throw XCTSkip("Preserve an existing photo grant unless its exact disposable-test ID is supplied") }
        web.configuration.userContentController.addUserScript(WKUserScript(source: "window.__nativeUploadStats={parts:0,bytes:0,legacy:0};window.__photoScans=0;const photoOriginalPost=window.thingtimeNativeBridge.postMessage;window.thingtimeNativeBridge.postMessage=function(m){if(m.type==='mobile-files'){if(m.payload?.action==='scan')window.__photoScans++;if(m.payload?.action==='upload-part'){window.__nativeUploadStats.parts++;window.__nativeUploadStats.bytes+=m.payload.upload.length;}if(m.payload?.action==='read'&&m.payload.length>1)window.__nativeUploadStats.legacy++;}return photoOriginalPost.call(this,m)}", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web.load(URLRequest(url: origin.appendingPathComponent("things")))
        for _ in 0..<100 where UIApplication.shared.applicationState != .active { try await Task.sleep(nanoseconds: 100_000_000) }
        try await awaitTrue(web, "Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Add this device'||b.textContent.trim()==='Choose folder')")
        _ = try await web.evaluateJavaScript("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Add this device')?.click()")
        try await awaitTrue(web, "Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Choose folder'&&!b.disabled)")
        if prior == nil { _ = try await web.evaluateJavaScript("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Choose folder').click()") }
        print("IOS_PHOTO_READY: In Things choose folder, Photo library (backup), then choose photo access. Use full access in this disposable simulator.")
        var selected: MobileFolderStore.Grant?
        for _ in 0..<1200 {
            selected = try store.list(scope).first { $0.sourceKind == "photos" }
            if selected != nil { break }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        let grant = try XCTUnwrap(selected), provider = SystemPhotoResources()
        XCTAssertEqual(provider.access(), "full")
        guard try provider.inventory().count < 20 else { throw XCTSkip("Use a small disposable simulator library") }
        var owned: [String] = [], cloud: String?, connection: String?
        // A deterministic, incompressible original spans two canonical parts.
        let width = 2048, height = 1536
        var pixels = [UInt8](repeating: 0, count: width * height * 3), seed: UInt32 = 0x12345678
        for index in pixels.indices {
            seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5
            pixels[index] = UInt8(truncatingIfNeeded: seed)
        }
        let providerData = try XCTUnwrap(CGDataProvider(data: Data(pixels) as CFData))
        let image = try XCTUnwrap(CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 24,
            bytesPerRow: width * 3, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGBitmapInfo(rawValue: 0),
            provider: providerData, decode: nil, shouldInterpolate: false, intent: .defaultIntent))
        let bytes = try XCTUnwrap(UIImage(cgImage: image).pngData())
        XCTAssertGreaterThan(bytes.count, 8 * 1024 * 1024)
        if prior != nil {
            // Explicit interrupted-fixture recovery: match both original name and
            // exact synthetic PNG bytes before claiming an asset for cleanup.
            for resource in try provider.inventory() where resource.name == "thingtime-acceptance.png" {
                let temp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
                defer { try? FileManager.default.removeItem(at: temp) }
                let worker = Task.detached { try provider.write(resource, to: temp); return try Data(contentsOf: temp) }
                if try await worker.value == bytes { owned.append(resource.asset) }
            }
        }
        func createPhoto() async throws -> String {
            var identifier: String?
            try await PHPhotoLibrary.shared().performChanges {
                let request = PHAssetCreationRequest.forAsset(), options = PHAssetResourceCreationOptions()
                options.originalFilename = "thingtime-acceptance.png"
                request.addResource(with: .photo, data: bytes, options: options); identifier = request.placeholderForCreatedAsset?.localIdentifier
            }
            let id = try XCTUnwrap(identifier); owned.append(id); return id
        }
        func cloudNodes() async throws -> [[String: Any]] {
            let result = try await api("/api/v1/files?rootId=" + cloud!)
            return try XCTUnwrap((result["inventory"] as? [String: Any])?["nodes"] as? [[String: Any]])
        }
        func verifyBytes(_ file: [String: Any]) async throws {
            let content = try XCTUnwrap(file["content"] as? [String: Any]), id = try XCTUnwrap(content["attachmentId"] as? String)
            let (download, response) = try await session.data(from: origin.appendingPathComponent("api/v1/attachments/content").appending(queryItems: [URLQueryItem(name: "id", value: id), URLQueryItem(name: "cache", value: "bytes")]))
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200); XCTAssertEqual(SHA256.hash(data: download), SHA256.hash(data: bytes))
        }
        let name = "iOS photo backup " + UUID().uuidString.prefix(8)
        func startAndAwaitUpload() async throws {
            for _ in 0..<100 where UIApplication.shared.applicationState != .active { try await Task.sleep(nanoseconds: 100_000_000) }
            guard UIApplication.shared.applicationState == .active else { throw CancellationError() }
            try await awaitTrue(web, "typeof window.__photoScans==='number'")
            let previous = (try await web.evaluateJavaScript("window.__photoScans")) as? Int ?? -1
            print("IOS_PHOTO_UPLOAD_READY: Starting the visible Upload now control for \(name).")
            let quoted = String(data: try JSONSerialization.data(withJSONObject: [name]), encoding: .utf8)!
            let card = "Array.from(document.querySelectorAll('p')).find(e=>e.textContent===(" + quoted + ")[0])?.parentElement?.parentElement"
            try await awaitTrue(web, "Array.from((" + card + ")?.querySelectorAll('button')||[]).some(b=>b.textContent.trim()==='Upload now'&&!b.disabled)")
            _ = try await web.evaluateJavaScript("(" + card + ").scrollIntoView({block:'center'})")
            _ = try await web.evaluateJavaScript("Array.from((" + card + ").querySelectorAll('button')).find(b=>b.textContent.trim()==='Upload now'&&!b.disabled).click()")
            try await awaitTrue(web, "window.__photoScans>" + String(previous))
            try await awaitTrue(web, "(" + card + ")?.querySelector('[role=status]')?.textContent === 'Last transfer finished.'")
        }
        var failure: Error?
        do {
            let firstID = try await createPhoto()
            let resources = try provider.inventory(), first = try XCTUnwrap(resources.first { $0.asset == firstID })
            let excluded = resources.filter { $0.asset != firstID }.map(\.path)
            let paired = try XCTUnwrap(MobileDeviceKeychain.load(scope)?.deviceId)
            let root = try await api("/api/v1/things", body: ["thingtime": ["folder"], "crystal": ["name": name]])
            cloud = try XCTUnwrap((root["thing"] as? [String: Any])?["id"] as? String)
            let config: [String: Any] = ["configurationVersion": 1, "name": name, "deviceId": paired, "localRootId": grant.id, "sourceKind": "photos", "remoteFolderId": cloud!, "mode": "backup", "paused": false, "propagateDeletes": false, "network": "any", "chargingOnly": false, "excludedPaths": excluded]
            let saved = try await api("/api/v1/things", body: ["thingtime": ["file-sync"], "crystal": config])
            connection = try XCTUnwrap((saved["thing"] as? [String: Any])?["id"] as? String)
            web.reload(); try await startAndAwaitUpload()
            let firstNodes = try await cloudNodes()
            let firstNode = try XCTUnwrap(firstNodes.first { $0["path"] as? String == first.path }), firstFile = try XCTUnwrap(firstNode["file"] as? [String: Any])
            try await verifyBytes(firstFile); print("IOS_PHOTO_FIRST_HASH_PASS")
            _ = try await createPhoto()
            try await PHPhotoLibrary.shared().performChanges { PHAssetChangeRequest.deleteAssets(PHAsset.fetchAssets(withLocalIdentifiers: [firstID], options: nil)) }
            owned.removeAll { $0 == firstID }
            try await startAndAwaitUpload()
            let nodes = try await cloudNodes(); XCTAssertEqual(nodes.count, 2)
            for node in nodes { try await verifyBytes(try XCTUnwrap(node["file"] as? [String: Any])) }
            let retained = try XCTUnwrap(nodes.first { $0["path"] as? String == first.path }?["file"] as? [String: Any])
            XCTAssertEqual(retained["revision"] as? String, firstFile["revision"] as? String)
            let observedStats = try await web.evaluateJavaScript("window.__nativeUploadStats")
            let stats = try XCTUnwrap(observedStats as? [String: Int])
            XCTAssertGreaterThanOrEqual(stats["parts"] ?? 0, 4)
            XCTAssertEqual(stats["bytes"], bytes.count * 2)
            XCTAssertEqual(stats["legacy"], 0)
            print("IOS_NATIVE_UPLOAD_PASS: parts=\(stats["parts"] ?? 0) bytes=\(stats["bytes"] ?? 0) legacy=\(stats["legacy"] ?? -1)")
            let shot = UIGraphicsImageRenderer(bounds: web.bounds).image { _ in web.drawHierarchy(in: web.bounds, afterScreenUpdates: true) }
            if let png = shot.pngData() { try png.write(to: FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("photo-backup-complete.png")) }
            print("IOS_PHOTO_BACKUP_PASS: Original PNG download hashes, new photo discovery and saved cloud copy after device deletion.")
        } catch { failure = error }
        if cloud != nil {
            for node in (try? await cloudNodes()) ?? [] {
                if let file = node["file"] as? [String: Any], let content = file["content"] as? [String: Any] {
                    _ = try await api("/api/v1/files", body: ["id": file["id"]!, "operationId": UUID().uuidString.lowercased(), "expectedRevision": file["revision"]!, "name": file["name"]!, "folderId": file["folderId"]!, "attachmentId": content["attachmentId"]!, "contentVersion": content["version"]!, "trashed": true])
                }
            }
        }
        // Recoverable cloud/device deletion only; remove the test grant without touching library originals.
        for id in [connection, cloud].compactMap({ $0 }) {
            var request = URLRequest(url: origin.appendingPathComponent("api/v1/things").appending(queryItems: [URLQueryItem(name: "id", value: id)])); request.httpMethod = "DELETE"; request.setValue(base, forHTTPHeaderField: "Origin")
            let (_, response) = try await session.data(for: request); XCTAssertTrue((200..<300).contains((response as? HTTPURLResponse)?.statusCode ?? 0))
        }
        if !owned.isEmpty { try await PHPhotoLibrary.shared().performChanges { PHAssetChangeRequest.deleteAssets(PHAsset.fetchAssets(withLocalIdentifiers: owned, options: nil)) } }
        try store.remove(scope, id: grant.id)
        if let failure { throw failure }
    }
}
