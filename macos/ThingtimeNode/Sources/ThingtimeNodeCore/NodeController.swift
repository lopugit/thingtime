import Foundation

public struct NodeStatus: Codable, Equatable, Sendable {
    public let service: String
    public let pairing: PairingStatus
    public let recoverablePairing: Bool
    public let connector: ConnectorRuntimeHealth
    public let permissions: PermissionPreflight
    public let journalEntryCount: Int

    public init(
        service: String,
        pairing: PairingStatus,
        recoverablePairing: Bool,
        connector: ConnectorRuntimeHealth,
        permissions: PermissionPreflight,
        journalEntryCount: Int
    ) {
        self.service = service
        self.pairing = pairing
        self.recoverablePairing = recoverablePairing
        self.connector = connector
        self.permissions = permissions
        self.journalEntryCount = journalEntryCount
    }
}

public actor ThingtimeNodeController {
    private struct PairingClaimParameters: Decodable {
        let pairingSecret: String
    }

    private struct PermissionRequestParameters: Decodable {
        let kind: ThingtimePermissionKind
    }

    private struct ActionEnvelope: Codable {
        let action: SafeActionRequest
        let context: SafeActionContext
    }

    private struct ConnectorSendParameters: Decodable {
        let operation: String
        let payload: JSONValue
    }

    private struct DesktopChatSendParameters: Decodable {
        let connectorID: String
        let operation: String
        let payload: JSONValue
        let explicitlyApproved: Bool
        let sessionLocked: Bool
    }

    private static let connectorID = "codex-app-server"
    private static let maximumPairingAttempts = 3
    private static let basePairingCapabilities = [
        "ai.session.create",
        "ai.session.interrupt",
        "ai.session.list",
        "ai.session.message",
        "ai.session.read",
        "apps.launch",
        "apps.quit",
        "apps.read",
        "approvals.respond",
        "device.lock.read",
        "system.lock",
        "system.volume.read",
        "system.volume.write",
        "system.audio.mute.write",
        "system.audio.output.write",
        "system.audio.input.write",
        "system.audio.sound-effects-output.write",
        "system.wifi.connect",
        "system.wifi.disconnect",
        "system.wifi.power.write",
        "apps.visibility"
    ]
    private static let connectorMethods: Set<String> = [
        "session.list",
        "session.read",
        "session.create",
        "session.send",
        "session.interrupt",
        "approval.respond"
    ]

    private static let readMethods: Set<String> = [
        "node.status",
        "telemetry.snapshot",
        "permissions.preflight",
        "pairing.status",
        "pairing.begin",
        "connector.health",
        "action.evaluate",
        "command.status"
    ]

    private static let mutatingMethods: Set<String> = [
        "pairing.claim",
        "pairing.resume",
        "pairing.unpair",
        "permissions.request",
        "action.execute",
        "connector.start",
        "connector.stop",
        "connector.send",
        "desktop-chat.send"
    ]

    private let journal: CommandJournal
    private let pairing: PairingManager
    private let connector: ConnectorRuntime
    private let telemetry: DeviceTelemetryCollector
    private let actionExecutor: SafeActionExecutor
    private let controlPlaneClient: (any ControlPlaneClient)?
    private let desktopChat: DesktopChatRuntime?
    private let pairingScopeChanged: @Sendable (String?) async throws -> Void

    public init(
        journal: CommandJournal,
        pairing: PairingManager,
        connector: ConnectorRuntime,
        telemetry: DeviceTelemetryCollector,
        actionExecutor: SafeActionExecutor,
        controlPlaneClient: (any ControlPlaneClient)? = nil,
        desktopChat: DesktopChatRuntime? = nil,
        pairingScopeChanged: @escaping @Sendable (String?) async throws -> Void = { _ in }
    ) {
        self.journal = journal
        self.pairing = pairing
        self.connector = connector
        self.telemetry = telemetry
        self.actionExecutor = actionExecutor
        self.controlPlaneClient = controlPlaneClient
        self.desktopChat = desktopChat
        self.pairingScopeChanged = pairingScopeChanged
    }

    public func handle(_ request: NodeRequest) async -> NodeResponse {
        do {
            if Self.readMethods.contains(request.method) {
                return try await executeRead(request)
            }
            if Self.mutatingMethods.contains(request.method) {
                return try await executeJournaled(request)
            }
            throw ThingtimeNodeError.invalidRequest("Unknown node method: \(request.method)")
        } catch let error as ThingtimeNodeError {
            return .failure(id: request.id, code: error.code, message: error.localizedDescription)
        } catch {
            return .failure(id: request.id, code: "internal_error", message: "The node could not complete the request.")
        }
    }

    public func handleLeasedCommand(_ command: LeasedCommand) async -> NodeResponse {
        do {
            let request = try await request(for: command)
            return await handle(request)
        } catch {
            return failureResponse(requestID: command.leaseID, error: error)
        }
    }

    private func executeRead(_ request: NodeRequest) async throws -> NodeResponse {
        let result: JSONValue
        switch request.method {
        case "node.status":
            let status = try await NodeStatus(
                service: "running",
                pairing: pairing.status(),
                recoverablePairing: pairing.hasRecoverablePairing(),
                connector: connector.health(),
                permissions: telemetry.permissionPreflight(),
                journalEntryCount: journal.count()
            )
            result = try JSONValue.from(status)
        case "telemetry.snapshot":
            result = try await JSONValue.from(telemetry.snapshot())
        case "permissions.preflight":
            result = try await JSONValue.from(telemetry.permissionPreflight())
        case "pairing.status":
            result = try await JSONValue.from(pairing.status())
        case "pairing.begin":
            result = try await JSONValue.from(pairing.begin())
        case "connector.health":
            result = try await JSONValue.from(connector.health())
        case "action.evaluate":
            let envelope = try request.parameters.decode(ActionEnvelope.self)
            let decision = await actionExecutor.evaluate(action: envelope.action, context: envelope.context)
            result = try JSONValue.from(decision)
        case "command.status":
            let object = try requireObject(request.parameters)
            guard let commandID = object["commandId"]?.stringValue else {
                throw ThingtimeNodeError.invalidRequest("command.status requires commandId.")
            }
            if let entry = await journal.entry(commandId: commandID) {
                result = try JSONValue.from(entry)
            } else {
                result = .null
            }
        default:
            throw ThingtimeNodeError.invalidRequest("Unknown read method.")
        }
        return .success(id: request.id, result: result)
    }

    private func executeJournaled(_ request: NodeRequest) async throws -> NodeResponse {
        guard let commandID = request.commandId else { throw ThingtimeNodeError.commandIdRequired }
        let payload = try request.canonicalCommandPayload
        let isExactlyRetryablePairing = request.method == "pairing.claim" || request.method == "pairing.resume"
        switch try await journal.begin(
            commandId: commandID,
            payload: payload,
            retryableOnRecovery: isExactlyRetryablePairing
        ) {
        case let .replay(outcome):
            try await clearCompletedPairingClaimIfNeeded(request)
            return outcome.response(requestId: request.id)
        case .inProgress:
            throw ThingtimeNodeError.commandInProgress
        case .uncertain:
            throw ThingtimeNodeError.commandOutcomeUncertain
        case let .execute(payloadHash):
            do {
                let response = try await executeMutation(request, commandID: commandID)
                try await journal.finish(
                    commandId: commandID,
                    payloadHash: payloadHash,
                    outcome: JournaledOutcome(response: response)
                )
                try await clearCompletedPairingClaimIfNeeded(request)
                return response
            } catch ThingtimeAPIClientError.pairingClaimOutcomeUncertain {
                try await journal.resetRetryable(commandId: commandID, payloadHash: payloadHash)
                throw ThingtimeNodeError.pairingClaimRetryable
            } catch let error as ThingtimeNodeError where error == .commandOutcomeUncertain {
                try await journal.markUncertain(commandId: commandID, payloadHash: payloadHash)
                throw error
            } catch {
                let response = failureResponse(requestID: request.id, error: error)
                try await journal.finish(
                    commandId: commandID,
                    payloadHash: payloadHash,
                    outcome: JournaledOutcome(response: response)
                )
                return response
            }
        }
    }

    private func executeMutation(_ request: NodeRequest, commandID: String) async throws -> NodeResponse {
        let result: JSONValue
        switch request.method {
        case "pairing.claim":
            guard let controlPlaneClient else {
                throw ThingtimeNodeError.invalidRequest("This node has no Thingtime API connection configured.")
            }
            let parameters = try request.parameters.decode(PairingClaimParameters.self)
            result = try await JSONValue.from(executePairingClaim(
                pairingSecret: parameters.pairingSecret,
                client: controlPlaneClient
            ))
        case "pairing.resume":
            guard let controlPlaneClient else {
                throw ThingtimeNodeError.invalidRequest("This node has no Thingtime API connection configured.")
            }
            let parameters = try requireObject(request.parameters)
            guard parameters.isEmpty else {
                throw ThingtimeNodeError.invalidRequest("pairing.resume does not accept parameters.")
            }
            let pairingSecret = try await pairing.pendingPairingSecretForResume()
            result = try await JSONValue.from(executePairingClaim(
                pairingSecret: pairingSecret,
                client: controlPlaneClient
            ))
        case "pairing.unpair":
            let status = try await pairing.unpair()
            try await pairingScopeChanged(nil)
            result = try JSONValue.from(status)
        case "permissions.request":
            let parameters = try request.parameters.decode(PermissionRequestParameters.self)
            result = try await JSONValue.from(telemetry.requestPermission(parameters.kind))
        case "action.execute":
            let envelope = try request.parameters.decode(ActionEnvelope.self)
            result = try await actionExecutor.execute(action: envelope.action, context: envelope.context)
        case "connector.start":
            try await connector.start()
            result = try await JSONValue.from(connector.health())
        case "connector.stop":
            await connector.stop()
            result = try await JSONValue.from(connector.health())
        case "connector.send":
            let parameters = try request.parameters.decode(ConnectorSendParameters.self)
            let reply = try await connector.send(ConnectorCommand(
                id: commandID,
                operation: parameters.operation,
                payload: parameters.payload
            ))
            guard reply.ok else {
                if reply.error?.code == ThingtimeNodeError.commandOutcomeUncertain.code {
                    throw ThingtimeNodeError.commandOutcomeUncertain
                }
                throw ThingtimeNodeError.connectorProtocol(reply.error?.message ?? "Connector rejected the command.")
            }
            result = reply.result ?? .object([:])
        case "desktop-chat.send":
            guard let desktopChat else {
                throw ThingtimeNodeError.connectorUnavailable("Desktop chat Accessibility support is unavailable.")
            }
            let parameters = try request.parameters.decode(DesktopChatSendParameters.self)
            result = try await desktopChat.execute(DesktopChatCommand(
                connectorID: parameters.connectorID,
                operation: parameters.operation,
                payload: parameters.payload,
                commandID: commandID,
                sessionLocked: parameters.sessionLocked,
                explicitlyApproved: parameters.explicitlyApproved
            ))
        default:
            throw ThingtimeNodeError.invalidRequest("Unknown mutation method.")
        }
        return .success(id: request.id, result: result)
    }

    private func clearCompletedPairingClaimIfNeeded(_ request: NodeRequest) async throws {
        switch request.method {
        case "pairing.claim":
            let parameters = try request.parameters.decode(PairingClaimParameters.self)
            try await pairing.clearCompletedClaim(pairingID: parameters.pairingSecret)
        case "pairing.resume":
            try await pairing.clearCompletedClaimForResume()
        default:
            return
        }
    }

    private func executePairingClaim(
        pairingSecret: String,
        client: any ControlPlaneClient
    ) async throws -> PairingStatus {
        for attempt in 1 ... Self.maximumPairingAttempts {
            do {
                return try await executePairingClaimAttempt(pairingSecret: pairingSecret, client: client)
            } catch let error as ThingtimeAPIClientError {
                if case let .rejected(status) = error,
                   (400 ..< 500).contains(status),
                   status != 408,
                   status != 425,
                   status != 429 {
                    try await pairing.cancelClaim(pairingID: pairingSecret)
                    throw error
                }
                if attempt < Self.maximumPairingAttempts {
                    await Task.yield()
                    continue
                }
            } catch let error as ThingtimeNodeError {
                try await pairing.cancelClaim(pairingID: pairingSecret)
                throw error
            } catch is KeychainError {
                // A local persistence failure is definitive: retrying the
                // network cannot fix it, and claiming an unknown server outcome
                // would incorrectly advertise a resumable pairing that was
                // never saved on this Mac.
                throw ThingtimeNodeError.credentialStoreUnavailable
            } catch {
                // Only ThingtimeAPIClientError represents an ambiguous remote
                // response. Preserve every other local failure as-is.
                throw error
            }

            // Prepare is key-bound and complete reuses the durable signed
            // request, so a missing response is safe to replay in place. Keep
            // the pending record only after these bounded attempts are spent.
            throw ThingtimeAPIClientError.pairingClaimOutcomeUncertain
        }

        preconditionFailure("The bounded pairing attempt loop must return or throw.")
    }

    private func executePairingClaimAttempt(
        pairingSecret: String,
        client: any ControlPlaneClient
    ) async throws -> PairingStatus {
        let device = await telemetry.snapshot()
        let challenge = try await pairing.begin(pairingID: pairingSecret)
        let descriptor = PairingDeviceDescriptor(
            name: device.deviceName,
            platform: "macos",
            model: device.modelIdentifier,
            osVersion: device.operatingSystemVersion,
            appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.1.0"
        )
        var pairingCapabilities = Self.basePairingCapabilities
        if let mainDisplay = device.displays.first(where: { $0.isMain }), mainDisplay.brightness != nil {
            pairingCapabilities.append("system.brightness.read")
            if mainDisplay.brightnessControlSupported {
                pairingCapabilities.append("system.brightness.write")
            }
        }
        let claimRequest: PairingClaimRequest
        if let prepared = try await pairing.preparedClaim(pairingID: challenge.pairingID) {
            claimRequest = prepared
        } else {
            let serverProof = try await client.preparePairing(PairingPrepareRequest(
                pairingSecret: challenge.pairingID,
                publicKey: challenge.publicKey,
                nonce: challenge.nonce
            ))
            claimRequest = try await pairing.bindPreparedClaim(
                pairingID: challenge.pairingID,
                serverProof: serverProof,
                device: descriptor,
                capabilities: pairingCapabilities
            )
        }
        let claim = try await client.claimPairing(claimRequest)
        let status = try await pairing.complete(
            pairingID: challenge.pairingID,
            deviceID: claim.deviceID,
            refreshToken: claim.refreshToken
        )
        try await pairingScopeChanged(claim.deviceID)
        return status
    }

    private func request(for command: LeasedCommand) async throws -> NodeRequest {
        let requestID = command.leaseID
        if command.method == "connector.start" || command.method == "connector.stop" {
            let input = try requireObject(command.parameters)
            guard input["connectorId"]?.stringValue == Self.connectorID else {
                throw ThingtimeNodeError.invalidRequest("The connector identifier is invalid.")
            }
            return NodeRequest(
                id: requestID,
                commandId: command.commandID,
                method: command.method
            )
        }

        if Self.connectorMethods.contains(command.method) {
            var payload = try requireObject(command.parameters)
            guard let connectorID = payload.removeValue(forKey: "connectorId")?.stringValue else {
                throw ThingtimeNodeError.invalidRequest("The connector identifier is invalid.")
            }
            payload["commandId"] = .string(command.commandID)
            if DesktopChatRuntime.supports(connectorID: connectorID) {
                let device = await telemetry.snapshot()
                return NodeRequest(
                    id: requestID,
                    commandId: command.commandID,
                    method: "desktop-chat.send",
                    parameters: .object([
                        "connectorID": .string(connectorID),
                        "operation": .string(command.method),
                        "payload": .object(payload),
                        "explicitlyApproved": .bool(command.approvedForExecution),
                        "sessionLocked": .bool(device.session.isLocked)
                    ])
                )
            }
            guard connectorID == Self.connectorID else {
                throw ThingtimeNodeError.invalidRequest("The connector identifier is invalid.")
            }
            payload["connectorId"] = .string(connectorID)
            if command.method == "session.send" {
                guard let delivery = payload.removeValue(forKey: "delivery")?.stringValue,
                      delivery == "queue" || delivery == "steer" else {
                    throw ThingtimeNodeError.invalidRequest("session.send delivery must be queue or steer.")
                }
                payload["mode"] = .string(delivery)
            } else if command.method == "approval.respond" {
                guard let approvalID = payload.removeValue(forKey: "approvalId")?.stringValue,
                      let decision = payload["decision"]?.stringValue else {
                    throw ThingtimeNodeError.invalidRequest("approval.respond input is invalid.")
                }
                payload["requestId"] = .string(approvalID)
                switch decision {
                case "approved": payload["decision"] = .string("accept")
                case "denied": payload["decision"] = .string("decline")
                default: throw ThingtimeNodeError.invalidRequest("The approval decision is invalid.")
                }
            }
            return NodeRequest(
                id: requestID,
                commandId: command.commandID,
                method: "connector.send",
                parameters: .object([
                    "operation": .string(command.method.replacingOccurrences(of: ".", with: "/")),
                    "payload": .object(payload)
                ])
            )
        }

        let action: SafeActionRequest
        let input = try requireObject(command.parameters)
        switch command.method {
        case "system.volume.set":
            guard let level = input["level"]?.numberValue else {
                throw ThingtimeNodeError.invalidRequest("system.volume.set requires level.")
            }
            action = SafeActionRequest(kind: .setOutputVolume, parameters: ["volume": .number(level)])
        case "system.audio.mute.set":
            try requireOnlyKeys(input, ["muted"])
            guard case let .bool(muted)? = input["muted"] else {
                throw ThingtimeNodeError.invalidRequest("system.audio.mute.set requires muted.")
            }
            action = SafeActionRequest(kind: .setOutputMuted, parameters: ["muted": .bool(muted)])
        case "system.audio.output.set":
            try requireOnlyKeys(input, ["deviceId"])
            guard let deviceID = input["deviceId"]?.stringValue else {
                throw ThingtimeNodeError.invalidRequest("system.audio.output.set requires deviceId.")
            }
            action = SafeActionRequest(kind: .setDefaultOutputDevice, parameters: ["deviceId": .string(deviceID)])
        case "system.audio.input.set":
            try requireOnlyKeys(input, ["deviceId"])
            guard let deviceID = input["deviceId"]?.stringValue else {
                throw ThingtimeNodeError.invalidRequest("system.audio.input.set requires deviceId.")
            }
            action = SafeActionRequest(kind: .setDefaultInputDevice, parameters: ["deviceId": .string(deviceID)])
        case "system.audio.sound-effects-output.set":
            try requireOnlyKeys(input, ["deviceId"])
            guard let deviceID = input["deviceId"]?.stringValue else {
                throw ThingtimeNodeError.invalidRequest("system.audio.sound-effects-output.set requires deviceId.")
            }
            action = SafeActionRequest(kind: .setDefaultSoundEffectsOutputDevice, parameters: ["deviceId": .string(deviceID)])
        case "system.brightness.set":
            guard let level = input["level"]?.numberValue else {
                throw ThingtimeNodeError.invalidRequest("system.brightness.set requires level.")
            }
            action = SafeActionRequest(kind: .setDisplayBrightness, parameters: ["brightness": .number(level)])
        case "app.launch":
            guard let appID = input["appId"]?.stringValue else {
                throw ThingtimeNodeError.invalidRequest("app.launch requires appId.")
            }
            action = SafeActionRequest(kind: .launchApplication, parameters: ["bundleIdentifier": .string(appID)])
        case "app.focus":
            guard let appID = input["appId"]?.stringValue else {
                throw ThingtimeNodeError.invalidRequest("app.focus requires appId.")
            }
            action = SafeActionRequest(kind: .activateApplication, parameters: ["bundleIdentifier": .string(appID)])
        case "app.quit":
            guard let appID = input["appId"]?.stringValue else {
                throw ThingtimeNodeError.invalidRequest("app.quit requires appId.")
            }
            action = SafeActionRequest(kind: .terminateApplication, parameters: ["bundleIdentifier": .string(appID)])
        case "app.hide":
            try requireOnlyKeys(input, ["appId"])
            guard let appID = input["appId"]?.stringValue else {
                throw ThingtimeNodeError.invalidRequest("app.hide requires appId.")
            }
            action = SafeActionRequest(kind: .hideApplication, parameters: ["bundleIdentifier": .string(appID)])
        case "app.unhide":
            try requireOnlyKeys(input, ["appId"])
            guard let appID = input["appId"]?.stringValue else {
                throw ThingtimeNodeError.invalidRequest("app.unhide requires appId.")
            }
            action = SafeActionRequest(kind: .unhideApplication, parameters: ["bundleIdentifier": .string(appID)])
        case "system.lock":
            action = SafeActionRequest(kind: .lockScreen)
        case "system.wifi.connect":
            try requireOnlyKeys(input, ["ssid"])
            guard let ssid = input["ssid"]?.stringValue else {
                throw ThingtimeNodeError.invalidRequest("system.wifi.connect requires ssid.")
            }
            action = SafeActionRequest(kind: .connectWiFi, parameters: ["ssid": .string(ssid)])
        case "system.wifi.disconnect":
            try requireOnlyKeys(input, [])
            action = SafeActionRequest(kind: .disconnectWiFi)
        case "system.wifi.power.set":
            try requireOnlyKeys(input, ["enabled"])
            guard case let .bool(enabled)? = input["enabled"] else {
                throw ThingtimeNodeError.invalidRequest("system.wifi.power.set requires enabled.")
            }
            action = SafeActionRequest(kind: .setWiFiPower, parameters: ["enabled": .bool(enabled)])
        case "screen.start", "screen.stop":
            throw ThingtimeNodeError.policyDenied("This capability is not installed on this node version.")
        default:
            throw ThingtimeNodeError.invalidRequest("Unknown leased command kind.")
        }
        let device = await telemetry.snapshot()
        let envelope = ActionEnvelope(
            action: action,
            context: SafeActionContext(
                origin: .remoteAccount,
                sessionLocked: device.session.isLocked,
                userApproved: command.approvedForExecution
            )
        )
        return NodeRequest(
            id: requestID,
            commandId: command.commandID,
            method: "action.execute",
            parameters: try JSONValue.from(envelope)
        )
    }

    private func failureResponse(requestID: String, error: Error) -> NodeResponse {
        if let nodeError = error as? ThingtimeNodeError {
            return .failure(id: requestID, code: nodeError.code, message: nodeError.localizedDescription)
        }
        return .failure(id: requestID, code: "internal_error", message: "The node could not complete the request.")
    }

    private func requireObject(_ value: JSONValue) throws -> [String: JSONValue] {
        guard let object = value.objectValue else {
            throw ThingtimeNodeError.invalidRequest("Request parameters must be an object.")
        }
        return object
    }

    private func requireOnlyKeys(_ input: [String: JSONValue], _ allowed: Set<String>) throws {
        guard Set(input.keys) == allowed else {
            throw ThingtimeNodeError.invalidRequest("The command input contains an unsupported field.")
        }
    }
}
