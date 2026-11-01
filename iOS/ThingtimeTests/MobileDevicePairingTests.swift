import CryptoKit
import XCTest
@testable import Thingtime

@MainActor
final class MobileDevicePairingTests: XCTestCase {
    private let scope = try! MobileDevicePairing.Scope(ownerId: "test-owner", url: URL(string: "https://example.test/things")!)
    private let descriptor = ["name": "Test iPhone 📱", "model": "iPhone", "osVersion": "17.0", "appVersion": "1.0"]
    private var saved: MobileDevicePairing.Record?
    private var bodies: [Data] = []
    private var createCount = 0
    private var failCompletion = false
    private var failSave = false
    private var revoked = false
    private var owner = "test-owner"
    private var compatible = true
    private var cancelled = false
    private var stateCalls = 0
    private func engine() -> MobileDevicePairing {
        MobileDevicePairing(load: { _ in self.saved }, save: {
            if self.failSave { throw MobileDevicePairing.Failure.storage }
            self.saved = $0
        }, transport: { request in
            let path = request.url!.path
            var response: [String: Any] = ["ok": true]
            var status = 200
            switch path {
            case LopuVoiceContract.manifestPath:
                XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
                response = ["schemaVersion": 1, "origin": "https://example.test", "features": self.compatible ? MobileDevicePairing.requirements.mapValues { ["version": $0.map(String.init).joined(separator: ".")] } : [:]]
            case "/api/v1/auth/me":
                XCTAssertEqual(request.value(forHTTPHeaderField: "Cookie"), "synthetic=session")
                response = ["user": ["id": self.owner, "accountKind": "user"]]
            case "/api/v1/devices/pairing":
                self.createCount += 1
                response = ["ownerId": self.owner, "pairing": ["pairingSecret": "ttpair_" + String(repeating: "a", count: 43), "expiresAt": "2099-01-01T00:00:00.000Z"]]
            case "/api/v1/devices/pairing/claim":
                XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
                let body = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
                if body["op"] as? String == "prepare" {
                    XCTAssertNotNil(self.saved, "Private key and nonce must be durable before prepare")
                    response = ["proof": ["pairingId": "test-session", "serverNonce": String(repeating: "A", count: 43), "expiresAt": "2099-01-01T00:00:00.000Z"]]
                } else {
                    XCTAssertEqual(self.saved?.completeBody, request.httpBody)
                    self.bodies.append(request.httpBody!)
                    let proof = body["proof"] as! [String: String]
                    let device = body["device"] as! [String: String]
                    func decode(_ value: String) -> Data { Data(base64Encoded: value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/") + String(repeating: "=", count: (4 - value.count % 4) % 4))! }
                    let fields = ["thingtime-device-pairing-claim-v1", proof["pairingId"]!, body["pairingSecret"] as! String,
                        body["credential"] as! String, proof["publicKey"]!, proof["nonce"]!, proof["serverNonce"]!,
                        device["name"]!, "ios", device["model"]!, device["osVersion"]!, device["appVersion"]!, "0"]
                    let key = try Curve25519.Signing.PublicKey(rawRepresentation: decode(proof["publicKey"]!))
                    XCTAssertTrue(key.isValidSignature(decode(proof["signature"]!), for: MobileDevicePairing.message(fields)))
                    if self.failCompletion { throw URLError(.networkConnectionLost) }
                    response = ["credentialStored": true, "device": ["id": "test-device", "platform": "ios"]]
                }
            case "/api/v1/devices/node/state":
                self.stateCalls += 1
                let snapshot = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
                XCTAssertEqual((snapshot["state"] as? [String: Any])?["locked"] as? Bool, false)
                XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer \(self.saved!.credential)")
                XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
                if self.revoked { status = 401 }
            default: XCTFail("Unexpected endpoint: \(path)")
            }
            return (try MobileDevicePairing.json(response), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
        }, cookie: { _ in "synthetic=session" }, check: { if self.cancelled { throw CancellationError() } })
    }
    func testPairResumeLostResponseAndRelaunchUseExactClaim() async throws {
        failCompletion = true
        do { _ = try await engine().pair(scope, descriptor: descriptor); XCTFail("Expected lost response") } catch { }
        XCTAssertNil(saved?.deviceId)
        let persisted = try JSONEncoder().encode(saved!)
        saved = try JSONDecoder().decode(MobileDevicePairing.Record.self, from: persisted)
        failCompletion = false
        let paired = try await engine().pair(scope, descriptor: ["name": "Changed during restart"])
        XCTAssertEqual(paired.state, "paired"); XCTAssertEqual(paired.deviceId, "test-device")
        XCTAssertEqual(createCount, 1); XCTAssertEqual(bodies.count, 2); XCTAssertEqual(bodies[0], bodies[1])
        let oldRevision = saved!.revision
        _ = try await engine().status(scope)
        XCTAssertGreaterThan(saved!.revision, oldRevision)
    }
    func testWrongAccountAndMissingCapabilityNeverStartPairing() async throws {
        owner = "other"
        do { _ = try await engine().pair(scope, descriptor: descriptor); XCTFail() } catch { }
        owner = scope.ownerId; compatible = false
        do { _ = try await engine().pair(scope, descriptor: descriptor); XCTFail() } catch { }
        XCTAssertEqual(createCount, 0); XCTAssertNil(saved)
    }
    func testStorageFailureStopsBeforeClaimAndPreservesRetry() async throws {
        failSave = true
        do { _ = try await engine().pair(scope, descriptor: descriptor); XCTFail() } catch { }
        XCTAssertTrue(bodies.isEmpty); XCTAssertNil(saved)
    }
    func testRevokedCredentialDoesNotRePairWithoutExplicitAction() async throws {
        _ = try await engine().pair(scope, descriptor: descriptor)
        revoked = true
        let status = try await engine().status(scope)
        XCTAssertEqual(status.state, "revoked"); XCTAssertEqual(createCount, 1)
        let calls = stateCalls
        _ = try await engine().status(scope)
        XCTAssertEqual(stateCalls, calls)
    }
    func testAccountOriginAndCancellationFenceStoredCredentials() async throws {
        _ = try await engine().pair(scope, descriptor: descriptor)
        let foreign = try MobileDevicePairing.Scope(ownerId: "other", url: scope.origin)
        owner = "other"
        do { _ = try await engine().status(foreign); XCTFail() } catch { }
        cancelled = true
        do { _ = try await engine().status(scope); XCTFail() } catch { }
        XCTAssertEqual(createCount, 1); XCTAssertEqual(stateCalls, 1)
        XCTAssertNotEqual(scope.key, foreign.key)
        XCTAssertThrowsError(try MobileDevicePairing.Scope(ownerId: "owner", url: URL(string: "http://untrusted.test")!))
        XCTAssertThrowsError(try MobileDevicePairing.Scope(ownerId: "owner", url: URL(string: "https://user:pass@example.test")!))
    }
    func testCanonicalWireUsesUtf8LengthsAndBoundedDescriptor() throws {
        XCTAssertEqual(String(data: MobileDevicePairing.message(["📱", "é"]), encoding: .utf8), "4:📱2:é")
        let long = try MobileDevicePairing.descriptor(descriptor.merging(["name": String(repeating: "📱", count: 80)]) { _, b in b })
        XCTAssertEqual(long["name"]!.utf16.count, 120)
    }
    func testServerWireVectorMatchesCryptoKit() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "mobile-pairing-vector", withExtension: "json"))
        let vector = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
        let fields = vector["fields"] as! [String]
        let bytes = MobileDevicePairing.message(fields)
        XCTAssertEqual(bytes.base64EncodedString(), vector["canonicalBase64"] as? String)
        let key = try Curve25519.Signing.PrivateKey(rawRepresentation: Data(repeating: 7, count: 32))
        let claim = vector["claim"] as! [String: Any]
        XCTAssertEqual(MobileDevicePairing.base64(key.publicKey.rawRepresentation), claim["publicKey"] as? String)
        XCTAssertTrue(key.publicKey.isValidSignature(Data(base64Encoded: vector["signature"] as! String)!, for: bytes))
        XCTAssertTrue(key.publicKey.isValidSignature(try key.signature(for: bytes), for: bytes))
    }

    func testInvalidStoredRevisionFailsBeforeHeartbeatInsteadOfOverflowing() async throws {
        _ = try await engine().pair(scope, descriptor: descriptor)
        saved!.revision = Int64.max
        do { _ = try await engine().status(scope); XCTFail("Corrupt revision must fail closed") } catch { }
        XCTAssertEqual(stateCalls, 1)
    }

}
