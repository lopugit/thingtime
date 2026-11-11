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
        let automaticProof = env["THINGTIME_PHOTO_AUTOMATIC_TEST"] == "1"
        let orderedProof = env["THINGTIME_PHOTO_EXPECT_NEWEST"] == "1"
        let resumeReceipt = env["THINGTIME_PHOTO_REOPEN_RECEIPT"].flatMap { Data($0.utf8) }
        let uiVerified = uiAutomation && env["THINGTIME_PHOTO_PREPARE_ONLY"] != "1"
        let mixedProof = uiVerified && automaticProof && orderedProof
        guard prior == nil || prior?.id == env["THINGTIME_PHOTO_RESUME_GRANT"] || uiAutomation else { throw XCTSkip("Preserve existing photo grant \(prior?.id ?? "unknown") unless its exact disposable-test ID is supplied") }
        web.configuration.userContentController.addUserScript(WKUserScript(source: """
        window.__photoDocument=performance.timeOrigin;
        window.__nativeUploadStarted=null;window.__nativeUploadStats={files:0,parts:0,bytes:0,legacy:0};window.__photoScans=0;
        window.__photoDeferredHeld=false;window.__photoDeferredPaths=[];window.__photoNativeArms=0;
        window.__photoIndexStream={hintBeforeTransfer:false,partialIndexSeen:false,sawTransfer:false,indexedFiles:0,items:{}};
        const testHold=\(deferredProof ? "true" : "false");
        const photoOriginalPost=window.thingtimeNativeBridge.postMessage;
        window.thingtimeNativeBridge.postMessage=function(m){
          if(m.type==='mobile-files'){
            if(['scan','scan-capture'].includes(m.payload?.action))window.__photoScans++;
            if(m.payload?.action==='arm-photo-run'&&m.payload?.execution==='native')window.__photoNativeArms++;
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
          const stream=window.__photoIndexStream, result=e.detail?.payload;
          if(e.detail?.type==='mobile-files-photo-progress'&&result?.immediate===true&&!stream.sawTransfer)stream.hintBeforeTransfer=true;
          if(e.detail?.type==='mobile-files-result'&&result?.photoRunProgress){
            const progress=result.photoRunProgress, activity=progress.activity;
            if(progress.stage==='uploading'||progress.currentFile?.sentBytes>0)stream.sawTransfer=true;
            if(activity?.indexing?.unit==='assets'&&activity.indexing.completed>0&&activity.indexing.completed<activity.indexing.total)stream.partialIndexSeen=true;
            stream.indexedFiles=Math.max(stream.indexedFiles,activity?.indexed?.files??0);
            for(const event of activity?.events??[]){
              if(event.phase==='indexing'&&event.item&&Number.isInteger(event.discovered))stream.items[event.discovered]=event.item;
            }
          }
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
        let initialLibrary = try provider.inventory()
        guard initialLibrary.count < 20 else { throw XCTSkip("Use a small disposable simulator library") }
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
        let photoName = "thingtime-acceptance.png", videoName = "thingtime-acceptance-video.mov"
        let stock = initialLibrary.filter { $0.name != photoName && $0.name != videoName }
        let anchor = Date(timeIntervalSince1970: 978_307_200)
        let fixtureDate = min(anchor, stock.compactMap(\.capturedAt).min() ?? anchor).addingTimeInterval(-86_400)
        let videoDate = max(anchor, stock.map { $0.capturedAt ?? $0.modifiedAt ?? .distantPast }.max() ?? anchor).addingTimeInterval(10 * 86_400)
        let videoFixture: (url: URL, bytes: Data)?
        if mixedProof {
            let bundle = Bundle(for: PhotoBackupInstalledTests.self)
            let url = try XCTUnwrap(bundle.url(forResource: "live-photo", withExtension: "mov") ??
                bundle.url(forResource: "live-photo", withExtension: "mov", subdirectory: "Fixtures/ShareLivePhoto"))
            videoFixture = (url, try Data(contentsOf: url))
        } else { videoFixture = nil }
        func readOriginal(_ resource: PhotoResource) async throws -> Data {
            let temp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: temp) }
            return try await Task.detached { try provider.write(resource, to: temp); return try Data(contentsOf: temp) }.value
        }
        var stockOriginals: [String: (hash: SHA256.Digest, size: Int)] = [:]
        if mixedProof {
            for resource in stock {
                let original = try await readOriginal(resource)
                stockOriginals[resource.path] = (SHA256.hash(data: original), original.count)
            }
        }
        var videoID: String?
        if prior != nil {
            // Explicit interrupted-fixture recovery: match both original name and
            // exact synthetic bytes before claiming an asset for cleanup.
            for resource in initialLibrary {
                let expected: Data
                if resource.name == photoName { expected = bytes }
                else if resource.name == videoName, let videoFixture { expected = videoFixture.bytes }
                else { continue }
                if try await readOriginal(resource) == expected {
                    if resource.name == videoName { videoID = resource.asset }
                    else { owned.append(resource.asset) }
                }
            }
        }
        func createPhoto(capturedAt: Date? = nil) async throws -> String {
            var identifier: String?
            try await PHPhotoLibrary.shared().performChanges {
                let request = PHAssetCreationRequest.forAsset(), options = PHAssetResourceCreationOptions()
                if let capturedAt { request.creationDate = capturedAt }
                options.originalFilename = photoName
                request.addResource(with: .photo, data: bytes, options: options); identifier = request.placeholderForCreatedAsset?.localIdentifier
            }
            let id = try XCTUnwrap(identifier); owned.append(id); return id
        }
        func createVideo(_ url: URL, capturedAt: Date) async throws -> String {
            var identifier: String?
            try await PHPhotoLibrary.shared().performChanges {
                let request = PHAssetCreationRequest.forAsset(), options = PHAssetResourceCreationOptions()
                request.creationDate = capturedAt
                options.originalFilename = videoName
                request.addResource(with: .video, fileURL: url, options: options)
                identifier = request.placeholderForCreatedAsset?.localIdentifier
            }
            return try XCTUnwrap(identifier)
        }
        func cloudNodes() async throws -> [[String: Any]] {
            let result = try await api("/api/v1/files?rootId=" + cloud!)
            return try XCTUnwrap((result["inventory"] as? [String: Any])?["nodes"] as? [[String: Any]])
        }
        func verifyBytes(_ file: [String: Any], expectedHash: SHA256.Digest, expectedSize: Int) async throws {
            let content = try XCTUnwrap(file["content"] as? [String: Any]), id = try XCTUnwrap(content["attachmentId"] as? String)
            let (download, response) = try await session.data(from: origin.appendingPathComponent("api/v1/attachments/content").appending(queryItems: [URLQueryItem(name: "id", value: id), URLQueryItem(name: "cache", value: "bytes")]))
            guard (response as? HTTPURLResponse)?.statusCode == 200, content["size"] as? Int == expectedSize,
                  download.count == expectedSize, SHA256.hash(data: download) == expectedHash else {
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
            if !automaticProof {
                XCTAssertEqual(completed.count, queued.count)
                XCTAssertEqual(Set(completed.map(\.request.uploadId)), Set(queued.map(\.request.uploadId)))
            }
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
            XCTAssertTrue(unpublished.isEmpty, "An older staging-only admission must not publish Timeline")
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
        func startAndAwaitUpload(background: Bool = false, reopening: Bool = false) async throws {
            for _ in 0..<100 where UIApplication.shared.applicationState != .active { try await Task.sleep(nanoseconds: 100_000_000) }
            guard UIApplication.shared.applicationState == .active else { throw CancellationError() }
            try await awaitTrue(web, "typeof window.__photoScans==='number'")
            let previous = (try await web.evaluateJavaScript("window.__photoScans")) as? Int ?? -1
            print("IOS_PHOTO_UPLOAD_READY: Starting the visible backup control for \(name).")
            let quoted = String(data: try JSONSerialization.data(withJSONObject: [name]), encoding: .utf8)!
            let card = "Array.from(document.querySelectorAll('h4,p')).find(e=>e.textContent===(" + quoted + ")[0])?.closest('article')"
            try await awaitTrue(web, "!!(" + card + ")")
            _ = try await web.evaluateJavaScript("(" + card + ").querySelector('button[aria-label=\"Expand folder\"]')?.click()")
            if automaticProof {
                let connection = try XCTUnwrap(connection)
                let device = try XCTUnwrap(MobileDeviceKeychain.load(scope)?.deviceId)
                if !reopening {
                    try await awaitTrue(web, "window.__photoNativeArms>0")
                    NotificationCenter.default.post(name: UIApplication.willResignActiveNotification, object: nil)
                    NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: nil)
                }
                let deadline = Date().addingTimeInterval(mixedProof ? 600 : 360)
                while Date() < deadline {
                    let progress = try NativeDeferredUpload.shared.photoRunProgress(scope: scope, configurationId: connection, rootId: grant.id, deviceId: device)
                    if progress?["stage"] as? String == "complete" { break }
                    try await Task.sleep(for: .milliseconds(250))
                }
                let progress = try XCTUnwrap(NativeDeferredUpload.shared.photoRunProgress(scope: scope, configurationId: connection, rootId: grant.id, deviceId: device))
                XCTAssertEqual(progress["stage"] as? String, "complete")
                let scans = try await web.evaluateJavaScript("window.__photoScans"), stats = try await web.evaluateJavaScript("window.__nativeUploadStats")
                XCTAssertEqual(scans as? Int, 0)
                XCTAssertEqual((stats as? [String: Int])?["files"], 0)
                if !reopening {
                    print("IOS_PHOTO_AUTOMATIC_FOREGROUND_PASS: one native worker, no WebView scan or upload, no manual start after interruption")
                }
                return
            }
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
            connection = id
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
            if mixedProof {
                let nodes = try await cloudNodes()
                XCTAssertEqual(nodes.count, initialLibrary.count)
                var totalBytes = 0
                for resource in initialLibrary {
                    let file = try XCTUnwrap(nodes.first { $0["path"] as? String == resource.path }?["file"] as? [String: Any])
                    let original = try await readOriginal(resource)
                    try await verifyBytes(file, expectedHash: SHA256.hash(data: original), expectedSize: original.count)
                    totalBytes += original.count
                }
                let photos = Set(initialLibrary.filter { $0.assetKind == "photo" }.map(\.asset)).count
                let videos = Set(initialLibrary.filter { $0.assetKind == "video" }.map(\.asset)).count
                print("IOS_PHOTO_MIXED_ORIGINALS_PASS: photos=\(photos) videos=\(videos) files=\(initialLibrary.count) bytes=\(totalBytes)")
            }
            try await reloadFresh(); try await startAndAwaitUpload(reopening: true)
            let after = try await revisions()
            XCTAssertEqual(after, expected)
            let reloaded = try await api("/api/v1/things?id=" + id)
            let reloadedConfig = try XCTUnwrap((reloaded["thing"] as? [String: Any])?["crystal"] as? [String: Any])
            XCTAssertEqual(reloadedConfig["paused"] as? Bool, false)
            let paired = try XCTUnwrap(MobileDeviceKeychain.load(scope)?.deviceId)
            let runs = NativePhotoRunStore(directory: NativeDeferredUploadStore().url.deletingLastPathComponent())
            let savedRun = try XCTUnwrap(try runs.load().first {
                $0.scope == scope && $0.authorization.id == id && $0.rootId == grant.id &&
                    $0.authorization.scope.deviceId == paired
            })
            XCTAssertFalse(savedRun.authorization.configuration.paused)
            XCTAssertTrue(savedRun.armed)
            XCTAssertEqual(savedRun.stage, "complete")
            XCTAssertGreaterThan(savedRun.expiresAt, Date())
            XCTAssertLessThan(savedRun.retryAt, savedRun.expiresAt)
            let uploadStats = try await web.evaluateJavaScript("window.__nativeUploadStats")
            XCTAssertEqual((uploadStats as? [String: Int])?["files"], 0, "A saved backup retry must not reupload unchanged originals")
            print("IOS_PHOTO_REOPEN_RETRY_PASS: \(after.count) exact original cloud revisions retained")
            return
        }
        var failure: Error?, phase = "create synthetic original"
        do {
            let firstID: String
            if let retained = owned.first { firstID = retained }
            else { firstID = try await createPhoto(capturedAt: mixedProof ? fixtureDate : nil) }
            if (deferredProof || automaticProof) && uiVerified {
                let count = mixedProof ? max(0, 5 - owned.count) : automaticProof ? 4 : 1
                for index in 0..<count {
                    _ = try await createPhoto(capturedAt: mixedProof ? fixtureDate.addingTimeInterval(Double(index + 1) * 86_400) : nil)
                }
            }
            if let videoFixture, videoID == nil {
                videoID = try await createVideo(videoFixture.url, capturedAt: videoDate)
            }
            let resources = try provider.inventory()
            let first = try XCTUnwrap(resources.first { $0.asset == (videoID ?? firstID) })
            let videoResources = resources.filter { $0.asset == videoID }
            if mixedProof {
                XCTAssertEqual(resources.count, stock.count + 6)
                XCTAssertEqual(videoResources.count, 1)
                XCTAssertEqual(first.assetKind, "video")
                XCTAssertEqual(first.capturedAt, videoDate)
                XCTAssertEqual(resources.compactMap(\.capturedAt).min(), fixtureDate)
                XCTAssertTrue(resources.filter { $0.name == photoName }.allSatisfy { resource in
                    resource.assetKind == "photo" && resource.capturedAt.map { $0 < (first.capturedAt ?? .distantPast) } == true
                })
            }
            let photoAssets = Set(resources.filter { $0.assetKind == "photo" }.map(\.asset)).count
            let videoAssets = Set(resources.filter { $0.assetKind == "video" }.map(\.asset)).count
            let expectedMixedBytes = stockOriginals.values.reduce(5 * bytes.count + (videoFixture?.bytes.count ?? 0)) { $0 + $1.size }
            let excluded: [String] = [] // Strict Photos captures cover the disposable library, without unsupported exclusions.
            phase = "read verified native pairing"
            let paired = try XCTUnwrap(MobileDeviceKeychain.load(scope)?.deviceId)
            phase = "save private cloud folder"
            let root = try await api("/api/v1/things", body: ["thingtime": ["folder"], "crystal": ["name": name]])
            cloud = try XCTUnwrap((root["thing"] as? [String: Any])?["id"] as? String)
            var config: [String: Any] = ["configurationVersion": 1, "name": name, "deviceId": paired, "localRootId": grant.id, "sourceKind": "photos", "remoteFolderId": cloud!, "mode": "backup", "paused": false, "propagateDeletes": false, "network": "any", "chargingOnly": false, "excludedPaths": excluded]
            if automaticProof {
                config["configurationVersion"] = 4
                config["photoAutomation"] = ["notificationIntervalMs": 1_800_000, "uploadBytesPerSecond": 625_000, "uploadBytesPerHour": 1_000_000_000]
            }
            phase = "save backup connection"
            let saved = try await api("/api/v1/things", body: ["thingtime": ["file-sync"], "crystal": config])
            connection = try XCTUnwrap((saved["thing"] as? [String: Any])?["id"] as? String)
            phase = "start and confirm first original"
            let firstStarted = Date()
            let firstReceipt = Task { @MainActor in
                for _ in 0..<120 {
                    try Task.checkCancellation()
                    let savedNodes = try await cloudNodes()
                    if mixedProof && !savedNodes.isEmpty {
                        XCTAssertEqual(savedNodes.compactMap { $0["path"] as? String }, [first.path],
                                       "The newest video should be the first published original")
                    }
                    if let node = savedNodes.first(where: { $0["path"] as? String == first.path }),
                       let file = node["file"] as? [String: Any] {
                        if mixedProof {
                            let configurationId = try XCTUnwrap(connection)
                            let status = try XCTUnwrap(NativeDeferredUpload.shared.photoRunProgress(scope: scope,
                                configurationId: configurationId, rootId: grant.id, deviceId: paired))
                            let activity = try XCTUnwrap(status["activity"] as? [String: Any])
                            let indexing = try XCTUnwrap(activity["indexing"] as? [String: Any])
                            let completed = try XCTUnwrap(indexing["completed"] as? Int)
                            let total = try XCTUnwrap(indexing["total"] as? Int)
                            let indexed = try XCTUnwrap((activity["indexed"] as? [String: Any])?["files"] as? Int)
                            XCTAssertEqual(indexing["unit"] as? String, "assets")
                            XCTAssertEqual(total, Set(resources.map(\.asset)).count)
                            XCTAssertGreaterThan(completed, 0)
                            XCTAssertLessThan(completed, total, "The first original must publish before full Photos enumeration")
                            XCTAssertLessThan(indexed, resources.count)
                            print("IOS_PHOTO_FIRST_PUBLICATION_INDEX: assets=\(completed)/\(total) files=\(indexed)/\(resources.count)")
                        }
                        let expected = videoFixture?.bytes ?? bytes
                        try await verifyBytes(file, expectedHash: SHA256.hash(data: expected), expectedSize: expected.count)
                        print("IOS_PHOTO_FIRST_HASH_PASS: bytes=\(expected.count)")
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
                if let videoFixture {
                    for original in resources {
                        let file = try XCTUnwrap(nodes.first { $0["path"] as? String == original.path }?["file"] as? [String: Any])
                        if let stock = stockOriginals[original.path] {
                            try await verifyBytes(file, expectedHash: stock.hash, expectedSize: stock.size)
                        } else {
                            let expected = original.asset == videoID ? videoFixture.bytes : bytes
                            try await verifyBytes(file, expectedHash: SHA256.hash(data: expected), expectedSize: expected.count)
                        }
                    }
                    print("IOS_PHOTO_MIXED_ORIGINALS_PASS: photos=\(photoAssets) videos=\(videoAssets) files=\(resources.count) bytes=\(expectedMixedBytes)")
                    let value = try await web.evaluateJavaScript("window.__photoIndexStream")
                    let stream = try XCTUnwrap(value as? [String: Any])
                    let items = try XCTUnwrap(stream["items"] as? [String: [String: Any]])
                    let dates = ISO8601DateFormatter()
                    dates.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                    let bridgeDates = ISO8601DateFormatter()
                    func captureDate(_ item: [String: Any]) -> Date? {
                        guard let date = item["capturedAt"] as? String else { return nil }
                        return dates.date(from: date) ?? bridgeDates.date(from: date)
                    }
                    let expectedPhotoDate = try XCTUnwrap(bridgeDates.date(from: bridgeDates.string(from: fixtureDate)))
                    let videoDate = try XCTUnwrap(first.capturedAt)
                    let expectedVideoDate = try XCTUnwrap(bridgeDates.date(from: bridgeDates.string(from: videoDate)))
                    XCTAssertEqual(stream["hintBeforeTransfer"] as? Bool, true)
                    XCTAssertEqual(stream["indexedFiles"] as? Int, resources.count)
                    XCTAssertNotNil(items["1"], "The first discovered asset must reach the web bridge")
                    XCTAssertTrue(items.values.contains { $0["kind"] as? String == "photo" && captureDate($0) == expectedPhotoDate })
                    XCTAssertTrue(items.values.contains { $0["kind"] as? String == "video" && captureDate($0) == expectedVideoDate })
                    print("IOS_PHOTO_INDEX_STREAM: items=\(items.count) files=\(resources.count) partialSnapshot=\(stream["partialIndexSeen"] as? Bool == true)")
                }
            } else {
                let secondID = try await createPhoto()
                let second = try XCTUnwrap(provider.inventory().first { $0.asset == secondID })
                try await PHPhotoLibrary.shared().performChanges { PHAssetChangeRequest.deleteAssets(PHAsset.fetchAssets(withLocalIdentifiers: [firstID], options: nil)) }
                owned.removeAll { $0 == firstID }
                phase = "discover second original"
                try await startAndAwaitUpload()
                nodes = try await cloudNodes(); XCTAssertEqual(nodes.count, firstNodes.count + 1)
                let secondFile = try XCTUnwrap(nodes.first { $0["path"] as? String == second.path }?["file"] as? [String: Any])
                try await verifyBytes(secondFile, expectedHash: SHA256.hash(data: bytes), expectedSize: bytes.count)
            }
            let retained = try XCTUnwrap(nodes.first { $0["path"] as? String == first.path }?["file"] as? [String: Any])
            XCTAssertEqual(retained["revision"] as? String, firstFile["revision"] as? String)
            let observedStats = try await web.evaluateJavaScript("window.__nativeUploadStats")
            let stats = try XCTUnwrap(observedStats as? [String: Int])
            if automaticProof {
                let configId = try XCTUnwrap(connection)
                let progress = try XCTUnwrap(NativeDeferredUpload.shared.photoRunProgress(scope: scope, configurationId: configId, rootId: grant.id, deviceId: paired))
                let confirmed = try XCTUnwrap(progress["confirmed"] as? [String: Any])
                XCTAssertEqual(stats["files"], 0)
                let photoCount = (mixedProof ? photoAssets : resources.count) + (uiVerified ? 0 : 1)
                XCTAssertEqual(confirmed["photos"] as? Int, photoCount)
                if mixedProof { XCTAssertEqual(confirmed["videos"] as? Int, videoAssets) }
                let wifiBytes = try XCTUnwrap(confirmed["wifiBytes"] as? Int64)
                let mobileBytes = try XCTUnwrap(confirmed["mobileBytes"] as? Int64)
                let unknownBytes = try XCTUnwrap(confirmed["unknownBytes"] as? Int64)
                XCTAssertEqual(wifiBytes + mobileBytes + unknownBytes,
                               Int64(mixedProof ? expectedMixedBytes : photoCount * bytes.count))
            } else {
                XCTAssertEqual((stats["files"] ?? 0) + deferredCount, resources.count + (uiVerified ? 0 : 1))
                XCTAssertGreaterThanOrEqual((stats["parts"] ?? 0) + deferredPartCount, uiVerified ? 2 : 4)
                XCTAssertGreaterThanOrEqual(Int64(stats["bytes"] ?? 0) + deferredBytes, Int64(bytes.count * (uiVerified ? 1 : 2)))
            }
            if deferredProof && !automaticProof {
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
            try await reloadFresh(); try await startAndAwaitUpload(reopening: true)
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
