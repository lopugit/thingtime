import CoreLocation
import UIKit

@MainActor
protocol MobileLocationDriving: AnyObject {
    var authorization: CLAuthorizationStatus { get }
    var fullAccuracy: Bool { get }
    var received: (([CLLocation]) -> Void)? { get set }
    var authorizationChanged: (() -> Void)? { get set }
    func requestPermission(always: Bool)
    func start(background: Bool)
    func stop()
}

@MainActor
private final class SystemMobileLocationDriver: NSObject, MobileLocationDriving, @preconcurrency CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private let relaunchManager = CLLocationManager()
    private var backgroundActive = false
    var received: (([CLLocation]) -> Void)?
    var authorizationChanged: (() -> Void)?
    var authorization: CLAuthorizationStatus { manager.authorizationStatus }
    var fullAccuracy: Bool { manager.accuracyAuthorization == .fullAccuracy }
    override init() {
        super.init()
        manager.delegate = self
        relaunchManager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        manager.distanceFilter = kCLDistanceFilterNone
        manager.activityType = .other
    }
    func requestPermission(always: Bool) {
        if always { manager.requestAlwaysAuthorization() }
        else { manager.requestWhenInUseAuthorization() }
    }
    func start(background: Bool) {
        if background {
            guard !backgroundActive else { return }
            backgroundActive = true
            manager.allowsBackgroundLocationUpdates = true
            // Opted-in history needs regular real fixes even after a stop in travel.
            manager.pausesLocationUpdatesAutomatically = false
            manager.startUpdatingLocation()
            // Standard updates do not relaunch a terminated app. Retain this
            // separate low-power monitor so iOS can wake us on eligible movement.
            if CLLocationManager.significantLocationChangeMonitoringAvailable() {
                relaunchManager.startMonitoringSignificantLocationChanges()
            }
        } else {
            if backgroundActive { stop() }
            manager.requestLocation()
        }
    }
    func stop() {
        backgroundActive = false
        relaunchManager.stopMonitoringSignificantLocationChanges()
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        if manager === relaunchManager {
            // This service may immediately replay a cached event. Standard
            // updates supply regular fixes; retain a fresh wake-up fix if needed.
            guard backgroundActive else { return }
        }
        received?(locations)
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager === self.manager { authorizationChanged?() }
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Failure is not a position. A later location event or explicit foreground
        // request may retry; no fabricated coordinate or polling loop is emitted.
    }
}

@MainActor
final class MobileDeviceLocation {
    typealias Scope = MobileDevicePairing.Scope
    static let shared = MobileDeviceLocation()
    // A sampling target, not a wake-up timer. Never manufacture absent fixes.
    static let sampleInterval: TimeInterval = 5 * 60
    static let authorizationChangedNotification = Notification.Name("ThingtimeMobileLocationAuthorizationChanged")
    struct Binding: Codable, Equatable {
        let scope: Scope
        let collectionId: String
        var backgroundAuthorized: Bool
        var enabledAt: Date?
        var lastObservationAt: Date?
        init(scope: Scope, collectionId: String, backgroundAuthorized: Bool = true, enabledAt: Date? = nil) {
            self.scope = scope; self.collectionId = collectionId; self.backgroundAuthorized = backgroundAuthorized
            self.enabledAt = enabledAt
        }
        private enum CodingKeys: CodingKey { case scope, collectionId, backgroundAuthorized, enabledAt, lastObservationAt }
        init(from decoder: Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            scope = try values.decode(Scope.self, forKey: .scope)
            collectionId = try values.decode(String.self, forKey: .collectionId)
            // Older/partial preferences never imply fresh background authority.
            backgroundAuthorized = try values.decodeIfPresent(Bool.self, forKey: .backgroundAuthorized) ?? false
            enabledAt = try values.decodeIfPresent(Date.self, forKey: .enabledAt)
            lastObservationAt = try values.decodeIfPresent(Date.self, forKey: .lastObservationAt)
        }
    }
    private let driver: MobileLocationDriving
    private let outbox: MobileDeviceLocationOutbox
    private let load: () -> Binding?
    private let save: (Binding?) -> Void
    private let now: () -> Date
    private let appIsActive: () -> Bool
    private let send: (MobileDeviceLocationObservation, Scope, @escaping () throws -> Void) async throws -> Void
    private var binding: Binding?
    private var scope: Scope? { binding?.scope }
    private var generation = UUID()
    private var work: Task<Void, Never>?
    private(set) var error: String?
    private var started = false
    private var foregroundObserver: NSObjectProtocol?
    private var paused = false

