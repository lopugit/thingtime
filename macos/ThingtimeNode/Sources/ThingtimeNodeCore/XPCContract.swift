import Foundation

@objc public protocol ThingtimeNodeXPCProtocol {
    func request(_ data: Data, withReply reply: @escaping (Data) -> Void)
}

public enum ThingtimeNodeXPC {
    public static let machServiceName = "com.thingtime.desktop.node.xpc"
    public static let maximumMessageBytes = 1_048_576
}

public enum ThingtimeNodeXPCRequestAccess: Equatable, Sendable {
    case onboardingRead
    case pairingMutation
    case forbidden
}

public enum ThingtimeNodeXPCRequestPolicy {
    private static let onboardingReads: Set<String> = [
        "node.status",
        "permissions.preflight",
        "pairing.status",
        "pairing.begin"
    ]
    private static let pairingMutations: Set<String> = [
        "pairing.claim",
        "pairing.resume",
        "pairing.unpair"
    ]

    public static func access(for method: String) -> ThingtimeNodeXPCRequestAccess {
        if onboardingReads.contains(method) { return .onboardingRead }
        if pairingMutations.contains(method) { return .pairingMutation }
        return .forbidden
    }
}

public enum NodeWireCodec {
    public static func decodeRequest(
        _ data: Data,
        maximumBytes: Int = ThingtimeNodeXPC.maximumMessageBytes
    ) throws -> NodeRequest {
        try validate(data, maximumBytes: maximumBytes)
        return try decoder().decode(NodeRequest.self, from: data)
    }

    public static func encodeRequest(
        _ request: NodeRequest,
        maximumBytes: Int = ThingtimeNodeXPC.maximumMessageBytes
    ) throws -> Data {
        let data = try encoder().encode(request)
        try validate(data, maximumBytes: maximumBytes)
        return data
    }

    public static func decodeResponse(
        _ data: Data,
        maximumBytes: Int = ThingtimeNodeXPC.maximumMessageBytes
    ) throws -> NodeResponse {
        try validate(data, maximumBytes: maximumBytes)
        return try decoder().decode(NodeResponse.self, from: data)
    }

    public static func encodeResponse(
        _ response: NodeResponse,
        maximumBytes: Int = ThingtimeNodeXPC.maximumMessageBytes
    ) throws -> Data {
        let data = try encoder().encode(response)
        try validate(data, maximumBytes: maximumBytes)
        return data
    }

    private static func validate(_ data: Data, maximumBytes: Int) throws {
        guard maximumBytes > 0, !data.isEmpty, data.count <= maximumBytes else {
            throw ThingtimeNodeError.invalidRequest("XPC payload is empty or exceeds the message limit.")
        }
    }

    private static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }

    private static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
