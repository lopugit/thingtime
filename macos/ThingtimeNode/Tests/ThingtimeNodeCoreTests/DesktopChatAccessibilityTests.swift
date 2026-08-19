import Foundation
import XCTest
@testable import ThingtimeNodeCore

private struct FakeAccessibilityNode: Sendable {
    let metadata: AccessibilityElementMetadata
    let children: [AccessibilityElementReference]
    let text: String?

    init(
        role: String,
        identifier: String? = nil,
        description: String? = nil,
        selected: Bool = false,
        enabled: Bool = true,
        actions: Set<String> = [],
        children: [AccessibilityElementReference] = [],
        text: String? = nil
    ) {
        self.metadata = AccessibilityElementMetadata(
            role: role,
            identifier: identifier,
            semanticDescription: description,
            isSelected: selected,
            isEnabled: enabled,
            actions: actions
        )
        self.children = children
        self.text = text
    }
}

private actor FakeDesktopChatAccessibilityBackend: DesktopChatAccessibilityBackend {
    private let trusted: Bool
    private let roots: [String: AccessibilityElementReference]
    private let nodes: [AccessibilityElementReference: FakeAccessibilityNode]
    private(set) var applicationRequests: [String] = []
    private(set) var textReads: [AccessibilityElementReference] = []
    private(set) var presses: [AccessibilityElementReference] = []
    private(set) var textWrites: [(AccessibilityElementReference, String)] = []

    init(
        trusted: Bool = true,
        roots: [String: AccessibilityElementReference],
        nodes: [AccessibilityElementReference: FakeAccessibilityNode]
    ) {
        self.trusted = trusted
        self.roots = roots
        self.nodes = nodes
    }

    func preflightTrusted() async -> Bool { trusted }

    func applicationElement(bundleIdentifier: String) async throws -> AccessibilityElementReference? {
        applicationRequests.append(bundleIdentifier)
        return roots[bundleIdentifier]
    }

    func metadata(for element: AccessibilityElementReference) async throws -> AccessibilityElementMetadata {
        guard let node = nodes[element] else { throw TestBackendError.missingElement }
        return node.metadata
    }

    func visibleChildren(
        of element: AccessibilityElementReference,
        maximumCount: Int
    ) async throws -> AccessibilityChildrenPage {
        guard let node = nodes[element] else { throw TestBackendError.missingElement }
        return AccessibilityChildrenPage(
            elements: Array(node.children.prefix(maximumCount)),
            hasMore: node.children.count > maximumCount
        )
    }

    func visibleText(
        of element: AccessibilityElementReference,
        maximumUTF8Bytes: Int
    ) async throws -> AccessibilityTextValue? {
        textReads.append(element)
        guard let text = nodes[element]?.text else { return nil }
        if text.utf8.count > maximumUTF8Bytes {
            return AccessibilityTextValue(text: "", wasTruncated: true)
        }
        return AccessibilityTextValue(text: text)
    }

    func press(_ element: AccessibilityElementReference) async throws {
        guard nodes[element] != nil else { throw TestBackendError.missingElement }
        presses.append(element)
    }

    func setText(_ text: String, on element: AccessibilityElementReference) async throws {
        guard nodes[element] != nil else { throw TestBackendError.missingElement }
        textWrites.append((element, text))
    }
}

private enum TestBackendError: Error {
    case missingElement
}

final class DesktopChatAccessibilityTests: XCTestCase {
    private let codexBundleID = DesktopChatApplication.codex.rawValue
    private let approved = DesktopChatMutationAuthorization(sessionLocked: false, explicitlyApproved: true)

