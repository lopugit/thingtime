import Foundation

public enum JSONValue: Codable, Equatable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case let .string(value): try container.encode(value)
        case let .number(value): try container.encode(value)
        case let .bool(value): try container.encode(value)
        case let .object(value): try container.encode(value)
        case let .array(value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }

    public var objectValue: [String: JSONValue]? {
        guard case let .object(value) = self else { return nil }
        return value
    }

    public var arrayValue: [JSONValue]? {
        guard case let .array(value) = self else { return nil }
        return value
    }

    public var stringValue: String? {
        guard case let .string(value) = self else { return nil }
        return value
    }

    public var numberValue: Double? {
        guard case let .number(value) = self else { return nil }
        return value
    }

    public static func from<T: Encodable>(_ value: T) throws -> JSONValue {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try JSONDecoder().decode(JSONValue.self, from: encoder.encode(value))
    }

    public func decode<T: Decodable>(_ type: T.Type) throws -> T {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try JSONDecoder().decode(type, from: encoder.encode(self))
    }
}

public struct NodeRequest: Codable, Equatable, Sendable {
    public let id: String
    public let commandId: String?
    public let method: String
    public let parameters: JSONValue

    public init(id: String = UUID().uuidString, commandId: String? = nil, method: String, parameters: JSONValue = .object([:])) {
        self.id = id
        self.commandId = commandId
        self.method = method
        self.parameters = parameters
    }

    public var canonicalCommandPayload: Data {
        get throws {
            struct Payload: Encodable {
                let method: String
                let parameters: JSONValue
            }
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
            return try encoder.encode(Payload(method: method, parameters: parameters))
        }
    }
}

public struct NodeErrorPayload: Codable, Equatable, Sendable {
    public let code: String
    public let message: String

    public init(code: String, message: String) {
        self.code = code
        self.message = message
    }
}

public struct NodeResponse: Codable, Equatable, Sendable {
    public let id: String
    public let ok: Bool
    public let result: JSONValue?
    public let error: NodeErrorPayload?

    public static func success(id: String, result: JSONValue = .object([:])) -> NodeResponse {
        NodeResponse(id: id, ok: true, result: result, error: nil)
    }

    public static func failure(id: String, code: String, message: String) -> NodeResponse {
        NodeResponse(id: id, ok: false, result: nil, error: NodeErrorPayload(code: code, message: message))
    }
}

public struct JournaledOutcome: Codable, Equatable, Sendable {
    public let ok: Bool
    public let result: JSONValue?
    public let error: NodeErrorPayload?

    public init(response: NodeResponse) {
        ok = response.ok
        result = response.result
        error = response.error
    }

    public func response(requestId: String) -> NodeResponse {
        NodeResponse(id: requestId, ok: ok, result: result, error: error)
    }
}

public enum ThingtimeNodeError: Error, Equatable, LocalizedError {
    case invalidRequest(String)
    case commandIdRequired
    case commandConflict
    case commandInProgress
    case commandOutcomeUncertain
    case pairingClaimRetryable
    case credentialStoreUnavailable
    case journalCapacityReached
    case connectorUnavailable(String)
    case connectorProtocol(String)
    case policyDenied(String)
    case approvalRequired(String)

    public var errorDescription: String? {
        switch self {
        case let .invalidRequest(message): message
        case .commandIdRequired: "A server commandId is required for mutating operations."
        case .commandConflict: "That commandId was already used with a different payload."
        case .commandInProgress: "That command is already running."
        case .commandOutcomeUncertain: "The node restarted while that command was running; its outcome must be reconciled before retrying."
        case .pairingClaimRetryable: "The pairing response was not confirmed. Retry the same command to reconcile it safely."
        case .credentialStoreUnavailable: "Thingtime could not securely save the pairing credential in this Mac’s keychain."
        case .journalCapacityReached: "The command journal is full of non-evictable entries."
        case let .connectorUnavailable(message): message
        case let .connectorProtocol(message): message
        case let .policyDenied(message): message
        case let .approvalRequired(message): message
        }
    }

    public var code: String {
        switch self {
        case .invalidRequest: "invalid_request"
        case .commandIdRequired: "command_id_required"
        case .commandConflict: "command_id_conflict"
        case .commandInProgress: "command_in_progress"
        case .commandOutcomeUncertain: "command_outcome_uncertain"
        case .pairingClaimRetryable: "pairing_claim_retryable"
        case .credentialStoreUnavailable: "credential_store_unavailable"
        case .journalCapacityReached: "command_journal_full"
        case .connectorUnavailable: "connector_unavailable"
        case .connectorProtocol: "connector_protocol_error"
        case .policyDenied: "policy_denied"
        case .approvalRequired: "approval_required"
        }
    }
}