    convenience init() {
        let root = URL.applicationSupportDirectory.appendingPathComponent("MobileLocationOutbox", isDirectory: true)
        let transport = MobileDeviceLocationTransport.make()
        let key = "thingtime.mobile-device.location.v1"
        self.init(driver: SystemMobileLocationDriver(), outbox: .init(root: root), load: {
            guard let data = UserDefaults.standard.data(forKey: key),
                  let decoded = try? JSONDecoder().decode(Binding.self, from: data),
                  let validated = try? Scope(ownerId: decoded.scope.ownerId, url: decoded.scope.origin), decoded.scope == validated, UUID(uuidString: decoded.collectionId) != nil else { return nil }
            return decoded
        }, save: { scope in
            if let scope, let data = try? JSONEncoder().encode(scope) { UserDefaults.standard.set(data, forKey: key) }
            else { UserDefaults.standard.removeObject(forKey: key) }
        }, send: { observation, scope, check in try await transport.send(observation, scope: scope, check: check) })
    }
    init(driver: MobileLocationDriving, outbox: MobileDeviceLocationOutbox, load: @escaping () -> Binding?,
         save: @escaping (Binding?) -> Void, now: @escaping () -> Date = Date.init,
         appIsActive: @escaping () -> Bool = { UIApplication.shared.applicationState == .active },
         send: @escaping (MobileDeviceLocationObservation, Scope, @escaping () throws -> Void) async throws -> Void) {
        self.driver = driver; self.outbox = outbox; self.load = load; self.save = save; self.now = now; self.appIsActive = appIsActive; self.send = send
        driver.received = { [weak self] locations in self?.receive(locations) }
        driver.authorizationChanged = { [weak self] in
            self?.reconcile()
            NotificationCenter.default.post(name: Self.authorizationChangedNotification, object: nil)
        }
    }
    /// Restore only existing opt-in; never ask for permission during launch.
    func activate(foreground: Bool = false) {
        guard !started else { return }; started = true
        foregroundObserver = NotificationCenter.default.addObserver(forName: UIScene.willEnterForegroundNotification,
            object: nil, queue: .main) { [weak self] _ in MainActor.assumeIsolated { self?.pauseForVerification() } }
        binding = load(); paused = foreground || binding?.backgroundAuthorized != true
        if foreground { suspendAuthorization() } else { reconcile() }
    }
    deinit { if let foregroundObserver { NotificationCenter.default.removeObserver(foregroundObserver) } }
    func pauseForVerification() { suspendAuthorization() }
    /// Drop execution authority while preserving the user's scoped preference and
    /// immutable offline observations. A background-only relaunch cannot resume
    /// until the same foreground owner/origin is authenticated again.
    func suspendAuthorization(matching selected: Scope? = nil) {
        if let selected, scope != selected { return }
        paused = true; generation = UUID(); work?.cancel(); work = nil; driver.stop()
        if var binding { binding.backgroundAuthorized = false; self.binding = binding; save(binding) }
    }
    func verified(_ selected: Scope) {
        guard scope == selected else { if scope != nil { suspendAuthorization() }; return }
        if var binding { binding.backgroundAuthorized = true; self.binding = binding; save(binding) }
        paused = false; reconcile()
    }
    /// The native bridge calls this only after matching foreground account and
    /// paired-device verification. It never grants Core Location permission.
    func enable(_ selected: Scope, collectionId: String) throws {
        guard UUID(uuidString: collectionId) != nil else { throw MobileDevicePairing.Failure.invalid }
        if binding?.scope == selected, binding?.collectionId == collectionId {
            verified(selected)
            return
        }
        if let old = scope { disable(matching: old) }
        let newBinding = Binding(scope: selected, collectionId: collectionId, enabledAt: now())
        binding = newBinding; save(newBinding); paused = false; error = nil; reconcile()
    }
    func disable(matching selected: Scope? = nil) {
        if let selected, scope != selected { return }
        let old = scope
        binding = nil; save(nil); generation = UUID(); work?.cancel(); work = nil; driver.stop()
        if let old { do { try outbox.clear(scope: old) } catch { self.error = "Saved location cleanup is pending. Retry when this device is unlocked." } }
    }
    func requestPermission(always: Bool) {
        guard appIsActive() else { return }
        driver.requestPermission(always: always)
    }
    var status: [String: Any] {
        let authorization: String
        switch driver.authorization {
        case .authorizedAlways: authorization = "always"
        case .authorizedWhenInUse: authorization = "when-in-use"
        case .denied: authorization = "denied"
        case .restricted: authorization = "restricted"
        default: authorization = "not-requested"
        }
        var result: [String: Any] = ["enabled": scope != nil, "authorization": authorization,
            "precision": driver.fullAccuracy ? "precise" : "approximate",
            "backgroundAvailable": driver.authorization == .authorizedAlways,
            // Keep the existing relaunch mode readable by 1.1 web clients.
            "collectionMode": "significant-change", "samplingMode": "standard"]
        if let error { result["error"] = error }
        return result
    }
    func status(for selected: Scope) -> [String: Any] {
        var result = status
        if scope != selected {
            result["enabled"] = false
            result.removeValue(forKey: "error")
        }
        return result
    }
    private var canUseLocation: Bool {
        driver.authorization == .authorizedAlways || (driver.authorization == .authorizedWhenInUse && appIsActive())
    }
    private func reconcile() {
        guard scope != nil, binding?.backgroundAuthorized == true, !paused else { driver.stop(); return }
        guard canUseLocation else {
            driver.stop()
            generation = UUID(); work?.cancel(); work = nil
            return
        }
        driver.start(background: driver.authorization == .authorizedAlways)
        flush()
    }
    private func receive(_ locations: [CLLocation]) {
        guard !paused, var binding, binding.backgroundAuthorized, canUseLocation else { return }
        let receivedAt = now()
        var queued = false
        do {
            for location in locations.sorted(by: { $0.timestamp < $1.timestamp }) {
                let observedAt = location.timestamp
                // Cached fixes must never predate an explicit new collection grant.
                if let enabledAt = binding.enabledAt, observedAt < enabledAt { continue }
                // Older installations have no stored watermark. Avoid importing an
                // arbitrary cached initial fix when upgrading their active grant.
                if binding.enabledAt == nil, binding.lastObservationAt == nil,
                   observedAt < receivedAt.addingTimeInterval(-Self.sampleInterval) { continue }
                if let last = binding.lastObservationAt, observedAt.timeIntervalSince(last) < Self.sampleInterval { continue }
                guard let observation = MobileDeviceLocationObservation(location: location, fullAccuracy: driver.fullAccuracy,
                    collectionId: binding.collectionId, now: receivedAt) else { continue }
                try outbox.append(observation, scope: binding.scope)
                queued = true
                binding.lastObservationAt = observation.observedAt
                self.binding = binding
                save(binding)
            }
        } catch { self.error = "Location could not be saved securely. Free local storage or unlock this device and retry." }
        // High-frequency Core Location callbacks do not drive network retries.
        if queued { flush() }
    }
    func flushAndWait(check: @escaping () throws -> Void) async throws {
        flush(check: check)
        await work?.value
        try check()
    }
    func flush(check externalCheck: @escaping () throws -> Void = {}) {
        guard !paused, binding?.backgroundAuthorized == true, let selected = scope, work == nil, canUseLocation else { return }
        let operation = generation
        work = Task { [weak self] in
            guard let self else { return }
            defer { if generation == operation { work = nil } }
            let check = { [weak self] in
                try Task.checkCancellation(); try externalCheck()
                guard self?.paused == false, self?.binding?.backgroundAuthorized == true, self?.generation == operation, self?.scope == selected,
                      self?.canUseLocation == true else { throw CancellationError() }
            }
            do {
                // Resource batch only: queued history has no product item cap.
                // Further events, foreground verification and refreshes resume it.
                for _ in 0..<25 {
                    try check()
                    guard let observation = try outbox.next(scope: selected) else { break }
                    try await send(observation, selected, check)
                    try check(); try outbox.acknowledge(observation.id, scope: selected)
                }
                error = nil
            } catch MobileDeviceLocationTransport.Failure.collectionChanged { if generation == operation { disable(matching: selected) } }
            catch MobileDevicePairing.Failure.revoked { if generation == operation { disable(matching: selected) } }
            catch is CancellationError { }
            catch { if generation == operation { self.error = "Location history is saved on this device and will retry when the connection is available." } }
        }
    }
}
