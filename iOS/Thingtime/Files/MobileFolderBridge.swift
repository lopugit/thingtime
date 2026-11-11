import AppleFileSync
import Network
import Photos
import UIKit
import WebKit
import UniformTypeIdentifiers

@MainActor
final class MobileFolderBridge: NSObject, UIDocumentPickerDelegate {
    static let uploadVersion = "1.5.0"
    static let accessVersion = "1.8.0"
    static let photoAutomationVersion = "1.6.0"
    static var photoContinuationVersion: String? {
        if #available(iOS 26.0, *) { return "1.1.0" }
        return nil
    }
    static let stagingVersion = "1.2.0"
    static let publicationVersion = "1.2.0"
    static let trashVersion = "1.2.1"
    static let script = WKUserScript(source: "window.thingtimeNativeBridge.fileUploadVersion = '\(uploadVersion)'; window.thingtimeNativeBridge.fileAccessVersion = '\(accessVersion)'; window.thingtimeNativeBridge.filePhotoAutomationVersion = '\(photoAutomationVersion)'; window.thingtimeNativeBridge.fileInventoryStrictCoverage = false; window.thingtimeNativeBridge.fileStagingVersion = '\(stagingVersion)'; window.thingtimeNativeBridge.filePublicationVersion = '\(publicationVersion)'; window.thingtimeNativeBridge.fileTrashVersion = '\(trashVersion)';" +
        (photoContinuationVersion.map { "window.thingtimeNativeBridge.filePhotoContinuationVersion = '\($0)';" } ?? ""), injectionTime: .atDocumentStart, forMainFrameOnly: true)
    private let photos: PhotoLibraryReader
    private final class InventoryCaptureProgress: @unchecked Sendable {
        private let lock = NSLock()
        private var count = 0, skipped = 0, ignored = 0
        private var cloudFraction: Double?
        func reportCloud(_ fraction: Double?) { lock.lock(); defer { lock.unlock() }; cloudFraction = fraction }
        func cloud() -> Double? { lock.lock(); defer { lock.unlock() }; return cloudFraction }
        func report(_ value: Int, _ gaps: Int = 0) { lock.lock(); defer { lock.unlock() }; count = value; skipped = gaps }
        func reportIgnored(_ value: Int) { lock.lock(); defer { lock.unlock() }; ignored = value }
        func read() -> (entries: Int, skipped: Int, ignored: Int) { lock.lock(); defer { lock.unlock() }; return (count, skipped, ignored) }
    }

    private struct PhotoQueueApproval: Decodable, Sendable {
        let request: PhotoBackupQueueRequest
        let authorization: NativeUploadAuthorization
        func checkBinding() throws {
            guard request.configurationId == authorization.id, request.configurationRevision == authorization.updatedAt else {
                throw MobileFolderStore.Failure.changed
            }
        }
    }

    @MainActor private final class InventoryCaptureJob {
        let scope: PhotoLibraryReader.Scope
        let device: String
        let id: String
        let generation: String
        let bookmark: Data?
        let exclusions: [String]
        let allowCloudGaps: Bool
        let downloadAuthorization: NativeUploadAuthorization?
        let queueRequest: PhotoBackupQueueRequest?
        let progress = InventoryCaptureProgress()
        var task: Task<Void, Never>?
        var continuation: UIBackgroundTaskIdentifier = .invalid
        var result: Result<MobileFolderInventory.Capture, Error>?
        var prepared: MobileFolderInventory.Capture?
        var authorizationFailure: Error?
        init(scope: PhotoLibraryReader.Scope, device: String, id: String, bookmark: Data?, exclusions: [String], allowCloudGaps: Bool,
             downloadAuthorization: NativeUploadAuthorization?, queueRequest: PhotoBackupQueueRequest? = nil) {
            self.scope = scope; self.device = device; self.id = id; self.bookmark = bookmark; self.exclusions = exclusions; self.allowCloudGaps = allowCloudGaps
            self.downloadAuthorization = downloadAuthorization; self.queueRequest = queueRequest
            generation = bookmark == nil ? id : UUID().uuidString.lowercased()
        }
        var completedBackup: Bool {
            guard case .success? = result else { return false }
            return true
        }
        var descriptor: MobileFolderInventory.Capture {
            if let prepared { return prepared }
            let value = progress.read()
            return .init(id: id, generation: generation, totalEntries: value.entries,
                coverage: bookmark == nil ? nil : "partial", consistency: bookmark == nil ? nil : "per-entry",
                totalSkipped: bookmark == nil && !allowCloudGaps ? nil : value.skipped)
        }
    }
    private var inventoryJob: InventoryCaptureJob?

