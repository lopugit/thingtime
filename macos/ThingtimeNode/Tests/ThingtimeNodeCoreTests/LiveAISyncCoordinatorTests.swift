import Foundation
import XCTest
@testable import ThingtimeNodeCore

private enum TestLiveAISyncFailure: Error {
    case offline
}

private actor RecordingLiveAISyncTransport {
    private(set) var calls: [JSONValue] = []
    private var remainingFailures: Int

    init(failures: Int = 0) {
        remainingFailures = failures
    }

    func send(_ payload: JSONValue) async throws -> JSONValue {
        calls.append(payload)
        if remainingFailures > 0 {
            remainingFailures -= 1
            throw TestLiveAISyncFailure.offline
        }
        guard let object = payload.objectValue, let operation = object["op"]?.stringValue else {
            return .object(["ok": .bool(false)])
        }
        var response: [String: JSONValue] = [
            "ok": .bool(true),
            "op": .string(operation)
        ]
        if operation == "events.append",
           case let .array(events)? = object["events"],
           let lastSequence = events.last?.objectValue?["sequence"] {
            response["lastSequence"] = lastSequence
        }
        return .object(response)
    }

    func snapshot() -> [JSONValue] { calls }
}

final class LiveAISyncCoordinatorTests: XCTestCase {
    private let connectorID = "codex-app-server"
    private let observedAt = "2026-08-18T01:02:03.000Z"

    func testLeasedListAndCreateProduceExactRevisionedSessionEnvelopes() async throws {
        let fileURL = temporaryURL("live-sync.json")
        let transport = RecordingLiveAISyncTransport()
        let coordinator = try makeCoordinator(fileURL: fileURL, transport: transport)
        let listed = NodeResponse.success(id: "list", result: .object([
            "sessions": .array([
                session(
                    id: "session-1",
                    title: "Thingtime",
                    projectID: "project-1",
                    projectLabel: "Thingtime",
                    status: "running",
                    extra: [
                        "preview": .string("private preview"),
                        "cwd": .string("/Users/private/project"),
                        "source": .string("local")
                    ]
                ),
                session(id: "session-2", title: "Second", status: "waiting-approval"),
                session(id: "session-3", title: "Unknown", status: "unknown")
            ]),
            "nextCursor": .null
        ]))

        let listedCaptureCount = try await coordinator.captureSuccessfulLeasedResponse(
            command: command(method: "session.list"),
            response: listed
        )
        XCTAssertEqual(listedCaptureCount, 1)

        let created = NodeResponse.success(id: "create", result: session(
            id: "session-1",
            title: "Thingtime renamed",
            projectID: "project-1",
            projectLabel: "Thingtime",
            status: "idle"
        ))
        let createdCaptureCount = try await coordinator.captureSuccessfulLeasedResponse(
            command: command(method: "session.create"),
            response: created
        )
        XCTAssertEqual(createdCaptureCount, 1)
        let flushedCount = try await coordinator.flush()
        XCTAssertEqual(flushedCount, 2)

        let calls = await transport.snapshot()
        XCTAssertEqual(calls.count, 2)
        let firstSessions = try array(calls[0], key: "sessions")
        XCTAssertEqual(firstSessions.count, 3)
        XCTAssertEqual(firstSessions[0].objectValue?["revision"], .number(1))
        XCTAssertEqual(firstSessions[0].objectValue?["state"], .string("running"))
        XCTAssertEqual(firstSessions[1].objectValue?["state"], .string("waiting-approval"))
        XCTAssertEqual(firstSessions[2].objectValue?["state"], .string("unknown"))
        let secondSessions = try array(calls[1], key: "sessions")
        XCTAssertEqual(secondSessions[0].objectValue?["revision"], .number(2))
        XCTAssertEqual(secondSessions[0].objectValue?["title"], .string("Thingtime renamed"))

        let serialized = try serializedJSON(calls)
        XCTAssertFalse(serialized.contains("private preview"))
        XCTAssertFalse(serialized.contains("/Users/private"))
        XCTAssertFalse(serialized.contains("\"cwd\""))
        XCTAssertFalse(serialized.contains("\"source\""))
    }

