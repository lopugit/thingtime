import Foundation
import XCTest
@testable import ThingtimeNodeCore

private actor FakeDesktopChatCommanding: DesktopChatCommanding {
    var permissionGranted = true
    var running = true
    var chats = [
        DesktopVisibleChat(selectionToken: "opaque-selected", isSelected: true),
        DesktopVisibleChat(selectionToken: "opaque-other", isSelected: false)
    ]
    var conversation = DesktopVisibleConversation(messages: [
        DesktopVisibleMessage(opaqueToken: "user-1", role: .user, text: "Hello"),
        DesktopVisibleMessage(opaqueToken: "assistant-1", role: .assistant, text: "Hi there")
    ])
    var sentMessages: [String] = []

    func capabilities(bundleIdentifier: String) async throws -> DesktopChatAccessibilityCapabilities {
        DesktopChatAccessibilityCapabilities(
            bundleIdentifier: bundleIdentifier,
            permissionGranted: permissionGranted,
            applicationRunning: running
        )
    }

    func listVisibleChats(bundleIdentifier: String) async throws -> [DesktopVisibleChat] { chats }

    func readVisibleChat(bundleIdentifier: String) async throws -> DesktopVisibleConversation { conversation }

    func createNewChat(
        bundleIdentifier: String,
        authorization: DesktopChatMutationAuthorization
    ) async throws {
        guard authorization.explicitlyApproved else { throw DesktopChatAccessibilityError.explicitApprovalRequired }
        chats = [DesktopVisibleChat(selectionToken: "opaque-new", isSelected: true)]
    }

    func selectVisibleChat(
        bundleIdentifier: String,
        selectionToken: String,
        authorization: DesktopChatMutationAuthorization
    ) async throws {
        guard authorization.explicitlyApproved else { throw DesktopChatAccessibilityError.explicitApprovalRequired }
        guard chats.contains(where: { $0.selectionToken == selectionToken }) else {
            throw DesktopChatAccessibilityError.selectorDrift("visible chat selection")
        }
        chats = chats.map {
            DesktopVisibleChat(selectionToken: $0.selectionToken, isSelected: $0.selectionToken == selectionToken)
        }
    }

    func sendMessage(
        bundleIdentifier: String,
        text: String,
        authorization: DesktopChatMutationAuthorization
    ) async throws {
        guard authorization.explicitlyApproved else { throw DesktopChatAccessibilityError.explicitApprovalRequired }
        sentMessages.append(text)
    }

    func sent() -> [String] { sentMessages }

    func setConversation(_ next: DesktopVisibleConversation) { conversation = next }
}

private actor DesktopRuntimeEventRecorder {
    private var values: [ConnectorEvent] = []

    func append(_ event: ConnectorEvent) { values.append(event) }
    func events() -> [ConnectorEvent] { values }
}

final class DesktopChatRuntimeTests: XCTestCase {
    func testAdvertisesThreeBoundedSemanticConnectorsWithoutPrompting() async throws {
        let runtime = DesktopChatRuntime(connector: FakeDesktopChatCommanding())
        let connectors = await runtime.connectorStates()
        XCTAssertEqual(connectors.map(\.id), [
            DesktopChatRuntime.chatGPTConnectorID,
            DesktopChatRuntime.claudeConnectorID,
            DesktopChatRuntime.claudeThingtimeConnectorID
        ])
        XCTAssertTrue(connectors.allSatisfy { $0.status == "connected" })
        XCTAssertTrue(connectors.allSatisfy {
            $0.capabilities == ["read-history", "create-session", "send-message", "accessibility", "explicit-approval"]
        })
    }

