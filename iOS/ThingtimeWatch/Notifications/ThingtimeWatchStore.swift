import Foundation
import UserNotifications
import WatchKit
import WatchConnectivity

enum ThingtimeWatchApprovalMethod: String, CaseIterable, Identifiable {
    case phone, username, code
    var id: String { rawValue }
    var title: String {
        switch self {
        case .phone: "Paired iPhone account"
        case .username: "Enter a username"
        case .code: "Use a code / link"
        }
    }
}

enum ThingtimeWatchFavorite: String, CaseIterable, Identifiable, Codable {
    case record
    case savedRecordings
    case photos
    case history

    var id: String { rawValue }
    var title: String {
        switch self {
        case .record: "Record"
        case .savedRecordings: "Saved recordings"
        case .photos: "Photos & screenshots"
        case .history: "Notification history"
        }
    }
    var systemImage: String {
        switch self {
        case .record: "mic.circle.fill"
        case .savedRecordings: "waveform.badge.magnifyingglass"
        case .photos: "photo.on.rectangle.angled"
        case .history: "calendar.badge.clock"
        }
    }
}

@MainActor
final class ThingtimeWatchStore: NSObject, ObservableObject {
    static let shared = ThingtimeWatchStore()

    enum ConnectionState: Equatable {
        case ready
        case checking
        case connected
        case offline
        case signedOut
        case failed

        var title: String {
            switch self {
            case .ready: "Ready to check"
            case .checking: "Checking Thingtime"
            case .connected: "Directly connected"
            case .offline: "Thingtime unreachable"
            case .signedOut: "Connect an account"
            case .failed: "Connection needs attention"
            }
        }

        var systemImage: String {
            switch self {
            case .ready: "network"
            case .checking: "arrow.trianglehead.2.clockwise.rotate.90"
            case .connected: "checkmark.icloud.fill"
            case .offline: "wifi.slash"
            case .signedOut: "person.crop.circle.badge.plus"
            case .failed: "exclamationmark.icloud"
            }
        }
    }

    @Published private(set) var snapshot: ThingtimeWatchSnapshot = .signedOut
    @Published private(set) var accounts: [ThingtimeWatchAccount] = []
    @Published private(set) var selectedAccountID: String?
    @Published private(set) var notificationAuthorization: UNAuthorizationStatus = .notDetermined
    @Published private(set) var connectionMessage: String?
    @Published private(set) var connectionState: ConnectionState = .signedOut
    @Published private(set) var lastConnectionCheckAt: Date?
    @Published private(set) var lastServerContactAt: Date?
    @Published private(set) var pendingPairing: ThingtimeWatchPairingRequest?
    @Published private(set) var pairingDomain: ThingtimeWatchDomain = .production
    @Published private(set) var isPairing = false
    @Published private(set) var approvalMethod: ThingtimeWatchApprovalMethod = .phone
    @Published var pairingUsername = ""
    @Published private(set) var approvalDeliveryMessage: String?
    @Published private(set) var attachmentStatusMessage: String?
    @Published private(set) var attachmentIsBusy = false
    @Published private(set) var historyNotifications: [ThingtimeWatchNotification] = []
    @Published private(set) var historyStatusMessage: String?
    @Published private(set) var historyIsLoading = false
    @Published private(set) var historyNextCursor: String?
    @Published private(set) var downloadedHistoryCount = 0
    @Published private(set) var favorites: [ThingtimeWatchFavorite] = [.record]

    let audioRecorder = ThingtimeWatchAudioRecorder()

    var selectedAccount: ThingtimeWatchAccount? {
        accounts.first(where: { $0.id == selectedAccountID })
    }
    var isCheckingConnection: Bool { connectionState == .checking || isPairing }
    var canLoadOlderInbox: Bool { snapshot.nextCursor != nil }
    var canLoadMoreHistory: Bool { historyNextCursor != nil || downloadedVisibleCount < downloadedArchive.count }
    var canRetryHistory: Bool { lastHistoryWindow != nil && !historyIsLoading }
    var canRetryAttachments: Bool { pendingUploads.contains(where: { $0.accountID == selectedAccountID }) && !attachmentIsBusy }