    func testTranscriptPreservesVisibleTextAndDropsNonPublicFields() async throws {
        let transport = RecordingLiveAISyncTransport()
        let coordinator = try makeCoordinator(fileURL: temporaryURL("transcript.json"), transport: transport)
        let visibleText = "  Keep these exact visible permissions.\n"
        let response = NodeResponse.success(id: "read", result: .object([
            "sessionId": .string("session-1"),
            "entries": .array([
                .object([
                    "id": .string("message-1"),
                    "turnId": .string("turn-1"),
                    "type": .string("message"),
                    "role": .string("assistant"),
                    "text": .string(visibleText),
                    "status": .string("complete"),
                    "observedAt": .string(observedAt),
                    "path": .string("/Users/private/transcript.json")
                ]),
                .object([
                    "id": .string("message-streaming"),
                    "turnId": .string("turn-1"),
                    "type": .string("message"),
                    "role": .string("assistant"),
                    "text": .string("partial"),
                    "status": .string("streaming"),
                    "observedAt": .string(observedAt)
                ]),
                .object([
                    "id": .string("message-internal"),
                    "turnId": .string("turn-1"),
                    "type": .string("message"),
                    "role": .string("user"),
                    "text": .string("visible prefix <environment_context>private native context</environment_context>"),
                    "status": .string("complete"),
                    "observedAt": .string(observedAt)
                ]),
                .object([
                    "id": .string("activity-1"),
                    "turnId": .string("turn-1"),
                    "type": .string("activity"),
                    "activity": .string("tool"),
                    "label": .string("Tool activity"),
                    "status": .string("complete"),
                    "observedAt": .string(observedAt),
                    "toolData": .object(["path": .string("/private/raw")])
                ]),
                .object([
                    "id": .string("reasoning-1"),
                    "type": .string("reasoning"),
                    "text": .string("private chain")
                ])
            ]),
            "nextCursor": .string("opaque/next\\cursor"),
            "backwardsCursor": .null,
            "source": .string("native")
        ]))

        let capturedCount = try await coordinator.captureSuccessfulLeasedResponse(
            command: command(
                method: "session.read",
                extra: [
                    "sessionId": .string("session-1"),
                    "cursor": .string("opaque/request\\cursor")
                ]
            ),
            response: response
        )
        XCTAssertEqual(capturedCount, 1)
        let flushedCount = try await coordinator.flush()
        XCTAssertEqual(flushedCount, 1)

        let calls = await transport.snapshot()
        let entries = try array(calls[0], key: "entries")
        XCTAssertEqual(entries.count, 2)
        XCTAssertEqual(entries[0].objectValue?["type"], .string("message"))
        XCTAssertEqual(entries[0].objectValue?["text"], .string(visibleText))
        XCTAssertEqual(entries[0].objectValue?["revision"], .number(1))
        XCTAssertEqual(entries[1].objectValue?["type"], .string("activity"))
        XCTAssertEqual(entries[1].objectValue?["label"], .string("Tool activity"))
        XCTAssertEqual(calls[0].objectValue?["page"]?.objectValue?["hasMore"], .bool(true))
        XCTAssertEqual(
            calls[0].objectValue?["page"]?.objectValue?["cursor"],
            .string("opaque/request\\cursor")
        )
        XCTAssertEqual(
            calls[0].objectValue?["page"]?.objectValue?["nextCursor"],
            .string("opaque/next\\cursor")
        )
        let serialized = try serializedJSON(calls)
        XCTAssertFalse(serialized.contains("toolData"))
        XCTAssertFalse(serialized.contains("private chain"))
        XCTAssertFalse(serialized.contains("private native context"))
        XCTAssertFalse(serialized.contains("/private/raw"))
        XCTAssertFalse(serialized.contains("transcript.json"))
    }

