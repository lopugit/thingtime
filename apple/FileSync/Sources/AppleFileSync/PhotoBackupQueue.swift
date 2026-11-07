import Foundation

/// Date order applies to assets, not storage paths or original versions. The
/// bridge exposes only these opaque asset keys and bounded progress counts.
public struct PhotoBackupQueueBatch: Codable, Equatable, Sendable {
    public let epoch: UUID
    public let id: UUID
    public let assetKeys: [String]
    public let pending: Int
    public let unavailable: Int
}

public struct PhotoBackupQueueRequest: Codable, Equatable, Sendable {
    public let epoch: UUID
    public let configurationId: String
    public let configurationRevision: String
    public init(epoch: UUID, configurationId: String, configurationRevision: String) {
        self.epoch = epoch; self.configurationId = configurationId; self.configurationRevision = configurationRevision
    }
}

/// One active bounded selection and one small outcome record per asset. A
/// completed attachment alone does not advance the selection: the consumer
/// acknowledges only after its verified folder and Timeline checkpoint.
final class PhotoBackupQueue {
    static let batchSize = 4
    struct Asset {
        let key: String
        let version: String
        let resources: [PhotoResource]
        init(_ resources: [PhotoResource]) {
            self.resources = resources
            key = PhotoLibraryReader.hash(Data(resources[0].asset.utf8))
            version = PhotoLibraryReader.hash(Data(resources.map { $0.path + ":" + $0.revision }.joined(separator: "\n").utf8))
        }
    }
    struct Stamp: Codable, Equatable {
        let key: String
        let version: String
        init(_ asset: Asset) { key = asset.key; version = asset.version }
    }
    struct Attempt: Codable {
        let stamp: Stamp
        let unavailable: [String]
    }
    struct Selection: Codable {
        let id: UUID
        let stamps: [Stamp]
        let pending: Int
        let priorUnavailable: Int
        var attempts: [Attempt]?
        var entries: [MobileFolderReader.Entry]?
    }
    struct Work {
        let assets: [Asset]
        let selection: Selection
        let descriptor: PhotoBackupQueueBatch
    }
    private let directory: URL
    let request: PhotoBackupQueueRequest
    private var outcomes: [String: Attempt]?
    private var membership: (revision: String, ordered: [Asset], byKey: [String: Asset], position: Int, pending: Int, unavailable: Int)?
    private var completed: UUID?

    init(directory: URL, request: PhotoBackupQueueRequest) {
        self.directory = directory; self.request = request
    }
    private var selectedFile: URL { directory.appendingPathComponent("current.json") }
    private var completedFile: URL { directory.appendingPathComponent("completed.json") }
    private static let terminalName = "terminal.json"
    private var terminalFile: URL { directory.appendingPathComponent(Self.terminalName) }
    private struct Terminal: Codable { let batch: UUID; let finishedAt: Date }

