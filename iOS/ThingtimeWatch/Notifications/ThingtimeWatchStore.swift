import Foundation
import UserNotifications
import WatchConnectivity
import WatchKit

@MainActor
final class ThingtimeWatchStore: NSObject, ObservableObject {
    static let shared = ThingtimeWatchStore()

    enum PhoneConnectionState: Equatable {
        case activating
        case checking
        case connected
        case waitingForPhone
        case signedOut
        case failed

        var title: String {
            switch self {
            case .activating: "Connecting to iPhone"
            case .checking: "Checking Thingtime sign-in"
            case .connected: "Connected to iPhone"
            case .waitingForPhone: "Waiting for iPhone"
            case .signedOut: "Sign in on iPhone"
            case .failed: "Connection needs attention"
            }
        }

        var systemImage: String {
            switch self {
            case .activating, .checking: "arrow.trianglehead.2.clockwise.rotate.90"
            case .connected: "iphone.and.arrow.forward"
            case .waitingForPhone: "iphone.slash"
            case .signedOut: "person.crop.circle.badge.exclamationmark"
            case .failed: "exclamationmark.icloud"
            }
        }
    }

    @Published private(set) var snapshot: ThingtimeWatchSnapshot = .signedOut
    @Published private(set) var notificationAuthorization: UNAuthorizationStatus = .notDetermined
    @Published private(set) var connectionMessage: String?
    @Published private(set) var phoneConnectionState: PhoneConnectionState = .activating
    @Published private(set) var lastPhoneContactAt: Date?
    @Published private(set) var attachmentStatusMessage: String?
    @Published private(set) var attachmentIsBusy = false
    @Published private(set) var historyNotifications: [ThingtimeWatchNotification] = []
    @Published private(set) var historyStatusMessage: String?
    @Published private(set) var historyIsLoading = false
    @Published private(set) var historyNextCursor: String?
    @Published private(set) var downloadedHistoryCount = 0

    private let session: WCSession? = WCSession.isSupported() ? .default : nil
    private var deviceToken: String?
    private var pendingAttachments: [String: ThingtimeWatchAttachmentMetadata] = [:]
    private var activeHistoryRequestId: String?
    private var activeHistoryFrom: String?
    private var activeHistoryTo: String?
    private var downloadedArchive: ThingtimeWatchNotificationArchive?
    private var downloadedVisibleCount = 0
    private var connectionAttempt = 0
    private var connectionRetryTask: Task<Void, Never>?
    private var connectionTimeoutTask: Task<Void, Never>?
    private var queuedConnectionRefresh = false
    private var activeConnectionRequestId: String?
    private var historyResponseTimeoutTask: Task<Void, Never>?
    private var lastHistoryRequest: (request: ThingtimeWatchNotificationHistoryRequest, archive: Bool)?

    private override init() {
        super.init()
    }

    func activate() {
        guard let session else {
            phoneConnectionState = .failed
            connectionMessage = "This Watch can’t connect to a paired iPhone."
            return
        }
        phoneConnectionState = .activating
        connectionMessage = "Activating the secure iPhone connection…"
        session.delegate = self
        session.activate()
        if let context = session.receivedApplicationContext as [String: Any]? {
            apply(context, confirmedContact: false)
        }
        restorePendingAttachments()
        attemptAttachmentTransfers()
        restoreLatestNotificationArchive()
        Task { await refreshAuthorizationStatus() }
        startPhoneConnectionAttempt(resetBackoff: true)
    }

    func requestRefresh() {
        startPhoneConnectionAttempt(resetBackoff: true)
    }

    func retryPhoneConnection() {
        startPhoneConnectionAttempt(resetBackoff: true)
    }

    var canRetryPhoneConnection: Bool {
        phoneConnectionState != .connected && phoneConnectionState != .checking
    }

    var canRetryHistory: Bool {
        lastHistoryRequest != nil && !historyIsLoading
    }

    var canRetryAttachments: Bool {
        !pendingAttachments.isEmpty && !attachmentIsBusy
    }

    var canLoadOlderInbox: Bool { snapshot.nextCursor != nil }