    private var deviceToken: String?
    private var refreshTask: Task<Void, Never>?
    private var pairingTask: Task<Void, Never>?
    private let approvalSession = WCSession.isSupported() ? WCSession.default : nil
    private var lastHistoryWindow: (from: String, to: String, archive: Bool)?
    private var downloadedArchive: [ThingtimeWatchNotification] = []
    private var downloadedVisibleCount = 0
    private var pendingUploads: [PendingUpload] = []

    private static let favoriteKey = "watch.favorite-actions.v1"
    private static let domainKey = "watch.pairing-domain.v1"
    private static let pendingUploadsKey = "watch.direct.pending-uploads.v1"

    private override init() {
        super.init()
        accounts = ThingtimeWatchAccountStorage.loadAccounts()
        let storedSelection = ThingtimeWatchAccountStorage.selectedAccountID
        selectedAccountID = accounts.contains(where: { $0.id == storedSelection }) ? storedSelection : accounts.first?.id
        if let selectedAccountID { ThingtimeWatchAccountStorage.selectedAccountID = selectedAccountID }
        if let domain = UserDefaults.standard.string(forKey: Self.domainKey).flatMap(ThingtimeWatchDomain.init(rawValue:)) {
            pairingDomain = domain
        } else if ThingtimeWatchDomain.availableCases.contains(.buildPreview) {
            pairingDomain = .buildPreview
        }
        loadFavorites()
        pendingUploads = Self.loadPendingUploads()
        restoreSnapshot()
#if DEBUG
        if ProcessInfo.processInfo.environment["THINGTIME_WATCH_DIRECT_PREVIEW"] == "1" {
            let preview = ThingtimeWatchAccount(
                id: "preview-account",
                origin: ThingtimeWatchDomain.development.rawValue,
                userId: "preview-user",
                deviceId: "preview-watch",
                username: "lopu",
                displayName: "Lopu",
                avatarURL: nil
            )
            accounts = [preview]
            selectedAccountID = preview.id
            favorites = [.record, .savedRecordings]
            snapshot = ThingtimeWatchSnapshot(
                authenticated: true,
                unreadCount: 2,
                notifications: [],
                syncedAt: ISO8601DateFormatter().string(from: Date()),
                message: nil,
                accountUsername: preview.username,
                phoneOrigin: preview.origin,
                phoneBuild: nil
            )
            connectionState = .connected
            connectionMessage = "Live check succeeded with dev.thingtime.com."
            lastConnectionCheckAt = Date().addingTimeInterval(-8)
            lastServerContactAt = Date().addingTimeInterval(-7)
        }
#endif
    }

    func activate() {
        approvalSession?.delegate = self
        approvalSession?.activate()
        audioRecorder.refresh()
        Task { await refreshAuthorizationStatus() }
#if DEBUG
        if ProcessInfo.processInfo.environment["THINGTIME_WATCH_DIRECT_PREVIEW"] == "1" { return }
#endif
        if pendingPairing != nil || isPairing {
            requestRefresh()
        } else if selectedAccount != nil {
            requestRefresh()
            retryAttachmentTransfers()
        } else {
            connectionState = .signedOut
            connectionMessage = "Connect this Watch directly to Thingtime.com or Dev Thingtime."
        }
    }

    func requestRefresh() {
#if DEBUG
        if ProcessInfo.processInfo.environment["THINGTIME_WATCH_DIRECT_PREVIEW"] == "1" {
            connectionState = .connected
            connectionMessage = "Live check succeeded with dev.thingtime.com."
            lastConnectionCheckAt = Date()
            lastServerContactAt = Date()
            return
        }
#endif
        if pendingPairing != nil {
            retryPairingApproval()
            return
        }
        guard !isPairing else { return }
        guard refreshTask == nil else { return }
        guard let account = selectedAccount,
              let credential = ThingtimeWatchAccountStorage.credential(for: account.id) else {
            connectionState = .signedOut
            connectionMessage = "Connect a Thingtime account on this Watch."
            return
        }
        connectionState = .checking
        connectionMessage = "Contacting \(account.domain) directly…"
        lastConnectionCheckAt = Date()
        refreshTask = Task { [weak self] in
            guard let self else { return }
            defer { refreshTask = nil }
            do {
                let client = try ThingtimeWatchAPIClient(origin: account.origin, credential: credential)
                let result = try await client.sync(account: account)
                guard !Task.isCancelled else { return }
                applySync(result)
                await registerPushIfPossible(client: client)
            } catch is CancellationError {
                return
            } catch {
                guard !Task.isCancelled else { return }
                connectionState = (error as? ThingtimeWatchAPIError)?.isUnauthorized == true ? .failed : .offline
                connectionMessage = error.localizedDescription
            }
        }
    }

