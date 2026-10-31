import Foundation

public struct PairingPrepareRequest: Codable, Equatable, Sendable {
    public let pairingSecret: String
    public let publicKey: Data
    public let nonce: Data

    public init(pairingSecret: String, publicKey: Data, nonce: Data) {
        self.pairingSecret = pairingSecret
        self.publicKey = publicKey
        self.nonce = nonce
    }
}

public struct PairingPrepareResponse: Codable, Equatable, Sendable {
    public let pairingID: String
    public let serverNonce: Data
    public let expiresAt: Date

    public init(pairingID: String, serverNonce: Data, expiresAt: Date) {
        self.pairingID = pairingID
        self.serverNonce = serverNonce
        self.expiresAt = expiresAt
    }
}

public struct PairingDeviceDescriptor: Codable, Equatable, Sendable {
    public let name: String
    public let platform: String
    public let model: String?
    public let osVersion: String
    public let appVersion: String

    public init(name: String, platform: String, model: String?, osVersion: String, appVersion: String) {
        self.name = name
        self.platform = platform
        self.model = model
        self.osVersion = osVersion
        self.appVersion = appVersion
    }
}

public struct PairingClaimProof: Codable, Equatable, Sendable {
    public static let version = "thingtime-device-pairing-claim-v1"

    public let pairingID: String
    public let publicKey: Data
    public let nonce: Data
    public let serverNonce: Data
    public let signature: Data

    public init(pairingID: String, publicKey: Data, nonce: Data, serverNonce: Data, signature: Data) {
        self.pairingID = pairingID
        self.publicKey = publicKey
        self.nonce = nonce
        self.serverNonce = serverNonce
        self.signature = signature
    }

    public static func canonicalMessage(
        pairingID: String,
        pairingSecret: String,
        credential: String,
        publicKey: Data,
        nonce: Data,
        serverNonce: Data,
        device: PairingDeviceDescriptor,
        capabilities: [String]
    ) -> Data {
        let fields = [
            version,
            pairingID,
            pairingSecret,
            credential,
            publicKey.base64URLEncodedString(),
            nonce.base64URLEncodedString(),
            serverNonce.base64URLEncodedString(),
            device.name,
            device.platform,
            device.model ?? "",
            device.osVersion,
            device.appVersion,
            String(capabilities.count)
        ] + capabilities
        var message = Data()
        for field in fields {
            let bytes = Data(field.utf8)
            message.append(Data("\(bytes.count):".utf8))
            message.append(bytes)
        }
        return message
    }
}

public struct PairingClaimRequest: Codable, Equatable, Sendable {
    public let pairingSecret: String
    public let credential: String
    public let device: PairingDeviceDescriptor
    public let capabilities: [String]
    public let proof: PairingClaimProof

    public init(
        pairingSecret: String,
        credential: String,
        device: PairingDeviceDescriptor,
        capabilities: [String],
        proof: PairingClaimProof
    ) {
        self.pairingSecret = pairingSecret
        self.credential = credential
        self.device = device
        self.capabilities = capabilities
        self.proof = proof
    }
}

public struct PairingClaimResponse: Codable, Equatable, Sendable {
    public let deviceID: String
    public let refreshToken: String

    public init(deviceID: String, refreshToken: String) {
        self.deviceID = deviceID
        self.refreshToken = refreshToken
    }
}

public struct DeviceHeartbeat: Codable, Equatable, Sendable {
    public let deviceID: String
    public let telemetry: DeviceTelemetry
    public let connector: ConnectorRuntimeHealth
    public let connectorProjects: [ConnectorProjectReference]
    public let additionalConnectors: [DesktopChatRuntimeConnector]
    public let observedAt: Date

    public init(
        deviceID: String,
        telemetry: DeviceTelemetry,
        connector: ConnectorRuntimeHealth,
        connectorProjects: [ConnectorProjectReference] = [],
        additionalConnectors: [DesktopChatRuntimeConnector] = [],
        observedAt: Date = Date()
    ) {
        self.deviceID = deviceID
        self.telemetry = telemetry
        self.connector = connector
        self.connectorProjects = connectorProjects
        self.additionalConnectors = additionalConnectors
        self.observedAt = observedAt
    }
}

