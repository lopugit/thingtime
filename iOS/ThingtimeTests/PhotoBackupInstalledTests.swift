import XCTest
import WebKit
import UIKit
import Photos
import CryptoKit
import AppleFileSync
@testable import Thingtime

@MainActor
private final class InstalledDeferredTask: NativeDeferredUploadSystemTask {
    var expiration: (() -> Void)?
    var result: Bool?
    func complete(_ success: Bool) {
        XCTAssertNil(result, "The processing task completed more than once")
        result = success
    }
}

@MainActor
private struct InstalledDeferredScheduler: NativeDeferredUploadScheduling {
    func register(_ handle: @escaping (NativeDeferredUploadSystemTask) -> Void) -> Bool { true }
    func submit(earliest: Date, charging: Bool) throws {}
    func cancel() {}
}

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
            if tick > 0 && tick % 120 == 0 {
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
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 20
        let session = URLSession(configuration: configuration)
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
        let uiAutomation = env["THINGTIME_PHOTO_UI_AUTOMATION"] == "1"
        let deferredProof = env["THINGTIME_PHOTO_DEFERRED_TEST"] == "1"
        let orderedProof = env["THINGTIME_PHOTO_EXPECT_NEWEST"] == "1"
        let resumeReceipt = env["THINGTIME_PHOTO_REOPEN_RECEIPT"].flatMap { Data($0.utf8) }
        let uiVerified = uiAutomation && env["THINGTIME_PHOTO_PREPARE_ONLY"] != "1"
        guard prior == nil || prior?.id == env["THINGTIME_PHOTO_RESUME_GRANT"] || uiAutomation else { throw XCTSkip("Preserve existing photo grant \(prior?.id ?? "unknown") unless its exact disposable-test ID is supplied") }
        web.configuration.userContentController.addUserScript(WKUserScript(source: """
        window.__photoDocument=performance.timeOrigin;
        window.__nativeUploadStarted=null;window.__nativeUploadStats={files:0,parts:0,bytes:0,legacy:0};window.__photoScans=0;
        window.__photoDeferredHeld=false;window.__photoDeferredPaths=[];
        const testHold=\(deferredProof ? "true" : "false");
        const photoOriginalPost=window.thingtimeNativeBridge.postMessage;
        window.thingtimeNativeBridge.postMessage=function(m){
          if(m.type==='mobile-files'){
            if(['scan','scan-capture'].includes(m.payload?.action))window.__photoScans++;
            if(m.payload?.action==='defer-upload'){
              const path=m.payload.upload?.source?.path;
              if(path&&!window.__photoDeferredPaths.includes(path))window.__photoDeferredPaths.push(path);
            }
            if(m.payload?.action==='upload-file'){
              if(testHold&&!sessionStorage.getItem('tt-photo-deferred-proof-released')){window.__photoDeferredHeld=true;return;}
              window.__nativeUploadStats.files++;
            }
            if(m.payload?.action==='upload-part')throw Error('Whole-file capability fell back to bridge part uploads');
            if(m.payload?.action==='read'&&m.payload.length>1)window.__nativeUploadStats.legacy++;
          }return photoOriginalPost.call(this,m);
        };
        const received=new Map();
        window.addEventListener('thingtime:native-message',e=>{
          if(e.detail?.type==='mobile-files-started')window.__nativeUploadStarted=e.detail.payload;
          if(e.detail?.type!=='mobile-files-progress')return;
          const p=e.detail.payload, prior=received.get(p.requestId)||0;
          if(p.received>prior){window.__nativeUploadStats.parts++;window.__nativeUploadStats.bytes+=p.received-prior;received.set(p.requestId,p.received);}
        });
        """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web.load(URLRequest(url: origin.appendingPathComponent("things")))
        for _ in 0..<100 where UIApplication.shared.applicationState != .active { try await Task.sleep(nanoseconds: 100_000_000) }
        try await awaitTrue(web, "Array.from(document.querySelectorAll('button,a')).some(b=>['Device setup','Add this device','Choose folder'].includes(b.textContent.trim()))")
        if env["THINGTIME_PHOTO_PREPARE_ONLY"] == "1" {
            print("IOS_PHOTO_ACCOUNT_PREPARED: verified disposable account and selected origin; no Photos permission changed")
            return
        }
        _ = try await web.evaluateJavaScript("Array.from(document.querySelectorAll('button,a')).find(b=>b.textContent.trim()==='Device setup')?.click()")
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
        let grant = try XCTUnwrap(selected)
        print("IOS_PHOTO_NATIVE_GRANT: \(grant.id)")
        let provider = SystemPhotoResources()
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
            guard (response as? HTTPURLResponse)?.statusCode == 200, SHA256.hash(data: download) == SHA256.hash(data: bytes) else {
                throw NSError(domain: "PhotoBackupAcceptance", code: 4, userInfo: [NSLocalizedDescriptionKey: "Downloaded cloud original did not match the exact fixture bytes"])
            }
        }
        let uploadCache = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("FileUploadParts-v1")
        func retainedParts() throws -> Set<String> {
            guard FileManager.default.fileExists(atPath: uploadCache.path) else { return [] }
            return Set(try FileManager.default.contentsOfDirectory(atPath: uploadCache.path).filter { $0 != "lock" })
        }
        let retainedBefore = try retainedParts()
        var name = "iOS photo backup " + UUID().uuidString.prefix(8)
        func reloadFresh() async throws {
            let previous = (try await web.evaluateJavaScript("window.__photoDocument ?? -1")) as? Double ?? -1
            web.reload()
            try await awaitTrue(web, "typeof window.__photoDocument==='number' && window.__photoDocument!==" + String(previous))
        }
        var deferredCount = 0, deferredPartCount = 0, deferredBytes: Int64 = 0
        var deferredAttachmentIDs = Set<String>()
        var deferredExerciseRan = false
        func proveDeferredProcessing() async throws {
            try await awaitTrue(web, "window.__photoDeferredHeld===true", seconds: 300)
            let checkpoint = NativeDeferredUploadStore()
            let queued = try checkpoint.load().filter { $0.scope == scope && $0.request.authorization.id == connection && $0.armed && !$0.ready }
            XCTAssertGreaterThanOrEqual(queued.count, 2)
            guard queued.count >= 2 else { throw CancellationError() }
            if orderedProof {
                let library = try provider.inventory()
                let groups = Dictionary(grouping: library, by: \.asset).values.map { $0.sorted { $0.index < $1.index } }
                let ordered = groups.sorted { first, second in
                    let a = first[0], b = second[0]
                    let dateA = a.capturedAt ?? a.modifiedAt ?? .distantPast, dateB = b.capturedAt ?? b.modifiedAt ?? .distantPast
                    if dateA != dateB { return dateA > dateB }
                    let modifiedA = a.modifiedAt ?? .distantPast, modifiedB = b.modifiedAt ?? .distantPast
                    return modifiedA != modifiedB ? modifiedA > modifiedB : a.asset.utf8.lexicographicallyPrecedes(b.asset.utf8)
                }
                let expectedAssets = Set(ordered.prefix(4).compactMap { $0.first?.asset })
                let queuedPaths = Set(queued.map(\.request.source.path))
                let actualAssets = Set(library.filter { queuedPaths.contains($0.path) }.map(\.asset))
                XCTAssertEqual(actualAssets, expectedAssets)
                let requestValue = try await web.evaluateJavaScript("window.__photoDeferredPaths")
                let requests = try XCTUnwrap(requestValue as? [String])
                let byPath = Dictionary(uniqueKeysWithValues: library.map { ($0.path, $0.asset) })
                let actualOrder = requests.compactMap { byPath[$0] }.reduce(into: [String]()) { if $0.last != $1 { $0.append($1) } }
                XCTAssertEqual(actualOrder.count, 4)
                XCTAssertEqual(actualOrder, ordered.prefix(4).compactMap { $0.first?.asset })
                print("IOS_PHOTO_DATE_ORDER_PASS: first batch follows native capture dates and companion groups")
            }
            let before = try await cloudNodes()
            XCTAssertTrue(before.isEmpty, "Queuing file bytes must not publish Timeline")
            // Simulate system delivery without calling the WebView upload path.
            // A fresh coordinator reads the same protected checkpoint; the
            // transport, paired device, PhotoKit originals and replica are real.
            let coordinator = NativeDeferredUpload(store: checkpoint, scheduler: InstalledDeferredScheduler())
            coordinator.activate(foreground: false)
            let expiry = InstalledDeferredTask()
            coordinator.run(expiry, checkExecution: {
                if try checkpoint.load().contains(where: { $0.scope == scope && $0.request.authorization.id == connection && $0.confirmedParts > 0 }) {
                    expiry.expiration?()
                    throw CancellationError()
                }
            })
            for _ in 0..<400 where expiry.result == nil { try await Task.sleep(for: .milliseconds(250)) }
            XCTAssertEqual(expiry.result, false)
            await coordinator.waitForBackground()
            let committedBeforeRetry = try queued.compactMap { try checkpoint.lookup($0) }
            XCTAssertEqual(committedBeforeRetry.reduce(0) { $0 + $1.confirmedParts }, 1, "Expiry retained exactly the first verified part")
            XCTAssertFalse(committedBeforeRetry.contains(where: { $0.ready }), "Expiry cannot claim a file is ready")
            // A fresh foreground approval normally re-arms the original
            // records. Reuse exact test admissions with their existing scope.
            for record in queued { XCTAssertTrue(try coordinator.enqueue(record)) }
            let processing = InstalledDeferredTask()
            coordinator.run(processing, checkExecution: {})
            for _ in 0..<600 where processing.result == nil { try await Task.sleep(for: .milliseconds(250)) }
            XCTAssertEqual(processing.result, true)
            guard processing.result == true else {
                throw NSError(domain: "PhotoBackupAcceptance", code: 11, userInfo: [NSLocalizedDescriptionKey: "Deferred native processing did not complete"])
            }
            let completed = try checkpoint.load().filter { $0.scope == scope && $0.request.authorization.id == connection && $0.ready }
            XCTAssertEqual(completed.count, queued.count)
            XCTAssertEqual(Set(completed.map(\.request.uploadId)), Set(queued.map(\.request.uploadId)))
            for record in completed {
                let (download, response) = try await session.data(from: origin.appendingPathComponent("api/v1/attachments/content").appending(queryItems: [
                    URLQueryItem(name: "id", value: record.request.uploadId), URLQueryItem(name: "cache", value: "bytes")]))
                XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
                let expected = try XCTUnwrap(provider.inventory().first { $0.path == record.request.source.path })
                let original = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
                defer { try? FileManager.default.removeItem(at: original) }
                try provider.write(expected, to: original)
                XCTAssertEqual(SHA256.hash(data: download), SHA256.hash(data: try Data(contentsOf: original)))
            }
            let unpublished = try await cloudNodes()
            XCTAssertTrue(unpublished.isEmpty, "Native attachment completion must not publish Timeline")
            deferredCount = completed.count
            deferredAttachmentIDs = Set(completed.map(\.request.uploadId))
            deferredPartCount = completed.reduce(0) { $0 + $1.confirmedParts }
            deferredBytes = completed.reduce(0) { $0 + $1.request.source.size }
            deferredExerciseRan = true
            print("IOS_DEFERRED_NATIVE_PROOF: files=\(deferredCount) parts=\(deferredPartCount) bytes=\(deferredBytes) verified without WebView upload or Timeline publication")
            _ = try await web.evaluateJavaScript("sessionStorage.setItem('tt-photo-deferred-proof-released','yes')")
            try await reloadFresh()
            documentVisibilityKick(web)
        }
        func documentVisibilityKick(_ web: WKWebView) {
            web.evaluateJavaScript("window.dispatchEvent(new Event('online'))", completionHandler: nil)
        }
        func startAndAwaitUpload(background: Bool = false) async throws {
            for _ in 0..<100 where UIApplication.shared.applicationState != .active { try await Task.sleep(nanoseconds: 100_000_000) }
            guard UIApplication.shared.applicationState == .active else { throw CancellationError() }
            try await awaitTrue(web, "typeof window.__photoScans==='number'")
            let previous = (try await web.evaluateJavaScript("window.__photoScans")) as? Int ?? -1
            print("IOS_PHOTO_UPLOAD_READY: Starting the visible backup control for \(name).")
            let quoted = String(data: try JSONSerialization.data(withJSONObject: [name]), encoding: .utf8)!
            let card = "Array.from(document.querySelectorAll('h4,p')).find(e=>e.textContent===(" + quoted + ")[0])?.closest('article')"
            try await awaitTrue(web, "!!(" + card + ")")
            _ = try await web.evaluateJavaScript("(" + card + ").querySelector('button[aria-label=\"Expand folder\"]')?.click()")
            try await awaitTrue(web, "Array.from((" + card + ")?.querySelectorAll('button')||[]).some(b=>['Start backup','Upload now'].includes(b.textContent.trim())&&!b.disabled&&b.getClientRects().length>0)")
            let started = try await web.evaluateJavaScript("(()=>{const card=" + card + ";const button=Array.from(card?.querySelectorAll('button')||[]).find(b=>['Start backup','Upload now'].includes(b.textContent.trim())&&!b.disabled&&b.getClientRects().length>0);if(!button)return false;card.scrollIntoView({block:'center'});button.click();return true;})()")
            guard started as? Bool == true else { throw NSError(domain: "PhotoBackupAcceptance", code: 6, userInfo: [NSLocalizedDescriptionKey: "The fresh saved backup action was unavailable"]) }
            try await awaitTrue(web, "window.__photoScans>" + String(previous))
            if deferredProof && !deferredExerciseRan && connection != nil { try await proveDeferredProcessing() }
            if background {
                try await awaitTrue(web, "window.__nativeUploadStarted!==null")
                let startedValue = try await web.evaluateJavaScript("window.__nativeUploadStarted")
                let started = try XCTUnwrap(startedValue as? [String: Any])
                guard started["background"] as? Bool == true else {
                    throw NSError(domain: "PhotoBackupAcceptance", code: 3, userInfo: [NSLocalizedDescriptionKey: "iOS did not grant continued processing; background acceptance is unverified"])
                }
                print("IOS_BACKGROUND_UPLOAD_READY: upload=\(started["uploadId"] as? String ?? "missing"). Use Simulator Home, verify the pending attachment becomes ready from the host, then reopen Thingtime.")
                for _ in 0..<400 where UIApplication.shared.applicationState != .background { try await Task.sleep(nanoseconds: 100_000_000) }
                guard UIApplication.shared.applicationState == .background else { throw CancellationError() }
                print("IOS_BACKGROUND_UPLOAD_ENTERED")
                for _ in 0..<2400 where UIApplication.shared.applicationState != .active { try await Task.sleep(nanoseconds: 250_000_000) }
                guard UIApplication.shared.applicationState == .active else { throw CancellationError() }
                print("IOS_BACKGROUND_UPLOAD_RETURNED")
            }
            try await awaitTrue(web, "Array.from((" + card + ")?.querySelectorAll('[role=status]')||[]).some(e=>e.textContent==='Last transfer finished.')", seconds: 360)
        }
        if let resumeReceipt {
            let receipt = try XCTUnwrap(JSONSerialization.jsonObject(with: resumeReceipt) as? [String: Any])
            let id = try XCTUnwrap(receipt["id"] as? String)
            name = try XCTUnwrap(receipt["name"] as? String)
            cloud = try XCTUnwrap(receipt["rootId"] as? String)
            let expected = try XCTUnwrap(receipt["files"] as? [String: String])
            let saved = try await api("/api/v1/things?" + "id=" + id)
            let cfg = try XCTUnwrap((saved["thing"] as? [String: Any])?["crystal"] as? [String: Any])
            guard uiVerified, receipt["localRootId"] as? String == grant.id, cfg["localRootId"] as? String == grant.id,
                  cfg["remoteFolderId"] as? String == cloud, cfg["name"] as? String == name,
                  cfg["sourceKind"] as? String == "photos", cfg["mode"] as? String == "backup", !expected.isEmpty else {
                throw NSError(domain: "PhotoBackupAcceptance", code: 7, userInfo: [NSLocalizedDescriptionKey: "Existing disposable backup identity changed"])
            }
            func revisions() async throws -> [String: String] {
                let nodes = try await cloudNodes()
                return Dictionary(uniqueKeysWithValues: try nodes.map { node in
                    (try XCTUnwrap(node["path"] as? String), try XCTUnwrap((node["file"] as? [String: Any])?["revision"] as? String))
                })
            }
            let before = try await revisions()
            guard before == expected else { throw NSError(domain: "PhotoBackupAcceptance", code: 8, userInfo: [NSLocalizedDescriptionKey: "Existing cloud revisions changed before reopen"]) }
            try await reloadFresh(); try await startAndAwaitUpload()
            let after = try await revisions()
            XCTAssertEqual(after, expected)
            let uploadStats = try await web.evaluateJavaScript("window.__nativeUploadStats")
            XCTAssertEqual((uploadStats as? [String: Int])?["files"], 0, "A saved backup retry must not reupload unchanged originals")
            print("IOS_PHOTO_REOPEN_RETRY_PASS: \(after.count) exact original cloud revisions retained")
            return
        }
        var failure: Error?, phase = "create synthetic original"
        do {
            let firstID: String
            if let retained = owned.first { firstID = retained }
            else { firstID = try await createPhoto() }
            if deferredProof && uiVerified { _ = try await createPhoto() }
            let resources = try provider.inventory(), first = try XCTUnwrap(resources.first { $0.asset == firstID })
            let excluded: [String] = [] // Strict Photos captures cover the disposable library, without unsupported exclusions.
            phase = "read verified native pairing"
            let paired = try XCTUnwrap(MobileDeviceKeychain.load(scope)?.deviceId)
            phase = "save private cloud folder"
            let root = try await api("/api/v1/things", body: ["thingtime": ["folder"], "crystal": ["name": name]])
            cloud = try XCTUnwrap((root["thing"] as? [String: Any])?["id"] as? String)
            let config: [String: Any] = ["configurationVersion": 1, "name": name, "deviceId": paired, "localRootId": grant.id, "sourceKind": "photos", "remoteFolderId": cloud!, "mode": "backup", "paused": false, "propagateDeletes": false, "network": "any", "chargingOnly": false, "excludedPaths": excluded]
            phase = "save backup connection"
            let saved = try await api("/api/v1/things", body: ["thingtime": ["file-sync"], "crystal": config])
            connection = try XCTUnwrap((saved["thing"] as? [String: Any])?["id"] as? String)
            phase = "start and confirm first original"
            let firstStarted = Date()
            let firstReceipt = Task { @MainActor in
                for _ in 0..<120 {
                    try Task.checkCancellation()
                    if let node = try await cloudNodes().first(where: { $0["path"] as? String == first.path }),
                       let file = node["file"] as? [String: Any] {
                        try await verifyBytes(file)
                        print("IOS_PHOTO_FIRST_HASH_PASS: bytes=\(bytes.count)")
                        print("IOS_PHOTO_FIRST_CONFIRMED_MS: \(Int(Date().timeIntervalSince(firstStarted) * 1000))")
                        return file
                    }
                    try await Task.sleep(for: .seconds(3))
                }
                throw NSError(domain: "PhotoBackupAcceptance", code: 5, userInfo: [NSLocalizedDescriptionKey: "No verified cloud original arrived before the fixture deadline"])
            }
            defer { firstReceipt.cancel() }
            try await reloadFresh(); try await startAndAwaitUpload(background: env["THINGTIME_PHOTO_BACKGROUND_TEST"] == "1")
            let firstFile = try await firstReceipt.value
            let firstNodes = try await cloudNodes()
            let nodes: [[String: Any]]
            if uiVerified {
                nodes = firstNodes
                XCTAssertEqual(nodes.count, resources.count)
            } else {
                let secondID = try await createPhoto()
                let second = try XCTUnwrap(provider.inventory().first { $0.asset == secondID })
                try await PHPhotoLibrary.shared().performChanges { PHAssetChangeRequest.deleteAssets(PHAsset.fetchAssets(withLocalIdentifiers: [firstID], options: nil)) }
                owned.removeAll { $0 == firstID }
                phase = "discover second original"
                try await startAndAwaitUpload()
                nodes = try await cloudNodes(); XCTAssertEqual(nodes.count, firstNodes.count + 1)
                let secondFile = try XCTUnwrap(nodes.first { $0["path"] as? String == second.path }?["file"] as? [String: Any])
                try await verifyBytes(secondFile)
            }
            let retained = try XCTUnwrap(nodes.first { $0["path"] as? String == first.path }?["file"] as? [String: Any])
            XCTAssertEqual(retained["revision"] as? String, firstFile["revision"] as? String)
            let observedStats = try await web.evaluateJavaScript("window.__nativeUploadStats")
            let stats = try XCTUnwrap(observedStats as? [String: Int])
            XCTAssertEqual((stats["files"] ?? 0) + deferredCount, resources.count + (uiVerified ? 0 : 1))
            XCTAssertGreaterThanOrEqual((stats["parts"] ?? 0) + deferredPartCount, uiVerified ? 2 : 4)
            XCTAssertGreaterThanOrEqual(Int64(stats["bytes"] ?? 0) + deferredBytes, Int64(bytes.count * (uiVerified ? 1 : 2)))
            if deferredProof {
                let published = Set(nodes.compactMap { node in ((node["file"] as? [String: Any])?["content"] as? [String: Any])?["attachmentId"] as? String })
                XCTAssertTrue(deferredAttachmentIDs.isSubset(of: published), "Timeline must reconcile the exact deferred reservations")
                XCTAssertGreaterThanOrEqual(deferredAttachmentIDs.count, 2)
            }
            XCTAssertEqual(stats["legacy"], 0)
            XCTAssertEqual(try retainedParts(), retainedBefore, "Successful native parts must release their private cache")
            print("IOS_UPLOAD_CACHE_RELEASE_PASS")
            print("IOS_NATIVE_FILE_JOB_PASS: files=\(stats["files"] ?? 0)")
            print("IOS_NATIVE_UPLOAD_PASS: parts=\(stats["parts"] ?? 0) bytes=\(stats["bytes"] ?? 0) legacy=\(stats["legacy"] ?? -1)")
            phase = "reopen and retry saved backup"
            try await reloadFresh(); try await startAndAwaitUpload()
            let reopened = try await cloudNodes()
            XCTAssertEqual(reopened.count, nodes.count)
            for node in nodes {
                let old = try XCTUnwrap(node["file"] as? [String: Any])
                let same = try XCTUnwrap(reopened.first { $0["path"] as? String == node["path"] as? String }?["file"] as? [String: Any])
                XCTAssertEqual(same["revision"] as? String, old["revision"] as? String)
            }
            print("IOS_PHOTO_REOPEN_RETRY_PASS: saved connection and original cloud revisions retained")
            let shot = UIGraphicsImageRenderer(bounds: web.bounds).image { _ in web.drawHierarchy(in: web.bounds, afterScreenUpdates: true) }
            if let png = shot.pngData() { try png.write(to: FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("photo-backup-complete.png")) }
            print(uiVerified ? "IOS_PHOTO_BACKUP_PASS: Original PNG hashes, incremental discovery and saved-connection reopen/retry." : "IOS_PHOTO_BACKUP_PASS: Original PNG hashes, incremental discovery, retained deleted original and reopen/retry.")
        } catch {
            failure = error
            print("IOS_PHOTO_FAILURE_PHASE: \(phase); domain=\((error as NSError).domain); code=\((error as NSError).code)")
            if (error as NSError).domain == "PhotoBackupAcceptance" { print(error.localizedDescription) }
            if uiVerified { throw error } // Retain this disposable fixture for diagnosis, without an incidental Photos deletion prompt.
        }
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
        if !uiVerified && !owned.isEmpty { try await PHPhotoLibrary.shared().performChanges { PHAssetChangeRequest.deleteAssets(PHAsset.fetchAssets(withLocalIdentifiers: owned, options: nil)) } }
        try store.remove(scope, id: grant.id)
        if let failure { throw failure }
    }
}
