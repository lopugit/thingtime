import Foundation

/// Durable metadata only. No byte receipts, provider grants or PhotoKit local
/// identifiers cross this boundary. A page is removed only after exact receipt.
public struct PhotoSourceIndexPage: Codable, Equatable, Sendable {
    public struct Entry: Codable, Equatable, Sendable {
        public let path: String
        public let name: String
        public let resourceVersion: String
        public let sourceVersion: String?
        public let assetKey: String
        public let resourceIndex: Int
        public let capturedAt: String?
        public let modifiedAt: String?
        public let assetKind: String?
        public let originalCount: Int
        public let availability: String
        public let reason: String?
        // Explicit nulls make the wire contract independent of optional-key
        // elision in synthesized Codable.
        enum CodingKeys: String, CodingKey { case path, name, resourceVersion, sourceVersion, assetKey, resourceIndex, capturedAt, modifiedAt, assetKind, originalCount, availability, reason }
        public func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(name, forKey: .name); try c.encode(path, forKey: .path); try c.encode(resourceVersion, forKey: .resourceVersion); try c.encode(sourceVersion, forKey: .sourceVersion)
            try c.encode(assetKey, forKey: .assetKey); try c.encode(resourceIndex, forKey: .resourceIndex)
            try c.encode(capturedAt, forKey: .capturedAt); try c.encode(modifiedAt, forKey: .modifiedAt)
            try c.encode(assetKind, forKey: .assetKind); try c.encode(originalCount, forKey: .originalCount)
            try c.encode(availability, forKey: .availability); try c.encode(reason, forKey: .reason)
        }
    }
    public struct Progress: Codable, Equatable, Sendable {
        public let inspectedAssets: Int
        public let totalAssets: Int
        public let indexedResources: Int
        public let complete: Bool
    }
    public let epoch: String
    public let passId: String
    public let sequence: Int
    public let requestId: String
    public let entries: [Entry]
    public let progress: Progress
}

