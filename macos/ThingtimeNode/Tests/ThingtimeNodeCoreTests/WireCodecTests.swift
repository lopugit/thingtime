import Foundation
import XCTest
@testable import ThingtimeNodeCore

final class WireCodecTests: XCTestCase {
    func testXPCRequestAndResponseRoundTrip() throws {
        let request = NodeRequest(
            id: "request-1",
            commandId: "command-1",
            method: "connector.send",
            parameters: .object(["message": .string("hello")])
        )
        XCTAssertEqual(try NodeWireCodec.decodeRequest(NodeWireCodec.encodeRequest(request)), request)

        let response = NodeResponse.success(id: request.id, result: .bool(true))
        XCTAssertEqual(try NodeWireCodec.decodeResponse(NodeWireCodec.encodeResponse(response)), response)
    }

    func testXPCLimitRejectsOversizedPayload() {
        XCTAssertThrowsError(try NodeWireCodec.decodeRequest(Data(repeating: 0x20, count: 32), maximumBytes: 16))
    }

    func testXPCPolicyLimitsBridgeToOnboardingAndPresenceGatedPairing() {
        for method in ["node.status", "permissions.preflight", "pairing.status", "pairing.begin"] {
            XCTAssertEqual(ThingtimeNodeXPCRequestPolicy.access(for: method), .onboardingRead)
        }
        for method in ["pairing.claim", "pairing.resume", "pairing.unpair"] {
            XCTAssertEqual(ThingtimeNodeXPCRequestPolicy.access(for: method), .pairingMutation)
        }
        XCTAssertEqual(ThingtimeNodeXPCRequestPolicy.access(for: "permissions.request"), .permissionMutation)
        for method in [
            "telemetry.snapshot",
            "command.status",
            "action.evaluate",
            "action.execute",
            "connector.health",
            "connector.start",
            "connector.stop",
            "connector.send",
            "desktop-chat.send"
        ] {
            XCTAssertEqual(ThingtimeNodeXPCRequestPolicy.access(for: method), .forbidden)
        }
    }

	func testXPCPresenceTimeoutsFinishBeforeTheServerPairingChallengeExpires() {
		XCTAssertEqual(ThingtimeNodeXPCRequestPolicy.confirmationTimeoutSeconds(for: "pairing.claim"), 540)
		XCTAssertEqual(ThingtimeNodeXPCRequestPolicy.confirmationTimeoutSeconds(for: "pairing.resume"), 540)
		XCTAssertEqual(ThingtimeNodeXPCRequestPolicy.bridgeResponseTimeoutSeconds(for: "pairing.claim"), 555)
		XCTAssertEqual(ThingtimeNodeXPCRequestPolicy.confirmationTimeoutSeconds(for: "pairing.unpair"), 120)
		XCTAssertEqual(ThingtimeNodeXPCRequestPolicy.confirmationTimeoutSeconds(for: "permissions.request"), 120)
		XCTAssertEqual(ThingtimeNodeXPCRequestPolicy.bridgeResponseTimeoutSeconds(for: "permissions.request"), 135)
		XCTAssertEqual(ThingtimeNodeXPCRequestPolicy.bridgeResponseTimeoutSeconds(for: "node.status"), 15)
		XCTAssertEqual(ThingtimeNodeXPCRequestPolicy.confirmationTimeoutSeconds(for: "action.execute"), 0)
	}