    func testVisibleListingAndReadingExposeOnlyUserAndAssistantText() async throws {
        let fixture = makeFixture()
        let backend = FakeDesktopChatAccessibilityBackend(
            roots: [codexBundleID: fixture.root],
            nodes: fixture.nodes
        )
        let connector = DesktopChatAccessibilityConnector(backend: backend)

        let chats = try await connector.listVisibleChats(bundleIdentifier: codexBundleID)
        XCTAssertEqual(chats, [
            DesktopVisibleChat(selectionToken: fixture.chatOne.rawValue, isSelected: true),
            DesktopVisibleChat(selectionToken: fixture.chatTwo.rawValue, isSelected: false)
        ])

        let conversation = try await connector.readVisibleChat(bundleIdentifier: codexBundleID)
        XCTAssertEqual(conversation.messages, [
            DesktopVisibleMessage(opaqueToken: fixture.userMessage.rawValue, role: .user, text: "Please explain this code."),
            DesktopVisibleMessage(opaqueToken: fixture.assistantMessage.rawValue, role: .assistant, text: "Here is the visible answer.")
        ])
        let textReads = await backend.textReads
        XCTAssertEqual(Set(textReads), Set([fixture.userText, fixture.assistantText]))
        XCTAssertFalse(textReads.contains(fixture.toolText))
        XCTAssertFalse(conversation.messages.map(\.text).joined().contains("internal tool output"))
    }

    func testNewSelectAndSendRequireUnlockedExplicitApproval() async throws {
        let fixture = makeFixture()
        let backend = FakeDesktopChatAccessibilityBackend(
            roots: [codexBundleID: fixture.root],
            nodes: fixture.nodes
        )
        let connector = DesktopChatAccessibilityConnector(backend: backend)

        do {
            try await connector.createNewChat(
                bundleIdentifier: codexBundleID,
                authorization: DesktopChatMutationAuthorization(sessionLocked: true, explicitlyApproved: true)
            )
            XCTFail("Locked mutation should fail")
        } catch {
            XCTAssertEqual(error as? DesktopChatAccessibilityError, .sessionLocked)
        }
        do {
            try await connector.sendMessage(
                bundleIdentifier: codexBundleID,
                text: "hello",
                authorization: DesktopChatMutationAuthorization(sessionLocked: false, explicitlyApproved: false)
            )
            XCTFail("Unapproved mutation should fail")
        } catch {
            XCTAssertEqual(error as? DesktopChatAccessibilityError, .explicitApprovalRequired)
        }
        let deniedPresses = await backend.presses
        let deniedWrites = await backend.textWrites
        XCTAssertTrue(deniedPresses.isEmpty)
        XCTAssertTrue(deniedWrites.isEmpty)

        try await connector.createNewChat(bundleIdentifier: codexBundleID, authorization: approved)
        try await connector.selectVisibleChat(
            bundleIdentifier: codexBundleID,
            selectionToken: fixture.chatTwo.rawValue,
            authorization: approved
        )
        try await connector.sendMessage(bundleIdentifier: codexBundleID, text: "hello", authorization: approved)

        let presses = await backend.presses
        let writes = await backend.textWrites
        XCTAssertEqual(presses, [fixture.newChat, fixture.chatTwo, fixture.send])
        XCTAssertEqual(writes.count, 1)
        XCTAssertEqual(writes.first?.0, fixture.composer)
        XCTAssertEqual(writes.first?.1, "hello")
    }

    func testSelectorDriftFailsClosedBeforeAnyTextRead() async throws {
        var fixture = makeFixture()
        fixture.nodes[fixture.transcript] = FakeAccessibilityNode(
            role: "AXGroup",
            identifier: "renamed-transcript-after-app-update",
            children: [fixture.userMessage, fixture.assistantMessage]
        )
        let backend = FakeDesktopChatAccessibilityBackend(
            roots: [codexBundleID: fixture.root],
            nodes: fixture.nodes
        )
        let connector = DesktopChatAccessibilityConnector(backend: backend)

        do {
            _ = try await connector.readVisibleChat(bundleIdentifier: codexBundleID)
            XCTFail("Unknown selectors must not fall back to guessed content")
        } catch {
            XCTAssertEqual(error as? DesktopChatAccessibilityError, .selectorDrift("visible transcript"))
        }
        let textReads = await backend.textReads
        XCTAssertTrue(textReads.isEmpty)
    }

