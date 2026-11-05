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
private let fixtureTimingActions: Set<String> = ["validate-folder-batch", "upload-batch", "resources", "context", "conditions", "list", "choose", "remove", "scan", "scan-stream", "scan-stream-finish", "scan-changes", "scan-capture", "scan-status", "scan-cancel", "scan-skips", "scan-page", "scan-discard", "inspect", "read", "read-range", "stage-begin", "stage-append", "stage-range", "stage-finish", "write-approve", "write-check", "publication-lookup", "publish", "trash", "trash-lookup", "trash-expected", "trash-inspect", "trash-restore", "trash-restore-reviewed", "trash-list"]
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
    func write(_ value: JSONValue) throws {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        var bytes = try encoder.encode(value); bytes.append(10)
        lock.lock(); defer { lock.unlock() }
        try FileHandle.standardOutput.write(contentsOf: bytes)
    }
}
struct FixturePacket: Sendable {
    let request: JSONValue
    let bytes: Data?
    static func read() throws -> FixturePacket? {
        guard let input = try NodeFolderStreamInput.header(.standardInput, maximumBytes: 524_288) else { return nil }
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
        do {
            // Block only the reader task. MainActor must remain free to resume
            // MacFolderSync's independent streamWaiter and active request lanes.
            while let packet = try await Task.detached(operation: { try FixturePacket.read() }).value {
                guard case .object(let fields) = packet.request, case .string(let id) = fields["requestId"] else {
                    throw MobileFolderStore.Failure.invalid
                }
                if fields["action"] == .string("fixture-cancel") { requests[id]?.cancel(); continue }
                guard requests[id] == nil else { throw MobileFolderStore.Failure.invalid }
                if fields["deviceResourceLimits"] != nil,
                   case .string(let owner) = fields["ownerId"], case .string(let device) = fields["deviceId"] {
                    let scope = try JSONEncoder().encode([config.base.absoluteString, owner, device]).base64EncodedString()
                    fixturePolicyKeys.insert("thingtime.sync.resources.v1." + scope)
                }
                requests[id] = Task { @MainActor in
                    defer { requests.removeValue(forKey: id) }
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
                            try await service.handle(packet.request, stream: stream, receive: receive)
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
            let remaining = Array(requests.values)
            for task in remaining { await task.value }
            throw error
        }
        // EOF closes this test session; no orphan service requests survive it.
        let remaining = Array(requests.values)
        for task in remaining { task.cancel() }
        for task in remaining { await task.value }
    }
}
