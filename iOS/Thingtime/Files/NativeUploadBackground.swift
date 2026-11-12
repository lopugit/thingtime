import BackgroundTasks
import Foundation
import OSLog

@MainActor
protocol NativeUploadBackgroundTask: AnyObject {
    var identity: AnyObject { get }
    var expiration: (() -> Void)? { get set }
    var progress: Progress { get }
    func update(subtitle: String)
    func complete(success: Bool)
}
extension NativeUploadBackgroundTask { var identity: AnyObject { self } }

@MainActor
protocol NativeUploadBackgroundScheduling: AnyObject {
    func register(_ handler: @escaping (NativeUploadBackgroundTask) -> Void) -> Bool
    func submit() throws
    func submit(title: String, subtitle: String) throws
    func cancel()
}

extension NativeUploadBackgroundScheduling {
    func submit(title: String, subtitle: String) throws { try submit() }
}

/// One registered system identifier and one in-flight lease. A cancelled request
/// which has not launched keeps its slot until the OS delivers it: a late launch
/// must never borrow the next upload's account, grant or completion callback.
@MainActor
final class NativeUploadBackgroundCoordinator {
    static let shared = NativeUploadBackgroundCoordinator(scheduler: {
        if #available(iOS 26.0, *) { return SystemNativeUploadBackgroundScheduler() }
        return nil
    }())
    private let scheduler: NativeUploadBackgroundScheduling?
    private var registered = false
    private var activated = false
    private var pending: NativeUploadBackgroundLease?
    // Weak identity remembers delivery, never authority. A repeated callback
    // after release must not complete the same OS task a second time.
    private let delivered = NSHashTable<AnyObject>.weakObjects()
    init(scheduler: NativeUploadBackgroundScheduling?) { self.scheduler = scheduler }
    func activate() {
        guard !activated else { return }; activated = true
        registered = scheduler?.register { [weak self] task in
            guard let self else { task.complete(success: false); return }
            guard !self.delivered.contains(task.identity) else { return }
            self.delivered.add(task.identity)
            guard let lease = self.pending else { task.complete(success: false); return }
            lease.accept(task)
        } ?? false
    }
    func begin(size: Int64, timeoutNanoseconds: UInt64 = 2_000_000_000,
               expired: @escaping () -> Void) async -> NativeUploadBackgroundLease? {
        guard size > 0, size < Int64.max else { return nil }
        return await begin(presentation: .init(title: "Uploading to Thingtime", subtitle: "Preparing your file…",
            completedSubtitle: "File uploaded", bytes: size), timeoutNanoseconds: timeoutNanoseconds, expired: expired)
    }
    func begin(presentation: NativeUploadBackgroundLease.Presentation, timeoutNanoseconds: UInt64 = 2_000_000_000,
               expired: @escaping () -> Void) async -> NativeUploadBackgroundLease? {
        guard registered, let scheduler, pending == nil, !Task.isCancelled else { return nil }
        let lease = NativeUploadBackgroundLease(presentation: presentation, cancel: { scheduler.cancel() }, expired: expired,
            released: { [weak self] value in if self?.pending === value { self?.pending = nil } })
        pending = lease
        return await withTaskCancellationHandler(operation: {
            await withCheckedContinuation { continuation in
                lease.wait(continuation, timeoutNanoseconds: timeoutNanoseconds)
                do { try scheduler.submit(title: presentation.title, subtitle: presentation.subtitle) } catch { lease.submissionFailed() }
            }
        }, onCancel: { Task { @MainActor in lease.finish(success: false) } })
    }
}

