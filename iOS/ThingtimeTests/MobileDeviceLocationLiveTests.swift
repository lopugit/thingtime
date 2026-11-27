import CoreLocation
import XCTest
@testable import Thingtime

/// Opt-in installed native transport acceptance. Uses only a disposable account
/// and loopback API; synthetic location and a silent injected command executor
/// do not establish physical GPS, background scheduling or audible delivery.
@MainActor
final class MobileDeviceLocationLiveTests: XCTestCase {
    func testNativeHistoryAndLeasedCommandAgainstDisposableAPI() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let base = env["THINGTIME_DEVICE_TEST_ORIGIN"], let url = URL(string: base),
              let username = env["THINGTIME_DEVICE_TEST_USERNAME"], let password = env["THINGTIME_DEVICE_TEST_PASSWORD"] else {
            throw XCTSkip("Set disposable local device-test account environment to run native history acceptance")
        }
        guard url.scheme == "http", ["127.0.0.1", "localhost"].contains(url.host ?? "") else { XCTFail("A loopback disposable API is required"); return }
        let config = URLSessionConfiguration.ephemeral
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        var expectedActor: String?
        func ownerJSON(_ path: String, body: [String: Any]? = nil) async throws -> [String: Any] {
            var request = URLRequest(url: URL(string: path, relativeTo: url)!.absoluteURL)
            request.setValue(base, forHTTPHeaderField: "Origin")
            if let expectedActor { request.setValue(expectedActor, forHTTPHeaderField: "X-Thingtime-Expected-Actor") }
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            if let body { request.httpMethod = "POST"; request.httpBody = try MobileDevicePairing.json(body) }
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw MobileDevicePairing.Failure.invalid }
            guard http.statusCode == 200 else {
                throw NSError(domain: "NativeDeviceFixture", code: http.statusCode,
                    userInfo: [NSLocalizedDescriptionKey: "\(request.httpMethod ?? "GET") \(request.url!.path) refused (HTTP \(http.statusCode))"])
            }
            guard let result = try JSONSerialization.jsonObject(with: data) as? [String: Any], result["ok"] as? Bool != false else {
                throw NSError(domain: "NativeDeviceFixture", code: 0,
                    userInfo: [NSLocalizedDescriptionKey: "Invalid response schema for \(request.url!.path)"])
            }
            return result
        }
        _ = try await ownerJSON("/api/v1/login", body: ["username": username, "password": password])
        let identity = try await ownerJSON("/api/v1/auth/me")
        let owner = try XCTUnwrap((identity["user"] as? [String: Any])?["id"] as? String)
        expectedActor = owner
        let scope = try MobileDevicePairing.Scope(ownerId: owner, url: url)
        let pairing = MobileDevicePairing(load: MobileDeviceKeychain.load, save: MobileDeviceKeychain.save,
            transport: { request in
                let (data, response) = try await session.data(for: request)
                return (data, try XCTUnwrap(response as? HTTPURLResponse))
            }, cookie: { target in
                HTTPCookie.requestHeaderFields(with: session.configuration.httpCookieStorage?.cookies(for: target) ?? config.httpCookieStorage?.cookies(for: target) ?? [])["Cookie"] ?? ""
            })
        let paired = try await pairing.pair(scope, descriptor: ["name": "Native history acceptance",
            "model": MobileDeviceHardware.modelIdentifier, "osVersion": "17.0", "appVersion": "1.0"])
        let deviceId = try XCTUnwrap(paired.deviceId)
        let policy = try await ownerJSON("/api/v1/devices/observation-settings", body: ["deviceId": deviceId, "type": "location", "enabled": true])
        let collection = try XCTUnwrap((policy["settings"] as? [String: Any])?["collectionId"] as? String)
        let location = CLLocation(coordinate: .init(latitude: 55.5, longitude: 12.5), altitude: 0,
            horizontalAccuracy: 50, verticalAccuracy: -1, timestamp: Date())
        let observation = try XCTUnwrap(MobileDeviceLocationObservation(location: location, fullAccuracy: false, collectionId: collection))
        let native = MobileDeviceLocationTransport.make()
        try await native.send(observation, scope: scope, check: {})
        try await native.send(observation, scope: scope, check: {})
        let history = try await ownerJSON("/api/v1/devices/observations?deviceId=\(deviceId)&type=location&limit=100")
        let matches = try XCTUnwrap(history["observations"] as? [[String: Any]]).filter { $0["id"] as? String == observation.id.uuidString }
        XCTAssertEqual(matches.count, 1)
        let value = try XCTUnwrap(matches.first?["value"] as? [String: Any])
        XCTAssertEqual(value["latitude"] as? Double, 55.5); XCTAssertEqual(value["accuracyMeters"] as? Double, 50)
        XCTAssertEqual(value["precision"] as? String, "approximate")
        _ = try await ownerJSON("/api/v1/devices/observation-settings", body: ["deviceId": deviceId, "type": "location", "enabled": false])
        do { try await native.verifyCollection(collection, scope: scope, check: {}); XCTFail("Disabled collection accepted") }
        catch MobileDeviceLocationTransport.Failure.collectionChanged { }

        let client = MobileDeviceNodeTransport.make()
        var record = try XCTUnwrap(MobileDeviceKeychain.load(scope))
        record.revision = max(record.revision + 1, Int64(Date().timeIntervalSince1970 * 1000))
        try MobileDeviceKeychain.save(record)
        _ = try await client.request(scope, "/api/v1/devices/node/state", body: MobileDevicePairing.json([
            "revision": record.revision, "capabilities": ["notification.show.v1"], "connectors": [], "state": ["locked": false]]), check: {})
        _ = try await ownerJSON("/api/v1/devices/permissions", body: ["deviceId": deviceId, "mode": "always-allow"])
        let created = try await ownerJSON("/api/v1/devices/commands", body: ["deviceId": deviceId, "requestId": UUID().uuidString,
            "kind": "notification.show", "input": ["title": "Native transport fixture", "message": "Silent test executor", "sound": ["kind": "none"]]])
        let expectedCommand = try XCTUnwrap((created["command"] as? [String: Any])?["id"] as? String)
        let alerts = MobileDeviceAlertsTransport(client: client)
        try await client.negotiate(["api.devices-node-commands": [1, 11, 0]], scope: scope, check: {})
        let claimed = try await alerts.claim(scope: scope, check: {})
        let command = try XCTUnwrap(claimed)
        XCTAssertEqual(command.id, expectedCommand)
        let journalRoot = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: journalRoot) }
        var executions = 0
        let worker = MobileDeviceCommandWorker(journal: .init(root: journalRoot), report: { command, event, status in
            try await alerts.report(command, eventId: event, status: status, scope: scope, check: {})
        }, execute: { _, check in try check(); executions += 1 })
        try await worker.perform(command, scope: scope, check: {})
        try await worker.perform(command, scope: scope, check: {})
        XCTAssertEqual(executions, 1)
    }
}
