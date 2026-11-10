import AppleFileSync
import Foundation

/// A scoped, bounded explanation of measured native work. The capture can
/// report off the main actor and never sends paths, identifiers or raw errors.
final class NativePhotoRunActivity: @unchecked Sendable {
    enum Phase: String, Codable, Sendable {
        case verifying, indexing, checkingOriginals = "checking-originals", downloading
        case checkingCloud = "checking-cloud", uploading, publishing, waiting, complete
    }
    enum Reason: String, Codable, Sendable {
        case interrupted, libraryChanged = "library-changed", photoAccess = "photo-access"
        case deviceStorage = "device-storage", photoRead = "photo-read", cloudRequest = "cloud-request"
        case savedSettings = "saved-settings", destinationReview = "destination-review", retry
    }
    enum BackgroundRequest: String, Codable, Sendable { case active, declined, waiting, complete }
    struct Snapshot: Codable, Equatable, Sendable {
        struct Preparation: Codable, Equatable, Sendable { let completed: Int; let total: Int }
        struct Event: Codable, Equatable, Sendable { let phase: Phase; let at: Date }
        var phase: Phase = .verifying
        var indexed: PhotoLibraryReader.IndexedLibrary?
        var prepared: Preparation?
        var backlogOriginals: Int?
        var downloadFraction: Double?
        var reason: Reason?
        var events: [Event] = []
        var backgroundRequest: BackgroundRequest?
    }

    private let lock = NSLock()
    private var value: Snapshot
    private var beforeDownload: Phase?
    private var nextNotice: TimeInterval = 0

    init(_ saved: Snapshot? = nil) { value = saved ?? .init() }

    func snapshot() -> Snapshot {
        lock.lock(); defer { lock.unlock() }
        return value
    }

    private func update(_ work: () -> Void) -> Bool {
        lock.lock(); defer { lock.unlock() }
        work()
        let now = ProcessInfo.processInfo.systemUptime
        guard now >= nextNotice else { return false }
        nextNotice = now + 0.5
        return true
    }

    private func setPhase(_ phase: Phase) {
        if phase != value.phase || value.events.isEmpty {
            value.phase = phase
            value.events.insert(.init(phase: phase, at: Date()), at: 0)
            if value.events.count > 12 { value.events.removeLast(value.events.count - 12) }
        }
        if phase != .downloading { value.downloadFraction = nil }
    }

    @discardableResult
    func phase(_ phase: Phase, reason: Reason? = nil) -> Bool {
        update { setPhase(phase); value.reason = reason }
    }

    func capture(_ progress: PhotoLibraryReader.CaptureProgress) -> Bool {
        update {
            switch progress {
            case .indexed(let indexed): value.indexed = indexed
            case .checking(let completed, let selected, let ahead):
                setPhase(.checkingOriginals)
                value.prepared = .init(completed: completed, total: selected)
                value.backlogOriginals = selected + ahead
            }
        }
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

    @discardableResult
    func backlog(_ count: Int64) -> Bool {
        update { value.backlogOriginals = Int(exactly: count) }
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
        if (error as? MobileFolderStore.Failure) == .changed { return .savedSettings }
        switch error as? NativeDeferredUploadClient.Failure {
        case .photoPathConflict: return .destinationReview
        case .denied: return .savedSettings
        case .invalid, .incompatible, .partsRetryable, .unavailable: return .cloudRequest
        case nil: return .retry
        }
    }
}
