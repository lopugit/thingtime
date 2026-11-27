import CryptoKit
import CoreLocation
import Foundation

/// One actual Core Location fix. Server receipt time never replaces measurement
/// time, and approximate authorization is preserved rather than claiming GPS.
struct MobileDeviceLocationObservation: Codable, Equatable {
    let collectionId: String
    let id: UUID
    let latitude: Double
    let longitude: Double
    let horizontalAccuracy: Double
    let altitude: Double?
    let verticalAccuracy: Double?
    let observedAt: Date
    let precision: String
    let source: String

    init?(location: CLLocation, fullAccuracy: Bool, collectionId: String, now: Date = Date()) {
        guard UUID(uuidString: collectionId) != nil, CLLocationCoordinate2DIsValid(location.coordinate),
              location.coordinate.latitude.isFinite, location.coordinate.longitude.isFinite,
              location.horizontalAccuracy.isFinite, location.horizontalAccuracy >= 0,
              location.timestamp.timeIntervalSince1970.isFinite,
              location.timestamp <= now.addingTimeInterval(60) else { return nil }
        self.collectionId = collectionId
        let identity = [collectionId, String(location.timestamp.timeIntervalSince1970.bitPattern),
            String(location.coordinate.latitude.bitPattern), String(location.coordinate.longitude.bitPattern),
            String(location.horizontalAccuracy.bitPattern), fullAccuracy ? "precise" : "approximate"].joined(separator: ":")
        var hex = SHA256.hash(data: Data(identity.utf8)).prefix(16).map { String(format: "%02x", $0) }.joined()
        let uuid = [8, 4, 4, 4, 12].map { length -> String in
            let part = String(hex.prefix(length)); hex.removeFirst(length); return part
        }.joined(separator: "-")
        id = UUID(uuidString: uuid)!
        latitude = location.coordinate.latitude; longitude = location.coordinate.longitude
        horizontalAccuracy = location.horizontalAccuracy
        altitude = location.verticalAccuracy >= 0 && location.altitude.isFinite ? location.altitude : nil
        verticalAccuracy = location.verticalAccuracy.isFinite && location.verticalAccuracy >= 0 ? location.verticalAccuracy : nil
        observedAt = location.timestamp
        precision = fullAccuracy ? "precise" : "approximate"
        source = "core-location"
    }
}

/// Each queued fix is an atomic, protected file scoped to an account and origin.
/// Acknowledging one upload removes only its exact observation. No growing array
/// is rewritten, and an offline restart retains the original idempotency ID.
struct MobileDeviceLocationOutbox {
    private let root: URL
    init(root: URL) { self.root = root }
    private func directory(_ scope: MobileDevicePairing.Scope) -> URL {
        root.appendingPathComponent(scope.key, isDirectory: true)
    }
    func append(_ observation: MobileDeviceLocationObservation, scope: MobileDevicePairing.Scope) throws {
        let directory = directory(scope)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        var scoped = directory; try scoped.setResourceValues(values)
        let file = directory.appendingPathComponent(observation.id.uuidString + ".json")
        try JSONEncoder().encode(observation).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func next(scope: MobileDevicePairing.Scope) throws -> MobileDeviceLocationObservation? {
        let directory = directory(scope)
        guard FileManager.default.fileExists(atPath: directory.path) else { return nil }
        // Enumerate lazily: processing one observation must not load an offline
        // history into memory. Delivery order is independent of measurement time.
        guard let entries = FileManager.default.enumerator(at: directory, includingPropertiesForKeys: nil,
            options: [.skipsSubdirectoryDescendants, .skipsHiddenFiles]) else { return nil }
        for case let file as URL in entries where file.pathExtension == "json" {
            guard UUID(uuidString: file.deletingPathExtension().lastPathComponent) != nil else { continue }
            return try JSONDecoder().decode(MobileDeviceLocationObservation.self, from: Data(contentsOf: file))
        }
        return nil
    }
    func acknowledge(_ id: UUID, scope: MobileDevicePairing.Scope) throws {
        let file = directory(scope).appendingPathComponent(id.uuidString + ".json")
        if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
    }
    func clear(scope: MobileDevicePairing.Scope) throws {
        let directory = directory(scope)
        if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
    }
}
