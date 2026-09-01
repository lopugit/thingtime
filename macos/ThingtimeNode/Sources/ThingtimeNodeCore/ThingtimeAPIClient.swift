import CryptoKit
import Foundation
import Security

public enum ThingtimeAPIClientError: Error, LocalizedError, Equatable {
    case invalidBaseURL
    case notPaired
    case invalidResponse
    case rejected(status: Int)
    case pairingClaimOutcomeUncertain

    public var errorDescription: String? {
        switch self {
        case .invalidBaseURL: "The Thingtime API URL is invalid."
        case .notPaired: "Thingtime Node is not paired."
        case .invalidResponse: "Thingtime returned an invalid device response."
        case let .rejected(status): "Thingtime rejected the device request (HTTP \(status))."
        case .pairingClaimOutcomeUncertain: "The pairing response was not confirmed; retry the exact pending claim."
        }
    }
}

private final class ThingtimeAPIRedirectDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        guard let original = task.originalRequest?.url,
              let destination = request.url,
              original.scheme == destination.scheme,
              original.host == destination.host,
              original.port == destination.port else {
            completionHandler(nil)
            return
        }
        completionHandler(request)
    }
}

public final class ThingtimeAPIClient: ControlPlaneClient, @unchecked Sendable {
    public static let maximumOpenApplications = 64

    private struct PairingPrepareBody: Encodable {
        let op: String
        let pairingSecret: String
        let publicKey: String
        let nonce: String
    }

    private struct PairingPrepareEnvelope: Decodable {
        struct Proof: Decodable {
            let pairingId: String
            let serverNonce: String
            let expiresAt: String
        }
        let ok: Bool
        let op: String
        let proof: Proof
    }

    private struct ClaimBody: Encodable {
        struct Proof: Encodable {
            let pairingId: String
            let publicKey: String
            let nonce: String
            let serverNonce: String
            let signature: String
        }
        let op: String
        let pairingSecret: String
        let credential: String
        let device: PairingDeviceDescriptor
        let capabilities: [String]
        let proof: Proof
    }

    private struct ClaimResponse: Decodable {
        struct Device: Decodable { let id: String }
        let ok: Bool
        let device: Device
        let credentialStored: Bool
    }

    private struct StateBody: Encodable {
        struct State: Encodable {
            struct App: Encodable { let id: String; let name: String; let frontmost: Bool; let hidden: Bool }
            struct AudioDevice: Encodable {
                let id: String
                let name: String
                let hasInput: Bool
                let hasOutput: Bool
                let isDefaultInput: Bool
                let isDefaultOutput: Bool
                let isDefaultSoundEffectsOutput: Bool
            }
            struct WiFi: Encodable {
                let powerOn: Bool?
                let ssid: String?
            }
            struct DisplayMode: Encodable { let id: String; let width: Int; let height: Int; let refreshRate: Double }
            struct Display: Encodable {
                let id: UInt32
                let width: Int
                let height: Int
                let isMain: Bool
                let isBuiltIn: Bool
                let brightness: Double?
                let brightnessControlSupported: Bool
                let currentMode: DisplayMode?
                let availableModes: [DisplayMode]
                let originX: Int
                let originY: Int
                let mirroredDisplayId: UInt32?
                let hdrActive: Bool
            }
            struct Printer: Encodable { let id: String; let name: String; let isDefault: Bool }
            struct Camera: Encodable { let id: String; let name: String; let isConnected: Bool; let isPreferred: Bool; let authorization: String }
            struct BluetoothDevice: Encodable { let id: String; let name: String; let isConnected: Bool }
            struct VPNService: Encodable { let id: String; let name: String; let isConnected: Bool }
            struct Battery: Encodable { let level: Double?; let charging: Bool?; let isExternalPower: Bool?; let isPreventingIdleSleep: Bool; let isLowPowerModeEnabled: Bool }
            struct PowerTimers: Encodable { let displayIdleMinutes: Int?; let systemSleepMinutes: Int?; let diskIdleMinutes: Int? }
            struct AppleMusic: Encodable { let isInstalled: Bool; let isRunning: Bool }
            struct Spotify: Encodable { let isInstalled: Bool; let isRunning: Bool }
            struct ChromeYouTube: Encodable { let isInstalled: Bool; let isRunning: Bool }
            let locked: Bool
            let volume: Double?
            let muted: Bool?
            let inputVolume: Double?
            let inputMuted: Bool?
            let soundEffectsVolume: Double?
            let soundEffectsMuted: Bool?
            let brightness: Double?
            let openApps: [App]
            let audioDevices: [AudioDevice]
            let wifi: WiFi
            let displays: [Display]
            let printers: [Printer]
            let cameras: [Camera]
            let bluetoothDevices: [BluetoothDevice]
            let vpnServices: [VPNService]
            let battery: Battery
            let powerTimers: PowerTimers
            let appleMusic: AppleMusic
            let spotify: Spotify
            let chromeYouTube: ChromeYouTube
        }
        struct Connector: Encodable {
            let id: String
            let kind: String
            let label: String
            let status: String
            let capabilities: [String]
            let projects: [ConnectorProjectReference]
        }
        let revision: Int64
        let state: State
        let connectors: [Connector]
    }