    func setPairingDomain(_ domain: ThingtimeWatchDomain) {
        guard domain != pairingDomain else { return }
        pairingTask?.cancel()
        pairingTask = nil
        pendingPairing = nil
        approvalDeliveryMessage = nil
        isPairing = false
        pairingDomain = domain
        UserDefaults.standard.set(domain.rawValue, forKey: Self.domainKey)
        connectionState = .ready
        connectionMessage = "Create a new code for \(domain.host)."
    }

    func requestPairing() {
        pairingTask?.cancel()
        refreshTask?.cancel()
        let domain = pairingDomain
        let method = approvalMethod
        let targetUsername = pairingUsername.trimmingCharacters(in: .whitespacesAndNewlines)
        if method == .username && targetUsername.isEmpty {
            connectionState = .failed
            connectionMessage = "Enter your Thingtime username first."
            return
        }
        pendingPairing = nil
        approvalDeliveryMessage = nil
        isPairing = true
        connectionState = .checking
        connectionMessage = "Creating a secure code on \(pairingDomain.host)…"
        pairingTask = Task { [weak self] in
            guard let self else { return }
            do {
                let client = try ThingtimeWatchAPIClient(origin: domain.origin)
                let pairing = try await client.startPairing(targetUsername: method == .username ? targetUsername : nil)
                guard !Task.isCancelled else { return }
                pendingPairing = pairing
                connectionState = .ready
                connectionMessage = "On your phone or computer, open the address below and enter this code."
                isPairing = false
                if method == .phone { sendPendingApproval() }
                else if method == .username { approvalDeliveryMessage = "Sign in as \(targetUsername) on \(domain.host), then tap Approve Watch." }
                await pollPairing(pairing, origin: domain.origin)
            } catch is CancellationError {
                return
            } catch {
                guard !Task.isCancelled else { return }
                isPairing = false
                connectionState = .failed
                if case .incompatible = error as? ThingtimeWatchAPIError {
                    let hint = domain != .buildPreview && ThingtimeWatchDomain.availableCases.contains(.buildPreview)
                        ? " Choose Build preview for this test build." : " Try again after the preview finishes updating."
                    connectionMessage = "Direct Watch sign-in is not available on \(domain.host) yet.\(hint)"
                } else {
                    connectionMessage = error.localizedDescription
                }
            }
        }
    }

    func retryPairingApproval() {
        guard let pendingPairing else { return }
        pairingTask?.cancel()
        connectionState = .checking
        connectionMessage = "Checking approval…"
        pairingTask = Task { [weak self] in
            await self?.pollPairing(pendingPairing, origin: pendingPairing.verificationURL.absoluteString)
        }
    }

    func setApprovalMethod(_ method: ThingtimeWatchApprovalMethod) {
        guard method != approvalMethod else { return }
        pairingTask?.cancel()
        pendingPairing = nil
        isPairing = false
        approvalDeliveryMessage = nil
        approvalMethod = method
        connectionState = .ready
        connectionMessage = "Create a new code to connect this Watch."
    }

    func sendPendingApproval() {
        guard approvalMethod == .phone, let pairing = pendingPairing, let session = approvalSession else { return }
        approvalDeliveryMessage = "Open Thingtime on your paired iPhone, signed in on \(pairing.verificationURL.host ?? "the same domain"). Your sessions will show an Approve Watch button."
        guard session.activationState == .activated else { return }
        let handoff = ThingtimeWatchApprovalHandoff(pairingID: pairing.pairingID, userCode: pairing.userCode, approvalToken: pairing.approvalToken, origin: pairingDomain.origin, expiresAt: pairing.expiresAt)
        do { try session.updateApplicationContext(handoff.message) }
        catch { approvalDeliveryMessage = "Couldn’t send to iPhone. Retry below, or use the short link." }
        if session.isReachable {
            session.sendMessage(handoff.message, replyHandler: { [weak self] reply in
                Task { @MainActor in
                    guard let self, self.pendingPairing?.pairingID == pairing.pairingID else { return }
                    if reply["ok"] as? Bool == true, let username = reply["username"] as? String {
                        self.approvalDeliveryMessage = "Sent to @\(username). Tap Approve Watch in any signed-in session on the same domain."
                    } else if let message = reply["message"] as? String { self.approvalDeliveryMessage = message }
                }
            }, errorHandler: { _ in /* Application context remains queued for the paired phone. */ })
        }
    }

