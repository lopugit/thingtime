import Foundation

/// Date order applies to assets, not storage paths or original versions. The
/// bridge exposes only these opaque asset keys and bounded progress counts.
public struct PhotoBackupQueueBatch: Codable, Equatable, Sendable {
    public let epoch: UUID
    public let id: UUID
    public let assetKeys: [String]
    public let pending: Int
    public let unavailable: Int
    public var remainingKnown: Bool?
    public var unavailableReasons: [String: Int]?
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
    static let batchSize = 10
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
    struct Stamp: Codable, Equatable, Sendable {
        let key: String
        let version: String
        init(_ asset: Asset) { key = asset.key; version = asset.version }
    }
    struct Attempt: Codable {
        let stamp: Stamp
        let unavailable: [String]
        var reasonByPath: [String: String]?
    }
    private struct Deferred: Codable {
        let stamp: Stamp
        let asset: String
        let capturedAt: Date?
        let modifiedAt: Date?
        let unavailable: [String]
        let observed: OrderedPhotoCheckpoint
        var retryByPath: [String: Date]
        var reasonByPath: [String: String]?
    }
    private struct DeferredCandidate {
        let entry: Deferred
        let path: String
        let retryAt: Date

        init?(_ entry: Deferred) {
            guard let path = entry.unavailable.min(by: { (entry.retryByPath[$0] ?? .distantPast) < (entry.retryByPath[$1] ?? .distantPast) }) else { return nil }
            self.entry = entry; self.path = path; retryAt = entry.retryByPath[path] ?? .distantPast
        }

        func precedes(_ other: Self) -> Bool {
            retryAt < other.retryAt || retryAt == other.retryAt &&
                PhotoBackupAssetOrder.precedes((entry.capturedAt, entry.modifiedAt, entry.asset),
                                              (other.entry.capturedAt, other.entry.modifiedAt, other.entry.asset))
        }
    }
    struct Selection: Codable {
        let id: UUID
        let stamps: [Stamp]
        let pending: Int
        let priorUnavailable: Int
        var attempts: [Attempt]?
        var entries: [MobileFolderReader.Entry]?
        var sourceAssets: [String]?
        var orderedCursor: OrderedPhotoCheckpoint?
        var remainingKnown: Bool?
        var priorReadFailures: Int?
    }
    struct Work {
        let assets: [Asset]
        let selection: Selection
        let descriptor: PhotoBackupQueueBatch
    }
    private let directory: URL
    let request: PhotoBackupQueueRequest
    private var outcomes: [String: Attempt]?
    private var membership: (revision: String, ordered: [Asset], byKey: [String: Asset], position: Int, pending: Int, unavailable: Int, readFailures: Int)?
    private var completed: UUID?
    private final class OrderedSelection {
        let inventory: any OrderedPhotoInventory
        var limit: Int
        var candidates: [Asset] = []
        var unavailable: Int
        var readFailures: Int

        init(_ inventory: any OrderedPhotoInventory, first: Bool) {
            self.inventory = inventory
            limit = first ? 1 : PhotoBackupQueue.batchSize
            unavailable = inventory.checkpoint.unavailable
            readFailures = inventory.checkpoint.unavailableReadFailures ?? 0
        }

        var checkpoint: OrderedPhotoCheckpoint {
            var cursor = inventory.checkpoint
            cursor.unavailable = unavailable
            cursor.unavailableReadFailures = readFailures
            return cursor
        }
    }
    private var orderedSelection: OrderedSelection?
    private var deferredSearchAfter: Date?
    private var deferredCandidates: [DeferredCandidate] = []

