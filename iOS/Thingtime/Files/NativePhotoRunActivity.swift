import AppleFileSync
import Foundation

/// A scoped, bounded explanation of measured native work. The capture can
/// report off the main actor and never sends paths, identifiers or raw errors.
final class NativePhotoRunActivity: @unchecked Sendable {
    enum SourceFailure: Error { case grantChanged, photoAccess, queueChanged }
    enum Phase: String, Codable, Sendable {
        case verifying, indexing, checkingOriginals = "checking-originals", downloading
        case checkingCloud = "checking-cloud", uploading, publishing, waiting, complete
    }
    enum Reason: String, Codable, Sendable {
        case interrupted, libraryChanged = "library-changed", photoAccess = "photo-access"
        case deviceStorage = "device-storage", photoRead = "photo-read", cloudRequest = "cloud-request"
        case savedSettings = "saved-settings", destinationReview = "destination-review", retry
        case transferPermission = "transfer-permission", transferExpired = "transfer-expired"
        case transferMissing = "transfer-missing", transferState = "transfer-state", grantChanged = "grant-changed", queueChanged = "queue-changed"
    }
    enum BackgroundRequest: String, Codable, Sendable { case active, declined, waiting, complete }
    struct Snapshot: Codable, Equatable, Sendable {
        struct Preparation: Codable, Equatable, Sendable { let completed: Int; let total: Int }
        struct Indexing: Codable, Equatable, Sendable {
            enum Unit: String, Codable, Sendable { case assets, files }
            let unit: Unit
            let completed: Int
            let total: Int
        }
        struct Event: Codable, Equatable, Sendable {
            let phase: Phase
            let at: Date
            var discovered: Int?
            var item: PhotoLibraryReader.InventoryProgress.Item?
        }
        var phase: Phase = .verifying
        var indexed: PhotoLibraryReader.IndexedLibrary?
        var indexing: Indexing?
        var latestFound: PhotoLibraryReader.InventoryProgress.Item?
        var prepared: Preparation?
        var backlogOriginals: Int?
        var downloadFraction: Double?
        var cloudPreparationFraction: Double?
        var reason: Reason?
        var failureOperation: NativeDeferredUploadClient.Operation?
        var events: [Event] = []
        var backgroundRequest: BackgroundRequest?
    }

    private let lock = NSLock()
    private var value: Snapshot
    private var beforeDownload: Phase?
    private var nextNotice: TimeInterval = 0
    private var inspectedAssets = 0
    private var previousInspection = 0
    private var indexedFiles = 0

    static func restoringLastDiscovery(_ saved: Snapshot) -> Snapshot {
        var restored = saved
        if restored.latestFound == nil, let indexing = restored.indexing, indexing.unit == .assets, indexing.completed > 0,
           let event = restored.events.first(where: { $0.phase == .indexing && $0.discovered == indexing.completed && $0.item != nil }) {
            restored.latestFound = event.item
        }
        return restored
    }
    init(_ saved: Snapshot? = nil) {
        value = Self.restoringLastDiscovery(saved ?? .init())
        if let indexing = value.indexing, indexing.unit == .assets { previousInspection = indexing.completed }
    }

    func snapshot() -> Snapshot {
        lock.lock(); defer { lock.unlock() }
        return value
    }

    private func update(forceNotice: Bool = false, _ work: () -> Void) -> Bool {
        lock.lock(); defer { lock.unlock() }
        work()
        let now = ProcessInfo.processInfo.systemUptime
        guard forceNotice || now >= nextNotice else { return false }
        nextNotice = now + 0.5
        return true
    }

    private func setPhase(_ phase: Phase) {
        if phase != value.phase || value.events.isEmpty {
            value.phase = phase
            append(.init(phase: phase, at: Date()))
        }
        if phase != .downloading { value.downloadFraction = nil }
    }

    private func append(_ event: Snapshot.Event) {
        value.events.insert(event, at: 0)
        if value.events.count > 12 { value.events.removeLast(value.events.count - 12) }
    }

    @discardableResult
    func phase(_ phase: Phase, reason: Reason? = nil) -> Bool {
        update { setPhase(phase); value.reason = reason; if phase != .waiting { value.failureOperation = nil } }
    }

