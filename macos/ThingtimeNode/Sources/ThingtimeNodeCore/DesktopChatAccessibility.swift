import AppKit
import ApplicationServices
import Foundation

public enum DesktopChatApplication: String, CaseIterable, Codable, Sendable {
    case codex = "com.openai.codex"
    case claudeDesktop = "com.anthropic.claudefordesktop"
    case claudeThingtime = "com.lopugit.claude-thingtime"
}

public struct AccessibilityElementReference: RawRepresentable, Hashable, Codable, Sendable {
    public let rawValue: String

    public init(rawValue: String) {
        self.rawValue = rawValue
    }
}

/// Metadata intentionally has no title, URL, document, filename, position, or
/// size field. The connector cannot accidentally expose information it never
/// asks the Accessibility process for.
public struct AccessibilityElementMetadata: Equatable, Sendable {
    public let role: String
    public let subrole: String?
    public let identifier: String?
    public let semanticDescription: String?
    public let isSelected: Bool
    public let isEnabled: Bool
    public let actions: Set<String>

    public init(
        role: String,
        subrole: String? = nil,
        identifier: String? = nil,
        semanticDescription: String? = nil,
        isSelected: Bool = false,
        isEnabled: Bool = true,
        actions: Set<String> = []
    ) {
        self.role = role
        self.subrole = subrole
        self.identifier = identifier
        self.semanticDescription = semanticDescription
        self.isSelected = isSelected
        self.isEnabled = isEnabled
        self.actions = actions
    }
}

public struct AccessibilityChildrenPage: Equatable, Sendable {
    public let elements: [AccessibilityElementReference]
    public let hasMore: Bool

    public init(elements: [AccessibilityElementReference], hasMore: Bool) {
        self.elements = elements
        self.hasMore = hasMore
    }
}

public struct AccessibilityTextValue: Equatable, Sendable {
    public let text: String
    public let wasTruncated: Bool

    public init(text: String, wasTruncated: Bool = false) {
        self.text = text
        self.wasTruncated = wasTruncated
    }
}

/// A narrow, injectable AX boundary. Implementations must return only visible
/// children. Text is a separate operation so traversal never reads text from
/// window chrome, sidebars, tool panels, or unrelated controls.
public protocol DesktopChatAccessibilityBackend: Sendable {
    func preflightTrusted() async -> Bool
    func applicationElement(bundleIdentifier: String) async throws -> AccessibilityElementReference?
    func metadata(for element: AccessibilityElementReference) async throws -> AccessibilityElementMetadata
    func visibleChildren(
        of element: AccessibilityElementReference,
        maximumCount: Int
    ) async throws -> AccessibilityChildrenPage
    func visibleText(
        of element: AccessibilityElementReference,
        maximumUTF8Bytes: Int
    ) async throws -> AccessibilityTextValue?
    func press(_ element: AccessibilityElementReference) async throws
    func setText(_ text: String, on element: AccessibilityElementReference) async throws
}

public enum DesktopChatAccessibilityError: Error, Equatable, LocalizedError {
    case unsupportedApplication(String)
    case permissionNotGranted
    case applicationNotRunning(String)
    case selectorDrift(String)
    case ambiguousSelector(String)
    case traversalLimitExceeded(String)
    case sessionLocked
    case explicitApprovalRequired
    case invalidMessage(String)
    case actionUnavailable(String)
    case backendFailure(String)

    public var errorDescription: String? {
        switch self {
        case let .unsupportedApplication(bundleIdentifier):
            "Accessibility chat control is not allowlisted for \(bundleIdentifier)."
        case .permissionNotGranted:
            "Accessibility permission is not granted."
        case let .applicationNotRunning(bundleIdentifier):
            "The allowlisted application \(bundleIdentifier) is not running."
        case let .selectorDrift(capability):
            "The visible accessibility structure no longer matches the \(capability) profile."
        case let .ambiguousSelector(capability):
            "More than one visible accessibility element matched \(capability); refusing to guess."
        case let .traversalLimitExceeded(limit):
            "Accessibility traversal exceeded the \(limit) limit."
        case .sessionLocked:
            "Desktop chat mutations are disabled while the user session is locked."
        case .explicitApprovalRequired:
            "Desktop chat mutations require explicit approval."
        case let .invalidMessage(message):
            message
        case let .actionUnavailable(capability):
            "The visible accessibility element cannot perform \(capability)."
        case let .backendFailure(operation):
            "The Accessibility backend failed during \(operation)."
        }
    }
}

