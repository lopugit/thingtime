import Darwin
import Foundation
import Security
import ThingtimeNodeCore

private struct DirectParentAuthenticator {
    private static let appleGenericRequirementSource = "anchor apple generic"

    func accepts() -> Bool {
        // The parent PID comes from the kernel. Never accept an environment,
        // argument, or request field as caller identity, and sample it again
        // after code-signing validation to close parent-exit/PID-reuse races.
        let initialParentProcessIdentifier = getppid()
        guard initialParentProcessIdentifier > 1,
              let bridgeCode = copyCurrentCode(),
              let parentCode = copyCode(processIdentifier: initialParentProcessIdentifier) else {
            return false
        }

        if ProcessInfo.processInfo.environment["THINGTIME_NODE_UNSIGNED_DISTRIBUTION"] == "1" {
            return acceptsUnsigned(bridgeCode: bridgeCode, parentCode: parentCode, initialParentProcessIdentifier: initialParentProcessIdentifier)
        }

        let bridgeIdentity = codeIdentity(for: bridgeCode)
        let parentIdentity = codeIdentity(for: parentCode)
        let finalParentProcessIdentifier = getppid()

        return ThingtimeNodeBridgeParentPolicy.accepts(ThingtimeNodeBridgeParentEvidence(
            initialParentProcessIdentifier: initialParentProcessIdentifier,
            finalParentProcessIdentifier: finalParentProcessIdentifier,
            bridgeIdentity: bridgeIdentity,
            parentIdentity: parentIdentity
        ))
    }

    private func acceptsUnsigned(bridgeCode: SecCode, parentCode: SecCode, initialParentProcessIdentifier: pid_t) -> Bool {
        // Unsigned distribution builds deliberately have no Apple team
        // identity. The temporary explicit environment marker is supplied only
        // by the packaged Electron integration, and we still require valid
        // ad-hoc code signatures plus the exact direct parent identifiers.
        guard getppid() == initialParentProcessIdentifier,
              satisfiesAnyCodeSignature(bridgeCode),
              satisfiesAnyCodeSignature(parentCode),
              let bridgeIdentity = unsignedCodeIdentity(for: bridgeCode),
              let parentIdentity = unsignedCodeIdentity(for: parentCode),
              bridgeIdentity == ThingtimeNodeBridgeParentPolicy.bridgeIdentifier,
              parentIdentity == ThingtimeNodeBridgeParentPolicy.parentIdentifier else {
            return false
        }
        return true
    }

    private func copyCurrentCode() -> SecCode? {
        var code: SecCode?
        guard SecCodeCopySelf([], &code) == errSecSuccess else { return nil }
        return code
    }

    private func copyCode(processIdentifier: pid_t) -> SecCode? {
        var code: SecCode?
        let attributes = [
            kSecGuestAttributePid as String: NSNumber(value: processIdentifier)
        ] as CFDictionary
        guard SecCodeCopyGuestWithAttributes(nil, attributes, [], &code) == errSecSuccess else {
            return nil
        }
        return code
    }

    private func codeIdentity(for code: SecCode) -> ThingtimeNodeBridgeCodeIdentity? {
        // Identifier and team are signed fields, so expose them to the pure
        // policy only after the live code satisfies Apple's generic anchor.
        guard satisfiesAppleGenericAnchor(code) else { return nil }

        var staticCode: SecStaticCode?
        guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess,
              let staticCode else {
            return nil
        }
        var information: CFDictionary?
        guard SecCodeCopySigningInformation(
            staticCode,
            SecCSFlags(rawValue: kSecCSSigningInformation),
            &information
        ) == errSecSuccess,
        let dictionary = information as? [String: Any] else {
            return nil
        }
        return ThingtimeNodeBridgeCodeIdentity(
            identifier: dictionary[kSecCodeInfoIdentifier as String] as? String,
            teamIdentifier: dictionary[kSecCodeInfoTeamIdentifier as String] as? String,
            hasAppleGenericAnchor: true
        )
    }