    func selectAccount(_ id: String) {
        guard accounts.contains(where: { $0.id == id }) else { return }
        pairingTask?.cancel()
        pendingPairing = nil
        isPairing = false
        refreshTask?.cancel()
        selectedAccountID = id
        ThingtimeWatchAccountStorage.selectedAccountID = id
        restoreSnapshot()
        connectionState = .ready
        connectionMessage = "Selected \(selectedAccount?.displayUsername ?? "Thingtime account")."
        requestRefresh()
    }

    func removeAccount(_ id: String) {
        ThingtimeWatchAccountStorage.removeCredential(for: id)
        accounts.removeAll(where: { $0.id == id })
        ThingtimeWatchAccountStorage.saveAccounts(accounts)
        if selectedAccountID == id {
            selectedAccountID = accounts.first?.id
            ThingtimeWatchAccountStorage.selectedAccountID = selectedAccountID
            restoreSnapshot()
        }
        if selectedAccount == nil {
            snapshot = .signedOut
            connectionState = .signedOut
            connectionMessage = "Account removed from this Watch."
        } else {
            requestRefresh()
        }
    }

    func setFavorite(_ favorite: ThingtimeWatchFavorite, enabled: Bool) {
        var values = Set(favorites)
        if enabled { values.insert(favorite) } else { values.remove(favorite) }
        favorites = ThingtimeWatchFavorite.allCases.filter(values.contains)
        UserDefaults.standard.set(favorites.map(\.rawValue), forKey: Self.favoriteKey)
    }

    func markRead(id: String) {
        guard let current = snapshot.notifications.first(where: { $0.id == id }) ?? historyNotifications.first(where: { $0.id == id }),
              current.isUnread else { return }
        let updated = current.markedRead(at: ISO8601DateFormatter().string(from: Date()))
        snapshot = ThingtimeWatchSnapshot(
            authenticated: true,
            unreadCount: max(0, snapshot.unreadCount - 1),
            notifications: snapshot.notifications.map { $0.id == id ? updated : $0 },
            nextCursor: snapshot.nextCursor,
            syncedAt: snapshot.syncedAt,
            message: nil,
            accountUsername: selectedAccount?.username,
            phoneOrigin: selectedAccount?.origin,
            phoneBuild: nil
        )
        historyNotifications = historyNotifications.map { $0.id == id ? updated : $0 }
        persistSnapshot()
        Task { [weak self] in
            guard let self, let client = currentClient() else { return }
            do { try await client.markRead(ids: [id]) }
            catch { connectionMessage = "Marked locally; server retry needed: \(error.localizedDescription)" }
        }
    }

    func requestOlderNotifications() {
        guard let cursor = snapshot.nextCursor else { return }
        Task { [weak self] in
            guard let self, let account = selectedAccount, let client = currentClient() else { return }
            historyIsLoading = true
            defer { historyIsLoading = false }
            do {
                let result = try await client.sync(account: account, cursor: cursor, limit: ThingtimeWatchNotificationHistory.pageSize)
                snapshot = ThingtimeWatchSnapshot(
                    authenticated: true,
                    unreadCount: result.unreadCount,
                    notifications: Self.merged(snapshot.notifications, result.notifications),
                    nextCursor: result.nextCursor,
                    syncedAt: result.serverTime,
                    message: nil,
                    accountUsername: result.account.username,
                    phoneOrigin: result.account.origin,
                    phoneBuild: nil
                )
                persistSnapshot()
            } catch { historyStatusMessage = error.localizedDescription }
        }
    }

    func fetchHistory(from: String, to: String) {
        lastHistoryWindow = (from, to, false)
        downloadedArchive = []
        downloadedVisibleCount = 0
        downloadedHistoryCount = 0
        historyNotifications = []
        historyNextCursor = nil
        requestHistoryPage(from: from, to: to, cursor: nil, append: false)
    }