    func testClosedConnectorEventsDeriveOnlyVisibleMessagesAndSafeActivity() async throws {
        let transport = RecordingLiveAISyncTransport()
        let coordinator = try makeCoordinator(fileURL: temporaryURL("events.json"), transport: transport)
        let events = [
            connectorEvent(
                type: "message.submitted",
                sessionID: "session-1",
                turnID: "turn-1",
                payload: [
                    "commandId": .string("command-1"),
                    "mode": .string("queue"),
                    "text": .string("Please begin")
                ]
            ),
            connectorEvent(
                type: "item.completed",
                sessionID: "session-1",
                turnID: "turn-1",
                itemID: "assistant-1",
                payload: [
                    "item": .object([
                        "id": .string("assistant-1"),
                        "type": .string("agentMessage"),
                        "text": .string("Finished exactly."),
                        "reasoning": .string("hidden")
                    ])
                ]
            ),
            connectorEvent(
                type: "item.completed",
                sessionID: "session-1",
                turnID: "turn-1",
                itemID: "user-1",
                payload: [
                    "item": .object([
                        "id": .string("user-1"),
                        "type": .string("userMessage"),
                        "text": .string("Please begin")
                    ])
                ]
            ),
            connectorEvent(
                type: "item.completed",
                sessionID: "session-1",
                turnID: "turn-1",
                itemID: "activity-1",
                payload: [
                    "item": .object([
                        "id": .string("activity-1"),
                        "type": .string("activity"),
                        "activity": .string("commandExecution"),
                        "label": .string("Command execution"),
                        "status": .string("completed"),
                        "command": .string("cat /private/file"),
                        "output": .string("secret")
                    ])
                ]
            ),
            connectorEvent(
                type: "approval.responded",
                sessionID: "session-1",
                turnID: "turn-1",
                itemID: "activity-1",
                payload: [
                    "requestId": .string("approval-1"),
                    "decision": .string("accept"),
                    "commandId": .string("approval-command-1")
                ]
            ),
            connectorEvent(
                type: "approval.responded",
                sessionID: "session-1",
                turnID: "turn-1",
                itemID: "activity-1",
                payload: [
                    "requestId": .string("approval-2"),
                    "decision": .string("cancel"),
                    "reason": .string("expired")
                ]
            )
        ]
        for event in events {
            let capturedCount = try await coordinator.captureConnectorEvent(event)
            XCTAssertEqual(capturedCount, 1)
        }
        let flushedCount = try await coordinator.flush()
        XCTAssertEqual(flushedCount, 1)

        let calls = await transport.snapshot()
        let appended = try array(calls[0], key: "events")
        XCTAssertEqual(appended.map { $0.objectValue?["sequence"] }, [
            .number(1), .number(2), .number(3), .number(4), .number(5), .number(6)
        ])
        XCTAssertEqual(
            appended[0].objectValue?["message"]?.objectValue?["role"],
            .string("user")
        )
        XCTAssertEqual(
            appended[0].objectValue?["message"]?.objectValue?["messageId"],
            .string("command-1")
        )
        XCTAssertEqual(
            appended[1].objectValue?["message"]?.objectValue?["role"],
            .string("assistant")
        )
        XCTAssertNil(appended[2].objectValue?["message"])
        XCTAssertNil(appended[3].objectValue?["message"])
        XCTAssertEqual(
            appended[5].objectValue?["payload"],
            .object([
                "requestId": .string("approval-2"),
                "decision": .string("cancel"),
                "reason": .string("expired")
            ])
        )

        let serialized = try serializedJSON(calls)
        XCTAssertFalse(serialized.contains("reasoning"))
        XCTAssertFalse(serialized.contains("cat /private/file"))
        XCTAssertFalse(serialized.contains("secret"))
    }