    func testListsOpaqueSessionsAndReadsOnlyAlreadySelectedVisibleChat() async throws {
        let runtime = DesktopChatRuntime(connector: FakeDesktopChatCommanding())
        let listed = try await runtime.execute(command(
            operation: "session.list",
            payload: .object([:])
        ))
        let sessions = try XCTUnwrap(listed.objectValue?["sessions"])
        guard case let .array(values) = sessions else { return XCTFail("Expected sessions") }
        XCTAssertEqual(values.count, 2)
        XCTAssertEqual(values.first?.objectValue?["id"]?.stringValue, "opaque-selected")
        XCTAssertEqual(values.first?.objectValue?["title"]?.stringValue, "Visible chat 1 (selected)")
        XCTAssertEqual(values.first?.objectValue?["preview"]?.stringValue, "")

        let page = try await runtime.execute(command(
            operation: "session.read",
            payload: .object(["sessionId": .string("opaque-selected")])
        ))
        guard case let .array(entries)? = page.objectValue?["entries"] else { return XCTFail("Expected entries") }
        XCTAssertEqual(entries.count, 2)
        XCTAssertEqual(entries.first?.objectValue?["role"]?.stringValue, "user")
        XCTAssertEqual(entries.first?.objectValue?["text"]?.stringValue, "Hello")

        do {
            _ = try await runtime.execute(command(
                operation: "session.read",
                payload: .object(["sessionId": .string("opaque-other")])
            ))
            XCTFail("Expected non-selected chat read to fail closed")
        } catch let error as ThingtimeNodeError {
            XCTAssertEqual(error.code, ThingtimeNodeError.approvalRequired("").code)
        }


        let selectedPage = try await runtime.execute(command(
            operation: "session.read",
            payload: .object(["sessionId": .string("opaque-other")]),
            approved: true
        ))
        guard case let .array(selectedEntries)? = selectedPage.objectValue?["entries"] else {
            return XCTFail("Expected selected entries")
        }
        XCTAssertEqual(selectedEntries.count, 2)
    }

    func testMutationsRequireApprovalAndAccessibilitySendDoesNotPretendToSteer() async throws {
        let backend = FakeDesktopChatCommanding()
        let runtime = DesktopChatRuntime(connector: backend)
        do {
            _ = try await runtime.execute(command(
                operation: "session.send",
                payload: .object([
                    "sessionId": .string("opaque-selected"),
                    "text": .string("Ship it"),
                    "delivery": .string("queue")
                ])
            ))
            XCTFail("Expected approval gate")
        } catch let error as ThingtimeNodeError {
            XCTAssertEqual(error.code, ThingtimeNodeError.approvalRequired("").code)
        }

        let sent = try await runtime.execute(command(
            operation: "session.send",
            payload: .object([
                "sessionId": .string("opaque-selected"),
                "text": .string("Ship it"),
                "delivery": .string("queue")
            ]),
            approved: true
        ))
        XCTAssertEqual(sent.objectValue?["status"]?.stringValue, "started")
        let deliveredMessages = await backend.sent()
        XCTAssertEqual(deliveredMessages, ["Ship it"])

        do {
            _ = try await runtime.execute(command(
                operation: "session.send",
                payload: .object([
                    "sessionId": .string("opaque-selected"),
                    "text": .string("Change course"),
                    "delivery": .string("steer")
                ]),
                approved: true
            ))
            XCTFail("Expected steer to remain unavailable")
        } catch let error as ThingtimeNodeError {
            XCTAssertEqual(error.code, ThingtimeNodeError.policyDenied("").code)
        }
    }

    func testApprovedCreateReturnsOnlyNewOpaqueSelectedSession() async throws {
        let runtime = DesktopChatRuntime(connector: FakeDesktopChatCommanding())
        let created = try await runtime.execute(command(
            operation: "session.create",
            payload: .object([:]),
            approved: true
        ))
        XCTAssertEqual(created.objectValue?["id"]?.stringValue, "opaque-new")
        XCTAssertEqual(created.objectValue?["title"]?.stringValue, "Visible chat 1 (selected)")
        XCTAssertEqual(created.objectValue?["projectId"], .null)
    }