    func testConnectorNDJSONCodec() throws {
        let command = ConnectorCommand(id: "c1", operation: "chat.send", payload: .object(["text": .string("hi")]))
        let encoded = try ConnectorWireCodec.encode(command)
        XCTAssertEqual(encoded.last, 0x0A)

        let reply = Data(#"{"id":"c1","ok":true,"result":{"accepted":true},"type":"reply"}"#.utf8)
        XCTAssertEqual(
            try ConnectorWireCodec.decode(reply),
            .reply(ConnectorReply(id: "c1", ok: true, result: .object(["accepted": .bool(true)]), error: nil))
        )
    }

    func testQueuedSendAloneGetsTheBoundedBlockingRequestTimeout() {
        let queued = ConnectorCommand(
            operation: "session/send",
            payload: .object(["mode": .string("queue")])
        )
        let steer = ConnectorCommand(
            operation: "session/send",
            payload: .object(["mode": .string("steer")])
        )
        XCTAssertEqual(
            ConnectorRuntime.requestTimeoutSeconds(for: queued, defaultSeconds: 60),
            31 * 60 + 15
        )
        XCTAssertEqual(
            ConnectorRuntime.requestTimeoutSeconds(for: steer, defaultSeconds: 60),
            60
        )
    }

    func testCancellingPendingConnectorRequestTerminatesItAsUncertain() async throws {
        let configuration = try ConnectorRuntimeConfiguration(
            executableURL: URL(fileURLWithPath: "/usr/bin/tail"),
            arguments: ["-f", "/dev/null"]
        )
        let runtime = ConnectorRuntime(configuration: configuration)
        try await runtime.start()
        let request = Task {
            try await runtime.send(ConnectorCommand(
                id: "blocked-request",
                operation: "session/send",
                payload: .object(["mode": .string("queue")])
            ))
        }
        try await Task.sleep(for: .milliseconds(20))
        request.cancel()
        do {
            _ = try await request.value
            XCTFail("A cancelled connector request must not remain live.")
        } catch let error as ThingtimeNodeError {
            XCTAssertEqual(error, .commandOutcomeUncertain)
        }
        let health = await runtime.health()
        XCTAssertTrue(health.state == .degraded || health.state == .failed)
        await runtime.stop()
    }

    func testTimingOutPendingConnectorRequestTerminatesItAsUncertain() async throws {
        let configuration = try ConnectorRuntimeConfiguration(
            executableURL: URL(fileURLWithPath: "/usr/bin/tail"),
            arguments: ["-f", "/dev/null"],
            requestTimeoutSeconds: 1
        )
        let runtime = ConnectorRuntime(configuration: configuration)
        try await runtime.start()
        do {
            _ = try await runtime.send(ConnectorCommand(
                id: "timed-out-request",
                operation: "session/list"
            ))
            XCTFail("A timed-out connector request must not remain live.")
        } catch let error as ThingtimeNodeError {
            XCTAssertEqual(error, .commandOutcomeUncertain)
        }
        let health = await runtime.health()
        XCTAssertTrue(health.state == .degraded || health.state == .failed)
        await runtime.stop()
    }

    func testLongLivedConnectorDeliversReplyBeforeClosingStandardOutput() async throws {
        let configuration = try ConnectorRuntimeConfiguration(
            executableURL: URL(fileURLWithPath: "/bin/sh"),
            arguments: [
                "-c",
                #"IFS= read -r ignored; printf '%s\n' '{"id":"live-child","ok":true,"result":{"accepted":true},"type":"reply"}'; IFS= read -r keep_open"#
            ],
            requestTimeoutSeconds: 1
        )
        let runtime = ConnectorRuntime(configuration: configuration)
        try await runtime.start()

        let reply = try await runtime.send(ConnectorCommand(
            id: "live-child",
            operation: "test/echo"
        ))

        XCTAssertTrue(reply.ok)
        XCTAssertEqual(reply.result, .object(["accepted": .bool(true)]))
        let health = await runtime.health()
        XCTAssertEqual(health.state, .running)
        await runtime.stop()
    }

    func testConnectorProjectReferencesAreBoundedPathFreeAndUnique() throws {
        let result: JSONValue = .object([
            "connectors": .array([
                .object([
                    "id": .string("codex-app-server"),
                    "label": .string("Codex"),
                    "capabilities": .array([]),
                    "projects": .array([
                        .object([
                            "projectId": .string("thingtime"),
                            "projectLabel": .string("thingtime")
                        ])
                    ])
                ])
            ])
        ])
        XCTAssertEqual(
            try ConnectorRuntime.parseProjectReferences(result, connectorID: "codex-app-server"),
            [.init(projectId: "thingtime", projectLabel: "thingtime")]
        )

        let invalid: JSONValue = .object([
            "connectors": .array([
                .object([
                    "id": .string("codex-app-server"),
                    "label": .string("Codex"),
                    "capabilities": .array([]),
                    "projects": .array([
                        .object([
                            "projectId": .string("thingtime"),
                            "projectLabel": .string("thingtime"),
                            "projectPath": .string("/private/project")
                        ])
                    ])
                ])
            ])
        ])
        XCTAssertThrowsError(
            try ConnectorRuntime.parseProjectReferences(invalid, connectorID: "codex-app-server")
        )

        let unsafeLabel: JSONValue = .object([
            "connectors": .array([
                .object([
                    "id": .string("codex-app-server"),
                    "label": .string("Codex"),
                    "capabilities": .array([]),
                    "projects": .array([
                        .object([
                            "projectId": .string("thingtime"),
                            "projectLabel": .string("private\\folder\u{2066}")
                        ])
                    ])
                ])
            ])
        ])
        XCTAssertThrowsError(
            try ConnectorRuntime.parseProjectReferences(unsafeLabel, connectorID: "codex-app-server")
        )
    }

    func testSessionListProjectReferencesArePathFreeDeduplicatedAndBounded() throws {
        let session: (String) -> JSONValue = { identifier in
            .object([
                "id": .string(identifier),
                "connectorId": .string("codex-app-server"),
                "title": .string("Thingtime"),
                "preview": .string(""),
                "projectId": .string("local-0123456789abcdef0123456789abcdef"),
                "projectLabel": .string("thingtime"),
                "createdAt": .null,
                "updatedAt": .null,
                "activeTurnId": .null,
                "status": .string("idle"),
                "source": .null
            ])
        }
        let result: JSONValue = .object([
            "sessions": .array([session("thread-1"), session("thread-2")]),
            "nextCursor": .string("opaque/page+2==")
        ])
        XCTAssertEqual(
            try ConnectorRuntime.parseSessionProjectReferences(result),
            [.init(projectId: "local-0123456789abcdef0123456789abcdef", projectLabel: "thingtime")]
        )

        let withPath: JSONValue = .object([
            "sessions": .array([
                .object([
                    "id": .string("thread-private"),
                    "projectId": .string("local-0123456789abcdef0123456789abcdef"),
                    "projectLabel": .string("thingtime"),
                    "projectPath": .string("/Users/person/private/thingtime")
                ])
            ]),
            "nextCursor": .null
        ])
        XCTAssertThrowsError(try ConnectorRuntime.parseSessionProjectReferences(withPath))

        let oversized: JSONValue = .object([
            "sessions": .array((0 ... 100).map { session("thread-\($0)") }),
            "nextCursor": .null
        ])
        XCTAssertThrowsError(try ConnectorRuntime.parseSessionProjectReferences(oversized))
    }
}