public struct DesktopChatTraversalLimits: Equatable, Sendable {
    public let maximumDepth: Int
    public let maximumNodes: Int
    public let maximumChildrenPerNode: Int
    public let maximumChats: Int
    public let maximumMessages: Int
    public let maximumTextBytesPerMessage: Int
    public let maximumTextBytesPerConversation: Int
    public let maximumMutationTextBytes: Int

    public init(
        maximumDepth: Int = 14,
        maximumNodes: Int = 1_024,
        maximumChildrenPerNode: Int = 128,
        maximumChats: Int = 100,
        maximumMessages: Int = 200,
        maximumTextBytesPerMessage: Int = 32_768,
        maximumTextBytesPerConversation: Int = 262_144,
        maximumMutationTextBytes: Int = 32_768
    ) {
        self.maximumDepth = min(max(1, maximumDepth), 32)
        self.maximumNodes = min(max(1, maximumNodes), 4_096)
        self.maximumChildrenPerNode = min(max(1, maximumChildrenPerNode), 256)
        self.maximumChats = min(max(1, maximumChats), 200)
        self.maximumMessages = min(max(1, maximumMessages), 500)
        self.maximumTextBytesPerMessage = min(max(16, maximumTextBytesPerMessage), 65_536)
        self.maximumTextBytesPerConversation = min(max(16, maximumTextBytesPerConversation), 1_048_576)
        self.maximumMutationTextBytes = min(max(1, maximumMutationTextBytes), 65_536)
    }
}

public struct DesktopChatMutationAuthorization: Equatable, Sendable {
    public let sessionLocked: Bool
    public let explicitlyApproved: Bool

    public init(sessionLocked: Bool, explicitlyApproved: Bool) {
        self.sessionLocked = sessionLocked
        self.explicitlyApproved = explicitlyApproved
    }
}

public struct DesktopChatAccessibilityCapabilities: Codable, Equatable, Sendable {
    public let bundleIdentifier: String
    public let permissionGranted: Bool
    public let applicationRunning: Bool
    public let canListVisibleChats: Bool
    public let canReadVisibleChat: Bool
    public let canCreateNewChat: Bool
    public let canSelectVisibleChat: Bool
    public let canSendMessage: Bool

    public init(bundleIdentifier: String, permissionGranted: Bool, applicationRunning: Bool) {
        self.bundleIdentifier = bundleIdentifier
        self.permissionGranted = permissionGranted
        self.applicationRunning = applicationRunning
        let available = permissionGranted && applicationRunning
        self.canListVisibleChats = available
        self.canReadVisibleChat = available
        self.canCreateNewChat = available
        self.canSelectVisibleChat = available
        self.canSendMessage = available
    }
}

public struct DesktopVisibleChat: Codable, Equatable, Sendable {
    /// Opaque AX selection token. No window title, chat title, path, or preview
    /// text is returned by the listing API.
    public let selectionToken: String
    public let isSelected: Bool

    public init(selectionToken: String, isSelected: Bool) {
        self.selectionToken = selectionToken
        self.isSelected = isSelected
    }
}

public enum DesktopVisibleMessageRole: String, Codable, Equatable, Sendable {
    case user
    case assistant
}

public struct DesktopVisibleMessage: Codable, Equatable, Sendable {
    /// Opaque reference to the visible message element. The runtime hashes it
    /// before anything crosses the device boundary, so streaming updates can
    /// retain identity without exposing AX internals.
    public let opaqueToken: String
    public let role: DesktopVisibleMessageRole
    public let text: String

    public init(opaqueToken: String = "", role: DesktopVisibleMessageRole, text: String) {
        self.opaqueToken = opaqueToken
        self.role = role
        self.text = text
    }
}

public struct DesktopVisibleConversation: Codable, Equatable, Sendable {
    public let messages: [DesktopVisibleMessage]

    public init(messages: [DesktopVisibleMessage]) {
        self.messages = messages
    }
}

private struct SemanticSelector: Sendable {
    let roles: Set<String>
    let exactTokens: Set<String>
    let identifierPrefixes: [String]

