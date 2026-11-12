import BackgroundTasks
import UIKit

@MainActor
protocol MobilePresenceRefreshTask: AnyObject {
    var expiration: (() -> Void)? { get set }
    func complete(success: Bool)
}

@MainActor
protocol MobilePresenceScheduling {
    func register(_ handler: @escaping (MobilePresenceRefreshTask) -> Void) -> Bool
    func submit() throws
    func cancel()
}

@MainActor
private final class SystemPresenceTask: MobilePresenceRefreshTask {
    let task: BGAppRefreshTask
    init(_ task: BGAppRefreshTask) { self.task = task }
    var expiration: (() -> Void)? {
        didSet {
            let handler = expiration
            task.expirationHandler = handler.map { callback in
                { Task { @MainActor in callback() } }
            }
        }
    }
    func complete(success: Bool) { task.setTaskCompleted(success: success) }
}

@MainActor
private final class SystemPresenceScheduler: MobilePresenceScheduling {
    private let identifier = (Bundle.main.bundleIdentifier ?? "com.thingtime.appletime") + ".device-presence"
    func register(_ handler: @escaping (MobilePresenceRefreshTask) -> Void) -> Bool {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: .main) { task in
            MainActor.assumeIsolated {
                guard let refresh = task as? BGAppRefreshTask else { task.setTaskCompleted(success: false); return }
                handler(SystemPresenceTask(refresh))
            }
        }
    }
    func submit() throws {
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        // An earliest opportunity, never a timer or a guarantee of execution.
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try BGTaskScheduler.shared.submit(request)
    }
    func cancel() { BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier) }
}

/// One exact, foreground-verified account/origin binding. iOS chooses refresh times;
/// force-quit, Background App Refresh settings and energy policy may prevent runs.
@MainActor
final class MobileDeviceBackgroundPresence {
    typealias Scope = MobileDevicePairing.Scope
    static let shared = MobileDeviceBackgroundPresence()
    private static let bindingKey = "thingtime.mobile-device.background-presence.v1"
    private let scheduler: MobilePresenceScheduling
    private let load: () -> Scope?
    private let save: (Scope?) -> Void
    private let heartbeat: (Scope, @escaping () throws -> Void) async throws -> MobileDevicePairing.Status
    private var foregroundObserver: NSObjectProtocol?
    private var registered = false
    private var binding: Scope?
    private var generation = UUID()
    private var work: Task<Void, Never>?
    private var finish: ((Bool) -> Void)?

    convenience init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.httpShouldSetCookies = false
        let session = URLSession(configuration: configuration, delegate: MobileDeviceRedirectPolicy(), delegateQueue: nil)
        self.init(scheduler: SystemPresenceScheduler(), load: {
            guard let data = UserDefaults.standard.data(forKey: Self.bindingKey),
                  let decoded = try? JSONDecoder().decode(Scope.self, from: data),
                  let validated = try? Scope(ownerId: decoded.ownerId, url: decoded.origin), validated == decoded else { return nil }
            return validated
        }, save: { scope in
            if let scope, let data = try? JSONEncoder().encode(scope) { UserDefaults.standard.set(data, forKey: Self.bindingKey) }
            else { UserDefaults.standard.removeObject(forKey: Self.bindingKey) }
        }, heartbeat: { scope, check in
            let backgroundCheck = {
                try check()
                guard UIApplication.shared.applicationState == .background else { throw CancellationError() }
            }
            let engine = MobileDevicePairing(load: MobileDeviceKeychain.load, save: MobileDeviceKeychain.save,
                transport: { request in
                    let (bytes, response) = try await session.bytes(for: request)
                    guard let http = response as? HTTPURLResponse else { throw MobileDevicePairing.Failure.invalid }
                    var data = Data()
                    for try await byte in bytes {
                        guard data.count < 512 * 1024 else { throw MobileDevicePairing.Failure.invalid }
                        data.append(byte)
                    }
                    return (data, http)
                }, cookie: { _ in throw MobileDevicePairing.Failure.identity }, check: backgroundCheck)
            await MobileDeviceAlerts.shared.refresh(scope, check: backgroundCheck)
            let status = try await engine.backgroundHeartbeat(scope, locked: !UIApplication.shared.isProtectedDataAvailable)
            if status.state == "paired" {
                try await MobileDeviceLocation.shared.flushAndWait(check: backgroundCheck)
            }
            else { MobileDeviceLocation.shared.disable(matching: scope) }
            return status
        })
    }

    init(scheduler: MobilePresenceScheduling, load: @escaping () -> Scope?, save: @escaping (Scope?) -> Void,
         heartbeat: @escaping (Scope, @escaping () throws -> Void) async throws -> MobileDevicePairing.Status) {
        self.scheduler = scheduler; self.load = load; self.save = save; self.heartbeat = heartbeat
    }
    func activate() {
        guard !registered else { return }
        // SwiftUI uses scenes. This notification is synchronous and precedes
        // activation, unlike a delayed SwiftUI scenePhase .active callback.
        foregroundObserver = NotificationCenter.default.addObserver(
            forName: UIScene.willEnterForegroundNotification, object: nil, queue: .main
        ) { [weak self] _ in MainActor.assumeIsolated { self?.stop() } }
        registered = scheduler.register { [weak self] task in self?.run(task) }
        binding = load()
        if registered, binding != nil { schedule() }
    }
    deinit { if let foregroundObserver { NotificationCenter.default.removeObserver(foregroundObserver) } }
    /// Called only after foreground cookie authentication and paired status succeed.
    func approve(_ scope: Scope) {
        if binding != scope { stop(); binding = scope; save(scope) }
        if registered { schedule() }
    }
    func stop(matching scope: Scope? = nil) {
        if let scope, binding != scope { return }
        generation = UUID(); work?.cancel(); work = nil
        finish?(false); finish = nil
        binding = nil; save(nil); scheduler.cancel()
    }
    func destinationChanged() { stop() }
    private func schedule() {
        // A rejected request leaves foreground presence usable. Retry only on the
        // next foreground approval or a system-delivered refresh, never in a loop.
        scheduler.cancel()
        try? scheduler.submit()
    }
    private func run(_ task: MobilePresenceRefreshTask) {
        guard work == nil, let scope = binding else { task.complete(success: false); return }
        schedule()
        let operation = UUID(); generation = operation
        var completed = false
        let complete: (Bool) -> Void = { success in
            guard !completed else { return }; completed = true
            task.expiration = nil; task.complete(success: success)
        }
        finish = complete
        task.expiration = { [weak self] in
            guard let self, self.generation == operation else { return }
            self.generation = UUID(); self.work?.cancel(); self.work = nil
            self.finish = nil; complete(false)
        }
        work = Task { [weak self] in
            guard let self else { complete(false); return }
            let check = { [weak self] in
                try Task.checkCancellation()
                guard self?.generation == operation, self?.binding == scope else { throw CancellationError() }
            }
            do {
                let result = try await heartbeat(scope, check)
                try check()
                if result.state != "paired" { stop(matching: scope); return }
                complete(true)
            } catch MobileDevicePairing.Failure.incompatible {
                if generation == operation { stop(matching: scope) }
            } catch { complete(false) }
            if generation == operation { work = nil; finish = nil }
        }
    }
}
