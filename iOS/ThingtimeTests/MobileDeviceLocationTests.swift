import AVFoundation
import CoreLocation
import XCTest
import WebKit
@testable import Thingtime

@MainActor
private final class LocationDriverFixture: MobileLocationDriving {
    var authorization: CLAuthorizationStatus = .authorizedAlways
    var fullAccuracy = false
    var significantChangesAvailable = true
    var received: (([CLLocation]) -> Void)?
    var authorizationChanged: (() -> Void)?
    var starts: [Bool] = [], permissionRequests: [Bool] = []
    func requestPermission(always: Bool) { permissionRequests.append(always) }
    func start(background: Bool) { starts.append(background) }
    func stop() { }
}

@MainActor
final class MobileDeviceLocationTests: XCTestCase {
    private let scope = try! MobileDevicePairing.Scope(ownerId: "synthetic-owner", url: URL(string: "https://example.test")!)
    private let collectionId = UUID().uuidString
    private func fix(accuracy: Double = 25, timestamp: Date = Date()) -> CLLocation {
        CLLocation(coordinate: .init(latitude: 55.5, longitude: 12.5), altitude: 20,
            horizontalAccuracy: accuracy, verticalAccuracy: -1, timestamp: timestamp)
    }
    func testObservationPreservesHistoricalTimeAndApproximateAccuracyRejectingInvalidFix() throws {
        let date = Date(timeIntervalSince1970: 1_600_000_000)
        let observation = try XCTUnwrap(MobileDeviceLocationObservation(location: fix(timestamp: date), fullAccuracy: false, collectionId: collectionId))
        XCTAssertEqual(observation.observedAt, date); XCTAssertEqual(observation.precision, "approximate")
        XCTAssertEqual(observation.horizontalAccuracy, 25); XCTAssertNil(observation.altitude)
        XCTAssertNil(MobileDeviceLocationObservation(location: fix(accuracy: -1), fullAccuracy: true, collectionId: collectionId))
        XCTAssertNil(MobileDeviceLocationObservation(location: fix(timestamp: Date().addingTimeInterval(600)), fullAccuracy: true, collectionId: collectionId))
    }
    func testProtectedOutboxPreservesIdentityAcrossRestartAndScopesAcknowledgement() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let outbox = MobileDeviceLocationOutbox(root: directory)
        let observation = try XCTUnwrap(MobileDeviceLocationObservation(location: fix(), fullAccuracy: true, collectionId: collectionId))
        try outbox.append(observation, scope: scope)
        let resumed = MobileDeviceLocationOutbox(root: directory)
        XCTAssertEqual(try resumed.next(scope: scope), observation)
        let other = try MobileDevicePairing.Scope(ownerId: "other-owner", url: scope.origin)
        XCTAssertNil(try resumed.next(scope: other))
        try resumed.acknowledge(UUID(), scope: scope)
        XCTAssertEqual(try resumed.next(scope: scope), observation)
        try resumed.acknowledge(observation.id, scope: scope)
        XCTAssertNil(try resumed.next(scope: scope))
    }
    func testNoOptInNeverStartsOrPromptsAndDenialStopsCollection() async throws {
        let driver = LocationDriverFixture()
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        var saved: MobileDeviceLocation.Binding?, uploads = 0
        let coordinator = MobileDeviceLocation(driver: driver, outbox: .init(root: directory), load: { saved }, save: { saved = $0 }) { _, _, _ in uploads += 1 }
        coordinator.activate(); driver.received?([fix()]); await Task.yield()
        XCTAssertTrue(driver.starts.isEmpty); XCTAssertTrue(driver.permissionRequests.isEmpty); XCTAssertEqual(uploads, 0)
        try coordinator.enable(scope, collectionId: collectionId)
        XCTAssertEqual(driver.starts, [true]); XCTAssertTrue(driver.permissionRequests.isEmpty)
        driver.authorization = .denied; driver.authorizationChanged?(); driver.received?([fix()])
        await Task.yield(); XCTAssertEqual(uploads, 0)
        coordinator.disable(matching: scope); XCTAssertNil(saved)
    }
    func testOfflineRetryUsesOriginalObservationAndRemoteDisabledPolicyClearsApproval() async throws {
        let driver = LocationDriverFixture()
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        var saved: MobileDeviceLocation.Binding?, received: [UUID] = [], fail = true
        let coordinator = MobileDeviceLocation(driver: driver, outbox: .init(root: directory), load: { saved }, save: { saved = $0 }) { observation, _, check in
            try check(); received.append(observation.id)
            if fail { throw URLError(.notConnectedToInternet) }
            throw MobileDeviceLocationTransport.Failure.collectionChanged
        }
        coordinator.activate(); try coordinator.enable(scope, collectionId: collectionId)
        for _ in 0..<10 { await Task.yield() }
        driver.received?([fix()])
        for _ in 0..<10 { await Task.yield() }
        XCTAssertEqual(received.count, 1); XCTAssertNotNil(saved)
        fail = false; coordinator.flush()
        for _ in 0..<10 { await Task.yield() }
        XCTAssertEqual(received.count, 2); XCTAssertEqual(received.first, received.last); XCTAssertNil(saved)
    }
    func testTransportNegotiatesNodeContractAndFencesCollectionWithoutCookies() async throws {
        let observation = try XCTUnwrap(MobileDeviceLocationObservation(location: fix(), fullAccuracy: false, collectionId: collectionId))
        let record = MobileDevicePairing.Record(scope: scope, privateKey: Data(repeating: 1, count: 32),
            nonce: "synthetic", credential: "synthetic-device-credential", pairingSecret: "synthetic", expiresAt: .distantFuture,
            deviceId: "synthetic-device")
        var posted: [Data] = [], changed = false
        let transport = MobileDeviceLocationTransport(load: { _ in record }, save: { _ in }) { request in
            XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
            var response: [String: Any]
            switch request.url!.path {
            case LopuVoiceContract.manifestPath:
                XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
                response = ["schemaVersion": 1, "origin": "https://example.test",
                    "features": ["api.devices-node-observations": ["version": "1.0.0"]]]
            case "/api/v1/devices/node/observations":
                XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer synthetic-device-credential")
                if let body = request.httpBody {
                    posted.append(body)
                    response = ["ok": true, "observation": ["id": observation.id.uuidString, "deviceId": "synthetic-device"]]
                } else {
                    response = ["ok": true, "settings": ["enabled": true, "collectionId": changed ? UUID().uuidString : self.collectionId]]
                }
            default: XCTFail("Unexpected endpoint"); response = [:]
            }
            return (try MobileDevicePairing.json(response), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }
        try await transport.send(observation, scope: scope, check: {})
        try await transport.send(observation, scope: scope, check: {})
        XCTAssertEqual(posted.count, 2); XCTAssertEqual(posted[0], posted[1])
        changed = true
        do { try await transport.send(observation, scope: scope, check: {}); XCTFail("Changed collection must refuse saved samples") }
        catch MobileDeviceLocationTransport.Failure.collectionChanged { }
        XCTAssertEqual(posted.count, 2)
    }

    func testUploadedMP3ConvertsToSupportedCachedSoundWithoutChangingOriginal() async throws {
        let source = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "device-alert-tone", withExtension: "mp3"))
        let original = try Data(contentsOf: source)
        let library = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: library) }
        let name = try await MobileDeviceNotificationSound.prepare(source: source, soundId: String(repeating: "a", count: 64), library: library)
        XCTAssertEqual(try Data(contentsOf: source), original)
        let cached = library.appendingPathComponent("Sounds").appendingPathComponent(name)
        let audio = try AVAudioFile(forReading: cached)
        XCTAssertGreaterThan(audio.length, 0)
        XCTAssertLessThan(Double(audio.length) / audio.fileFormat.sampleRate, 30)
        XCTAssertEqual(audio.fileFormat.settings[AVFormatIDKey] as? UInt32, kAudioFormatLinearPCM)
    }

    func testGenericPresenceCleanupRetainsPreferenceButFencesRelaunchUntilSameOwnerVerified() async throws {
        let driver = LocationDriverFixture()
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let outbox = MobileDeviceLocationOutbox(root: directory)
        var saved: MobileDeviceLocation.Binding? = .init(scope: scope, collectionId: collectionId), uploads = 0
        let coordinator = MobileDeviceLocation(driver: driver, outbox: outbox, load: { saved }, save: { saved = $0 }) { _, _, check in
            try check(); uploads += 1
        }
        coordinator.activate()
        for _ in 0..<10 { await Task.yield() }
        let bridge = MobileDeviceBridge(location: coordinator)
        let web = WKWebView()
        bridge.suspend() // Request abort/resigning active must preserve background opt-in.
        XCTAssertEqual(saved?.backgroundAuthorized, true)
        let observation = try XCTUnwrap(MobileDeviceLocationObservation(location: fix(), fullAccuracy: false, collectionId: collectionId))
        try outbox.append(observation, scope: scope)
        bridge.handle(["payload": ["requestId": UUID().uuidString, "ownerId": scope.ownerId,
            "action": "presence", "enabled": false]], webView: web, root: scope.origin,
            currentRoot: { self.scope.origin }, cookies: { values, _ in values }, reply: { _, _ in })
        XCTAssertEqual(saved?.scope, scope); XCTAssertEqual(saved?.collectionId, collectionId)
        XCTAssertEqual(saved?.backgroundAuthorized, false, "StrictMode/identity cleanup withdraws authority without erasing consent")
        XCTAssertNotNil(try outbox.next(scope: scope))
        let resumedDriver = LocationDriverFixture()
        let resumed = MobileDeviceLocation(driver: resumedDriver, outbox: outbox, load: { saved }, save: { saved = $0 }) { _, _, check in
            try check(); uploads += 1
        }
        resumed.activate()
        resumed.flush()
        for _ in 0..<10 { await Task.yield() }
        XCTAssertTrue(resumedDriver.starts.isEmpty); XCTAssertEqual(uploads, 0, "Background relaunch after cleanup must not upload")
        let otherOwner = try MobileDevicePairing.Scope(ownerId: "other-owner", url: scope.origin)
        resumed.verified(otherOwner)
        XCTAssertEqual(resumed.status(for: otherOwner)["enabled"] as? Bool, false, "Another account must not inherit the saved consent projection")
        XCTAssertEqual(saved?.backgroundAuthorized, false); XCTAssertEqual(uploads, 0)
        resumed.verified(scope)
        for _ in 0..<10 { await Task.yield() }
        XCTAssertEqual(saved?.backgroundAuthorized, true); XCTAssertEqual(uploads, 1)
        XCTAssertEqual(resumedDriver.starts, [true])
        XCTAssertTrue(resumedDriver.permissionRequests.isEmpty)
    }

    func testForegroundReverificationSuspendsDurablyWithoutDeletingEnabledPreference() throws {
        let driver = LocationDriverFixture()
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        var saved: MobileDeviceLocation.Binding? = .init(scope: scope, collectionId: collectionId)
        let coordinator = MobileDeviceLocation(driver: driver, outbox: .init(root: directory), load: { saved }, save: { saved = $0 }) { _, _, _ in XCTFail("Unverified upload") }
        coordinator.activate(foreground: true)
        XCTAssertEqual(saved?.backgroundAuthorized, false)
        XCTAssertEqual(coordinator.status["enabled"] as? Bool, true)
        XCTAssertTrue(driver.starts.isEmpty)
    }

    func testSoundNamesCannotEscapeNotificationDirectory() {
        XCTAssertNil(MobileDeviceNotificationSound.validatedName("../secret.caf"))
        XCTAssertNil(MobileDeviceNotificationSound.validatedName("track.mp3"))
        let name = "tt-" + String(repeating: "a", count: 64) + ".caf"
        XCTAssertEqual(MobileDeviceNotificationSound.validatedName(name), name)
        XCTAssertFalse(MobileDeviceHardware.modelIdentifier.isEmpty)
    }
}