    init(roles: [String], exactTokens: [String], identifierPrefixes: [String] = []) {
        self.roles = Set(roles.map(Self.normalize))
        self.exactTokens = Set(exactTokens.map(Self.normalize))
        self.identifierPrefixes = identifierPrefixes.map(Self.normalize)
    }

    func matches(_ metadata: AccessibilityElementMetadata) -> Bool {
        let role = Self.normalize(metadata.role)
        guard roles.isEmpty || roles.contains(role) else { return false }
        let identifier = metadata.identifier.map(Self.normalize)
        let description = metadata.semanticDescription.map(Self.normalize)
        if exactTokens.isEmpty { return true }
        if let identifier, exactTokens.contains(identifier) { return true }
        if let description, exactTokens.contains(description) { return true }
        if let identifier, identifierPrefixes.contains(where: { identifier.hasPrefix($0) }) { return true }
        return false
    }

    static func normalize(_ value: String) -> String {
        var result = ""
        var needsSeparator = false
        for scalar in value.lowercased().unicodeScalars {
            if CharacterSet.alphanumerics.contains(scalar) {
                if needsSeparator, !result.isEmpty { result.append("-") }
                result.unicodeScalars.append(scalar)
                needsSeparator = false
            } else {
                needsSeparator = true
            }
        }
        return result
    }
}

private struct DesktopChatSemanticProfile: Sendable {
    let bundleIdentifier: String
    let chatList: SemanticSelector
    let chatItem: SemanticSelector
    let transcript: SemanticSelector
    let userMessage: SemanticSelector
    let assistantMessage: SemanticSelector
    let messageContent: SemanticSelector
    let newChat: SemanticSelector
    let composer: SemanticSelector
    let sendMessage: SemanticSelector
    let excludedContent: SemanticSelector

    static func profile(for bundleIdentifier: String) throws -> DesktopChatSemanticProfile {
        switch DesktopChatApplication(rawValue: bundleIdentifier) {
        case .codex:
            return make(
                bundleIdentifier: bundleIdentifier,
                chatLists: ["conversation-list", "chat-list", "thread-list", "sidebar-chats"],
                chatItemPrefixes: ["conversation-item-", "chat-item-", "thread-item-"],
                transcripts: ["chat-transcript", "conversation-messages", "thread-messages", "message-list"],
                userMessages: ["user-message", "message-user"],
                assistantMessages: ["assistant-message", "message-assistant", "codex-message"],
                composers: ["message-composer", "prompt-input", "chat-input"]
            )
        case .claudeDesktop, .claudeThingtime:
            return make(
                bundleIdentifier: bundleIdentifier,
                chatLists: ["conversation-list", "chat-list", "recent-chats"],
                chatItemPrefixes: ["conversation-item-", "chat-item-"],
                transcripts: ["chat-transcript", "conversation-messages", "message-list"],
                userMessages: ["user-message", "human-message", "message-human"],
                assistantMessages: ["assistant-message", "message-assistant", "claude-message"],
                composers: ["message-composer", "prompt-input", "chat-input"]
            )
        case nil:
            throw DesktopChatAccessibilityError.unsupportedApplication(bundleIdentifier)
        }
    }

    private static func make(
        bundleIdentifier: String,
        chatLists: [String],
        chatItemPrefixes: [String],
        transcripts: [String],
        userMessages: [String],
        assistantMessages: [String],
        composers: [String]
    ) -> DesktopChatSemanticProfile {
        DesktopChatSemanticProfile(
            bundleIdentifier: bundleIdentifier,
            chatList: SemanticSelector(roles: ["AXList", "AXGroup", "AXOutline"], exactTokens: chatLists),
            chatItem: SemanticSelector(
                roles: ["AXButton", "AXRow", "AXGroup"],
                exactTokens: ["conversation-item", "chat-item", "thread-item"],
                identifierPrefixes: chatItemPrefixes
            ),
            transcript: SemanticSelector(roles: ["AXList", "AXGroup", "AXScrollArea"], exactTokens: transcripts),
            userMessage: SemanticSelector(roles: ["AXGroup", "AXListItem"], exactTokens: userMessages),
            assistantMessage: SemanticSelector(roles: ["AXGroup", "AXListItem"], exactTokens: assistantMessages),
            messageContent: SemanticSelector(
                roles: ["AXGroup", "AXStaticText"],
                exactTokens: ["message-content", "user-message-content", "assistant-message-content", "markdown-content"]
            ),
            newChat: SemanticSelector(roles: ["AXButton"], exactTokens: ["new-chat", "new-conversation"]),
            composer: SemanticSelector(roles: ["AXTextArea", "AXTextField"], exactTokens: composers),
            sendMessage: SemanticSelector(roles: ["AXButton"], exactTokens: ["send-message", "send"]),
            excludedContent: SemanticSelector(
                roles: [],
                exactTokens: [
                    "tool", "tool-call", "tool-result", "tool-output", "reasoning", "thinking",
                    "terminal", "command-output", "attachment", "file-attachment", "path", "window-title"
                ],
                identifierPrefixes: ["tool-", "reasoning-", "attachment-", "file-path-"]
            )
        )
    }
}