    var canLoadMoreHistory: Bool {
        if let downloadedArchive {
            return downloadedVisibleCount < downloadedArchive.notifications.count
        }
        return historyNextCursor != nil
    }

    func requestOlderNotifications() {
        guard let cursor = snapshot.nextCursor else { return }
        historyIsLoading = true
        let request = ThingtimeWatchNotificationHistoryRequest(
            requestId: UUID().uuidString.lowercased(),
            target: .inbox,
            from: nil,
            to: nil,
            cursor: cursor,
            limit: ThingtimeWatchNotificationHistory.pageSize
        )
        activeHistoryRequestId = request.requestId
        sendHistoryRequest(request, archive: false)
    }

    func fetchHistory(from: String, to: String) {
        downloadedArchive = nil
        downloadedVisibleCount = 0
        downloadedHistoryCount = 0
        historyNotifications = []
        historyNextCursor = nil
        activeHistoryFrom = from
        activeHistoryTo = to
        requestHistoryPage(cursor: nil)
    }

    func loadMoreHistory() {
        if let downloadedArchive {
            downloadedVisibleCount = min(
                downloadedVisibleCount + ThingtimeWatchNotificationHistory.pageSize,
                downloadedArchive.notifications.count
            )
            historyNotifications = Array(downloadedArchive.notifications.prefix(downloadedVisibleCount))
            historyStatusMessage = "Showing \(historyNotifications.count) of \(downloadedArchive.notifications.count) downloaded notifications."
            return
        }
        guard let cursor = historyNextCursor else { return }
        requestHistoryPage(cursor: cursor)
    }

    func downloadHistory(from: String, to: String) {
        let request = ThingtimeWatchNotificationHistoryRequest(
            requestId: UUID().uuidString.lowercased(),
            target: .range,
            from: from,
            to: to,
            cursor: nil,
            limit: ThingtimeWatchNotificationHistory.pageSize
        )
        activeHistoryRequestId = request.requestId
        activeHistoryFrom = from
        activeHistoryTo = to
        historyIsLoading = true
        historyStatusMessage = "Downloading the full period from your iPhone…"
        sendHistoryRequest(request, archive: true)
    }

    func requestPairing() {
        connectionMessage = "Checking Thingtime on your iPhone…"
        startPhoneConnectionAttempt(resetBackoff: true, kind: "pair")
    }

    func markRead(id: String) {
        let current = snapshot.notifications.first(where: { $0.id == id }) ?? historyNotifications.first(where: { $0.id == id })
        guard let current else { return }
        guard current.isUnread else { return }

        let updated = ThingtimeWatchNotification(
            id: current.id,
            type: current.type,
            actorUsername: current.actorUsername,
            actorName: current.actorName,
            targetId: current.targetId,
            postId: current.postId,
            preview: current.preview,
            readAt: ISO8601DateFormatter().string(from: Date()),
            createdAt: current.createdAt
        )
        let notifications = snapshot.notifications.map { $0.id == id ? updated : $0 }
        historyNotifications = historyNotifications.map { $0.id == id ? updated : $0 }
        if let archive = downloadedArchive {
            let updatedArchive = ThingtimeWatchNotificationArchive(
                requestId: archive.requestId,
                from: archive.from,
                to: archive.to,
                downloadedAt: archive.downloadedAt,
                notifications: archive.notifications.map { $0.id == id ? updated : $0 }
            )
            downloadedArchive = updatedArchive
            try? Self.persistNotificationArchive(updatedArchive)
        }
        snapshot = ThingtimeWatchSnapshot(
            authenticated: true,
            unreadCount: max(0, snapshot.unreadCount - 1),
            notifications: notifications,
            nextCursor: snapshot.nextCursor,
            syncedAt: snapshot.syncedAt,
            message: nil
        )
        send(["kind": "mark-read", "ids": [id]], guaranteed: true)
    }

