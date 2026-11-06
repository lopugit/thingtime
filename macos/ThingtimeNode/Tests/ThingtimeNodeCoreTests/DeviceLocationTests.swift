import CoreLocation
import Foundation
import XCTest
@testable import ThingtimeNodeCore

private actor ObservationFixture: DeviceObservationClient {
    var policies: [DeviceObservationPolicy]
    var writes: [DeviceLocationObservation] = []
    var failUpload = false
    init(_ policies: [DeviceObservationPolicy], failUpload: Bool = false) { self.policies = policies; self.failUpload = failUpload }
    func observationPolicy(deviceID: String) -> DeviceObservationPolicy { policies.count > 1 ? policies.removeFirst() : policies[0] }
    func sendObservation(_ observation: DeviceLocationObservation, deviceID: String) throws {
        writes.append(observation)
        if failUpload { throw URLError(.networkConnectionLost) }
    }
    func setFailure(_ value: Bool) { failUpload = value }
    func observations() -> [DeviceLocationObservation] { writes }
}

private struct UnavailableObservationOrigin: DeviceObservationClient {
    func observationPolicy(deviceID: String) async throws -> DeviceObservationPolicy { throw ThingtimeAPIClientError.incompatibleCapabilities }
    func sendObservation(_ observation: DeviceLocationObservation, deviceID: String) async throws { XCTFail("Unavailable observation origins must not receive coordinates") }
}

final class DeviceLocationTests: XCTestCase {
    @MainActor func service() throws -> (DeviceLocationService, URL) {
        let path = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("location.json")
        let service = try DeviceLocationService(fileURL: path)
        service.authorizationProvider = { "granted" }
        service.sampleProvider = { CLLocation(latitude: 55.68, longitude: 12.56) }
        return (service, path)
    }
    @MainActor func testDisabledAndServerDisabledNeverSampleOrUpload() async throws {
        let (service, path) = try service(); defer { try? FileManager.default.removeItem(at: path.deletingLastPathComponent()) }
        service.sampleProvider = { XCTFail("Disabled sharing must not start Core Location"); return nil }
        let client = ObservationFixture([.init(enabled: false, retentionMs: nil, collectionId: UUID().uuidString)])
        await service.publish(client: client, deviceID: "device")
        try service.setEnabled(true, deviceID: "device")
        await service.publish(client: client, deviceID: "device")
        let writes = await client.observations(); XCTAssertEqual(writes, [])
    }
    @MainActor func testMissingOptionalServerFeatureDoesNotBlockTheHeartbeatCaller() async throws {
        let (service, path) = try service(); defer { try? FileManager.default.removeItem(at: path.deletingLastPathComponent()) }
        service.sampleProvider = { XCTFail("Unsupported origins must not start location sampling"); return nil }
        try service.setEnabled(true, deviceID: "device")
        await service.publish(client: UnavailableObservationOrigin(), deviceID: "device")
        XCTAssertEqual(service.status(deviceID: "device").objectValue?["enabled"], .bool(true))
        // Returning normally lets the enclosing scheduler continue with its existing heartbeat/command contract.
    }
    @MainActor func testCollectionRotationDuringLocationDiscardsObservation() async throws {
        let (service, path) = try service(); defer { try? FileManager.default.removeItem(at: path.deletingLastPathComponent()) }
        let client = ObservationFixture([.init(enabled: true, retentionMs: nil, collectionId: UUID().uuidString), .init(enabled: true, retentionMs: nil, collectionId: UUID().uuidString)])
        try service.setEnabled(true, deviceID: "device")
        await service.publish(client: client, deviceID: "device")
        let writes = await client.observations(); XCTAssertEqual(writes, [])
    }
    @MainActor func testDisableDuringSampleFencesCallback() async throws {
        let (service, path) = try service(); defer { try? FileManager.default.removeItem(at: path.deletingLastPathComponent()) }
        service.sampleProvider = { try? service.setEnabled(false, deviceID: "device"); return CLLocation(latitude: 55.68, longitude: 12.56) }
        let client = ObservationFixture([.init(enabled: true, retentionMs: nil, collectionId: UUID().uuidString)])
        try service.setEnabled(true, deviceID: "device")
        await service.publish(client: client, deviceID: "device")
        let writes = await client.observations(); XCTAssertEqual(writes, [])
    }
    @MainActor func testLostUploadRetriesImmutableObservationAcrossRestartAndStoresPrivately() async throws {
        let (service, path) = try service(); defer { try? FileManager.default.removeItem(at: path.deletingLastPathComponent()) }
        let client = ObservationFixture([.init(enabled: true, retentionMs: nil, collectionId: UUID().uuidString)], failUpload: true)
        try service.setEnabled(true, deviceID: "device")
        await service.publish(client: client, deviceID: "device")
        let restored = try DeviceLocationService(fileURL: path)
        restored.authorizationProvider = { "granted" }
        restored.sampleProvider = { XCTFail("Exact retry must reuse the original sample"); return nil }
        await client.setFailure(false)
        await restored.publish(client: client, deviceID: "device")
        let writes = await client.observations(); XCTAssertEqual(writes.count, 2); XCTAssertEqual(writes.first, writes.last)
        let attributes = try FileManager.default.attributesOfItem(atPath: path.path)
        XCTAssertEqual((attributes[.posixPermissions] as? NSNumber)?.intValue, 0o600)
        try restored.setEnabled(false, deviceID: "device")
        XCTAssertEqual(restored.status(deviceID: "device").objectValue?["enabled"], .bool(false))
    }
    func testLocalLocationMutationsArePresenceGatedAndGenericRemoteActionRemainsForbidden() {
        for method in ["location.set-enabled", "location.request-permission", "location.open-settings", "location.request-notification-permission"] {
            XCTAssertEqual(ThingtimeNodeXPCRequestPolicy.access(for: method), .permissionMutation)
            XCTAssertGreaterThan(ThingtimeNodeXPCRequestPolicy.confirmationTimeoutSeconds(for: method), 0)
        }
        XCTAssertEqual(ThingtimeNodeXPCRequestPolicy.access(for: "location.status"), .onboardingRead)
        XCTAssertEqual(ThingtimeNodeXPCRequestPolicy.access(for: "media.play"), .forbidden)
        XCTAssertFalse(DeviceAlertService.validSoundID("../../a"))
    }
}