@MainActor
final class NativeUploadBackgroundLease {
    struct Presentation {
        let title: String
        let subtitle: String
        let completedSubtitle: String
        var bytes: Int64?
    }
    private enum State { case waiting, active, cancelledBeforeLaunch, finished }
    private var state: State = .waiting
    private var systemTask: NativeUploadBackgroundTask?
    private var continuation: CheckedContinuation<NativeUploadBackgroundLease?, Never>?
    private var deadline: Task<Void, Never>?
    private let presentation: Presentation
    private let cancel: () -> Void
    private let expired: () -> Void
    private let released: (NativeUploadBackgroundLease) -> Void
    private(set) var measuredUnits: Int64 = 0
    private(set) var lastProgressAt: Date?
    var canContinue: Bool { state == .active }
    init(presentation: Presentation, cancel: @escaping () -> Void, expired: @escaping () -> Void,
         released: @escaping (NativeUploadBackgroundLease) -> Void) {
        self.presentation = presentation; self.cancel = cancel; self.expired = expired; self.released = released
    }
    func wait(_ continuation: CheckedContinuation<NativeUploadBackgroundLease?, Never>, timeoutNanoseconds: UInt64) {
        self.continuation = continuation
        deadline = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: timeoutNanoseconds) } catch { return }
            self?.finish(success: false)
        }
    }
    private func settle(_ lease: NativeUploadBackgroundLease?) {
        deadline?.cancel(); deadline = nil
        let waiting = continuation; continuation = nil; waiting?.resume(returning: lease)
    }
    func accept(_ task: NativeUploadBackgroundTask) {
        if state == .active, systemTask?.identity === task.identity { return }
        guard state == .waiting else {
            task.complete(success: false)
            if state == .cancelledBeforeLaunch { state = .finished; released(self) }
            return
        }
        state = .active; systemTask = task
        // A continued task needs finite Progress. With no known payload yet,
        // its sole known unit is final verification; real discovery replaces
        // this denominator before reporting its first measured completed work.
        task.progress.totalUnitCount = presentation.bytes.map { $0 + 1 } ?? 1
        task.progress.completedUnitCount = 0
        task.expiration = { [weak self] in
            guard let self, self.canContinue else { return }
            self.finish(success: false); self.expired()
        }
        settle(self)
    }
    func submissionFailed() {
        if state == .active { finish(success: false); return }
        guard state != .finished else { return }
        state = .finished; settle(nil); released(self)
    }
    func progress(_ bytes: Int64) {
        guard let size = presentation.bytes, canContinue, let task = systemTask,
              bytes >= task.progress.completedUnitCount, bytes <= size else { return }
        task.progress.completedUnitCount = bytes
        if bytes > measuredUnits { measuredUnits = bytes; lastProgressAt = Date() }
        task.update(subtitle: bytes == size ? "Verifying upload…" : "\(Int(Double(bytes) / Double(size) * 100))% uploaded")
    }
    func work(completed: Int64, total: Int64?, subtitle: String) {
        guard presentation.bytes == nil, canContinue, let task = systemTask,
              let total, completed >= task.progress.completedUnitCount, total > completed else { return }
        task.progress.totalUnitCount = total
        task.progress.completedUnitCount = completed
        if completed > measuredUnits { measuredUnits = completed; lastProgressAt = Date() }
        task.update(subtitle: subtitle)
    }
    func finish(success: Bool, settledSubtitle: String? = nil) {
        switch state {
        case .waiting:
            state = .cancelledBeforeLaunch; settle(nil); cancel()
        case .active:
            state = .finished
            if let task = systemTask {
                task.expiration = nil
                if success {
                    // A finite available-originals pass can settle with durable
                    // gaps. Do not turn its measured backlog into a false 100%.
                    if settledSubtitle == nil, task.progress.totalUnitCount > 0 { task.progress.completedUnitCount = task.progress.totalUnitCount }
                    task.update(subtitle: settledSubtitle ?? presentation.completedSubtitle)
                }
                task.complete(success: success)
            }
            systemTask = nil; settle(nil); released(self)
        case .cancelledBeforeLaunch, .finished: break
        }
    }
}

@available(iOS 26.0, *)
@MainActor
private final class SystemNativeUploadBackgroundScheduler: NativeUploadBackgroundScheduling {
    private let identifier = (Bundle.main.bundleIdentifier ?? "com.thingtime.appletime") + ".file-upload"
    func register(_ handler: @escaping (NativeUploadBackgroundTask) -> Void) -> Bool {
        let registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: .main) { task in
            MainActor.assumeIsolated {
                guard let continued = task as? BGContinuedProcessingTask else { task.setTaskCompleted(success: false); return }
                handler(SystemNativeUploadBackgroundTask(continued))
            }
        }
        if !registered {
            Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.thingtime.appletime", category: "FileUploads")
                .notice("Continued upload scheduler registration unavailable")
        }
        return registered
    }
    func submit() throws {
        try submit(title: "Uploading to Thingtime", subtitle: "Preparing your file…")
    }
    func submit(title: String, subtitle: String) throws {
        let request = BGContinuedProcessingTaskRequest(identifier: identifier, title: title, subtitle: subtitle)
        request.strategy = .fail
        do { try BGTaskScheduler.shared.submit(request) }
        catch {
            let failure = error as NSError
            Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.thingtime.appletime", category: "FileUploads")
                .notice("Continued upload declined: \(failure.domain, privacy: .public) code \(failure.code, privacy: .public)")
            throw error
        }
    }
    func cancel() { BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier) }
}
@available(iOS 26.0, *)
@MainActor
private final class SystemNativeUploadBackgroundTask: NativeUploadBackgroundTask {
    private let task: BGContinuedProcessingTask
    init(_ task: BGContinuedProcessingTask) { self.task = task }
    var expiration: (() -> Void)? {
        didSet {
            guard let callback = expiration else { task.expirationHandler = nil; return }
            task.expirationHandler = { Task { @MainActor in callback() } }
        }
    }
    var identity: AnyObject { task }
    var progress: Progress { task.progress }
    func update(subtitle: String) { task.updateTitle(task.title, subtitle: subtitle) }
    func complete(success: Bool) { task.setTaskCompleted(success: success) }
}