    private func requestHistoryPage(cursor: String?) {
        guard let from = activeHistoryFrom, let to = activeHistoryTo else { return }
        let request = ThingtimeWatchNotificationHistoryRequest(
            requestId: UUID().uuidString.lowercased(),
            target: .range,
            from: from,
            to: to,
            cursor: cursor,
            limit: ThingtimeWatchNotificationHistory.pageSize
        )
        activeHistoryRequestId = request.requestId
        historyIsLoading = true
        historyStatusMessage = cursor == nil ? "Fetching the first 10…" : "Fetching 10 more…"
        sendHistoryRequest(request, archive: false)
    }

    private func sendHistoryRequest(_ request: ThingtimeWatchNotificationHistoryRequest, archive: Bool) {
        do {
            let message = try archive
                ? ThingtimeWatchNotificationHistory.archiveRequestMessage(request)
                : ThingtimeWatchNotificationHistory.requestMessage(request)
            lastHistoryRequest = (request, archive)
            sendInteractiveOrGuaranteed(message, requestId: request.requestId)
        } catch {
            historyIsLoading = false
            historyStatusMessage = error.localizedDescription
        }
    }

    func retryHistoryRequest() {
        guard let lastHistoryRequest else { return }
        historyIsLoading = true
        historyStatusMessage = lastHistoryRequest.archive
            ? "Retrying the full download with your iPhone…"
            : "Retrying with your iPhone…"
        startPhoneConnectionAttempt(resetBackoff: true)
        sendHistoryRequest(lastHistoryRequest.request, archive: lastHistoryRequest.archive)
    }

    private func sendInteractiveOrGuaranteed(_ message: [String: Any], requestId: String) {
        guard let session else {
            historyIsLoading = false
            historyStatusMessage = "This Watch can’t connect to its paired iPhone."
            return
        }
        guard session.isReachable else {
            session.transferUserInfo(message)
            historyIsLoading = false
            phoneConnectionState = .waitingForPhone
            connectionMessage = "Open Thingtime on your iPhone; the request is safely queued."
            historyStatusMessage = "Queued safely. Open Thingtime on your iPhone, then tap Retry if it doesn’t continue."
            return
        }
        scheduleHistoryResponseTimeout(requestId: requestId)
        session.sendMessage(message, replyHandler: { _ in }, errorHandler: { [weak self] error in
            session.transferUserInfo(message)
            Task { @MainActor in
                guard let self, self.activeHistoryRequestId == requestId else { return }
                self.historyResponseTimeoutTask?.cancel()
                self.historyIsLoading = false
                self.phoneConnectionState = .waitingForPhone
                self.connectionMessage = "The request is queued for Thingtime on iPhone."
                self.historyStatusMessage = "The iPhone didn’t answer immediately. Open Thingtime there, then tap Retry."
            }
#if DEBUG
            print("[ThingtimeWatchStore] immediate history request failed: \(error.localizedDescription)")
#endif
        })
    }

