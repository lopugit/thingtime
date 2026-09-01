import Foundation
import Security
import XCTest
@testable import ThingtimeNodeCore

private struct TestActionEnvelope: Codable {
    let action: SafeActionRequest
    let context: SafeActionContext
}

private actor ResponseLossControlPlaneClient: ControlPlaneClient {
    enum ClaimOutcome: Sendable {
        case ambiguous
        case rejected(Int)
        case succeeded
    }

    private(set) var prepareRequests: [PairingPrepareRequest] = []
    private(set) var claimRequests: [PairingClaimRequest] = []
    private var claimOutcomes: [ClaimOutcome]

    init(claimOutcomes: [ClaimOutcome] = [.ambiguous, .succeeded]) {
        self.claimOutcomes = claimOutcomes
    }

    func preparePairing(_ request: PairingPrepareRequest) async throws -> PairingPrepareResponse {
        prepareRequests.append(request)
        return PairingPrepareResponse(
            pairingID: "pairing-id",
            serverNonce: Data(repeating: 11, count: 32),
            expiresAt: Date().addingTimeInterval(600)
        )
    }

    func claimPairing(_ request: PairingClaimRequest) async throws -> PairingClaimResponse {
        claimRequests.append(request)
        let outcome = claimOutcomes.isEmpty ? .succeeded : claimOutcomes.removeFirst()
        switch outcome {
        case .ambiguous:
            throw ThingtimeAPIClientError.pairingClaimOutcomeUncertain
        case let .rejected(status):
            throw ThingtimeAPIClientError.rejected(status: status)
        case .succeeded:
            return PairingClaimResponse(deviceID: "device-committed", refreshToken: request.credential)
        }
    }

    func sendHeartbeat(_ heartbeat: DeviceHeartbeat) async throws {}
    func leaseCommands(_ request: CommandLeaseRequest) async throws -> CommandLeaseBatch { .init(commands: []) }
    func heartbeatCommand(commandID: String, leaseID: String) async throws -> Date { Date().addingTimeInterval(30) }
    func reportCommand(_ report: CommandExecutionReport) async throws {}
}

private actor FailingKeychainCredentialStore: DeviceCredentialStore {
    func load() async throws -> DeviceCredential? { nil }
    func loadAll() async throws -> [DeviceCredential] { [] }
    func save(_ credential: DeviceCredential) async throws {
        throw KeychainError(status: errSecMissingEntitlement)
    }
    func delete() async throws {}
    func loadPendingPairingClaim() async throws -> PendingPairingClaim? { nil }
    func savePendingPairingClaim(_ claim: PendingPairingClaim) async throws {
        throw KeychainError(status: errSecMissingEntitlement)
    }
    func deletePendingPairingClaim() async throws {}
}

@MainActor
final class NodeControllerTests: XCTestCase {
    private let serverPairingSecret = "ttpair_abcdefghijklmnopqrstuvwxyzABCDEFGH123456789"

    func testMutationsRequireCommandIDAndReplayJournaledOutcome() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ThingtimeNodeControllerTests-\(UUID().uuidString)", isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let telemetry = DeviceTelemetryCollector()
        let controller = ThingtimeNodeController(
            journal: try CommandJournal(fileURL: directory.appendingPathComponent("journal.json")),
            pairing: PairingManager(store: InMemoryDeviceCredentialStore()),
            connector: ConnectorRuntime(configuration: nil),
            telemetry: telemetry,
            actionExecutor: SafeActionExecutor(telemetry: telemetry)
        )
        let parameters = try JSONValue.from(TestActionEnvelope(
            action: SafeActionRequest(kind: .refreshTelemetry),
            context: SafeActionContext(origin: .remoteAccount, sessionLocked: false, userApproved: false)
        ))

        let missingID = await controller.handle(NodeRequest(method: "action.execute", parameters: parameters))
        XCTAssertEqual(missingID.error?.code, ThingtimeNodeError.commandIdRequired.code)

