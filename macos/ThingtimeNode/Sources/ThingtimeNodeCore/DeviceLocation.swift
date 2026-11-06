import AppKit
@preconcurrency import CoreLocation
import Foundation

public protocol DeviceObservationClient: Sendable {
    func observationPolicy(deviceID: String) async throws -> DeviceObservationPolicy
    func sendObservation(_ observation: DeviceLocationObservation, deviceID: String) async throws
}
extension ThingtimeAPIClient: DeviceObservationClient {}

public struct DeviceObservationPolicy: Codable, Equatable, Sendable {
    public let enabled: Bool
    public let retentionMs: Double?
    public let collectionId: String
}

public struct DeviceLocationObservation: Codable, Equatable, Sendable {
    public struct Value: Codable, Equatable, Sendable {
        public let latitude: Double
        public let longitude: Double
        public let accuracyMeters: Double
        public let precision: String
        public let source: String
    }
    public let id: String
    public let type: String
    public let observedAt: String
    public let collectionId: String
    public let value: Value
}

/// Core Location runs only after a local user gesture enables this exact pairing.
/// No coordinates enter telemetry, logs, preferences, or command responses.
@MainActor public final class DeviceLocationService: NSObject, @preconcurrency CLLocationManagerDelegate {
    private struct State: Codable { var enabled: Set<String> = []; var pending: [String: DeviceLocationObservation] = [:] }
    private let manager = CLLocationManager()
    private let fileURL: URL
    private var state: State
    private var generation = 0
    private var publications: [String: Task<Void, Never>] = [:]
    private var sample: CheckedContinuation<CLLocation?, Never>?
    var sampleProvider: (@MainActor () async -> CLLocation?)?
    var authorizationProvider: (@MainActor () -> String)?
    private var timeout: Task<Void, Never>?

    public init(fileURL: URL) throws {
        self.fileURL = fileURL
        if FileManager.default.fileExists(atPath: fileURL.path) {
            state = try JSONDecoder().decode(State.self, from: Data(contentsOf: fileURL))
        } else { state = State() }
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }
    public func status(deviceID: String) -> JSONValue {
        .object(["version": .string("1.0.0"), "enabled": .bool(state.enabled.contains(deviceID)),
                 "authorization": .string(authorization), "servicesEnabled": .bool(CLLocationManager.locationServicesEnabled())])
    }
    private var authorization: String {
        if let authorizationProvider { return authorizationProvider() }
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: return "granted"
        case .notDetermined: return "notDetermined"
        case .restricted: return "restricted"
        case .denied: return "denied"
        @unknown default: return "unknown"
        }
    }
    public func setEnabled(_ enabled: Bool, deviceID: String) throws {
        generation += 1
        publications[deviceID]?.cancel()
        finish(nil)
        if enabled { state.enabled.insert(deviceID) } else { state.enabled.remove(deviceID); state.pending.removeValue(forKey: deviceID) }
        try persist()
    }
    public func openSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices") { NSWorkspace.shared.open(url) }
    }
    public func reconcilePairings(_ deviceIDs: Set<String>) throws {
        let removed = state.enabled.subtracting(deviceIDs)
        guard !removed.isEmpty else { return }
        generation += 1; publications.values.forEach { $0.cancel() }; finish(nil)
        state.enabled.formIntersection(deviceIDs)
        state.pending = state.pending.filter { deviceIDs.contains($0.key) }
        try persist()
    }
    public func suspend() { generation += 1; publications.values.forEach { $0.cancel() }; finish(nil) }
    public func requestPermission() { manager.requestWhenInUseAuthorization() }
    public func revoke(deviceID: String) throws { try setEnabled(false, deviceID: deviceID) }
    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard authorization != "granted" else { return }
        generation += 1
        publications.values.forEach { $0.cancel() }
        finish(nil)
        state.pending.removeAll()
        try? persist()
    }
    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        finish(locations.last(where: { $0.horizontalAccuracy >= 0 && abs($0.timestamp.timeIntervalSinceNow) < 120 }))
    }
    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { finish(nil) }
    private func finish(_ location: CLLocation?) {
        manager.stopUpdatingLocation()
        timeout?.cancel(); timeout = nil
        let pending = sample; sample = nil; pending?.resume(returning: location)
    }
    private func freshLocation() async -> CLLocation? {
        if let sampleProvider { return await sampleProvider() }
        guard sample == nil else { return nil }
        return await withCheckedContinuation { continuation in
            sample = continuation
            manager.startUpdatingLocation()
            timeout = Task { [weak self] in
                do { try await Task.sleep(for: .seconds(15)) } catch { return }
                self?.finish(nil)
            }
        }
    }
    public func publish(client: any DeviceObservationClient, deviceID: String) async {
        guard publications[deviceID] == nil else { return }
        let publication = Task { await self.publishObservation(client: client, deviceID: deviceID) }
        publications[deviceID] = publication
        await publication.value
        publications.removeValue(forKey: deviceID)
    }
    private func publishObservation(client: any DeviceObservationClient, deviceID: String) async {
        guard state.enabled.contains(deviceID), authorization == "granted" else { return }
        let token = generation
        do {
            let policy = try await client.observationPolicy(deviceID: deviceID)
            guard token == generation else { return }
            guard policy.enabled, UUID(uuidString: policy.collectionId) != nil else {
                state.pending.removeValue(forKey: deviceID); try persist(); return
            }
            if state.pending[deviceID]?.collectionId != policy.collectionId { state.pending.removeValue(forKey: deviceID); try persist() }
            if state.pending[deviceID] == nil {
                guard let location = await freshLocation(), token == generation, state.enabled.contains(deviceID), authorization == "granted" else { return }
                let coordinate = location.coordinate
                guard CLLocationCoordinate2DIsValid(coordinate), location.horizontalAccuracy.isFinite else { return }
                state.pending[deviceID] = DeviceLocationObservation(id: UUID().uuidString.lowercased(), type: "location",
                    observedAt: ISO8601DateFormatter().string(from: location.timestamp), collectionId: policy.collectionId,
                    value: .init(latitude: coordinate.latitude, longitude: coordinate.longitude,
                        accuracyMeters: location.horizontalAccuracy, precision: manager.accuracyAuthorization == .fullAccuracy ? "precise" : "approximate", source: "core-location"))
                try persist()
            }
            // Revalidate server policy after the asynchronous OS callback, including retention/deletion generation.
            let current = try await client.observationPolicy(deviceID: deviceID)
            guard token == generation, current.enabled, current.collectionId == policy.collectionId, authorization == "granted",
                  let observation = state.pending[deviceID] else {
                state.pending.removeValue(forKey: deviceID); try persist(); return
            }
            try Task.checkCancellation()
            try await client.sendObservation(observation, deviceID: deviceID)
            guard token == generation else { return }
            state.pending.removeValue(forKey: deviceID); try persist()
        } catch ThingtimeAPIClientError.rejected(status: 401) { try? revoke(deviceID: deviceID) }
        catch ThingtimeAPIClientError.rejected(status: 403) { try? revoke(deviceID: deviceID) }
        catch { /* Keep immutable pending data for exact retry; never log coordinates. */ }
    }
    private func persist() throws {
        let directory = fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
        try JSONEncoder().encode(state).write(to: fileURL, options: [.atomic, .completeFileProtectionUnlessOpen])
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fileURL.path)
    }
}