    func testStreamsSelectedVisibleAssistantDeltasAndCompletionWithoutInventingSteer() async throws {
        let backend = FakeDesktopChatCommanding()
        let runtime = DesktopChatRuntime(connector: backend)
        let recorder = DesktopRuntimeEventRecorder()
        let stream = await runtime.events()
        let recording = Task {
            for await event in stream {
                await recorder.append(event)
                if await recorder.events().count >= 5 { return }
            }
        }
        defer { recording.cancel() }

        _ = try await runtime.execute(command(
            operation: "session.read",
            payload: .object(["sessionId": .string("opaque-selected")])
        ))
        await backend.setConversation(.init(messages: [
            .init(opaqueToken: "user-1", role: .user, text: "Hello"),
            .init(opaqueToken: "assistant-1", role: .assistant, text: "Hi there"),
            .init(opaqueToken: "assistant-2", role: .assistant, text: "Hel")
        ]))
        await runtime.pollActiveSessionsOnce()
        await backend.setConversation(.init(messages: [
            .init(opaqueToken: "user-1", role: .user, text: "Hello"),
            .init(opaqueToken: "assistant-1", role: .assistant, text: "Hi there"),
            .init(opaqueToken: "assistant-2", role: .assistant, text: "Hello")
        ]))
        await runtime.pollActiveSessionsOnce()
        await runtime.pollActiveSessionsOnce()
        await runtime.pollActiveSessionsOnce()

        for _ in 0 ..< 50 where await recorder.events().count < 5 {
            try await Task.sleep(for: .milliseconds(10))
        }
        let events = await recorder.events()
        XCTAssertEqual(events.compactMap { $0.payload.objectValue?["type"]?.stringValue }, [
            "turn.started", "message.delta", "message.delta", "item.completed", "turn.completed"
        ])
        let deltas = events.compactMap { event -> String? in
            guard event.payload.objectValue?["type"]?.stringValue == "message.delta" else { return nil }
            return event.payload.objectValue?["payload"]?.objectValue?["delta"]?.stringValue
        }
        XCTAssertEqual(deltas, ["Hel", "lo"])
        let completion = events.first { $0.payload.objectValue?["type"]?.stringValue == "item.completed" }
        XCTAssertEqual(
            completion?.payload.objectValue?["payload"]?.objectValue?["item"]?.objectValue?["text"]?.stringValue,
            "Hello"
        )
    }

    @MainActor
    func testLeasedAccessibilityCommandUsesTheJournaledDesktopRoute() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("DesktopChatRuntimeRoute-\(UUID().uuidString)", isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let backend = FakeDesktopChatCommanding()
        let telemetry = DeviceTelemetryCollector()
        telemetry.establishSessionActivityAfterApplicationLaunch()
        let controller = ThingtimeNodeController(
            journal: try CommandJournal(fileURL: directory.appendingPathComponent("journal.json")),
            pairing: PairingManager(store: InMemoryDeviceCredentialStore()),
            connector: ConnectorRuntime(configuration: nil),
            telemetry: telemetry,
            actionExecutor: SafeActionExecutor(telemetry: telemetry),
            desktopChat: DesktopChatRuntime(connector: backend)
        )
        let command = LeasedCommand(
            commandID: "desktop-command-1",
            leaseID: "lease-1",
            method: "session.send",
            parameters: .object([
                "connectorId": .string(DesktopChatRuntime.chatGPTConnectorID),
                "sessionId": .string("opaque-selected"),
                "text": .string("From Thingtime"),
                "delivery": .string("queue")
            ]),
            leaseExpiresAt: Date().addingTimeInterval(60),
            approvedForExecution: true
        )
        let first = await controller.handleLeasedCommand(command)
        let replay = await controller.handleLeasedCommand(command)
        XCTAssertTrue(first.ok)
        XCTAssertTrue(replay.ok)
        let deliveredMessages = await backend.sent()
        XCTAssertEqual(deliveredMessages, ["From Thingtime"])
    }

    private func command(
        operation: String,
        payload: JSONValue,
        approved: Bool = false
    ) -> DesktopChatCommand {
        DesktopChatCommand(
            connectorID: DesktopChatRuntime.chatGPTConnectorID,
            operation: operation,
            payload: payload,
            commandID: "command-1",
            sessionLocked: false,
            explicitlyApproved: approved
        )
    }
}
