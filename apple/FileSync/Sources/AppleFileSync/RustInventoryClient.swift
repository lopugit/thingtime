import Foundation
import Darwin

struct RustInventoryClient: Sendable {
    let transport: any RustInventoryTransport
    typealias Scope = MobileFolderInventory.Scope
    typealias Failure = MobileFolderStore.Failure
    typealias Entry = MobileFolderReader.Entry

    struct Root: Equatable, Sendable {
        let path: String
        let identity: String
        init(fd: Int32) throws {
            var bytes = [CChar](repeating: 0, count: Int(MAXPATHLEN))
            guard fcntl(fd, F_GETPATH, &bytes) == 0, let path = String(validatingCString: bytes),
                  path.hasPrefix("/") else { throw Failure.unavailable }
            let info = try MobileFolderReader.info(fd)
            guard info.st_mode & S_IFMT == S_IFDIR else { throw Failure.unavailable }
            self.path = path; identity = NativeSymbolicLinks.identity(info)
        }
        var fields: [String: Any] { ["root": path, "rootIdentity": identity] }
        func revalidate(fd: Int32) throws {
            guard try Root(fd: fd) == self else { throw Failure.changed }
            let reopened = open(path, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW)
            guard reopened >= 0 else { throw Failure.changed }; defer { close(reopened) }
            guard try Root(fd: reopened) == self else { throw Failure.changed }
        }
    }

    struct Status: Decodable {
        let generation: String, mode: String, coverage: String, rootVersion: String, state: String
        let entryCount: Int, gapCount: Int, ignoredCount: Int, revision: Int
    }
    struct Page: Decodable {
        let generation: String, coverage: String, rootVersion: String
        let totalEntries: Int, nextOffset: Int?
        let entries: [Entry]
        let status: Status?
    }
    struct Gap: Decodable {
        let sequence: Int?
        let path: String?
        let reason: MobileFolderReader.ScanFailure.Reason
        let scope: MobileFolderReader.BackupGap.Scope
        func checked() throws -> MobileFolderReader.BackupGap {
            let value = MobileFolderReader.BackupGap(path: path, reason: reason, scope: scope)
            guard value.path == path, value.reason == reason, value.scope == scope else { throw RustInventoryTransportFailure.invalidResponse }
            return value
        }
    }
    struct GapPage: Decodable {
        let generation: String
        let gapCount: Int, nextOffset: Int?
        let gaps: [Gap]
    }
    private struct Event: Decodable {
        let event: String, generation: String?
        let version: Int?, streaming: Bool?
        let entry: Entry?, gap: Gap?, usage: CommanderResourceUsage?
        let coverage: String?
    }
    /// Process and embedded transports serialize callbacks on the caller.
    private final class ScanState: @unchecked Sendable {
        var hello = false, complete = false, indexed = false, stop = false
        var entries = 0, skipped = 0, ignored = 0, helperSequence = 0
        var strictFailure: MobileFolderReader.ScanFailure?
    }
    private final class Reply: @unchecked Sendable { var data: Data? }

    static func data(_ fields: [String: Any]) throws -> Data {
        var result = try JSONSerialization.data(withJSONObject: fields)
        result.append(10); return result
    }

    static var receiptPath: String {
        let directory = NativeSymbolicLinks.registry
        let parent = directory.deletingLastPathComponent()
        let fd = open(parent.path, O_RDONLY | O_DIRECTORY | O_CLOEXEC)
        if fd >= 0 {
            defer { close(fd) }
            if let path = try? Root(fd: fd).path {
                return URL(fileURLWithPath: path, isDirectory: true).appendingPathComponent(directory.lastPathComponent).path
            }
        }
        return parent.resolvingSymlinksInPath().appendingPathComponent(directory.lastPathComponent).path
    }

    private func request(_ operation: String, scope: Scope?, generation: String?, fields: [String: Any]) throws -> Data {
        var body = fields
        body["version"] = 1; body["operation"] = operation
        if let scope { body["scope"] = ["origin": scope.owner.origin.absoluteString, "accountId": scope.owner.ownerId,
                                       "deviceId": scope.deviceId, "rootId": scope.rootId] }
        if let generation { body["generation"] = generation }
        return try Self.data(body)
    }