    func failedOperation(_ operation: NativeDeferredUploadClient.Operation?) {
        _ = update { value.failureOperation = operation }
    }

    func capture(_ progress: PhotoLibraryReader.CaptureProgress) -> Bool {
        let firstItem: Bool
        if case .enumerating(let value) = progress { firstItem = value.inspected == 1 && value.latest != nil }
        else { firstItem = false }
        return update(forceNotice: firstItem) {
            switch progress {
            case .enumerating(let discovery):
                setPhase(.indexing)
                let restartedPass = discovery.inspected < previousInspection
                let priorInspected = restartedPass ? 0 : previousInspection
                if discovery.inspected > priorInspected, let item = discovery.latest {
                    inspectedAssets += discovery.inspected - priorInspected
                    append(.init(phase: .indexing, at: Date(), discovered: discovery.inspected, item: item))
                }
                previousInspection = discovery.inspected
                value.indexing = .init(unit: .assets, completed: discovery.inspected, total: discovery.total)
                value.indexed = discovery.inspected > 0 || discovery.total == 0 ? discovery.indexed : nil
                if discovery.total == 0 || restartedPass { value.latestFound = nil }
                if let latest = discovery.latest { value.latestFound = latest }
            case .hashing(let completed, let total):
                setPhase(.indexing)
                indexedFiles = max(indexedFiles, completed)
                value.indexing = .init(unit: .files, completed: completed, total: total)
            case .indexed(let indexed): value.indexed = indexed
            case .checking(let completed, let selected, let ahead):
                setPhase(.checkingOriginals)
                value.prepared = .init(completed: completed, total: selected)
                value.backlogOriginals = ahead.map { selected + $0 }
            }
        }
    }

    func measuredIndexingWork() -> Int64 {
        lock.lock(); defer { lock.unlock() }
        return Int64(inspectedAssets) + Int64(indexedFiles)
    }

    func download(_ fraction: Double?) -> Bool {
        update {
            if let fraction, fraction.isFinite, (0...1).contains(fraction) {
                if value.phase != .downloading { beforeDownload = value.phase }
                setPhase(.downloading); value.downloadFraction = fraction
            } else if value.phase == .downloading {
                setPhase(beforeDownload ?? .checkingOriginals); beforeDownload = nil
            }
        }
    }

    func cloudPreparation(_ fraction: Double?) -> Bool {
        update {
            value.cloudPreparationFraction = fraction.flatMap { $0.isFinite && (0...1).contains($0) ? $0 : nil }
        }
    }

    @discardableResult
    func backlog(_ count: Int64?) -> Bool {
        update { value.backlogOriginals = count.flatMap(Int.init(exactly:)) }
    }

    @discardableResult
    func background(_ request: BackgroundRequest?) -> Bool {
        update { value.backgroundRequest = request }
    }

    static func reason(for error: Error) -> Reason? {
        if error is CancellationError { return .interrupted }
        if error is NativeUploadAuthorization.Wait || error is NativePhotoUploadBudget.Wait { return nil }
        switch error as? PhotoLibraryReader.Failure {
        case .changed: return .libraryChanged
        case .unavailable: return .photoAccess
        case .storageFull: return .deviceStorage
        case .readFailed: return .photoRead
        case .cloudOriginal, nil: break
        }
        switch error as? SourceFailure {
        case .grantChanged: return .grantChanged
        case .photoAccess: return .photoAccess
        case .queueChanged: return .queueChanged
        case nil: break
        }
        if (error as? MobileFolderStore.Failure) == .changed { return .grantChanged }
        switch NativeDeferredUploadClient.failure(error) {
        case .photoPathConflict: return .destinationReview
        case .denied: return .transferPermission
        case .expired: return .transferExpired
        case .missing: return .transferMissing
        case .stateChanged: return .transferState
        case .configurationChanged: return .savedSettings
        case .destinationChanged: return .destinationReview
        case .sourceIndexDiscarded, .invalid, .incompatible, .partsRetryable, .unavailable: return .cloudRequest
        case nil: return .retry
        }
    }
}