    func loadMoreHistory() {
        if downloadedVisibleCount < downloadedArchive.count {
            downloadedVisibleCount = min(downloadedVisibleCount + ThingtimeWatchNotificationHistory.pageSize, downloadedArchive.count)
            historyNotifications = Array(downloadedArchive.prefix(downloadedVisibleCount))
            historyStatusMessage = "Showing \(historyNotifications.count) of \(downloadedArchive.count) downloaded notifications."
            return
        }
        guard let window = lastHistoryWindow, let cursor = historyNextCursor else { return }
        requestHistoryPage(from: window.from, to: window.to, cursor: cursor, append: true)
    }

    func downloadHistory(from: String, to: String) {
        lastHistoryWindow = (from, to, true)
        historyIsLoading = true
        historyStatusMessage = "Downloading directly from Thingtime…"
        Task { [weak self] in
            guard let self, let account = selectedAccount, let client = currentClient() else {
                self?.historyIsLoading = false
                return
            }
            defer { historyIsLoading = false }
            do {
                var all: [ThingtimeWatchNotification] = []
                var cursor: String?
                repeat {
                    let page = try await client.sync(account: account, cursor: cursor, from: from, to: to, limit: 50)
                    all = Self.merged(all, page.notifications)
                    cursor = page.nextCursor
                } while cursor != nil && all.count < ThingtimeWatchNotificationHistory.maximumArchiveNotifications && !Task.isCancelled
                downloadedArchive = Array(all.prefix(ThingtimeWatchNotificationHistory.maximumArchiveNotifications))
                downloadedVisibleCount = min(ThingtimeWatchNotificationHistory.pageSize, downloadedArchive.count)
                historyNotifications = Array(downloadedArchive.prefix(downloadedVisibleCount))
                downloadedHistoryCount = downloadedArchive.count
                historyNextCursor = nil
                persistHistoryArchive(downloadedArchive)
                historyStatusMessage = "Downloaded \(downloadedArchive.count) notifications directly to this Watch."
            } catch is CancellationError {
                return
            } catch { historyStatusMessage = error.localizedDescription }
        }
    }

    func retryHistoryRequest() {
        guard let window = lastHistoryWindow else { return }
        if window.archive { downloadHistory(from: window.from, to: window.to) }
        else { fetchHistory(from: window.from, to: window.to) }
    }

    func queueAttachment(fileURL: URL, filename: String, contentType: String) async {
        do {
            let data = try await Task.detached { try Data(contentsOf: fileURL, options: .mappedIfSafe) }.value
            await queueAttachment(data: data, filename: filename, contentType: contentType)
        } catch { attachmentStatusMessage = "The recording is saved, but Thingtime couldn’t prepare it: \(error.localizedDescription)" }
    }

    func queueAttachment(data: Data, filename: String, contentType: String) async {
        guard let account = selectedAccount else {
            attachmentStatusMessage = "Connect a Thingtime account before uploading."
            return
        }
        do {
            let metadata = try ThingtimeWatchAttachmentTransfer.makeMetadata(filename: filename, contentType: contentType, sizeBytes: Int64(data.count))
            let directory = try Self.outboxDirectory()
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let file = directory.appendingPathComponent(metadata.requestId).appendingPathExtension(URL(fileURLWithPath: filename).pathExtension)
            try data.write(to: file, options: .atomic)
            pendingUploads.append(PendingUpload(accountID: account.id, metadata: metadata, filename: file.lastPathComponent))
            persistPendingUploads()
            attachmentStatusMessage = "Uploading \(filename) directly to \(account.domain)…"
            retryAttachmentTransfers()
        } catch { attachmentStatusMessage = error.localizedDescription }
    }