    func run<T: Decodable>(_ operation: String, scope: Scope? = nil, generation: String? = nil,
                                  fields: [String: Any] = [:], as: T.Type = T.self) throws -> T {
        let response = Reply()
        let request = try request(operation, scope: scope, generation: generation, fields: fields)
        do {
            try transport.run(request: request, isCancelled: { Task.isCancelled }) { data in
                guard response.data == nil else { throw RustInventoryTransportFailure.invalidResponse }
                response.data = data
            }
        } catch {
            if operation == "seal", !(error is CancellationError), let data = response.data,
               let event = try? JSONDecoder().decode(Event.self, from: data), event.event == "skipped",
               let gap = try event.gap?.checked(), let typed = Self.strictFailure(gap) {
                throw typed
            }
            throw Self.project(error)
        }
        guard let data = response.data else { throw RustInventoryTransportFailure.invalidResponse }
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw RustInventoryTransportFailure.invalidResponse }
    }

    private static func strictFailure(_ gap: MobileFolderReader.BackupGap) -> MobileFolderReader.ScanFailure? {
        guard gap.path != nil || gap.reason == .invalidPath else { return nil }
        // Preserve the strict native contract's generic unsupported-inode
        // reason while backup exposes the detailed typed gap.
        let reason: MobileFolderReader.ScanFailure.Reason = [.fifo, .socket, .device].contains(gap.reason) ? .special : gap.reason
        return .init(reason: reason, path: gap.path)
    }

    private static func project(_ error: Error) -> Error {
        guard case RustInventoryTransportFailure.operation(let code) = error else { return error }
        switch code {
        case "generation_unavailable", "generation_exists", "revision_changed", "source_changed",
             "directory_unavailable", "capture_cancelled", "mount_changed", "watcher_gap", "changed": return Failure.changed
        case "source_unavailable", "native_receipts_unavailable", "unreadable": return Failure.unavailable
        case "invalid_request", "invalid_scope": return Failure.invalid
        default: return error
        }
    }

    func status(_ scope: Scope, generation: String) throws -> Status? {
        let value = try run("status", scope: scope, generation: generation, as: Status?.self)
        if let value { try Self.checkStatus(value, generation: generation) }
        return value
    }
    func requireStatus(_ scope: Scope, generation: String) throws -> Status {
        guard let value = try status(scope, generation: generation) else { throw Failure.changed }; return value
    }
    private static func checkStatus(_ value: Status, generation: String) throws {
        guard value.generation == generation, ["strict", "backup"].contains(value.mode),
              ["scanning", "prepared", "sealed", "provisional", "invalidated", "cancelled"].contains(value.coverage),
              ["running", "indexed", "complete", "interrupted"].contains(value.state),
              [value.entryCount, value.gapCount, value.ignoredCount, value.revision].allSatisfy(validCount),
              Self.validVersion(value.rootVersion) else { throw RustInventoryTransportFailure.invalidResponse }
    }
    private static func validCount(_ value: Int) -> Bool { (0...9_007_199_254_740_991).contains(value) }

    func invalidateIfPresent(_ scope: Scope, generation: String) throws {
        guard let status = try status(scope, generation: generation), !["cancelled", "invalidated"].contains(status.coverage) else { return }
        let result: Status = try run("invalidate", scope: scope, generation: generation)
        try Self.checkStatus(result, generation: generation)
        guard ["cancelled", "invalidated"].contains(result.coverage) else { throw Failure.changed }
    }
    func page(_ scope: Scope, generation: String, offset: Int, limit: Int) throws -> Page {
        let result: Page = try run("page", scope: scope, generation: generation, fields: ["offset": offset, "limit": limit])
        guard result.generation == generation, Self.validCount(result.totalEntries) else { throw RustInventoryTransportFailure.invalidResponse }
        return result
    }
    /// The Rust page operation already loads status and fences the root/snapshot.
    /// Reuse that same response instead of spawning a second helper for status.
    func checkedPage(_ scope: Scope, generation: String, offset: Int, limit: Int) throws -> (Page, Status) {
        let result = try page(scope, generation: generation, offset: offset, limit: limit)
        guard let status = result.status else { throw RustInventoryTransportFailure.invalidResponse }
        try Self.checkStatus(status, generation: generation)
        guard status.mode != "photo", status.coverage == result.coverage,
              status.rootVersion == result.rootVersion, status.entryCount == result.totalEntries else {
            throw RustInventoryTransportFailure.invalidResponse
        }
        return (result, status)
    }
    func gaps(_ scope: Scope, generation: String, offset: Int, limit: Int) throws -> GapPage {
        let result: GapPage = try run("gaps", scope: scope, generation: generation, fields: ["offset": offset, "limit": limit])
        guard result.generation == generation, Self.validCount(result.gapCount) else { throw RustInventoryTransportFailure.invalidResponse }
        var sequence = 0
        for gap in result.gaps {
            guard let next = gap.sequence, next > sequence else { throw RustInventoryTransportFailure.invalidResponse }; sequence = next
        }
        return result
    }
    func changes(_ scope: Scope, generation: String, after: Int, limit: Int) throws -> MobileFolderInventory.ChangesPage {
        let result: MobileFolderInventory.ChangesPage = try run("changes", scope: scope, generation: generation, fields: ["afterSequence": after, "limit": limit])
        guard result.id == generation, result.generation == generation,
              ["running", "indexed", "complete", "interrupted"].contains(result.state),
              [result.totalEntries, result.totalSkipped, result.revision, result.nextSequence].allSatisfy(Self.validCount) else {
            throw RustInventoryTransportFailure.invalidResponse
        }
        return result
    }

    func seal(_ scope: Scope, generation: String, root: Root, limits: SyncResourceLimits?) throws {
        var fields = root.fields
        fields["nativeReceiptDirectory"] = Self.receiptPath
        fields["resourceLimits"] = Self.limits(limits)
        fields["cpuBudgetShares"] = limits?.cpuPercent == nil ? 1 : 3
        fields["scanBytesPerSecond"] = SyncScanContext.helperBytesPerSecond
        let result: Status = try run("seal", scope: scope, generation: generation, fields: fields)
        try Self.checkStatus(result, generation: generation)
        guard result.coverage == "sealed" else { throw Failure.changed }
    }

    private static func limits(_ policy: SyncResourceLimits?) -> [String: Any] {
        let threads = min(64, policy?.indexingConcurrency ?? 4)
        return ["maxThreads": threads, "maxParallelism": threads, "maxOpenDirectories": max(16, threads),
                "maxCpuPercent": policy?.cpuPercent ?? 15, "maxMemoryMiB": 512]
    }
    private static func validVersion(_ version: String) -> Bool {
        let parts = version.split(separator: ":", omittingEmptySubsequences: false)
        return parts.count == 7 && parts.allSatisfy { Int64($0) != nil || UInt64($0) != nil }
    }
    static func validate(_ entry: Entry, exclusions: [String], rules: String?) throws {
        try validate(entry, exclusions: exclusions, compiledRules: MobileFolderIgnoreRules(rules))
    }

    static func validate(_ entry: Entry, exclusions: [String], compiledRules: MobileFolderIgnoreRules) throws {
        _ = try MobileFolderReader.components(entry.path)
        let key = entry.path.precomposedStringWithCanonicalMapping.lowercased()
        guard Self.validVersion(entry.version), entry.version.hasPrefix(entry.id + ":"),
              entry.id.split(separator: ":").count == 2, entry.size >= 0, entry.size <= 9_007_199_254_740_991,
              !exclusions.contains(where: { key == $0 || key.hasPrefix($0 + "/") }),
              !compiledRules.ignores(entry.path, isDirectory: entry.kind == "folder") else {
            throw RustInventoryTransportFailure.invalidResponse
        }
        if entry.kind == "folder" {
            guard entry.size == 0, entry.sha256 == nil, entry.fingerprint == nil, entry.symbolicLink == nil else { throw RustInventoryTransportFailure.invalidResponse }
            return
        }
        guard entry.kind == "file" else { throw RustInventoryTransportFailure.invalidResponse }
        if let link = entry.symbolicLink {
            let bytes = try link.target()
            guard entry.size == bytes.count, entry.sha256 == nil, entry.fingerprint == NativeSymbolicLinks.fingerprint(bytes) else {
                throw RustInventoryTransportFailure.invalidResponse
            }
        } else if entry.size == 0 {
            guard entry.sha256 == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
                  entry.fingerprint == nil else { throw RustInventoryTransportFailure.invalidResponse }
        } else {
            let mib: Int64 = 1_048_576
            let partSize = ((max(8 * mib, (entry.size + 9_999) / 10_000) + mib - 1) / mib) * mib
            guard entry.sha256 == nil, let fp = entry.fingerprint, fp.algorithm == "sha256-parts-v1",
                  fp.partSizeBytes == partSize, fp.partCount == Int((entry.size + partSize - 1) / partSize),
                  fp.sha256.utf8.count == 64, fp.sha256.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
                  Int64(entry.version.split(separator: ":")[2]) == entry.size else { throw RustInventoryTransportFailure.invalidResponse }
        }
    }

    func scan(_ scope: Scope, generation: String, mode: String, root: Root, exclusions: [String], rules: String?,
              limits: SyncResourceLimits?, resourceUsage: @escaping @Sendable (CommanderResourceUsage) -> Void,
              sourceCpuMeter: SyncSourceCpuMeter?, ignored: @escaping @Sendable (Int) -> Void,
              progress: @escaping @Sendable (Int, Int) -> Void, streaming: Bool = false,
              control: MobileFolderInventory.StreamControl? = nil, wake: @escaping @Sendable () throws -> Void = {}) throws {
        try limits?.validate()
        let state = ScanState()
        var fields = root.fields
        fields["excludedPaths"] = exclusions; fields["ignoreRules"] = rules
        fields["resourceLimits"] = Self.limits(limits); fields["resourceFeedback"] = limits != nil
        fields["cpuBudgetShares"] = limits?.cpuPercent == nil ? 1 : 3
        fields["scanBytesPerSecond"] = SyncScanContext.helperBytesPerSecond
        fields["nativeReceiptDirectory"] = Self.receiptPath
        if streaming { fields["streaming"] = true } else { fields["mode"] = mode }
        var wire = try request("scan", scope: scope, generation: generation, fields: fields)
        if streaming {
            // The legacy duplex command receives the same scope/settings but
            // selects its operation from the native executable arguments.
            var body = fields
            body["version"] = 1; body["generation"] = generation
            body["scope"] = ["origin": scope.owner.origin.absoluteString, "accountId": scope.owner.ownerId,
                             "deviceId": scope.deviceId, "rootId": scope.rootId]
            wire = try Self.data(body)
        }
        let ignoreRules = try MobileFolderIgnoreRules(rules)
        let consume: @Sendable (Data) throws -> Void = { data in
            func apply() throws {
                try Task.checkCancellation()
                guard !state.complete else { throw RustInventoryTransportFailure.invalidResponse }
                let value = try JSONDecoder().decode(Event.self, from: data)
                if !state.hello {
                    guard value.event == "hello", value.version == 1, value.generation == generation,
                          (value.streaming == true) == streaming else { throw RustInventoryTransportFailure.invalidResponse }
                    state.hello = true; return
                }
                switch value.event {
                case "entry":
                    guard let entry = value.entry else { throw RustInventoryTransportFailure.invalidResponse }
                    try Self.validate(entry, exclusions: exclusions, compiledRules: ignoreRules)
                    state.entries += 1; state.helperSequence += 1; state.stop = false; progress(state.entries, state.skipped)
                    if streaming { try wake() }
                case "skipped":
                    guard let gap = value.gap else { throw RustInventoryTransportFailure.invalidResponse }
                    let checked = try gap.checked()
                    if mode == "strict" { state.strictFailure = Self.strictFailure(checked) }
                    state.skipped += 1; state.helperSequence += 1; state.stop = false; progress(state.entries, state.skipped)
                    if streaming { try wake() }
                case "ignored":
                    state.ignored += 1; ignored(state.ignored)
                case "resources":
                    guard let usage = value.usage else { throw RustInventoryTransportFailure.invalidResponse }
                    resourceUsage(usage)
                case "indexed":
                    guard streaming else { throw RustInventoryTransportFailure.invalidResponse }
                    state.indexed = true; try wake()
                case "complete":
                    guard value.generation == generation, value.coverage == (mode == "strict" ? "prepared" : "provisional") else {
                        throw RustInventoryTransportFailure.invalidResponse
                    }
                    state.complete = true
                default: throw RustInventoryTransportFailure.invalidResponse
                }
            }
            if let sourceCpuMeter {
                try sourceCpuMeter.measure(apply, admit: false)
                try sourceCpuMeter.checkpoint()
            } else { try apply() }
        }
        do {
            if streaming {
                guard let duplex = transport as? any RustStreamingInventoryTransport else { throw RustInventoryTransportFailure.unavailable }
                try duplex.runStreaming(request: wire, isCancelled: { Task.isCancelled }, nextInput: {
                    guard state.indexed, !state.stop, !state.complete else { return nil }
                    let acknowledged: Int
                    if let control {
                        guard let revision = control.take() else { return nil }
                        acknowledged = revision
                    } else {
                        acknowledged = try requireStatus(scope, generation: generation).revision
                    }
                    do {
                        let ack: Status = try run("ack", scope: scope, generation: generation, fields: ["afterSequence": acknowledged])
                        try Self.checkStatus(ack, generation: generation)
                        guard ack.revision == acknowledged, ack.state == "indexed" else { throw Failure.changed }
                    } catch Failure.changed { try wake(); return nil }
                    state.stop = true
                    return try Self.data(["event": "stop", "afterSequence": state.helperSequence])
                }, onLine: consume)
            } else {
                try transport.run(request: wire, isCancelled: { Task.isCancelled }, onLine: consume)
            }
        } catch {
            if let failure = state.strictFailure { throw failure }
            throw Self.project(error)
        }
        guard state.hello, state.complete else { throw RustInventoryTransportFailure.invalidResponse }
    }

    struct Children: Decodable {
        let names: [String]
        let nextOffset: Int?
        let directoryVersion: String
        let stagingNames: [String]?
    }
    func children(root: Root, path: String, offset: Int, hidden: Bool, directoryVersion: String, limit: Int) throws -> Children {
        guard Self.validCount(offset), Self.validVersion(directoryVersion), (1...512).contains(limit) else { throw Failure.invalid }
        var fields = root.fields
        fields["parent"] = path; fields["offset"] = offset; fields["hidden"] = hidden; fields["limit"] = limit
        fields["directoryVersion"] = directoryVersion
        let result: Children = try run("listChildren", fields: fields)
        let staging = result.stagingNames ?? []
        func valid(_ name: String) -> Bool { !name.isEmpty && name != "." && name != ".." && !name.contains("/") }
        guard result.names.count <= limit, result.directoryVersion == directoryVersion,
              result.nextOffset == nil || (result.names.count == limit && result.nextOffset == offset + result.names.count),
              result.names.allSatisfy({ valid($0) && !$0.hasPrefix(".thingtime-upload-") && (hidden || !$0.hasPrefix(".")) }),
              staging.count <= 128, staging.allSatisfy({ valid($0) && $0.hasPrefix(".thingtime-upload-") }),
              zip(result.names, result.names.dropFirst()).allSatisfy({ $0.0.utf8.lexicographicallyPrecedes($0.1.utf8) }) else {
            throw RustInventoryTransportFailure.invalidResponse
        }
        return result
    }
}

/// A private Rust child query for host adapters with an already pinned root.
/// The supplied descriptor remains open and the caller revalidates the target.
public struct RustDirectoryListing: Sendable {
    public struct Page: Sendable {
        public let names: [String], nextOffset: Int?, directoryVersion: String, stagingNames: [String]
    }
    private let client: RustInventoryClient
    public init(transport: any RustInventoryTransport) { client = RustInventoryClient(transport: transport) }
    public func page(rootFD: Int32, path: String, offset: Int, hidden: Bool, directoryVersion: String, limit: Int = 25) throws -> Page {
        let root = try RustInventoryClient.Root(fd: rootFD)
        let result = try client.children(root: root, path: path, offset: offset, hidden: hidden, directoryVersion: directoryVersion, limit: limit)
        try root.revalidate(fd: rootFD)
        return Page(names: result.names, nextOffset: result.nextOffset, directoryVersion: result.directoryVersion, stagingNames: result.stagingNames ?? [])
    }
}
