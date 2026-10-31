import Foundation

public enum ConnectorRuntimeState: String, Codable, Equatable, Sendable {
    case disabled
    case stopped
    case starting
    case running
    case degraded
    case failed
}

public struct ConnectorRuntimeHealth: Codable, Equatable, Sendable {
    public let state: ConnectorRuntimeState
    public let detail: String?
    public let processIdentifier: Int32?

    public init(state: ConnectorRuntimeState, detail: String? = nil, processIdentifier: Int32? = nil) {
        self.state = state
        self.detail = detail
        self.processIdentifier = processIdentifier
    }
}

public struct ConnectorProjectReference: Codable, Equatable, Sendable {
    public let projectId: String
    public let projectLabel: String

    public init(projectId: String, projectLabel: String) {
        self.projectId = projectId
        self.projectLabel = projectLabel
    }
}

public struct ConnectorRuntimeConfiguration: Equatable, Sendable {
    public let executableURL: URL
    public let arguments: [String]
    public let environment: [String: String]
    public let maximumFrameBytes: Int
    public let requestTimeoutSeconds: Double

    public init(
        executableURL: URL,
        arguments: [String] = [],
        environment: [String: String] = [:],
        maximumFrameBytes: Int = 1_048_576,
        requestTimeoutSeconds: Double = 60
    ) throws {
        guard executableURL.isFileURL, executableURL.path.hasPrefix("/") else {
            throw ThingtimeNodeError.invalidRequest("Connector executable must be an absolute file URL.")
        }
        guard maximumFrameBytes >= 1_024, maximumFrameBytes <= 16_777_216 else {
            throw ThingtimeNodeError.invalidRequest("Connector frame limit must be between 1 KiB and 16 MiB.")
        }
        guard requestTimeoutSeconds >= 1, requestTimeoutSeconds <= 300 else {
            throw ThingtimeNodeError.invalidRequest("Connector timeout must be between 1 and 300 seconds.")
        }
        self.executableURL = executableURL
        self.arguments = arguments
        self.environment = environment
        self.maximumFrameBytes = maximumFrameBytes
        self.requestTimeoutSeconds = requestTimeoutSeconds
    }
}

public struct ConnectorCommand: Codable, Equatable, Sendable {
    public let type: String
    public let id: String
    public let operation: String
    public let payload: JSONValue

    public init(id: String = UUID().uuidString, operation: String, payload: JSONValue = .object([:])) {
        self.type = "command"
        self.id = id
        self.operation = operation
        self.payload = payload
    }
}

public struct ConnectorReply: Codable, Equatable, Sendable {
    public let id: String
    public let ok: Bool
    public let result: JSONValue?
    public let error: NodeErrorPayload?
}

public struct ConnectorEvent: Codable, Equatable, Sendable {
    public let event: String
    public let payload: JSONValue
}

public enum ConnectorIncomingFrame: Equatable, Sendable {
    case reply(ConnectorReply)
    case event(ConnectorEvent)
}

public enum ConnectorWireCodec {
    private struct Incoming: Decodable {
        let type: String
        let id: String?
        let ok: Bool?
        let result: JSONValue?
        let error: NodeErrorPayload?
        let event: String?
        let payload: JSONValue?
    }

    public static func encode(_ command: ConnectorCommand, maximumBytes: Int = 1_048_576) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        var data = try encoder.encode(command)
        guard data.count + 1 <= maximumBytes else {
            throw ThingtimeNodeError.connectorProtocol("Connector command exceeds the frame limit.")
        }
        data.append(0x0A)
        return data
    }

    public static func decode(_ line: Data, maximumBytes: Int = 1_048_576) throws -> ConnectorIncomingFrame {
        guard !line.isEmpty, line.count <= maximumBytes else {
            throw ThingtimeNodeError.connectorProtocol("Connector frame is empty or exceeds the frame limit.")
        }
        let incoming = try JSONDecoder().decode(Incoming.self, from: line)
        switch incoming.type {
        case "reply":
            guard let id = incoming.id, let ok = incoming.ok else {
                throw ThingtimeNodeError.connectorProtocol("Connector reply is missing id or ok.")
            }
            return .reply(ConnectorReply(id: id, ok: ok, result: incoming.result, error: incoming.error))
        case "event":
            guard let event = incoming.event else {
                throw ThingtimeNodeError.connectorProtocol("Connector event is missing its name.")
            }
            return .event(ConnectorEvent(event: event, payload: incoming.payload ?? .object([:])))
        default:
            throw ThingtimeNodeError.connectorProtocol("Unknown connector frame type.")
        }
    }
}