    private func scheduleHistoryResponseTimeout(requestId: String) {
        historyResponseTimeoutTask?.cancel()
        historyResponseTimeoutTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(15))
            guard !Task.isCancelled else { return }
            await MainActor.run {
                guard let self, self.activeHistoryRequestId == requestId, self.historyIsLoading else { return }
                self.historyIsLoading = false
                self.historyStatusMessage = "No response yet. Open Thingtime on your iPhone, then tap Retry."
            }
        }
    }

    private func applyHistoryPage(_ message: [String: Any]) {
        do {
            guard let page = try ThingtimeWatchNotificationHistory.page(from: message),
                  page.requestId == activeHistoryRequestId else { return }
            markPhoneContact()
            phoneConnectionState = snapshot.authenticated ? .connected : .signedOut
            historyResponseTimeoutTask?.cancel()
            historyIsLoading = false
            if page.target == .inbox {
                let existing = Set(snapshot.notifications.map(\.id))
                let appended = snapshot.notifications + page.notifications.filter { !existing.contains($0.id) }
                snapshot = ThingtimeWatchSnapshot(
                    authenticated: true,
                    unreadCount: page.unreadCount,
                    notifications: appended,
                    nextCursor: page.nextCursor,
                    syncedAt: ISO8601DateFormatter().string(from: Date()),
                    message: nil
                )
                historyStatusMessage = page.notifications.isEmpty ? "No older notifications." : "Loaded \(page.notifications.count) older notifications."
                return
            }

            let existing = Set(historyNotifications.map(\.id))
            historyNotifications.append(contentsOf: page.notifications.filter { !existing.contains($0.id) })
            historyNextCursor = page.nextCursor
            historyStatusMessage = page.notifications.isEmpty
                ? "No notifications in this period."
                : "Showing \(historyNotifications.count) notification\(historyNotifications.count == 1 ? "" : "s")."
        } catch {
            historyIsLoading = false
            historyStatusMessage = "Thingtime sent an unreadable history page."
        }
    }

    private func applyHistoryError(_ message: [String: Any]) {
        guard message[ThingtimeWatchWire.kindKey] as? String == ThingtimeWatchNotificationHistory.errorKind,
              message["requestId"] as? String == activeHistoryRequestId else { return }
        markPhoneContact()
        phoneConnectionState = snapshot.authenticated ? .connected : .signedOut
        historyResponseTimeoutTask?.cancel()
        historyIsLoading = false
        historyStatusMessage = message["message"] as? String ?? "Notification history could not be fetched."
    }

    private func applyDownloadedArchive(_ archive: ThingtimeWatchNotificationArchive) {
        guard activeHistoryRequestId == nil || activeHistoryRequestId == archive.requestId else { return }
        markPhoneContact()
        phoneConnectionState = snapshot.authenticated ? .connected : .signedOut
        activeHistoryRequestId = archive.requestId
        activeHistoryFrom = archive.from
        activeHistoryTo = archive.to
        downloadedArchive = archive
        downloadedHistoryCount = archive.notifications.count
        downloadedVisibleCount = min(ThingtimeWatchNotificationHistory.pageSize, archive.notifications.count)
        historyNotifications = Array(archive.notifications.prefix(downloadedVisibleCount))
        historyNextCursor = nil
        historyIsLoading = false
        historyStatusMessage = "Downloaded \(archive.notifications.count) notification\(archive.notifications.count == 1 ? "" : "s") for offline viewing."
    }

    private func restoreLatestNotificationArchive() {
        guard let archive = Self.loadLatestNotificationArchive() else { return }
        applyDownloadedArchive(archive)
    }

    func enableAlerts() async {
        do {
            _ = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
            await refreshAuthorizationStatus()
            WKApplication.shared().registerForRemoteNotifications()
        } catch {
            connectionMessage = "Thingtime could not request notification permission."
        }
    }

    func setDeviceToken(_ token: String) {
        deviceToken = token
        sendDeviceToken()
    }

    func recordRegistrationFailure(_ error: Error) {
#if DEBUG
        connectionMessage = "Push registration is unavailable in this build."
#endif
    }

    func queueAttachment(data: Data, filename: String, contentType: String) async {
        attachmentIsBusy = true
        attachmentStatusMessage = "Preparing \(filename)…"
        do {
            let metadata = try ThingtimeWatchAttachmentTransfer.makeMetadata(
                filename: filename,
                contentType: contentType,
                sizeBytes: Int64(data.count)
            )
            try await Task.detached(priority: .userInitiated) {
                try Self.persistAttachment(data: data, metadata: metadata)
            }.value
            pendingAttachments[metadata.requestId] = metadata
            attachmentStatusMessage = "Queued \(metadata.filename) for your iPhone."
            attemptAttachmentTransfers()
        } catch {
            attachmentIsBusy = false
            attachmentStatusMessage = error.localizedDescription
        }
    }

    func queueAttachment(fileURL: URL, filename: String, contentType: String) async {
        attachmentIsBusy = true
        attachmentStatusMessage = "Preparing \(filename)…"
        do {
            let values = try fileURL.resourceValues(forKeys: [.fileSizeKey])
            let metadata = try ThingtimeWatchAttachmentTransfer.makeMetadata(
                filename: filename,
                contentType: contentType,
                sizeBytes: Int64(values.fileSize ?? 0)
            )
            try await Task.detached(priority: .userInitiated) {
                try Self.persistAttachment(sourceURL: fileURL, metadata: metadata)
            }.value
            pendingAttachments[metadata.requestId] = metadata
            attachmentStatusMessage = "Queued \(metadata.filename) for your iPhone."
            attemptAttachmentTransfers()
        } catch {
            attachmentIsBusy = false
            attachmentStatusMessage = error.localizedDescription
        }
    }

    func retryAttachmentTransfers() {
        guard !pendingAttachments.isEmpty else { return }
        attachmentIsBusy = true
        attachmentStatusMessage = "Retrying with your iPhone…"
        startPhoneConnectionAttempt(resetBackoff: true)
        attemptAttachmentTransfers()
    }

    private func startPhoneConnectionAttempt(resetBackoff: Bool, kind: String = "refresh") {
        if resetBackoff {
            connectionRetryTask?.cancel()
            connectionTimeoutTask?.cancel()
            connectionAttempt = 0
            queuedConnectionRefresh = false
        }

        guard let session else {
            phoneConnectionState = .failed
            connectionMessage = "This Watch can’t connect to a paired iPhone."
            return
        }
        guard session.activationState == .activated else {
            phoneConnectionState = .activating
            connectionMessage = "Activating the secure iPhone connection…"
            session.activate()
            schedulePhoneConnectionRetry(kind: kind)
            return
        }

        let request = ["kind": kind]
        guard session.isReachable else {
            phoneConnectionState = .waitingForPhone
            connectionMessage = "Open Thingtime on your iPhone; reconnecting automatically."
            if !queuedConnectionRefresh {
                session.transferUserInfo(request)
                queuedConnectionRefresh = true
            }
            schedulePhoneConnectionRetry(kind: kind)
            return
        }

        phoneConnectionState = .checking
        connectionMessage = "Checking Thingtime sign-in on your iPhone…"
        let requestId = UUID().uuidString
        activeConnectionRequestId = requestId
        connectionTimeoutTask?.cancel()
        connectionTimeoutTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(12))
            guard !Task.isCancelled else { return }
            await MainActor.run {
                guard let self, self.activeConnectionRequestId == requestId else { return }
                self.phoneConnectionState = .failed
                self.connectionMessage = "The iPhone didn’t answer. Open Thingtime there, then retry."
                self.schedulePhoneConnectionRetry(kind: kind)
            }
        }
        session.sendMessage(request, replyHandler: { [weak self] reply in
            Task { @MainActor in self?.handlePhoneConnectionReply(reply, requestId: requestId) }
        }, errorHandler: { [weak self] _ in
            session.transferUserInfo(request)
            Task { @MainActor in
                guard let self, self.activeConnectionRequestId == requestId else { return }
                self.connectionTimeoutTask?.cancel()
                self.queuedConnectionRefresh = true
                self.phoneConnectionState = .waitingForPhone
                self.connectionMessage = "The refresh is queued. Open Thingtime on your iPhone; retrying automatically."
                self.schedulePhoneConnectionRetry(kind: kind)
            }
        })
    }

    private func handlePhoneConnectionReply(_ reply: [String: Any], requestId: String) {
        guard activeConnectionRequestId == requestId else { return }
        connectionTimeoutTask?.cancel()
        do {
            if let incoming = try ThingtimeWatchWire.snapshot(from: reply) {
                applySnapshot(incoming, confirmedContact: true)
                return
            }
        } catch {}
        if let result = ThingtimeWatchWire.connectionResult(from: reply) {
            phoneConnectionState = result.ok ? .connected : .failed
            connectionMessage = result.message
            if result.ok {
                markPhoneContact()
            } else {
                schedulePhoneConnectionRetry()
            }
            return
        }
        phoneConnectionState = .failed
        connectionMessage = "Thingtime on iPhone sent an unreadable connection status."
        schedulePhoneConnectionRetry()
    }

    private func schedulePhoneConnectionRetry(kind: String = "refresh") {
        guard let delay = ThingtimeWatchWire.connectionRetryDelay(afterAttempt: connectionAttempt) else { return }
        connectionAttempt += 1
        connectionRetryTask?.cancel()
        connectionRetryTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            await MainActor.run {
                self?.startPhoneConnectionAttempt(resetBackoff: false, kind: kind)
            }
        }
    }

    private func markPhoneContact() {
        lastPhoneContactAt = Date()
        connectionAttempt = 0
        queuedConnectionRefresh = false
        activeConnectionRequestId = nil
        connectionRetryTask?.cancel()
        connectionTimeoutTask?.cancel()
    }

    private func refreshAuthorizationStatus() async {
        notificationAuthorization = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    private func sendDeviceToken() {
        guard let deviceToken else { return }
        send(["kind": "register-device", "token": deviceToken], guaranteed: true)
    }

    private func restorePendingAttachments() {
        let decoder = JSONDecoder()
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: Self.attachmentQueueDirectory,
            includingPropertiesForKeys: nil
        ) else { return }
        for file in files where file.pathExtension == "json" {
            guard let data = try? Data(contentsOf: file),
                  let metadata = try? decoder.decode(ThingtimeWatchAttachmentMetadata.self, from: data),
                  FileManager.default.fileExists(atPath: Self.payloadURL(for: metadata).path) else { continue }
            pendingAttachments[metadata.requestId] = metadata
        }
        attachmentIsBusy = false
        if !pendingAttachments.isEmpty {
            attachmentStatusMessage = "\(pendingAttachments.count) saved attachment\(pendingAttachments.count == 1 ? " is" : "s are") ready to retry."
        }
    }

    private func attemptAttachmentTransfers() {
        guard let session, session.activationState == .activated else {
            attachmentIsBusy = false
            if !pendingAttachments.isEmpty { attachmentStatusMessage = "Waiting for your paired iPhone. Tap Retry to check again." }
            return
        }
        let outstanding = Set(session.outstandingFileTransfers.compactMap {
            $0.file.metadata?["requestId"] as? String
        })
        for metadata in pendingAttachments.values where !outstanding.contains(metadata.requestId) {
            let payloadURL = Self.payloadURL(for: metadata)
            guard FileManager.default.fileExists(atPath: payloadURL.path) else { continue }
            session.transferFile(payloadURL, metadata: metadata.transferDictionary)
        }
        attachmentIsBusy = !pendingAttachments.isEmpty
    }

    private func applyAttachmentResult(_ message: [String: Any]) {
        guard message["kind"] as? String == ThingtimeWatchAttachmentTransfer.resultKind,
              let requestId = message["requestId"] as? String else { return }
        markPhoneContact()
        phoneConnectionState = snapshot.authenticated ? .connected : .signedOut
        let success = message["ok"] as? Bool == true
        let filename = message["filename"] as? String ?? pendingAttachments[requestId]?.filename ?? "Attachment"
        attachmentStatusMessage = message["message"] as? String ??
            (success ? "Saved \(filename) as a private Thing." : "Couldn’t upload \(filename).")
        if success, let metadata = pendingAttachments.removeValue(forKey: requestId) {
            try? FileManager.default.removeItem(at: Self.payloadURL(for: metadata))
            try? FileManager.default.removeItem(at: Self.metadataURL(for: metadata))
        }
        attachmentIsBusy = success ? !pendingAttachments.isEmpty : false
    }

    private func send(_ message: [String: Any], guaranteed: Bool = false) {
        guard let session else { return }
        if guaranteed {
            session.transferUserInfo(message)
        }
        if session.isReachable {
            session.sendMessage(message, replyHandler: nil) { [weak self] _ in
                Task { @MainActor in self?.connectionMessage = "Waiting for Thingtime on iPhone…" }
            }
        }
    }

    private func apply(_ message: [String: Any], confirmedContact: Bool = true) {
        do {
            guard let incoming = try ThingtimeWatchWire.snapshot(from: message) else { return }
            applySnapshot(incoming, confirmedContact: confirmedContact)
        } catch {
            connectionMessage = "Thingtime sent an unreadable watch update."
            phoneConnectionState = .failed
        }
    }

    private func applySnapshot(_ incoming: ThingtimeWatchSnapshot, confirmedContact: Bool) {
        snapshot = incoming
        guard confirmedContact else {
            connectionMessage = incoming.authenticated
                ? "Checking the last known iPhone connection…"
                : incoming.message
            return
        }
        markPhoneContact()
        if incoming.authenticated {
            phoneConnectionState = .connected
            connectionMessage = "Thingtime is signed in and connected through your iPhone."
        } else {
            phoneConnectionState = .signedOut
            connectionMessage = incoming.message ?? "Open Thingtime on your iPhone and sign in."
        }
    }

    nonisolated private static var notificationArchiveDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("NotificationArchives", isDirectory: true)
    }

    nonisolated private static func persistNotificationArchive(_ file: WCSessionFile) throws -> ThingtimeWatchNotificationArchive {
        guard file.metadata?[ThingtimeWatchWire.kindKey] as? String == ThingtimeWatchNotificationHistory.archiveFileKind else {
            throw ThingtimeWatchNotificationHistoryError.invalidRequest
        }
        let data = try Data(contentsOf: file.fileURL)
        let archive = try JSONDecoder().decode(ThingtimeWatchNotificationArchive.self, from: data)
        guard UUID(uuidString: archive.requestId) != nil,
              archive.notifications.count <= ThingtimeWatchNotificationHistory.maximumArchiveNotifications,
              file.metadata?["requestId"] as? String == archive.requestId,
              file.metadata?["from"] as? String == archive.from,
              file.metadata?["to"] as? String == archive.to,
              (file.metadata?["count"] as? NSNumber)?.intValue == archive.notifications.count else {
            throw ThingtimeWatchNotificationHistoryError.invalidRequest
        }
        try persistNotificationArchive(archive)
        return archive
    }

    nonisolated private static func persistNotificationArchive(_ archive: ThingtimeWatchNotificationArchive) throws {
        try FileManager.default.createDirectory(at: notificationArchiveDirectory, withIntermediateDirectories: true)
        let destination = notificationArchiveDirectory.appendingPathComponent(archive.requestId).appendingPathExtension("json")
        try JSONEncoder().encode(archive).write(to: destination, options: .atomic)
    }

    nonisolated private static func loadLatestNotificationArchive() -> ThingtimeWatchNotificationArchive? {
        guard let urls = try? FileManager.default.contentsOfDirectory(
            at: notificationArchiveDirectory,
            includingPropertiesForKeys: [.contentModificationDateKey]
        ) else { return nil }
        let latest = urls.filter { $0.pathExtension == "json" }.max {
            let left = (try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            let right = (try? $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            return left < right
        }
        guard let latest, let data = try? Data(contentsOf: latest) else { return nil }
        return try? JSONDecoder().decode(ThingtimeWatchNotificationArchive.self, from: data)
    }

    nonisolated private static var attachmentQueueDirectory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("WatchAttachmentQueue", isDirectory: true)
    }

    nonisolated private static func payloadURL(for metadata: ThingtimeWatchAttachmentMetadata) -> URL {
        let suffix = URL(fileURLWithPath: metadata.filename).pathExtension
        return attachmentQueueDirectory
            .appendingPathComponent(metadata.requestId)
            .appendingPathExtension(suffix.isEmpty ? "payload" : suffix)
    }

    nonisolated private static func metadataURL(for metadata: ThingtimeWatchAttachmentMetadata) -> URL {
        attachmentQueueDirectory.appendingPathComponent(metadata.requestId).appendingPathExtension("json")
    }

    nonisolated private static func persistAttachment(data: Data, metadata: ThingtimeWatchAttachmentMetadata) throws {
        let fileManager = FileManager.default
        try fileManager.createDirectory(at: attachmentQueueDirectory, withIntermediateDirectories: true)
        try data.write(to: payloadURL(for: metadata), options: .atomic)
        try JSONEncoder().encode(metadata).write(to: metadataURL(for: metadata), options: .atomic)
    }

    nonisolated private static func persistAttachment(sourceURL: URL, metadata: ThingtimeWatchAttachmentMetadata) throws {
        let fileManager = FileManager.default
        try fileManager.createDirectory(at: attachmentQueueDirectory, withIntermediateDirectories: true)
        let destination = payloadURL(for: metadata)
        if fileManager.fileExists(atPath: destination.path) { try fileManager.removeItem(at: destination) }
        try fileManager.copyItem(at: sourceURL, to: destination)
        try JSONEncoder().encode(metadata).write(to: metadataURL(for: metadata), options: .atomic)
    }

    private func finishTransfer(requestId: String, error: Error?) {
        guard let metadata = pendingAttachments[requestId] else { return }
        if let error {
            attachmentIsBusy = false
            attachmentStatusMessage = "Couldn’t send \(metadata.filename): \(error.localizedDescription)"
            return
        }
        attachmentIsBusy = true
        attachmentStatusMessage = "Sent \(metadata.filename). Uploading on iPhone…"
    }
}

