import Foundation
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

    func testCommittedPairingWithLostResponseRetriesExactCompleteAndPairsLocally() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ThingtimeNodePairingRetryTests-\(UUID().uuidString)", isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let journalURL = directory.appendingPathComponent("journal.json")
        let store = InMemoryDeviceCredentialStore()
        let pairing = PairingManager(store: store)
        let client = ResponseLossControlPlaneClient()
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
        XCTAssertEqual(claimRequests.count, 2)
        XCTAssertEqual(claimRequests.first, claimRequests.last, "Response-loss recovery must replay the exact signed complete request.")
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
        XCTAssertEqual(claimRequestsAfterReplay.count, 2, "A journal replay must not call the server again.")

        let reconciledStatus = await resumedController.handle(NodeRequest(method: "node.status"))
        XCTAssertEqual(reconciledStatus.result?.objectValue?["recoverablePairing"], .bool(false))
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
        let client = ResponseLossControlPlaneClient(claimOutcomes: [.ambiguous, .rejected(410)])
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
