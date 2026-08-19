import CryptoKit
import Foundation

public protocol DesktopChatCommanding: Sendable {
    func capabilities(bundleIdentifier: String) async throws -> DesktopChatAccessibilityCapabilities
    func listVisibleChats(bundleIdentifier: String) async throws -> [DesktopVisibleChat]
    func readVisibleChat(bundleIdentifier: String) async throws -> DesktopVisibleConversation
    func createNewChat(
        bundleIdentifier: String,
        authorization: DesktopChatMutationAuthorization
    ) async throws
    func selectVisibleChat(
        bundleIdentifier: String,
        selectionToken: String,
        authorization: DesktopChatMutationAuthorization
    ) async throws
    func sendMessage(
        bundleIdentifier: String,
        text: String,
        authorization: DesktopChatMutationAuthorization
    ) async throws
}

extension DesktopChatAccessibilityConnector: DesktopChatCommanding {}

public struct DesktopChatRuntimeConnector: Codable, Equatable, Sendable {
    public let id: String
    public let kind: String
    public let label: String
    public let status: String
    public let capabilities: [String]
    public let projects: [ConnectorProjectReference]

    public init(
        id: String,
        kind: String,
        label: String,
        status: String,
        capabilities: [String],
        projects: [ConnectorProjectReference] = []
    ) {
        self.id = id
        self.kind = kind
        self.label = label
        self.status = status
        self.capabilities = capabilities
        self.projects = projects
    }
}

public struct DesktopChatCommand: Equatable, Sendable {
    public let connectorID: String
    public let operation: String
    public let payload: JSONValue
    public let commandID: String
    public let sessionLocked: Bool
    public let explicitlyApproved: Bool

    public init(
        connectorID: String,
        operation: String,
        payload: JSONValue,
        commandID: String,
        sessionLocked: Bool,
        explicitlyApproved: Bool
    ) {
        self.connectorID = connectorID
        self.operation = operation
        self.payload = payload
        self.commandID = commandID
        self.sessionLocked = sessionLocked
        self.explicitlyApproved = explicitlyApproved
    }
}