    func testTraversalAndTextBoundsFailClosed() async throws {
        let fixture = makeFixture()
        let nodeBoundBackend = FakeDesktopChatAccessibilityBackend(
            roots: [codexBundleID: fixture.root],
            nodes: fixture.nodes
        )
        let nodeBoundConnector = DesktopChatAccessibilityConnector(
            backend: nodeBoundBackend,
            limits: DesktopChatTraversalLimits(maximumNodes: 3)
        )
        do {
            _ = try await nodeBoundConnector.listVisibleChats(bundleIdentifier: codexBundleID)
            XCTFail("Node bound should fail closed")
        } catch {
            XCTAssertEqual(error as? DesktopChatAccessibilityError, .traversalLimitExceeded("node count"))
        }

        var textFixture = makeFixture()
        textFixture.nodes[textFixture.userText] = FakeAccessibilityNode(
            role: "AXStaticText",
            text: String(repeating: "x", count: 64)
        )
        let textBoundBackend = FakeDesktopChatAccessibilityBackend(
            roots: [codexBundleID: textFixture.root],
            nodes: textFixture.nodes
        )
        let textBoundConnector = DesktopChatAccessibilityConnector(
            backend: textBoundBackend,
            limits: DesktopChatTraversalLimits(maximumTextBytesPerMessage: 16)
        )
        do {
            _ = try await textBoundConnector.readVisibleChat(bundleIdentifier: codexBundleID)
            XCTFail("Text bound should fail closed")
        } catch {
            XCTAssertEqual(error as? DesktopChatAccessibilityError, .traversalLimitExceeded("message text"))
        }
    }

    func testApplicationAllowlistIsCheckedBeforeBackendAccess() async throws {
        let fixture = makeFixture()
        let backend = FakeDesktopChatAccessibilityBackend(
            roots: [codexBundleID: fixture.root],
            nodes: fixture.nodes
        )
        let connector = DesktopChatAccessibilityConnector(backend: backend)

        do {
            _ = try await connector.capabilities(bundleIdentifier: "com.example.untrusted-chat")
            XCTFail("Unknown app should be rejected")
        } catch {
            XCTAssertEqual(
                error as? DesktopChatAccessibilityError,
                .unsupportedApplication("com.example.untrusted-chat")
            )
        }
        let applicationRequests = await backend.applicationRequests
        XCTAssertTrue(applicationRequests.isEmpty)
    }

    func testAllThreeProfilesAdvertiseCapabilitiesOnlyWhenTrustedAndRunning() async throws {
        let fixture = makeFixture()
        let roots = Dictionary(
            uniqueKeysWithValues: DesktopChatApplication.allCases.map { ($0.rawValue, fixture.root) }
        )
        let backend = FakeDesktopChatAccessibilityBackend(roots: roots, nodes: fixture.nodes)
        let connector = DesktopChatAccessibilityConnector(backend: backend)
        for application in DesktopChatApplication.allCases {
            let capabilities = try await connector.capabilities(bundleIdentifier: application.rawValue)
            XCTAssertTrue(capabilities.permissionGranted)
            XCTAssertTrue(capabilities.applicationRunning)
            XCTAssertTrue(capabilities.canListVisibleChats)
            XCTAssertTrue(capabilities.canReadVisibleChat)
            XCTAssertTrue(capabilities.canCreateNewChat)
            XCTAssertTrue(capabilities.canSelectVisibleChat)
            XCTAssertTrue(capabilities.canSendMessage)
        }

        let untrustedBackend = FakeDesktopChatAccessibilityBackend(
            trusted: false,
            roots: roots,
            nodes: fixture.nodes
        )
        let untrustedConnector = DesktopChatAccessibilityConnector(backend: untrustedBackend)
        let capabilities = try await untrustedConnector.capabilities(bundleIdentifier: codexBundleID)
        XCTAssertFalse(capabilities.permissionGranted)
        XCTAssertFalse(capabilities.canReadVisibleChat)
        do {
            _ = try await untrustedConnector.readVisibleChat(bundleIdentifier: codexBundleID)
            XCTFail("Read should fail without permission")
        } catch {
            XCTAssertEqual(error as? DesktopChatAccessibilityError, .permissionNotGranted)
        }
    }

