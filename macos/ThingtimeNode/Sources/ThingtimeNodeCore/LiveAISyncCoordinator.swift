import CryptoKit
import Foundation

public typealias LiveAISyncTransport = @Sendable (JSONValue) async throws -> JSONValue

public struct LiveAISyncConfiguration: Equatable, Sendable {
    public let maximumOutboxRequests: Int
    public let maximumPendingEvents: Int
    public let maximumTrackedRevisions: Int

    public init(
        maximumOutboxRequests: Int = 1_024,
        maximumPendingEvents: Int = 4_096,
        maximumTrackedRevisions: Int = 32_768
    ) throws {
        guard (1 ... 8_192).contains(maximumOutboxRequests),
              (1 ... 65_536).contains(maximumPendingEvents),
              (1 ... 131_072).contains(maximumTrackedRevisions) else {
            throw LiveAISyncError.invalidConfiguration
        }
        self.maximumOutboxRequests = maximumOutboxRequests
        self.maximumPendingEvents = maximumPendingEvents
        self.maximumTrackedRevisions = maximumTrackedRevisions
    }
}

public enum LiveAISyncError: Error, Equatable, LocalizedError, Sendable {
    case invalidConfiguration
    case unsupportedJournalSchema
    case corruptJournal
    case outboxCapacityReached
    case pendingEventCapacityReached
    case revisionCapacityReached
    case invalidPairingScope
    case invalidConnectorResponse(String)
    case invalidTransportResponse

    public var errorDescription: String? {
        switch self {
        case .invalidConfiguration:
            "The live AI sync limits are invalid."
        case .unsupportedJournalSchema:
            "The live AI sync journal schema is unsupported."
        case .corruptJournal:
            "The live AI sync journal is invalid."
        case .outboxCapacityReached:
            "The live AI sync outbox is full."
        case .pendingEventCapacityReached:
            "The live AI event journal is full."
        case .revisionCapacityReached:
            "The live AI revision journal is full."
        case .invalidPairingScope:
            "The live AI sync pairing scope is invalid."
        case let .invalidConnectorResponse(field):
            "The connector returned an invalid live AI \(field)."
        case .invalidTransportResponse:
            "Thingtime returned an invalid live AI sync response."
        }
    }
}

private struct LiveAISyncRevision: Codable, Equatable, Sendable {
    var revision: Int
    var fingerprint: String
}

private struct PendingLiveAISyncRequest: Codable, Equatable, Sendable {
    let requestID: String
    var payload: JSONValue
    var sealed: Bool
    var eventCount: Int
}

private struct LiveAISyncJournalSnapshot: Codable, Equatable, Sendable {
    let schemaVersion: Int
    var pairingScopeHash: String?
    var outbox: [PendingLiveAISyncRequest]
    var nextSequences: [String: Int]
    var revisions: [String: LiveAISyncRevision]

    static let empty = LiveAISyncJournalSnapshot(
        schemaVersion: 1,
        pairingScopeHash: nil,
        outbox: [],
        nextSequences: [:],
        revisions: [:]
    )
}

private struct SafeLiveItem {
    enum Kind {
        case visible(role: String, text: String)
        case activity
    }

    let itemID: String
    let value: JSONValue
    let kind: Kind
}

private struct PendingLiveDeltaGuard {
    let connectorID: String
    let sessionID: String
    let turnID: String?
    let itemID: String
    var pending: String
    var blocked: Bool
}