    func retryAttachmentTransfers() {
        guard !attachmentIsBusy else { return }
        guard let account = selectedAccount, let client = currentClient() else { return }
        let items = pendingUploads.filter { $0.accountID == account.id }
        guard !items.isEmpty else { return }
        attachmentIsBusy = true
        Task { [weak self] in
            guard let self else { return }
            defer { attachmentIsBusy = false }
            for item in items {
                do {
                    let file = try Self.outboxDirectory().appendingPathComponent(item.filename)
                    let data = try Data(contentsOf: file, options: .mappedIfSafe)
                    _ = try await client.upload(data: data, metadata: item.metadata)
                    try? FileManager.default.removeItem(at: file)
                    pendingUploads.removeAll(where: { $0.id == item.id })
                    persistPendingUploads()
                    attachmentStatusMessage = "Saved \(item.metadata.filename) as a private Thing."
                    lastServerContactAt = Date()
                    connectionState = .connected
                } catch {
                    attachmentStatusMessage = error.localizedDescription
                    connectionState = .offline
                    break
                }
            }
        }
    }

    func setDeviceToken(_ token: String) {
        deviceToken = token
        Task { [weak self] in
            guard let self, let client = currentClient() else { return }
            await registerPushIfPossible(client: client)
        }
    }

    func recordRegistrationFailure(_ error: Error) {
        connectionMessage = "Push registration will retry later: \(error.localizedDescription)"
    }

    func enableAlerts() async {
        do {
            _ = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
            await refreshAuthorizationStatus()
            WKApplication.shared().registerForRemoteNotifications()
        } catch { connectionMessage = error.localizedDescription }
    }

    func refreshAuthorizationStatus() async {
        notificationAuthorization = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    private func pollPairing(_ pairing: ThingtimeWatchPairingRequest, origin: String) async {
        do {
            let client = try ThingtimeWatchAPIClient(origin: origin)
            let expiresAt = Self.parseDate(pairing.expiresAt) ?? Date().addingTimeInterval(600)
            var retryDelay: Double = 3
            while !Task.isCancelled {
                guard Date() < expiresAt else {
                    pendingPairing = nil
                    connectionState = .failed
                    connectionMessage = "The code expired. Create a new code, then enter it on your phone or computer."
                    return
                }
                do {
                    let account = try await client.claimPairing(pairing)
                    try Task.checkCancellation()
                    try ThingtimeWatchAccountStorage.storeCredential(pairing.credential, for: account.id)
                    accounts.removeAll(where: { $0.id == account.id })
                    accounts.insert(account, at: 0)
                    ThingtimeWatchAccountStorage.saveAccounts(accounts)
                    selectedAccountID = account.id
                    ThingtimeWatchAccountStorage.selectedAccountID = account.id
                    pendingPairing = nil
                    isPairing = false
                    snapshot = .signedOut
                    connectionMessage = "Connected \(account.displayUsername) directly to \(account.domain)."
                    connectionState = .ready
                    requestRefresh()
                    return
                } catch let error as ThingtimeWatchAPIError where error.isAuthorizationPending {
                    try Task.checkCancellation()
                    connectionState = .ready
                    connectionMessage = "Waiting for approval on your phone or computer…"
                    lastConnectionCheckAt = Date()
                    retryDelay = 3
                } catch {
                    try Task.checkCancellation()
                    guard (error as? ThingtimeWatchAPIError)?.isRetryablePairingError == true || error is URLError else { throw error }
                    retryDelay = min(retryDelay * 2, 15)
                    connectionState = .offline
                    connectionMessage = "Connection interrupted. Retrying in \(Int(retryDelay)) seconds. Your code is still valid."
                }
                try await Task.sleep(for: .seconds(retryDelay))
            }
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            isPairing = false
            connectionState = .failed
            connectionMessage = error.localizedDescription
        }
    }

    private static func parseDate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }

    private func applySync(_ result: ThingtimeWatchSyncResult) {
        if let index = accounts.firstIndex(where: { $0.id == result.account.id }) {
            accounts[index] = result.account
            ThingtimeWatchAccountStorage.saveAccounts(accounts)
        }
        snapshot = ThingtimeWatchSnapshot(
            authenticated: true,
            unreadCount: result.unreadCount,
            notifications: result.notifications,
            nextCursor: result.nextCursor,
            syncedAt: result.serverTime,
            message: nil,
            accountUsername: result.account.username,
            phoneOrigin: result.account.origin,
            phoneBuild: nil
        )
        connectionState = .connected
        connectionMessage = "Live check succeeded with \(result.account.domain)."
        lastServerContactAt = Date()
        persistSnapshot()
    }

