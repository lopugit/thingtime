import CoreLocation
import UIKit

@MainActor
protocol MobileLocationDriving: AnyObject {
    var authorization: CLAuthorizationStatus { get }
    var fullAccuracy: Bool { get }
    var significantChangesAvailable: Bool { get }
    var received: (([CLLocation]) -> Void)? { get set }
    var authorizationChanged: (() -> Void)? { get set }
    func requestPermission(always: Bool)
    func start(background: Bool)
    func stop()
}

@MainActor
private final class SystemMobileLocationDriver: NSObject, MobileLocationDriving, @preconcurrency CLLocationManagerDelegate {
    let manager = CLLocationManager()
    private var backgroundActive = false
    var received: (([CLLocation]) -> Void)?
    var authorizationChanged: (() -> Void)?
    var authorization: CLAuthorizationStatus { manager.authorizationStatus }
    var fullAccuracy: Bool { manager.accuracyAuthorization == .fullAccuracy }
    var significantChangesAvailable: Bool { CLLocationManager.significantLocationChangeMonitoringAvailable() }
    override init() { super.init(); manager.delegate = self }
    func requestPermission(always: Bool) {
        if always { manager.requestAlwaysAuthorization() }
        else { manager.requestWhenInUseAuthorization() }
    }
    func start(background: Bool) {
        if background {
            if !backgroundActive { manager.startMonitoringSignificantLocationChanges(); backgroundActive = true }
        } else {
            if backgroundActive { manager.stopMonitoringSignificantLocationChanges(); backgroundActive = false }
            manager.requestLocation()
        }
    }
    func stop() { manager.stopMonitoringSignificantLocationChanges(); manager.stopUpdatingLocation(); backgroundActive = false }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) { received?(locations) }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) { authorizationChanged?() }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Failure is not a position. A later location event or explicit foreground
        // request may retry; no fabricated coordinate or polling loop is emitted.
    }
}

@MainActor
final class MobileDeviceLocation {
    typealias Scope = MobileDevicePairing.Scope
    static let shared = MobileDeviceLocation()
    static let authorizationChangedNotification = Notification.Name("ThingtimeMobileLocationAuthorizationChanged")
    struct Binding: Codable, Equatable {
        let scope: Scope
        let collectionId: String
        var backgroundAuthorized: Bool
        init(scope: Scope, collectionId: String, backgroundAuthorized: Bool = true) {
            self.scope = scope; self.collectionId = collectionId; self.backgroundAuthorized = backgroundAuthorized
        }
        private enum CodingKeys: CodingKey { case scope, collectionId, backgroundAuthorized }
        init(from decoder: Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            scope = try values.decode(Scope.self, forKey: .scope)
            collectionId = try values.decode(String.self, forKey: .collectionId)
            // Older/partial preferences never imply fresh background authority.
            backgroundAuthorized = try values.decodeIfPresent(Bool.self, forKey: .backgroundAuthorized) ?? false
        }
    }
    private let driver: MobileLocationDriving
    private let outbox: MobileDeviceLocationOutbox
    private let load: () -> Binding?
    private let save: (Binding?) -> Void
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
         save: @escaping (Binding?) -> Void,
         send: @escaping (MobileDeviceLocationObservation, Scope, @escaping () throws -> Void) async throws -> Void) {
        self.driver = driver; self.outbox = outbox; self.load = load; self.save = save; self.send = send
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
        let newBinding = Binding(scope: selected, collectionId: collectionId)
        if let old = scope, binding != newBinding { disable(matching: old) }
        binding = newBinding; save(newBinding); paused = false; error = nil; reconcile()
    }
    func disable(matching selected: Scope? = nil) {
        if let selected, scope != selected { return }
        let old = scope
        binding = nil; save(nil); generation = UUID(); work?.cancel(); work = nil; driver.stop()
        if let old { do { try outbox.clear(scope: old) } catch { self.error = "Saved location cleanup is pending. Retry when this device is unlocked." } }
    }
    func requestPermission(always: Bool) {
        guard UIApplication.shared.applicationState == .active else { return }
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
            "backgroundAvailable": driver.significantChangesAvailable && driver.authorization == .authorizedAlways,
            "collectionMode": "significant-change"]
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
    private func reconcile() {
        guard scope != nil, binding?.backgroundAuthorized == true, !paused else { driver.stop(); return }
        if driver.authorization == .authorizedAlways, driver.significantChangesAvailable { driver.start(background: true) }
        else if driver.authorization == .authorizedWhenInUse, UIApplication.shared.applicationState == .active { driver.start(background: false) }
        else if [.denied, .restricted].contains(driver.authorization) {
            driver.stop()
            generation = UUID(); work?.cancel(); work = nil
        }
        flush()
    }
    private func receive(_ locations: [CLLocation]) {
        guard !paused, binding?.backgroundAuthorized == true, let scope, let collectionId = binding?.collectionId, [.authorizedAlways, .authorizedWhenInUse].contains(driver.authorization) else { return }
        guard driver.authorization == .authorizedAlways || UIApplication.shared.applicationState == .active else { return }
        do {
            for location in locations {
                if let observation = MobileDeviceLocationObservation(location: location, fullAccuracy: driver.fullAccuracy, collectionId: collectionId) {
                    try outbox.append(observation, scope: scope)
                }
            }
            flush()
        } catch { self.error = "Location could not be saved securely. Free local storage or unlock this device and retry." }
    }
    func flushAndWait(check: @escaping () throws -> Void) async throws {
        flush(check: check)
        await work?.value
        try check()
    }
    func flush(check externalCheck: @escaping () throws -> Void = {}) {
        guard !paused, binding?.backgroundAuthorized == true, let selected = scope, work == nil, [.authorizedAlways, .authorizedWhenInUse].contains(driver.authorization) else { return }
        let operation = generation
        work = Task { [weak self] in
            guard let self else { return }
            defer { if generation == operation { work = nil } }
            let check = { [weak self] in
                try Task.checkCancellation(); try externalCheck()
                guard self?.paused == false, self?.binding?.backgroundAuthorized == true, self?.generation == operation, self?.scope == selected,
                      let authorization = self?.driver.authorization,
                      [.authorizedAlways, .authorizedWhenInUse].contains(authorization) else { throw CancellationError() }
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
