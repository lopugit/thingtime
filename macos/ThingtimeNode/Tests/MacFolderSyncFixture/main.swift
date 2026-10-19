// Test-only pipe transport for the production Mac adapter against a loopback API.
// Never linked into ThingtimeNode or the signed app; no installed Keychain/TCC use.
import AppleFileSync
import Foundation
import CryptoKit
import ThingtimeNodeCore

struct Configuration: Decodable {
    let base: URL
    let deviceId: String
    let credential: String
    let directory: URL
    let photoFixture: Bool?
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
final class StreamWriter: @unchecked Sendable {
    private var offset = 0
    func receive(_ data: Data) throws {
        var bytes = try JSONSerialization.data(withJSONObject: ["type": "chunk", "offset": offset, "data": data.base64EncodedString()])
        bytes.append(10); try FileHandle.standardOutput.write(contentsOf: bytes); offset += data.count
    }
}
@main struct Fixture {
    @MainActor static func main() async throws {
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
        let api = try ThingtimeAPIClient(baseURL: config.base, credentialStore: credentials,
            fileSyncRetrySleep: { delay in try await cooldowns.wait(delay) })
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
        var identityChecks = 0
        let service = try MacFolderSync(origin: config.base, store: store,
            staging: MobileSyncStaging(directory: config.directory.appendingPathComponent("staging")),
            trash: MobileSyncTrash(directory: config.directory.appendingPathComponent("trash")),
            verify: { owner, device in identityChecks += 1; try await api.verifyFileSyncIdentity(ownerID: owner, deviceID: device) },
            choose: { selected }, approve: { _ in true },
            chooseSource: config.photoFixture == true ? { .photos } : nil,
            photos: PhotoLibraryReader(provider: FixturePhotoResources(directory: selected)), approveTrash: { _ in true }, approveRestore: { _, _ in true }, conditions: { .init(network: "wifi", charging: true) })
        while let input = try NodeFolderStreamInput.header(.standardInput) {
            let response: JSONValue
            do {
                guard input.count <= 131_072 else { throw MobileFolderStore.Failure.limit }
                let request = try JSONDecoder().decode(JSONValue.self, from: input)
                let stream: (@Sendable (Data) throws -> Void)?
                if case .object(let fields) = request, fields["action"] == .string("read-range") {
                    let writer = StreamWriter(); stream = { try writer.receive($0) }
                } else { stream = nil }
                let receive: (@Sendable (Int) throws -> Data)?
                if case .object(let fields) = request, fields["action"] == .string("stage-range"),
                   case .number(let length) = fields["length"], length > 0, length <= 32 * 1024 * 1024, length.rounded() == length {
                    let source = try NodeFolderStreamInput(handle: .standardInput, length: Int(length))
                    let cursor = StreamCursor()
                    receive = { count in
                        let bytes = try source.next(offset: cursor.offset, length: count)
                        cursor.offset += Int64(bytes.count); return bytes
                    }
                } else { receive = nil }
                response = .object(["ok": .bool(true), "result": try await service.handle(request, stream: stream, receive: receive), "identityChecks": .number(Double(identityChecks)), "cooldowns": await cooldowns.snapshot()])
            } catch {
                response = .object(["ok": .bool(false), "error": .string(String(describing: error)), "identityChecks": .number(Double(identityChecks)), "cooldowns": await cooldowns.snapshot()])
            }
            var bytes = try JSONEncoder().encode(response); bytes.append(10)
            try FileHandle.standardOutput.write(contentsOf: bytes)
        }
    }
}