        let first = await controller.handle(NodeRequest(
            id: "request-1",
            commandId: "server-command-1",
            method: "action.execute",
            parameters: parameters
        ))
        let replay = await controller.handle(NodeRequest(
            id: "request-2",
            commandId: "server-command-1",
            method: "action.execute",
            parameters: parameters
        ))
        XCTAssertTrue(first.ok)
        XCTAssertTrue(replay.ok)
        XCTAssertEqual(first.result, replay.result)
        XCTAssertEqual(replay.id, "request-2")

        let conflict = await controller.handle(NodeRequest(
            id: "request-3",
            commandId: "server-command-1",
            method: "connector.stop"
        ))
        XCTAssertEqual(conflict.error?.code, ThingtimeNodeError.commandConflict.code)
    }

	func testUnpairedLeasedMachineControlsFailClosedBeforeSideEffects() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ThingtimeNodeLeasedMachineControlTests-\(UUID().uuidString)", isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let telemetry = DeviceTelemetryCollector()
        let controller = ThingtimeNodeController(
            journal: try CommandJournal(fileURL: directory.appendingPathComponent("journal.json")),
            pairing: PairingManager(store: InMemoryDeviceCredentialStore()),
            connector: ConnectorRuntime(configuration: nil),
            telemetry: telemetry,
            actionExecutor: SafeActionExecutor(telemetry: telemetry)
        )
        let commands = [
            LeasedCommand(commandID: "mute", leaseID: "lease-mute", method: "system.audio.mute.set", parameters: .object(["muted": .bool(true)]), leaseExpiresAt: .distantFuture),
            LeasedCommand(commandID: "audio-output", leaseID: "lease-output", method: "system.audio.output.set", parameters: .object(["deviceId": .string("BuiltInOutputDevice")]), leaseExpiresAt: .distantFuture),
            LeasedCommand(commandID: "force-quit", leaseID: "lease-force-quit", method: "app.force-quit", parameters: .object(["appId": .string("com.example.App")]), leaseExpiresAt: .distantFuture),
            LeasedCommand(commandID: "hide-others", leaseID: "lease-hide-others", method: "app.hide-others", parameters: .object([:]), leaseExpiresAt: .distantFuture),
            LeasedCommand(commandID: "wifi-connect", leaseID: "lease-wifi-connect", method: "system.wifi.connect", parameters: .object(["ssid": .string("Thingtime Guest")]), leaseExpiresAt: .distantFuture),
            LeasedCommand(commandID: "wifi-power", leaseID: "lease-wifi-power", method: "system.wifi.power.set", parameters: .object(["enabled": .bool(false)]), leaseExpiresAt: .distantFuture),
            LeasedCommand(commandID: "display-mode", leaseID: "lease-display-mode", method: "system.display.mode.set", parameters: .object(["displayId": .number(42), "modeId": .string("1920x1080@60000:0")]), leaseExpiresAt: .distantFuture),
            LeasedCommand(commandID: "printer", leaseID: "lease-printer", method: "system.printer.default.set", parameters: .object(["id": .string("printer-1")]), leaseExpiresAt: .distantFuture),
            LeasedCommand(commandID: "keep-awake", leaseID: "lease-keep-awake", method: "system.power.idle-sleep-prevention.set", parameters: .object(["enabled": .bool(true)]), leaseExpiresAt: .distantFuture),
			LeasedCommand(commandID: "idle-timer", leaseID: "lease-idle-timer", method: "system.power.idle-timer.set", parameters: .object(["scope": .string("display"), "minutes": .number(10)]), leaseExpiresAt: .distantFuture),
            LeasedCommand(commandID: "airdrop-profile", leaseID: "lease-airdrop-profile", method: "system.policy.airdrop.profile.propose", parameters: .object(["enabled": .bool(false)]), leaseExpiresAt: .distantFuture),
            LeasedCommand(commandID: "camera-profile", leaseID: "lease-camera-profile", method: "system.policy.camera.profile.propose", parameters: .object(["enabled": .bool(false)]), leaseExpiresAt: .distantFuture),
            LeasedCommand(commandID: "apple-music", leaseID: "lease-apple-music", method: "system.media.apple-music.playback.set", parameters: .object(["operation": .string("next")]), leaseExpiresAt: .distantFuture),
			LeasedCommand(commandID: "apple-music-volume", leaseID: "lease-apple-music-volume", method: "system.media.apple-music.volume.set", parameters: .object(["level": .number(0.5)]), leaseExpiresAt: .distantFuture),
            LeasedCommand(commandID: "spotify", leaseID: "lease-spotify", method: "system.media.spotify.playback.set", parameters: .object(["operation": .string("next")]), leaseExpiresAt: .distantFuture),
			LeasedCommand(commandID: "spotify-volume", leaseID: "lease-spotify-volume", method: "system.media.spotify.volume.set", parameters: .object(["level": .number(0.5)]), leaseExpiresAt: .distantFuture),
			LeasedCommand(commandID: "chrome-youtube-volume", leaseID: "lease-chrome-youtube-volume", method: "system.media.chrome-youtube.volume.set", parameters: .object(["level": .number(0.5)]), leaseExpiresAt: .distantFuture),
			LeasedCommand(commandID: "pointer-move", leaseID: "lease-pointer-move", method: "input.pointer.move", parameters: .object(["displayId": .number(42), "x": .number(20), "y": .number(30)]), leaseExpiresAt: .distantFuture),
			LeasedCommand(commandID: "pointer-click", leaseID: "lease-pointer-click", method: "input.pointer.click", parameters: .object(["displayId": .number(42), "x": .number(20), "y": .number(30), "button": .string("left")]), leaseExpiresAt: .distantFuture),
			LeasedCommand(commandID: "pointer-scroll", leaseID: "lease-pointer-scroll", method: "input.pointer.scroll", parameters: .object(["deltaX": .number(0), "deltaY": .number(-180)]), leaseExpiresAt: .distantFuture),
			LeasedCommand(commandID: "keyboard-type", leaseID: "lease-keyboard-type", method: "input.keyboard.type", parameters: .object(["text": .string("harmless")]), leaseExpiresAt: .distantFuture),
			LeasedCommand(commandID: "keyboard-shortcut", leaseID: "lease-keyboard-shortcut", method: "input.keyboard.shortcut", parameters: .object(["key": .string("tab"), "modifiers": .array([.string("command")])]), leaseExpiresAt: .distantFuture),
            LeasedCommand(commandID: "restart", leaseID: "lease-restart", method: "system.restart", parameters: .object([:]), leaseExpiresAt: .distantFuture)
        ]
		for command in commands {
			let response = await controller.handleLeasedCommand(command)
			XCTAssertEqual(response.error?.code, ThingtimeNodeError.policyDenied("ignored").code)
		}

        let passwordAttempt = await controller.handleLeasedCommand(LeasedCommand(
            commandID: "wifi-password",
            leaseID: "lease-wifi-password",
            method: "system.wifi.connect",
            parameters: .object(["ssid": .string("Thingtime Guest"), "password": .string("must-not-be-journaled")]),
            leaseExpiresAt: .distantFuture
        ))
        XCTAssertEqual(passwordAttempt.error?.code, ThingtimeNodeError.invalidRequest("ignored").code)
    }

    func testLocalKeychainFailureIsDefinitiveAndNeverReportedAsAnUnconfirmedServerResponse() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ThingtimeNodeKeychainFailureTests-\(UUID().uuidString)", isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let journal = try CommandJournal(fileURL: directory.appendingPathComponent("journal.json"))
        let client = ResponseLossControlPlaneClient(claimOutcomes: [.succeeded])
        let telemetry = DeviceTelemetryCollector()
        let controller = ThingtimeNodeController(
            journal: journal,
            pairing: PairingManager(store: FailingKeychainCredentialStore()),
            connector: ConnectorRuntime(configuration: nil),
            telemetry: telemetry,
            actionExecutor: SafeActionExecutor(telemetry: telemetry),
            controlPlaneClient: client
        )

        let response = await controller.handle(NodeRequest(
            commandId: "pair-command-keychain-failure",
            method: "pairing.claim",
            parameters: .object(["pairingSecret": .string(serverPairingSecret)])
        ))

        XCTAssertFalse(response.ok)
        XCTAssertEqual(response.error?.code, ThingtimeNodeError.credentialStoreUnavailable.code)
        XCTAssertNotEqual(response.error?.code, ThingtimeNodeError.pairingClaimRetryable.code)
        let entry = await journal.entry(commandId: "pair-command-keychain-failure")
        XCTAssertEqual(entry?.state, .failed, "A definitive local failure must not remain retryable.")
        let prepareRequests = await client.prepareRequests
        let claimRequests = await client.claimRequests
        XCTAssertTrue(prepareRequests.isEmpty)
        XCTAssertTrue(claimRequests.isEmpty)
    }

    func testCommittedPairingWithLostResponseRetriesExactCompleteAndPairsLocally() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ThingtimeNodePairingRetryTests-\(UUID().uuidString)", isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let journalURL = directory.appendingPathComponent("journal.json")
        let store = InMemoryDeviceCredentialStore()
        let pairing = PairingManager(store: store)
        let client = ResponseLossControlPlaneClient(claimOutcomes: [
            .ambiguous, .ambiguous, .ambiguous, .succeeded
        ])
        let telemetry = DeviceTelemetryCollector()
        let journal = try CommandJournal(fileURL: journalURL)
        let controller = ThingtimeNodeController(
            journal: journal,
            pairing: pairing,
            connector: ConnectorRuntime(configuration: nil),
            telemetry: telemetry,
            actionExecutor: SafeActionExecutor(telemetry: telemetry),
            controlPlaneClient: client
        )
        let parameters = JSONValue.object(["pairingSecret": .string(serverPairingSecret)])

        let lostResponse = await controller.handle(NodeRequest(
            id: "request-1",
            commandId: "pair-command-1",
            method: "pairing.claim",
            parameters: parameters
        ))
        XCTAssertEqual(lostResponse.error?.code, ThingtimeNodeError.pairingClaimRetryable.code)
        let retryableEntry = await journal.entry(commandId: "pair-command-1")
        XCTAssertEqual(retryableEntry?.state, .retryable)
        let credentialBeforeRetry = try await store.load()
        let pendingBeforeRetry = try await store.loadPendingPairingClaim()
        XCTAssertNil(credentialBeforeRetry)
        XCTAssertNotNil(pendingBeforeRetry)
        XCTAssertTrue(pendingBeforeRetry?.completeRequest?.capabilities.contains("system.lock") == true)

        // Reconstruct every native controller component that owns process-local
        // state. The renderer no longer has the secret, so recovery must use
        // only the opaque, durable pending record.
        let resumedPairing = PairingManager(store: store)
        let resumedTelemetry = DeviceTelemetryCollector()
        let resumedJournal = try CommandJournal(fileURL: journalURL)
        let resumedController = ThingtimeNodeController(
            journal: resumedJournal,
            pairing: resumedPairing,
            connector: ConnectorRuntime(configuration: nil),
            telemetry: resumedTelemetry,
            actionExecutor: SafeActionExecutor(telemetry: resumedTelemetry),
            controlPlaneClient: client
        )

        let restartStatus = await resumedController.handle(NodeRequest(method: "node.status"))
        XCTAssertTrue(restartStatus.ok)
        XCTAssertEqual(restartStatus.result?.objectValue?["recoverablePairing"], .bool(true))
        XCTAssertEqual(
            restartStatus.result?.objectValue?["pairing"]?.objectValue?["paired"],
            .bool(false)
        )
        let encodedStatus = try JSONEncoder().encode(restartStatus)
        XCTAssertFalse(String(decoding: encodedStatus, as: UTF8.self).contains(serverPairingSecret))

        let reconciled = await resumedController.handle(NodeRequest(
            id: "request-2",
            commandId: "pair-resume-command-2",
            method: "pairing.resume"
        ))
        XCTAssertTrue(reconciled.ok)
        let prepareRequests = await client.prepareRequests
        let claimRequests = await client.claimRequests
        XCTAssertEqual(prepareRequests.count, 1, "A durable complete request skips prepare on retry.")
        XCTAssertEqual(claimRequests.count, 4)
        XCTAssertTrue(
            claimRequests.dropFirst().allSatisfy { $0 == claimRequests.first },
            "Response-loss recovery must replay the exact signed complete request."
        )
        let credential = try await store.load()
        let pendingAfterRetry = try await store.loadPendingPairingClaim()
        XCTAssertEqual(credential?.deviceID, "device-committed")
        XCTAssertNil(pendingAfterRetry)
        let completedEntry = await resumedJournal.entry(commandId: "pair-resume-command-2")
        XCTAssertEqual(completedEntry?.state, .succeeded)

        let replayedResume = await resumedController.handle(NodeRequest(
            id: "request-3",
            commandId: "pair-resume-command-2",
            method: "pairing.resume"
        ))
        XCTAssertTrue(replayedResume.ok)
        XCTAssertEqual(replayedResume.result, reconciled.result)
        let claimRequestsAfterReplay = await client.claimRequests
        XCTAssertEqual(claimRequestsAfterReplay.count, 4, "A journal replay must not call the server again.")

        let reconciledStatus = await resumedController.handle(NodeRequest(method: "node.status"))
        XCTAssertEqual(reconciledStatus.result?.objectValue?["recoverablePairing"], .bool(false))
    }

    func testTransientPairingResponseLossReconcilesWithinOneApprovedRequest() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ThingtimeNodePairingInPlaceRetryTests-\(UUID().uuidString)", isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let journal = try CommandJournal(fileURL: directory.appendingPathComponent("journal.json"))
        let store = InMemoryDeviceCredentialStore()
        let client = ResponseLossControlPlaneClient()
        let telemetry = DeviceTelemetryCollector()
        let controller = ThingtimeNodeController(
            journal: journal,
            pairing: PairingManager(store: store),
            connector: ConnectorRuntime(configuration: nil),
            telemetry: telemetry,
            actionExecutor: SafeActionExecutor(telemetry: telemetry),
            controlPlaneClient: client
        )

        let response = await controller.handle(NodeRequest(
            commandId: "pair-command-in-place",
            method: "pairing.claim",
            parameters: .object(["pairingSecret": .string(serverPairingSecret)])
        ))

        XCTAssertTrue(response.ok)
        let storedCredential = try await store.load()
        let pendingClaim = try await store.loadPendingPairingClaim()
        let journalEntry = await journal.entry(commandId: "pair-command-in-place")
        XCTAssertEqual(storedCredential?.deviceID, "device-committed")
        XCTAssertNil(pendingClaim)
        XCTAssertEqual(journalEntry?.state, .succeeded)
        let prepareRequests = await client.prepareRequests
        let claimRequests = await client.claimRequests
        XCTAssertEqual(prepareRequests.count, 1, "A claim retry must reuse the prepared proof.")
        XCTAssertEqual(claimRequests.count, 2)
        XCTAssertEqual(claimRequests.first, claimRequests.last, "The replay must be byte-equivalent at the typed contract boundary.")
    }

    func testPairingResumeRequiresCommandIDAndFailsSafelyWithoutPendingMaterial() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ThingtimeNodePairingResumeEmptyTests-\(UUID().uuidString)", isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let store = InMemoryDeviceCredentialStore()
        let telemetry = DeviceTelemetryCollector()
        let client = ResponseLossControlPlaneClient(claimOutcomes: [.succeeded])
        let controller = ThingtimeNodeController(
            journal: try CommandJournal(fileURL: directory.appendingPathComponent("journal.json")),
            pairing: PairingManager(store: store),
            connector: ConnectorRuntime(configuration: nil),
            telemetry: telemetry,
            actionExecutor: SafeActionExecutor(telemetry: telemetry),
            controlPlaneClient: client
        )

        let missingCommandID = await controller.handle(NodeRequest(method: "pairing.resume"))
        XCTAssertEqual(missingCommandID.error?.code, ThingtimeNodeError.commandIdRequired.code)

        let noPending = await controller.handle(NodeRequest(
            commandId: "pair-resume-empty",
            method: "pairing.resume"
        ))
        XCTAssertEqual(noPending.error?.code, ThingtimeNodeError.invalidRequest("ignored").code)
        XCTAssertEqual(noPending.error?.message, "No recoverable pairing claim is pending.")
        let prepareRequests = await client.prepareRequests
        let claimRequests = await client.claimRequests
        XCTAssertTrue(prepareRequests.isEmpty)
        XCTAssertTrue(claimRequests.isEmpty)

        let unexpectedParameters = await controller.handle(NodeRequest(
            commandId: "pair-resume-with-parameters",
            method: "pairing.resume",
            parameters: .object(["pairingSecret": .string(serverPairingSecret)])
        ))
        XCTAssertEqual(unexpectedParameters.error?.code, ThingtimeNodeError.invalidRequest("ignored").code)
        XCTAssertEqual(unexpectedParameters.error?.message, "pairing.resume does not accept parameters.")

        let status = await controller.handle(NodeRequest(method: "node.status"))
        XCTAssertEqual(status.result?.objectValue?["recoverablePairing"], .bool(false))
    }

    func testDefinitiveResumeRejectionClearsPendingButAmbiguousFailureRetainsIt() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ThingtimeNodePairingResumeRejectionTests-\(UUID().uuidString)", isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let journalURL = directory.appendingPathComponent("journal.json")
        let store = InMemoryDeviceCredentialStore()
        let client = ResponseLossControlPlaneClient(claimOutcomes: [
            .ambiguous, .ambiguous, .ambiguous, .rejected(410)
        ])
        let telemetry = DeviceTelemetryCollector()
        let firstController = ThingtimeNodeController(
            journal: try CommandJournal(fileURL: journalURL),
            pairing: PairingManager(store: store),
            connector: ConnectorRuntime(configuration: nil),
            telemetry: telemetry,
            actionExecutor: SafeActionExecutor(telemetry: telemetry),
            controlPlaneClient: client
        )

        let ambiguous = await firstController.handle(NodeRequest(
            commandId: "pair-command-ambiguous",
            method: "pairing.claim",
            parameters: .object(["pairingSecret": .string(serverPairingSecret)])
        ))
        XCTAssertEqual(ambiguous.error?.code, ThingtimeNodeError.pairingClaimRetryable.code)
        let pendingAfterAmbiguous = try await store.loadPendingPairingClaim()
        XCTAssertNotNil(pendingAfterAmbiguous)

        let resumedPairing = PairingManager(store: store)
        let resumedTelemetry = DeviceTelemetryCollector()
        let resumedController = ThingtimeNodeController(
            journal: try CommandJournal(fileURL: journalURL),
            pairing: resumedPairing,
            connector: ConnectorRuntime(configuration: nil),
            telemetry: resumedTelemetry,
            actionExecutor: SafeActionExecutor(telemetry: resumedTelemetry),
            controlPlaneClient: client
        )
        let rejected = await resumedController.handle(NodeRequest(
            commandId: "pair-resume-rejected",
            method: "pairing.resume"
        ))
        XCTAssertFalse(rejected.ok)
        let pendingAfterRejection = try await store.loadPendingPairingClaim()
        XCTAssertNil(pendingAfterRejection)

        let status = await resumedController.handle(NodeRequest(method: "node.status"))
        XCTAssertEqual(status.result?.objectValue?["recoverablePairing"], .bool(false))

        let freshSecret = String(serverPairingSecret.dropLast()) + "A"
        let freshChallenge = try await resumedPairing.begin(pairingID: freshSecret)
        XCTAssertEqual(freshChallenge.pairingID, freshSecret)
    }
}
