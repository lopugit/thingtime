import Foundation
import UserNotifications
import WatchConnectivity
import WatchKit

@MainActor
final class ThingtimeWatchStore: NSObject, ObservableObject {
    static let shared = ThingtimeWatchStore()

    @Published private(set) var snapshot: ThingtimeWatchSnapshot = .signedOut
    @Published private(set) var notificationAuthorization: UNAuthorizationStatus = .notDetermined
    @Published private(set) var connectionMessage: String?
    @Published private(set) var attachmentStatusMessage: String?
    @Published private(set) var attachmentIsBusy = false

    private let session: WCSession? = WCSession.isSupported() ? .default : nil
    private var deviceToken: String?
    private var pendingAttachments: [String: ThingtimeWatchAttachmentMetadata] = [:]

    private override init() {
        super.init()
    }

    func activate() {
        session?.delegate = self
        session?.activate()
        if let context = session?.receivedApplicationContext {
            apply(context)
        }
        restorePendingAttachments()
        attemptAttachmentTransfers()
        Task { await refreshAuthorizationStatus() }
    }

    func requestRefresh() {
        send(["kind": "refresh"])
    }

    func requestPairing() {
        connectionMessage = "Open Thingtime on your iPhone and sign in. This watch will pair automatically."
        send(["kind": "pair"])
    }

    func markRead(id: String) {
        guard let index = snapshot.notifications.firstIndex(where: { $0.id == id }) else { return }
        let current = snapshot.notifications[index]
        guard current.isUnread else { return }

        var notifications = snapshot.notifications
        notifications[index] = ThingtimeWatchNotification(
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
        snapshot = ThingtimeWatchSnapshot(
            authenticated: true,
            unreadCount: max(0, snapshot.unreadCount - 1),
            notifications: notifications,
            syncedAt: snapshot.syncedAt,
            message: nil
        )
        send(["kind": "mark-read", "ids": [id]], guaranteed: true)
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
        attachmentIsBusy = !pendingAttachments.isEmpty
        attemptAttachmentTransfers()
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
        attachmentIsBusy = !pendingAttachments.isEmpty
        if attachmentIsBusy {
            attachmentStatusMessage = "Waiting to send \(pendingAttachments.count) attachment\(pendingAttachments.count == 1 ? "" : "s")…"
        }
    }

    private func attemptAttachmentTransfers() {
        guard let session, session.activationState == .activated else {
            attachmentIsBusy = !pendingAttachments.isEmpty
            if attachmentIsBusy { attachmentStatusMessage = "Waiting for your paired iPhone…" }
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

    private func apply(_ message: [String: Any]) {
        do {
            guard let incoming = try ThingtimeWatchWire.snapshot(from: message) else { return }
            snapshot = incoming
            connectionMessage = incoming.message
        } catch {
            connectionMessage = "Thingtime sent an unreadable watch update."
        }
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
            if let context = session.receivedApplicationContext as [String: Any]? {
                self.apply(context)
            }
            self.sendDeviceToken()
            self.requestRefresh()
            self.attemptAttachmentTransfers()
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        Task { @MainActor in self.apply(applicationContext) }
    }

    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        Task { @MainActor in
            if userInfo["kind"] as? String == ThingtimeWatchAttachmentTransfer.resultKind {
                self.applyAttachmentResult(userInfo)
            } else {
                self.apply(userInfo)
            }
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        Task { @MainActor in
            if message["kind"] as? String == ThingtimeWatchAttachmentTransfer.resultKind {
                self.applyAttachmentResult(message)
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
}
