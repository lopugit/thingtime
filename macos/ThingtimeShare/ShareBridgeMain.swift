import Foundation
import CoreFoundation

/// Private stdio adapter. Its parent supplies verified destinations; renderer
/// messages cannot select groups, paths, requests or origins.
@main struct ShareBridgeMain {
    static func main() async {
        do {
            var options: [String: String] = [:]
            var allowed = ["--group", "--request", "--origin", "--endpoint"]
            #if THINGTIME_SHARE_TESTING
            allowed.append("--test-root")
            #endif
            var arguments = Array(CommandLine.arguments.dropFirst())
            while !arguments.isEmpty {
                let key = arguments.removeFirst()
                guard allowed.contains(key), !arguments.isEmpty, options[key] == nil else { throw ShareComposerSession.Failure.invalidRequest }
                options[key] = arguments.removeFirst()
            }
            guard let group = options["--group"], !group.isEmpty,
                  let request = options["--request"].flatMap(UUID.init(uuidString:)),
                  let origin = options["--origin"].flatMap(URL.init(string:)),
                  let endpoint = options["--endpoint"].flatMap(URL.init(string:)) else { throw ShareComposerSession.Failure.invalidRequest }
            let root: URL
            #if THINGTIME_SHARE_TESTING
            if let testRoot = options["--test-root"], testRoot.hasPrefix("/") {
                root = URL(fileURLWithPath: testRoot, isDirectory: true)
            } else {
                guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else { throw ShareComposerSession.Failure.unavailable }
                root = container.appendingPathComponent("ShareInbox", isDirectory: true)
            }
            #else
            guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else { throw ShareComposerSession.Failure.unavailable }
            root = container.appendingPathComponent("ShareInbox", isDirectory: true)
            #endif
            let inbox = ShareInbox(root: root)
            let session = try ShareComposerSession(inbox: inbox, id: request, origin: origin, endpoint: endpoint, bindUnboundOrigin: true)
            while let line = readLine() {
                do {
                    guard let data = line.data(using: .utf8), let body = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw ShareComposerSession.Failure.invalidRequest }
                    let result = try await dispatch(body, session: session)
                    reply(["ok": true, "result": result])
                } catch { reply(["ok": false, "error": safeError(error)]) }
            }
        } catch { reply(["ok": false, "error": safeError(error)]); exit(1) }
    }
    static func safeError(_ error: Error) -> String {
        if let failure = error as? ShareComposerSession.Failure { return failure.localizedDescription }
        if let failure = error as? ShareInbox.Failure { return failure.localizedDescription }
        return "The local share could not be read or saved. Its original files remain on this device."
    }
    static func reply(_ body: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys]), let text = String(data: data, encoding: .utf8) else { return }
        print(text)
        fflush(stdout)
    }
    static func integer(_ value: Any?, minimum: Double, maximum: Double) throws -> NSNumber {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue.isFinite,
              number.doubleValue >= minimum, number.doubleValue <= maximum, number.doubleValue.rounded() == number.doubleValue else { throw ShareComposerSession.Failure.invalidRequest }
        return number
    }
    static func dispatch(_ body: [String: Any], session: ShareComposerSession) async throws -> Any {
        guard let method = body["method"] as? String else { throw ShareComposerSession.Failure.invalidRequest }
        if method == "manifest" {
            return ["version": ShareComposerSession.version, "origin": session.origin, "requestId": session.id.uuidString,
                    "maxChunkBytes": ShareComposerSession.maxChunkBytes, "thumbnailMaxDimension": 640, "thumbnailMaxBytes": 512 * 1024] as [String: Any]
        }
        guard let requestId = body["requestId"] as? String, UUID(uuidString: requestId) == session.id,
              let account = body["accountId"] as? String, !account.isEmpty else { throw ShareComposerSession.Failure.identity }
        switch method {
        case "getIncomingShare": return try session.incoming(accountId: account)
        case "read":
            guard let file = body["fileId"] as? String else { throw ShareComposerSession.Failure.invalidRequest }
            let offset = try integer(body["offset"], minimum: 0, maximum: 9_007_199_254_740_991)
            let length = try integer(body["length"], minimum: 1, maximum: Double(ShareComposerSession.maxChunkBytes))
            return try session.read(accountId: account, fileId: file, offset: offset.uint64Value, length: length.intValue)
        case "thumbnail":
            guard let file = body["fileId"] as? String else { throw ShareComposerSession.Failure.invalidRequest }
            let dimension = try integer(body["maxDimension"], minimum: 1, maximum: 640)
            return try await session.thumbnail(accountId: account, fileId: file, maxDimension: dimension.intValue) as Any? ?? NSNull()
        case "beginSubmission", "recordOutcome":
            guard let destination = body["destination"] as? String, let operation = body["operationId"] as? String,
                  body["targetId"] == nil || body["targetId"] is String,
                  body["recoveryPayload"] == nil || body["recoveryPayload"] is String else { throw ShareComposerSession.Failure.invalidRequest }
            let submission = ShareComposerSubmission(destination: destination, operationId: operation, targetId: body["targetId"] as? String, recoveryPayload: body["recoveryPayload"] as? String)
            if method == "beginSubmission" { return try session.beginSubmission(accountId: account, submission: submission) }
            guard let ids = body["outcomeIds"] as? [String] else { throw ShareComposerSession.Failure.invalidRequest }
            return try session.recordOutcome(accountId: account, submission: submission, outcomeIds: ids)
        case "complete": try session.complete(accountId: account); return ["ok": true]
        default: throw ShareComposerSession.Failure.invalidRequest
        }
    }
}
