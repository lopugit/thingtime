import Foundation
import UIKit
import UserNotifications

@MainActor
final class MobileDeviceAlerts {
    static let shared = MobileDeviceAlerts()
    private let transport = MobileDeviceAlertsTransport()
    private var scope: MobileDevicePairing.Scope?
    private var generation = UUID()
    private var work: Task<Void, Never>?
    private var token: String?
    private var registered = false
    private var pushRegistrationAttempted = false
    private var supported = false
    private var notificationsAllowed = false
    private var actions: MobileDeviceAlertActions?
    private(set) var lastError: String?
    private var registrationSignature: String?
    private var observer: NSObjectProtocol?
    private var deactivation: Task<Void, Never>?
    static var remoteRegistrationPermitted: Bool {
        !UserDefaults.standard.bool(forKey: "thingtime.device-alerts.registration-suspended.v1")
    }
    private let cacheGeneration: String
    private let library = URL.libraryDirectory

    private init() {
        let key = "thingtime.device-alert-cache-generation.v1"
        if let saved = UserDefaults.standard.string(forKey: key), UUID(uuidString: saved) != nil { cacheGeneration = saved }
        else {
            let id = UUID().uuidString; UserDefaults.standard.set(id, forKey: key); cacheGeneration = id
        }
        observer = NotificationCenter.default.addObserver(forName: UIScene.willEnterForegroundNotification,
            object: nil, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.pause() } }
    }
    deinit { if let observer { NotificationCenter.default.removeObserver(observer) } }
    func setToken(_ token: String) { self.token = token; registrationSignature = nil }
    func capabilities(_ scope: MobileDevicePairing.Scope) -> [String] {
        guard self.scope == scope, supported else { return [] }
        var result: [String] = []
        if notificationsAllowed { result.append("notification.show.v1") }
        if UIApplication.shared.applicationState == .active {
            result.append("media.play.v1")
            if registered { result.append("media.prepare.v1") }
        }
        return result
    }
    func approve(_ selected: MobileDevicePairing.Scope) {
        if scope != selected { stop(); scope = selected }
        UserDefaults.standard.set(false, forKey: "thingtime.device-alerts.registration-suspended.v1")
        guard work == nil else { return }
        let operation = generation
        work = Task { [weak self] in
            guard let self else { return }
            defer { if generation == operation { work = nil } }
            let check = { [weak self] in
                try Task.checkCancellation()
                guard self?.generation == operation, self?.scope == selected,
                      UIApplication.shared.applicationState == .active else { throw CancellationError() }
            }
            await deactivation?.value
            guard (try? check()) != nil else { return }
            await refresh(selected, check: check)
        }
    }
    private func pause() {
        generation = UUID(); work?.cancel(); work = nil; actions?.stop(); actions = nil
        supported = false
    }
    func stop(matching selected: MobileDevicePairing.Scope? = nil) {
        if let selected, scope != selected { return }
        let old = scope
        let shouldDeactivate = registered || pushRegistrationAttempted
        pushRegistrationAttempted = false
        generation = UUID(); work?.cancel(); work = nil; actions?.stop(); actions = nil
        scope = nil; supported = false; registered = false; registrationSignature = nil
        if let old {
            UserDefaults.standard.set(true, forKey: "thingtime.device-alerts.registration-suspended.v1")
            UIApplication.shared.unregisterForRemoteNotifications()
            guard shouldDeactivate else { return }
            let previous = deactivation
            deactivation = Task {
                await previous?.value
                do {
                    try await transport.client.negotiate(["api.devices-node-push": [1, 0, 0]], scope: old, check: {})
                    _ = try await transport.client.request(old, "/api/v1/devices/node/push", body: MobileDevicePairing.json([
                        "enabled": false, "cacheGeneration": cacheGeneration]), check: {})
                } catch { lastError = "This device stopped local alerts. Remote push deactivation is unconfirmed; reconnect to verify." }
            }
        }
    }
    /// A system refresh may renew the device binding but never starts foreground
    /// media or a polling loop. Visible suspended notifications use targeted APNs.
    func refresh(_ selected: MobileDevicePairing.Scope, check: @escaping () throws -> Void) async {
        do {
            await deactivation?.value
            try check()
            if let scope, scope != selected { return }
            if scope == nil { scope = selected }
            try await transport.client.negotiate(MobileDeviceAlertsTransport.requirements, scope: selected, check: check)
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            try check()
            supported = true
            notificationsAllowed = [.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus)
            if notificationsAllowed, let token, let topic = Bundle.main.bundleIdentifier,
               let configured = Bundle.main.object(forInfoDictionaryKey: "ThingtimeAPNSEnvironment") as? String,
               ["development", "production"].contains(configured) {
                let environment = configured == "development" ? "sandbox" : "production"
                let signature = selected.key + ":" + token + ":" + cacheGeneration
                if signature != registrationSignature {
                    pushRegistrationAttempted = true
                    try await transport.registerPush(scope: selected, token: token, environment: environment,
                        topic: topic, cacheGeneration: cacheGeneration, check: check)
                    registrationSignature = signature
                }
                registered = true
                if !UIApplication.shared.isRegisteredForRemoteNotifications { UIApplication.shared.registerForRemoteNotifications() }
            }
            guard UIApplication.shared.applicationState == .active else { return }
            for _ in 0..<3 {
                try check()
                guard let command = try await transport.claim(scope: selected, check: check) else { break }
                try await perform(command, scope: selected, check: check)
            }
            lastError = nil
        } catch is CancellationError { }
        catch MobileDevicePairing.Failure.revoked {
            if scope == selected { stop(matching: selected) }
            MobileDeviceLocation.shared.disable(matching: selected)
        } catch MobileDevicePairing.Failure.incompatible { supported = false }
        catch { lastError = "Device alerts could not be verified. Retry after reconnecting this device." }
    }
    private func perform(_ command: MobileDeviceCommandWorker.Command, scope: MobileDevicePairing.Scope,
                         check: @escaping () throws -> Void) async throws {
        final class Lease { var expiry: Date; init(_ expiry: Date) { self.expiry = expiry } }
        let lease = Lease(command.leaseExpiresAt)
        let leaseCheck = {
            try check(); try Task.checkCancellation()
            guard lease.expiry > Date() else { throw CancellationError() }
        }
        // Renew a finite operation's existing lease; no repeated command claim.
        let renewal = Task {
            do {
                while !Task.isCancelled {
                    try await Task.sleep(nanoseconds: 15_000_000_000)
                    lease.expiry = try await transport.heartbeat(command, scope: scope, check: check)
                }
            } catch { lease.expiry = .distantPast }
        }
        defer { renewal.cancel() }
        let action = MobileDeviceAlertActions(store: .init(library: library),
            resolveAttachment: { [transport] command, scope, check in try await transport.download(command, scope: scope, check: check) },
            authorizeMedia: { [transport] command, scope, attachment, version, check in
                try await transport.authorizeMedia(command, scope: scope, attachmentId: attachment, versionId: version, check: check)
            }, confirmPrepared: { [transport, cacheGeneration] command, sound, duration, check in
                try await transport.prepared(command, soundId: sound, duration: duration,
                    cacheGeneration: cacheGeneration, scope: scope, check: check)
            })
        actions?.stop(); actions = action
        let worker = MobileDeviceCommandWorker(journal: .init(root: URL.applicationSupportDirectory.appendingPathComponent("DeviceCommandReceipts")),
            report: { [transport] command, event, status in
                try await transport.report(command, eventId: event, status: status, scope: scope, check: leaseCheck)
            }, execute: { command, check in try await action.execute(command, scope: scope, check: check) })
        try await worker.perform(command, scope: scope, check: leaseCheck)
    }
}