    private func satisfiesAppleGenericAnchor(_ code: SecCode) -> Bool {
        var requirement: SecRequirement?
        guard SecRequirementCreateWithString(
            Self.appleGenericRequirementSource as CFString,
            [],
            &requirement
        ) == errSecSuccess,
        let requirement else {
            return false
        }
        return SecCodeCheckValidity(
            code,
            SecCSFlags(rawValue: kSecCSStrictValidate),
            requirement
        ) == errSecSuccess
    }

    private func satisfiesAnyCodeSignature(_ code: SecCode) -> Bool {
        SecCodeCheckValidity(code, SecCSFlags(rawValue: kSecCSStrictValidate), nil) == errSecSuccess
    }

    private func unsignedCodeIdentity(for code: SecCode) -> String? {
        var staticCode: SecStaticCode?
        guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess,
              let staticCode else {
            return nil
        }
        var information: CFDictionary?
        guard SecCodeCopySigningInformation(
            staticCode,
            SecCSFlags(rawValue: kSecCSSigningInformation),
            &information
        ) == errSecSuccess,
        let dictionary = information as? [String: Any] else {
            return nil
        }
        return dictionary[kSecCodeInfoIdentifier as String] as? String
    }
}

private final class OneShotReply: @unchecked Sendable {
    private let lock = NSLock()
    private let semaphore = DispatchSemaphore(value: 0)
    private var value: Data?
    private var completed = false

    func finish(_ data: Data) {
        lock.lock()
        guard !completed else {
            lock.unlock()
            return
        }
        completed = true
        value = data
        lock.unlock()
        semaphore.signal()
    }

    func wait(seconds: Double) -> Data? {
        guard semaphore.wait(timeout: .now() + seconds) == .success else { return nil }
        lock.lock()
        defer { lock.unlock() }
        return value
    }
}

/// Stdout is a bounded sequence of frames, never one giant JSON response.
/// Writes block for pipe backpressure before acknowledging the XPC frame.
private final class ByteSink: NSObject, ThingtimeNodeByteSink {
    private let lock = NSLock()
    private var sent = 0
    private var closed = false
    func receive(_ data: Data, withReply reply: @escaping (Bool) -> Void) {
        lock.lock(); defer { lock.unlock() }
        guard !closed, !data.isEmpty, data.count <= 65_536, sent + data.count <= 32 * 1024 * 1024 else { reply(false); return }
        do {
            let frame: [String: Any] = ["type": "chunk", "offset": sent, "data": data.base64EncodedString()]
            var bytes = try JSONSerialization.data(withJSONObject: frame); bytes.append(10)
            try FileHandle.standardOutput.write(contentsOf: bytes)
            sent += data.count; reply(true)
        } catch { closed = true; reply(false) }
    }
    func finish(_ response: Data) {
        lock.lock(); defer { lock.unlock() }; closed = true
        guard let object = try? JSONSerialization.jsonObject(with: response),
              var bytes = try? JSONSerialization.data(withJSONObject: ["type": "result", "response": object]) else { return }
        bytes.append(10); try? FileHandle.standardOutput.write(contentsOf: bytes)
    }
}