private struct TraversedAccessibilityNode: Sendable {
    let metadata: AccessibilityElementMetadata
    let children: [AccessibilityElementReference]
}

private struct TraversedAccessibilityTree: Sendable {
    let root: AccessibilityElementReference
    let nodes: [AccessibilityElementReference: TraversedAccessibilityNode]
    let order: [AccessibilityElementReference]

    func descendants(of root: AccessibilityElementReference, includeRoot: Bool = false) -> [AccessibilityElementReference] {
        var result: [AccessibilityElementReference] = includeRoot ? [root] : []
        var stack = Array((nodes[root]?.children ?? []).reversed())
        var seen: Set<AccessibilityElementReference> = [root]
        while let current = stack.popLast() {
            guard seen.insert(current).inserted else { continue }
            result.append(current)
            if let children = nodes[current]?.children {
                stack.append(contentsOf: children.reversed())
            }
        }
        return result
    }
}

public actor DesktopChatAccessibilityConnector {
    private let backend: any DesktopChatAccessibilityBackend
    private let limits: DesktopChatTraversalLimits

    public init(
        backend: any DesktopChatAccessibilityBackend,
        limits: DesktopChatTraversalLimits = DesktopChatTraversalLimits()
    ) {
        self.backend = backend
        self.limits = limits
    }

    public func capabilities(bundleIdentifier: String) async throws -> DesktopChatAccessibilityCapabilities {
        _ = try DesktopChatSemanticProfile.profile(for: bundleIdentifier)
        let trusted = await backend.preflightTrusted()
        let running: Bool
        do {
            running = try await backend.applicationElement(bundleIdentifier: bundleIdentifier) != nil
        } catch {
            running = false
        }
        return DesktopChatAccessibilityCapabilities(
            bundleIdentifier: bundleIdentifier,
            permissionGranted: trusted,
            applicationRunning: running
        )
    }

    public func listVisibleChats(bundleIdentifier: String) async throws -> [DesktopVisibleChat] {
        let profile = try DesktopChatSemanticProfile.profile(for: bundleIdentifier)
        let tree = try await traverseVisibleTree(profile: profile)
        let list = try uniqueMatch(profile.chatList, in: tree.order, tree: tree, capability: "visible chat list")
        let items = tree.descendants(of: list).filter {
            tree.nodes[$0].map { profile.chatItem.matches($0.metadata) } ?? false
        }
        guard items.count <= limits.maximumChats else {
            throw DesktopChatAccessibilityError.traversalLimitExceeded("visible chat count")
        }
        return items.map {
            DesktopVisibleChat(selectionToken: $0.rawValue, isSelected: tree.nodes[$0]?.metadata.isSelected ?? false)
        }
    }

    public func readVisibleChat(bundleIdentifier: String) async throws -> DesktopVisibleConversation {
        let profile = try DesktopChatSemanticProfile.profile(for: bundleIdentifier)
        let tree = try await traverseVisibleTree(profile: profile)
        let transcript = try uniqueMatch(profile.transcript, in: tree.order, tree: tree, capability: "visible transcript")
        var classified: [(AccessibilityElementReference, DesktopVisibleMessageRole)] = []
        for reference in tree.descendants(of: transcript) {
            guard let metadata = tree.nodes[reference]?.metadata else { continue }
            let isUser = profile.userMessage.matches(metadata)
            let isAssistant = profile.assistantMessage.matches(metadata)
            if isUser && isAssistant {
                throw DesktopChatAccessibilityError.ambiguousSelector("message role")
            }
            if isUser { classified.append((reference, .user)) }
            if isAssistant { classified.append((reference, .assistant)) }
        }
        guard classified.count <= limits.maximumMessages else {
            throw DesktopChatAccessibilityError.traversalLimitExceeded("visible message count")
        }

        var messages: [DesktopVisibleMessage] = []
        var conversationBytes = 0
        for (message, role) in classified {
            let candidates = tree.descendants(of: message, includeRoot: true).filter {
                tree.nodes[$0].map { profile.messageContent.matches($0.metadata) } ?? false
            }
            guard candidates.count == 1, let content = candidates.first else {
                if candidates.count > 1 {
                    throw DesktopChatAccessibilityError.ambiguousSelector("message content")
                }
                throw DesktopChatAccessibilityError.selectorDrift("message content")
            }
            let text = try await extractVisibleMessageText(content: content, profile: profile, tree: tree)
            guard !text.isEmpty else { continue }
            conversationBytes += text.utf8.count
            guard conversationBytes <= limits.maximumTextBytesPerConversation else {
                throw DesktopChatAccessibilityError.traversalLimitExceeded("conversation text")
            }
            messages.append(DesktopVisibleMessage(opaqueToken: message.rawValue, role: role, text: text))
        }
        return DesktopVisibleConversation(messages: messages)
    }

    public func createNewChat(
        bundleIdentifier: String,
        authorization: DesktopChatMutationAuthorization
    ) async throws {
        try authorizeMutation(authorization)
        let profile = try DesktopChatSemanticProfile.profile(for: bundleIdentifier)
        let tree = try await traverseVisibleTree(profile: profile)
        let button = try uniqueMatch(profile.newChat, in: tree.order, tree: tree, capability: "new chat")
        try requirePressAction(button, tree: tree, capability: "new chat")
        try await translateBackendFailure("new chat") { try await backend.press(button) }
    }

    public func selectVisibleChat(
        bundleIdentifier: String,
        selectionToken: String,
        authorization: DesktopChatMutationAuthorization
    ) async throws {
        try authorizeMutation(authorization)
        guard !selectionToken.isEmpty, selectionToken.utf8.count <= 512 else {
            throw DesktopChatAccessibilityError.invalidMessage("The visible chat selection token is invalid.")
        }
        let profile = try DesktopChatSemanticProfile.profile(for: bundleIdentifier)
        let tree = try await traverseVisibleTree(profile: profile)
        let list = try uniqueMatch(profile.chatList, in: tree.order, tree: tree, capability: "visible chat list")
        let matches = tree.descendants(of: list).filter {
            $0.rawValue == selectionToken && (tree.nodes[$0].map { profile.chatItem.matches($0.metadata) } ?? false)
        }
        guard matches.count == 1, let chat = matches.first else {
            if matches.count > 1 { throw DesktopChatAccessibilityError.ambiguousSelector("visible chat selection") }
            throw DesktopChatAccessibilityError.selectorDrift("visible chat selection")
        }
        try requirePressAction(chat, tree: tree, capability: "visible chat selection")
        try await translateBackendFailure("visible chat selection") { try await backend.press(chat) }
    }

    public func sendMessage(
        bundleIdentifier: String,
        text: String,
        authorization: DesktopChatMutationAuthorization
    ) async throws {
        try authorizeMutation(authorization)
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            throw DesktopChatAccessibilityError.invalidMessage("A message cannot be empty.")
        }
        guard text.utf8.count <= limits.maximumMutationTextBytes else {
            throw DesktopChatAccessibilityError.invalidMessage("The message exceeds the mutation text limit.")
        }
        let profile = try DesktopChatSemanticProfile.profile(for: bundleIdentifier)
        let tree = try await traverseVisibleTree(profile: profile)
        let composer = try uniqueMatch(profile.composer, in: tree.order, tree: tree, capability: "message composer")
        let sendButton = try uniqueMatch(profile.sendMessage, in: tree.order, tree: tree, capability: "send message")
        guard tree.nodes[composer]?.metadata.isEnabled == true else {
            throw DesktopChatAccessibilityError.actionUnavailable("message composer")
        }
        try requirePressAction(sendButton, tree: tree, capability: "send message")
        do {
            try await backend.setText(text, on: composer)
            try await backend.press(sendButton)
        } catch {
            // The composer may have accepted text or the application may have
            // received the press. The caller's command journal must reconcile
            // this outcome rather than issuing an automatic duplicate.
            throw DesktopChatAccessibilityError.backendFailure("send message; delivery outcome may be uncertain")
        }
    }

    private func authorizeMutation(_ authorization: DesktopChatMutationAuthorization) throws {
        guard !authorization.sessionLocked else { throw DesktopChatAccessibilityError.sessionLocked }
        guard authorization.explicitlyApproved else { throw DesktopChatAccessibilityError.explicitApprovalRequired }
    }

    private func traverseVisibleTree(profile: DesktopChatSemanticProfile) async throws -> TraversedAccessibilityTree {
        guard await backend.preflightTrusted() else { throw DesktopChatAccessibilityError.permissionNotGranted }
        let root: AccessibilityElementReference
        do {
            guard let application = try await backend.applicationElement(bundleIdentifier: profile.bundleIdentifier) else {
                throw DesktopChatAccessibilityError.applicationNotRunning(profile.bundleIdentifier)
            }
            root = application
        } catch let error as DesktopChatAccessibilityError {
            throw error
        } catch {
            throw DesktopChatAccessibilityError.backendFailure("application lookup")
        }

        var queue: [(AccessibilityElementReference, Int)] = [(root, 0)]
        var queued: Set<AccessibilityElementReference> = [root]
        var nodes: [AccessibilityElementReference: TraversedAccessibilityNode] = [:]
        var order: [AccessibilityElementReference] = []
        var index = 0
        while index < queue.count {
            guard nodes.count < limits.maximumNodes else {
                throw DesktopChatAccessibilityError.traversalLimitExceeded("node count")
            }
            let (reference, depth) = queue[index]
            index += 1
            let metadata: AccessibilityElementMetadata
            let page: AccessibilityChildrenPage
            do {
                metadata = try await backend.metadata(for: reference)
                page = try await backend.visibleChildren(
                    of: reference,
                    maximumCount: limits.maximumChildrenPerNode
                )
            } catch let error as DesktopChatAccessibilityError {
                throw error
            } catch {
                throw DesktopChatAccessibilityError.backendFailure("bounded visible traversal")
            }
            guard !page.hasMore else {
                throw DesktopChatAccessibilityError.traversalLimitExceeded("children per element")
            }
            guard depth < limits.maximumDepth || page.elements.isEmpty else {
                throw DesktopChatAccessibilityError.traversalLimitExceeded("depth")
            }
            nodes[reference] = TraversedAccessibilityNode(metadata: metadata, children: page.elements)
            order.append(reference)
            for child in page.elements where queued.insert(child).inserted {
                queue.append((child, depth + 1))
            }
        }
        return TraversedAccessibilityTree(root: root, nodes: nodes, order: order)
    }

    private func uniqueMatch(
        _ selector: SemanticSelector,
        in references: [AccessibilityElementReference],
        tree: TraversedAccessibilityTree,
        capability: String
    ) throws -> AccessibilityElementReference {
        let matches = references.filter {
            tree.nodes[$0].map { selector.matches($0.metadata) } ?? false
        }
        guard matches.count == 1, let match = matches.first else {
            if matches.count > 1 { throw DesktopChatAccessibilityError.ambiguousSelector(capability) }
            throw DesktopChatAccessibilityError.selectorDrift(capability)
        }
        return match
    }

    private func requirePressAction(
        _ reference: AccessibilityElementReference,
        tree: TraversedAccessibilityTree,
        capability: String
    ) throws {
        guard let metadata = tree.nodes[reference]?.metadata,
              metadata.isEnabled,
              metadata.actions.contains(kAXPressAction as String) else {
            throw DesktopChatAccessibilityError.actionUnavailable(capability)
        }
    }

    private func extractVisibleMessageText(
        content: AccessibilityElementReference,
        profile: DesktopChatSemanticProfile,
        tree: TraversedAccessibilityTree
    ) async throws -> String {
        var pieces: [String] = []
        var bytes = 0
        var stack: [AccessibilityElementReference] = [content]
        var seen: Set<AccessibilityElementReference> = []
        while let reference = stack.popLast() {
            guard seen.insert(reference).inserted, let node = tree.nodes[reference] else { continue }
            if reference != content, profile.excludedContent.matches(node.metadata) {
                continue
            }
            if SemanticSelector.normalize(node.metadata.role) == SemanticSelector.normalize(kAXStaticTextRole as String) {
                let remaining = limits.maximumTextBytesPerMessage - bytes
                guard remaining > 0 else {
                    throw DesktopChatAccessibilityError.traversalLimitExceeded("message text")
                }
                let value: AccessibilityTextValue?
                do {
                    value = try await backend.visibleText(of: reference, maximumUTF8Bytes: remaining)
                } catch {
                    throw DesktopChatAccessibilityError.backendFailure("visible message text")
                }
                guard let value else { continue }
                guard !value.wasTruncated else {
                    throw DesktopChatAccessibilityError.traversalLimitExceeded("message text")
                }
                let normalized = value.text.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !normalized.isEmpty else { continue }
                bytes += normalized.utf8.count
                guard bytes <= limits.maximumTextBytesPerMessage else {
                    throw DesktopChatAccessibilityError.traversalLimitExceeded("message text")
                }
                if pieces.last != normalized { pieces.append(normalized) }
            }
            stack.append(contentsOf: node.children.reversed())
        }
        return pieces.joined(separator: "\n")
    }

    private func translateBackendFailure(
        _ operation: String,
        body: () async throws -> Void
    ) async throws {
        do {
            try await body()
        } catch let error as DesktopChatAccessibilityError {
            throw error
        } catch {
            throw DesktopChatAccessibilityError.backendFailure(operation)
        }
    }
}