public actor ConnectorRuntime {
    private static let queuedSendRequestTimeoutSeconds: Double = 31 * 60 + 15

    nonisolated static func requestTimeoutSeconds(
        for command: ConnectorCommand,
        defaultSeconds: Double
    ) -> Double {
        command.operation == "session/send"
            && command.payload.objectValue?["mode"]?.stringValue == "queue"
            ? queuedSendRequestTimeoutSeconds
            : defaultSeconds
    }

    private struct PendingRequest {
        let continuation: CheckedContinuation<ConnectorReply, Error>
        let timeoutTask: Task<Void, Never>
    }

    private let configuration: ConnectorRuntimeConfiguration?
    private var runtimeGeneration: UUID?
    private var process: Process?
    private var input: FileHandle?
    private var output: FileHandle?
    private var readTask: Task<Void, Never>?
    private var buffer = Data()
    private var healthValue: ConnectorRuntimeHealth
    private var projectReferencesValue: [ConnectorProjectReference] = []
    private var pending: [String: PendingRequest] = [:]
    private var eventContinuations: [UUID: AsyncStream<ConnectorEvent>.Continuation] = [:]

    public init(configuration: ConnectorRuntimeConfiguration?) {
        self.configuration = configuration
        self.healthValue = ConnectorRuntimeHealth(state: configuration == nil ? .disabled : .stopped)
    }

    public func health() -> ConnectorRuntimeHealth { healthValue }

    public func cachedProjectReferences() -> [ConnectorProjectReference] {
        projectReferencesValue
    }

    /// Refreshes the path-free project vocabulary once the connector runtime
    /// is running. Heartbeats read the cached value so a slow subprocess can
    /// never block device presence or command leasing.
    public func refreshProjectReferences(connectorID: String = "codex-app-server") async throws {
        let reply = try await send(ConnectorCommand(operation: "connector/list"))
        guard reply.ok, let result = reply.result else {
            throw ThingtimeNodeError.connectorProtocol("Connector list was rejected.")
        }
        projectReferencesValue = try Self.parseProjectReferences(
            result,
            connectorID: connectorID
        )
    }

    public nonisolated static func parseProjectReferences(
        _ result: JSONValue,
        connectorID: String
    ) throws -> [ConnectorProjectReference] {
        guard let root = result.objectValue,
              Set(root.keys) == ["connectors"],
              let connectorValue = root["connectors"],
              case let .array(connectors) = connectorValue,
              connectors.count <= 16 else {
            throw ThingtimeNodeError.connectorProtocol("Connector list has an invalid shape.")
        }

        guard let selected = connectors.compactMap(\.objectValue).first(where: {
            $0["id"]?.stringValue == connectorID
        }) else {
            return []
        }
        guard Set(selected.keys).isSubset(of: ["id", "label", "capabilities", "projects"]),
              let projectValue = selected["projects"],
              case let .array(projects) = projectValue,
              projects.count <= 128 else {
            throw ThingtimeNodeError.connectorProtocol("Connector projects have an invalid shape.")
        }

        var seen = Set<String>()
        return try projects.map { project in
            guard let value = project.objectValue,
                  Set(value.keys) == ["projectId", "projectLabel"],
                  let projectID = value["projectId"]?.stringValue,
                  let projectLabel = value["projectLabel"]?.stringValue,
                  !projectID.isEmpty,
                  projectID.utf8.count <= 128,
                  projectID.range(of: #"^[A-Za-z0-9][A-Za-z0-9._-]*$"#, options: .regularExpression) != nil,
                  validProjectLabel(projectLabel),
                  seen.insert(projectID).inserted else {
                throw ThingtimeNodeError.connectorProtocol("Connector project reference is invalid.")
            }
            return ConnectorProjectReference(projectId: projectID, projectLabel: projectLabel)
        }
    }

    /// Extracts only path-free project references from a bounded session page.
    /// Session list replies may contain many sessions for one project, so
    /// matching duplicate id/label pairs collapse while conflicting labels or
    /// unexpected fields fail closed.
    public nonisolated static func parseSessionProjectReferences(
        _ result: JSONValue
    ) throws -> [ConnectorProjectReference] {
        guard let root = result.objectValue,
              Set(root.keys) == ["sessions", "nextCursor"],
              case let .array(sessions)? = root["sessions"],
              sessions.count <= 100 else {
            throw ThingtimeNodeError.connectorProtocol("Session list has an invalid shape.")
        }
        let allowedKeys = Set([
            "id", "connectorId", "title", "preview", "projectId", "projectLabel",
            "createdAt", "updatedAt", "activeTurnId", "status", "source"
        ])
        var labelsByID: [String: String] = [:]
        var references: [ConnectorProjectReference] = []
        for session in sessions {
            guard let value = session.objectValue,
                  Set(value.keys).isSubset(of: allowedKeys),
                  value["id"]?.stringValue != nil else {
                throw ThingtimeNodeError.connectorProtocol("Session project reference is invalid.")
            }
            let projectID = value["projectId"]?.stringValue
            let projectLabel = value["projectLabel"]?.stringValue
            if value["projectId"] == .null, value["projectLabel"] == .null { continue }
            guard let projectID,
                  let projectLabel,
                  !projectID.isEmpty,
                  projectID.utf8.count <= 128,
                  projectID.range(of: #"^[A-Za-z0-9][A-Za-z0-9._-]*$"#, options: .regularExpression) != nil,
                  validProjectLabel(projectLabel) else {
                throw ThingtimeNodeError.connectorProtocol("Session project reference is invalid.")
            }
            if let existing = labelsByID[projectID] {
                guard existing == projectLabel else {
                    throw ThingtimeNodeError.connectorProtocol("Session project reference is inconsistent.")
                }
                continue
            }
            labelsByID[projectID] = projectLabel
            references.append(.init(projectId: projectID, projectLabel: projectLabel))
        }
        return references
    }

    private nonisolated static func validProjectLabel(_ value: String) -> Bool {
        !value.isEmpty &&
            value == value.trimmingCharacters(in: .whitespacesAndNewlines) &&
            value.unicodeScalars.count <= 120 &&
            !value.contains("/") &&
            !value.contains("\\") &&
            !value.unicodeScalars.contains {
                $0.properties.generalCategory == .control || $0.properties.generalCategory == .format
            }
    }

    public func events() -> AsyncStream<ConnectorEvent> {
        let identifier = UUID()
        return AsyncStream { continuation in
            eventContinuations[identifier] = continuation
            continuation.onTermination = { [weak self] _ in
                Task { await self?.removeEventContinuation(identifier) }
            }
        }
    }

    public func start() throws {
        guard process == nil else { return }
        guard let configuration else {
            throw ThingtimeNodeError.connectorUnavailable("No connector runtime is configured.")
        }
        guard FileManager.default.isExecutableFile(atPath: configuration.executableURL.path) else {
            healthValue = ConnectorRuntimeHealth(state: .failed, detail: "Configured executable is unavailable.")
            throw ThingtimeNodeError.connectorUnavailable("The configured connector executable is unavailable.")
        }

        healthValue = ConnectorRuntimeHealth(state: .starting)
        let generation = UUID()
        let child = Process()
        let standardInput = Pipe()
        let standardOutput = Pipe()
        child.executableURL = configuration.executableURL
        child.arguments = configuration.arguments
        child.environment = configuration.environment
        child.standardInput = standardInput
        child.standardOutput = standardOutput
        child.standardError = FileHandle.nullDevice
        child.terminationHandler = { [weak self] terminated in
            Task {
                await self?.processTerminated(
                    generation: generation,
                    status: terminated.terminationStatus
                )
            }
        }
        do {
            try child.run()
        } catch {
            healthValue = ConnectorRuntimeHealth(state: .failed, detail: "Connector failed to start.")
            throw ThingtimeNodeError.connectorUnavailable("The connector runtime failed to start.")
        }

        runtimeGeneration = generation
        process = child
        input = standardInput.fileHandleForWriting
        healthValue = ConnectorRuntimeHealth(state: .running, processIdentifier: child.processIdentifier)
        let output = standardOutput.fileHandleForReading
        self.output = output
        let readChunkBytes = min(65_536, configuration.maximumFrameBytes + 1)
        readTask = Task.detached(priority: .utility) { [weak self] in
            // `FileHandle.read(upToCount:)` may wait for the requested byte
            // count or EOF even after a pipe becomes readable. Connectors are
            // intentionally long-lived, so consume the asynchronous byte
            // sequence instead and forward either a complete NDJSON frame or
            // a bounded partial chunk as soon as it arrives.
            var chunk = Data()
            chunk.reserveCapacity(readChunkBytes)
            do {
                for try await byte in output.bytes {
                    guard !Task.isCancelled else { return }
                    chunk.append(byte)
                    if byte == 0x0A || chunk.count >= readChunkBytes {
                        await self?.consume(chunk, generation: generation)
                        chunk.removeAll(keepingCapacity: true)
                    }
                }
                guard !Task.isCancelled else { return }
                if !chunk.isEmpty { await self?.consume(chunk, generation: generation) }
                await self?.readerReachedEOF(generation: generation)
            } catch is CancellationError {
                return
            } catch {
                guard !Task.isCancelled else { return }
                await self?.readerFailed(generation: generation)
            }
        }
    }

    public func stop() {
        let child = process
        child?.terminationHandler = nil
        runtimeGeneration = nil
        if child?.isRunning == true { child?.terminate() }
        readTask?.cancel()
        try? input?.close()
        try? output?.close()
        process = nil
        input = nil
        output = nil
        readTask = nil
        buffer.removeAll(keepingCapacity: false)
        failPending(ThingtimeNodeError.commandOutcomeUncertain)
        healthValue = ConnectorRuntimeHealth(state: configuration == nil ? .disabled : .stopped)
    }

    public func send(_ command: ConnectorCommand) async throws -> ConnectorReply {
        guard healthValue.state == .running, let input else {
            throw ThingtimeNodeError.connectorUnavailable("The connector runtime is not running.")
        }
        guard pending[command.id] == nil else {
            throw ThingtimeNodeError.invalidRequest("Connector request id is already in flight.")
        }
        let maximumBytes = configuration?.maximumFrameBytes ?? 1_048_576
        let data = try ConnectorWireCodec.encode(command, maximumBytes: maximumBytes)
        let reply: ConnectorReply = try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                // A queued Codex send intentionally remains unanswered until the
                // active turn becomes idle and app-server accepts turn/start. The
                // control plane renews its execution lease every 10 seconds; keep
                // only this request alive long enough for MCP's bounded 30-minute
                // wait plus one final app-server RPC. All other connector calls
                // retain the configured timeout.
                let timeoutSeconds = Self.requestTimeoutSeconds(
                    for: command,
                    defaultSeconds: configuration?.requestTimeoutSeconds ?? 60
                )
                let timeoutTask = Task { [weak self] in
                    do {
                        try await Task.sleep(for: .seconds(timeoutSeconds))
                    } catch {
                        return
                    }
                    await self?.requestTimedOut(command.id)
                }
                pending[command.id] = PendingRequest(continuation: continuation, timeoutTask: timeoutTask)
                do {
                    try input.write(contentsOf: data)
                } catch {
                    pending.removeValue(forKey: command.id)?.timeoutTask.cancel()
                    continuation.resume(throwing: ThingtimeNodeError.commandOutcomeUncertain)
                }
            }
        } onCancel: {
            Task { await self.cancelPendingRequest(command.id) }
        }
        if reply.ok, let result = reply.result {
            switch command.operation {
            case "connector/list":
                projectReferencesValue = try Self.parseProjectReferences(
                    result,
                    connectorID: "codex-app-server"
                )
            case "session/list":
                try mergeProjectReferences(Self.parseSessionProjectReferences(result))
            default:
                break
            }
        }
        return reply
    }

    private func mergeProjectReferences(_ discovered: [ConnectorProjectReference]) throws {
        var labelsByID = Dictionary(uniqueKeysWithValues: projectReferencesValue.map { ($0.projectId, $0.projectLabel) })
        for reference in discovered where projectReferencesValue.count < 128 {
            if let existing = labelsByID[reference.projectId] {
                guard existing == reference.projectLabel else {
                    throw ThingtimeNodeError.connectorProtocol("Session project reference conflicts with the connector list.")
                }
                continue
            }
            labelsByID[reference.projectId] = reference.projectLabel
            projectReferencesValue.append(reference)
        }
    }

    private func consume(_ data: Data, generation: UUID) {
        guard runtimeGeneration == generation else { return }
        buffer.append(data)
        let limit = configuration?.maximumFrameBytes ?? 1_048_576
        if buffer.count > limit, !buffer.contains(0x0A) {
            protocolFailed("Connector emitted an oversized frame.")
            return
        }
        while let newline = buffer.firstIndex(of: 0x0A) {
            let line = Data(buffer[..<newline])
            buffer.removeSubrange(...newline)
            if line.isEmpty { continue }
            do {
                switch try ConnectorWireCodec.decode(line, maximumBytes: limit) {
                case let .reply(reply):
                    guard let request = pending.removeValue(forKey: reply.id) else { continue }
                    request.timeoutTask.cancel()
                    request.continuation.resume(returning: reply)
                case let .event(event):
                    eventContinuations.values.forEach { $0.yield(event) }
                }
            } catch {
                protocolFailed("Connector emitted an invalid frame.")
                return
            }
        }
    }

    private func protocolFailed(_ detail: String) {
        healthValue = ConnectorRuntimeHealth(state: .degraded, detail: detail, processIdentifier: process?.processIdentifier)
        failPending(ThingtimeNodeError.commandOutcomeUncertain)
        if process?.isRunning == true { process?.terminate() }
    }

    private func readerFailed(generation: UUID) {
        guard runtimeGeneration == generation, process != nil else { return }
        healthValue = ConnectorRuntimeHealth(state: .degraded, detail: "Connector output stream failed.", processIdentifier: process?.processIdentifier)
        failPending(ThingtimeNodeError.commandOutcomeUncertain)
        if process?.isRunning == true { process?.terminate() }
    }

    private func readerReachedEOF(generation: UUID) {
        guard runtimeGeneration == generation, process != nil else { return }
        healthValue = ConnectorRuntimeHealth(state: .degraded, detail: "Connector output stream closed.", processIdentifier: process?.processIdentifier)
        failPending(ThingtimeNodeError.commandOutcomeUncertain)
        if process?.isRunning == true { process?.terminate() }
    }

    private func processTerminated(generation: UUID, status: Int32) {
        guard runtimeGeneration == generation else { return }
        readTask?.cancel()
        try? input?.close()
        try? output?.close()
        process = nil
        runtimeGeneration = nil
        input = nil
        output = nil
        readTask = nil
        failPending(ThingtimeNodeError.commandOutcomeUncertain)
        healthValue = ConnectorRuntimeHealth(state: .failed, detail: "Connector exited with status \(status).")
    }

    private func failPending(_ error: Error) {
        let requests = pending.values
        pending.removeAll()
        requests.forEach {
            $0.timeoutTask.cancel()
            $0.continuation.resume(throwing: error)
        }
    }

    private func requestTimedOut(_ identifier: String) {
        guard pending[identifier] != nil else { return }
        healthValue = ConnectorRuntimeHealth(
            state: .degraded,
            detail: "Connector command timed out; delivery outcome is uncertain.",
            processIdentifier: process?.processIdentifier
        )
        // The NDJSON protocol has no per-request cancellation. Leaving the
        // subprocess alive could allow a timed-out mutation (especially a
        // blocked queued send) to execute later, after the control plane has
        // already marked it uncertain. Terminate the runtime and fail every
        // in-flight request closed instead.
        failPending(ThingtimeNodeError.commandOutcomeUncertain)
        if process?.isRunning == true { process?.terminate() }
    }

    private func cancelPendingRequest(_ identifier: String) {
        guard pending[identifier] != nil else { return }
        healthValue = ConnectorRuntimeHealth(
            state: .degraded,
            detail: "Connector command was cancelled; delivery outcome is uncertain.",
            processIdentifier: process?.processIdentifier
        )
        failPending(ThingtimeNodeError.commandOutcomeUncertain)
        if process?.isRunning == true { process?.terminate() }
    }

    private func removeEventContinuation(_ identifier: UUID) {
        eventContinuations.removeValue(forKey: identifier)
    }
}
