import AppleFileSync
import CoreFoundation
import Foundation

/// Local scheduling preferences; never a replacement for the selected account's
/// device, folder grant or saved configuration authorization.
struct NativePhotoTransferPolicy: Codable, Equatable, Sendable {
    let uploadBytesPerSecond: Int64?
    let uploadBytesPerHour: Int64?
    static let unlimited = Self(uploadBytesPerSecond: nil, uploadBytesPerHour: nil)
    var valid: Bool {
        [uploadBytesPerSecond, uploadBytesPerHour].allSatisfy { $0.map { (1...9_007_199_254_740_991).contains($0) } ?? true }
    }
    var json: [String: Any] {
        var result: [String: Any] = [:]
        if let uploadBytesPerSecond { result["uploadBytesPerSecond"] = uploadBytesPerSecond }
        if let uploadBytesPerHour { result["uploadBytesPerHour"] = uploadBytesPerHour }
        return result
    }
    static func parse(_ raw: Any?) throws -> Self {
        guard let value = raw as? [String: Any], Set(value.keys).isSubset(of: ["uploadBytesPerSecond", "uploadBytesPerHour"]) else { throw MobileFolderStore.Failure.invalid }
        func bytes(_ key: String) throws -> Int64? {
            guard let raw = value[key] else { return nil }
            guard let n = raw as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(),
                  n.doubleValue.isFinite, n.doubleValue.rounded() == n.doubleValue,
                  n.doubleValue >= 1, n.doubleValue <= 9_007_199_254_740_991 else { throw MobileFolderStore.Failure.invalid }
            return n.int64Value
        }
        return try .init(uploadBytesPerSecond: bytes("uploadBytesPerSecond"), uploadBytesPerHour: bytes("uploadBytesPerHour"))
    }
}

/// One atomic owner/origin/device file. Preference changes never remove usage.
@MainActor
final class NativePhotoTransferPolicyStore {
    struct Limits: Sendable {
        let device: NativePhotoTransferPolicy
        let folder: NativePhotoTransferPolicy
        let configuration: NativePhotoTransferPolicy
        var rate: Int64 { rates.map(\.rate).min() ?? 625_000 }
        var rates: [NativePhotoRateConstraint] {
            var values: [NativePhotoRateConstraint] = []
            if let rate = device.uploadBytesPerSecond { values.append(.init(key: "device", rate: rate)) }
            if let rate = folder.uploadBytesPerSecond { values.append(.init(key: "folder:" + rootId, rate: rate)) }
            values.append(.init(key: "configuration:" + configurationId, rate: configuration.uploadBytesPerSecond ?? 625_000))
            return values
        }
        let rootId: String
        let configurationId: String
    }
    private struct State: Codable { var device: NativePhotoTransferPolicy = .unlimited; var folders: [String: NativePhotoTransferPolicy] = [:] }
    private let directory: URL
    init(directory: URL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]) {
        self.directory = directory.appendingPathComponent("NativePhotoTransferPolicy-v1", isDirectory: true)
    }
    static func key(scope: FileSyncOwnerScope, deviceId: String) -> String {
        [scope.origin.absoluteString, scope.ownerId, deviceId].joined(separator: "\n")
    }
    private func file(scope: FileSyncOwnerScope, deviceId: String) -> URL {
        directory.appendingPathComponent(PhotoLibraryReader.hash(Data(Self.key(scope: scope, deviceId: deviceId).utf8)) + ".json")
    }
    private func load(_ file: URL) throws -> State {
        do {
            let state = try JSONDecoder().decode(State.self, from: Data(contentsOf: file))
            guard state.device.valid, state.folders.values.allSatisfy(\.valid) else { throw MobileFolderStore.Failure.invalid }
            return state
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile { return State() }
    }
    func read(scope: FileSyncOwnerScope, deviceId: String, rootId: String? = nil) throws -> NativePhotoTransferPolicy {
        let state = try load(file(scope: scope, deviceId: deviceId))
        return rootId.map { state.folders[$0] ?? .unlimited } ?? state.device
    }
    func save(_ policy: NativePhotoTransferPolicy, scope: FileSyncOwnerScope, deviceId: String, rootId: String? = nil) throws {
        guard policy.valid else { throw MobileFolderStore.Failure.invalid }
        let target = file(scope: scope, deviceId: deviceId)
        var state = try load(target)
        if let rootId { state.folders[rootId] = policy == .unlimited ? nil : policy } else { state.device = policy }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(state).write(to: target, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        var folder = directory, values = URLResourceValues(); values.isExcludedFromBackup = true; try folder.setResourceValues(values)
    }
    func limits(scope: FileSyncOwnerScope, authorization: NativeUploadAuthorization) throws -> Limits {
        guard let configuration = authorization.configuration.managedPhotos, configuration.valid else { throw MobileFolderStore.Failure.invalid }
        let state = try load(file(scope: scope, deviceId: authorization.scope.deviceId))
        return .init(device: state.device, folder: state.folders[authorization.configuration.localRootId] ?? .unlimited,
                     configuration: .init(uploadBytesPerSecond: configuration.uploadBytesPerSecond, uploadBytesPerHour: configuration.uploadBytesPerHour),
                     rootId: authorization.configuration.localRootId, configurationId: authorization.id)
    }
}

struct NativePhotoRateConstraint: Sendable { let key: String; let rate: Int64 }