final class PhotoSourceIndexOutbox {
    private let directory: URL
    private let epoch: UUID
    private let encoder: JSONEncoder = { let e = JSONEncoder(); e.outputFormatting = [.sortedKeys]; return e }()
    private struct State: Codable { var sequence = 0; var head = 1; var progress: PhotoSourceIndexPage.Progress?; var passId: String? }
    private struct Observation: Codable { let stamp: String; let passId: String; let entry: PhotoSourceIndexPage.Entry }
    private var cachedState: State?
    init(directory: URL, epoch: UUID) { self.directory = directory; self.epoch = epoch }
    private var stateURL: URL { directory.appendingPathComponent("state.json") }
    private var pages: URL { directory.appendingPathComponent("pages", isDirectory: true) }
    private var observations: URL { directory.appendingPathComponent("observations", isDirectory: true) }
    private func read<T: Decodable>(_ type: T.Type, _ url: URL) throws -> T? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        return try JSONDecoder().decode(type, from: Data(contentsOf: url))
    }
    private func write<T: Encodable>(_ value: T, _ url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try encoder.encode(value).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    private func pageURL(_ sequence: Int) -> URL { pages.appendingPathComponent(String(format: "%020d.json", sequence)) }
    private func loadState() throws -> State {
        if let cachedState { return cachedState }
        var state = try read(State.self, stateURL) ?? State()
        // Only one allocated page can precede its counter after interruption.
        if let pending = try read(PhotoSourceIndexPage.self, pageURL(state.sequence + 1)) { state.sequence = pending.sequence }
        while state.head <= state.sequence, !FileManager.default.fileExists(atPath: pageURL(state.head).path) { state.head += 1 }
        cachedState = state
        return state
    }
    private func saveState(_ state: State) throws { try write(state, stateURL); cachedState = state }
    func pendingCount() throws -> Int { let state = try loadState(); return max(0, state.sequence - state.head + 1) }
    func append(_ resources: [PhotoResource], passId: String, progress: PhotoSourceIndexPage.Progress,
                unavailable: Set<String> = [], reasons: [String: String] = [:], sourceVersions: [String: String] = [:], legacyUnverified: Set<String> = []) throws {
        var state = try loadState()
        let format = ISO8601DateFormatter(); format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var changed: [PhotoSourceIndexPage.Entry] = []
        for resource in resources {
            let url = observations.appendingPathComponent(PhotoLibraryReader.hash(Data(resource.path.utf8)) + ".json")
            let prior = try read(Observation.self, url)
            let preparedVersion = sourceVersions[resource.path] ?? (prior?.entry.resourceVersion == resource.revision ? prior?.entry.sourceVersion : nil)
            let entry = PhotoSourceIndexPage.Entry(path: resource.path, name: resource.name, resourceVersion: resource.revision, sourceVersion: preparedVersion,
                assetKey: PhotoLibraryReader.hash(Data(resource.asset.utf8)), resourceIndex: resource.index,
                capturedAt: resource.capturedAt.map(format.string), modifiedAt: resource.modifiedAt.map(format.string),
                assetKind: resource.assetKind, originalCount: resource.originalCount,
                availability: unavailable.contains(resource.path) ? "unavailable" : (legacyUnverified.contains(resource.path) && preparedVersion == nil ? "legacy-unverified" : "pending"),
                reason: unavailable.contains(resource.path) ? reasons[resource.path] ?? "cloud-download" : nil)
            let stamp = PhotoLibraryReader.hash(try encoder.encode(entry) + Data(passId.utf8))
            if prior?.stamp != stamp { changed.append(entry) }
        }
        guard !changed.isEmpty || state.progress != progress || state.passId != passId else { return }
        let chunks = changed.isEmpty ? [[]] : stride(from: 0, to: changed.count, by: 32).map { Array(changed[$0..<min(changed.count, $0 + 32)]) }
        for (offset, entries) in chunks.enumerated() {
            guard state.sequence < Int.max else { throw PhotoLibraryReader.Failure.changed }
            let p = PhotoSourceIndexPage.Progress(inspectedAssets: progress.inspectedAssets, totalAssets: progress.totalAssets,
                indexedResources: progress.indexedResources, complete: progress.complete && offset == chunks.count - 1)
            let page = PhotoSourceIndexPage(epoch: epoch.uuidString.lowercased(), passId: passId, sequence: state.sequence + 1,
                requestId: UUID().uuidString.lowercased(), entries: entries, progress: p)
            try write(page, pageURL(page.sequence))
            state.sequence = page.sequence; state.progress = p; state.passId = passId
            // The immutable page already exists even if its counter write
            // fails. Preserve its allocation for same-process recovery too.
            cachedState = state
            try saveState(state)
            for entry in entries {
                let stamp = PhotoLibraryReader.hash(try encoder.encode(entry) + Data(passId.utf8))
                try write(Observation(stamp: stamp, passId: passId, entry: entry), observations.appendingPathComponent(PhotoLibraryReader.hash(Data(entry.path.utf8)) + ".json"))
            }
        }
    }
    /// One actual backup pass may check an acknowledged index without
    /// rediscovering its source prefix. The immutable empty page uses the
    /// existing progress contract; it reports no new resources or work units.
    func checkpointAcknowledgedIndex() throws {
        var state = try loadState()
        guard state.head > state.sequence, let progress = state.progress, let passId = state.passId else { return }
        guard state.sequence < Int.max else { throw PhotoLibraryReader.Failure.changed }
        let page = PhotoSourceIndexPage(epoch: epoch.uuidString.lowercased(), passId: passId, sequence: state.sequence + 1,
            requestId: UUID().uuidString.lowercased(), entries: [], progress: progress)
        try write(page, pageURL(page.sequence))
        state.sequence = page.sequence
        // Preserve the already allocated request through uncertain counter
        // persistence, exactly like a resource page.
        cachedState = state
        try saveState(state)
    }
    func first() throws -> PhotoSourceIndexPage? {
        let state = try loadState()
        guard state.head <= state.sequence else { return nil }
        guard let page = try read(PhotoSourceIndexPage.self, pageURL(state.head)) else { throw PhotoLibraryReader.Failure.changed }
        return page
    }
    func acknowledge(_ page: PhotoSourceIndexPage) throws {
        guard let first = try first(), first == page else { throw PhotoLibraryReader.Failure.changed }
        var state = try loadState(); state.head += 1
        // Durable head advances before cleanup. A killed cleanup cannot make
        // an acknowledged page eligible for delivery or sequence reuse.
        try saveState(state)
        try? FileManager.default.removeItem(at: pageURL(page.sequence))
    }
}