    func testAdjacentUnsentDeltasCoalesceAndSequencesRemainPerSession() async throws {
        let transport = RecordingLiveAISyncTransport()
        let coordinator = try makeCoordinator(fileURL: temporaryURL("deltas.json"), transport: transport)
        for text in ["A", " ", "B"] {
            _ = try await coordinator.captureConnectorEvent(connectorEvent(
                type: "message.delta",
                sessionID: "session-a",
                turnID: "turn-a",
                itemID: "item-a",
                payload: ["delta": .string(text)]
            ))
        }
        _ = try await coordinator.captureConnectorEvent(connectorEvent(
            type: "turn.completed",
            sessionID: "session-a",
            turnID: "turn-a",
            payload: [
                "turn": .object(["id": .string("turn-a"), "status": .string("completed")])
            ]
        ))
        _ = try await coordinator.captureConnectorEvent(connectorEvent(
            type: "message.delta",
            sessionID: "session-b",
            turnID: "turn-b",
            itemID: "item-b",
            payload: ["delta": .string("Other")]
        ))
        _ = try await coordinator.captureConnectorEvent(connectorEvent(
            type: "turn.completed",
            sessionID: "session-b",
            turnID: "turn-b",
            payload: [
                "turn": .object(["id": .string("turn-b"), "status": .string("completed")])
            ]
        ))

        let pendingEventCount = await coordinator.pendingEventCount()
        XCTAssertEqual(pendingEventCount, 4)
        let flushedCount = try await coordinator.flush()
        XCTAssertEqual(flushedCount, 2)
        let calls = await transport.snapshot()
        let first = try array(calls[0], key: "events")
        let second = try array(calls[1], key: "events")
        XCTAssertEqual(first.count, 2)
        XCTAssertEqual(first[0].objectValue?["payload"]?.objectValue?["delta"], .string("A B"))
        XCTAssertEqual(first.map { $0.objectValue?["sequence"] }, [.number(1), .number(2)])
        XCTAssertEqual(second[0].objectValue?["sequence"], .number(1))
    }

    func testSplitInternalContextStreamIsQuarantinedBeforeAnyDeltaLeavesTheNode() async throws {
        let transport = RecordingLiveAISyncTransport()
        let coordinator = try makeCoordinator(fileURL: temporaryURL("split-context.json"), transport: transport)
        for text in ["<environ", "ment_context>private"] {
            let captured = try await coordinator.captureConnectorEvent(connectorEvent(
                type: "message.delta",
                sessionID: "session-1",
                turnID: "turn-1",
                itemID: "item-private",
                payload: ["delta": .string(text)]
            ))
            XCTAssertEqual(captured, 0)
        }
        let completed = try await coordinator.captureConnectorEvent(connectorEvent(
            type: "item.completed",
            sessionID: "session-1",
            turnID: "turn-1",
            itemID: "item-private",
            payload: [
                "item": .object([
                    "id": .string("item-private"),
                    "type": .string("agentMessage"),
                    "text": .string("<environment_context>private</environment_context>")
                ])
            ]
        ))
        XCTAssertEqual(completed, 0)
        _ = try await coordinator.captureConnectorEvent(connectorEvent(
            type: "connector.warning",
            sessionID: "session-1",
            payload: ["reason": .string("native-history-fallback")]
        ))
        _ = try await coordinator.flush()
        let calls = await transport.snapshot()
        XCTAssertEqual(try array(calls[0], key: "events").count, 1)
        XCTAssertFalse(try serializedJSON(calls).contains("environment_context"))
        XCTAssertFalse(try serializedJSON(calls).contains("private"))
    }