/// Adapts the narrow semantic Accessibility connector to the node's closed
/// session command vocabulary. It intentionally exposes no window titles,
/// paths, coordinates, cookies, private app stores, or arbitrary AX actions.
public actor DesktopChatRuntime {
    public static let chatGPTConnectorID = "chatgpt-desktop-accessibility"
    public static let claudeConnectorID = "claude-desktop-accessibility"
    public static let claudeThingtimeConnectorID = "claude-thingtime-accessibility"

    private struct Profile: Sendable {
        let connectorID: String
        let application: DesktopChatApplication
        let kind: String
        let label: String
    }

    private static let profiles = [
        Profile(
            connectorID: chatGPTConnectorID,
            application: .codex,
            kind: "chatgpt-desktop",
            label: "ChatGPT Desktop"
        ),
        Profile(
            connectorID: claudeConnectorID,
            application: .claudeDesktop,
            kind: "claude-desktop",
            label: "Claude Desktop"
        ),
        Profile(
            connectorID: claudeThingtimeConnectorID,
            application: .claudeThingtime,
            kind: "claude-thingtime",
            label: "Claude Thingtime"
        )
    ]

    private static let capabilityNames = [
        "read-history", "create-session", "send-message", "accessibility", "explicit-approval"
    ]

    private struct ObservedMessage: Sendable {
        let role: DesktopVisibleMessageRole
        var text: String
        var itemID: String
        var generation: Int
        var unchangedPolls: Int
        var completed: Bool
        var turnID: String?
    }

    private struct ActiveSession: Sendable {
        let sessionID: String
        var messages: [String: ObservedMessage]
        var pendingRemoteEchoes: [String]
        var pendingTurnID: String?
    }

    private let connector: any DesktopChatCommanding
    private var activeSessions: [String: ActiveSession] = [:]
    private var eventContinuations: [UUID: AsyncStream<ConnectorEvent>.Continuation] = [:]
    private var monitoringTask: Task<Void, Never>?

    public init(connector: any DesktopChatCommanding) {
        self.connector = connector
    }

    public func events() -> AsyncStream<ConnectorEvent> {
        let identifier = UUID()
        return AsyncStream(bufferingPolicy: .bufferingNewest(512)) { continuation in
            eventContinuations[identifier] = continuation
            continuation.onTermination = { [weak self] _ in
                Task { await self?.removeEventContinuation(identifier) }
            }
        }
    }

    public func startMonitoring(intervalSeconds: Double = 2) {
        guard monitoringTask == nil else { return }
        let boundedInterval = min(max(intervalSeconds, 0.5), 10)
        monitoringTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.pollActiveSessionsOnce()
                do {
                    try await Task.sleep(for: .seconds(boundedInterval))
                } catch {
                    return
                }
            }
        }
    }

    public func stopMonitoring(clearSessions: Bool = false) {
        monitoringTask?.cancel()
        monitoringTask = nil
        if clearSessions { activeSessions.removeAll(keepingCapacity: false) }
    }

    public func clearActiveSessions() {
        activeSessions.removeAll(keepingCapacity: false)
    }

    public nonisolated static func supports(connectorID: String) -> Bool {
        profiles.contains { $0.connectorID == connectorID }
    }

    public func connectorStates() async -> [DesktopChatRuntimeConnector] {
        var values: [DesktopChatRuntimeConnector] = []
        for profile in Self.profiles {
            let status: String
            do {
                let current = try await connector.capabilities(bundleIdentifier: profile.application.rawValue)
                if !current.permissionGranted {
                    status = "needs-permission"
                } else if current.applicationRunning {
                    status = "connected"
                } else {
                    status = "disconnected"
                }
            } catch {
                status = "degraded"
            }
            values.append(DesktopChatRuntimeConnector(
                id: profile.connectorID,
                kind: profile.kind,
                label: profile.label,
                status: status,
                capabilities: Self.capabilityNames
            ))
        }
        return values
    }

    public func execute(_ command: DesktopChatCommand) async throws -> JSONValue {
        let profile = try Self.profile(connectorID: command.connectorID)
        let payload = try requireObject(command.payload)
        switch command.operation {
        case "session.list":
            let chats = try await translateAccessibilityError {
                try await connector.listVisibleChats(bundleIdentifier: profile.application.rawValue)
            }
            let sessions = chats.enumerated().map { index, chat in
                sessionSummary(
                    connectorID: profile.connectorID,
                    sessionID: chat.selectionToken,
                    ordinal: index + 1,
                    selected: chat.isSelected
                )
            }
            return .object(["sessions": .array(sessions), "nextCursor": .null])

        case "session.read":
            let sessionID = try requiredString(payload, key: "sessionId", maximumBytes: 512)
            try await selectSessionIfNeeded(profile: profile, sessionID: sessionID, command: command)
            let conversation = try await translateAccessibilityError {
                try await connector.readVisibleChat(bundleIdentifier: profile.application.rawValue)
            }
            activate(profile: profile, sessionID: sessionID, conversation: conversation)
            let entries = conversation.messages.enumerated().map { index, message in
                let itemID = Self.entryID(
                    connectorID: profile.connectorID,
                    sessionID: sessionID,
                    token: message.opaqueToken,
                    fallbackIndex: index,
                    role: message.role.rawValue,
                    generation: 0
                )
                return JSONValue.object([
                    "id": .string(itemID),
                    "turnId": .string("visible-\(index)"),
                    "type": .string("message"),
                    "role": .string(message.role.rawValue),
                    "text": .string(message.text),
                    "status": .string("complete"),
                    "observedAt": .null
                ])
            }
            return .object([
                "sessionId": .string(sessionID),
                "entries": .array(entries),
                "nextCursor": .null,
                "backwardsCursor": .null,
                "source": .string("native")
            ])

        case "session.create":
            try requireMutationAuthorization(command)
            try await translateAccessibilityError {
                try await connector.createNewChat(
                    bundleIdentifier: profile.application.rawValue,
                    authorization: authorization(command)
                )
            }
            let chats = try await translateAccessibilityError {
                try await connector.listVisibleChats(bundleIdentifier: profile.application.rawValue)
            }
            guard let selected = chats.enumerated().first(where: { $0.element.isSelected }) else {
                throw ThingtimeNodeError.connectorProtocol("The desktop app created a chat but did not expose one selected visible chat.")
            }
            let conversation = try await translateAccessibilityError {
                try await connector.readVisibleChat(bundleIdentifier: profile.application.rawValue)
            }
            activate(profile: profile, sessionID: selected.element.selectionToken, conversation: conversation)
            return sessionSummary(
                connectorID: profile.connectorID,
                sessionID: selected.element.selectionToken,
                ordinal: selected.offset + 1,
                selected: true
            )

        case "session.send":
            try requireMutationAuthorization(command)
            let sessionID = try requiredString(payload, key: "sessionId", maximumBytes: 512)
            let delivery = try requiredString(payload, key: "delivery", maximumBytes: 16)
            guard delivery == "queue" else {
                throw ThingtimeNodeError.policyDenied("Steering is available through the native Codex connector, not Accessibility chat control.")
            }
            try await selectSessionIfNeeded(profile: profile, sessionID: sessionID, command: command)
            let text = try requiredString(payload, key: "text", maximumBytes: 65_536)
            let conversation = try await translateAccessibilityError {
                try await connector.readVisibleChat(bundleIdentifier: profile.application.rawValue)
            }
            activate(profile: profile, sessionID: sessionID, conversation: conversation)
            try await translateAccessibilityError {
                try await connector.sendMessage(
                    bundleIdentifier: profile.application.rawValue,
                    text: text,
                    authorization: authorization(command)
                )
            }
            let turnID = Self.turnID(commandID: command.commandID)
            if var active = activeSessions[profile.connectorID] {
                active.pendingRemoteEchoes.append(text)
                active.pendingRemoteEchoes = Array(active.pendingRemoteEchoes.suffix(16))
                active.pendingTurnID = turnID
                activeSessions[profile.connectorID] = active
            }
            emit(
                connectorID: profile.connectorID,
                sessionID: sessionID,
                turnID: turnID,
                itemID: nil,
                type: "message.submitted",
                payload: .object([
                    "commandId": .string(command.commandID),
                    "mode": .string("queue"),
                    "text": .string(text)
                ])
            )
            return .object(["status": .string("started"), "turnId": .null, "queuePosition": .null])

        case "session.interrupt":
            throw ThingtimeNodeError.policyDenied("Interrupt is available through the native Codex connector, not Accessibility chat control.")
        case "approval.respond":
            throw ThingtimeNodeError.policyDenied("The Accessibility connector cannot respond to in-app approval dialogs remotely.")
        default:
            throw ThingtimeNodeError.invalidRequest("Unsupported desktop chat operation.")
        }
    }

    private static func profile(connectorID: String) throws -> Profile {
        guard let profile = profiles.first(where: { $0.connectorID == connectorID }) else {
            throw ThingtimeNodeError.invalidRequest("The desktop chat connector identifier is invalid.")
        }
        return profile
    }

    private func selectSessionIfNeeded(
        profile: Profile,
        sessionID: String,
        command: DesktopChatCommand
    ) async throws {
        var chats = try await translateAccessibilityError {
            try await connector.listVisibleChats(bundleIdentifier: profile.application.rawValue)
        }
        guard let target = chats.first(where: { $0.selectionToken == sessionID }) else {
            throw ThingtimeNodeError.invalidRequest("That visible desktop chat is no longer available.")
        }
        guard !target.isSelected else { return }
        try requireMutationAuthorization(command)
        try await translateAccessibilityError {
            try await connector.selectVisibleChat(
                bundleIdentifier: profile.application.rawValue,
                selectionToken: sessionID,
                authorization: authorization(command)
            )
        }
        for attempt in 0 ..< 5 {
            chats = try await translateAccessibilityError {
                try await connector.listVisibleChats(bundleIdentifier: profile.application.rawValue)
            }
            if chats.contains(where: { $0.selectionToken == sessionID && $0.isSelected }) { return }
            if attempt < 4 { try? await Task.sleep(for: .milliseconds(150)) }
        }
        throw ThingtimeNodeError.commandOutcomeUncertain
    }

    private func activate(profile: Profile, sessionID: String, conversation: DesktopVisibleConversation) {
        var messages: [String: ObservedMessage] = [:]
        for (index, message) in conversation.messages.enumerated() {
            let token = Self.messageToken(message, fallbackIndex: index)
            let itemID = Self.entryID(
                connectorID: profile.connectorID,
                sessionID: sessionID,
                token: token,
                fallbackIndex: index,
                role: message.role.rawValue,
                generation: 0
            )
            messages[token] = ObservedMessage(
                role: message.role,
                text: message.text,
                itemID: itemID,
                generation: 0,
                unchangedPolls: 2,
                completed: true,
                turnID: nil
            )
        }
        let previous = activeSessions[profile.connectorID]
        activeSessions[profile.connectorID] = ActiveSession(
            sessionID: sessionID,
            messages: messages,
            pendingRemoteEchoes: previous?.sessionID == sessionID ? previous?.pendingRemoteEchoes ?? [] : [],
            pendingTurnID: previous?.sessionID == sessionID ? previous?.pendingTurnID : nil
        )
    }

    public func pollActiveSessionsOnce() async {
        for profile in Self.profiles {
            guard var active = activeSessions[profile.connectorID] else { continue }
            do {
                let chats = try await connector.listVisibleChats(bundleIdentifier: profile.application.rawValue)
                guard chats.contains(where: { $0.selectionToken == active.sessionID && $0.isSelected }) else {
                    activeSessions.removeValue(forKey: profile.connectorID)
                    continue
                }
                let conversation = try await connector.readVisibleChat(bundleIdentifier: profile.application.rawValue)
                reconcile(profile: profile, active: &active, conversation: conversation)
                activeSessions[profile.connectorID] = active
            } catch {
                // Permission, lock state, app exit, and selector drift are all
                // fail-closed. Connector health exposes the actionable state;
                // the polling loop never forwards raw backend error strings.
                continue
            }
        }
    }

    private func reconcile(
        profile: Profile,
        active: inout ActiveSession,
        conversation: DesktopVisibleConversation
    ) {
        for (index, message) in conversation.messages.enumerated() {
            let token = Self.messageToken(message, fallbackIndex: index)
            if var observed = active.messages[token] {
                guard observed.role == message.role else { continue }
                if observed.text == message.text {
                    if !observed.completed {
                        observed.unchangedPolls += 1
                        if observed.unchangedPolls >= 2, observed.role == .assistant, let turnID = observed.turnID {
                            completeAssistant(
                                connectorID: profile.connectorID,
                                sessionID: active.sessionID,
                                turnID: turnID,
                                observed: &observed
                            )
                            if active.pendingTurnID == turnID { active.pendingTurnID = nil }
                        }
                    }
                    active.messages[token] = observed
                    continue
                }

                if observed.role == .assistant,
                   !observed.completed,
                   message.text.hasPrefix(observed.text) {
                    let delta = String(message.text.dropFirst(observed.text.count))
                    observed.text = message.text
                    observed.unchangedPolls = 0
                    active.messages[token] = observed
                    if !delta.isEmpty, let turnID = observed.turnID {
                        emitDelta(
                            connectorID: profile.connectorID,
                            sessionID: active.sessionID,
                            turnID: turnID,
                            itemID: observed.itemID,
                            delta: delta
                        )
                    }
                    continue
                }

                // A non-prefix rewrite cannot be represented as a safe delta.
                // Finish the old generation and start a distinct opaque item.
                if observed.role == .assistant, !observed.completed, let turnID = observed.turnID {
                    completeAssistant(
                        connectorID: profile.connectorID,
                        sessionID: active.sessionID,
                        turnID: turnID,
                        observed: &observed
                    )
                }
                let next = startObservedMessage(
                    profile: profile,
                    active: &active,
                    message: message,
                    token: token,
                    fallbackIndex: index,
                    generation: observed.generation + 1
                )
                active.messages[token] = next
                continue
            }

            active.messages[token] = startObservedMessage(
                profile: profile,
                active: &active,
                message: message,
                token: token,
                fallbackIndex: index,
                generation: 0
            )
        }
    }

    private func startObservedMessage(
        profile: Profile,
        active: inout ActiveSession,
        message: DesktopVisibleMessage,
        token: String,
        fallbackIndex: Int,
        generation: Int
    ) -> ObservedMessage {
        let itemID = Self.entryID(
            connectorID: profile.connectorID,
            sessionID: active.sessionID,
            token: token,
            fallbackIndex: fallbackIndex,
            role: message.role.rawValue,
            generation: generation
        )
        if message.role == .user {
            if let index = active.pendingRemoteEchoes.firstIndex(of: message.text) {
                active.pendingRemoteEchoes.remove(at: index)
            } else {
                let turnID = Self.turnID(commandID: itemID)
                active.pendingTurnID = turnID
                emit(
                    connectorID: profile.connectorID,
                    sessionID: active.sessionID,
                    turnID: turnID,
                    itemID: itemID,
                    type: "message.submitted",
                    payload: .object([
                        "commandId": .string(itemID),
                        "mode": .string("queue"),
                        "text": .string(message.text)
                    ])
                )
            }
            return ObservedMessage(
                role: .user,
                text: message.text,
                itemID: itemID,
                generation: generation,
                unchangedPolls: 2,
                completed: true,
                turnID: nil
            )
        }

        let turnID = active.pendingTurnID ?? Self.turnID(commandID: itemID)
        active.pendingTurnID = turnID
        emit(
            connectorID: profile.connectorID,
            sessionID: active.sessionID,
            turnID: turnID,
            itemID: itemID,
            type: "turn.started",
            payload: .object([
                "turn": .object(["id": .string(turnID), "status": .string("running")])
            ])
        )
        emitDelta(
            connectorID: profile.connectorID,
            sessionID: active.sessionID,
            turnID: turnID,
            itemID: itemID,
            delta: message.text
        )
        return ObservedMessage(
            role: .assistant,
            text: message.text,
            itemID: itemID,
            generation: generation,
            unchangedPolls: 0,
            completed: false,
            turnID: turnID
        )
    }

    private func completeAssistant(
        connectorID: String,
        sessionID: String,
        turnID: String,
        observed: inout ObservedMessage
    ) {
        guard !observed.completed else { return }
        emit(
            connectorID: connectorID,
            sessionID: sessionID,
            turnID: turnID,
            itemID: observed.itemID,
            type: "item.completed",
            payload: .object([
                "item": .object([
                    "id": .string(observed.itemID),
                    "type": .string("agentMessage"),
                    "text": .string(observed.text)
                ])
            ])
        )
        emit(
            connectorID: connectorID,
            sessionID: sessionID,
            turnID: turnID,
            itemID: observed.itemID,
            type: "turn.completed",
            payload: .object([
                "turn": .object(["id": .string(turnID), "status": .string("completed")])
            ])
        )
        observed.completed = true
    }

    private func emitDelta(
        connectorID: String,
        sessionID: String,
        turnID: String,
        itemID: String,
        delta: String
    ) {
        guard !delta.isEmpty else { return }
        emit(
            connectorID: connectorID,
            sessionID: sessionID,
            turnID: turnID,
            itemID: itemID,
            type: "message.delta",
            payload: .object(["delta": .string(delta)])
        )
    }

    private func emit(
        connectorID: String,
        sessionID: String,
        turnID: String?,
        itemID: String?,
        type: String,
        payload: JSONValue
    ) {
        let event = ConnectorEvent(
            event: "connector/event",
            payload: .object([
                "connectorId": .string(connectorID),
                "sessionId": .string(sessionID),
                "observedAt": .string(Self.timestamp()),
                "turnId": turnID.map(JSONValue.string) ?? .null,
                "itemId": itemID.map(JSONValue.string) ?? .null,
                "type": .string(type),
                "payload": payload
            ])
        )
        eventContinuations.values.forEach { $0.yield(event) }
    }

    private func removeEventContinuation(_ identifier: UUID) {
        eventContinuations.removeValue(forKey: identifier)
    }

    private func sessionSummary(
        connectorID: String,
        sessionID: String,
        ordinal: Int,
        selected: Bool
    ) -> JSONValue {
        .object([
            "id": .string(sessionID),
            "connectorId": .string(connectorID),
            "title": .string(selected ? "Visible chat \(ordinal) (selected)" : "Visible chat \(ordinal)"),
            "preview": .string(""),
            "projectId": .null,
            "projectLabel": .null,
            "createdAt": .null,
            "updatedAt": .null,
            "activeTurnId": .null,
            "status": .string("unknown"),
            "source": .string("accessibility")
        ])
    }

    private func authorization(_ command: DesktopChatCommand) -> DesktopChatMutationAuthorization {
        DesktopChatMutationAuthorization(
            sessionLocked: command.sessionLocked,
            explicitlyApproved: command.explicitlyApproved
        )
    }

    private func requireMutationAuthorization(_ command: DesktopChatCommand) throws {
        guard !command.sessionLocked else { throw ThingtimeNodeError.policyDenied("The Mac is locked.") }
        guard command.explicitlyApproved else {
            throw ThingtimeNodeError.approvalRequired("Desktop chat mutation requires explicit approval.")
        }
    }

    private func translateAccessibilityError<T: Sendable>(
        _ operation: () async throws -> T
    ) async throws -> T {
        do {
            return try await operation()
        } catch let error as DesktopChatAccessibilityError {
            switch error {
            case .permissionNotGranted:
                throw ThingtimeNodeError.connectorUnavailable("Accessibility permission is not granted for Thingtime Node.")
            case let .applicationNotRunning(identifier):
                throw ThingtimeNodeError.connectorUnavailable("The allowlisted desktop chat app is not running: \(identifier).")
            case .sessionLocked:
                throw ThingtimeNodeError.policyDenied("The Mac is locked.")
            case .explicitApprovalRequired:
                throw ThingtimeNodeError.approvalRequired("Desktop chat mutation requires explicit approval.")
            case let .invalidMessage(message):
                throw ThingtimeNodeError.invalidRequest(message)
            case let .actionUnavailable(action):
                throw ThingtimeNodeError.policyDenied("Desktop chat action is unavailable: \(action).")
            case .backendFailure("send message; delivery outcome may be uncertain"):
                throw ThingtimeNodeError.commandOutcomeUncertain
            case let .unsupportedApplication(identifier):
                throw ThingtimeNodeError.invalidRequest("Desktop chat application is not allowlisted: \(identifier).")
            case let .selectorDrift(detail), let .ambiguousSelector(detail),
                 let .traversalLimitExceeded(detail), let .backendFailure(detail):
                throw ThingtimeNodeError.connectorProtocol("Desktop chat Accessibility failed closed: \(detail).")
            }
        }
    }

    private func requireObject(_ value: JSONValue) throws -> [String: JSONValue] {
        guard let object = value.objectValue else {
            throw ThingtimeNodeError.invalidRequest("Desktop chat command input must be an object.")
        }
        return object
    }

    private func requiredString(
        _ object: [String: JSONValue],
        key: String,
        maximumBytes: Int
    ) throws -> String {
        guard let value = object[key]?.stringValue,
              !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              value.utf8.count <= maximumBytes else {
            throw ThingtimeNodeError.invalidRequest("Desktop chat \(key) is invalid.")
        }
        return value
    }

    private static func messageToken(_ message: DesktopVisibleMessage, fallbackIndex: Int) -> String {
        message.opaqueToken.isEmpty ? "fallback-\(fallbackIndex)-\(message.role.rawValue)" : message.opaqueToken
    }

    private static func entryID(
        connectorID: String,
        sessionID: String,
        token: String,
        fallbackIndex: Int,
        role: String,
        generation: Int
    ) -> String {
        let stableToken = token.isEmpty ? "fallback-\(fallbackIndex)-\(role)" : token
        let digest = SHA256.hash(data: Data("\(connectorID)\u{0}\(sessionID)\u{0}\(stableToken)\u{0}\(role)\u{0}\(generation)".utf8))
        return "visible-" + digest.map { String(format: "%02x", $0) }.joined().prefix(40)
    }

    private static func turnID(commandID: String) -> String {
        let digest = SHA256.hash(data: Data("desktop-chat-turn\u{0}\(commandID)".utf8))
        return "ax-turn-" + digest.map { String(format: "%02x", $0) }.joined().prefix(32)
    }

    private static func timestamp() -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: Date())
    }
}