extension ThingtimeWatchStore: WCSessionDelegate {
    nonisolated func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        Task { @MainActor in
            if error != nil || activationState != .activated {
                self.phoneConnectionState = .failed
                self.connectionMessage = "The iPhone connection couldn’t activate. Tap Retry to try again."
                self.schedulePhoneConnectionRetry()
                return
            }
            if let context = session.receivedApplicationContext as [String: Any]? {
                self.apply(context, confirmedContact: false)
            }
            self.sendDeviceToken()
            self.attemptAttachmentTransfers()
            self.startPhoneConnectionAttempt(resetBackoff: true)
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        Task { @MainActor in self.apply(applicationContext, confirmedContact: true) }
    }

    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        Task { @MainActor in
            if userInfo[ThingtimeWatchWire.kindKey] as? String == ThingtimeWatchAttachmentTransfer.resultKind {
                self.applyAttachmentResult(userInfo)
            } else if userInfo[ThingtimeWatchWire.kindKey] as? String == ThingtimeWatchNotificationHistory.pageKind {
                self.applyHistoryPage(userInfo)
            } else if userInfo[ThingtimeWatchWire.kindKey] as? String == ThingtimeWatchNotificationHistory.errorKind {
                self.applyHistoryError(userInfo)
            } else {
                self.apply(userInfo)
            }
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        Task { @MainActor in
            if message[ThingtimeWatchWire.kindKey] as? String == ThingtimeWatchAttachmentTransfer.resultKind {
                self.applyAttachmentResult(message)
            } else if message[ThingtimeWatchWire.kindKey] as? String == ThingtimeWatchNotificationHistory.pageKind {
                self.applyHistoryPage(message)
            } else if message[ThingtimeWatchWire.kindKey] as? String == ThingtimeWatchNotificationHistory.errorKind {
                self.applyHistoryError(message)
            }
        }
    }

    nonisolated func session(_ session: WCSession, didReceive file: WCSessionFile) {
        guard file.metadata?[ThingtimeWatchWire.kindKey] as? String == ThingtimeWatchNotificationHistory.archiveFileKind else { return }
        do {
            let archive = try Self.persistNotificationArchive(file)
            Task { @MainActor in self.applyDownloadedArchive(archive) }
        } catch {
            Task { @MainActor in
                self.historyIsLoading = false
                self.historyStatusMessage = "The downloaded notification archive was invalid."
            }
        }
    }

    nonisolated func session(
        _ session: WCSession,
        fileTransfer: WCSessionFileTransfer,
        didFinishWithError error: Error?
    ) {
        let requestId = fileTransfer.file.metadata?["requestId"] as? String
        Task { @MainActor in
            if let requestId { self.finishTransfer(requestId: requestId, error: error) }
        }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        Task { @MainActor in
            if session.isReachable {
                self.startPhoneConnectionAttempt(resetBackoff: true)
            } else if self.phoneConnectionState != .signedOut {
                self.phoneConnectionState = .waitingForPhone
                self.connectionMessage = "Open Thingtime on your iPhone; reconnecting automatically."
                self.schedulePhoneConnectionRetry()
            }
        }
    }
}