    /// A newly admitted epoch retires only superseded, explicitly exhausted
    /// siblings. Keep the current and newest finished epoch for a lost reply.
    /// Interrupted and paused epochs are never removed here.
    static func pruneFinishedEpochs(in scopeDirectory: URL, protecting epoch: UUID) {
        let fm = FileManager.default
        guard let siblings = try? fm.contentsOfDirectory(at: scopeDirectory, includingPropertiesForKeys: [.isDirectoryKey], options: [.skipsHiddenFiles]) else { return }
        let finished = siblings.compactMap { url -> (URL, Date)? in
            guard let id = UUID(uuidString: url.lastPathComponent), id != epoch,
                  (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true,
                  !fm.fileExists(atPath: url.appendingPathComponent("current.json").path),
                  let data = try? Data(contentsOf: url.appendingPathComponent(terminalName)),
                  let terminal = try? JSONDecoder().decode(Terminal.self, from: data) else { return nil }
            return (url, terminal.finishedAt)
        }.sorted { $0.1 > $1.1 }
        for (directory, _) in finished.dropFirst().prefix(2) {
            try? fm.removeItem(at: directory)
        }
    }
    private var attemptsDirectory: URL { directory.appendingPathComponent("attempts", isDirectory: true) }
    private func record(_ key: String) -> URL { attemptsDirectory.appendingPathComponent(key + ".json") }
    private func read<T: Decodable>(_ type: T.Type, at url: URL) throws -> T? {
        do { return try JSONDecoder().decode(type, from: Data(contentsOf: url)) }
        catch let error as NSError where error.domain == NSCocoaErrorDomain && [NSFileReadNoSuchFileError, NSFileNoSuchFileError].contains(error.code) { return nil }
    }
    private func write<T: Encodable>(_ value: T, at url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        #if os(iOS)
        try JSONEncoder().encode(value).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try JSONEncoder().encode(value).write(to: url, options: .atomic)
        #endif
    }
    private func loadOutcomes() throws {
        guard outcomes == nil else { return }
        let files: [URL]
        do { files = try FileManager.default.contentsOfDirectory(at: attemptsDirectory, includingPropertiesForKeys: nil) }
        catch let error as NSError where error.domain == NSCocoaErrorDomain && [NSFileReadNoSuchFileError, NSFileNoSuchFileError].contains(error.code) {
            outcomes = [:]; return
        }
        var result: [String: Attempt] = [:]
        for file in files {
            try Task.checkCancellation()
            guard let attempt = try read(Attempt.self, at: file), record(attempt.stamp.key) == file else { throw PhotoLibraryReader.Failure.changed }
            result[attempt.stamp.key] = attempt
        }
        outcomes = result
    }
    private func descriptor(_ selection: Selection) -> PhotoBackupQueueBatch {
        .init(epoch: request.epoch, id: selection.id, assetKeys: selection.stamps.map(\.key), pending: selection.pending,
              unavailable: selection.priorUnavailable + (selection.attempts?.reduce(0) { $0 + $1.unavailable.count } ?? 0))
    }

    func select(revision: String, resources: [PhotoResource], replaceStale: Bool = false) throws -> Work {
        try loadOutcomes()
        if membership?.revision != revision {
            var pending = 0, unavailable = 0
            let all = PhotoBackupAssetOrder.groups(resources).map(Asset.init)
            let ordered = all.filter { asset in
                if let attempted = outcomes?[asset.key], attempted.stamp == Stamp(asset) {
                    unavailable += attempted.unavailable.count; return false
                }
                pending += asset.resources.count; return true
            }
            membership = (revision, ordered, Dictionary(uniqueKeysWithValues: all.map { ($0.key, $0) }), 0, pending, unavailable)
        }
        guard let membership else { throw PhotoLibraryReader.Failure.changed }
        let selection: Selection
        let assets: [Asset]
        if let retained = try read(Selection.self, at: selectedFile) {
            assets = retained.stamps.compactMap { membership.byKey[$0.key] }
            guard assets.map(Stamp.init) == retained.stamps else {
                guard replaceStale else { throw PhotoLibraryReader.Failure.changed }
                // This was an unacknowledged selection. Never advance its
                // cursor or erase any independently acknowledged asset.
                try FileManager.default.removeItem(at: selectedFile)
                return try select(revision: revision, resources: resources)
            }
            selection = retained
        } else {
            assets = Array(membership.ordered.dropFirst(membership.position).prefix(Self.batchSize))
            let pending = membership.pending - assets.reduce(0) { $0 + $1.resources.count }
            selection = .init(id: UUID(), stamps: assets.map(Stamp.init), pending: pending, priorUnavailable: membership.unavailable)
            try write(selection, at: selectedFile)
        }
        return Work(assets: assets, selection: selection, descriptor: descriptor(selection))
    }

    func prepare(_ work: Work, unavailable: Set<String>, entries: [MobileFolderReader.Entry]) throws -> PhotoBackupQueueBatch {
        guard var selected = try read(Selection.self, at: selectedFile), selected.id == work.selection.id,
              selected.stamps == work.assets.map(Stamp.init) else { throw PhotoLibraryReader.Failure.changed }
        let attempts = work.assets.map { asset in
            Attempt(stamp: Stamp(asset), unavailable: asset.resources.map(\.path).filter(unavailable.contains))
        }
        let available = work.assets.flatMap(\.resources).map(\.path).filter { !unavailable.contains($0) }
        guard entries.map(\.path) == available, entries.allSatisfy({ $0.kind == "file" && ($0.fingerprint != nil || $0.sha256 != nil) }) else {
            throw PhotoLibraryReader.Failure.changed
        }
        if let existing = selected.attempts {
            guard existing.map(\.unavailable) == attempts.map(\.unavailable), selected.entries == entries else { throw PhotoLibraryReader.Failure.changed }
        } else {
            selected.attempts = attempts; selected.entries = entries
            try write(selected, at: selectedFile)
        }
        return descriptor(selected)
    }

    func entriesForVerification(_ batch: UUID) throws -> [MobileFolderReader.Entry] {
        if try read(UUID.self, at: completedFile) == batch { return [] }
        guard let selected = try read(Selection.self, at: selectedFile), selected.id == batch, selected.attempts != nil,
              let entries = selected.entries else { throw PhotoLibraryReader.Failure.changed }
        return entries
    }

    func finish(_ batch: UUID) throws {
        if completed == batch { return }
        if try read(UUID.self, at: completedFile) == batch {
            if try read(Selection.self, at: selectedFile)?.id == batch {
                try FileManager.default.removeItem(at: selectedFile)
                membership = nil
            }
            completed = batch
            return
        }
        guard let selection = try read(Selection.self, at: selectedFile), selection.id == batch, let attempts = selection.attempts else {
            throw PhotoLibraryReader.Failure.changed
        }
        for attempt in attempts {
            try write(attempt, at: record(attempt.stamp.key))
            outcomes?[attempt.stamp.key] = attempt
        }
        // Removing the current selection can be retried after a failed write.
        // Persist the acknowledgement first so a lost reply is idempotent.
        if selection.stamps.isEmpty && selection.pending == 0 {
            try write(Terminal(batch: batch, finishedAt: Date()), at: terminalFile)
        }
        try write(batch, at: completedFile)
        try FileManager.default.removeItem(at: selectedFile)
        completed = batch
        if let cursor = membership, cursor.ordered.dropFirst(cursor.position).prefix(selection.stamps.count).map(Stamp.init) == selection.stamps {
            membership?.position += selection.stamps.count
            membership?.pending = cursor.pending - cursor.ordered.dropFirst(cursor.position).prefix(selection.stamps.count).reduce(0) { $0 + $1.resources.count }
            membership?.unavailable = cursor.unavailable + attempts.reduce(0) { $0 + $1.unavailable.count }
        } else {
            membership = nil
        }
    }
}
