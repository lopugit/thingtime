import CryptoKit
import Foundation
import XCTest
@testable import ThingtimeNodeCore

private final class MockURLProtocol: URLProtocol, @unchecked Sendable {
    static let lock = NSLock()
    nonisolated(unsafe) static var retryAfter: String?
    nonisolated(unsafe) static var identityVersion: String?
    nonisolated(unsafe) static var capabilityStatus = 200
    nonisolated(unsafe) static var featureOverrides: [String: String] = [:]
    nonisolated(unsafe) static var handler: ((URLRequest) throws -> (Int, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            Self.lock.lock()
            let handler = Self.handler
            let retryAfter = Self.retryAfter
            let identityVersion = Self.identityVersion
            let versions = ThingtimeAPIClient.capabilityRequirements.merging(Self.featureOverrides) { _, new in new }
            Self.lock.unlock()
            let status: Int, data: Data
            if request.url?.path == "/.well-known/thingtime-capabilities.json" {
                XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
                var origin = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!
                origin.path = ""; origin.query = nil
                status = Self.capabilityStatus
                var features = versions.mapValues { ["version": $0] }
                if let identityVersion { features["api.devices-node-identity"] = ["version": identityVersion] }
                data = try JSONSerialization.data(withJSONObject: ["schemaVersion": 1, "origin": origin.string!, "features": features])
            } else { (status, data) = try XCTUnwrap(handler)(request) }
            let response = HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: status, httpVersion: nil, headerFields: retryAfter.map { ["Retry-After": $0] })!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }
    override func stopLoading() {}
}

private actor ChangingCredentialStore: DeviceCredentialStore {
    let credentials: [DeviceCredential]
    var reads = 0
    init(_ credentials: [DeviceCredential]) { self.credentials = credentials }
    func load() async throws -> DeviceCredential? { try await loadAll().first }
    func loadAll() async throws -> [DeviceCredential] { reads += 1; return reads == 1 ? credentials : [] }
    func save(_ credential: DeviceCredential) async throws {}
    func delete() async throws {}
    func loadPendingPairingClaim() async throws -> PendingPairingClaim? { nil }
    func savePendingPairingClaim(_ claim: PendingPairingClaim) async throws {}
    func deletePendingPairingClaim() async throws {}
}

private actor SequencedIdentityCredentials: DeviceCredentialStore {
    let snapshots: [[DeviceCredential]]
    var reads = 0
    init(_ snapshots: [[DeviceCredential]]) { self.snapshots = snapshots }
    func load() async throws -> DeviceCredential? { try await loadAll().first }
    func loadAll() async throws -> [DeviceCredential] { defer { reads += 1 }; return snapshots[min(reads, snapshots.count - 1)] }
    func save(_ credential: DeviceCredential) async throws {}
    func delete() async throws {}
    func loadPendingPairingClaim() async throws -> PendingPairingClaim? { nil }
    func savePendingPairingClaim(_ claim: PendingPairingClaim) async throws {}
    func deletePendingPairingClaim() async throws {}
}

private final class IdentityRequestCount: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    private var starts: [Double] = []
    func increment() { lock.withLock { count += 1; starts.append(ProcessInfo.processInfo.systemUptime) } }
    var startTimes: [Double] { lock.withLock { starts } }
    var value: Int { lock.withLock { count } }
}

final class ThingtimeAPIClientTests: XCTestCase {
    override func tearDown() {
        MockURLProtocol.lock.lock()
        MockURLProtocol.handler = nil; MockURLProtocol.identityVersion = nil; MockURLProtocol.retryAfter = nil
        MockURLProtocol.featureOverrides = [:]
        MockURLProtocol.capabilityStatus = 200
        MockURLProtocol.lock.unlock()
        super.tearDown()
    }

    private func waitForIdentityQueue(_ admission: FileSyncIdentityAdmission) async throws {
        for _ in 0..<10_000 {
            if await admission.queuedForTesting == 1 { return }
            await Task.yield()
        }
        XCTFail("Identity did not reach admission"); throw CancellationError()
    }