public struct CommandLeaseRequest: Codable, Equatable, Sendable {
    public let deviceID: String
    public let maximumCommands: Int
    public let waitSeconds: Int

    public init(deviceID: String, maximumCommands: Int = 8, waitSeconds: Int = 25) {
        self.deviceID = deviceID
        self.maximumCommands = min(max(1, maximumCommands), 32)
        self.waitSeconds = min(max(0, waitSeconds), 30)
    }
}

public struct LeasedCommand: Codable, Equatable, Sendable {
    public let commandID: String
    public let leaseID: String
    public let method: String
    public let parameters: JSONValue
    public let leaseExpiresAt: Date
    public let approvedForExecution: Bool

    public init(
        commandID: String,
        leaseID: String,
        method: String,
        parameters: JSONValue,
        leaseExpiresAt: Date,
        approvedForExecution: Bool = false
    ) {
        self.commandID = commandID
        self.leaseID = leaseID
        self.method = method
        self.parameters = parameters
        self.leaseExpiresAt = leaseExpiresAt
        self.approvedForExecution = approvedForExecution
    }
}

public struct CommandLeaseBatch: Codable, Equatable, Sendable {
    public let commands: [LeasedCommand]

    public init(commands: [LeasedCommand]) {
        self.commands = commands
    }
}

public enum CommandReportStatus: String, Codable, Equatable, Sendable {
    case succeeded
    case failed
    case uncertain
}

public struct CommandExecutionReport: Codable, Equatable, Sendable {
    public let commandID: String
    public let leaseID: String
    public let status: CommandReportStatus
    public let response: NodeResponse
    public let completedAt: Date

    public init(
        commandID: String,
        leaseID: String,
        status: CommandReportStatus,
        response: NodeResponse,
        completedAt: Date = Date()
    ) {
        self.commandID = commandID
        self.leaseID = leaseID
        self.status = status
        self.response = response
        self.completedAt = completedAt
    }
}

/// Injectable boundary for the authenticated Thingtime HTTPS API. The core
/// deliberately makes no URLSession, endpoint, or token-refresh assumptions.
public protocol ControlPlaneClient: Sendable {
    func preparePairing(_ request: PairingPrepareRequest) async throws -> PairingPrepareResponse
    func claimPairing(_ request: PairingClaimRequest) async throws -> PairingClaimResponse
    func sendHeartbeat(_ heartbeat: DeviceHeartbeat) async throws
    func leaseCommands(_ request: CommandLeaseRequest) async throws -> CommandLeaseBatch
    func heartbeatCommand(commandID: String, leaseID: String) async throws -> Date
    func reportCommand(_ report: CommandExecutionReport) async throws
}

public struct ControlPlaneSchedulerHooks: Sendable {
    public let makeHeartbeat: @Sendable () async throws -> DeviceHeartbeat
    public let dispatchCommand: @Sendable (LeasedCommand) async -> NodeResponse
    public let reportError: @Sendable (Error) -> Void

    public init(
        makeHeartbeat: @escaping @Sendable () async throws -> DeviceHeartbeat,
        dispatchCommand: @escaping @Sendable (LeasedCommand) async -> NodeResponse,
        reportError: @escaping @Sendable (Error) -> Void = { _ in }
    ) {
        self.makeHeartbeat = makeHeartbeat
        self.dispatchCommand = dispatchCommand
        self.reportError = reportError
    }
}