    private func requestHistoryPage(from: String, to: String, cursor: String?, append: Bool) {
        guard !historyIsLoading else { return }
        historyIsLoading = true
        historyStatusMessage = cursor == nil ? "Fetching the first 10 directly…" : "Fetching 10 more directly…"
        Task { [weak self] in
            guard let self, let account = selectedAccount, let client = currentClient() else {
                self?.historyIsLoading = false
                return
            }
            defer { historyIsLoading = false }
            do {
                let result = try await client.sync(account: account, cursor: cursor, from: from, to: to, limit: ThingtimeWatchNotificationHistory.pageSize)
                historyNotifications = append ? Self.merged(historyNotifications, result.notifications) : result.notifications
                historyNextCursor = result.nextCursor
                historyStatusMessage = "Showing \(historyNotifications.count) notification\(historyNotifications.count == 1 ? "" : "s")."
                lastServerContactAt = Date()
                connectionState = .connected
            } catch { historyStatusMessage = error.localizedDescription }
        }
    }

    private func currentClient() -> ThingtimeWatchAPIClient? {
        guard let account = selectedAccount,
              let credential = ThingtimeWatchAccountStorage.credential(for: account.id) else { return nil }
        return try? ThingtimeWatchAPIClient(origin: account.origin, credential: credential)
    }

    private func registerPushIfPossible(client: ThingtimeWatchAPIClient) async {
        guard let deviceToken else { return }
        do { try await client.registerPushToken(deviceToken) }
        catch { connectionMessage = "Connected; push registration will retry: \(error.localizedDescription)" }
    }

    private func loadFavorites() {
        guard let values = UserDefaults.standard.stringArray(forKey: Self.favoriteKey) else {
            favorites = [.record]
            return
        }
        let selected = Set(values.compactMap(ThingtimeWatchFavorite.init(rawValue:)))
        favorites = ThingtimeWatchFavorite.allCases.filter(selected.contains)
    }

    private func snapshotKey() -> String? { selectedAccountID.map { "watch.direct.snapshot.v1.\($0)" } }

    private func restoreSnapshot() {
        guard let key = snapshotKey(),
              let data = UserDefaults.standard.data(forKey: key),
              let value = try? JSONDecoder().decode(ThingtimeWatchSnapshot.self, from: data) else {
            snapshot = .signedOut
            return
        }
        snapshot = value
    }

    private func persistSnapshot() {
        guard let key = snapshotKey(), let data = try? JSONEncoder().encode(snapshot) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }

    private func historyKey() -> String? { selectedAccountID.map { "watch.direct.history.v1.\($0)" } }

    private func persistHistoryArchive(_ values: [ThingtimeWatchNotification]) {
        guard let key = historyKey(), let data = try? JSONEncoder().encode(values) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }

    private static func merged(_ first: [ThingtimeWatchNotification], _ second: [ThingtimeWatchNotification]) -> [ThingtimeWatchNotification] {
        var seen = Set<String>()
        return (first + second).filter { seen.insert($0.id).inserted }
    }

    private struct PendingUpload: Codable, Identifiable {
        let accountID: String
        let metadata: ThingtimeWatchAttachmentMetadata
        let filename: String
        var id: String { metadata.requestId }
    }

    private static func loadPendingUploads() -> [PendingUpload] {
        guard let data = UserDefaults.standard.data(forKey: pendingUploadsKey),
              let values = try? JSONDecoder().decode([PendingUpload].self, from: data) else { return [] }
        return values
    }

    private func persistPendingUploads() {
        if let data = try? JSONEncoder().encode(pendingUploads) {
            UserDefaults.standard.set(data, forKey: Self.pendingUploadsKey)
        }
    }

    nonisolated private static func outboxDirectory() throws -> URL {
        guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            throw ThingtimeWatchAPIError.fileChanged
        }
        return base.appendingPathComponent("ThingtimeWatchOutbox", isDirectory: true)
    }
}

extension ThingtimeWatchStore: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        Task { @MainActor in self.sendPendingApproval() }
    }
}

private extension ThingtimeWatchNotification {
    func markedRead(at date: String) -> ThingtimeWatchNotification {
        ThingtimeWatchNotification(
            id: id,
            type: type,
            actorUsername: actorUsername,
            actorName: actorName,
            targetId: targetId,
            postId: postId,
            preview: preview,
            readAt: date,
            createdAt: createdAt
        )
    }
}
