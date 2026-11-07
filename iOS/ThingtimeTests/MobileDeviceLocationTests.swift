import AVFoundation
import CoreLocation
import XCTest
import WebKit
import UIKit
@testable import Thingtime

@MainActor
private final class LocationDriverFixture: MobileLocationDriving {
    var authorization: CLAuthorizationStatus = .authorizedAlways
    var fullAccuracy = false
    var received: (([CLLocation]) -> Void)?
    var authorizationChanged: (() -> Void)?
    var starts: [Bool] = [], permissionRequests: [Bool] = []
    var stops = 0
    func requestPermission(always: Bool) { permissionRequests.append(always) }
    func start(background: Bool) { starts.append(background) }
    func stop() { stops += 1 }
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
    func testLocationCadenceSurvivesOfflineAndSameCollectionRelaunch() async throws {
        let driver = LocationDriverFixture()
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let outbox = MobileDeviceLocationOutbox(root: directory)
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        var clock = start
        var saved: MobileDeviceLocation.Binding?
        let coordinator = MobileDeviceLocation(driver: driver, outbox: outbox, load: { saved }, save: { saved = $0 }, now: { clock }) { _, _, _ in
            throw URLError(.notConnectedToInternet)
        }
        coordinator.activate()
        try coordinator.enable(scope, collectionId: collectionId)
        clock = start.addingTimeInterval(301)
        driver.received?([
            fix(timestamp: start.addingTimeInterval(300)),
            fix(timestamp: start.addingTimeInterval(-1)), // stale pre-consent cache
            fix(timestamp: start.addingTimeInterval(299)), // inside first sample interval
            fix(timestamp: start),
            fix(timestamp: start)
        ])
        XCTAssertEqual(saved?.lastObservationAt, start.addingTimeInterval(300))
        coordinator.suspendAuthorization()
        try coordinator.enable(scope, collectionId: collectionId) // repeat must preserve queue/watermark
        XCTAssertNotNil(try outbox.next(scope: scope))
        XCTAssertEqual(saved?.lastObservationAt, start.addingTimeInterval(300))
        coordinator.suspendAuthorization()
        var delivered: [Date] = []
        let resumedDriver = LocationDriverFixture()
        let persisted = try JSONEncoder().encode(XCTUnwrap(saved))
        saved = try JSONDecoder().decode(MobileDeviceLocation.Binding.self, from: persisted)
        let resumed = MobileDeviceLocation(driver: resumedDriver, outbox: outbox, load: { saved }, save: { saved = $0 }, now: { clock }) { observation, _, check in
            try check(); delivered.append(observation.observedAt)
        }
        resumed.activate()
        XCTAssertTrue(resumedDriver.starts.isEmpty, "Revoked foreground authority cannot be restored by a background launch")
        resumed.verified(scope)
        clock = start.addingTimeInterval(600)
        resumedDriver.received?([fix(timestamp: start.addingTimeInterval(599)), fix(timestamp: clock)])
        try await resumed.flushAndWait(check: {})
        XCTAssertEqual(delivered.sorted(), [start, start.addingTimeInterval(300), start.addingTimeInterval(600)])
        XCTAssertNil(try outbox.next(scope: scope))
    }
    func testPermissionDowngradeWhileBackgroundedStopsAndFencesLocation() async throws {
        let driver = LocationDriverFixture()
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let outbox = MobileDeviceLocationOutbox(root: directory)
        var active = true
        let coordinator = MobileDeviceLocation(driver: driver, outbox: outbox, load: { nil }, save: { _ in }, appIsActive: { active }) { _, _, _ in
            XCTFail("A background When in Use fix must not upload")
        }
        coordinator.activate()
        try coordinator.enable(scope, collectionId: collectionId)
        let previousStops = driver.stops
        active = false; driver.authorization = .authorizedWhenInUse
        driver.authorizationChanged?()
        driver.received?([fix()])
        try await coordinator.flushAndWait(check: {})
        XCTAssertGreaterThan(driver.stops, previousStops)
        XCTAssertNil(try outbox.next(scope: scope))
        XCTAssertEqual(coordinator.status["backgroundAvailable"] as? Bool, false)
        XCTAssertEqual(coordinator.status["collectionMode"] as? String, "significant-change")
        XCTAssertEqual(coordinator.status["samplingMode"] as? String, "standard")
        XCTAssertEqual(driver.starts, [true])
        active = true
        coordinator.verified(scope)
        XCTAssertEqual(driver.starts, [true, false])
        XCTAssertTrue(driver.permissionRequests.isEmpty)
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

    func testIdentitySuspendRejectsLateNativeStatusWithoutForgettingConsent() async throws {
        let driver = LocationDriverFixture()
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        var saved: MobileDeviceLocation.Binding? = .init(scope: scope, collectionId: collectionId)
        let coordinator = MobileDeviceLocation(driver: driver, outbox: .init(root: directory), load: { saved }, save: { saved = $0 }) { _, _, _ in }
        coordinator.activate()
        var completeVerification: CheckedContinuation<Void, Never>?
        let bridge = MobileDeviceLocationBridge(location: coordinator, appIsActive: { true }, verify: { _, _, _, _ in
            await withCheckedContinuation { completeVerification = $0 }
        })
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let web = WKWebView(frame: .zero, configuration: configuration)
        let fixtureURL = scope.origin.appendingPathComponent("location-identity-fixture")
        web.loadHTMLString("<html><body>Identity fixture</body></html>", baseURL: fixtureURL)
        for _ in 0..<200 {
            if !web.isLoading, web.url == fixtureURL { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertEqual(web.url, fixtureURL)
        func send(_ action: String, owner: String) {
            bridge.handle(["payload": ["requestId": UUID().uuidString, "ownerId": owner, "action": action]],
                webView: web, root: scope.origin, currentRoot: { self.scope.origin }, cookies: { values, _ in values }, reply: { _, _ in })
        }
        send("status", owner: scope.ownerId)
        for _ in 0..<100 { if completeVerification != nil { break }; try await Task.sleep(nanoseconds: 5_000_000) }
        let late = try XCTUnwrap(completeVerification)
        send("suspend", owner: scope.ownerId)
        XCTAssertEqual(saved?.backgroundAuthorized, false)
        XCTAssertEqual(saved?.scope, scope)
        late.resume() // A successful old HTTP response after logout is not new authority.
        for _ in 0..<20 { await Task.yield() }
        XCTAssertEqual(saved?.backgroundAuthorized, false)
        XCTAssertEqual(coordinator.status(for: scope)["enabled"] as? Bool, true)
        let newScope = try MobileDevicePairing.Scope(ownerId: "new-owner", url: scope.origin)
        try coordinator.enable(newScope, collectionId: UUID().uuidString)
        send("suspend", owner: scope.ownerId)
        XCTAssertEqual(saved?.scope, newScope)
        XCTAssertEqual(saved?.backgroundAuthorized, true, "Old-owner teardown cannot cancel a newer owner")
    }

    func testSoundNamesCannotEscapeNotificationDirectory() {
        XCTAssertNil(MobileDeviceNotificationSound.validatedName("../secret.caf"))
        XCTAssertNil(MobileDeviceNotificationSound.validatedName("track.mp3"))
        let name = "tt-" + String(repeating: "a", count: 64) + ".caf"
        XCTAssertEqual(MobileDeviceNotificationSound.validatedName(name), name)
        XCTAssertFalse(MobileDeviceHardware.modelIdentifier.isEmpty)
    }
}