    func testFailedTransportSurvivesRestartAndRetriesExactPayload() async throws {
        let fileURL = temporaryURL("retry.json")
        let failingTransport = RecordingLiveAISyncTransport(failures: 1)
        let first = try makeCoordinator(fileURL: fileURL, transport: failingTransport)
        _ = try await first.captureConnectorEvent(connectorEvent(
            type: "connector.warning",
            sessionID: "session-1",
            payload: ["reason": .string("native-history-fallback")]
        ))
        do {
            _ = try await first.flush()
            XCTFail("The first transport attempt should fail")
        } catch TestLiveAISyncFailure.offline {}
        let firstCalls = await failingTransport.snapshot()
        let firstPayload = try XCTUnwrap(firstCalls.first)
        let attributes = try FileManager.default.attributesOfItem(atPath: fileURL.path)
        XCTAssertEqual((attributes[.posixPermissions] as? NSNumber)?.intValue, 0o600)

        let retryTransport = RecordingLiveAISyncTransport()
        let recovered = try makeCoordinator(fileURL: fileURL, transport: retryTransport)
        let recoveredRequestCount = await recovered.pendingRequestCount()
        let recoveredEventCount = await recovered.pendingEventCount()
        XCTAssertEqual(recoveredRequestCount, 1)
        XCTAssertEqual(recoveredEventCount, 1)
        let flushedCount = try await recovered.flush()
        XCTAssertEqual(flushedCount, 1)
        let retryCalls = await retryTransport.snapshot()
        let retriedPayload = try XCTUnwrap(retryCalls.first)
        XCTAssertEqual(retriedPayload, firstPayload)
    }