/// Heartbeats, long-polls leases, journal-dispatches commands, and reports the
/// terminal result. `runOnce` remains serial for deterministic host use. The
/// production loop tracks a bounded set of queue waits separately so a remote
/// steer, interrupt, or approval can overtake a chat turn waiting to become idle.
public actor ControlPlaneScheduler {
    private enum TrackedLane {
        case queueWait
        case serial
        case rejected
    }

    private struct TrackedCommand {
        let token: UUID
        let task: Task<Void, Never>
        let lane: TrackedLane
    }

    private let client: any ControlPlaneClient
    private let hooks: ControlPlaneSchedulerHooks
    private let leaseHeartbeatInterval: Duration
    private let maximumConcurrentCommands: Int
    private let maximumConcurrentQueueWaits: Int
    private var loopTask: Task<Void, Never>?
    private var trackedCommands: [UUID: TrackedCommand] = [:]
    private var queueWaitTokens = Set<UUID>()
    private var serialTail: (token: UUID, task: Task<Void, Never>)?

    public init(
        client: any ControlPlaneClient,
        hooks: ControlPlaneSchedulerHooks,
        leaseHeartbeatInterval: Duration = .seconds(10),
        maximumConcurrentCommands: Int = 16,
        maximumConcurrentQueueWaits: Int = 8
    ) {
        self.client = client
        self.hooks = hooks
        self.leaseHeartbeatInterval = leaseHeartbeatInterval
        self.maximumConcurrentCommands = min(max(1, maximumConcurrentCommands), 32)
        self.maximumConcurrentQueueWaits = min(
            max(1, maximumConcurrentQueueWaits),
            self.maximumConcurrentCommands
        )
    }

    public func runOnce(now: Date = Date()) async throws {
        let heartbeat = try await hooks.makeHeartbeat()
        do {
            try await client.sendHeartbeat(heartbeat)
        } catch {
            hooks.reportError(error)
        }
        try Task.checkCancellation()
        let batch = try await client.leaseCommands(CommandLeaseRequest(deviceID: heartbeat.deviceID))
        for command in batch.commands {
            if command.leaseExpiresAt <= now { continue }
            try await executeAndReport(command)
        }
    }

    private func executeAndReport(
        _ command: LeasedCommand,
        waitFor predecessor: Task<Void, Never>? = nil,
        forcedResponse: NodeResponse? = nil
    ) async throws {
        let (response, renewalError) = await dispatchWithLeaseHeartbeat(
            command,
            waitFor: predecessor,
            forcedResponse: forcedResponse
        )
        try Task.checkCancellation()
        let status: CommandReportStatus
        let reportResponse: NodeResponse
        if let renewalError {
            hooks.reportError(renewalError)
            status = .uncertain
            reportResponse = .failure(
                id: command.leaseID,
                code: ThingtimeNodeError.commandOutcomeUncertain.code,
                message: "The command lease heartbeat failed while the command was executing; its outcome requires review."
            )
        } else if response.ok {
            status = .succeeded
            reportResponse = response
        } else if response.error?.code == ThingtimeNodeError.commandOutcomeUncertain.code {
            status = .uncertain
            reportResponse = response
        } else {
            status = .failed
            reportResponse = response
        }
        try await client.reportCommand(CommandExecutionReport(
            commandID: command.commandID,
            leaseID: command.leaseID,
            status: status,
            response: reportResponse
        ))
    }

    private func dispatchWithLeaseHeartbeat(
        _ command: LeasedCommand,
        waitFor predecessor: Task<Void, Never>? = nil,
        forcedResponse: NodeResponse? = nil
    ) async -> (NodeResponse, Error?) {
        let client = client
        let interval = leaseHeartbeatInterval
        let renewalTask = Task { () -> Error? in
            while !Task.isCancelled {
                do {
                    try await Task.sleep(for: interval)
                } catch {
                    return nil
                }
                guard !Task.isCancelled else { return nil }
                do {
                    _ = try await client.heartbeatCommand(commandID: command.commandID, leaseID: command.leaseID)
                } catch {
                    if Task.isCancelled { return nil }
                    return error
                }
            }
            return nil
        }
        let hooks = hooks
        let dispatchTask = Task { () -> NodeResponse in
            if let predecessor { await predecessor.value }
            guard !Task.isCancelled else {
                return .failure(
                    id: command.leaseID,
                    code: ThingtimeNodeError.commandOutcomeUncertain.code,
                    message: "Command execution was cancelled before its outcome was known."
                )
            }
            if let forcedResponse { return forcedResponse }
            return await hooks.dispatchCommand(command)
        }
        let renewalWatcher = Task {
            if await renewalTask.value != nil {
                dispatchTask.cancel()
            }
        }
        return await withTaskCancellationHandler {
            let response = await dispatchTask.value
            renewalTask.cancel()
            let renewalError = await renewalTask.value
            renewalWatcher.cancel()
            _ = await renewalWatcher.value
            return (response, renewalError)
        } onCancel: {
            dispatchTask.cancel()
            renewalTask.cancel()
            renewalWatcher.cancel()
        }
    }

    private nonisolated static func isQueueWait(_ command: LeasedCommand) -> Bool {
        command.method == "session.send"
            && command.parameters.objectValue?["delivery"]?.stringValue == "queue"
    }

    private func pollAndSchedule() async throws {
        let heartbeat = try await hooks.makeHeartbeat()
        do {
            try await client.sendHeartbeat(heartbeat)
        } catch {
            hooks.reportError(error)
        }
        try Task.checkCancellation()
        let available = maximumConcurrentCommands - trackedCommands.count
        guard available > 0 else { return }
        let batch = try await client.leaseCommands(CommandLeaseRequest(
            deviceID: heartbeat.deviceID,
            maximumCommands: available
        ))
        try Task.checkCancellation()
        let now = Date()
        for command in batch.commands {
            if command.leaseExpiresAt <= now { continue }
            schedule(command)
        }
    }

    private func schedule(_ command: LeasedCommand) {
        let token = UUID()
        let isQueueWait = Self.isQueueWait(command)
        let lane: TrackedLane
        let predecessor: Task<Void, Never>?
        let forcedResponse: NodeResponse?
        if isQueueWait, queueWaitTokens.count >= maximumConcurrentQueueWaits {
            lane = .rejected
            predecessor = nil
            forcedResponse = .failure(
                id: command.leaseID,
                code: ThingtimeNodeError.policyDenied("queue capacity").code,
                message: "This node already has the maximum number of queued chat sends waiting for delivery."
            )
        } else if isQueueWait {
            lane = .queueWait
            predecessor = nil
            forcedResponse = nil
        } else {
            lane = .serial
            predecessor = serialTail?.task
            forcedResponse = nil
        }

        let task = Task { [weak self] in
            guard let self else { return }
            await self.executeTracked(
                command,
                token: token,
                waitFor: predecessor,
                forcedResponse: forcedResponse
            )
        }
        let tracked = TrackedCommand(token: token, task: task, lane: lane)
        trackedCommands[token] = tracked
        if lane == .queueWait { queueWaitTokens.insert(token) }
        if lane == .serial { serialTail = (token, task) }
    }

    private func executeTracked(
        _ command: LeasedCommand,
        token: UUID,
        waitFor predecessor: Task<Void, Never>?,
        forcedResponse: NodeResponse?
    ) async {
        defer { finishTracked(token) }
        do {
            try await executeAndReport(
                command,
                waitFor: predecessor,
                forcedResponse: forcedResponse
            )
        } catch {
            if !Task.isCancelled { hooks.reportError(error) }
        }
    }

    private func finishTracked(_ token: UUID) {
        guard let tracked = trackedCommands.removeValue(forKey: token) else { return }
        if tracked.lane == .queueWait { queueWaitTokens.remove(token) }
        if serialTail?.token == token { serialTail = nil }
    }

    public func start(delayBetweenPolls: Duration = .seconds(5)) {
        guard loopTask == nil else { return }
        loopTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                do {
                    try await self.pollAndSchedule()
                } catch {
                    if Task.isCancelled { return }
                    await self.report(error)
                }
                do {
                    try await Task.sleep(for: delayBetweenPolls)
                } catch {
                    return
                }
            }
        }
    }

    public func stop() async {
        let loop = loopTask
        loopTask = nil
        loop?.cancel()
        trackedCommands.values.forEach { $0.task.cancel() }
        await loop?.value
        let tasks = trackedCommands.values.map(\.task)
        tasks.forEach { $0.cancel() }
        for task in tasks { await task.value }
        trackedCommands.removeAll()
        queueWaitTokens.removeAll()
        serialTail = nil
    }

    private func report(_ error: Error) {
        hooks.reportError(error)
    }
}