    func testQueuedIdentityRechecksRevocationRotationAndCancellationBeforeAnyFreshHTTP() async throws {
        MockURLProtocol.identityVersion = "1.0.0"
        let credential = DeviceCredential(deviceID: "device", refreshToken: "ttnode_queued", signingPrivateKey: Data(), signingPublicKey: Data())
        for change in ["revoke", "rotate", "cancel"] {
            let store = InMemoryDeviceCredentialStore(credential: credential)
            let admission = FileSyncIdentityAdmission.instantForTests()
            let key = FileSyncIdentityAdmission.scope(origin: URL(string: "https://thingtime.test")!, credential: credential)
            let held = try await admission.acquire(key)
            var requests = 0
            MockURLProtocol.handler = { _ in requests += 1; return (200, Data(#"{"ok":true,"ownerId":"owner","deviceId":"device"}"#.utf8)) }
            let client = try ThingtimeAPIClient(baseURL: URL(string: "https://thingtime.test")!, credentialStore: store,
                                                session: session(), identityAdmission: admission)
            let pending = Task { try await client.verifyFileSyncIdentity(ownerID: "owner", deviceID: "device") }
            try await waitForIdentityQueue(admission)
            if change == "revoke" { try await store.delete() }
            else if change == "rotate" {
                try await store.save(DeviceCredential(deviceID: "device", refreshToken: "ttnode_rotated", signingPrivateKey: Data(), signingPublicKey: Data()))
            } else { pending.cancel() }
            await admission.finish(held)
            do { try await pending.value; XCTFail("Queued changed/cancelled credential sent") }
            catch { if change == "cancel" { XCTAssertTrue(error is CancellationError) } else { XCTAssertEqual(error as? ThingtimeAPIClientError, .notPaired) } }
            XCTAssertEqual(requests, 0)
            // Cancellation/failed local revalidation cannot strand the next lane.
            let next = try await admission.acquire(key); await admission.finish(next)
        }
    }

    func testConcurrentIdentityCallsEachPerformFreshHTTPAndRejectChangedOwner() async throws {
        MockURLProtocol.identityVersion = "1.0.0"
        let credential = DeviceCredential(deviceID: "device", refreshToken: "ttnode_fresh", signingPrivateKey: Data(), signingPublicKey: Data())
        let count = IdentityRequestCount()
        MockURLProtocol.handler = { _ in count.increment(); return (200, Data(#"{"ok":true,"ownerId":"owner","deviceId":"device"}"#.utf8)) }
        let admission = FileSyncIdentityAdmission.instantForTests()
        let store = InMemoryDeviceCredentialStore(credential: credential)
        let first = try ThingtimeAPIClient(baseURL: URL(string: "https://thingtime.test")!, credentialStore: store, session: session(), identityAdmission: admission)
        let second = try ThingtimeAPIClient(baseURL: URL(string: "https://thingtime.test/")!, credentialStore: store, session: session(), identityAdmission: admission)
        async let a: Void = first.verifyFileSyncIdentity(ownerID: "owner", deviceID: "device")
        async let b: Void = second.verifyFileSyncIdentity(ownerID: "owner", deviceID: "device")
        _ = try await (a, b)
        XCTAssertEqual(count.value, 2, "Admission must not singleflight or cache identity")
        do { try await second.verifyFileSyncIdentity(ownerID: "different-owner", deviceID: "device"); XCTFail("Owner switch accepted") }
        catch { XCTAssertEqual(error as? ThingtimeAPIClientError, .notPaired) }
        XCTAssertEqual(count.value, 3)
    }

    func testIdentityStillRechecksCredentialAfterEveryFreshHTTPResponse() async throws {
        MockURLProtocol.identityVersion = "1.0.0"
        let original = DeviceCredential(deviceID: "device", refreshToken: "ttnode_original", signingPrivateKey: Data(), signingPublicKey: Data())
        let replacement = DeviceCredential(deviceID: "device", refreshToken: "ttnode_new", signingPrivateKey: Data(), signingPublicKey: Data())
        for final in [[], [replacement], [original, original]] {
            let count = IdentityRequestCount()
            MockURLProtocol.handler = { _ in count.increment(); return (200, Data(#"{"ok":true,"ownerId":"owner","deviceId":"device"}"#.utf8)) }
            let client = try ThingtimeAPIClient(baseURL: URL(string: "https://thingtime.test")!,
                credentialStore: SequencedIdentityCredentials([[original], [original], final]),
                session: session(), identityAdmission: .instantForTests())
            do { try await client.verifyFileSyncIdentity(ownerID: "owner", deviceID: "device"); XCTFail("Post-response credential change accepted") }
            catch { XCTAssertEqual(error as? ThingtimeAPIClientError, .notPaired) }
            XCTAssertEqual(count.value, 1)
        }
    }

    func testPublicClientsUseTheSameProcessAdmissionRatherThanIndependentBurstBudgets() async throws {
        MockURLProtocol.identityVersion = "1.0.0"
        let credential = DeviceCredential(deviceID: "device", refreshToken: "ttnode_public_shared_" + UUID().uuidString,
                                          signingPrivateKey: Data(), signingPublicKey: Data())
        let count = IdentityRequestCount()
        MockURLProtocol.handler = { _ in count.increment(); return (200, Data(#"{"ok":true,"ownerId":"owner","deviceId":"device"}"#.utf8)) }
        let store = InMemoryDeviceCredentialStore(credential: credential)
        // Deliberately use the public initializer: production must share admission
        // across clients, not only when a test injects one coordinator.
        let first = try ThingtimeAPIClient(baseURL: URL(string: "https://thingtime.test")!, credentialStore: store, session: session())
        let second = try ThingtimeAPIClient(baseURL: URL(string: "https://thingtime.test/")!, credentialStore: store, session: session())
        async let a: Void = first.verifyFileSyncIdentity(ownerID: "owner", deviceID: "device")
        async let b: Void = second.verifyFileSyncIdentity(ownerID: "owner", deviceID: "device")
        _ = try await (a, b)
        let times = count.startTimes
        XCTAssertEqual(times.count, 2)
        XCTAssertGreaterThanOrEqual(times[1] - times[0], 0.30)
    }

    func testIdentityCooldownUsesOnlyCanonicalIntegerRetryAfterAndRetainsLongerWindows() {
        let url = URL(string: "https://thingtime.test/api/v1/devices/node/identity")!
        for (status, header, expected) in [(429, "1", 1 as Int?), (429, "86400", 86400), (429, "86401", nil), (429, "bad", nil), (200, "60", nil)] {
            let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: ["Retry-After": header])!
            XCTAssertEqual(ThingtimeAPIClient.identityCooldown(response), expected)
        }
    }

    func testFileSyncIdentityDiagnosticsContainOnlyBoundedStatusTimingAndCooldown() {
        XCTAssertNil(ThingtimeAPIClient.fileSyncIdentityDiagnostic(status: 200, elapsedMilliseconds: 100, attempt: 0, cooldownSeconds: nil))
        XCTAssertEqual(ThingtimeAPIClient.fileSyncIdentityDiagnostic(status: 429, elapsedMilliseconds: 321, attempt: 0, cooldownSeconds: 12),
                       "File-sync identity: status=429 elapsedMilliseconds=321 attempt=0 retry=cooldown cooldownSeconds=12")
        XCTAssertEqual(ThingtimeAPIClient.fileSyncIdentityDiagnostic(status: 200, elapsedMilliseconds: 14000, attempt: 1, cooldownSeconds: nil),
                       "File-sync identity: status=200 elapsedMilliseconds=14000 attempt=1 retry=after-cooldown cooldownSeconds=0")
        XCTAssertNil(ThingtimeAPIClient.fileSyncIdentityDiagnostic(status: 200, elapsedMilliseconds: 100, attempt: 0, cooldownSeconds: 12))
        XCTAssertNil(ThingtimeAPIClient.fileSyncIdentityDiagnostic(status: 429, elapsedMilliseconds: -1, attempt: 0, cooldownSeconds: 12))
        XCTAssertNil(ThingtimeAPIClient.fileSyncIdentityDiagnostic(status: 429, elapsedMilliseconds: 1, attempt: 0, cooldownSeconds: 61))
        XCTAssertNil(ThingtimeAPIClient.fileSyncIdentityDiagnostic(status: 999, elapsedMilliseconds: 1, attempt: 0, cooldownSeconds: nil))
    }

    func testFileSyncIdentityHonorsOneBoundedCooldownAndRevalidatesLive() async throws {
        MockURLProtocol.identityVersion = "1.0.0"; MockURLProtocol.retryAfter = "60"
        let credential = DeviceCredential(deviceID: "device", refreshToken: "ttnode_test", signingPrivateKey: Data(), signingPublicKey: Data())
        var requests = 0
        MockURLProtocol.handler = { request in
            requests += 1
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer ttnode_test")
            return requests == 1 ? (429, Data()) : (200, Data(#"{"ok":true,"ownerId":"owner","deviceId":"device"}"#.utf8))
        }
        let client = try ThingtimeAPIClient(baseURL: URL(string: "https://thingtime.test")!,
            credentialStore: InMemoryDeviceCredentialStore(credential: credential), session: session(), identityAdmission: .instantForTests(),
            fileSyncRetrySleep: { seconds in XCTAssertEqual(seconds, 60) })
        try await client.verifyFileSyncIdentity(ownerID: "owner", deviceID: "device")
        XCTAssertEqual(requests, 2)
        try await client.verifyFileSyncIdentity(ownerID: "owner", deviceID: "device")
        XCTAssertEqual(requests, 3, "Successful identity must not be cached")
    }

    func testIdentityCapabilityOutageRetainsHTTPFailureWithoutAcceptingCapabilities() async throws {
        MockURLProtocol.identityVersion = "1.0.0"
        let credential = DeviceCredential(deviceID: "device", refreshToken: "ttnode_test", signingPrivateKey: Data(), signingPublicKey: Data())
        var identityRequests = 0
        MockURLProtocol.handler = { _ in identityRequests += 1; return (200, Data(#"{"ok":true,"ownerId":"owner","deviceId":"device"}"#.utf8)) }
        for status in [408, 429, 503, 401, 403] {
            MockURLProtocol.capabilityStatus = status
            let client = try ThingtimeAPIClient(baseURL: URL(string: "https://thingtime.test")!,
                credentialStore: InMemoryDeviceCredentialStore(credential: credential), session: session(), identityAdmission: .instantForTests())
            do { try await client.verifyFileSyncIdentity(ownerID: "owner", deviceID: "device"); XCTFail("Unavailable capability accepted") }
            catch { XCTAssertEqual(error as? ThingtimeAPIClientError, [408, 429, 503].contains(status) ? .rejected(status: status) : .incompatibleCapabilities) }
            XCTAssertEqual(identityRequests, 0)
            MockURLProtocol.capabilityStatus = 200
            try await client.verifyFileSyncIdentity(ownerID: "owner", deviceID: "device")
            identityRequests = 0
        }
    }

    func testIdentityLargeErrorPagesPreserveStatusWhileLargeSuccessRemainsInvalid() async throws {
        MockURLProtocol.identityVersion = "1.0.0"
        let credential = DeviceCredential(deviceID: "device", refreshToken: "ttnode_test", signingPrivateKey: Data(), signingPublicKey: Data())
        for status in [200, 429, 503, 401, 403] {
            MockURLProtocol.handler = { _ in (status, Data(repeating: 32, count: 16_385)) }
            let client = try ThingtimeAPIClient(baseURL: URL(string: "https://thingtime.test")!,
                credentialStore: InMemoryDeviceCredentialStore(credential: credential), session: session(), identityAdmission: .instantForTests())
            do { try await client.verifyFileSyncIdentity(ownerID: "owner", deviceID: "device"); XCTFail("Oversized success accepted") }
            catch { XCTAssertEqual(error as? ThingtimeAPIClientError, status == 200 ? .invalidResponse : .rejected(status: status)) }
        }
    }

    func testFileSyncIdentityNeverRetriesAuthFailuresInvalidDelaysOrForever() async throws {
        MockURLProtocol.identityVersion = "1.0.0"
        let credential = DeviceCredential(deviceID: "device", refreshToken: "ttnode_test", signingPrivateKey: Data(), signingPublicKey: Data())
        for (status, header, expected) in [(401, "1", 1), (403, "1", 1), (500, "1", 1), (429, "0", 1), (429, "61", 1), (429, "bad", 1), (429, "1.5", 1), (429, "1", 2)] {
            var requests = 0
            MockURLProtocol.retryAfter = header
            MockURLProtocol.handler = { _ in requests += 1; return (status, Data()) }
            let client = try ThingtimeAPIClient(baseURL: URL(string: "https://thingtime.test")!, credentialStore: InMemoryDeviceCredentialStore(credential: credential), session: session(), identityAdmission: .instantForTests(),
                fileSyncRetrySleep: { seconds in XCTAssertEqual(status, 429); XCTAssertEqual(seconds, 1) })
            do { try await client.verifyFileSyncIdentity(ownerID: "owner", deviceID: "device"); XCTFail("Repeated failure accepted") }
            catch { XCTAssertEqual(error as? ThingtimeAPIClientError, .rejected(status: status)) }
            XCTAssertEqual(requests, expected)
        }
    }

    func testFileSyncIdentityUnpairAndCancellationDuringCooldownStopBeforeRetry() async throws {
        MockURLProtocol.identityVersion = "1.0.0"; MockURLProtocol.retryAfter = "1"
        let credential = DeviceCredential(deviceID: "device", refreshToken: "ttnode_test", signingPrivateKey: Data(), signingPublicKey: Data())
        for change in ["unpair", "replace", "cancel"] {
            let store = InMemoryDeviceCredentialStore(credential: credential)
            var requests = 0
            MockURLProtocol.handler = { _ in requests += 1; return (429, Data()) }
            let client = try ThingtimeAPIClient(baseURL: URL(string: "https://thingtime.test")!, credentialStore: store, session: session(), identityAdmission: .instantForTests(), fileSyncRetrySleep: { _ in
                if change == "cancel" { throw CancellationError() }
                if change == "replace" {
                    try await store.save(DeviceCredential(deviceID: "device", refreshToken: "ttnode_replacement", signingPrivateKey: Data(), signingPublicKey: Data()))
                } else { try await store.delete() }
            })
            do { try await client.verifyFileSyncIdentity(ownerID: "owner", deviceID: "device"); XCTFail("Changed/cancelled identity retried") }
            catch { if change == "cancel" { XCTAssertTrue(error is CancellationError) } else { XCTAssertEqual(error as? ThingtimeAPIClientError, .notPaired) } }
            XCTAssertEqual(requests, 1)
        }
    }

    func testFileSyncIdentityTaskCancellationInterruptsActualCooldown() async throws {
        MockURLProtocol.identityVersion = "1.0.0"; MockURLProtocol.retryAfter = "60"
        let credential = DeviceCredential(deviceID: "device", refreshToken: "ttnode_test", signingPrivateKey: Data(), signingPublicKey: Data())
        let waiting = expectation(description: "cooldown started")
        var requests = 0
        MockURLProtocol.handler = { _ in requests += 1; return (429, Data()) }
        let client = try ThingtimeAPIClient(baseURL: URL(string: "https://thingtime.test")!, credentialStore: InMemoryDeviceCredentialStore(credential: credential), session: session(), identityAdmission: .instantForTests(), fileSyncRetrySleep: { seconds in
            waiting.fulfill()
            try await Task.sleep(nanoseconds: seconds * 1_000_000_000)
        })
        let pending = Task { try await client.verifyFileSyncIdentity(ownerID: "owner", deviceID: "device") }
        await fulfillment(of: [waiting], timeout: 2)
        pending.cancel()
        do { try await pending.value; XCTFail("Cancelled cooldown succeeded") }
        catch { XCTAssertTrue(error is CancellationError) }
        XCTAssertEqual(requests, 1)
    }

    func testFileSyncIdentityRejectsLocalUnpairDuringReadAndAmbiguousCredentials() async throws {
        let credential = DeviceCredential(deviceID: "device", refreshToken: "ttnode_test", signingPrivateKey: Data(), signingPublicKey: Data())
        MockURLProtocol.identityVersion = "1.0.0"
        var requests = 0
        MockURLProtocol.handler = { _ in requests += 1; return (200, Data(#"{"ok":true,"ownerId":"owner","deviceId":"device"}"#.utf8)) }
        for credentials in [[credential], [credential, credential]] {
            let client = try ThingtimeAPIClient(baseURL: URL(string: "https://thingtime.test")!, credentialStore: ChangingCredentialStore(credentials), session: session(), identityAdmission: .instantForTests())
            do { try await client.verifyFileSyncIdentity(ownerID: "owner", deviceID: "device"); XCTFail("Changed or ambiguous local credential accepted") }
            catch { XCTAssertEqual(error as? ThingtimeAPIClientError, .notPaired) }
        }
        XCTAssertEqual(requests, 0, "Revoked or ambiguous credentials must fail before fresh HTTP")
    }

    func testFileSyncIdentityNegotiatesOptionalFeatureWithoutCachingMissingSupport() async throws {
        let credential = DeviceCredential(deviceID: "device", refreshToken: "ttnode_test", signingPrivateKey: Data(), signingPublicKey: Data())
        let client = try ThingtimeAPIClient(baseURL: URL(string: "https://thingtime.test")!, credentialStore: InMemoryDeviceCredentialStore(credential: credential), session: session(), identityAdmission: .instantForTests())
        var reads = 0
        MockURLProtocol.handler = { request in
            reads += 1
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.url?.absoluteString, "https://thingtime.test/api/v1/devices/node/identity")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer ttnode_test")
            XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
            return (200, Data(#"{"ok":true,"ownerId":"owner","deviceId":"device"}"#.utf8))
        }
        for version in [nil, "2.0.0", "1.0.0-beta"] as [String?] {
            MockURLProtocol.identityVersion = version
            do { try await client.verifyFileSyncIdentity(ownerID: "owner", deviceID: "device"); XCTFail("Missing or breaking feature accepted") }
            catch { XCTAssertEqual(error as? ThingtimeAPIClientError, .incompatibleCapabilities) }
        }
        XCTAssertEqual(reads, 0)
        MockURLProtocol.identityVersion = "1.0.0"
        try await client.verifyFileSyncIdentity(ownerID: "owner", deviceID: "device")
        try await client.verifyFileSyncIdentity(ownerID: "owner", deviceID: "device")
        XCTAssertEqual(reads, 2, "Identity must never use a cached account or credential result")
    }

    func testFileSyncIdentitySelectsExactPairedDeviceAndRejectsOwnerDeviceAndRevocation() async throws {
        let store = InMemoryDeviceCredentialStore(credential: .init(deviceID: "first", refreshToken: "ttnode_first", signingPrivateKey: Data(), signingPublicKey: Data()))
        try await store.save(.init(deviceID: "second", refreshToken: "ttnode_second", signingPrivateKey: Data(), signingPublicKey: Data()))
        let client = try ThingtimeAPIClient(baseURL: URL(string: "https://thingtime.test")!, credentialStore: store, session: session(), identityAdmission: .instantForTests())
        MockURLProtocol.identityVersion = "1.0.0"
        var status = 200, owner = "owner", device = "second", reads = 0
        MockURLProtocol.handler = { request in
            reads += 1
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer ttnode_second")
            return (status, try JSONSerialization.data(withJSONObject: ["ok": true, "ownerId": owner, "deviceId": device]))
        }
        try await client.verifyFileSyncIdentity(ownerID: "owner", deviceID: "second")
        owner = "other"
        do { try await client.verifyFileSyncIdentity(ownerID: "owner", deviceID: "second"); XCTFail("Wrong owner accepted") }
        catch { XCTAssertEqual(error as? ThingtimeAPIClientError, .notPaired) }
        owner = "owner"; device = "first"
        do { try await client.verifyFileSyncIdentity(ownerID: "owner", deviceID: "second"); XCTFail("Wrong device accepted") }
        catch { XCTAssertEqual(error as? ThingtimeAPIClientError, .notPaired) }
        device = "second"; status = 401
        do { try await client.verifyFileSyncIdentity(ownerID: "owner", deviceID: "second"); XCTFail("Revoked credential accepted") }
        catch { XCTAssertEqual(error as? ThingtimeAPIClientError, .rejected(status: 401)) }
        let before = reads
        do { try await client.verifyFileSyncIdentity(ownerID: "owner", deviceID: "missing"); XCTFail("Unpaired device accepted") }
        catch { XCTAssertEqual(error as? ThingtimeAPIClientError, .notPaired) }
        XCTAssertEqual(reads, before)
    }

    func testScriptLeaseRequiresCompatibleOriginAndFreshApprovedEnvelope() async throws {
        let credential = DeviceCredential(deviceID: "device-1", refreshToken: "ttnode_test", signingPrivateKey: Data(), signingPublicKey: Data())
        let command: [String: Any] = ["id": "script-1", "leaseId": "lease-1", "kind": "script.run", "input": ["script": "printf ok", "timeoutSeconds": 2], "leaseExpiresAt": "2099-08-18T04:00:30.123Z", "requiresApproval": true, "approvalState": "approved"]
        func client() throws -> ThingtimeAPIClient {
            try ThingtimeAPIClient(baseURL: URL(string: "https://thingtime.test")!, credentialStore: InMemoryDeviceCredentialStore(credential: credential), session: session(), identityAdmission: .instantForTests())
        }
        func setResponse(_ command: [String: Any], version: String) throws {
            let bytes = try JSONSerialization.data(withJSONObject: ["ok": true, "command": command])
            MockURLProtocol.lock.lock()
            MockURLProtocol.featureOverrides = ["api.devices-node-commands": version]
            MockURLProtocol.handler = { _ in (200, bytes) }
            MockURLProtocol.lock.unlock()
        }
        try setResponse(command, version: "1.9.0")
        let older = try client()
        await XCTAssertThrowsErrorAsync(try await older.leaseCommands(.init(deviceID: "device-1")))
        try setResponse(command, version: "1.10.0")
        let current = try client()
        let batch = try await current.leaseCommands(.init(deviceID: "device-1"))
        XCTAssertEqual(batch.commands.first?.method, "script.run")
        XCTAssertEqual(batch.commands.first?.approvedForExecution, true)
        for fields in [["requiresApproval": false, "approvalState": "approved"], ["requiresApproval": true, "approvalState": "pending"]] {
            try setResponse(command.merging(fields) { _, new in new }, version: "1.10.0")
            await XCTAssertThrowsErrorAsync(try await current.leaseCommands(.init(deviceID: "device-1")))
        }
    }

    func testMenuInventoryTransportNegotiatesOptionalField() async throws {
        let credential = DeviceCredential(deviceID: "device-1", refreshToken: "ttnode_test", signingPrivateKey: Data(), signingPublicKey: Data())
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let telemetry = DeviceTelemetry(deviceName: "Mac", hostName: "mac", modelIdentifier: nil, operatingSystemVersion: "macOS", architecture: "arm64", outputVolume: nil,
            session: .init(isLocked: true, isOnConsole: true), permissions: .init(accessibility: .denied, screenRecording: .denied), runningApplications: [], displays: [], collectedAt: now,
            menuBar: .init(status: "locked", collectedAt: now, accessibility: false, unreadableApplications: 0, items: []))
        for version in ["1.9.0", "1.13.0"] {
            MockURLProtocol.featureOverrides = ["api.devices-node-state": version]
            MockURLProtocol.handler = { request in
                let body = try JSONSerialization.jsonObject(with: try Self.bodyData(request)) as! [String: Any]
                let state = try XCTUnwrap(body["state"] as? [String: Any])
                if version == "1.9.0" { XCTAssertNil(state["menuBar"]) }
                else {
                    let menu = try XCTUnwrap(state["menuBar"] as? [String: Any])
                    XCTAssertEqual(menu["status"] as? String, "locked")
                    XCTAssertEqual((menu["items"] as? [Any])?.count, 0)
                    XCTAssertNotNil(menu["collectedAt"] as? String)
                }
                return (200, Data(#"{"ok":true,"revision":1,"applied":true,"stale":false}"#.utf8))
            }
            let client = try ThingtimeAPIClient(baseURL: URL(string: "https://thingtime.test")!, credentialStore: InMemoryDeviceCredentialStore(credential: credential), session: session(), identityAdmission: .instantForTests())
            try await client.sendHeartbeat(.init(deviceID: "device-1", telemetry: telemetry, connector: .init(state: .running)))
        }
    }

    func testCapabilityRequirementsRejectWrongOriginMissingAndBreakingFeatures() throws {
        let origin = URL(string: "https://thingtime.test")!
        let features = ThingtimeAPIClient.capabilityRequirements.mapValues { ["version": $0] }
        func accepts(_ versions: [String: [String: String]], _ scope: String = "https://thingtime.test") throws -> Bool {
            ThingtimeAPIClient.compatibleManifest(try JSONSerialization.data(withJSONObject: ["schemaVersion": 1, "origin": scope, "features": versions]), origin: origin)
        }
        XCTAssertTrue(try accepts(features))
        XCTAssertFalse(try accepts(features, "https://other.test"))
        XCTAssertFalse(try accepts([:]))
        var changed = features
        changed["api.devices-node-state"] = ["version": "1.11.0"]
        XCTAssertTrue(try accepts(changed))
        changed["api.devices-node-state"] = ["version": "2.0.0"]
        XCTAssertFalse(try accepts(changed))
        changed["api.devices-node-state"] = ["version": "1.8.9"]
        XCTAssertFalse(try accepts(changed))
        XCTAssertFalse(ThingtimeAPIClient.supportsBatteryDetails(try JSONSerialization.data(withJSONObject: ["schemaVersion": 1, "origin": origin.absoluteString, "features": features]), origin: origin))
        changed["api.devices-node-state"] = ["version": "1.10.0"]
        XCTAssertTrue(ThingtimeAPIClient.supportsBatteryDetails(try JSONSerialization.data(withJSONObject: ["schemaVersion": 1, "origin": origin.absoluteString, "features": changed]), origin: origin))
    }

    private func claimRequest() throws -> PairingClaimRequest {
        let privateKey = Curve25519.Signing.PrivateKey()
        let publicKey = privateKey.publicKey.rawRepresentation
        let nonce = Data(repeating: 2, count: 32)
        let serverNonce = Data(repeating: 3, count: 32)
        let device = PairingDeviceDescriptor(
            name: "Mac", platform: "macos", model: "Mac1,1", osVersion: "macOS 15", appVersion: "0.1.0"
        )
        let capabilities = ["apps.read", "system.volume.write"]
        let message = PairingClaimProof.canonicalMessage(
            pairingID: "pairing-id",
            pairingSecret: "pair-secret",
            credential: "ttnode_test-credential",
            publicKey: publicKey,
            nonce: nonce,
            serverNonce: serverNonce,
            device: device,
            capabilities: capabilities
        )
        return PairingClaimRequest(
            pairingSecret: "pair-secret",
            credential: "ttnode_test-credential",
            device: device,
            capabilities: capabilities,
            proof: PairingClaimProof(
                pairingID: "pairing-id",
                publicKey: publicKey,
                nonce: nonce,
                serverNonce: serverNonce,
                signature: try privateKey.signature(for: message)
            )
        )
    }

    private static func bodyData(_ request: URLRequest) throws -> Data {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else {
            throw XCTSkip("URLProtocol did not expose the request body.")
        }
        stream.open()
        defer { stream.close() }
        var result = Data()
        var buffer = [UInt8](repeating: 0, count: 4_096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count < 0 { throw try XCTUnwrap(stream.streamError) }
            if count == 0 { break }
            result.append(buffer, count: count)
        }
        return result
    }

    private func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockURLProtocol.self]
        return URLSession(configuration: configuration)
    }

    func testPrepareAndCompleteUseBoundProofAndReturnPersistedCredential() async throws {
        let claim = try claimRequest()
        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/v1/devices/pairing/claim")
            let body = try JSONSerialization.jsonObject(with: try Self.bodyData(request)) as! [String: Any]
            XCTAssertEqual(body["op"] as? String, "prepare")
            XCTAssertEqual(body["pairingSecret"] as? String, "pair-secret")
            XCTAssertEqual(body["publicKey"] as? String, claim.proof.publicKey.base64URLEncodedString())
            XCTAssertEqual(body["nonce"] as? String, claim.proof.nonce.base64URLEncodedString())
            let serverNonce = claim.proof.serverNonce.base64URLEncodedString()
            return (200, Data("{\"ok\":true,\"op\":\"prepare\",\"proof\":{\"pairingId\":\"pairing-id\",\"serverNonce\":\"\(serverNonce)\",\"expiresAt\":\"2099-08-18T04:00:30.123Z\"}}".utf8))
        }
        let client = try ThingtimeAPIClient(
            baseURL: URL(string: "https://thingtime.test/")!,
            credentialStore: InMemoryDeviceCredentialStore(),
            session: session(), identityAdmission: .instantForTests()
        )
        let prepared = try await client.preparePairing(.init(
            pairingSecret: claim.pairingSecret,
            publicKey: claim.proof.publicKey,
            nonce: claim.proof.nonce
        ))
        XCTAssertEqual(prepared.pairingID, claim.proof.pairingID)
        XCTAssertEqual(prepared.serverNonce, claim.proof.serverNonce)

        MockURLProtocol.handler = { request in
            let body = try JSONSerialization.jsonObject(with: try Self.bodyData(request)) as! [String: Any]
            XCTAssertEqual(body["op"] as? String, "complete")
            XCTAssertEqual(body["credential"] as? String, claim.credential)
            XCTAssertEqual(body["capabilities"] as? [String], claim.capabilities)
            let proof = try XCTUnwrap(body["proof"] as? [String: Any])
            XCTAssertEqual(proof["pairingId"] as? String, claim.proof.pairingID)
            XCTAssertEqual(proof["publicKey"] as? String, claim.proof.publicKey.base64URLEncodedString())
            XCTAssertEqual(proof["nonce"] as? String, claim.proof.nonce.base64URLEncodedString())
            XCTAssertEqual(proof["serverNonce"] as? String, claim.proof.serverNonce.base64URLEncodedString())
            XCTAssertEqual(proof["signature"] as? String, claim.proof.signature.base64URLEncodedString())
            return (200, Data(#"{"ok":true,"device":{"id":"device-1"},"credentialStored":true}"#.utf8))
        }
        let response = try await client.claimPairing(claim)
        XCTAssertEqual(response.deviceID, "device-1")
        XCTAssertEqual(response.refreshToken, claim.credential)
    }

    func testHeartbeatUsesBearerCredentialAndClosedStateShape() async throws {
        let credential = DeviceCredential(
            deviceID: "device-1", refreshToken: "ttnode_secret", signingPrivateKey: Data(), signingPublicKey: Data()
        )
        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer ttnode_secret")
            XCTAssertEqual(request.url?.path, "/api/v1/devices/node/state")
            let body = try JSONSerialization.jsonObject(with: try Self.bodyData(request)) as! [String: Any]
            XCTAssertNotNil(body["revision"])
            XCTAssertEqual(Set(body.keys), Set(["revision", "state", "connectors", "capabilities"]))
            let capabilities = try XCTUnwrap(body["capabilities"] as? [String])
            XCTAssertLessThanOrEqual(capabilities.count, 64)
            XCTAssertEqual(Set(capabilities).count, capabilities.count)
            XCTAssertTrue(capabilities.contains("filesystem.v1"))
            XCTAssertTrue(capabilities.contains("system.brightness.write"))
            let state = try XCTUnwrap(body["state"] as? [String: Any])
            XCTAssertEqual((state["openApps"] as? [[String: Any]])?.count, 64)
            let apps = try XCTUnwrap(state["openApps"] as? [[String: Any]])
            XCTAssertEqual(apps[0]["name"] as? String, "com.example.app0")
            XCTAssertEqual(apps[1]["name"] as? String, "com.example.app1")
            XCTAssertEqual(apps[2]["name"] as? String, "com.example.app2")
            XCTAssertEqual(try XCTUnwrap(state["brightness"] as? Double), 0.42, accuracy: 0.001)
			XCTAssertEqual(state["muted"] as? Bool, true)
			XCTAssertEqual(try XCTUnwrap(state["inputVolume"] as? Double), 0.35, accuracy: 0.001)
			XCTAssertEqual(state["inputMuted"] as? Bool, false)
			XCTAssertEqual(try XCTUnwrap(state["soundEffectsVolume"] as? Double), 0.25, accuracy: 0.001)
			XCTAssertEqual(state["soundEffectsMuted"] as? Bool, true)
			let audioDevices = try XCTUnwrap(state["audioDevices"] as? [[String: Any]])
			let audioDevice = try XCTUnwrap(audioDevices.first)
			XCTAssertEqual(audioDevice["id"] as? String, "BuiltInOutputDevice")
			XCTAssertEqual(audioDevice["name"] as? String, "MacBook Speakers")
			XCTAssertEqual(audioDevice["hasInput"] as? Bool, false)
			XCTAssertEqual(audioDevice["hasOutput"] as? Bool, true)
			XCTAssertEqual(audioDevice["isDefaultInput"] as? Bool, false)
			XCTAssertEqual(audioDevice["isDefaultOutput"] as? Bool, true)
			XCTAssertEqual(audioDevice["isDefaultSoundEffectsOutput"] as? Bool, true)
			let displays = try XCTUnwrap(state["displays"] as? [[String: Any]])
			XCTAssertEqual(displays.first?["id"] as? Int, 1)
			XCTAssertEqual(displays.first?["hdrActive"] as? Bool, false)
			XCTAssertEqual((state["printers"] as? [[String: Any]])?.first?["id"] as? String, "printer-1")
			XCTAssertEqual((state["cameras"] as? [[String: Any]])?.first?["authorization"] as? String, "denied")
			XCTAssertEqual((state["bluetoothDevices"] as? [[String: Any]])?.first?["id"] as? String, "bt-opaque")
			XCTAssertEqual((state["vpnServices"] as? [[String: Any]])?.first?["id"] as? String, "vpn-1")
			XCTAssertEqual((state["battery"] as? [String: Any])?["isPreventingIdleSleep"] as? Bool, true)
			XCTAssertEqual((state["battery"] as? [String: Any])?["isLowPowerModeEnabled"] as? Bool, false)
			XCTAssertEqual((state["powerTimers"] as? [String: Any])?["displayIdleMinutes"] as? Int, 10)
			XCTAssertEqual((state["appleMusic"] as? [String: Any])?["isInstalled"] as? Bool, true)
			XCTAssertEqual((state["spotify"] as? [String: Any])?["isInstalled"] as? Bool, true)
			XCTAssertEqual((state["chromeYouTube"] as? [String: Any])?["isInstalled"] as? Bool, true)
            let connectors = try XCTUnwrap(body["connectors"] as? [[String: Any]])
            XCTAssertEqual(connectors.count, 2)
            XCTAssertEqual(connectors[0]["projects"] as? [[String: String]], [
                ["projectId": "thingtime", "projectLabel": "thingtime"]
            ])
            XCTAssertEqual(connectors[1]["projects"] as? [[String: String]], [])
            return (200, Data(#"{"ok":true,"revision":1,"applied":true,"stale":false}"#.utf8))
        }
        let client = try ThingtimeAPIClient(
            baseURL: URL(string: "https://thingtime.test/")!,
            credentialStore: InMemoryDeviceCredentialStore(credential: credential),
            session: session(), identityAdmission: .instantForTests()
        )
        let applicationsWithoutStableIDs = (0 ..< 20).map { index in
            RunningApplicationTelemetry(
                processIdentifier: Int32(index),
                bundleIdentifier: index.isMultiple(of: 2) ? nil : " \n\t ",
                name: "Unidentified \(index)",
                isActive: false,
                isHidden: false
            )
        }
        let runningApplications = applicationsWithoutStableIDs + (0 ..< 80).map { index in
            RunningApplicationTelemetry(
                processIdentifier: Int32(index + applicationsWithoutStableIDs.count),
                bundleIdentifier: "com.example.app\(index)",
                name: index == 0 ? "" : index == 1 ? " \n\t " : index == 2 ? nil : "App \(index)",
                isActive: index == 0,
                isHidden: false
            )
        }
        let telemetry = DeviceTelemetry(
            deviceName: "Mac", hostName: "mac", modelIdentifier: nil, operatingSystemVersion: "macOS",
            architecture: "arm64", outputVolume: 0.5, outputMuted: true,
            inputVolume: 0.35, inputMuted: false, soundEffectsOutputVolume: 0.25, soundEffectsOutputMuted: true, audioDevices: [
                .init(
                    id: "BuiltInOutputDevice",
                    name: "MacBook Speakers",
                    hasInput: false,
                    hasOutput: true,
                    isDefaultInput: false,
                    isDefaultOutput: true,
                    isDefaultSoundEffectsOutput: true
                )
            ], session: .init(isLocked: false, isOnConsole: true),
            permissions: .init(accessibility: .denied, screenRecording: .denied),
            runningApplications: runningApplications,
            displays: [.init(
                displayID: 1, width: 1_920, height: 1_080, isMain: true, isBuiltIn: true, brightness: 0.42, brightnessControlSupported: true,
                currentMode: .init(id: "1920x1080@60000:0", width: 1_920, height: 1_080, refreshRate: 60),
                availableModes: [.init(id: "1920x1080@60000:0", width: 1_920, height: 1_080, refreshRate: 60)],
                originX: 0, originY: 0, mirroredDisplayID: nil, hdrActive: false
            )],
            collectedAt: Date(timeIntervalSince1970: 1_700_000_000),
            printers: [.init(id: "printer-1", name: "Office printer", isDefault: true)],
            cameras: [.init(id: "camera-1", name: "FaceTime HD Camera", isConnected: true, isPreferred: true, authorization: .denied)],
            bluetoothDevices: [.init(id: "bt-opaque", name: "Headphones", isConnected: true)],
            vpnServices: [.init(id: "vpn-1", name: "Work VPN", isConnected: false)],
            battery: .init(level: 0.84, isCharging: true, isExternalPower: true, isPreventingIdleSleep: true, isLowPowerModeEnabled: false),
            powerTimers: .init(displayIdleMinutes: 10, systemSleepMinutes: 30, diskIdleMinutes: 0),
            appleMusic: .init(isInstalled: true, isRunning: false),
			spotify: .init(isInstalled: true, isRunning: false),
			chromeYouTube: .init(isInstalled: true, isRunning: false)
        )
        try await client.sendHeartbeat(.init(
            deviceID: "device-1",
            telemetry: telemetry,
            connector: .init(state: .running),
            connectorProjects: [.init(projectId: "thingtime", projectLabel: "thingtime")],
            additionalConnectors: [.init(
                id: DesktopChatRuntime.chatGPTConnectorID,
                kind: "chatgpt-desktop",
                label: "ChatGPT Desktop",
                status: "connected",
                capabilities: ["read-history"]
            )]
        ))
        XCTAssertEqual(ThingtimeAPIClient.maximumOpenApplications, 64)
    }

    func testRejectsInsecureRemoteBaseURLAndDoesNotSendWithoutPairing() async throws {
        XCTAssertThrowsError(try ThingtimeAPIClient(
            baseURL: URL(string: "http://example.com/")!, credentialStore: InMemoryDeviceCredentialStore(), session: session(), identityAdmission: .instantForTests()
        ))
        let client = try ThingtimeAPIClient(
            baseURL: URL(string: "http://127.0.0.1:9999/")!, credentialStore: InMemoryDeviceCredentialStore(), session: session(), identityAdmission: .instantForTests()
        )
        await XCTAssertThrowsErrorAsync(try await client.leaseCommands(.init(deviceID: "missing")))
    }

    func testLeaseRequiresApprovedEnvelopeAndParsesFractionalServerDate() async throws {
        let credential = DeviceCredential(
            deviceID: "device-1", refreshToken: "ttnode_secret", signingPrivateKey: Data(), signingPublicKey: Data()
        )
        MockURLProtocol.handler = { request in
            let body = try JSONSerialization.jsonObject(with: try Self.bodyData(request)) as! [String: Any]
            XCTAssertEqual(body["op"] as? String, "claim")
            return (200, Data(#"{"ok":true,"serverTime":"2026-08-18T04:00:00.000Z","command":{"id":"command-1","leaseId":"lease-1","kind":"session.send","input":{"connectorId":"codex-app-server","sessionId":"thread-1","text":"hello","delivery":"queue"},"leaseExpiresAt":"2026-08-18T04:00:30.123Z","requiresApproval":true,"approvalState":"approved"}}"#.utf8))
        }
        let client = try ThingtimeAPIClient(
            baseURL: URL(string: "https://thingtime.test/")!,
            credentialStore: InMemoryDeviceCredentialStore(credential: credential),
            session: session(), identityAdmission: .instantForTests()
        )
        let batch = try await client.leaseCommands(.init(deviceID: "device-1", waitSeconds: 1))
        XCTAssertEqual(batch.commands.first?.commandID, "command-1")
        XCTAssertEqual(batch.commands.first?.approvedForExecution, true)
        let expiration = try XCTUnwrap(batch.commands.first?.leaseExpiresAt)
        XCTAssertEqual(expiration.timeIntervalSince1970.truncatingRemainder(dividingBy: 1), 0.123, accuracy: 0.001)

        MockURLProtocol.handler = { _ in
            (200, Data(#"{"ok":true,"serverTime":"2026-08-18T04:00:00.000Z","command":{"id":"command-2","leaseId":"lease-2","kind":"app.launch","input":{"appId":"com.example.App"},"leaseExpiresAt":"2026-08-18T04:00:30.123Z","requiresApproval":true,"approvalState":"pending"}}"#.utf8))
        }
        await XCTAssertThrowsErrorAsync(try await client.leaseCommands(.init(deviceID: "device-1")))
    }

    func testCommandHeartbeatUsesLeaseIdentityAndParsesExpiration() async throws {
        let credential = DeviceCredential(
            deviceID: "device-1", refreshToken: "ttnode_secret", signingPrivateKey: Data(), signingPublicKey: Data()
        )
        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer ttnode_secret")
            let body = try JSONSerialization.jsonObject(with: try Self.bodyData(request)) as! [String: Any]
            XCTAssertEqual(body["op"] as? String, "heartbeat")
            XCTAssertEqual(body["commandId"] as? String, "command-1")
            XCTAssertEqual(body["leaseId"] as? String, "lease-1")
            return (200, Data(#"{"ok":true,"leaseExpiresAt":"2026-08-18T04:00:30.123Z"}"#.utf8))
        }
        let client = try ThingtimeAPIClient(
            baseURL: URL(string: "https://thingtime.test/")!,
            credentialStore: InMemoryDeviceCredentialStore(credential: credential),
            session: session(), identityAdmission: .instantForTests()
        )

        let expiration = try await client.heartbeatCommand(commandID: "command-1", leaseID: "lease-1")
        XCTAssertEqual(expiration.timeIntervalSince1970.truncatingRemainder(dividingBy: 1), 0.123, accuracy: 0.001)
    }

    func testCommandReportExposesOnlyTheBoundedOpaqueNextCursor() async throws {
        let credential = DeviceCredential(
            deviceID: "device-1", refreshToken: "ttnode_secret", signingPrivateKey: Data(), signingPublicKey: Data()
        )
        var reportCount = 0
        MockURLProtocol.handler = { request in
            reportCount += 1
            let body = try JSONSerialization.jsonObject(with: try Self.bodyData(request)) as! [String: Any]
            XCTAssertEqual(body["op"] as? String, "report")
            if reportCount == 1 {
                XCTAssertEqual(body["outputRef"] as? String, "opaque/page+2==")
            } else {
                XCTAssertNil(body["outputRef"])
            }
            XCTAssertNil(body["projectPath"])
            XCTAssertFalse(String(describing: body).contains("/Users/person/private/project"))
            return (200, Data(#"{"ok":true}"#.utf8))
        }
        let client = try ThingtimeAPIClient(
            baseURL: URL(string: "https://thingtime.test/")!,
            credentialStore: InMemoryDeviceCredentialStore(credential: credential),
            session: session(), identityAdmission: .instantForTests()
        )
        try await client.reportCommand(.init(
            commandID: "command-1",
            leaseID: "lease-1",
            status: .succeeded,
            response: .success(id: "lease-1", result: .object([
                "sessions": .array([]),
                "nextCursor": .string("opaque/page+2=="),
                "projectPath": .string("/Users/person/private/project")
            ]))
        ))
        try await client.reportCommand(.init(
            commandID: "command-2",
            leaseID: "lease-2",
            status: .succeeded,
            response: .success(id: "lease-2", result: .object([
                "sessions": .array([]),
                "nextCursor": .string("opaque\u{2066}cursor")
            ]))
        ))
        XCTAssertEqual(reportCount, 2)
    }

    func testLiveAISyncUsesNodeCredentialAndPreservesClosedEnvelope() async throws {
        let credential = DeviceCredential(
            deviceID: "device-1", refreshToken: "ttnode_secret", signingPrivateKey: Data(), signingPublicKey: Data()
        )
        let payload = JSONValue.object([
            "op": .string("events.append"),
            "connectorId": .string("codex-app-server"),
            "sessionId": .string("thread-1"),
            "events": .array([
                .object([
                    "eventId": .string("event-1"),
                    "sequence": .number(1),
                    "observedAt": .string("2026-08-18T04:00:00.000Z"),
                    "turnId": .string("turn-1"),
                    "itemId": .null,
                    "type": .string("turn.started"),
                    "payload": .object([
                        "turn": .object(["id": .string("turn-1"), "status": .string("running")])
                    ])
                ])
            ])
        ])
        MockURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/v1/devices/node/live-sync")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer ttnode_secret")
            XCTAssertEqual(try JSONDecoder().decode(JSONValue.self, from: Self.bodyData(request)), payload)
            return (200, Data(#"{"ok":true,"op":"events.append","acceptedEvents":1,"replayedEvents":0,"materializedMessages":0,"idempotentMessages":0,"messageSegments":0,"lastSequence":1}"#.utf8))
        }
        let client = try ThingtimeAPIClient(
            baseURL: URL(string: "https://thingtime.test/")!,
            credentialStore: InMemoryDeviceCredentialStore(credential: credential),
            session: session(), identityAdmission: .instantForTests()
        )

        let response = try await client.syncLiveAI(payload)
        XCTAssertEqual(response.objectValue?["op"], .string("events.append"))
        XCTAssertEqual(response.objectValue?["lastSequence"], .number(1))
    }
}

private func XCTAssertThrowsErrorAsync<T>(
    _ expression: @autoclosure () async throws -> T,
    file: StaticString = #filePath,
    line: UInt = #line
) async {
    do {
        _ = try await expression()
        XCTFail("Expected expression to throw", file: file, line: line)
    } catch {}
}