/// Durable adapter between the connector's narrow public wire vocabulary and
/// `/devices/node/live-sync`. It reconstructs the server's closed envelopes
/// from `NodeResponse` and `ConnectorEvent` values while discarding local
/// paths, reasoning, tool inputs, and every other non-public field.
public actor LiveAISyncCoordinator {
    public static let maximumBatchCount = 100

    private static let maximumIDCharacters = 512
    private static let maximumCursorCharacters = 2_048
    private static let maximumEventIDCharacters = 160
    private static let maximumConnectorIDCharacters = 80
    private static let maximumTextCharacters = 256_000
    private static let maximumBatchTextCharacters = 512_000
    private static let maximumDeltaCharacters = 32_000
    private static let maximumBatchDeltaCharacters = 128_000
    private static let streamGuardTailCharacters = 128
    private static let internalContextPattern = try! NSRegularExpression(
        pattern: #"(?:<\s*/?\s*(?:system-reminder|local-command-caveat|codex_internal_context|environment_context|recommended_plugins|permissions(?:\s+instructions)?|apps_instructions|plugins_instructions|skills_instructions|agent-instructions|instructions|memory(?:_summary)?|multi_agent_mode|oai-mem-citation)(?:\s|>)|^\s*#\s*AGENTS\.md instructions\b)"#,
        options: [.caseInsensitive, .anchorsMatchLines]
    )
    private static let internalContextStreamPattern = try! NSRegularExpression(
        pattern: #"(?:system-reminder|local-command-caveat|codex_internal_context|environment_context|recommended_plugins|apps_instructions|plugins_instructions|skills_instructions|agent-instructions|memory_summary|multi_agent_mode|oai-mem-citation|AGENTS\.md\s+instructions)"#,
        options: [.caseInsensitive, .anchorsMatchLines]
    )

    private let fileURL: URL
    private let configuration: LiveAISyncConfiguration
    private let transport: LiveAISyncTransport
    private var journal: LiveAISyncJournalSnapshot
    private var isFlushing = false
    private var deltaGuards: [String: PendingLiveDeltaGuard] = [:]

    public init(
        fileURL: URL = LiveAISyncCoordinator.defaultFileURL(),
        configuration: LiveAISyncConfiguration = try! LiveAISyncConfiguration(),
        syncLiveAI: @escaping LiveAISyncTransport
    ) throws {
        guard fileURL.isFileURL, fileURL.path.hasPrefix("/") else {
            throw LiveAISyncError.invalidConfiguration
        }
        self.fileURL = fileURL
        self.configuration = configuration
        self.transport = syncLiveAI

        if FileManager.default.fileExists(atPath: fileURL.path) {
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            let loaded: LiveAISyncJournalSnapshot
            do {
                loaded = try decoder.decode(
                    LiveAISyncJournalSnapshot.self,
                    from: Data(contentsOf: fileURL)
                )
            } catch {
                throw LiveAISyncError.corruptJournal
            }
            guard loaded.schemaVersion == 1 else {
                throw LiveAISyncError.unsupportedJournalSchema
            }
            journal = loaded
        } else {
            journal = .empty
        }
        try Self.validate(journal, configuration: configuration)
    }

    public static func defaultFileURL(fileManager: FileManager = .default) -> URL {
        let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fileManager.homeDirectoryForCurrentUser
                .appendingPathComponent("Library/Application Support", isDirectory: true)
        return base
            .appendingPathComponent("Thingtime Node", isDirectory: true)
            .appendingPathComponent("live-ai-sync-journal.json", isDirectory: false)
    }

    /// Binds every durable cursor, revision and queued payload to one server
    /// device identity. Changing or removing the pairing destroys the prior
    /// scope before a new credential can flush it into another account/device.
    public func bindPairing(deviceID: String?) throws {
        let nextHash: String?
        if let deviceID {
            guard let normalized = Self.opaque(deviceID) else {
                throw LiveAISyncError.invalidPairingScope
            }
            nextHash = Self.pairingScopeHash(normalized)
        } else {
            nextHash = nil
        }
        if journal.pairingScopeHash == nextHash,
           nextHash != nil ||
           (journal.outbox.isEmpty && journal.nextSequences.isEmpty && journal.revisions.isEmpty && deltaGuards.isEmpty) {
            return
        }
        var reset = LiveAISyncJournalSnapshot.empty
        reset.pairingScopeHash = nextHash
        try commit(reset)
        // Stream tails are deliberately memory-only, but they are still
        // account-scoped visible text. Never let a later completion event
        // flush a prior device/account's withheld tail after re-pairing.
        deltaGuards.removeAll(keepingCapacity: false)
    }

    /// Captures only successful leased mirror reads. Mutations such as send,
    /// interrupt, or approval response are represented by connector events and
    /// must never be reconstructed from command input here.
    @discardableResult
    public func captureSuccessfulLeasedResponse(
        command: LeasedCommand,
        response: NodeResponse
    ) throws -> Int {
        guard response.ok, let result = response.result else { return 0 }
        guard command.method == "session.list" ||
                command.method == "session.create" ||
                command.method == "session.read" else { return 0 }
        guard let parameters = command.parameters.objectValue,
              let connectorID = Self.opaque(
                parameters["connectorId"]?.stringValue,
                maximum: Self.maximumConnectorIDCharacters
              ) else {
            throw LiveAISyncError.invalidConnectorResponse("connector identifier")
        }

        var next = journal
        let payloads: [JSONValue]
        switch command.method {
        case "session.list":
            payloads = try makeSessionListPayloads(
                connectorID: connectorID,
                result: result,
                journal: &next
            )
        case "session.create":
            let summary = try makeSessionSummary(
                connectorID: connectorID,
                value: result,
                journal: &next
            )
            payloads = [Self.sessionsPayload(connectorID: connectorID, sessions: [summary])]
        case "session.read":
            guard let sessionID = Self.opaque(parameters["sessionId"]?.stringValue) else {
                throw LiveAISyncError.invalidConnectorResponse("session identifier")
            }
            payloads = try makeTranscriptPayloads(
                connectorID: connectorID,
                sessionID: sessionID,
                requestedCursor: try Self.optionalCursor(parameters["cursor"]),
                result: result,
                journal: &next
            )
        default:
            payloads = []
        }

        for payload in payloads {
            try appendRequest(payload, eventCount: 0, journal: &next)
        }
        guard !payloads.isEmpty else { return 0 }
        try commit(next)
        return payloads.count
    }

    /// Filters the runtime wrapper and converts only the server's closed event
    /// vocabulary. Unsupported or malformed event shapes are dropped rather
    /// than forwarded as generic JSON.
    @discardableResult
    public func captureConnectorEvent(_ connectorEvent: ConnectorEvent) throws -> Int {
        guard connectorEvent.event == "connector/event",
              let source = connectorEvent.payload.objectValue,
              let connectorID = Self.opaque(
                source["connectorId"]?.stringValue,
                maximum: Self.maximumConnectorIDCharacters
              ),
              let sessionID = Self.opaque(source["sessionId"]?.stringValue),
              let observedAt = Self.timestamp(source["observedAt"]?.stringValue),
              let type = source["type"]?.stringValue,
              var sourcePayload = source["payload"]?.objectValue else { return 0 }

        let turnID = Self.optionalOpaqueLossy(source["turnId"], maximum: Self.maximumEventIDCharacters)
        let itemID = Self.optionalOpaqueLossy(source["itemId"], maximum: Self.maximumEventIDCharacters)
        let guardKey = itemID.map { Self.deltaGuardKey(connectorID: connectorID, sessionID: sessionID, itemID: $0) }
        var pendingDeltasToFlush: [(itemID: String, delta: String)] = []
        if type == "message.delta" {
            guard let guardKey,
                  let delta = sourcePayload["delta"]?.stringValue,
                  !delta.isEmpty else { return 0 }
            var guardState = deltaGuards[guardKey] ?? PendingLiveDeltaGuard(
                connectorID: connectorID,
                sessionID: sessionID,
                turnID: turnID,
                itemID: itemID!,
                pending: "",
                blocked: false
            )
            guard !guardState.blocked else { return 0 }
            guardState.pending += delta
            if Self.containsInternalContext(guardState.pending) {
                guardState.pending = ""
                guardState.blocked = true
                deltaGuards[guardKey] = guardState
                return 0
            }
            let split = Self.splitStreamGuard(guardState.pending)
            guardState.pending = split.tail
            deltaGuards[guardKey] = guardState
            guard !split.visible.isEmpty else { return 0 }
            sourcePayload["delta"] = .string(split.visible)
        } else if type == "item.completed", let guardKey, let guardState = deltaGuards.removeValue(forKey: guardKey) {
            guard !guardState.blocked,
                  Self.safeItem(sourcePayload["item"], outerItemID: itemID) != nil else { return 0 }
            if !guardState.pending.isEmpty {
                pendingDeltasToFlush.append((itemID: guardState.itemID, delta: guardState.pending))
            }
        } else if type == "turn.completed" {
            let matching = deltaGuards.filter {
                $0.value.connectorID == connectorID &&
                    $0.value.sessionID == sessionID &&
                    $0.value.turnID == turnID
            }
            for (key, guardState) in matching {
                deltaGuards.removeValue(forKey: key)
                if !guardState.blocked, !guardState.pending.isEmpty {
                    pendingDeltasToFlush.append((itemID: guardState.itemID, delta: guardState.pending))
                }
            }
        }

        var next = journal
        var prototypes: [JSONValue] = []
        for pending in pendingDeltasToFlush {
            prototypes.append(contentsOf: try makeEventPrototypes(
                connectorID: connectorID,
                sessionID: sessionID,
                observedAt: observedAt,
                turnID: turnID,
                itemID: pending.itemID,
                type: "message.delta",
                payload: ["delta": .string(pending.delta)],
                journal: &next
            ))
        }
        prototypes.append(contentsOf: try makeEventPrototypes(
            connectorID: connectorID,
            sessionID: sessionID,
            observedAt: observedAt,
            turnID: turnID,
            itemID: itemID,
            type: type,
            payload: sourcePayload,
            journal: &next
        ))
        guard !prototypes.isEmpty else { return 0 }

        for prototype in prototypes {
            try appendEvent(
                prototype,
                connectorID: connectorID,
                sessionID: sessionID,
                journal: &next
            )
        }
        try commit(next)
        return prototypes.count
    }

    /// Seals each exact payload before transport. If transport fails or the
    /// process crashes after server acceptance but before local deletion, the
    /// byte-equivalent JSONValue is retried and the server's idempotency rules
    /// reconcile it.
    @discardableResult
    public func flush(maximumRequests: Int = .max) async throws -> Int {
        guard maximumRequests > 0 else { throw LiveAISyncError.invalidConfiguration }
        guard !isFlushing else { return 0 }
        isFlushing = true
        defer { isFlushing = false }

        var completed = 0
        while completed < maximumRequests, let first = journal.outbox.first {
            if !first.sealed {
                var sealed = journal
                sealed.outbox[0].sealed = true
                try commit(sealed)
            }
            guard let request = journal.outbox.first else { break }
            let response = try await transport(request.payload)
            try Self.validateTransportResponse(response, request: request)

            // Actor reentrancy allows capture while transport is in flight.
            // Remove by stable request ID from the latest journal, preserving
            // anything appended behind the sealed request.
            var next = journal
            guard let index = next.outbox.firstIndex(where: { $0.requestID == request.requestID }),
                  next.outbox[index].payload == request.payload else {
                throw LiveAISyncError.corruptJournal
            }
            next.outbox.remove(at: index)
            try commit(next)
            completed += 1
        }
        return completed
    }

    public func pendingRequestCount() -> Int { journal.outbox.count }

    public func pendingEventCount() -> Int {
        journal.outbox.reduce(0) { $0 + $1.eventCount }
    }

    // MARK: - Leased responses

    private func makeSessionListPayloads(
        connectorID: String,
        result: JSONValue,
        journal: inout LiveAISyncJournalSnapshot
    ) throws -> [JSONValue] {
        guard let object = result.objectValue,
              case let .array(values)? = object["sessions"] else {
            throw LiveAISyncError.invalidConnectorResponse("session list")
        }
        var seen = Set<String>()
        let sessions = try values.map { value -> JSONValue in
            let summary = try makeSessionSummary(
                connectorID: connectorID,
                value: value,
                journal: &journal
            )
            guard let sessionID = summary.objectValue?["sessionId"]?.stringValue,
                  seen.insert(sessionID).inserted else {
                throw LiveAISyncError.invalidConnectorResponse("duplicate session")
            }
            return summary
        }
        return stride(from: 0, to: sessions.count, by: Self.maximumBatchCount).map { start in
            let end = min(start + Self.maximumBatchCount, sessions.count)
            return Self.sessionsPayload(
                connectorID: connectorID,
                sessions: Array(sessions[start ..< end])
            )
        }
    }

    private func makeSessionSummary(
        connectorID: String,
        value: JSONValue,
        journal: inout LiveAISyncJournalSnapshot
    ) throws -> JSONValue {
        guard let source = value.objectValue,
              let sessionID = Self.opaque(source["id"]?.stringValue),
              let title = Self.boundedMetadata(source["title"]?.stringValue, maximum: 80) else {
            throw LiveAISyncError.invalidConnectorResponse("session summary")
        }
        let projectID = Self.optionalOpaqueLossy(source["projectId"])
        let projectLabel = Self.optionalMetadata(source["projectLabel"], maximum: 80)
        let allowedStates = Set([
            "idle", "running", "waiting", "waiting-approval", "error", "archived", "unknown"
        ])
        let sourceState = source["status"]?.stringValue
        let state = sourceState.flatMap { allowedStates.contains($0) ? $0 : nil } ?? "unknown"
        let base: [String: JSONValue] = [
            "sessionId": .string(sessionID),
            "title": .string(title),
            "projectId": projectID.map(JSONValue.string) ?? .null,
            "projectLabel": projectLabel.map(JSONValue.string) ?? .null,
            "state": .string(state),
            "createdAt": Self.optionalTimestampValue(source["createdAt"]),
            "updatedAt": Self.optionalTimestampValue(source["updatedAt"])
        ]
        let revision = try revision(
            key: Self.trackingKey("session", connectorID, sessionID),
            value: .object(base),
            journal: &journal
        )
        var result = base
        result["revision"] = .number(Double(revision))
        return .object(result)
    }

    private func makeTranscriptPayloads(
        connectorID: String,
        sessionID: String,
        requestedCursor: String?,
        result: JSONValue,
        journal: inout LiveAISyncJournalSnapshot
    ) throws -> [JSONValue] {
        guard let object = result.objectValue,
              object["sessionId"]?.stringValue == sessionID,
              case let .array(values)? = object["entries"] else {
            throw LiveAISyncError.invalidConnectorResponse("transcript page")
        }
        let nextCursor = try Self.optionalCursor(object["nextCursor"])
        let page: JSONValue = .object([
            "cursor": requestedCursor.map(JSONValue.string) ?? .null,
            "nextCursor": nextCursor.map(JSONValue.string) ?? .null,
            "hasMore": .bool(nextCursor != nil)
        ])

        var entries: [JSONValue] = []
        var seen = Set<String>()
        for value in values {
            guard let source = value.objectValue, let type = source["type"]?.stringValue else { continue }
            if type == "message" {
                // Streaming/interrupted/failed text remains transient. The
                // completed event path or a later completed read materializes it.
                guard source["status"]?.stringValue == "complete" else { continue }
                guard let entry = try makeTranscriptMessage(
                    connectorID: connectorID,
                    sessionID: sessionID,
                    source: source,
                    journal: &journal
                ) else { continue }
                let key = "message:" + (entry.objectValue?["messageId"]?.stringValue ?? "")
                guard seen.insert(key).inserted else {
                    throw LiveAISyncError.invalidConnectorResponse("duplicate transcript entry")
                }
                entries.append(entry)
            } else if type == "activity",
                      let entry = try makeTranscriptActivity(
                        connectorID: connectorID,
                        sessionID: sessionID,
                        source: source,
                        journal: &journal
                      ) {
                let key = "activity:" + (entry.objectValue?["activityId"]?.stringValue ?? "")
                guard seen.insert(key).inserted else {
                    throw LiveAISyncError.invalidConnectorResponse("duplicate transcript entry")
                }
                entries.append(entry)
            }
        }

        let chunks = Self.transcriptChunks(entries)
        return (chunks.isEmpty ? [[]] : chunks).map { chunk in
            .object([
                "op": .string("transcript.page"),
                "connectorId": .string(connectorID),
                "sessionId": .string(sessionID),
                "page": page,
                "entries": .array(chunk)
            ])
        }
    }

    private func makeTranscriptMessage(
        connectorID: String,
        sessionID: String,
        source: [String: JSONValue],
        journal: inout LiveAISyncJournalSnapshot
    ) throws -> JSONValue? {
        guard let messageID = Self.opaque(source["id"]?.stringValue),
              let role = source["role"]?.stringValue,
              role == "user" || role == "assistant",
              let text = Self.preservedText(
                source["text"]?.stringValue,
                maximum: Self.maximumTextCharacters,
                requireVisible: true
              ) else { return nil }
        let completedAt = Self.optionalTimestampValue(source["observedAt"])
        let base: [String: JSONValue] = [
            "type": .string("message"),
            "messageId": .string(messageID),
            "role": .string(role),
            "text": .string(text),
            "createdAt": .null,
            "completedAt": completedAt
        ]
        let revision = try revision(
            key: Self.trackingKey("message", connectorID, sessionID, messageID),
            value: .object(base),
            journal: &journal
        )
        var result = base
        result["revision"] = .number(Double(revision))
        return .object(result)
    }

    private func makeTranscriptActivity(
        connectorID: String,
        sessionID: String,
        source: [String: JSONValue],
        journal: inout LiveAISyncJournalSnapshot
    ) throws -> JSONValue? {
        let allowed = Set(["command", "file-change", "tool", "web-search", "plan", "other"])
        guard let activityID = Self.opaque(source["id"]?.stringValue),
              let turnID = Self.opaque(source["turnId"]?.stringValue, maximum: 160),
              let activity = source["activity"]?.stringValue,
              allowed.contains(activity),
              let label = Self.boundedMetadata(source["label"]?.stringValue, maximum: 160),
              let status = Self.boundedMetadata(source["status"]?.stringValue, maximum: 64) else {
            return nil
        }
        let base: [String: JSONValue] = [
            "type": .string("activity"),
            "activityId": .string(activityID),
            "turnId": .string(turnID),
            "activity": .string(activity),
            "label": .string(label),
            "status": .string(status),
            "observedAt": Self.optionalTimestampValue(source["observedAt"])
        ]
        let revision = try revision(
            key: Self.trackingKey("activity", connectorID, sessionID, activityID),
            value: .object(base),
            journal: &journal
        )
        var result = base
        result["revision"] = .number(Double(revision))
        return .object(result)
    }

    // MARK: - Connector events

    private func makeEventPrototypes(
        connectorID: String,
        sessionID: String,
        observedAt: String,
        turnID: String?,
        itemID: String?,
        type: String,
        payload: [String: JSONValue],
        journal: inout LiveAISyncJournalSnapshot
    ) throws -> [JSONValue] {
        var base: [String: JSONValue] = [
            "observedAt": .string(observedAt),
            "turnId": turnID.map(JSONValue.string) ?? .null,
            "itemId": itemID.map(JSONValue.string) ?? .null,
            "type": .string(type)
        ]

        switch type {
        case "turn.started", "turn.completed":
            guard let turnID,
                  let turn = Self.safeTurn(payload["turn"], expectedID: turnID) else { return [] }
            base["payload"] = .object(["turn": turn])
            return [.object(base)]

        case "turn.interrupted":
            guard let turnID,
                  let commandID = Self.opaque(payload["commandId"]?.stringValue, maximum: 160) else { return [] }
            base["turnId"] = .string(turnID)
            base["payload"] = .object(["commandId": .string(commandID)])
            return [.object(base)]

        case "message.queued":
            guard let commandID = Self.opaque(payload["commandId"]?.stringValue, maximum: 160),
                  let text = Self.preservedText(
                    payload["text"]?.stringValue,
                    maximum: Self.maximumTextCharacters,
                    requireVisible: true
                  ) else { return [] }
            var queued: [String: JSONValue] = [
                "commandId": .string(commandID),
                "text": .string(text)
            ]
            if let position = Self.positiveInteger(payload["queuePosition"]) {
                queued["queuePosition"] = .number(Double(position))
            } else if payload["queuePosition"] != nil, payload["queuePosition"] != .null {
                return []
            }
            base["payload"] = .object(queued)
            return [.object(base)]

        case "message.submitted":
            guard let commandID = Self.opaque(payload["commandId"]?.stringValue, maximum: 160),
                  let mode = payload["mode"]?.stringValue,
                  mode == "queue" || mode == "steer",
                  let text = Self.preservedText(
                    payload["text"]?.stringValue,
                    maximum: Self.maximumTextCharacters,
                    requireVisible: true
                  ) else { return [] }
            let message = try makeEventMessage(
                connectorID: connectorID,
                sessionID: sessionID,
                messageID: commandID,
                role: "user",
                text: text,
                observedAt: observedAt,
                journal: &journal
            )
            base["payload"] = .object([
                "commandId": .string(commandID),
                "mode": .string(mode),
                "text": .string(text)
            ])
            base["message"] = message
            return [.object(base)]

        case "message.delta":
            guard let itemID,
                  let delta = Self.preservedText(
                    payload["delta"]?.stringValue,
                    maximum: Int.max,
                    requireVisible: false
                  ),
                  !delta.isEmpty else { return [] }
            base["itemId"] = .string(itemID)
            return Self.scalarChunks(delta, maximum: Self.maximumDeltaCharacters).map { part in
                var event = base
                event["payload"] = .object(["delta": .string(part)])
                return .object(event)
            }

        case "item.started", "item.completed":
            guard let item = Self.safeItem(payload["item"], outerItemID: itemID) else { return [] }
            base["itemId"] = .string(item.itemID)
            base["payload"] = .object(["item": item.value])
            if type == "item.completed",
               case let .visible(role, text) = item.kind,
               role == "assistant",
               !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                base["message"] = try makeEventMessage(
                    connectorID: connectorID,
                    sessionID: sessionID,
                    messageID: item.itemID,
                    role: role,
                    text: text,
                    observedAt: observedAt,
                    journal: &journal
                )
            }
            return [.object(base)]

        case "approval.requested":
            guard let requestID = Self.opaque(payload["requestId"]?.stringValue, maximum: 160),
                  let label = Self.boundedMetadata(payload["label"]?.stringValue, maximum: 160) else { return [] }
            base["payload"] = .object([
                "requestId": .string(requestID),
                "label": .string(label)
            ])
            return [.object(base)]

        case "approval.responded":
            guard let requestID = Self.opaque(payload["requestId"]?.stringValue, maximum: 160),
                  let decision = payload["decision"]?.stringValue,
                  ["accept", "acceptForSession", "decline", "cancel"].contains(decision) else { return [] }
            if payload["reason"]?.stringValue == "expired" {
                guard decision == "cancel" else { return [] }
                base["payload"] = .object([
                    "requestId": .string(requestID),
                    "decision": .string("cancel"),
                    "reason": .string("expired")
                ])
                return [.object(base)]
            }
            guard let commandID = Self.opaque(payload["commandId"]?.stringValue, maximum: 160) else { return [] }
            base["payload"] = .object([
                "requestId": .string(requestID),
                "decision": .string(decision),
                "commandId": .string(commandID)
            ])
            return [.object(base)]

        case "connector.warning":
            if payload["reason"]?.stringValue == "native-history-fallback" {
                base["payload"] = .object(["reason": .string("native-history-fallback")])
                return [.object(base)]
            }
            guard let message = Self.boundedMetadata(payload["message"]?.stringValue, maximum: 500) else {
                return []
            }
            var warning: [String: JSONValue] = ["message": .string(message)]
            if let commandID = Self.opaque(payload["commandId"]?.stringValue, maximum: 160) {
                warning["commandId"] = .string(commandID)
            } else if payload["commandId"] != nil, payload["commandId"] != .null {
                return []
            }
            base["payload"] = .object(warning)
            return [.object(base)]

        default:
            // connector.ready, connector.stopped, session.started, unknown
            // runtime additions, and raw item types are not server events.
            return []
        }
    }

    private func makeEventMessage(
        connectorID: String,
        sessionID: String,
        messageID: String,
        role: String,
        text: String,
        observedAt: String,
        journal: inout LiveAISyncJournalSnapshot
    ) throws -> JSONValue {
        let base: [String: JSONValue] = [
            "messageId": .string(messageID),
            "role": .string(role),
            "text": .string(text),
            "createdAt": .null,
            "completedAt": .string(observedAt)
        ]
        let revision = try revision(
            key: Self.trackingKey("message", connectorID, sessionID, messageID),
            value: .object(base),
            journal: &journal
        )
        var result = base
        result["revision"] = .number(Double(revision))
        return .object(result)
    }

    // MARK: - Outbox

    private func appendEvent(
        _ prototype: JSONValue,
        connectorID: String,
        sessionID: String,
        journal: inout LiveAISyncJournalSnapshot
    ) throws {
        if try coalesceDelta(
            prototype,
            connectorID: connectorID,
            sessionID: sessionID,
            journal: &journal
        ) {
            return
        }
        guard Self.pendingEventCount(journal) < configuration.maximumPendingEvents else {
            throw LiveAISyncError.pendingEventCapacityReached
        }

        let sequenceKey = Self.trackingKey("sequence", connectorID, sessionID)
        let sequence = journal.nextSequences[sequenceKey] ?? 1
        guard sequence > 0, sequence < Int.max else { throw LiveAISyncError.corruptJournal }
        var event = try Self.requireObject(prototype)
        event["eventId"] = .string("event-\(UUID().uuidString.lowercased())")
        event["sequence"] = .number(Double(sequence))
        let finalized = JSONValue.object(event)

        if let lastIndex = journal.outbox.indices.last,
           !journal.outbox[lastIndex].sealed,
           Self.canAppendEvent(
            finalized,
            connectorID: connectorID,
            sessionID: sessionID,
            request: journal.outbox[lastIndex]
           ) {
            var requestObject = try Self.requireObject(journal.outbox[lastIndex].payload)
            var events = try Self.requireArray(requestObject["events"])
            events.append(finalized)
            requestObject["events"] = .array(events)
            journal.outbox[lastIndex].payload = .object(requestObject)
            journal.outbox[lastIndex].eventCount += 1
        } else {
            let payload = JSONValue.object([
                "op": .string("events.append"),
                "connectorId": .string(connectorID),
                "sessionId": .string(sessionID),
                "events": .array([finalized])
            ])
            try appendRequest(payload, eventCount: 1, journal: &journal)
        }
        journal.nextSequences[sequenceKey] = sequence + 1
    }

    private func coalesceDelta(
        _ prototype: JSONValue,
        connectorID: String,
        sessionID: String,
        journal: inout LiveAISyncJournalSnapshot
    ) throws -> Bool {
        guard let index = journal.outbox.indices.last,
              !journal.outbox[index].sealed,
              let prototypeObject = prototype.objectValue,
              prototypeObject["type"]?.stringValue == "message.delta",
              var requestObject = journal.outbox[index].payload.objectValue,
              requestObject["op"]?.stringValue == "events.append",
              requestObject["connectorId"]?.stringValue == connectorID,
              requestObject["sessionId"]?.stringValue == sessionID,
              case var .array(events)? = requestObject["events"],
              let last = events.last?.objectValue,
              last["type"]?.stringValue == "message.delta",
              last["turnId"] == prototypeObject["turnId"],
              last["itemId"] == prototypeObject["itemId"],
              var lastPayload = last["payload"]?.objectValue,
              let oldDelta = lastPayload["delta"]?.stringValue,
              let newDelta = prototypeObject["payload"]?.objectValue?["delta"]?.stringValue,
              Self.scalarCount(oldDelta) + Self.scalarCount(newDelta) <= Self.maximumDeltaCharacters,
              Self.batchDeltaCount(events) + Self.scalarCount(newDelta) <= Self.maximumBatchDeltaCharacters else {
            return false
        }
        lastPayload["delta"] = .string(oldDelta + newDelta)
        var updatedLast = last
        updatedLast["payload"] = .object(lastPayload)
        events[events.count - 1] = .object(updatedLast)
        requestObject["events"] = .array(events)
        journal.outbox[index].payload = .object(requestObject)
        return true
    }

    private func appendRequest(
        _ payload: JSONValue,
        eventCount: Int,
        journal: inout LiveAISyncJournalSnapshot
    ) throws {
        guard journal.outbox.count < configuration.maximumOutboxRequests else {
            throw LiveAISyncError.outboxCapacityReached
        }
        journal.outbox.append(PendingLiveAISyncRequest(
            requestID: UUID().uuidString.lowercased(),
            payload: payload,
            sealed: false,
            eventCount: eventCount
        ))
    }

    private func revision(
        key: String,
        value: JSONValue,
        journal: inout LiveAISyncJournalSnapshot
    ) throws -> Int {
        let fingerprint = try Self.fingerprint(value)
        if var existing = journal.revisions[key] {
            if existing.fingerprint == fingerprint { return existing.revision }
            guard existing.revision < Int.max else { throw LiveAISyncError.corruptJournal }
            existing.revision += 1
            existing.fingerprint = fingerprint
            journal.revisions[key] = existing
            return existing.revision
        }
        guard journal.revisions.count < configuration.maximumTrackedRevisions else {
            throw LiveAISyncError.revisionCapacityReached
        }
        journal.revisions[key] = LiveAISyncRevision(revision: 1, fingerprint: fingerprint)
        return 1
    }

    private func commit(_ next: LiveAISyncJournalSnapshot) throws {
        try Self.validate(next, configuration: configuration)
        let directory = fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(next)
        try data.write(to: fileURL, options: .atomic)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o600],
            ofItemAtPath: fileURL.path
        )
        journal = next
    }

    // MARK: - Closed-schema helpers

    private static func sessionsPayload(connectorID: String, sessions: [JSONValue]) -> JSONValue {
        .object([
            "op": .string("sessions.upsert"),
            "connectorId": .string(connectorID),
            "sessions": .array(sessions)
        ])
    }

    private static func transcriptChunks(_ entries: [JSONValue]) -> [[JSONValue]] {
        var chunks: [[JSONValue]] = []
        var current: [JSONValue] = []
        var textCount = 0
        for entry in entries {
            let nextTextCount = messageTextCount(entry)
            if !current.isEmpty,
               (current.count >= maximumBatchCount || textCount + nextTextCount > maximumBatchTextCharacters) {
                chunks.append(current)
                current = []
                textCount = 0
            }
            current.append(entry)
            textCount += nextTextCount
        }
        if !current.isEmpty { chunks.append(current) }
        return chunks
    }

    private static func safeTurn(_ value: JSONValue?, expectedID: String) -> JSONValue? {
        guard let object = value?.objectValue,
              let id = opaque(object["id"]?.stringValue, maximum: 160),
              id == expectedID,
              let status = boundedMetadata(object["status"]?.stringValue, maximum: 64) else { return nil }
        return .object(["id": .string(id), "status": .string(status)])
    }

    private static func safeItem(_ value: JSONValue?, outerItemID: String?) -> SafeLiveItem? {
        guard let object = value?.objectValue,
              let type = object["type"]?.stringValue else { return nil }
        let embeddedID = optionalOpaqueLossy(object["id"], maximum: 160)
        guard let itemID = outerItemID ?? embeddedID,
              embeddedID == nil || outerItemID == nil || embeddedID == outerItemID else { return nil }

        if type == "agentMessage" || type == "userMessage" {
            guard let text = preservedText(
                object["text"]?.stringValue,
                maximum: maximumTextCharacters,
                allowEmpty: true,
                requireVisible: false
            ) else { return nil }
            let role = type == "agentMessage" ? "assistant" : "user"
            return SafeLiveItem(
                itemID: itemID,
                value: .object([
                    "id": .string(itemID),
                    "type": .string(type),
                    "text": .string(text)
                ]),
                kind: .visible(role: role, text: text)
            )
        }

        let activities = Set([
            "plan", "commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall", "webSearch"
        ])
        guard type == "activity",
              let activity = object["activity"]?.stringValue,
              activities.contains(activity),
              let label = boundedMetadata(object["label"]?.stringValue, maximum: 160),
              let status = boundedMetadata(object["status"]?.stringValue, maximum: 64) else { return nil }
        return SafeLiveItem(
            itemID: itemID,
            value: .object([
                "id": .string(itemID),
                "type": .string("activity"),
                "activity": .string(activity),
                "label": .string(label),
                "status": .string(status)
            ]),
            kind: .activity
        )
    }

    private static func canAppendEvent(
        _ event: JSONValue,
        connectorID: String,
        sessionID: String,
        request: PendingLiveAISyncRequest
    ) -> Bool {
        guard request.eventCount < maximumBatchCount,
              let object = request.payload.objectValue,
              object["op"]?.stringValue == "events.append",
              object["connectorId"]?.stringValue == connectorID,
              object["sessionId"]?.stringValue == sessionID,
              case let .array(events)? = object["events"] else { return false }
        return batchDeltaCount(events) + deltaTextCount(event) <= maximumBatchDeltaCharacters &&
            batchMessageCount(events) + messageTextCount(event) <= maximumBatchTextCharacters
    }

    private static func batchDeltaCount(_ events: [JSONValue]) -> Int {
        events.reduce(0) { $0 + deltaTextCount($1) }
    }

    private static func deltaTextCount(_ event: JSONValue) -> Int {
        guard let object = event.objectValue,
              object["type"]?.stringValue == "message.delta",
              let delta = object["payload"]?.objectValue?["delta"]?.stringValue else { return 0 }
        return scalarCount(delta)
    }

    private static func batchMessageCount(_ events: [JSONValue]) -> Int {
        events.reduce(0) { $0 + messageTextCount($1) }
    }

    private static func messageTextCount(_ value: JSONValue) -> Int {
        guard let text = value.objectValue?["message"]?.objectValue?["text"]?.stringValue ??
                (value.objectValue?["type"]?.stringValue == "message"
                    ? value.objectValue?["text"]?.stringValue
                    : nil) else { return 0 }
        return scalarCount(text)
    }

    private static func scalarChunks(_ value: String, maximum: Int) -> [String] {
        guard scalarCount(value) > maximum else { return [value] }
        var chunks: [String] = []
        var current = String.UnicodeScalarView()
        for scalar in value.unicodeScalars {
            if current.count == maximum {
                chunks.append(String(current))
                current = String.UnicodeScalarView()
            }
            current.append(scalar)
        }
        if !current.isEmpty { chunks.append(String(current)) }
        return chunks
    }

    private static func scalarCount(_ value: String) -> Int {
        value.unicodeScalars.count
    }

    private static func containsInternalContext(_ value: String) -> Bool {
        let range = NSRange(value.startIndex ..< value.endIndex, in: value)
        return internalContextPattern.firstMatch(in: value, range: range) != nil ||
            internalContextStreamPattern.firstMatch(in: value, range: range) != nil
    }

    private static func splitStreamGuard(_ value: String) -> (visible: String, tail: String) {
        let scalars = Array(value.unicodeScalars)
        guard scalars.count > streamGuardTailCharacters else { return ("", value) }
        let boundary = scalars.count - streamGuardTailCharacters
        return (
            String(String.UnicodeScalarView(scalars[..<boundary])),
            String(String.UnicodeScalarView(scalars[boundary...]))
        )
    }

    private static func preservedText(
        _ value: String?,
        maximum: Int,
        allowEmpty: Bool = false,
        requireVisible: Bool
    ) -> String? {
        guard let value,
              (maximum == Int.max || scalarCount(value) <= maximum),
              !containsInternalContext(value),
              !value.unicodeScalars.contains(where: { scalar in
                let code = scalar.value
                return (code < 32 && code != 9 && code != 10 && code != 13) || code == 127
              }),
              allowEmpty || !value.isEmpty,
              !requireVisible || !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        return value
    }

    private static func boundedMetadata(_ value: String?, maximum: Int) -> String? {
        guard let preserved = preservedText(value, maximum: Int.max, requireVisible: true) else { return nil }
        let trimmed = preserved.trimmingCharacters(in: .whitespacesAndNewlines)
        return String(trimmed.unicodeScalars.prefix(maximum))
    }

    private static func optionalMetadata(_ value: JSONValue?, maximum: Int) -> String? {
        guard value != nil, value != .null else { return nil }
        return boundedMetadata(value?.stringValue, maximum: maximum)
    }

    private static func opaque(_ value: String?, maximum: Int = maximumIDCharacters) -> String? {
        guard let value else { return nil }
        let result = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !result.isEmpty,
              result.utf16.count <= maximum,
              !result.unicodeScalars.contains(where: { scalar in
                scalar.value < 32 || scalar.value == 127 || scalar == "/" || scalar == "\\"
              }) else { return nil }
        return result
    }

    private static func optionalCursor(_ value: JSONValue?) throws -> String? {
        guard value != nil, value != .null else { return nil }
        guard let cursor = value?.stringValue,
              !cursor.isEmpty,
              scalarCount(cursor) <= maximumCursorCharacters,
              cursor == cursor.trimmingCharacters(in: .whitespacesAndNewlines),
              preservedText(
                cursor,
                maximum: maximumCursorCharacters,
                requireVisible: false
              ) != nil else {
            throw LiveAISyncError.invalidConnectorResponse("cursor")
        }
        return cursor
    }

    private static func optionalOpaqueLossy(
        _ value: JSONValue?,
        maximum: Int = maximumIDCharacters
    ) -> String? {
        guard value != nil, value != .null else { return nil }
        return opaque(value?.stringValue, maximum: maximum)
    }

    private static func timestamp(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        let withFractional = ISO8601DateFormatter()
        withFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let withoutFractional = ISO8601DateFormatter()
        withoutFractional.formatOptions = [.withInternetDateTime]
        guard let date = withFractional.date(from: value) ?? withoutFractional.date(from: value),
              date.timeIntervalSince1970 >= 631_152_000,
              date <= Date().addingTimeInterval(86_400) else { return nil }
        return value
    }

    private static func optionalTimestampValue(_ value: JSONValue?) -> JSONValue {
        guard value != nil, value != .null,
              let valid = timestamp(value?.stringValue) else { return .null }
        return .string(valid)
    }

    private static func positiveInteger(_ value: JSONValue?) -> Int? {
        guard let number = value?.numberValue,
              number.isFinite,
              number.rounded() == number,
              number >= 1,
              number <= Double(Int.max) else { return nil }
        return Int(number)
    }

    private static func requireObject(_ value: JSONValue) throws -> [String: JSONValue] {
        guard let object = value.objectValue else { throw LiveAISyncError.corruptJournal }
        return object
    }

    private static func requireArray(_ value: JSONValue?) throws -> [JSONValue] {
        guard case let .array(values)? = value else { throw LiveAISyncError.corruptJournal }
        return values
    }

    private static func trackingKey(_ values: String...) -> String {
        let data = Data(values.joined(separator: "\u{0}").utf8)
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func deltaGuardKey(connectorID: String, sessionID: String, itemID: String) -> String {
        "\(connectorID)\u{0}\(sessionID)\u{0}\(itemID)"
    }

    private static func pairingScopeHash(_ deviceID: String) -> String {
        let data = Data("thingtime-live-ai-pairing-v1\u{0}\(deviceID)".utf8)
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func fingerprint(_ value: JSONValue) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let data = try encoder.encode(value)
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func pendingEventCount(_ journal: LiveAISyncJournalSnapshot) -> Int {
        journal.outbox.reduce(0) { $0 + $1.eventCount }
    }

    private static func validate(
        _ journal: LiveAISyncJournalSnapshot,
        configuration: LiveAISyncConfiguration
    ) throws {
        guard journal.schemaVersion == 1,
              journal.pairingScopeHash.map({ $0.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil }) ?? true,
              journal.outbox.count <= configuration.maximumOutboxRequests,
              pendingEventCount(journal) <= configuration.maximumPendingEvents,
              journal.revisions.count <= configuration.maximumTrackedRevisions,
              Set(journal.outbox.map(\.requestID)).count == journal.outbox.count,
              journal.outbox.allSatisfy({ request in
                !request.requestID.isEmpty && request.eventCount >= 0 &&
                    request.eventCount <= maximumBatchCount && request.payload.objectValue != nil
              }),
              journal.nextSequences.values.allSatisfy({ $0 >= 1 }),
              journal.revisions.values.allSatisfy({ $0.revision >= 1 && !$0.fingerprint.isEmpty }) else {
            throw LiveAISyncError.corruptJournal
        }
    }

    private static func validateTransportResponse(
        _ response: JSONValue,
        request: PendingLiveAISyncRequest
    ) throws {
        guard let responseObject = response.objectValue,
              responseObject["ok"] == .bool(true),
              let requestObject = request.payload.objectValue,
              let operation = requestObject["op"]?.stringValue,
              responseObject["op"]?.stringValue == operation else {
            throw LiveAISyncError.invalidTransportResponse
        }
        if operation == "events.append" {
            guard case let .array(events)? = requestObject["events"],
                  let lastSequence = events.last?.objectValue?["sequence"].flatMap(positiveInteger),
                  responseObject["lastSequence"].flatMap(positiveInteger) == lastSequence else {
                throw LiveAISyncError.invalidTransportResponse
            }
        }
    }
}