    func testPairingScopePreservesSameDeviceAndResetsAcrossUnpairAndRepair() async throws {
        let fileURL = temporaryURL("pairing-scope.json")
        let transport = RecordingLiveAISyncTransport()
        let first = try makeCoordinator(fileURL: fileURL, transport: transport)
        try await first.bindPairing(deviceID: "device-a")
        _ = try await first.captureConnectorEvent(connectorEvent(
            type: "turn.started",
            sessionID: "session-1",
            turnID: "turn-a",
            payload: [
                "turn": .object(["id": .string("turn-a"), "status": .string("inProgress")])
            ]
        ))

        let recovered = try makeCoordinator(fileURL: fileURL, transport: transport)
        try await recovered.bindPairing(deviceID: "device-a")
        let sameDeviceRequestCount = await recovered.pendingRequestCount()
        let sameDeviceEventCount = await recovered.pendingEventCount()
        XCTAssertEqual(sameDeviceRequestCount, 1)
        XCTAssertEqual(sameDeviceEventCount, 1)

        try await recovered.bindPairing(deviceID: nil)
        let unpairedRequestCount = await recovered.pendingRequestCount()
        let unpairedEventCount = await recovered.pendingEventCount()
        XCTAssertEqual(unpairedRequestCount, 0)
        XCTAssertEqual(unpairedEventCount, 0)

        try await recovered.bindPairing(deviceID: "device-b")
        _ = try await recovered.captureConnectorEvent(connectorEvent(
            type: "turn.started",
            sessionID: "session-1",
            turnID: "turn-b",
            payload: [
                "turn": .object(["id": .string("turn-b"), "status": .string("inProgress")])
            ]
        ))
        let flushedCount = try await recovered.flush()
        XCTAssertEqual(flushedCount, 1)
        let calls = await transport.snapshot()
        let events = try array(try XCTUnwrap(calls.last), key: "events")
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events[0].objectValue?["sequence"], .number(1))
    }

    func testPairingScopeChangeDropsWithheldStreamTails() async throws {
        let transport = RecordingLiveAISyncTransport()
        let coordinator = try makeCoordinator(
            fileURL: temporaryURL("pairing-stream-tail.json"),
            transport: transport
        )
        try await coordinator.bindPairing(deviceID: "device-a")
        let captured = try await coordinator.captureConnectorEvent(connectorEvent(
            type: "message.delta",
            sessionID: "session-1",
            turnID: "turn-1",
            itemID: "item-1",
            payload: ["delta": .string("old-account-tail")]
        ))
        XCTAssertEqual(captured, 0)

        try await coordinator.bindPairing(deviceID: nil)
        try await coordinator.bindPairing(deviceID: "device-b")
        _ = try await coordinator.captureConnectorEvent(connectorEvent(
            type: "item.completed",
            sessionID: "session-1",
            turnID: "turn-1",
            itemID: "item-1",
            payload: [
                "item": .object([
                    "id": .string("item-1"),
                    "type": .string("agentMessage"),
                    "text": .string("new account response")
                ])
            ]
        ))
        _ = try await coordinator.flush()
        let calls = await transport.snapshot()
        let serialized = try serializedJSON(calls)
        XCTAssertFalse(serialized.contains("old-account-tail"))
        XCTAssertTrue(serialized.contains("new account response"))
    }

    func testCapacityFailureDoesNotPartiallyAdvanceTheDurableSequence() async throws {
        let fileURL = temporaryURL("bounded.json")
        let transport = RecordingLiveAISyncTransport()
        let limits = try LiveAISyncConfiguration(
            maximumOutboxRequests: 1,
            maximumPendingEvents: 1,
            maximumTrackedRevisions: 16
        )
        let coordinator = try makeCoordinator(fileURL: fileURL, transport: transport, configuration: limits)
        _ = try await coordinator.captureConnectorEvent(connectorEvent(
            type: "turn.started",
            sessionID: "session-1",
            turnID: "turn-1",
            payload: [
                "turn": .object(["id": .string("turn-1"), "status": .string("inProgress")])
            ]
        ))
        do {
            _ = try await coordinator.captureConnectorEvent(connectorEvent(
                type: "turn.completed",
                sessionID: "session-1",
                turnID: "turn-1",
                payload: [
                    "turn": .object(["id": .string("turn-1"), "status": .string("completed")])
                ]
            ))
            XCTFail("Expected the pending event bound")
        } catch {
            XCTAssertEqual(error as? LiveAISyncError, .pendingEventCapacityReached)
        }
        let pendingEventCount = await coordinator.pendingEventCount()
        XCTAssertEqual(pendingEventCount, 1)

        let recovered = try makeCoordinator(fileURL: fileURL, transport: transport, configuration: limits)
        let recoveredEventCount = await recovered.pendingEventCount()
        XCTAssertEqual(recoveredEventCount, 1)
        let flushedCount = try await recovered.flush()
        XCTAssertEqual(flushedCount, 1)
        let calls = await transport.snapshot()
        let accepted = try array(calls[0], key: "events")
        XCTAssertEqual(accepted[0].objectValue?["sequence"], .number(1))
    }

    func testEventBatchesNeverExceedOneHundred() async throws {
        let transport = RecordingLiveAISyncTransport()
        let coordinator = try makeCoordinator(
            fileURL: temporaryURL("batch.json"),
            transport: transport,
            configuration: try LiveAISyncConfiguration(
                maximumOutboxRequests: 4,
                maximumPendingEvents: 200,
                maximumTrackedRevisions: 16
            )
        )
        for index in 1 ... 101 {
            let turnID = "turn-\(index)"
            _ = try await coordinator.captureConnectorEvent(connectorEvent(
                type: "turn.started",
                sessionID: "session-1",
                turnID: turnID,
                payload: [
                    "turn": .object(["id": .string(turnID), "status": .string("inProgress")])
                ]
            ))
        }
        let pendingRequestCount = await coordinator.pendingRequestCount()
        XCTAssertEqual(pendingRequestCount, 2)
        let flushedCount = try await coordinator.flush()
        XCTAssertEqual(flushedCount, 2)
        let calls = await transport.snapshot()
        XCTAssertEqual(try array(calls[0], key: "events").count, 100)
        XCTAssertEqual(try array(calls[1], key: "events").count, 1)
        XCTAssertEqual(
            try array(calls[1], key: "events")[0].objectValue?["sequence"],
            .number(101)
        )
    }

    func testFailedAndUnrelatedLeasedResponsesAreIgnored() async throws {
        let transport = RecordingLiveAISyncTransport()
        let coordinator = try makeCoordinator(fileURL: temporaryURL("ignored.json"), transport: transport)
        let failedCaptureCount = try await coordinator.captureSuccessfulLeasedResponse(
            command: command(method: "session.list"),
            response: .failure(id: "failed", code: "connector_error", message: "no")
        )
        XCTAssertEqual(failedCaptureCount, 0)
        let unrelatedCaptureCount = try await coordinator.captureSuccessfulLeasedResponse(
            command: command(method: "session.send"),
            response: .success(id: "send", result: .object(["status": .string("started")]))
        )
        XCTAssertEqual(unrelatedCaptureCount, 0)
        let pendingRequestCount = await coordinator.pendingRequestCount()
        XCTAssertEqual(pendingRequestCount, 0)
    }

    private func makeCoordinator(
        fileURL: URL,
        transport: RecordingLiveAISyncTransport,
        configuration: LiveAISyncConfiguration = try! LiveAISyncConfiguration()
    ) throws -> LiveAISyncCoordinator {
        try LiveAISyncCoordinator(fileURL: fileURL, configuration: configuration) { payload in
            try await transport.send(payload)
        }
    }

    private func command(
        method: String,
        connectorID: String? = nil,
        extra: [String: JSONValue] = [:]
    ) -> LeasedCommand {
        var parameters = extra
        parameters["connectorId"] = .string(connectorID ?? self.connectorID)
        return LeasedCommand(
            commandID: "command-\(method)",
            leaseID: "lease-\(method)",
            method: method,
            parameters: .object(parameters),
            leaseExpiresAt: Date().addingTimeInterval(60),
            approvedForExecution: true
        )
    }

    private func session(
        id: String,
        title: String,
        projectID: String? = nil,
        projectLabel: String? = nil,
        status: String,
        extra: [String: JSONValue] = [:]
    ) -> JSONValue {
        var value: [String: JSONValue] = [
            "id": .string(id),
            "connectorId": .string(connectorID),
            "title": .string(title),
            "preview": .string(""),
            "projectId": projectID.map(JSONValue.string) ?? .null,
            "projectLabel": projectLabel.map(JSONValue.string) ?? .null,
            "createdAt": .string("2026-08-18T00:00:00.000Z"),
            "updatedAt": .string("2026-08-18T01:00:00.000Z"),
            "activeTurnId": .null,
            "status": .string(status),
            "source": .string("native")
        ]
        value.merge(extra) { _, replacement in replacement }
        return .object(value)
    }

    private func connectorEvent(
        type: String,
        sessionID: String,
        turnID: String? = nil,
        itemID: String? = nil,
        payload: [String: JSONValue]
    ) -> ConnectorEvent {
        ConnectorEvent(
            event: "connector/event",
            payload: .object([
                "connectorId": .string(connectorID),
                "sequence": .number(9_999),
                "observedAt": .string(observedAt),
                "sessionId": .string(sessionID),
                "turnId": turnID.map(JSONValue.string) ?? .null,
                "itemId": itemID.map(JSONValue.string) ?? .null,
                "type": .string(type),
                "payload": .object(payload)
            ])
        )
    }

    private func array(_ value: JSONValue, key: String) throws -> [JSONValue] {
        guard case let .array(values)? = value.objectValue?[key] else {
            throw LiveAISyncError.invalidTransportResponse
        }
        return values
    }

    private func serializedJSON<T: Encodable>(_ value: T) throws -> String {
        String(decoding: try JSONEncoder().encode(value), as: UTF8.self)
    }

    private func temporaryURL(_ name: String) -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("LiveAISyncTests-\(UUID().uuidString)", isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        return directory.appendingPathComponent(name)
    }
}