    private struct CommandEnvelope: Decodable {
        struct Command: Decodable {
            let id: String
            let leaseId: String?
            let kind: String
            let input: JSONValue
            let leaseExpiresAt: String?
            let requiresApproval: Bool
            let approvalState: String?
        }
        let ok: Bool
        let command: Command?
    }

    private struct OKResponse: Decodable { let ok: Bool }

    private struct LeaseHeartbeatResponse: Decodable {
        let ok: Bool
        let leaseExpiresAt: String
    }

    public static let connectorCapabilities = [
        "read-history", "create-session", "send-message", "steer-turn", "interrupt-turn", "review-approval"
    ]

    private let baseURL: URL
    private let credentialStore: any DeviceCredentialStore
    private let session: URLSession
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    public init(
        baseURL: URL,
        credentialStore: any DeviceCredentialStore,
        session: URLSession? = nil
    ) throws {
        guard Self.allowed(baseURL) else { throw ThingtimeAPIClientError.invalidBaseURL }
        self.baseURL = baseURL
        self.credentialStore = credentialStore
        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 35
            configuration.timeoutIntervalForResource = 45
            configuration.httpCookieStorage = nil
            configuration.urlCredentialStorage = nil
            configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
            self.session = URLSession(configuration: configuration, delegate: ThingtimeAPIRedirectDelegate(), delegateQueue: nil)
        }
        encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        encoder.dateEncodingStrategy = .iso8601
        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
    }

    public func preparePairing(_ request: PairingPrepareRequest) async throws -> PairingPrepareResponse {
        guard request.publicKey.count == 32, request.nonce.count == 32 else {
            throw ThingtimeAPIClientError.invalidResponse
        }
        let response: PairingPrepareEnvelope
        do {
            response = try await send(
                path: "api/v1/devices/pairing/claim",
                body: PairingPrepareBody(
                    op: "prepare",
                    pairingSecret: request.pairingSecret,
                    publicKey: request.publicKey.base64URLEncodedString(),
                    nonce: request.nonce.base64URLEncodedString()
                ),
                credential: nil
            )
        } catch {
            throw Self.pairingError(error)
        }
        guard response.ok,
              response.op == "prepare",
              !response.proof.pairingId.isEmpty,
              let serverNonce = Data(base64URLUnpadded: response.proof.serverNonce),
              serverNonce.count == 32,
              let expiresAt = Self.isoDate(response.proof.expiresAt) else {
            throw ThingtimeAPIClientError.pairingClaimOutcomeUncertain
        }
        return PairingPrepareResponse(
            pairingID: response.proof.pairingId,
            serverNonce: serverNonce,
            expiresAt: expiresAt
        )
    }

    public func claimPairing(_ request: PairingClaimRequest) async throws -> PairingClaimResponse {
        let body = ClaimBody(
            op: "complete",
            pairingSecret: request.pairingSecret,
            credential: request.credential,
            device: request.device,
            capabilities: request.capabilities,
            proof: .init(
                pairingId: request.proof.pairingID,
                publicKey: request.proof.publicKey.base64URLEncodedString(),
                nonce: request.proof.nonce.base64URLEncodedString(),
                serverNonce: request.proof.serverNonce.base64URLEncodedString(),
                signature: request.proof.signature.base64URLEncodedString()
            )
        )
        let response: ClaimResponse
        do {
            response = try await send(path: "api/v1/devices/pairing/claim", body: body, credential: nil)
        } catch {
            throw Self.pairingError(error)
        }
        guard response.ok, response.credentialStored, !response.device.id.isEmpty else {
            throw ThingtimeAPIClientError.pairingClaimOutcomeUncertain
        }
        return PairingClaimResponse(deviceID: response.device.id, refreshToken: request.credential)
    }

    public func sendHeartbeat(_ heartbeat: DeviceHeartbeat) async throws {
        let credential = try await requireCredential(deviceID: heartbeat.deviceID)
        let telemetry = heartbeat.telemetry
        let brightness = telemetry.displays.first(where: { $0.isMain })?.brightness
        var connectors = [StateBody.Connector(
            id: "codex-app-server",
            kind: "codex",
            label: "Codex",
            status: Self.connectorStatus(heartbeat.connector.state),
            capabilities: Self.connectorCapabilities,
            projects: Array(heartbeat.connectorProjects.prefix(128))
        )]
        connectors.append(contentsOf: heartbeat.additionalConnectors.prefix(8).map {
            StateBody.Connector(
                id: String($0.id.prefix(128)),
                kind: String($0.kind.prefix(64)),
                label: String($0.label.prefix(120)),
                status: $0.status,
                capabilities: Array($0.capabilities.prefix(16)),
                projects: Array($0.projects.prefix(128))
            )
        })
        let state = StateBody(
            revision: max(1, Int64(telemetry.collectedAt.timeIntervalSince1970 * 1_000)),
            state: .init(
                locked: telemetry.session.isLocked,
                volume: telemetry.outputVolume,
                muted: telemetry.outputMuted,
                inputVolume: telemetry.inputVolume,
                inputMuted: telemetry.inputMuted,
                soundEffectsVolume: telemetry.soundEffectsOutputVolume,
                soundEffectsMuted: telemetry.soundEffectsOutputMuted,
                brightness: brightness,
                openApps: Array(telemetry.runningApplications.compactMap { application in
                    guard let identifier = application.bundleIdentifier, !identifier.isEmpty else { return nil }
                    return .init(
                        id: String(identifier.prefix(255)),
                        name: String((application.name ?? identifier).prefix(120)),
                        frontmost: application.isActive,
                        hidden: application.isHidden
                    )
                }.prefix(Self.maximumOpenApplications)),
                audioDevices: Array(telemetry.audioDevices.prefix(32)).map {
                    .init(
                        id: String($0.id.prefix(512)),
                        name: String($0.name.prefix(120)),
                        hasInput: $0.hasInput,
                        hasOutput: $0.hasOutput,
                        isDefaultInput: $0.isDefaultInput,
                        isDefaultOutput: $0.isDefaultOutput,
                        isDefaultSoundEffectsOutput: $0.isDefaultSoundEffectsOutput
                    )
                },
                wifi: .init(powerOn: telemetry.wifi.powerOn, ssid: telemetry.wifi.ssid),
                displays: Array(telemetry.displays.prefix(16)).map {
                    .init(
                        id: $0.displayID,
                        width: $0.width,
                        height: $0.height,
                        isMain: $0.isMain,
                        isBuiltIn: $0.isBuiltIn,
                        brightness: $0.brightness,
                        brightnessControlSupported: $0.brightnessControlSupported,
                        currentMode: $0.currentMode.map { .init(id: String($0.id.prefix(160)), width: $0.width, height: $0.height, refreshRate: $0.refreshRate) },
                        availableModes: Array($0.availableModes.prefix(64)).map { .init(id: String($0.id.prefix(160)), width: $0.width, height: $0.height, refreshRate: $0.refreshRate) },
                        originX: $0.originX,
                        originY: $0.originY,
                        mirroredDisplayId: $0.mirroredDisplayID,
                        hdrActive: $0.hdrActive
                    )
                },
                printers: Array(telemetry.printers.prefix(64)).map { .init(id: String($0.id.prefix(512)), name: String($0.name.prefix(120)), isDefault: $0.isDefault) },
                cameras: Array(telemetry.cameras.prefix(32)).map { .init(id: String($0.id.prefix(512)), name: String($0.name.prefix(120)), isConnected: $0.isConnected, isPreferred: $0.isPreferred, authorization: $0.authorization.rawValue) },
                bluetoothDevices: Array(telemetry.bluetoothDevices.prefix(64)).map { .init(id: String($0.id.prefix(120)), name: String($0.name.prefix(120)), isConnected: $0.isConnected) },
                vpnServices: Array(telemetry.vpnServices.prefix(32)).map { .init(id: String($0.id.prefix(512)), name: String($0.name.prefix(120)), isConnected: $0.isConnected) },
                battery: .init(level: telemetry.battery.level, charging: telemetry.battery.isCharging, isExternalPower: telemetry.battery.isExternalPower, isPreventingIdleSleep: telemetry.battery.isPreventingIdleSleep, isLowPowerModeEnabled: telemetry.battery.isLowPowerModeEnabled),
                powerTimers: .init(displayIdleMinutes: telemetry.powerTimers.displayIdleMinutes, systemSleepMinutes: telemetry.powerTimers.systemSleepMinutes, diskIdleMinutes: telemetry.powerTimers.diskIdleMinutes),
                appleMusic: .init(isInstalled: telemetry.appleMusic.isInstalled, isRunning: telemetry.appleMusic.isRunning),
				spotify: .init(isInstalled: telemetry.spotify.isInstalled, isRunning: telemetry.spotify.isRunning),
				chromeYouTube: .init(isInstalled: telemetry.chromeYouTube.isInstalled, isRunning: telemetry.chromeYouTube.isRunning)
            ),
            connectors: connectors
        )
        let response: OKResponse = try await send(path: "api/v1/devices/node/state", body: state, credential: credential.refreshToken)
        guard response.ok else { throw ThingtimeAPIClientError.invalidResponse }
    }

    public func leaseCommands(_ request: CommandLeaseRequest) async throws -> CommandLeaseBatch {
        let credential = try await requireCredential(deviceID: request.deviceID)
        let response: CommandEnvelope = try await send(
            path: "api/v1/devices/node/commands",
            body: [
                "op": .string("claim"),
                "waitMs": .number(Double(min(request.waitSeconds * 1_000, 20_000)))
            ] as [String: JSONValue],
            credential: credential.refreshToken
        )
        guard response.ok else { throw ThingtimeAPIClientError.invalidResponse }
        guard let command = response.command else { return CommandLeaseBatch(commands: []) }
        guard let leaseID = command.leaseId,
              !leaseID.isEmpty,
              let expiresAt = Self.isoDate(command.leaseExpiresAt) else {
            throw ThingtimeAPIClientError.invalidResponse
        }
        guard !command.requiresApproval || command.approvalState == "approved" else {
            throw ThingtimeAPIClientError.invalidResponse
        }
        return CommandLeaseBatch(commands: [LeasedCommand(
            commandID: command.id,
            leaseID: leaseID,
            method: command.kind,
            parameters: command.input,
            leaseExpiresAt: expiresAt,
            approvedForExecution: !command.requiresApproval || command.approvalState == "approved"
        )])
    }

    public func reportCommand(_ report: CommandExecutionReport) async throws {
        let credential = try await requireCredential()
        let status: String
        switch report.status {
        case .succeeded: status = "succeeded"
        case .failed: status = "failed"
        case .uncertain: status = "needs-review"
        }
        let eventID = Self.reportEventID(report)
        var body: [String: JSONValue] = [
            "op": .string("report"),
            "commandId": .string(report.commandID),
            "leaseId": .string(report.leaseID),
            "eventId": .string(eventID),
            "status": .string(status)
        ]
        if let error = report.response.error {
            body["error"] = .string(String("\(error.code): \(error.message)".prefix(500)))
        }
        if let outputReference = Self.commandOutputReference(report.response) {
            body["outputRef"] = .string(outputReference)
        }
        let response: OKResponse = try await send(path: "api/v1/devices/node/commands", body: body, credential: credential.refreshToken)
        guard response.ok else { throw ThingtimeAPIClientError.invalidResponse }
    }

    public func heartbeatCommand(commandID: String, leaseID: String) async throws -> Date {
        let credential = try await requireCredential()
        let response: LeaseHeartbeatResponse = try await send(
            path: "api/v1/devices/node/commands",
            body: [
                "op": .string("heartbeat"),
                "commandId": .string(commandID),
                "leaseId": .string(leaseID)
            ] as [String: JSONValue],
            credential: credential.refreshToken
        )
        guard response.ok, let leaseExpiresAt = Self.isoDate(response.leaseExpiresAt) else {
            throw ThingtimeAPIClientError.invalidResponse
        }
        return leaseExpiresAt
    }

    /// Sends a closed, already-normalized live AI mirror envelope. The server
    /// revalidates every field and derives owner/device/connector identity from
    /// the node credential and current connector projection.
    public func syncLiveAI(_ body: JSONValue) async throws -> JSONValue {
        let credential = try await requireCredential()
        let response: JSONValue = try await send(
            path: "api/v1/devices/node/live-sync",
            body: body,
            credential: credential.refreshToken
        )
        guard response.objectValue?["ok"] == .bool(true) else {
            throw ThingtimeAPIClientError.invalidResponse
        }
        return response
    }

    private func requireCredential(deviceID: String? = nil) async throws -> DeviceCredential {
        guard let credential = try await credentialStore.load(),
              deviceID == nil || credential.deviceID == deviceID else {
            throw ThingtimeAPIClientError.notPaired
        }
        return credential
    }

    private func send<Body: Encodable, Response: Decodable>(
        path: String,
        body: Body,
        credential: String?
    ) async throws -> Response {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            throw ThingtimeAPIClientError.invalidBaseURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = try encoder.encode(body)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Thingtime-Node/0.1", forHTTPHeaderField: "User-Agent")
        if let credential { request.setValue("Bearer \(credential)", forHTTPHeaderField: "Authorization") }
        let (data, rawResponse) = try await session.data(for: request)
        guard data.count <= 2_097_152,
              let response = rawResponse as? HTTPURLResponse,
              response.url?.scheme == baseURL.scheme,
              response.url?.host == baseURL.host,
              response.url?.port == baseURL.port else {
            throw ThingtimeAPIClientError.invalidResponse
        }
        guard (200 ..< 300).contains(response.statusCode) else {
            throw ThingtimeAPIClientError.rejected(status: response.statusCode)
        }
        return try decoder.decode(Response.self, from: data)
    }

    private static func allowed(_ url: URL) -> Bool {
        guard url.user == nil, url.password == nil, url.query == nil, url.fragment == nil, url.host != nil else { return false }
        if url.scheme == "https" { return true }
        return url.scheme == "http" && (url.host == "127.0.0.1" || url.host == "localhost" || url.host == "::1")
    }

    private static func pairingError(_ error: Error) -> Error {
        if case let ThingtimeAPIClientError.rejected(status) = error,
           (400 ..< 500).contains(status),
           status != 408,
           status != 425,
           status != 429 {
            return error
        }
        return ThingtimeAPIClientError.pairingClaimOutcomeUncertain
    }

    private static func connectorStatus(_ state: ConnectorRuntimeState) -> String {
        switch state {
        case .running: "connected"
        case .disabled, .stopped, .starting: "disconnected"
        case .degraded, .failed: "degraded"
        }
    }

    private static func isoDate(_ value: String?) -> Date? {
        guard let value else { return nil }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) { return date }
        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        return standard.date(from: value)
    }

    private static func reportEventID(_ report: CommandExecutionReport) -> String {
        let value = "\(report.commandID)\u{0}\(report.leaseID)\u{0}\(report.status.rawValue)\u{0}\(report.response.ok)"
        let digest = SHA256.hash(data: Data(value.utf8))
        return "node-report-" + digest.map { String(format: "%02x", $0) }.joined().prefix(40)
    }

    /// The control plane needs only the opaque list cursor to request the next
    /// bounded page. Never serialize the remaining connector response (which
    /// may contain session metadata) into a command row.
    private static func commandOutputReference(_ response: NodeResponse) -> String? {
        guard response.ok,
              let value = response.result?.objectValue?["nextCursor"]?.stringValue,
              !value.isEmpty,
              value == value.trimmingCharacters(in: .whitespacesAndNewlines),
              value.unicodeScalars.count <= 2_048,
              !value.unicodeScalars.contains(where: {
                  $0.properties.generalCategory == .control || $0.properties.generalCategory == .format
              }) else {
            return nil
        }
        return value
    }
}
