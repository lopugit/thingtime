// Test-only pipe transport for the production Mac adapter against a loopback API.
// Never linked into ThingtimeNode or the signed app; no installed Keychain/TCC use.
import AppleFileSync
import Foundation
import CryptoKit
@testable import ThingtimeNodeCore

struct Configuration: Decodable {
    let base: URL
    let deviceId: String
    let credential: String
    let directory: URL
    let photoFixture: Bool?
    let batchFixture: Bool?
    let commanderIndexer: URL?
}
/// Deterministic files stand in for PhotoKit only in this non-shipping fixture.
struct FixturePhotoResources: PhotoResourceProvider {
    let directory: URL
    func access() -> String { "full" }
    func inventory() throws -> [PhotoResource] {
        let bookmark = try directory.bookmarkData(options: [.withSecurityScope], includingResourceValuesForKeys: nil, relativeTo: nil)
        return try MobileFolderReader.scan(bookmark: bookmark).map { entry in
            guard entry.kind == "file", !entry.path.contains("/") else { throw MobileFolderStore.Failure.invalid }
            return PhotoResource(asset: entry.path, index: 0, name: entry.path, revision: entry.version)
        }
    }
    func validate(_ resource: PhotoResource) throws {
        guard try inventory().contains(resource) else { throw PhotoLibraryReader.Failure.changed }
    }
    func write(_ resource: PhotoResource, to url: URL) throws {
        try validate(resource)
        try FileManager.default.copyItem(at: directory.appendingPathComponent(resource.name), to: url)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        try validate(resource)
    }
}
// Observe the unchanged monotonic clock calls already surrounding native
// identity admission and HTTP. Each verification owns its TaskLocal sample.
struct FixtureRequestContext: Sendable {
    let id: String
    let action: String
    let path: String
    let started: Double
}
enum FixtureRequestClockContext { @TaskLocal static var request: FixtureRequestContext? }
private let fixtureTimingActions: Set<String> = ["validate-folder-batch", "upload-batch", "upload-single", "resources", "context", "conditions", "list", "choose", "remove", "scan", "scan-stream", "scan-stream-finish", "scan-changes", "scan-capture", "scan-status", "scan-cancel", "scan-skips", "scan-page", "scan-discard", "inspect", "read", "read-range", "stage-begin", "stage-append", "stage-range", "stage-finish", "write-approve", "write-check", "publication-lookup", "publish", "trash", "trash-lookup", "trash-expected", "trash-inspect", "trash-restore", "trash-restore-reviewed", "trash-list"]
func fixtureTimingLabel(_ value: JSONValue?, path: Bool = false) -> String {
    guard case .string(let text) = value else { return "other" }
    return (path ? ["local.bin", "remote.bin"].contains(text) : fixtureTimingActions.contains(text)) ? text : "other"
}
final class FixtureIdentityClock: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [Double] = []
    private let request: FixtureRequestContext?
    private let checkID: Int?
    init(checkID: Int? = nil, request: FixtureRequestContext? = FixtureRequestClockContext.request) {
        self.checkID = checkID; self.request = request
    }
    func append(_ value: Double) { lock.lock(); values.append(value); lock.unlock() }
    func summary() -> JSONValue {
        lock.lock(); let times = values; lock.unlock()
        var result: [String: JSONValue] = [
            "checkId": checkID.map { .number(Double($0)) } ?? .null,
            "requestId": request.map { .string($0.id) } ?? .null,
            "action": request.map { .string($0.action) } ?? .null,
            "path": request.map { .string($0.path) } ?? .null,
            "nativeRequestStartedMs": request.map { .number($0.started * 1000) } ?? .null,
            "clock": .string("native-system-uptime-ms"),
            "clockPointsMs": .array(times.map { .number($0 * 1000) })
        ]
        guard !times.isEmpty, times.count % 4 == 0 else {
            result["complete"] = .bool(false); result["clockSamples"] = .number(Double(times.count))
            return .object(result)
        }
        var admission = 0.0, http = 0.0, intervals: [JSONValue] = []
        for i in stride(from: 0, to: times.count, by: 4) {
            admission += (times[i + 1] - times[i]) * 1000
            http += (times[i + 3] - times[i + 2]) * 1000
            intervals.append(.object(["admissionStartMs": .number(times[i] * 1000), "admissionEndMs": .number(times[i + 1] * 1000),
                "httpStartMs": .number(times[i + 2] * 1000), "httpEndMs": .number(times[i + 3] * 1000)]))
        }
        result["complete"] = .bool(true); result["attempts"] = .number(Double(times.count / 4))
        result["admissionMs"] = .number(admission); result["httpMs"] = .number(http); result["intervals"] = .array(intervals)
        return .object(result)
    }
}
func fixtureClockSelfTest() throws {
    let old = FixtureRequestContext(id: "old-request", action: "read", path: "local.bin", started: 1)
    let new = FixtureRequestContext(id: "new-request", action: "inspect", path: "remote.bin", started: 10)
    let sample = FixtureRequestClockContext.$request.withValue(old) { FixtureIdentityClock(checkID: 1) }
    [1.1, 1.3, 1.4, 1.5].forEach(sample.append)
    let result = FixtureRequestClockContext.$request.withValue(new) { sample.summary() }
    guard case .object(let fields) = result, fields["requestId"] == .string("old-request"), fields["path"] == .string("local.bin"),
          fields["complete"] == .bool(true), case .number(let admission) = fields["admissionMs"], abs(admission - 200) < 0.001,
          case .array(let intervals) = fields["intervals"], intervals.count == 1 else { throw MobileFolderStore.Failure.invalid }
    let partial = FixtureIdentityClock(request: new); partial.append(10)
    guard case .object(let incomplete) = partial.summary(), incomplete["complete"] == .bool(false), incomplete["admissionMs"] == nil,
          incomplete["requestId"] == .string("new-request") else { throw MobileFolderStore.Failure.invalid }
    FileHandle.standardOutput.write(Data("{\"ok\":true,\"fixtureClockSelfTest\":true}\n".utf8))
}
enum FixtureIdentityClockContext { @TaskLocal static var sample: FixtureIdentityClock? }
actor Cooldowns {
    private var count = 0
    private var seconds: UInt64 = 0
    func wait(_ delay: UInt64) async throws {
        count += 1; seconds += delay
        try await Task.sleep(nanoseconds: delay * 1_000_000_000)
    }
    func snapshot() -> JSONValue { .object(["count": .number(Double(count)), "seconds": .number(Double(seconds))]) }
}
final class StreamCursor: @unchecked Sendable { var offset: Int64 = 0 }
final class FixtureOutput: @unchecked Sendable {
    private let lock = NSLock()
    private let handle: FileHandle
    init(handle: FileHandle = .standardOutput) { self.handle = handle }
    func write(_ value: JSONValue) throws {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        var bytes = try encoder.encode(value); bytes.append(10)
        lock.lock(); defer { lock.unlock() }
        try handle.write(contentsOf: bytes)
    }
}
// Same callback semantics as NodeBatchDuplex, fed by the ONE persistent
// framed reader rather than starting a competing newline stdin reader.
final class FixtureBatchPeer: NSObject, ThingtimeNodeBatchCallback, @unchecked Sendable {
    private let requestID: String, output: FixtureOutput
    private let lock = NSLock()
    private var pending: [Int: (Data) -> Void] = [:], sequence = 0
    private var closed = false
    init(requestID: String, output: FixtureOutput) { self.requestID = requestID; self.output = output }
    func exchange(_ data: Data, withReply reply: @escaping (Data) -> Void) {
        guard data.count <= 100_000, let frame = try? JSONDecoder().decode(JSONValue.self, from: data),
              case .object(let fields) = frame, case .string(let kind) = fields["kind"],
              ["prepare-ready", "chunk", "put-ready", "verify-ready"].contains(kind) else { reply(Data()); return }
        lock.lock()
        guard !closed, pending.count < 32, sequence < 4096 else { lock.unlock(); reply(Data()); return }
        sequence += 1; let id = sequence; pending[id] = reply
        do {
            try output.write(.object(["type": .string("batch"), "requestId": .string(requestID), "callbackId": .number(Double(id)),
                "frame": frame, "nativeEmittedMs": .number(ProcessInfo.processInfo.systemUptime * 1000)]))
            lock.unlock()
        } catch { lock.unlock(); close() }
    }
    func accept(_ fields: [String: JSONValue]) throws {
        guard Set(fields.keys) == ["action", "requestId", "callbackId", "reply"], fields["action"] == .string("fixture-batch-reply"),
              fields["requestId"] == .string(requestID), case .number(let number) = fields["callbackId"], number >= 1, number <= 4096,
              number.rounded() == number, let value = fields["reply"] else { throw MobileFolderStore.Failure.invalid }
        switch value { case .object, .array: break; default: throw MobileFolderStore.Failure.invalid }
        let data = try JSONEncoder().encode(value)
        guard data.count <= 524_288 else { throw MobileFolderStore.Failure.invalid }
        lock.lock()
        guard !closed, let reply = pending.removeValue(forKey: Int(number)) else { lock.unlock(); throw MobileFolderStore.Failure.invalid }
        lock.unlock(); reply(data)
    }
    func close() {
        lock.lock()
        guard !closed else { lock.unlock(); return }
        closed = true; let replies = Array(pending.values); pending.removeAll(); lock.unlock()
        replies.forEach { $0(Data()) }
    }
}
func fixtureDuplexSelfTest() throws {
    let pipe = Pipe(), output = FixtureOutput(handle: pipe.fileHandleForWriting)
    defer { try? pipe.fileHandleForWriting.close(); try? pipe.fileHandleForReading.close() }
    let peer = FixtureBatchPeer(requestID: "same-request", output: output)
    let frame = try JSONEncoder().encode(JSONValue.object(["kind": .string("chunk"), "ordinal": .number(0)]))
    var order: [Int] = [], closedReplies = 0
    peer.exchange(frame) { if !$0.isEmpty { order.append(1) } }
    peer.exchange(frame) { if !$0.isEmpty { order.append(2) } }
    func packet(_ request: String, _ id: Int) -> [String: JSONValue] {
        ["action": .string("fixture-batch-reply"), "requestId": .string(request), "callbackId": .number(Double(id)), "reply": .object(["status": .string("ack")])]
    }
    var refused = false
    do { try peer.accept(packet("wrong-request", 2)) } catch { refused = true }
    guard refused, order.isEmpty else { throw MobileFolderStore.Failure.invalid }
    try peer.accept(packet("same-request", 2)); try peer.accept(packet("same-request", 1))
    guard order == [2, 1] else { throw MobileFolderStore.Failure.invalid }
    refused = false; do { try peer.accept(packet("same-request", 1)) } catch { refused = true }
    guard refused else { throw MobileFolderStore.Failure.invalid }
    peer.close(); peer.close(); peer.exchange(frame) { if $0.isEmpty { closedReplies += 1 } }
    let eof = FixtureBatchPeer(requestID: "eof-request", output: output)
    eof.exchange(frame) { if $0.isEmpty { closedReplies += 1 } }; eof.close(); eof.close()
    guard closedReplies == 2 else { throw MobileFolderStore.Failure.invalid }
    try pipe.fileHandleForWriting.close()
    let frames = pipe.fileHandleForReading.readDataToEndOfFile().split(separator: 10)
    guard frames.count == 3 else { throw MobileFolderStore.Failure.invalid }
    FileHandle.standardOutput.write(Data("{\"ok\":true,\"fixtureDuplexSelfTest\":true}\n".utf8))
}
@MainActor private func dispatchFixtureRequest(_ service: MacFolderSync, _ request: JSONValue,
    stream: (@Sendable (Data) throws -> Void)? = nil, receive: (@Sendable (Int) throws -> Data)? = nil,
    peer: FixtureBatchPeer) async throws -> JSONValue {
    guard case .object(let fields) = request else { throw MobileFolderStore.Failure.invalid }
    if [JSONValue.string("upload-batch"), .string("upload-single")].contains(fields["action"] ?? .null) {
        return try await service.handle(request, stream: stream, receive: receive, batchCallback: { frame, timeout in
            try await NodeBatchCallback.exchange(peer, frame: frame, timeout: timeout)
        })
    }
    return try await service.handle(request, stream: stream, receive: receive)
}
@MainActor private func fixtureContextDispatchSelfTest() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let pipe = Pipe(), output = FixtureOutput(handle: pipe.fileHandleForWriting)
    defer { try? pipe.fileHandleForWriting.close(); try? pipe.fileHandleForReading.close() }
    let peer = FixtureBatchPeer(requestID: "context-self-test", output: output)
    defer { peer.close() }
    var identities = 0
    let service = try MacFolderSync(origin: URL(string: "https://fixture.test")!,
        store: MobileFolderStore(load: { _ in nil }, save: { _, _ in }),
        staging: MobileSyncStaging(directory: directory.appendingPathComponent("staging")),
        verify: { _, _ in identities += 1 }, choose: { nil }, approve: { _ in false })
    let request: JSONValue = .object(["requestId": .string(UUID().uuidString), "ownerId": .string("fixture-self-test"),
        "deviceId": .string("fixture-self-test-device"), "origin": .string("https://fixture.test"), "action": .string("context")])
    let result = try await dispatchFixtureRequest(service, request, peer: peer)
    guard identities == 2, case .object(let fields) = result, fields["capabilities"] != nil else { throw MobileFolderStore.Failure.invalid }
    FileHandle.standardOutput.write(Data("{\"ok\":true,\"fixtureContextDispatchSelfTest\":true}\n".utf8))
}
struct FixturePacket: Sendable {
    let request: JSONValue
    let bytes: Data?
    static func read() throws -> FixturePacket? {
        guard let input = try NodeFolderStreamInput.header(.standardInput, maximumBytes: 600_000) else { return nil }
        let request = try JSONDecoder().decode(JSONValue.self, from: input)
        var bytes: Data?
        if case .object(let fields) = request, fields["action"] == .string("stage-range") {
            guard case .number(let length) = fields["length"], length > 0, length <= 32 * 1024 * 1024,
                  length.rounded() == length else { throw MobileFolderStore.Failure.invalid }
            let source = try NodeFolderStreamInput(handle: .standardInput, length: Int(length))
            var data = Data()
            while data.count < Int(length) {
                data.append(try source.next(offset: Int64(data.count), length: min(65_536, Int(length) - data.count)))
            }
            bytes = data
        }
        return FixturePacket(request: request, bytes: bytes)
    }
}
final class StreamWriter: @unchecked Sendable {
    private var offset = 0
    private let requestId: String
    private let output: FixtureOutput
    init(requestId: String, output: FixtureOutput) { self.requestId = requestId; self.output = output }
    func receive(_ data: Data) throws {
        try output.write(.object(["type": .string("chunk"), "requestId": .string(requestId),
                                  "offset": .number(Double(offset)), "data": .string(data.base64EncodedString())]))
        offset += data.count
    }
}
@main struct Fixture {
    @MainActor static func main() async throws {
        if CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "--self-test-timing" { try fixtureClockSelfTest(); return }
        if CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "--self-test-duplex" { try fixtureDuplexSelfTest(); return }
        if CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "--self-test-context" { try await fixtureContextDispatchSelfTest(); return }
        guard CommandLine.arguments.count == 2 else { throw MobileFolderStore.Failure.invalid }
        let configurationURL = URL(fileURLWithPath: CommandLine.arguments[1])
        let attributes = try FileManager.default.attributesOfItem(atPath: configurationURL.path)
        guard (attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600,
              attributes[.type] as? FileAttributeType == .typeRegular else { throw MobileFolderStore.Failure.invalid }
        let config = try JSONDecoder().decode(Configuration.self, from: Data(contentsOf: configurationURL))
        guard config.base.scheme == "http", config.base.host == "127.0.0.1", config.base.user == nil, config.base.password == nil,
              config.directory.isFileURL else { throw MobileFolderStore.Failure.invalid }
        let credentials = InMemoryDeviceCredentialStore()
        try await credentials.save(DeviceCredential(deviceID: config.deviceId, refreshToken: config.credential,
            signingPrivateKey: Data(), signingPublicKey: Data()))
        let cooldowns = Cooldowns()
        let api = try ThingtimeAPIClient(baseURL: config.base, credentialStore: credentials, identityAdmission: .shared,
            fileSyncNow: {
                let now = ProcessInfo.processInfo.systemUptime
                FixtureIdentityClockContext.sample?.append(now); return now
            }, fileSyncRetrySleep: { delay in try await cooldowns.wait(delay) })
        let selected = config.directory.appendingPathComponent("selected", isDirectory: true)
        let records = config.directory.appendingPathComponent("grants", isDirectory: true)
        try FileManager.default.createDirectory(at: selected, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: records, withIntermediateDirectories: true)
        func record(_ scope: FileSyncOwnerScope) -> URL {
            records.appendingPathComponent(SHA256.hash(data: Data(scope.key.utf8)).map { String(format: "%02x", $0) }.joined() + ".json")
        }
        let store = MobileFolderStore(load: { scope in
            let file = record(scope)
            return FileManager.default.fileExists(atPath: file.path) ? try Data(contentsOf: file) : nil
        }, save: { scope, bytes in
            let file = record(scope)
            try bytes.write(to: file, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        })
        let database = config.directory.appendingPathComponent("private-filesystem-index.sqlite3")
        let transport = config.commanderIndexer.map { RustProcessInventoryTransport(helper: $0, database: database) }
        var identityChecks = 0, identityTotalMilliseconds = 0.0, identityMaxMilliseconds = 0.0
        var identityCalls: [JSONValue] = [], reportedIdentityCalls = 0
        let service = try MacFolderSync(origin: config.base, store: store,
            staging: MobileSyncStaging(directory: config.directory.appendingPathComponent("staging")),
            trash: MobileSyncTrash(directory: config.directory.appendingPathComponent("trash")),
            verify: { owner, device in
                identityChecks += 1
                let started = ProcessInfo.processInfo.systemUptime
                let sample = FixtureIdentityClock(checkID: identityChecks)
                defer {
                    identityCalls.append(sample.summary())
                    let elapsed = (ProcessInfo.processInfo.systemUptime - started) * 1000
                    identityTotalMilliseconds += elapsed; identityMaxMilliseconds = max(identityMaxMilliseconds, elapsed)
                }
                try await FixtureIdentityClockContext.$sample.withValue(sample) {
                    try await api.verifyFileSyncIdentity(ownerID: owner, deviceID: device)
                }
            },
            choose: { selected }, approve: { _ in true },
            chooseSource: config.photoFixture == true ? { .photos } : nil,
            photos: PhotoLibraryReader(provider: FixturePhotoResources(directory: selected), transport: transport), inventories: MobileFolderInventory(directory: config.directory.appendingPathComponent("inventory"), transport: transport, database: database), approveTrash: { _ in true }, approveRestore: { _, _ in true }, conditions: { .init(network: "wifi", charging: true) })
        // Resource preferences for synthetic identities belong only to this
        // disposable fixture. Remove their exact keys on normal shutdown.
        var fixturePolicyKeys = Set<String>()
        defer { for key in fixturePolicyKeys { UserDefaults.standard.removeObject(forKey: key) } }
        if config.batchFixture == true {
            guard let input = try NodeFolderStreamInput.header(.standardInput, maximumBytes: 600_000) else { throw MobileFolderStore.Failure.invalid }
            let request = try JSONDecoder().decode(JSONValue.self, from: input)
            guard case .object(let fields) = request, fields["action"] == .string("upload-batch"), case .string(let id) = fields["requestId"] else { throw MobileFolderStore.Failure.invalid }
            let duplex = NodeBatchDuplex(input: .standardInput, output: .standardOutput); duplex.start()
            let response: [String: Any]
            do {
                let result = try await service.handle(request, batchCallback: { frame, timeout in
                    try await NodeBatchCallback.exchange(duplex, frame: frame, timeout: timeout)
                })
                response = ["id": id, "ok": true, "result": try JSONSerialization.jsonObject(with: JSONEncoder().encode(result))]
            } catch { response = ["id": id, "ok": false, "error": ["code": "fixture-refused", "message": "Fixture batch refused"]] }
            duplex.finish(try JSONSerialization.data(withJSONObject: response)); return
        }
        let output = FixtureOutput()
        var requests: [String: Task<Void, Never>] = [:]
        var peers: [String: FixtureBatchPeer] = [:], retired = Set<String>()
        do {
            // Block only the reader task. MainActor must remain free to resume
            // MacFolderSync's independent streamWaiter and active request lanes.
            while let packet = try await Task.detached(operation: { try FixturePacket.read() }).value {
                guard case .object(let fields) = packet.request, case .string(let id) = fields["requestId"] else {
                    throw MobileFolderStore.Failure.invalid
                }
                if fields["action"] == .string("fixture-cancel") { requests[id]?.cancel(); peers[id]?.close(); continue }
                if fields["action"] == .string("fixture-batch-reply") {
                    if let peer = peers[id] { try peer.accept(fields) }
                    else if !retired.contains(id) { throw MobileFolderStore.Failure.invalid }
                    continue
                }
                guard requests[id] == nil else { throw MobileFolderStore.Failure.invalid }
                if fields["deviceResourceLimits"] != nil,
                   case .string(let owner) = fields["ownerId"], case .string(let device) = fields["deviceId"] {
                    let scope = try JSONEncoder().encode([config.base.absoluteString, owner, device]).base64EncodedString()
                    fixturePolicyKeys.insert("thingtime.sync.resources.v1." + scope)
                }
                let peer = FixtureBatchPeer(requestID: id, output: output); peers[id] = peer
                requests[id] = Task { @MainActor in
                    defer { peer.close(); peers.removeValue(forKey: id); retired.insert(id); requests.removeValue(forKey: id) }
                    let started = ProcessInfo.processInfo.systemUptime
                    let requestContext = FixtureRequestContext(id: id, action: fixtureTimingLabel(fields["action"]),
                        path: fixtureTimingLabel(fields["path"], path: true), started: started)
                    let lane = fields["action"] == .string("scan-changes") ? "poll" : fields["action"] == .string("resources") && (fields["rootId"] == nil || fields["rootId"] == .null) ? "resources" : "active"
                    var response: [String: JSONValue]
                    do {
                        let stream: (@Sendable (Data) throws -> Void)?
                        if fields["action"] == .string("read-range") {
                            let writer = StreamWriter(requestId: id, output: output)
                            stream = { try writer.receive($0) }
                        } else { stream = nil }
                        let receive: (@Sendable (Int) throws -> Data)?
                        if let bytes = packet.bytes {
                            let cursor = StreamCursor()
                            receive = { count in
                                guard count > 0, cursor.offset + Int64(count) <= Int64(bytes.count) else { throw MobileFolderStore.Failure.invalid }
                                let start = Int(cursor.offset); cursor.offset += Int64(count)
                                return bytes.subdata(in: start..<(start + count))
                            }
                        } else { receive = nil }
                        response = ["ok": .bool(true), "result": try await FixtureRequestClockContext.$request.withValue(requestContext) {
                            try await dispatchFixtureRequest(service, packet.request, stream: stream, receive: receive, peer: peer)
                        }]
                    } catch {
                        // Never serialize a throwable message or request fields.
                        response = ["ok": .bool(false), "error": .string(Task.isCancelled ? "fixture-cancelled" : "fixture-refused")]
                    }
                    response["requestId"] = .string(id)
                    response["identityChecks"] = .number(Double(identityChecks))
                    response["identityCalls"] = .array(Array(identityCalls.dropFirst(reportedIdentityCalls)))
                    reportedIdentityCalls = identityCalls.count
                    response["identityTiming"] = .object(["totalMs": .number(identityTotalMilliseconds), "maxMs": .number(identityMaxMilliseconds)])
                    let ended = ProcessInfo.processInfo.systemUptime
                    response["serviceMs"] = .number((ended - started) * 1000)
                    response["nativeRequestTiming"] = .object(["startedMs": .number(started * 1000), "endedMs": .number(ended * 1000),
                        "clock": .string("native-system-uptime-ms"), "lane": .string(lane), "action": .string(requestContext.action), "path": .string(requestContext.path)])
                    response["cooldowns"] = await cooldowns.snapshot()
                    do { try output.write(.object(response)) } catch { /* Reader EOF/exit rejects pipe callers. */ }
                }
            }
        } catch {
            for task in requests.values { task.cancel() }
            for peer in peers.values { peer.close() }
            let remaining = Array(requests.values)
            for task in remaining { await task.value }
            throw error
        }
        // EOF closes this test session; no orphan service requests survive it.
        let remaining = Array(requests.values)
        for task in remaining { task.cancel() }
        for peer in peers.values { peer.close() }
        for task in remaining { await task.value }
    }
}