    private var photoPermissionPending = false
    private var sourceChoice: CheckedContinuation<Bool?, Error>?
    private let store: MobileFolderStore
    private let inventories: MobileFolderInventory
    private let staging: MobileSyncStaging
    private let uploadParts: FileUploadPartStore
    private let trash: MobileSyncTrash
    private let networkMonitor = NWPathMonitor()
    private let downloadConditions = NativePhotoDownloadConditions()
    private var batteryObserver: NSObjectProtocol?
    private var networkKind = "unknown"
    private var task: Task<Void, Never>?
    private var transport: NativeFileSession?
    private var generation = UUID()
    private var requestId: String?
    private var cancellationReply: ((Suspension) -> Void)?
    private var approvalDialog: UIAlertController?
    private var approvalContinuation: CheckedContinuation<Bool, Error>?
    private var picker: UIDocumentPickerViewController?
    private var selection: CheckedContinuation<URL?, Error>?
    private var observer: NSObjectProtocol?
    private var foregroundObserver: NSObjectProtocol?
    private var photoProgressObserver: NSObjectProtocol?
    private var foregroundWait: CheckedContinuation<Void, Error>?
    private var background: NativeUploadBackgroundLease?
    private var photoTransferContinuation: UIBackgroundTaskIdentifier = .invalid
    var conditionsChanged: (() -> Void)?
    var photoProgressChanged: ((Bool) -> Void)?
    init(store: MobileFolderStore? = nil, staging: MobileSyncStaging = MobileSyncStaging(), trash: MobileSyncTrash = MobileSyncTrash(), uploadParts: FileUploadPartStore = FileUploadPartStore(), inventories: MobileFolderInventory? = nil) {
        self.inventories = inventories ?? MobileFolderInventory(transport: RustEmbeddedInventoryTransport.default); self.photos = PhotoLibraryReader(transport: RustEmbeddedInventoryTransport.default); self.store = store ?? MobileFolderStore(); self.staging = staging; self.trash = trash; self.uploadParts = uploadParts
        super.init()
        UIDevice.current.isBatteryMonitoringEnabled = true
        let downloadConditions = self.downloadConditions
        let observeBattery = {
            let battery = UIDevice.current.batteryState
            downloadConditions.setCharging(battery == .charging || battery == .full)
        }
        observeBattery()
        batteryObserver = NotificationCenter.default.addObserver(forName: UIDevice.batteryStateDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { observeBattery(); self?.conditionsChanged?() }
        }
        networkMonitor.pathUpdateHandler = { [weak self, downloadConditions] path in
            let kind = path.status != .satisfied ? "offline" : path.usesInterfaceType(.cellular) ? "cellular" : path.usesInterfaceType(.wifi) ? "wifi" : path.usesInterfaceType(.wiredEthernet) ? "ethernet" : "unknown"
            downloadConditions.setNetwork(kind)
            Task { @MainActor in
                guard let self, self.networkKind != kind else { return }
                self.networkKind = kind; self.conditionsChanged?()
            }
        }
        networkMonitor.start(queue: DispatchQueue(label: "com.thingtime.sync-network"))
        foregroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                self?.foregroundWait?.resume(); self?.foregroundWait = nil; self?.conditionsChanged?()
                NativePhotoBackupSummaries.shared.deferVerifiedResume()
            }
        }
        observer = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, Self.suspendsForLifecycle(state: UIApplication.shared.applicationState,
                    photoPermissionPending: self.photoPermissionPending, hasContinuation: self.background?.canContinue == true ||
                    self.photoTransferContinuation != .invalid || self.inventoryJob.map { $0.continuation != .invalid } == true) else { return }
                self.suspend(.inactive)
            }
        }
        photoProgressObserver = NotificationCenter.default.addObserver(forName: NativeDeferredUpload.photoProgressChanged,
            object: nil, queue: .main) { [weak self] notice in
                let immediate = notice.userInfo?["immediate"] as? Bool == true
                MainActor.assumeIsolated { self?.photoProgressChanged?(immediate) }
            }
    }
    static func suspendsForLifecycle(state: UIApplication.State, photoPermissionPending: Bool, hasContinuation: Bool) -> Bool {
        state == .background && !photoPermissionPending && !hasContinuation
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
    deinit { for value in [batteryObserver, foregroundObserver, observer, photoProgressObserver].compactMap({ $0 }) {
        NotificationCenter.default.removeObserver(value)
    }; networkMonitor.cancel(); task?.cancel() }
    enum Suspension: Equatable { case inactive, requestCancelled, contextChanged }
    func suspend(_ reason: Suspension = .contextChanged) {
        background?.finish(success: false); background = nil
        endPhotoTransferContinuation()
        foregroundWait?.resume(throwing: CancellationError()); foregroundWait = nil
        sourceChoice?.resume(throwing: CancellationError()); sourceChoice = nil
        // A web request abort only abandons its reply. The independently
        // authorized scan may already be saving a reusable native checkpoint.
        // A true lifecycle/context change cancels the worker; its own exact
        // cleanup runs before a replacement capture may borrow the same ID.
        if reason != .requestCancelled {
            if reason == .contextChanged || inventoryJob?.completedBackup != true {
                inventoryJob?.task?.cancel()
            }
            if reason == .contextChanged, inventoryJob?.completedBackup == true {
                inventoryJob = nil
            }
        }
        let cancelled = cancellationReply; cancellationReply = nil
        generation = UUID(); task?.cancel(); task = nil; requestId = nil
        transport?.close(); transport = nil
        selection?.resume(throwing: CancellationError()); selection = nil; picker?.dismiss(animated: false); picker = nil
        approvalContinuation?.resume(throwing: CancellationError()); approvalContinuation = nil
        approvalDialog?.dismiss(animated: false); approvalDialog = nil
        cancelled?(reason)
    }
    private func endPhotoTransferContinuation() {
        guard photoTransferContinuation != .invalid else { return }
        let task = photoTransferContinuation; photoTransferContinuation = .invalid
        UIApplication.shared.endBackgroundTask(task)
    }
    private func endCaptureContinuation(_ job: InventoryCaptureJob) {
        guard job.continuation != .invalid else { return }
        let task = job.continuation; job.continuation = .invalid
        UIApplication.shared.endBackgroundTask(task)
    }
    private func startInventoryCapture(_ job: InventoryCaptureJob, check: @escaping () throws -> Void,
                                   authorize: @escaping () async throws -> Void) {
        let photos = self.photos, inventories = self.inventories, scope = job.scope, id = job.id
        let generation = job.generation, progress = job.progress, bookmark = job.bookmark, exclusions = job.exclusions
        let allowCloudGaps = job.allowCloudGaps, queueRequest = job.queueRequest
        let download = job.downloadAuthorization.flatMap { downloadConditions.control(for: $0) }?.reporting { progress.reportCloud($0) }
        job.task = Task { [weak job] in
            guard let job else { return }
            defer { job.task = nil; self.endCaptureContinuation(job) }
            if download != nil || queueRequest != nil {
                do { try check(); try await authorize(); try check() }
                catch { job.result = .failure(error); return }
            }
            if queueRequest != nil, UIApplication.shared.applicationState != .background {
                // Let an already-authorized finite PhotoKit capture finish a
                // short transition. Longer work checkpoints at expiration.
                job.continuation = UIApplication.shared.beginBackgroundTask(withName: "Preparing Photos backup") { [weak self, weak job] in
                    Task { @MainActor in
                        guard let self, let job else { return }
                        self.endCaptureContinuation(job); job.task?.cancel()
                    }
                }
            }
            let preparation = Task.detached {
                if let bookmark {
                    return try inventories.prepareBackup(scope, id: id, generation: generation, bookmark: bookmark, excludedPaths: exclusions,
                        ignored: { progress.reportIgnored($0) }, progress: { progress.report($0, $1) })
                }
                return try photos.prepareCapture(scope: scope, id: id, generation: generation, allowCloudGaps: allowCloudGaps, download: download, maximumCloudDownloads: 4,
                    queueRequest: queueRequest, progress: { progress.report($0, $1) })
            }
            let recheck = Task {
                do {
                    while !Task.isCancelled {
                        try await Task.sleep(for: .seconds(15))
                        try check(); try await authorize(); try check()
                    }
                } catch {
                    if !Task.isCancelled { job.authorizationFailure = error; job.task?.cancel() }
                }
            }
            defer { recheck.cancel() }
            do {
                let prepared = try await withTaskCancellationHandler(operation: { try await preparation.value }, onCancel: { preparation.cancel() })
                job.prepared = prepared
                try check(); try await authorize(); try check()
                let sealing = Task.detached {
                    if let bookmark {
                        try inventories.sealBackup(scope, capture: prepared, bookmark: bookmark)
                        return prepared
                    }
                    return try photos.sealCapture(scope: scope, capture: prepared)
                }
                let sealed = try await withTaskCancellationHandler(operation: { try await sealing.value }, onCancel: { sealing.cancel() })
                try check(); try await authorize(); try check()
                job.result = .success(sealed)
            } catch {
                let capture = job.descriptor
                _ = await Task.detached {
                    if let bookmark { try? inventories.abandonBackup(scope, capture: capture, bookmark: bookmark) }
                    else { try? photos.discard(scope: scope, capture: capture) }
                }.value
                job.result = .failure(job.authorizationFailure ?? error)
            }
        }
    }

    private func cancelInventoryCapture(_ job: InventoryCaptureJob, preserveCompletedBackup: Bool = true) async throws {
        job.task?.cancel()
        await job.task?.value
        if preserveCompletedBackup, job.completedBackup {
            if inventoryJob === job { inventoryJob = nil }
            return
        }
        let photos = self.photos, inventories = self.inventories, scope = job.scope, capture = job.descriptor, bookmark = job.bookmark
        try await Task.detached {
            if let bookmark { try inventories.abandonBackup(scope, capture: capture, bookmark: bookmark) }
            else { try photos.discard(scope: scope, capture: capture) }
        }.value
        if inventoryJob === job { inventoryJob = nil }
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
        guard try await presentApproval(title: "Back up photo originals?", message: "Choose which photos and videos Thingtime can read. Original resources include embedded metadata and Live Photo video. Saved cloud copies remain after device deletion. A configured, enabled backup can upload automatically. Originals held in iCloud may stay pending depending on your network settings.", button: "Choose photo access", webView: webView) else { return false }
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
                            transport: NativeFileSession, allowsCellular: Bool = false,
                            authorizeBeforeSend: (() async throws -> Void)? = nil, photoAuthorization: NativeUploadAuthorization? = nil,
                            download: PhotoOriginalDownloadControl? = nil,
                            current: @escaping () throws -> Void) async throws -> String {
        let staging = NativeUploadPartStaging(scope: scope, grant: grant, photos: photos, store: uploadParts, download: download)
        // Even retained parts require the live source version.
        try await staging.verify(request.source)
        try current(); try await transport.verifyOwner()
        // Replay the original reservation before allocating disk
        // or obtaining a fresh signed URL. No credentials persist.
        let started = try await transport.json("/api/v1/attachments/uploads", body: ["requestId": request.requestId,
            "filename": String(request.source.path.split(separator: "/").last ?? ""), "contentType": "application/octet-stream",
            "sizeBytes": request.source.size, "purpose": "file"])
        let ready = try request.verifyPlan(started)
        let (retained, part) = try await staging.prepare(request)
        try current(); try await transport.verifyOwner()
        if !ready {
            try await authorizeBeforeSend?()
            try await transport.uploadPart(part, uploadId: request.uploadId, partNumber: request.partNumber, allowsCellular: allowsCellular,
                photoAuthorization: photoAuthorization, conditions: downloadConditions)
        }
        try current()
        try await staging.verify(request.source)
        try current(); try await transport.verifyOwner()
        try await staging.release(retained)
        try current()
        return part.sha256
    }
    private func deferUpload(_ file: NativeUploadFileRequest, staging: NativeUploadPartStaging,
                             transport: NativeFileSession, check: () throws -> Void) async throws -> (queued: Bool, scheduled: Bool) {
        try check()
        let minimum = file.publication == nil ? [1, 0, 0] : [1, 1, 0]
        do { try await transport.require([(NativeDeferredUploadClient.feature, minimum)]) }
        catch MobileDevicePairing.Failure.incompatible { return (false, false) }
        guard staging.grant.sourceKind == "photos", let fingerprint = file.source.fingerprint,
              !file.source.path.contains("/") else { throw MobileFolderStore.Failure.invalid }
        let auth = file.authorization
        var body: [String: Any] = [
            "action": "admit", "uploadId": file.uploadId, "requestId": file.requestId,
            "configurationId": auth.id, "configurationRevision": auth.updatedAt,
            "deviceId": auth.scope.deviceId, "localRootId": staging.grant.id,
            "grantRevision": staging.grantRevision, "sourceVersion": file.source.version, "sizeBytes": file.source.size,
            "fingerprint": ["partSizeBytes": fingerprint.partSizeBytes, "partCount": fingerprint.partCount, "sha256": fingerprint.sha256]
        ]
        if let publication = file.publication {
            body["publication"] = ["expectedRevision": publication.expectedRevision.map { $0 as Any } ?? NSNull()]
        }
        // The live owner endpoint can recover a lost local renewal ID for
        // this exact reservation. It must explicitly identify the old grant.
        var admission = try await transport.json(NativeDeferredUploadClient.path, body: body, statuses: [200, 410])
        try check()
        if admission["ok"] as? Bool == false {
            let prior = admission["code"] as? String == "admission_renewal_required" ? admission["admissionId"] as? String : nil
            let stored = try NativeDeferredUpload.shared.renewalID(scope: staging.scope, request: file, grantRevision: staging.grantRevision)
            guard let replaces = prior ?? stored,
                  replaces.range(of: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$", options: .regularExpression) != nil else {
                throw NativeDeferredUploadClient.Failure.denied
            }
            body["replacesAdmissionId"] = replaces
            admission = try await transport.json(NativeDeferredUploadClient.path, body: body)
            try check()
        }
        guard admission["ok"] as? Bool == true, let id = admission["admissionId"] as? String,
              let raw = admission["expiresAt"] as? String, let expiresAt = MobileDevicePairing.date(raw), expiresAt > Date()
        else { throw MobileFolderStore.Failure.invalid }
        let record = NativeDeferredUploadRecord(scope: staging.scope, request: file, grantRevision: staging.grantRevision,
            admissionId: id, expiresAt: expiresAt)
        let queued = try NativeDeferredUpload.shared.enqueue(record)
        return (queued, queued && NativeDeferredUpload.shared.schedule())
    }

    private func verifyPhotoDownload(_ auth: NativeUploadAuthorization, scope: FileSyncOwnerScope, rootId: String,
                                     deviceId: String, webView: WKWebView, cookies: @escaping ([HTTPCookie], URL) -> [HTTPCookie],
                                     check: @escaping () throws -> Void, allowWiFi: Bool = false) async throws {
        try auth.validate(owner: scope, rootId: rootId, photos: true)
        guard auth.scope.deviceId == deviceId, allowWiFi || auth.configuration.network == "any" else { throw MobileFolderStore.Failure.changed }
        // Capture the existing browser credential accessor without retaining
        // credentials in the scan job or the native background checkpoint.
        let transport = NativeFileSession(scope: scope, cookieStore: webView.configuration.websiteDataStore.httpCookieStore,
            cookies: cookies, check: check, invalidated: {})
        defer { transport.close() }
        try await transport.open()
        try await transport.require([("api.things", [1,35,0])])
        let row = try await transport.json("/api/v1/things?id=" + auth.id)
        try check()
        let battery = UIDevice.current.batteryState
        try auth.verify(row, network: networkKind, charging: battery == .charging || battery == .full)
    }

    private func armPhotoRun(_ auth: NativeUploadAuthorization, scope: FileSyncOwnerScope, grant: MobileFolderStore.Grant,
                             webView: WKWebView, cookies: @escaping ([HTTPCookie], URL) -> [HTTPCookie],
                             exclusive: Bool, explicitResume: Bool, check: @escaping () throws -> Void) async throws -> Bool {
        try auth.validate(owner: scope, rootId: grant.id, photos: true)
        let transport = NativeFileSession(scope: scope, cookieStore: webView.configuration.websiteDataStore.httpCookieStore,
                                          cookies: cookies, check: check, invalidated: {})
        defer { transport.close() }
        try await transport.open()
        try await transport.require([(NativeDeferredUploadClient.feature, exclusive ? [1, 3, 0] : [1, 2, 0]), ("api.things", [1, 35, 0])])
        try auth.verifyConfiguration(await transport.json("/api/v1/things?id=" + auth.id))
        if !exclusive, NativeDeferredUpload.shared.ownsPhotoRun(scope: scope, configurationId: auth.id, rootId: grant.id, deviceId: auth.scope.deviceId) {
            // A stale WebView cannot replace the sole native worker with a
            // narrower legacy run or race it with per-file reservations.
            return NativeDeferredUpload.shared.schedule()
        }
        let revision = NativeUploadPartStaging.grantRevision(grant)
        var body: [String: Any] = ["action": "open-photo-run",
            "configurationId": auth.id, "configurationRevision": auth.updatedAt, "deviceId": auth.scope.deviceId,
            "localRootId": grant.id, "grantRevision": revision]
        if exclusive { body["guardedReplacement"] = true }
        let result = try await transport.json(NativeDeferredUploadClient.path, body: body)
        try check(); try await transport.verifyOwner(); try check()
        let current = try store.grant(scope, id: grant.id)
        guard current.sourceKind == "photos", NativeUploadPartStaging.grantRevision(current) == revision,
              photos.access() != "unavailable", result["ok"] as? Bool == true, let runId = result["runId"] as? String,
              let raw = result["expiresAt"] as? String, let expiry = MobileDevicePairing.date(raw), expiry > Date() else {
            throw MobileFolderStore.Failure.changed
        }
        var run = NativePhotoRunRecord(scope: scope, authorization: auth, grantRevision: revision, runId: runId, expiresAt: expiry)
        run.foregroundOwner = exclusive
        return try NativeDeferredUpload.shared.armPhotoRun(run, explicitResume: explicitResume)
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
    private func finishPhotoQueue(_ approval: PhotoQueueApproval, batchId: UUID, scope: FileSyncOwnerScope, rootId: String,
                                  webView: WKWebView, cookies: @escaping ([HTTPCookie], URL) -> [HTTPCookie],
                                  check: @escaping () throws -> Void) async throws {
        let auth = approval.authorization
        let device = auth.scope.deviceId
        try await verifyPhotoDownload(auth, scope: scope, rootId: rootId, deviceId: device,
            webView: webView, cookies: cookies, check: check, allowWiFi: true)
        let photos = self.photos
        let photoScope = PhotoLibraryReader.Scope(owner: scope, deviceId: NativeUploadPartStaging.inventoryIdentity, rootId: rootId)
        let originals = try await Task.detached {
            try photos.queueBatchEntries(scope: photoScope, request: approval.request, batchId: batchId)
        }.value
        try check()
        if !originals.isEmpty {
            let transport = NativeFileSession(scope: scope, cookieStore: webView.configuration.websiteDataStore.httpCookieStore,
                cookies: cookies, check: check, invalidated: {})
            defer { transport.close() }
            try await transport.open()
            try await transport.require([("api.files", [1,10,0])])
            let target = auth.configuration.remoteFolderId
            for original in originals {
                try check()
                let path = try NativePhotoQueueReceipt.observationPath(rootId: target, path: original.path)
                let response = try await transport.json(path)
                try NativePhotoQueueReceipt.validate(response, rootId: target, source: original)
            }
            try await verifyPhotoDownload(auth, scope: scope, rootId: rootId, deviceId: device,
                webView: webView, cookies: cookies, check: check, allowWiFi: true)
            let identities = try await Task.detached {
                try originals.compactMap { try photos.originalIdentity(scope: photoScope, source: $0) }
            }.value
            try check()
            try? NativePhotoBackupSummaries.shared.observe(.init(auth, owner: scope), originals: identities)
        }
        try check()
        try await Task.detached { try photos.finishQueueBatch(scope: photoScope, request: approval.request, batchId: batchId) }.value
    }

    // Keep upload request constraints separate from the shared bridge dispatcher.
    // Xcode 26.2 must type-check the same source used by the TestFlight archive.
    private func handleUpload(_ payload: [String: Any], action: String, rootId: String, scope: MobileDevicePairing.Scope,
                              grant: MobileFolderStore.Grant, webView: WKWebView, operation: UUID, base: [String: Any],
                              cookies: (([HTTPCookie], URL) -> [HTTPCookie])?,
                              verifyOwner: (MobileDevicePairing.Scope, @escaping () throws -> Void) async throws -> Void,
                              verifyDevice: ((MobileDevicePairing.Scope, String, @escaping () throws -> Void) async throws -> Void)?,
                              check: @escaping () throws -> Void,
                              reply: @escaping (String, [String: Any]) -> Void) async throws -> [String: Any] {
        var result: [String: Any] = [:]
        if action != "defer-upload" { await NativeDeferredUpload.shared.waitForBackground() }
        try check()
        guard let cookies else { throw MobileFolderStore.Failure.unavailable }
        let fileRequest = action != "upload-part" ? try self.decode(payload["upload"], as: NativeUploadFileRequest.self) : nil
        let request: NativeUploadPartRequest = try fileRequest?.part(1) ?? self.decode(payload["upload"], as: NativeUploadPartRequest.self)
        try request.validate()
        let photos = self.photos
        let current = {
            try check()
            let latest = try self.store.grant(scope, id: rootId)
            guard latest.bookmark == grant.bookmark, latest.sourceKind == grant.sourceKind,
                  grant.sourceKind != "photos" || photos.access() != "unavailable" else { throw MobileFolderStore.Failure.unavailable }
        }
        let transport = NativeFileSession(scope: scope, cookieStore: webView.configuration.websiteDataStore.httpCookieStore,
            cookies: cookies, check: current, invalidated: { [weak self] in if self?.generation == operation { self?.suspend() } },
            identityChanged: { NativeDeferredUpload.shared.disarm(matching: scope) })
        self.transport = transport; try await transport.open()
        try await transport.require([("api.auth-me", [1,0,0]), ("api.attachment-uploads", [1,5,0]), ("api.attachment-upload-parts", [1,1,0])])
        if let fileRequest {
            try await transport.require([("api.attachment-upload-complete", [1,4,0])])
            guard let verifyDevice else { throw MobileFolderStore.Failure.unavailable }
            let authorization = fileRequest.authorization
            try authorization.validate(owner: scope, rootId: rootId, photos: grant.sourceKind == "photos")
            guard !NativeDeferredUpload.shared.ownsPhotoRun(scope: scope, configurationId: authorization.id,
                rootId: rootId, deviceId: authorization.scope.deviceId) else { throw MobileFolderStore.Failure.changed }
            try await transport.require([("api.things", [1,35,0])])
            let authorize = {
                try current()
                try await verifyDevice(scope, authorization.scope.deviceId, current)
                let saved = try await transport.json("/api/v1/things?id=" + authorization.id)
                try current()
                let battery = UIDevice.current.batteryState
                try authorization.verify(saved, network: self.networkKind, charging: battery == .charging || battery == .full)
            }
            try await authorize()
            let download = self.downloadConditions.control(for: authorization)
            let staging = NativeUploadPartStaging(scope: scope, grant: grant, photos: photos, store: self.uploadParts, download: download)
            if action == "defer-upload" {
                let deferred = try await self.deferUpload(fileRequest, staging: staging, transport: transport, check: current)
                let deferredResult: [String: Any] = ["deferred": deferred.queued, "scheduled": deferred.scheduled, "uploadId": request.uploadId,
                    "requestId": request.requestId, "version": request.source.version]
                result = ["rootId": rootId, "deferredUpload": deferredResult]
            } else {
                let deferred = try NativeDeferredUpload.shared.read(scope: scope, request: fileRequest, grantRevision: staging.grantRevision)
                // Continued processing presents a system task and is only for
                // user-initiated work. Automatic Photos use the durable lane.
                if payload["continueInBackground"] as? Bool == true && (grant.sourceKind != "photos" || payload["userInitiated"] as? Bool == true) {
                    self.background = await NativeUploadBackgroundCoordinator.shared.begin(size: request.source.size, expired: { [weak self] in
                        if self?.generation == operation { self?.suspend(.inactive) }
                    })
                }
                if deferred != nil, grant.sourceKind == "photos", self.background?.canContinue != true,
                   UIApplication.shared.applicationState != .background {
                    self.photoTransferContinuation = UIApplication.shared.beginBackgroundTask(withName: "Finishing Photos upload") { [weak self] in
                        Task { @MainActor in
                            if self?.generation == operation { self?.suspend(.inactive) }
                        }
                    }
                }
                try current()
                let started: [String: Any] = ["rootId": rootId, "uploadId": fileRequest.uploadId,
                    "operationId": fileRequest.requestId, "version": request.source.version,
                    "size": request.source.size, "background": self.background?.canContinue == true, "deferred": deferred != nil]
                reply("mobile-files-started", base.merging(started) { _, new in new })
                let onProgress = { (received: Int64) in
                    self.background?.progress(received)
                    reply("mobile-files-progress", base.merging(["rootId": rootId, "uploadId": fileRequest.uploadId,
                        "operationId": fileRequest.requestId, "version": request.source.version,
                        "size": request.source.size, "received": received]) { _, new in new })
                }
                if let deferred {
                    try await NativeDeferredUpload.shared.foreground(deferred, staging: staging, check: current, progress: onProgress)
                } else {
                    if fileRequest.publication != nil { throw NativeDeferredUploadClient.Failure.unavailable }
                    try await NativeFileUploadJob.run(fileRequest, check: current, authorize: authorize, json: { path, body in
                        try await transport.json(path, body: body)
                    }, upload: { part in
                        try await self.uploadPart(part, scope: scope, rootId: rootId, grant: grant, transport: transport,
                            allowsCellular: authorization.configuration.network == "any", authorizeBeforeSend: authorize,
                            photoAuthorization: grant.sourceKind == "photos" ? authorization : nil, download: download, current: current)
                    }, progress: onProgress)
                }
                self.background?.finish(success: true); self.background = nil
                // The attachment is durable, but publication still belongs to
                // the shared Timeline runner. Hold its small reply until the
                // WebView is active and revalidate the owner before delivery.
                transport.close(); self.transport = nil
                self.endPhotoTransferContinuation()
                try await self.awaitForeground()
                try check(); try await verifyOwner(scope, check); try check()
                result = ["rootId": rootId, "uploadedFile": ["uploadId": request.uploadId, "requestId": request.requestId,
                    "version": request.source.version, "size": request.source.size,
                    "fingerprint": try JSONSerialization.jsonObject(with: JSONEncoder().encode(request.source.fingerprint!))]]
            }
        } else {
            guard grant.sourceKind != "photos" else { throw MobileFolderStore.Failure.invalid }
            let digest = try await self.uploadPart(request, scope: scope, rootId: rootId, grant: grant, transport: transport, current: current)
            result = ["rootId": rootId, "uploadedPart": ["uploadId": request.uploadId, "requestId": request.requestId,
                "partNumber": request.partNumber, "offset": request.offset, "length": request.length,
                "version": request.source.version, "size": request.source.size, "sha256": digest]]
        }
        return result
    }

    func handle(_ body: [String: Any], webView: WKWebView, root: URL, currentRoot: @escaping () -> URL?,
                cookies: (([HTTPCookie], URL) -> [HTTPCookie])? = nil,
                verifyOwner: @escaping (MobileDevicePairing.Scope, @escaping () throws -> Void) async throws -> Void,
                verifyDevice: ((MobileDevicePairing.Scope, String, @escaping () throws -> Void) async throws -> Void)? = nil,
                reply: @escaping (String, [String: Any]) -> Void) {
        guard let payload = body["payload"] as? [String: Any], let id = payload["requestId"] as? String, UUID(uuidString: id) != nil,
              let owner = payload["ownerId"] as? String, let action = payload["action"] as? String,
              ["read-photo-transfer-policy", "set-photo-transfer-policy", "list", "choose", "remove", "scan", "scan-capture", "scan-status", "scan-cancel", "scan-page", "scan-skips", "scan-discard", "inspect", "read", "upload-part", "upload-file", "defer-upload", "cancel-deferred-upload", "arm-photo-run", "photo-run-status", "pause-photo-runs", "run-photo-in-background", "photo-queue-finish", "conditions", "suspend", "stage-begin", "stage-append", "stage-download", "stage-finish", "write-approve", "write-check", "publish", "publication-lookup", "trash", "trash-lookup", "trash-expected", "trash-inspect", "trash-restore", "trash-list", "trash-restore-reviewed"].contains(action),
              let scope = try? MobileDevicePairing.Scope(ownerId: owner, url: root) else { return }
        if action == "suspend" { if requestId == id { suspend(.requestCancelled) }; return }
        let base: [String: Any] = ["requestId": id, "ownerId": owner, "origin": scope.origin.absoluteString]
        if action == "read-photo-transfer-policy" || action == "set-photo-transfer-policy" {
            // Settings never wait behind a long-running renderer folder slot.
            // They still independently prove the live origin, owner, paired
            // device, and (for folder scope) exact local Photos grant.
            Task { [weak self, weak webView] in
                guard let self, let webView else { return }
                let check = { [weak webView] in
                    try Task.checkCancellation()
                    guard let webView, currentRoot() == root, let current = webView.url,
                          LopuVoiceContract.sameOrigin(current, root) else { throw CancellationError() }
                }
                do {
                    try check()
                    guard let device = payload["deviceId"] as? String,
                          device.range(of: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$", options: .regularExpression) != nil,
                          let verifyDevice else { throw MobileFolderStore.Failure.invalid }
                    let rootId: String?
                    if let raw = payload["rootId"] {
                        guard let id = raw as? String, UUID(uuidString: id) != nil else { throw MobileFolderStore.Failure.invalid }
                        rootId = id
                    } else { rootId = nil }
                    let proposed = action == "set-photo-transfer-policy" ? try NativePhotoTransferPolicy.parse(payload["photoTransferPolicy"]) : nil
                    try await verifyOwner(scope, check); try check()
                    try await verifyDevice(scope, device, check); try check()
                    if let rootId {
                        let grant = try self.store.grant(scope, id: rootId)
                        guard grant.sourceKind == "photos" else { throw MobileFolderStore.Failure.invalid }
                    }
                    let policies = NativePhotoTransferPolicyStore()
                    if let proposed { try policies.save(proposed, scope: scope, deviceId: device, rootId: rootId) }
                    let saved = try policies.read(scope: scope, deviceId: device, rootId: rootId)
                    guard proposed == nil || saved == proposed else { throw MobileFolderStore.Failure.changed }
                    var result: [String: Any] = ["deviceId": device, "roots": [[String: Any]](), "photoTransferPolicy": saved.json]
                    if let rootId { result["rootId"] = rootId }
                    try check()
                    reply("mobile-files-result", base.merging(result) { _, new in new })
                } catch { reply("mobile-files-result", base.merging(["error": Self.folderErrorMessage(error)]) { _, new in new }) }
            }
            return
        }
        if action == "pause-photo-runs" {
            // Only removes authority from the exact owner/origin. Works
            // offline and returns no owner content, handles or other scopes.
            do {
                try NativeDeferredUpload.shared.pausePhotoRuns(scope: scope)
                reply("mobile-files-result", base.merging(["roots": [[String: Any]](), "photoRunsPaused": true]) { _, new in new })
            } catch { reply("mobile-files-result", base.merging(["error": Self.folderErrorMessage(error)]) { _, new in new }) }
            return
        }
        if action == "cancel-deferred-upload" {
            // Pause is a local denial, not another upload slot. It must be
            // able to fence the exact running request even when offline.
            do {
                guard let rootId = payload["rootId"] as? String, UUID(uuidString: rootId) != nil,
                      let configurationId = payload["configurationId"] as? String, let deviceId = payload["deviceId"] as? String,
                      [configurationId, deviceId].allSatisfy({ $0.range(of: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$", options: .regularExpression) != nil })
                else { throw MobileFolderStore.Failure.invalid }
                try NativeDeferredUpload.shared.pauseLocally(scope: scope, rootId: rootId, configurationId: configurationId,
                    deviceId: deviceId, explicitPause: payload["explicitPause"] as? Bool == true)
                let result: [String: Any] = ["rootId": rootId, "cancelled": true, "configurationId": configurationId, "roots": [[String: Any]]()]
                reply("mobile-files-result", base.merging(result) { _, new in new })
            } catch {
                reply("mobile-files-result", base.merging(["error": Self.folderErrorMessage(error)]) { _, new in new })
            }
            return
        }
        guard task == nil else { reply("mobile-files-result", base.merging(["error": "Another folder request is running."]) { _, new in new }); return }
        let operation = UUID(); generation = operation; requestId = id
        let inactiveReply = {
            var wait = base
            if let rootId = payload["rootId"] as? String { wait["rootId"] = rootId }
            wait["syncWait"] = NativeUploadAuthorization.Wait.inactive.rawValue
            reply("mobile-files-result", wait)
        }
        cancellationReply = { reason in
            if reason == .inactive { inactiveReply() }
            else if reason == .requestCancelled { reply("mobile-files-result", base.merging(["error": "Folder request was cancelled."]) { _, new in new }) }
        }
        let check = { [weak self, weak webView] in
            try Task.checkCancellation()
            guard self?.generation == operation, let webView, currentRoot() == root,
                  let current = webView.url, LopuVoiceContract.sameOrigin(current, root) else { throw CancellationError() }
            guard UIApplication.shared.applicationState != .background || self?.background?.canContinue == true ||
                  self.map({ $0.photoTransferContinuation != .invalid }) == true else {
                throw NativeUploadAuthorization.Wait.inactive
            }
        }
        task = Task<Void, Never> { [weak self, weak webView] in
            guard let self, let webView else { return }
            defer { if self.generation == operation { self.background?.finish(success: false); self.background = nil; self.endPhotoTransferContinuation(); self.task = nil; self.requestId = nil; self.cancellationReply = nil; self.transport?.close(); self.transport = nil } }
            await self.performFolderRequest(payload, action: action, owner: owner, scope: scope, operation: operation,
                base: base, webView: webView, root: root, currentRoot: currentRoot, cookies: cookies,
                verifyOwner: verifyOwner, verifyDevice: verifyDevice, check: check, reply: reply)
        }
    }

    private static func folderErrorMessage(_ error: Error) -> String {
        if let message = (error as? NativeDeferredUploadStore.Failure)?.errorDescription { return message }
        if let message = (error as? FileUploadPartStore.Failure)?.errorDescription { return message }
        if let message = (error as? PhotoLibraryReader.Failure)?.errorDescription { return message }
        if let message = (error as? MobileFolderStore.Failure)?.errorDescription { return message }
        if let message = (error as? MobileDevicePairing.Failure)?.errorDescription { return message }
        if let message = NativeDeferredUploadClient.failure(error)?.errorDescription { return message }
        return "Folder access failed. Your selections were preserved; try again."
    }

    // Explicit request and result types let Swift check each branch separately.
    // The actor-owned Task only owns cancellation and the request generation.
    private func performFolderRequest(_ payload: [String: Any], action: String, owner: String, scope: MobileDevicePairing.Scope,
                                      operation: UUID, base: [String: Any], webView: WKWebView, root: URL,
                                      currentRoot: @escaping () -> URL?,
                                      cookies: (([HTTPCookie], URL) -> [HTTPCookie])?,
                                      verifyOwner: @escaping (MobileDevicePairing.Scope, @escaping () throws -> Void) async throws -> Void,
                                      verifyDevice: ((MobileDevicePairing.Scope, String, @escaping () throws -> Void) async throws -> Void)?,
                                      check: @escaping () throws -> Void, reply: @escaping (String, [String: Any]) -> Void) async {
        do {
            try check()
            try await verifyOwner(scope, check); try check()
            if UIApplication.shared.applicationState != .background { NativeDeferredUpload.shared.verifiedForegroundScope(scope) }
            var result: [String: Any] = [:]
            var inspectedGrant: MobileFolderStore.Grant?
            var inventoryDevice: String?
            var checkedApproval: MobileFolderStore.WriteApproval?
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
                    NativeDeferredUpload.shared.disarm(matching: scope, rootId: rootId)
                    if let job = self.inventoryJob, job.scope.owner == scope, job.scope.rootId == rootId {
                        try await self.cancelInventoryCapture(job, preserveCompletedBackup: false); try check()
                    }
                    try self.store.remove(scope, id: rootId)
                    let uploadParts = self.uploadParts
                    let cleanup = Task.detached { try uploadParts.remove(scope: scope, rootId: rootId) }
                    try await withTaskCancellationHandler(operation: { try await cleanup.value }, onCancel: { cleanup.cancel() })
                }
                else {
                    let grant = try self.store.grant(scope, id: rootId)
                    guard grant.sourceKind != "photos" || ["scan", "scan-capture", "scan-status", "scan-cancel", "scan-page", "scan-skips", "scan-discard", "inspect", "read", "upload-part", "upload-file", "defer-upload", "arm-photo-run", "photo-run-status", "run-photo-in-background", "photo-queue-finish"].contains(action) else { throw MobileFolderStore.Failure.invalid }
                    if action == "arm-photo-run" {
                        let authorization = try self.decode(payload["authorization"], as: NativeUploadAuthorization.self)
                        let exclusive = payload["execution"] as? String == "native"
                        guard payload["execution"] == nil || exclusive, grant.sourceKind == "photos", let verifyDevice, let cookies else { throw MobileFolderStore.Failure.invalid }
                        let resume = exclusive && payload["resume"] as? Bool == true
                        let continueInBackground = payload["continueInBackground"] as? Bool == true
                        guard payload["continueInBackground"] == nil ||
                              (resume && continueInBackground && Self.photoContinuationVersion != nil && webView.window != nil) else {
                            throw MobileFolderStore.Failure.invalid
                        }
                        try await verifyDevice(scope, authorization.scope.deviceId, check); try check()
                        let scheduled = try await self.armPhotoRun(authorization, scope: scope, grant: grant, webView: webView, cookies: cookies,
                                                                  exclusive: exclusive, explicitResume: resume, check: check)
                        result = ["rootId": rootId, "configurationId": authorization.id, "photoRunArmed": true, "scheduled": scheduled]
                        if exclusive {
                            result["deviceId"] = authorization.scope.deviceId
                            result["configurationRevision"] = authorization.updatedAt
                            result["nativeOwnsRun"] = true
                            if continueInBackground {
                                // An explicit Back up now action is the user
                                // gesture. Attach to the admitted native run.
                                let requested = Task { @MainActor in
                                    try await NativeDeferredUpload.shared.requestContinuedPhotoRun(scope: scope, rootId: rootId,
                                        configurationId: authorization.id, deviceId: authorization.scope.deviceId,
                                        configurationRevision: authorization.updatedAt)
                                }
                                _ = try await requested.value
                            }
                            result["photoRunProgress"] = try NativeDeferredUpload.shared.photoRunProgress(scope: scope, configurationId: authorization.id,
                                rootId: rootId, deviceId: authorization.scope.deviceId)
                        }
                        inventoryDevice = authorization.scope.deviceId; inspectedGrant = grant
                    } else if action == "photo-run-status" || action == "run-photo-in-background" {
                        guard grant.sourceKind == "photos", let verifyDevice, let device = payload["deviceId"] as? String,
                              let configuration = payload["configurationId"] as? String, NativePhotoRunRecord.validHandle(device),
                              NativePhotoRunRecord.validHandle(configuration) else { throw MobileFolderStore.Failure.invalid }
                        try await verifyDevice(scope, device, check); try check()
                        result = ["rootId": rootId, "configurationId": configuration, "deviceId": device]
                        if action == "run-photo-in-background" {
                            guard let revision = payload["configurationRevision"] as? String, !revision.isEmpty, revision.utf8.count <= 128,
                                  webView.window != nil else { throw MobileFolderStore.Failure.invalid }
                            // The verified click belongs to the native runner.
                            // A WebView visibility change may abandon its reply
                            // without cancelling the system request in flight.
                            let requested = Task { @MainActor in
                                try await NativeDeferredUpload.shared.requestContinuedPhotoRun(scope: scope, rootId: rootId,
                                    configurationId: configuration, deviceId: device, configurationRevision: revision)
                            }
                            let continued = try await requested.value
                            result["configurationRevision"] = revision
                            result["photoContinuationRequested"] = continued == "active"
                            result["photoContinuationStatus"] = continued
                        } else {
                            let progress = try NativeDeferredUpload.shared.photoRunProgress(scope: scope, configurationId: configuration, rootId: rootId, deviceId: device)
                            result["photoRunProgress"] = progress.map { $0 as Any } ?? NSNull()
                            if let revision = progress?["configurationRevision"] { result["configurationRevision"] = revision }
                        }
                        inspectedGrant = grant
                    } else if ["upload-part", "upload-file", "defer-upload"].contains(action) {
                        result = try await self.handleUpload(payload, action: action, rootId: rootId, scope: scope,
                            grant: grant, webView: webView, operation: operation, base: base, cookies: cookies,
                            verifyOwner: verifyOwner, verifyDevice: verifyDevice, check: check, reply: reply)
                    } else if action == "photo-queue-finish" {
                        let approval = try self.decode(payload["photoQueueApproval"], as: PhotoQueueApproval.self)
                        try approval.checkBinding()
                        guard grant.sourceKind == "photos", let cookies, let verifyDevice,
                              let batchId = (payload["photoBatchId"] as? String).flatMap(UUID.init(uuidString:)) else {
                            throw MobileFolderStore.Failure.invalid
                        }
                        let device = approval.authorization.scope.deviceId
                        try await verifyDevice(scope, device, check)
                        try await self.finishPhotoQueue(approval, batchId: batchId, scope: scope, rootId: rootId,
                            webView: webView, cookies: cookies, check: check)
                        inventoryDevice = device; inspectedGrant = grant
                        result["rootId"] = rootId; result["photoQueueFinished"] = batchId.uuidString.lowercased()
                    } else if action == "trash-list" {
                        let trash = self.trash
                        let cursor = payload["cursor"] as? String
                        guard payload["cursor"] == nil || payload["cursor"] is String else { throw MobileFolderStore.Failure.invalid }
                        let worker = Task.detached { try trash.list(owner: scope, rootId: rootId, bookmark: grant.bookmark, cursor: cursor) }
                        let page = try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
                        result = ["rootId": rootId, "trashPage": try JSONSerialization.jsonObject(with: JSONEncoder().encode(page))]
                    } else if action == "write-approve" || action == "write-check" {
                        let approval = try self.decode(payload["approval"], as: MobileFolderStore.WriteApproval.self)
                        try approval.validate(owner: scope)
                        guard let verifyDevice else { throw MobileFolderStore.Failure.unavailable }
                        try await verifyDevice(scope, approval.scope.deviceId, check); try check()
                        if try !self.store.isWriteApproved(scope, id: rootId, approval: approval) {
                            // Resume may reuse exact native consent, never request or save new consent.
                            guard action == "write-approve" else { throw MobileFolderStore.Failure.unavailable }
                            guard try await self.approve(grant: grant, allowTrash: approval.allowTrash == true, webView: webView) else { throw MobileFolderStore.Failure.approvalCancelled }
                            try check(); try await verifyOwner(scope, check); try check()
                            try await verifyDevice(scope, approval.scope.deviceId, check); try check()
                            try self.store.approveWrite(scope, grant: grant, approval: approval)
                        }
                        let worker = Task.detached { try MobileFolderReader.checkAccess(bookmark: grant.bookmark) }
                        try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
                        inspectedGrant = grant; inventoryDevice = approval.scope.deviceId; checkedApproval = approval
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
                    } else if let policy = payload["capturePolicy"] as? String,
                              ["strict-async", "backup-supported"].contains(policy),
                              ["scan-capture", "scan-status", "scan-cancel"].contains(action) {
                        let isPhotos = grant.sourceKind == "photos"
                        let allowCloudGaps = payload["allowCloudGaps"] as? Bool == true
                        guard payload["allowCloudGaps"] == nil || (allowCloudGaps && isPhotos && action != "scan-cancel"),
                              policy == (isPhotos ? "strict-async" : "backup-supported"),
                              let device = payload["inventoryDeviceId"] as? String, !device.isEmpty, device.utf8.count <= 512,
                              let verifyDevice, let captureId = payload["captureId"] as? String,
                              UUID(uuidString: captureId) != nil, captureId == captureId.lowercased(),
                              payload["ignoreRules"] == nil, payload["excludedPaths"] == nil || payload["excludedPaths"] is [String]
                        else { throw MobileFolderStore.Failure.invalid }
                        let exclusions = try MobileFolderReader.canonicalExclusions(payload["excludedPaths"] as? [String] ?? [])
                        guard !isPhotos || exclusions.isEmpty else { throw MobileFolderStore.Failure.invalid }
                        try await verifyDevice(scope, device, check); try check()
                        inventoryDevice = device; inspectedGrant = grant
                        let inventoryScope = MobileFolderInventory.Scope(owner: scope, deviceId: isPhotos ? NativeUploadPartStaging.inventoryIdentity : device, rootId: rootId)
                        let photos = self.photos, inventories = self.inventories
                        let bookmark = isPhotos ? nil : grant.bookmark
                        if let previous = self.inventoryJob, previous.scope != inventoryScope || previous.device != device {
                            try await self.cancelInventoryCapture(previous)
                        }
                        var job = self.inventoryJob.flatMap { $0.id == captureId ? $0 : nil }
                        if action == "scan-capture", let interrupted = job, case .failure(let error)? = interrupted.result,
                           error is CancellationError || (error as? NativeUploadAuthorization.Wait) == .inactive {
                            try await self.cancelInventoryCapture(interrupted)
                            job = nil
                        }
                        if let job, job.bookmark != bookmark || job.exclusions != exclusions || (action != "scan-cancel" && job.allowCloudGaps != allowCloudGaps) {
                            throw MobileFolderStore.Failure.changed
                        }
                        result = ["rootId": rootId, "capturePolicy": policy, "captureId": captureId, "complete": false]
                        if payload["excludedPaths"] != nil { result["excludedPaths"] = exclusions }
                        let requestedQueue = try payload["photoQueueApproval"].map { try self.decode($0, as: PhotoQueueApproval.self) }
                        try requestedQueue?.checkBinding()
                        if let requestedQueue {
                            guard isPhotos, allowCloudGaps, action != "scan-cancel",
                                  requestedQueue.authorization.scope.deviceId == device else { throw MobileFolderStore.Failure.invalid }
                            try requestedQueue.authorization.validate(owner: scope, rootId: rootId, photos: true)
                        }
                        if action != "scan-cancel", let job, job.queueRequest != requestedQueue?.request { throw MobileFolderStore.Failure.changed }
                        let lookup: @Sendable () throws -> MobileFolderInventory.BackupStatus? = {
                            if let bookmark { return try inventories.backupStatus(inventoryScope, id: captureId, bookmark: bookmark, excludedPaths: exclusions) }
                            return try photos.status(scope: inventoryScope, id: captureId, allowCloudGaps: allowCloudGaps, queueRequest: requestedQueue?.request).map { .init(capture: $0, state: "complete") }
                        }
                        if action == "scan-cancel" {
                            if let job { try await self.cancelInventoryCapture(job) }
                            else {
                                try await Task.detached {
                                    if let bookmark {
                                        if let old = try lookup(), old.state != "complete" {
                                            try inventories.abandonBackup(inventoryScope, capture: .init(id: old.id, generation: old.generation, totalEntries: 0), bookmark: bookmark)
                                        }
                                    } else {
                                        try photos.discard(scope: inventoryScope, capture: .init(id: captureId, generation: captureId, totalEntries: 0))
                                    }
                                }.value
                            }
                            result["cancelled"] = true
                        } else {
                            var active = job
                            let requestedDownload = try payload["photoDownloadAuthorization"].map { try self.decode($0, as: NativeUploadAuthorization.self) }
                            guard requestedDownload == nil || (isPhotos && allowCloudGaps && action == "scan-capture" &&
                                (requestedQueue == nil || requestedQueue?.authorization == requestedDownload)) else {
                                throw MobileFolderStore.Failure.invalid
                            }
                            let saved = active == nil && self.inventoryJob == nil ? try await Task.detached(operation: lookup).value : nil
                            if active == nil, saved?.state != "complete", action == "scan-capture" {
                                if let previous = self.inventoryJob { try await self.cancelInventoryCapture(previous) }
                                let next = InventoryCaptureJob(scope: inventoryScope, device: device, id: captureId, bookmark: bookmark, exclusions: exclusions, allowCloudGaps: allowCloudGaps,
                                    downloadAuthorization: requestedDownload, queueRequest: requestedQueue?.request)
                                self.inventoryJob = next; active = next
                                let checkCapture = { [weak self, weak webView, weak next] in
                                    try Task.checkCancellation()
                                    guard let self, let next, self.inventoryJob === next, let webView,
                                          currentRoot() == root, let url = webView.url, LopuVoiceContract.sameOrigin(url, root)
                                    else { throw CancellationError() }
                                    guard UIApplication.shared.applicationState != .background || next.continuation != .invalid else { throw NativeUploadAuthorization.Wait.inactive }
                                    let latest = try self.store.grant(scope, id: rootId)
                                    guard latest.bookmark == grant.bookmark, latest.sourceKind == grant.sourceKind,
                                          !isPhotos || photos.access() != "unavailable" else { throw MobileFolderStore.Failure.changed }
                                }
                                let authorizeCapture = {
                                    try await verifyOwner(scope, checkCapture)
                                    try await verifyDevice(scope, device, checkCapture)
                                    if let auth = requestedQueue?.authorization ?? requestedDownload {
                                        guard let cookies else { throw MobileFolderStore.Failure.unavailable }
                                        try await self.verifyPhotoDownload(auth, scope: scope, rootId: rootId, deviceId: device,
                                            webView: webView, cookies: cookies, check: checkCapture, allowWiFi: requestedQueue != nil && requestedDownload == nil)
                                    }
                                }
                                self.startInventoryCapture(next, check: checkCapture, authorize: authorizeCapture)
                            }
                            let status: MobileFolderInventory.BackupStatus
                            if let active {
                                switch active.result {
                                case .success(let capture): status = .init(capture: capture, state: "complete", ignoredCount: active.progress.read().ignored)
                                case .failure(let failure) where !(failure is CancellationError): throw failure
                                case .failure: status = .init(capture: active.descriptor, state: "interrupted")
                                case nil: status = .init(capture: active.descriptor, state: "running", ignoredCount: active.progress.read().ignored)
                                }
                            } else if let saved { status = saved }
                            else {
                                status = .init(capture: .init(id: captureId, generation: captureId, totalEntries: 0,
                                    coverage: "partial", consistency: "per-entry", totalSkipped: 0), state: "interrupted")
                            }
                            result["complete"] = status.state == "complete"
                            if isPhotos {
                                result["strictCaptureState"] = status.state
                                result["captureGeneration"] = status.generation
                                result["indexedEntries"] = status.totalEntries
                                if allowCloudGaps {
                                    result["cloudOriginals"] = status.totalSkipped
                                    if let fraction = active?.progress.cloud() { result["photoDownloadFraction"] = fraction }
                                }
                                if status.state == "complete" {
                                    let capture = MobileFolderInventory.Capture(id: status.id, generation: status.generation, totalEntries: status.totalEntries,
                                        coverage: allowCloudGaps ? status.coverage : nil, consistency: allowCloudGaps ? status.consistency : nil,
                                        totalSkipped: allowCloudGaps ? status.totalSkipped : nil, photoQueue: status.photoQueue)
                                    result["capture"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(capture))
                                }
                            } else { result["backupCapture"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(status)) }
                        }
                    } else if ["scan-capture", "scan-page", "scan-skips", "scan-discard"].contains(action) {
                        guard let device = payload["inventoryDeviceId"] as? String, !device.isEmpty, device.utf8.count <= 512,
                              let verifyDevice else { throw MobileFolderStore.Failure.invalid }
                        try await verifyDevice(scope, device, check); try check()
                        inventoryDevice = device; inspectedGrant = grant
                        let inventories = self.inventories, photos = self.photos
                        let isPhotos = grant.sourceKind == "photos"
                        let inventoryScope = MobileFolderInventory.Scope(owner: scope, deviceId: isPhotos ? NativeUploadPartStaging.inventoryIdentity : device, rootId: rootId)
                        let exclusions: [String]
                        if let supplied = payload["excludedPaths"] {
                            guard let paths = supplied as? [String] else { throw MobileFolderStore.Failure.invalid }
                            _ = try MobileFolderReader.canonicalExclusions(paths); exclusions = paths
                        } else { exclusions = [] }
                        guard !isPhotos || (exclusions.isEmpty && payload["ignoreRules"] == nil &&
                            (payload["capturePolicy"] == nil || (action != "scan-capture" && payload["capturePolicy"] as? String == "backup-supported"))) else { throw MobileFolderStore.Failure.invalid }
                        let id = payload["captureId"] as? String
                        let capture = try payload["capture"].map { try JSONDecoder().decode(MobileFolderInventory.Capture.self, from: JSONSerialization.data(withJSONObject: $0)) }
                        if let job = self.inventoryJob, job.task != nil, job.scope == inventoryScope {
                            if action == "scan-discard", job.id == capture?.id {
                                try await self.cancelInventoryCapture(job, preserveCompletedBackup: false); try check()
                            } else { throw MobileFolderStore.Failure.changed }
                        }
                        if let capture {
                            guard (capture.coverage != nil) == (payload["capturePolicy"] as? String == "backup-supported") else {
                                throw MobileFolderStore.Failure.invalid
                            }
                        }
                        let offset = payload["offset"] as? NSNumber
                        if action == "scan-page" || action == "scan-skips" {
                            guard let offset, CFGetTypeID(offset) != CFBooleanGetTypeID(), offset.doubleValue.isFinite,
                                  offset.doubleValue >= 0, offset.doubleValue <= 9_007_199_254_740_991,
                                  offset.doubleValue.rounded(.down) == offset.doubleValue else { throw MobileFolderStore.Failure.invalid }
                        }
                        let worker = Task.detached { () throws -> Data in
                            if action == "scan-capture" {
                                guard let id else { throw MobileFolderStore.Failure.invalid }
                                return try JSONEncoder().encode(isPhotos ? photos.capture(scope: inventoryScope, id: id) :
                                    inventories.capture(inventoryScope, id: id, bookmark: grant.bookmark, excludedPaths: exclusions))
                            }
                            guard let capture else { throw MobileFolderStore.Failure.invalid }
                            if action == "scan-skips" {
                                guard capture.coverage != nil else { throw MobileFolderStore.Failure.invalid }
                                return try JSONEncoder().encode(isPhotos ? photos.readSkipped(scope: inventoryScope, capture: capture, offset: offset!.intValue) :
                                    inventories.readSkipped(inventoryScope, capture: capture, bookmark: grant.bookmark, offset: offset!.intValue))
                            }
                            if action == "scan-page" {
                                return try JSONEncoder().encode(isPhotos ? photos.page(scope: inventoryScope, capture: capture, offset: offset!.intValue) :
                                    inventories.read(inventoryScope, capture: capture, bookmark: grant.bookmark, offset: offset!.intValue))
                            }
                            if isPhotos { try photos.discard(scope: inventoryScope, capture: capture) }
                            else { try inventories.discard(inventoryScope, capture: capture, bookmark: grant.bookmark) }
                            return Data()
                        }
                        let data = try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
                        result = ["rootId": rootId, "complete": true]
                        if action == "scan-capture", payload["excludedPaths"] != nil { result["excludedPaths"] = exclusions }
                        if capture?.coverage != nil { result["capturePolicy"] = "backup-supported" }
                        if action == "scan-discard" {
                            if let job = self.inventoryJob, job.scope == inventoryScope, job.id == capture?.id { self.inventoryJob = nil }
                            result["discarded"] = true
                        } else { result[action == "scan-capture" ? "capture" : action == "scan-skips" ? "skippedPage" : "inventoryPage"] = try JSONSerialization.jsonObject(with: data) }
                    } else if action == "inspect" {
                        guard let path = payload["path"] as? String else { throw MobileFolderStore.Failure.invalid }
                        inspectedGrant = grant
                        let photos = self.photos
                        let localScope = MobileFolderInventory.Scope(owner: scope, deviceId: NativeUploadPartStaging.inventoryIdentity, rootId: rootId)
                        let worker = Task.detached { try grant.sourceKind == "photos" ? photos.inspect(scope: localScope, path: path) :
                            MobileFolderReader.inspect(bookmark: grant.bookmark, path: path) }
                        let entry = try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
                        let encoded: Any = try entry.map { try JSONSerialization.jsonObject(with: JSONEncoder().encode($0)) } ?? NSNull()
                        result = ["rootId": rootId, "path": path, "complete": true, "entry": encoded]
                    } else if action == "scan" {
                        if grant.sourceKind == "photos" { inspectedGrant = grant }
                        let photos = self.photos
                        let exclusions: [String]
                        if let supplied = payload["excludedPaths"] {
                            guard let paths = supplied as? [String] else { throw MobileFolderStore.Failure.invalid }
                            _ = try MobileFolderReader.canonicalExclusions(paths); exclusions = paths
                        } else { exclusions = [] }
                        guard grant.sourceKind != "photos" || exclusions.isEmpty else { throw MobileFolderStore.Failure.invalid }
                        let inventories = self.inventories
                        let localScope = MobileFolderInventory.Scope(owner: scope, deviceId: NativeUploadPartStaging.inventoryIdentity, rootId: rootId)
                        let worker = Task.detached { try grant.sourceKind == "photos" ? photos.scan(scope: localScope) : inventories.legacyScan(localScope, bookmark: grant.bookmark, excludedPaths: exclusions) }
                        let entries = try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
                        var encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(entries)) as! [[String: Any]]
                        for i in encoded.indices where encoded[i]["sha256"] == nil { encoded[i]["sha256"] = NSNull() }
                        result = ["rootId": rootId, "complete": true, "entries": encoded]
                        if payload["excludedPaths"] != nil { result["excludedPaths"] = exclusions }
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
                        let photoScope = MobileFolderInventory.Scope(owner: scope, deviceId: NativeUploadPartStaging.inventoryIdentity, rootId: grant.id)
                        let load = { (download: PhotoOriginalDownloadControl?) async throws -> MobileFolderReader.Chunk in
                            let worker = Task.detached {
                                if grant.sourceKind == "photos" {
                                    return try photos.read(scope: photoScope, path: path, version: version, offset: offset.int64Value,
                                                           length: length.intValue, download: download)
                                }
                                return try MobileFolderReader.read(bookmark: grant.bookmark, path: path, version: version,
                                                                   offset: offset.int64Value, length: length.intValue)
                            }
                            return try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
                        }
                        let chunk: MobileFolderReader.Chunk
                        do { chunk = try await load(nil) }
                        catch PhotoLibraryReader.Failure.cloudOriginal {
                            guard let input = payload["photoDownloadAuthorization"], grant.sourceKind == "photos",
                                  let verifyDevice, let cookies else { throw PhotoLibraryReader.Failure.cloudOriginal }
                            let auth = try self.decode(input, as: NativeUploadAuthorization.self)
                            try await verifyDevice(scope, auth.scope.deviceId, check)
                            try await self.verifyPhotoDownload(auth, scope: scope, rootId: rootId, deviceId: auth.scope.deviceId,
                                webView: webView, cookies: cookies, check: check)
                            guard let download = self.downloadConditions.control(for: auth) else { throw PhotoLibraryReader.Failure.cloudOriginal }
                            chunk = try await load(download)
                        }
                        result = ["rootId": rootId, "path": path, "chunk": try JSONSerialization.jsonObject(with: JSONEncoder().encode(chunk))]
                    }
                }
            }
            try check(); try await verifyOwner(scope, check); try check()
            if let inventoryDevice, let verifyDevice { try await verifyDevice(scope, inventoryDevice, check); try check() }
            if let inspectedGrant {
                let current = try self.store.grant(scope, id: inspectedGrant.id)
                guard current.bookmark == inspectedGrant.bookmark, current.sourceKind == inspectedGrant.sourceKind,
                      current.sourceKind != "photos" || self.photos.access() != "unavailable" else { throw MobileFolderStore.Failure.changed }
                if let checkedApproval {
                    guard try self.store.isWriteApproved(scope, id: inspectedGrant.id, approval: checkedApproval) else { throw MobileFolderStore.Failure.unavailable }
                }
            }
            result["roots"] = try self.store.list(scope).map { grant -> [String: Any] in
                var row: [String: Any] = ["id": grant.id, "name": grant.name]
                if grant.sourceKind == "photos" { row["sourceKind"] = "photos"; row["photoAccess"] = self.photos.access() }
                else { row["publicationVersion"] = Self.publicationVersion }
                return row
            }
            reply("mobile-files-result", base.merging(result) { _, new in new })
        } catch is CancellationError { }
        catch let wait as NativePhotoUploadBudget.Wait {
            guard (try? check()) != nil, let rootId = payload["rootId"] as? String else { return }
            var result = base
            result["rootId"] = rootId; result["syncWait"] = "data-budget"
            if let retryAt = wait.retryAt { result["retryAt"] = ISO8601DateFormatter().string(from: retryAt) }
            if let part = wait.minimumPartBytes { result["minimumPartBytes"] = part }
            reply("mobile-files-result", result)
        }
        catch let wait as NativeUploadAuthorization.Wait {
            guard generation == operation, !Task.isCancelled else { return }
            if wait != .inactive { guard (try? check()) != nil else { return } }
            var result = base
            if let rootId = payload["rootId"] as? String { result["rootId"] = rootId }
            result["syncWait"] = wait.rawValue
            reply("mobile-files-result", result)
        } catch {
            guard (try? check()) != nil else { return }
            let error = Self.folderErrorMessage(error)
            reply("mobile-files-result", base.merging(["error": error]) { _, new in new })
        }
    }
}