    init(directory: URL, request: PhotoBackupQueueRequest) {
        self.directory = directory; self.request = request
    }
    private var selectedFile: URL { directory.appendingPathComponent("current.json") }
    private var deferredDirectory: URL { directory.appendingPathComponent("deferred-originals", isDirectory: true) }
    private var completedFile: URL { directory.appendingPathComponent("completed.json") }
    private var cursorFile: URL { directory.appendingPathComponent("ordered-cursor.json") }
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
            // Foundation can resolve the app container alias on enumeration.
            // Entries still come from this queue's own attempts directory.
            guard let attempt = try read(Attempt.self, at: file),
                  attempt.stamp.key.utf8.count == 64,
                  attempt.stamp.key.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
                  file.lastPathComponent == attempt.stamp.key + ".json" else {
                throw PhotoLibraryReader.Failure.changed
            }
            result[attempt.stamp.key] = attempt
        }
        outcomes = result
    }
    private func deferredFile(_ key: String) -> URL { deferredDirectory.appendingPathComponent(key + ".json") }

    private func rememberDeferred(_ asset: Asset, outcome: Attempt, at cursor: OrderedPhotoCheckpoint) throws {
        let file = deferredFile(asset.key)
        let hadCandidate = deferredCandidates.contains { $0.entry.stamp.key == asset.key }
        if hadCandidate { deferredCandidates.removeAll { $0.entry.stamp.key == asset.key } }
        if outcome.unavailable.isEmpty {
            if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
            return
        }
        let source = asset.resources[0]
        let prior = try read(Deferred.self, at: file)
        let retries = prior?.stamp == outcome.stamp ? prior?.retryByPath.filter { outcome.unavailable.contains($0.key) } ?? [:] : [:]
        let entry = Deferred(stamp: outcome.stamp, asset: source.asset, capturedAt: source.capturedAt, modifiedAt: source.modifiedAt,
                             unavailable: outcome.unavailable, observed: cursor, retryByPath: retries, reasonByPath: outcome.reasonByPath)
        try write(entry, at: file)
        if let candidate = DeferredCandidate(entry) {
            if let searchAfter = deferredSearchAfter, candidate.retryAt < searchAfter { deferredSearchAfter = candidate.retryAt }
            if hadCandidate || !deferredCandidates.isEmpty { Self.insertDeferredCandidate(candidate, into: &deferredCandidates) }
        }
    }

    private static func insertDeferredCandidate(_ candidate: DeferredCandidate, into items: inout [DeferredCandidate]) {
        // Amortize disk scans while keeping scheduler memory bounded.
        let limit = 32
        let index = items.firstIndex { candidate.precedes($0) } ?? items.endIndex
        guard index < limit else { return }
        items.insert(candidate, at: index)
        if items.count > limit { items.removeLast() }
    }

    private func deferredEntries(onError: @escaping (Error) -> Void) throws -> FileManager.DirectoryEnumerator? {
        let files = FileManager.default
        do { _ = try files.attributesOfItem(atPath: deferredDirectory.path) }
        catch let error as NSError where error.domain == NSCocoaErrorDomain && [NSFileReadNoSuchFileError, NSFileNoSuchFileError].contains(error.code) { return nil }
        guard let rows = files.enumerator(at: deferredDirectory, includingPropertiesForKeys: nil, options: [.skipsSubdirectoryDescendants],
            errorHandler: { _, error in onError(error); return false }) else { throw PhotoLibraryReader.Failure.changed }
        return rows
    }

    func hasDeferredOriginals() throws -> Bool {
        var failure: Error?
        let first = try deferredEntries { failure = $0 }?.nextObject()
        if let failure { throw failure }
        return first != nil
    }

    private func loadDeferredCandidates(now: Date) throws {
        if !deferredCandidates.isEmpty || deferredSearchAfter.map({ now < $0 }) == true { return }
        var failure: Error?
        guard let rows = try deferredEntries(onError: { failure = $0 }) else {
            deferredSearchAfter = .distantFuture
            return
        }
        var candidates: [DeferredCandidate] = []
        var earliestRetry = Date.distantFuture
        for case let file as URL in rows {
            try Task.checkCancellation()
            guard let entry = try read(Deferred.self, at: file), file.lastPathComponent == entry.stamp.key + ".json",
                  PhotoLibraryReader.hash(Data(entry.asset.utf8)) == entry.stamp.key, let candidate = DeferredCandidate(entry) else {
                throw PhotoLibraryReader.Failure.changed
            }
            // Untried originals and older attempts get a turn even when the
            // newest original repeatedly fails. Ties still use asset dates.
            if candidate.retryAt > now { earliestRetry = min(earliestRetry, candidate.retryAt) }
            else { Self.insertDeferredCandidate(candidate, into: &candidates) }
        }
        if let failure { throw failure }
        deferredSearchAfter = candidates.isEmpty ? earliestRetry : nil
        deferredCandidates = candidates
    }

    func nextDeferred(provider: any OrderedPhotoResourceProvider, now: Date) throws -> PhotoResource? {
        try Task.checkCancellation()
        guard try read(Selection.self, at: selectedFile) == nil else { return nil }
        if let first = deferredCandidates.first, first.retryAt > now { deferredCandidates.removeAll() }
        try loadDeferredCandidates(now: now)
        guard let next = deferredCandidates.first, next.retryAt <= now else { return nil }
        deferredCandidates.removeFirst()
        var entry = next.entry
        let location = deferredFile(entry.stamp.key)
        do {
            // A crash can leave this secondary row without its receipt. With
            // no current selection to finish, the ordered queue rediscovers it.
            guard let outcome = try read(Attempt.self, at: record(entry.stamp.key)), outcome.stamp == entry.stamp,
                  outcome.unavailable == entry.unavailable, outcome.reasonByPath == entry.reasonByPath else { throw PhotoLibraryReader.Failure.changed }
            guard let resources = try provider.orderedResources(identifiers: [entry.asset]).first, !resources.isEmpty,
                  Stamp(Asset(resources)) == entry.stamp,
                  let resource = resources.first(where: { $0.path == next.path }) else {
                throw PhotoLibraryReader.Failure.changed
            }
            // A killed process leaves the exact deferred asset pending.
            entry.retryByPath[next.path] = now.addingTimeInterval(300)
            try write(entry, at: location)
            if let candidate = DeferredCandidate(entry), candidate.retryAt <= now {
                Self.insertDeferredCandidate(candidate, into: &deferredCandidates)
            }
            return resource
        } catch PhotoLibraryReader.Failure.changed {
            try FileManager.default.removeItem(at: location)
            return nil
        }
    }

    private func descriptor(_ selection: Selection) -> PhotoBackupQueueBatch {
        let unavailable = selection.priorUnavailable + (selection.attempts?.reduce(0) { $0 + $1.unavailable.count } ?? 0)
        let reads = min(unavailable, (selection.priorReadFailures ?? 0) + (selection.attempts?.reduce(0) { $0 + Self.readFailures($1) } ?? 0))
        return .init(epoch: request.epoch, id: selection.id, assetKeys: selection.stamps.map(\.key), pending: selection.pending,
            unavailable: unavailable, remainingKnown: selection.remainingKnown,
            unavailableReasons: ["cloud-download": unavailable - reads, "photo-read": reads])
    }
    private static func readFailures(_ attempt: Attempt) -> Int {
        attempt.unavailable.filter { attempt.reasonByPath?[$0] == "photo-read" }.count
    }

    func usesOrderedSelection(preferred: Bool) throws -> Bool {
        if let retained = try read(Selection.self, at: selectedFile) { return retained.sourceAssets != nil }
        return preferred
    }

    private func exactOutcome(_ asset: Asset) throws -> Attempt? {
        guard let attempt = try read(Attempt.self, at: record(asset.key)) else { return nil }
        guard attempt.stamp.key == asset.key else { throw PhotoLibraryReader.Failure.changed }
        return attempt.stamp == Stamp(asset) ? attempt : nil
    }

    func selectOrdered(provider: any OrderedPhotoResourceProvider, replaceStale: Bool, preparedDeferred: PhotoResource? = nil,
                       progress: (PhotoLibraryReader.InventoryProgress) -> Void) throws -> Work {
        if let retained = try read(Selection.self, at: selectedFile) {
            guard let identifiers = retained.sourceAssets, let cursor = retained.orderedCursor,
                  identifiers.count == retained.stamps.count else { throw PhotoLibraryReader.Failure.changed }
            do {
                let groups = try provider.orderedResources(identifiers: identifiers)
                let assets = groups.filter { !$0.isEmpty }.map(Asset.init)
                guard assets.map(Stamp.init) == retained.stamps else { throw PhotoLibraryReader.Failure.changed }
                // A terminal selection must still represent the current library.
                // Nonempty selections retain their exact version across edits
                // elsewhere, then the next group starts at the new newest asset.
                if assets.isEmpty {
                    let fresh: any OrderedPhotoInventory
                    if let state = orderedSelection, try state.inventory.isCurrent() { fresh = state.inventory }
                    else { fresh = try provider.orderedInventory(resuming: cursor) }
                    guard fresh.progress.inspected == fresh.progress.total,
                          fresh.progress.inspected == cursor.dated + cursor.undated,
                          try fresh.isCurrent() else {
                        throw PhotoLibraryReader.Failure.changed
                    }
                }
                return Work(assets: assets, selection: retained, descriptor: descriptor(retained))
            } catch PhotoLibraryReader.Failure.changed {
                guard replaceStale else { throw PhotoLibraryReader.Failure.changed }
                try FileManager.default.removeItem(at: selectedFile)
                orderedSelection = nil
            }
        }

        let state: OrderedSelection
        if let current = orderedSelection, try current.inventory.isCurrent() {
            state = current
        } else {
            let cursor = try read(OrderedPhotoCheckpoint.self, at: cursorFile)
            let inventory = try provider.orderedInventory(resuming: cursor)
            state = OrderedSelection(inventory, first: !FileManager.default.fileExists(atPath: attemptsDirectory.path))
            orderedSelection = state
        }

        let initial = state.inventory.progress
        if let preparedDeferred, state.candidates.isEmpty {
            let groups = try provider.orderedResources(identifiers: [preparedDeferred.asset])
            guard let resources = groups.first, resources.contains(preparedDeferred) else { throw PhotoLibraryReader.Failure.changed }
            let asset = Asset(resources)
            guard let deferred = try read(Deferred.self, at: deferredFile(asset.key)), deferred.stamp == Stamp(asset),
                  deferred.unavailable.contains(preparedDeferred.path) else { throw PhotoLibraryReader.Failure.changed }
            let cursor = state.checkpoint, observed = deferred.observed
            let included = observed.passID != nil && cursor.passID == observed.passID && cursor.dated >= observed.dated && cursor.undated >= observed.undated
            let previouslyCounted = included ? deferred.unavailable.count : 0
            let selection = Selection(id: UUID(), stamps: [Stamp(asset)], pending: 0,
                priorUnavailable: max(0, state.unavailable - previouslyCounted),
                sourceAssets: [preparedDeferred.asset], orderedCursor: cursor, remainingKnown: initial.inspected == initial.total,
                priorReadFailures: max(0, state.readFailures - (included ? deferred.unavailable.filter { deferred.reasonByPath?[$0] == "photo-read" }.count : 0)))
            try write(selection, at: selectedFile)
            return Work(assets: [asset], selection: selection, descriptor: descriptor(selection))
        }
        progress(.init(inspected: initial.inspected, total: initial.total, indexed: initial.indexed, latest: nil))
        while state.candidates.count < state.limit, let resources = try state.inventory.next() {
            let current = state.inventory.progress
            progress(current)
            if !resources.isEmpty {
                let asset = Asset(resources)
                do {
                    if let outcome = try exactOutcome(asset) {
                        state.unavailable += outcome.unavailable.count
                        state.readFailures += Self.readFailures(outcome)
                        if !outcome.unavailable.isEmpty { try rememberDeferred(asset, outcome: outcome, at: state.checkpoint) }
                    } else { state.candidates.append(asset) }
                } catch {
                    orderedSelection = nil
                    throw error
                }
            }
            // Save a restart point while walking a previously acknowledged
            // prefix. An unacknowledged group never advances this checkpoint.
            if state.candidates.isEmpty, current.inspected % 64 == 0,
               state.checkpoint.libraryToken != nil, try state.inventory.isCurrent() {
                try write(state.checkpoint, at: cursorFile)
            }
        }
        guard try state.inventory.isCurrent() else {
            orderedSelection = nil
            throw PhotoLibraryReader.Failure.changed
        }
        let assets = state.candidates
        let exhausted = state.inventory.progress.inspected == state.inventory.progress.total
        let selection = Selection(id: UUID(), stamps: assets.map(Stamp.init), pending: 0, priorUnavailable: state.unavailable,
            sourceAssets: assets.map { $0.resources[0].asset }, orderedCursor: state.checkpoint, remainingKnown: exhausted, priorReadFailures: state.readFailures)
        try write(selection, at: selectedFile)
        return Work(assets: assets, selection: selection, descriptor: descriptor(selection))
    }

    /// Read-only lookahead owns a separate bounded cursor. It neither replaces
    /// current.json nor advances the durable acknowledgement checkpoint.
    func lookahead(provider: any OrderedPhotoResourceProvider, batchId: UUID) throws -> [PhotoResource] {
        guard let selected = try read(Selection.self, at: selectedFile), selected.id == batchId,
              let cursor = selected.orderedCursor, cursor.libraryToken != nil else { return [] }
        let inventory = try provider.orderedInventory(resuming: cursor)
        var resources: [PhotoResource] = [], count = 0
        while count < Self.batchSize, let group = try inventory.next() {
            try Task.checkCancellation()
            guard !group.isEmpty else { continue }
            let asset = Asset(group)
            if try selected.stamps.contains(Stamp(asset)) || exactOutcome(asset) != nil { continue }
            resources.append(contentsOf: group); count += 1
        }
        guard try inventory.isCurrent() else { throw PhotoLibraryReader.Failure.changed }
        return resources
    }

    private func advanceOrderedCursor(_ selection: Selection) throws {
        guard var cursor = selection.orderedCursor else { return }
        cursor.unavailable = selection.priorUnavailable + (selection.attempts?.reduce(0) { $0 + $1.unavailable.count } ?? 0)
        cursor.unavailableReadFailures = (selection.priorReadFailures ?? 0) + (selection.attempts?.reduce(0) { $0 + Self.readFailures($1) } ?? 0)
        if cursor.libraryToken != nil { try write(cursor, at: cursorFile) }
        if let state = orderedSelection {
            state.candidates.removeAll(keepingCapacity: true)
            state.limit = Self.batchSize
            state.unavailable = cursor.unavailable
            state.readFailures = cursor.unavailableReadFailures ?? 0
        }
    }

    func select(revision: String, resources: [PhotoResource], replaceStale: Bool = false,
                startWithSingleAsset: Bool = false) throws -> Work {
        try loadOutcomes()
        if membership?.revision != revision {
            var pending = 0, unavailable = 0, readFailures = 0
            let all = PhotoBackupAssetOrder.groups(resources).map(Asset.init)
            let ordered = all.filter { asset in
                if let attempted = outcomes?[asset.key], attempted.stamp == Stamp(asset) {
                    unavailable += attempted.unavailable.count; readFailures += Self.readFailures(attempted); return false
                }
                pending += asset.resources.count; return true
            }
            membership = (revision, ordered, Dictionary(uniqueKeysWithValues: all.map { ($0.key, $0) }), 0, pending, unavailable, readFailures)
        }
        guard let membership else { throw PhotoLibraryReader.Failure.changed }
        let selection: Selection
        let assets: [Asset]
        if let retained = try read(Selection.self, at: selectedFile) {
            assets = retained.stamps.compactMap { membership.byKey[$0.key] }
            let refineUnpreparedFirstBatch = startWithSingleAsset && outcomes?.isEmpty == true &&
                retained.attempts == nil && retained.stamps.count > 1
            guard assets.map(Stamp.init) == retained.stamps && !refineUnpreparedFirstBatch else {
                guard replaceStale else { throw PhotoLibraryReader.Failure.changed }
                // This was an unacknowledged selection. A previous app can
                // also have written its first selection without preparing it.
                // Neither case advances the cursor or erases any receipt.
                try FileManager.default.removeItem(at: selectedFile)
                return try select(revision: revision, resources: resources, startWithSingleAsset: startWithSingleAsset)
            }
            selection = retained
        } else {
            // Let the first newest asset upload without waiting for other
            // originals to materialize. Resume retains the existing batch.
            let limit = startWithSingleAsset && outcomes?.isEmpty == true ? 1 : Self.batchSize
            assets = Array(membership.ordered.dropFirst(membership.position).prefix(limit))
            let pending = membership.pending - assets.reduce(0) { $0 + $1.resources.count }
            selection = .init(id: UUID(), stamps: assets.map(Stamp.init), pending: pending, priorUnavailable: membership.unavailable, priorReadFailures: membership.readFailures)
            try write(selection, at: selectedFile)
        }
        return Work(assets: assets, selection: selection, descriptor: descriptor(selection))
    }

    func prepare(_ work: Work, unavailable: Set<String>, entries: [MobileFolderReader.Entry], reasons: [String: String] = [:]) throws -> PhotoBackupQueueBatch {
        guard var selected = try read(Selection.self, at: selectedFile), selected.id == work.selection.id,
              selected.stamps == work.assets.map(Stamp.init) else { throw PhotoLibraryReader.Failure.changed }
        let attempts = work.assets.map { asset in
            Attempt(stamp: Stamp(asset), unavailable: asset.resources.map(\.path).filter(unavailable.contains),
                reasonByPath: Dictionary(uniqueKeysWithValues: asset.resources.map(\.path).filter(unavailable.contains).map { ($0, reasons[$0] ?? "cloud-download") }))
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

    func shouldLoadOrderedAssets(_ batch: UUID) throws -> Bool {
        guard completed != batch, try read(UUID.self, at: completedFile) != batch,
              let selected = try read(Selection.self, at: selectedFile), selected.id == batch else { return false }
        return selected.sourceAssets != nil
    }

    func entriesForVerification(_ batch: UUID) throws -> [MobileFolderReader.Entry] {
        if try read(UUID.self, at: completedFile) == batch { return [] }
        guard let selected = try read(Selection.self, at: selectedFile), selected.id == batch, selected.attempts != nil,
              let entries = selected.entries else { throw PhotoLibraryReader.Failure.changed }
        return entries
    }

    func retryUnavailable() throws {
        // Retry only asset revisions whose originals were unavailable. The
        // acknowledged library prefix stays indexed and need not be rescanned.
        guard try read(Selection.self, at: selectedFile) == nil else { throw PhotoLibraryReader.Failure.changed }
        try loadOutcomes()
        if FileManager.default.fileExists(atPath: cursorFile.path) { try FileManager.default.removeItem(at: cursorFile) }
        orderedSelection = nil
        deferredCandidates.removeAll(); deferredSearchAfter = nil
        for (key, outcome) in outcomes ?? [:] where !outcome.unavailable.isEmpty {
            try Task.checkCancellation()
            try FileManager.default.removeItem(at: record(key))
            let deferred = deferredFile(key)
            if FileManager.default.fileExists(atPath: deferred.path) { try FileManager.default.removeItem(at: deferred) }
            outcomes?.removeValue(forKey: key)
            membership = nil
        }
    }

    func finish(_ batch: UUID, orderedAssets: [Asset]? = nil) throws {
        if completed == batch { return }
        if try read(UUID.self, at: completedFile) == batch {
            if let selection = try read(Selection.self, at: selectedFile), selection.id == batch {
                try advanceOrderedCursor(selection)
                try FileManager.default.removeItem(at: selectedFile)
                membership = nil
            }
            completed = batch
            return
        }
        guard let selection = try read(Selection.self, at: selectedFile), selection.id == batch, let attempts = selection.attempts else {
            throw PhotoLibraryReader.Failure.changed
        }
        if let orderedAssets {
            guard let cursor = selection.orderedCursor, orderedAssets.map(Stamp.init) == selection.stamps,
                  attempts.map(\.stamp) == selection.stamps else { throw PhotoLibraryReader.Failure.changed }
            for (asset, outcome) in zip(orderedAssets, attempts) { try rememberDeferred(asset, outcome: outcome, at: cursor) }
        }
        for attempt in attempts {
            try write(attempt, at: record(attempt.stamp.key))
            outcomes?[attempt.stamp.key] = attempt
        }
        // Removing the current selection can be retried after a failed write.
        // Persist the acknowledgement first so a lost reply is idempotent.
        if selection.remainingKnown != false && selection.stamps.isEmpty && selection.pending == 0 {
            try write(Terminal(batch: batch, finishedAt: Date()), at: terminalFile)
        }
        try write(batch, at: completedFile)
        try advanceOrderedCursor(selection)
        try FileManager.default.removeItem(at: selectedFile)
        completed = batch
        if let cursor = membership, cursor.ordered.dropFirst(cursor.position).prefix(selection.stamps.count).map(Stamp.init) == selection.stamps {
            membership?.position += selection.stamps.count
            membership?.pending = cursor.pending - cursor.ordered.dropFirst(cursor.position).prefix(selection.stamps.count).reduce(0) { $0 + $1.resources.count }
            membership?.unavailable = cursor.unavailable + attempts.reduce(0) { $0 + $1.unavailable.count }
            membership?.readFailures = cursor.readFailures + attempts.reduce(0) { $0 + Self.readFailures($1) }
        } else {
            membership = nil
        }
    }
}