    private func makeFixture() -> Fixture {
        let root = ref("root")
        let chatList = ref("chat-list")
        let chatOne = ref("chat-one")
        let chatTwo = ref("chat-two")
        let transcript = ref("transcript")
        let userMessage = ref("user-message")
        let userContent = ref("user-content")
        let userText = ref("user-text")
        let assistantMessage = ref("assistant-message")
        let assistantContent = ref("assistant-content")
        let assistantText = ref("assistant-text")
        let tool = ref("tool")
        let toolText = ref("tool-text")
        let newChat = ref("new-chat")
        let composer = ref("composer")
        let send = ref("send")
        let press: Set<String> = ["AXPress"]
        let nodes: [AccessibilityElementReference: FakeAccessibilityNode] = [
            root: FakeAccessibilityNode(
                role: "AXApplication",
                children: [chatList, transcript, newChat, composer, send]
            ),
            chatList: FakeAccessibilityNode(
                role: "AXList",
                identifier: "conversation-list",
                children: [chatOne, chatTwo]
            ),
            chatOne: FakeAccessibilityNode(
                role: "AXButton",
                identifier: "thread-item-1",
                description: "A private window title that must never be returned",
                selected: true,
                actions: press
            ),
            chatTwo: FakeAccessibilityNode(
                role: "AXButton",
                identifier: "thread-item-2",
                description: "/Users/example/private/path",
                actions: press
            ),
            transcript: FakeAccessibilityNode(
                role: "AXGroup",
                identifier: "thread-messages",
                children: [userMessage, assistantMessage]
            ),
            userMessage: FakeAccessibilityNode(
                role: "AXGroup",
                identifier: "user-message",
                children: [userContent]
            ),
            userContent: FakeAccessibilityNode(
                role: "AXGroup",
                identifier: "message-content",
                children: [userText]
            ),
            userText: FakeAccessibilityNode(role: "AXStaticText", text: "Please explain this code."),
            assistantMessage: FakeAccessibilityNode(
                role: "AXGroup",
                identifier: "assistant-message",
                children: [assistantContent]
            ),
            assistantContent: FakeAccessibilityNode(
                role: "AXGroup",
                identifier: "message-content",
                children: [assistantText, tool]
            ),
            assistantText: FakeAccessibilityNode(role: "AXStaticText", text: "Here is the visible answer."),
            tool: FakeAccessibilityNode(role: "AXGroup", identifier: "tool-call", children: [toolText]),
            toolText: FakeAccessibilityNode(role: "AXStaticText", text: "internal tool output /private/path"),
            newChat: FakeAccessibilityNode(role: "AXButton", identifier: "new-chat", actions: press),
            composer: FakeAccessibilityNode(role: "AXTextArea", identifier: "message-composer"),
            send: FakeAccessibilityNode(role: "AXButton", identifier: "send-message", actions: press)
        ]
        return Fixture(
            root: root,
            chatOne: chatOne,
            chatTwo: chatTwo,
            transcript: transcript,
            userMessage: userMessage,
            assistantMessage: assistantMessage,
            userText: userText,
            assistantText: assistantText,
            toolText: toolText,
            newChat: newChat,
            composer: composer,
            send: send,
            nodes: nodes
        )
    }

    private func ref(_ value: String) -> AccessibilityElementReference {
        AccessibilityElementReference(rawValue: value)
    }
}

private struct Fixture {
    let root: AccessibilityElementReference
    let chatOne: AccessibilityElementReference
    let chatTwo: AccessibilityElementReference
    let transcript: AccessibilityElementReference
    let userMessage: AccessibilityElementReference
    let assistantMessage: AccessibilityElementReference
    let userText: AccessibilityElementReference
    let assistantText: AccessibilityElementReference
    let toolText: AccessibilityElementReference
    let newChat: AccessibilityElementReference
    let composer: AccessibilityElementReference
    let send: AccessibilityElementReference
    var nodes: [AccessibilityElementReference: FakeAccessibilityNode]
}
