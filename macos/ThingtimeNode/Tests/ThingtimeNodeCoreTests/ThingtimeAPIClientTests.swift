import CryptoKit
import Foundation
import XCTest
@testable import ThingtimeNodeCore

private final class MockURLProtocol: URLProtocol, @unchecked Sendable {
    static let lock = NSLock()
    nonisolated(unsafe) static var handler: ((URLRequest) throws -> (Int, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            Self.lock.lock()
            let handler = Self.handler
            Self.lock.unlock()
            let (status, data) = try XCTUnwrap(handler)(request)
            let response = HTTPURLResponse(url: try XCTUnwrap(request.url), statusCode: status, httpVersion: nil, headerFields: nil)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }
    override func stopLoading() {}
}

final class ThingtimeAPIClientTests: XCTestCase {
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
            session: session()
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
            XCTAssertEqual(Set(body.keys), Set(["revision", "state", "connectors"]))
            let state = try XCTUnwrap(body["state"] as? [String: Any])
            XCTAssertEqual((state["openApps"] as? [[String: Any]])?.count, 64)
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
            session: session()
        )
        let applicationsWithoutStableIDs = (0 ..< 20).map { index in
            RunningApplicationTelemetry(
                processIdentifier: Int32(index),
                bundleIdentifier: nil,
                name: "Unidentified \(index)",
                isActive: false,
                isHidden: false
            )
        }
        let runningApplications = applicationsWithoutStableIDs + (0 ..< 80).map { index in
            RunningApplicationTelemetry(
                processIdentifier: Int32(index + applicationsWithoutStableIDs.count),
                bundleIdentifier: "com.example.app\(index)",
                name: "App \(index)",
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
            baseURL: URL(string: "http://example.com/")!, credentialStore: InMemoryDeviceCredentialStore(), session: session()
        ))
        let client = try ThingtimeAPIClient(
            baseURL: URL(string: "http://127.0.0.1:9999/")!, credentialStore: InMemoryDeviceCredentialStore(), session: session()
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
            session: session()
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
            session: session()
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
            session: session()
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
            session: session()
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