/// Public macOS backend using only documented AX APIs. It never calls a TCC
/// request function; `AXIsProcessTrusted()` is a read-only preflight.
public actor SystemDesktopChatAccessibilityBackend: DesktopChatAccessibilityBackend {
    private var elements: [AccessibilityElementReference: AXUIElement] = [:]
    private var processIdentifier: pid_t = 0

    public init() {}

    public func preflightTrusted() async -> Bool {
        AXIsProcessTrusted()
    }

    public func applicationElement(bundleIdentifier: String) async throws -> AccessibilityElementReference? {
        guard DesktopChatApplication(rawValue: bundleIdentifier) != nil else {
            throw DesktopChatAccessibilityError.unsupportedApplication(bundleIdentifier)
        }
        let pid = await MainActor.run {
            NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier).first?.processIdentifier
        }
        guard let pid else { return nil }
        processIdentifier = pid
        elements.removeAll(keepingCapacity: true)
        return store(AXUIElementCreateApplication(pid))
    }

    public func metadata(for reference: AccessibilityElementReference) async throws -> AccessibilityElementMetadata {
        let element = try resolve(reference)
        return AccessibilityElementMetadata(
            role: try stringAttribute(kAXRoleAttribute as CFString, element: element) ?? "",
            subrole: try stringAttribute(kAXSubroleAttribute as CFString, element: element),
            identifier: try stringAttribute(kAXIdentifierAttribute as CFString, element: element),
            semanticDescription: try stringAttribute(kAXDescriptionAttribute as CFString, element: element),
            isSelected: try boolAttribute(kAXSelectedAttribute as CFString, element: element) ?? false,
            isEnabled: try boolAttribute(kAXEnabledAttribute as CFString, element: element) ?? true,
            actions: try actionNames(element)
        )
    }

    public func visibleChildren(
        of reference: AccessibilityElementReference,
        maximumCount: Int
    ) async throws -> AccessibilityChildrenPage {
        let element = try resolve(reference)
        let children: [AXUIElement]
        if let visible = try arrayAttribute(kAXVisibleChildrenAttribute as CFString, element: element) {
            children = visible
        } else if let all = try arrayAttribute(kAXChildrenAttribute as CFString, element: element) {
            // Fallback remains fail-closed: retain only children that explicitly
            // report they are not hidden. Unknown visibility is not traversed.
            children = try all.filter { try boolAttribute(kAXHiddenAttribute as CFString, element: $0) == false }
        } else if let windows = try arrayAttribute(kAXWindowsAttribute as CFString, element: element) {
            children = try windows.filter {
                try boolAttribute(kAXMinimizedAttribute as CFString, element: $0) == false
                    && boolAttribute(kAXHiddenAttribute as CFString, element: $0) != true
            }
        } else {
            children = []
        }
        let bounded = children.prefix(maximumCount).map(store)
        return AccessibilityChildrenPage(elements: Array(bounded), hasMore: children.count > maximumCount)
    }

    public func visibleText(
        of reference: AccessibilityElementReference,
        maximumUTF8Bytes: Int
    ) async throws -> AccessibilityTextValue? {
        let element = try resolve(reference)
        guard try stringAttribute(kAXRoleAttribute as CFString, element: element) == kAXStaticTextRole as String else {
            return nil
        }
        var raw: CFTypeRef?
        let status = AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &raw)
        if status == .noValue || status == .attributeUnsupported { return nil }
        guard status == .success else { throw DesktopChatAccessibilityError.backendFailure("visible text") }
        guard let text = raw as? String else { return nil }
        guard text.utf8.count <= maximumUTF8Bytes else {
            return AccessibilityTextValue(text: "", wasTruncated: true)
        }
        return AccessibilityTextValue(text: text)
    }

    public func press(_ reference: AccessibilityElementReference) async throws {
        let element = try resolve(reference)
        guard try actionNames(element).contains(kAXPressAction as String) else {
            throw DesktopChatAccessibilityError.actionUnavailable("press")
        }
        guard AXUIElementPerformAction(element, kAXPressAction as CFString) == .success else {
            throw DesktopChatAccessibilityError.backendFailure("press")
        }
    }

    public func setText(_ text: String, on reference: AccessibilityElementReference) async throws {
        let element = try resolve(reference)
        let role = try stringAttribute(kAXRoleAttribute as CFString, element: element)
        guard role == kAXTextAreaRole as String || role == kAXTextFieldRole as String else {
            throw DesktopChatAccessibilityError.actionUnavailable("set message text")
        }
        let subrole = try stringAttribute(kAXSubroleAttribute as CFString, element: element)
        guard subrole != "AXSecureTextField" else {
            throw DesktopChatAccessibilityError.actionUnavailable("set message text")
        }
        guard AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, text as CFTypeRef) == .success else {
            throw DesktopChatAccessibilityError.backendFailure("set message text")
        }
    }

    private func resolve(_ reference: AccessibilityElementReference) throws -> AXUIElement {
        guard let element = elements[reference] else {
            throw DesktopChatAccessibilityError.backendFailure("element resolution")
        }
        return element
    }

    private func store(_ element: AXUIElement) -> AccessibilityElementReference {
        let base = "ax:\(processIdentifier):\(CFHash(element))"
        var raw = base
        var suffix = 0
        while let existing = elements[AccessibilityElementReference(rawValue: raw)], !CFEqual(existing, element) {
            suffix += 1
            raw = "\(base):\(suffix)"
        }
        let reference = AccessibilityElementReference(rawValue: raw)
        elements[reference] = element
        return reference
    }

    private func stringAttribute(_ attribute: CFString, element: AXUIElement) throws -> String? {
        var raw: CFTypeRef?
        let status = AXUIElementCopyAttributeValue(element, attribute, &raw)
        if status == .noValue || status == .attributeUnsupported { return nil }
        guard status == .success else { throw DesktopChatAccessibilityError.backendFailure("semantic metadata") }
        guard let value = raw as? String, value.utf8.count <= 512 else { return nil }
        return value
    }

    private func boolAttribute(_ attribute: CFString, element: AXUIElement) throws -> Bool? {
        var raw: CFTypeRef?
        let status = AXUIElementCopyAttributeValue(element, attribute, &raw)
        if status == .noValue || status == .attributeUnsupported { return nil }
        guard status == .success else { throw DesktopChatAccessibilityError.backendFailure("semantic state") }
        return raw as? Bool
    }

    private func arrayAttribute(_ attribute: CFString, element: AXUIElement) throws -> [AXUIElement]? {
        var raw: CFTypeRef?
        let status = AXUIElementCopyAttributeValue(element, attribute, &raw)
        if status == .noValue || status == .attributeUnsupported { return nil }
        guard status == .success else { throw DesktopChatAccessibilityError.backendFailure("visible children") }
        return raw as? [AXUIElement]
    }

    private func actionNames(_ element: AXUIElement) throws -> Set<String> {
        var raw: CFArray?
        let status = AXUIElementCopyActionNames(element, &raw)
        if status == .noValue || status == .actionUnsupported || status == .attributeUnsupported { return [] }
        guard status == .success else { throw DesktopChatAccessibilityError.backendFailure("semantic actions") }
        let names = (raw as? [String]) ?? []
        guard names.count <= 32 else { throw DesktopChatAccessibilityError.traversalLimitExceeded("actions per element") }
        return Set(names)
    }
}
