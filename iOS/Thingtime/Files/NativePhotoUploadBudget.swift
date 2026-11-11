import AppleFileSync
import Foundation

/// Device-local rolling payload allowance. Reserve before a signed PUT; reconcile
/// with URLSession's observed bytes after it ends. After a crash, keep the full
/// uncertain reservation in the window rather than treating those bytes as free.
@MainActor
final class NativePhotoUploadBudget {
    struct Wait: Error { let retryAt: Date?; var minimumPartBytes: Int64? = nil }
    struct Lease { fileprivate let url: URL; fileprivate let id: UUID; fileprivate let bytes: Int64 }
    private struct Bucket: Codable { let until: Date; var bytes: Int64 }
    private struct Pending: Codable { let id: UUID; let bytes: Int64; let until: Date }
    private struct State: Codable { var buckets: [Bucket] = []; var pending: Pending? }
    private let directory: URL
    private var leases = Set<UUID>()
    private static let window: TimeInterval = 3600

    init(directory: URL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]) {
        self.directory = directory.appendingPathComponent("NativePhotoUploadBudget-v1", isDirectory: true)
    }

    func reserve(scope: FileSyncOwnerScope, deviceId: String, bytes: Int64, cap: Int64?,
                 duration: TimeInterval = 900, now: Date = Date()) throws -> Lease {
        // Settings edits, configuration copies and grant renewal cannot reset
        // this account/device's allowance on its selected origin.
        let key = PhotoLibraryReader.hash(Data([scope.origin.absoluteString, scope.ownerId, deviceId].joined(separator: "\n").utf8))
        let url = directory.appendingPathComponent(key + ".json")
        var state = try load(url)
        state.buckets.removeAll { $0.until <= now }
        if let pending = state.pending {
            guard !leases.contains(pending.id) else { throw Wait(retryAt: nil) }
            if pending.until > now { try accumulate(pending.bytes, until: pending.until, in: &state) }
            state.pending = nil
        }
        guard bytes > 0 else { throw MobileFolderStore.Failure.invalid }
        if let cap {
            // Non-final provider parts have an indivisible canonical length.
            // An insufficient cap stays a policy wait; never send over it.
            guard bytes <= cap else { throw Wait(retryAt: nil, minimumPartBytes: bytes) }
            var used = try total(state.buckets)
            if used > cap - bytes {
                for bucket in state.buckets.sorted(by: { $0.until < $1.until }) {
                    used -= bucket.bytes
                    if used <= cap - bytes { throw Wait(retryAt: bucket.until) }
                }
                throw Wait(retryAt: nil)
            }
        }
        let id = UUID()
        // The lease bounds both what may be emitted and how long an uncertain
        // transfer could emit. A relaunch keeps that reservation until all such
        // bytes must be out of the rolling window.
        state.pending = .init(id: id, bytes: bytes, until: bucketEnd(now.addingTimeInterval(duration + 60)))
        try save(state, at: url)
        leases.insert(id)
        return Lease(url: url, id: id, bytes: bytes)
    }

    func finish(_ lease: Lease, observedBytes: Int64, now: Date = Date()) throws {
        defer { leases.remove(lease.id) }
        var state = try load(lease.url)
        guard state.pending?.id == lease.id else { throw MobileFolderStore.Failure.changed }
        // A failed/partial request is still usage. Use the end of the request
        // and round expiry up to the minute, so no bytes age out too early.
        guard observedBytes >= 0 else { throw MobileFolderStore.Failure.invalid }
        state.buckets.removeAll { $0.until <= now }
        if observedBytes > 0 { try accumulate(observedBytes, until: bucketEnd(now), in: &state) }
        state.pending = nil
        try save(state, at: lease.url)
    }

    private func bucketEnd(_ now: Date) -> Date {
        Date(timeIntervalSince1970: (now.timeIntervalSince1970 / 60).rounded(.up) * 60 + Self.window)
    }
    private func total(_ buckets: [Bucket]) throws -> Int64 {
        try buckets.reduce(0) { sum, bucket in
            let (value, overflow) = sum.addingReportingOverflow(bucket.bytes)
            guard !overflow else { throw MobileFolderStore.Failure.invalid }; return value
        }
    }
    private func accumulate(_ bytes: Int64, until: Date, in state: inout State) throws {
        if let index = state.buckets.firstIndex(where: { $0.until == until }) {
            let (value, overflow) = state.buckets[index].bytes.addingReportingOverflow(bytes)
            guard !overflow else { throw MobileFolderStore.Failure.invalid }
            state.buckets[index].bytes = value
        } else { state.buckets.append(.init(until: until, bytes: bytes)) }
    }
    private func load(_ url: URL) throws -> State {
        do {
            let data = try Data(contentsOf: url)
            guard data.count <= 65_536 else { throw MobileFolderStore.Failure.invalid }
            let state = try JSONDecoder().decode(State.self, from: data)
            guard state.buckets.allSatisfy({ $0.bytes > 0 }), state.pending.map({ $0.bytes > 0 }) ?? true else {
                throw MobileFolderStore.Failure.invalid
            }
            return state
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile { return .init() }
    }
    private func save(_ state: State, at url: URL) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(state).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        var folder = directory, values = URLResourceValues()
        values.isExcludedFromBackup = true; try folder.setResourceValues(values)
    }
}
