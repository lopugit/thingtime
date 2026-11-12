import Foundation

@MainActor
final class MobileDeviceLocationTransport {
    enum Failure: Error { case collectionChanged }
    private let client: MobileDeviceNodeTransport
    init(load: @escaping (MobileDevicePairing.Scope) throws -> MobileDevicePairing.Record? = MobileDeviceKeychain.load,
         save: @escaping (MobileDevicePairing.Record) throws -> Void = MobileDeviceKeychain.save,
         transport: @escaping MobileDevicePairing.Transport) {
        client = MobileDeviceNodeTransport(load: load, save: save, transport: transport)
    }
    private init(client: MobileDeviceNodeTransport) { self.client = client }
    static func make() -> MobileDeviceLocationTransport { .init(client: .make()) }
    func verifyCollection(_ collectionId: String, scope: MobileDevicePairing.Scope, check: () throws -> Void) async throws {
        try await client.negotiate(["api.devices-node-observations": [1, 0, 0]], scope: scope, check: check)
        let policy = try await client.request(scope, "/api/v1/devices/node/observations", check: check)
        guard let settings = policy["settings"] as? [String: Any], settings["enabled"] as? Bool == true,
              settings["collectionId"] as? String == collectionId else { throw Failure.collectionChanged }
    }
    func send(_ observation: MobileDeviceLocationObservation, scope: MobileDevicePairing.Scope,
              check: () throws -> Void) async throws {
        try check(); try Task.checkCancellation()
        let deviceId = try client.deviceId(scope)
        try await verifyCollection(observation.collectionId, scope: scope, check: check)
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let body = try MobileDevicePairing.json(["id": observation.id.uuidString, "collectionId": observation.collectionId, "type": "location",
            "observedAt": formatter.string(from: observation.observedAt), "value": [
                "latitude": observation.latitude, "longitude": observation.longitude,
                "accuracyMeters": observation.horizontalAccuracy, "precision": observation.precision,
                "source": observation.source]])
        let result: [String: Any]
        do { result = try await client.request(scope, "/api/v1/devices/node/observations", body: body, check: check) }
        catch MobileDeviceNodeTransport.Failure.http(409, let code) {
            if code == "OBSERVATION_COLLECTION_CHANGED" || code == "OBSERVATION_COLLECTION_DISABLED" { throw Failure.collectionChanged }
            throw MobileDeviceNodeTransport.Failure.http(409, code)
        }
        // The owner's finite retention policy may intentionally discard a late
        // offline fix. Acknowledging this receipt prevents an endless retry.
        if result["expired"] as? Bool == true { return }
        guard let receipt = result["observation"] as? [String: Any],
              receipt["id"] as? String == observation.id.uuidString,
              receipt["deviceId"] as? String == deviceId else { throw MobileDevicePairing.Failure.invalid }
    }
}