@main
private enum ThingtimeNodeBridge {
    static func main() {
        guard DirectParentAuthenticator().accepts() else {
            rejectUntrustedParent()
        }

        let staging = CommandLine.arguments == [CommandLine.arguments[0], "--folder-stage-stream"]
        let batching = CommandLine.arguments == [CommandLine.arguments[0], "--folder-batch-stream"]
        let input: Data
        let request: NodeRequest
        do {
            if staging || batching {
                guard let header = try NodeFolderStreamInput.header(.standardInput, maximumBytes: batching ? 600_000 : 131_072) else { throw ThingtimeNodeError.invalidRequest("Missing stream header.") }
                input = header
            } else { input = FileHandle.standardInput.readDataToEndOfFile() }
            request = try NodeWireCodec.decodeRequest(input)
        } catch let error as ThingtimeNodeError {
            write(.failure(id: "", code: error.code, message: error.localizedDescription))
            return
        } catch {
            write(.failure(id: "", code: "invalid_request", message: "The node request is invalid."))
            return
        }

        let reply = OneShotReply()
        let connection = NSXPCConnection(machServiceName: ThingtimeNodeXPC.machServiceName)
        connection.remoteObjectInterface = ThingtimeNodeXPC.interface()
        connection.interruptionHandler = {
            reply.finish(encoded(.failure(id: request.id, code: "node_interrupted", message: "Thingtime Node was interrupted.")))
        }
        connection.invalidationHandler = {
            reply.finish(encoded(.failure(id: request.id, code: "node_unavailable", message: "Thingtime Node is unavailable.")))
        }
        connection.resume()

        let proxy = connection.remoteObjectProxyWithErrorHandler { _ in
            reply.finish(encoded(.failure(id: request.id, code: "node_unavailable", message: "Thingtime Node could not receive the request.")))
        }
        guard let service = proxy as? ThingtimeNodeXPCProtocol else {
            connection.invalidate()
            write(.failure(id: request.id, code: "node_unavailable", message: "Thingtime Node is unavailable."))
            return
        }
        let streaming: Bool
        if request.method == "folder-sync.request", case .object(let fields) = request.parameters,
           fields["action"] == .string("read-range") { streaming = true } else { streaming = false }
        let sink = ByteSink()
        var stageSource: NodeFolderStreamInput?
        var batchDuplex: NodeBatchDuplex?
        if staging {
            guard request.method == "folder-sync.request", case .object(let fields) = request.parameters,
                  fields["action"] == .string("stage-range"), case .number(let length) = fields["length"],
                  length.rounded() == length, length > 0, length <= 32 * 1024 * 1024,
                  let source = try? NodeFolderStreamInput(handle: .standardInput, length: Int(length)) else {
                connection.invalidate(); write(.failure(id: request.id, code: "invalid_request", message: "Invalid staging stream.")); return
            }
            stageSource = source
            service.stage(input, source: source) { data in reply.finish(data) }
        } else if batching {
            guard request.method == "folder-sync.request", case .object(let fields) = request.parameters,
                  fields["action"] == .string("upload-batch") else {
                connection.invalidate(); write(.failure(id: request.id, code: "invalid_request", message: "Invalid folder batch.")); return
            }
            let duplex = NodeBatchDuplex(input: .standardInput, output: .standardOutput)
            batchDuplex = duplex; duplex.start()
            service.bulk(input, callback: duplex) { data in reply.finish(data) }
        } else if streaming { service.stream(input, sink: sink) { data in reply.finish(data) } }
        else { service.request(input) { data in reply.finish(data) } }

        let response = withExtendedLifetime(stageSource) {
            reply.wait(seconds: ThingtimeNodeXPCRequestPolicy.bridgeResponseTimeoutSeconds(for: request.method))
                ?? encoded(.failure(id: request.id, code: "node_timeout", message: "Thingtime Node did not respond in time."))
        }
        connection.invalidate()
        if let batchDuplex { batchDuplex.finish(response) }
        else if streaming {
            sink.finish(response)
        } else { FileHandle.standardOutput.write(response) }
    }

    private static func encoded(_ response: NodeResponse) -> Data {
        (try? NodeWireCodec.encodeResponse(response))
            ?? Data(#"{"error":{"code":"encoding_error","message":"The bridge response could not be encoded."},"id":"","ok":false}"#.utf8)
    }

    private static func write(_ response: NodeResponse) {
        FileHandle.standardOutput.write(encoded(response))
    }

    private static func rejectUntrustedParent() -> Never {
        write(.failure(
            id: "",
            code: "bridge_unavailable",
            message: "The local setup bridge is unavailable."
        ))
        Darwin.exit(EXIT_FAILURE)
    }
}
