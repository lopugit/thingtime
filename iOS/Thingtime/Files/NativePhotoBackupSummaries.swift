import AppleFileSync
import Foundation
import SQLite3
import UserNotifications

/// Published native originals, completed PhotoKit assets, and measured bytes
/// are recorded independently. SQLite keys keep each receipt/asset update
/// constant-sized even when a library contains thousands of originals.
@MainActor
final class NativePhotoBackupSummaries {
    static let shared = NativePhotoBackupSummaries()
    struct Totals: Codable, Equatable {
        var photos = 0, videos = 0, other = 0
        var bytes = NativePhotoTransferBytes()
        var empty: Bool { photos == 0 && videos == 0 && other == 0 && bytes.total == 0 }
        mutating func add(_ next: Totals) {
            photos += next.photos; videos += next.videos; other += next.other; bytes.add(next.bytes)
        }
        func minus(_ prior: Totals) -> Totals {
            .init(photos: photos - prior.photos, videos: videos - prior.videos, other: other - prior.other,
                  bytes: .init(wifi: bytes.wifi - prior.bytes.wifi, cellular: bytes.cellular - prior.bytes.cellular,
                               unknown: bytes.unknown - prior.bytes.unknown))
        }
        func body(start: Date, end: Date) -> String {
            var counts: [String] = []
            if photos > 0 { counts.append("\(photos) photo\(photos == 1 ? "" : "s")") }
            if videos > 0 { counts.append("\(videos) video\(videos == 1 ? "" : "s")") }
            if other > 0 { counts.append("\(other) other asset\(other == 1 ? "" : "s")") }
            let traffic = [("Wi-Fi", bytes.wifi), ("mobile", bytes.cellular), ("unknown network", bytes.unknown)]
                .filter { $0.1 > 0 }.map { "\(ByteCountFormatter.string(fromByteCount: $0.1, countStyle: .decimal)) on \($0.0)" }
            let time = start.formatted(date: .abbreviated, time: .shortened) + "–" + end.formatted(date: .omitted, time: .shortened) + ": "
            let line = time + (counts.isEmpty ? "No new complete assets yet." : counts.joined(separator: ", ") + " backed up.")
            return traffic.isEmpty ? line : line + " " + traffic.joined(separator: ", ") + " uploaded."
        }
    }
    struct Window: Codable, Equatable {
        let id: String
        let start: Date
        let due: Date
        var totals = Totals()
        var submitted = Totals()
        var attempt: Totals?
        var catchup: Catchup?
    }
    struct Catchup: Codable, Equatable { let id: String; let totals: Totals }
    struct Binding {
        let scope: FileSyncOwnerScope
        let configurationId: String
        let deviceId: String
        let rootId: String
        let interval: TimeInterval
        init(_ authorization: NativeUploadAuthorization, owner: FileSyncOwnerScope) {
            scope = owner; configurationId = authorization.id; deviceId = authorization.scope.deviceId
            rootId = authorization.configuration.localRootId
            interval = authorization.configuration.managedPhotos?.notificationInterval ?? 0
        }
    }

    private let directory: URL
    private let center: UNUserNotificationCenter
    private var submitting = Set<URL>()
    private var revisions: [URL: UUID] = [:]
    private var resumed: FileSyncOwnerScope?

    init(directory: URL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0],
         center: UNUserNotificationCenter = .current()) {
        self.directory = directory.appendingPathComponent("NativePhotoBackupSummaries-v1", isDirectory: true)
        self.center = center
    }

    private func key(_ values: [String]) -> String { String(PhotoLibraryReader.hash(Data(values.joined(separator: "\n").utf8)).prefix(32)) }
    private func prefix(_ scope: FileSyncOwnerScope) -> String { key([scope.origin.absoluteString, scope.ownerId]) + "-" }
    private func location(_ binding: Binding) -> URL {
        directory.appendingPathComponent(prefix(binding.scope) + key([binding.configurationId]) + "-" + key([binding.rootId]) + "-" + key([binding.deviceId]) + ".sqlite")
    }
    private func files() -> [URL] {
        ((try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? [])
            .filter { $0.pathExtension == "sqlite" }
    }

    func record(_ record: NativeDeferredUploadRecord, original: PhotoLibraryReader.OriginalIdentity?, now: Date = Date()) throws {
        let binding = Binding(record.request.authorization, owner: record.scope)
        try confirm(binding, originals: original.map { [$0] } ?? [], uploadId: record.request.uploadId,
                    bytes: record.transferBytes ?? .init(), now: now)
    }

    /// A foreground batch can verify an existing cloud companion without
    /// attributing its bytes to this run. It may complete an asset whose other
    /// original was published natively during this run.
    func observe(_ binding: Binding, originals: [PhotoLibraryReader.OriginalIdentity]) throws {
        try confirm(binding, originals: originals, uploadId: nil, bytes: .init(), now: Date())
    }

    private func confirm(_ binding: Binding, originals: [PhotoLibraryReader.OriginalIdentity], uploadId: String?,
                         bytes: NativePhotoTransferBytes, now: Date) throws {
        let url = location(binding), db = try database(url)
        try db.transaction {
            let stamp = Value.real(now.timeIntervalSince1970)
            if let uploadId {
                try db.run("INSERT OR IGNORE INTO receipt VALUES (?,?)", [.text(uploadId), stamp])
                guard db.changes == 1 else { return }
            }
            var totals = Totals(bytes: bytes)
            for original in originals {
                try db.run("INSERT OR IGNORE INTO asset VALUES (?,0,0,0,?)", [.text(original.group), stamp])
                try db.run("INSERT OR IGNORE INTO resource VALUES (?,?,?)", [.text(original.group), .text(original.resource), stamp])
                let added = db.changes
                try db.run("UPDATE asset SET received=received+?, newReceipt=max(newReceipt,?), seen=? WHERE id=?",
                           [.int(Int64(added)), .int(uploadId == nil ? 0 : 1), stamp, .text(original.group)])
                try db.run("UPDATE asset SET counted=1 WHERE id=? AND counted=0 AND newReceipt=1 AND received=?",
                           [.text(original.group), .int(Int64(original.count))])
                if db.changes == 1 {
                    switch original.kind { case "photo": totals.photos += 1; case "video": totals.videos += 1; default: totals.other += 1 }
                }
            }
            if !totals.empty {
                var cumulative = try db.totals(); cumulative.add(totals); try db.saveTotals(cumulative)
                if binding.interval > 0 {
                    var window = try db.windows("WHERE due > ? ORDER BY due DESC LIMIT 1", [stamp]).first ?? Window(
                        id: "thingtime-photos-" + UUID().uuidString.lowercased(), start: now, due: now.addingTimeInterval(binding.interval))
                    window.totals.add(totals)
                    try db.save(window)
                }
            }
            try db.prune(now: now)
        }
        if binding.interval > 0 { queue(url) }
    }

    func resume(verified scope: FileSyncOwnerScope) {
        guard resumed != scope else { return }
        resumed = scope
        clear(except: scope)
        for url in files() where url.lastPathComponent.hasPrefix(prefix(scope)) { queue(url) }
    }

    func deferVerifiedResume() { resumed = nil }

    func pendingWindows(_ binding: Binding) throws -> [Window] {
        let url = location(binding)
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        return try database(url).windows("ORDER BY due")
    }

    func confirmed(_ binding: Binding) throws -> Totals {
        let url = location(binding)
        guard FileManager.default.fileExists(atPath: url.path) else { return .init() }
        return try database(url).totals()
    }

    /// Pending system notifications must not survive a scope withdrawal. The
    /// keyed receipts remain so a later server replay cannot add them twice.
    func clear(matching scope: FileSyncOwnerScope? = nil, except: FileSyncOwnerScope? = nil,
               configurationId: String? = nil, rootId: String? = nil) {
        if except == nil, scope == nil || scope == resumed { resumed = nil }
        for url in files() {
            if let scope, !url.lastPathComponent.hasPrefix(prefix(scope)) { continue }
            if let except, url.lastPathComponent.hasPrefix(prefix(except)) { continue }
            if let configurationId, !url.lastPathComponent.contains("-" + key([configurationId]) + "-") { continue }
            if let rootId, !url.lastPathComponent.contains("-" + key([rootId]) + "-") { continue }
            revisions[url] = UUID()
            guard let db = try? database(url), let windows = try? db.windows() else { continue }
            center.removePendingNotificationRequests(withIdentifiers: windows.flatMap { [$0.id] + ($0.catchup.map { [$0.id] } ?? []) })
            try? db.run("DELETE FROM window")
        }
    }

    private func queue(_ url: URL) {
        if submitting.insert(url).inserted { Task { [weak self] in await self?.submit(url) } }
    }

    private func submit(_ url: URL) async {
        defer { submitting.remove(url) }
        let revision = revisions[url]
        let settings = await center.notificationSettings()
        guard [.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus), let db = try? database(url) else { return }
        // One expired window per opportunity avoids a burst after returning
        // from denial or suspension. Its persisted delivery ID survives a crash
        // between the notification request and the SQLite acknowledgement.
        var caughtUp = false
        while revisions[url] == revision,
              let windows = try? db.windows(caughtUp ? "WHERE complete = 0 AND due > ? ORDER BY due LIMIT 1" : "WHERE complete = 0 ORDER BY due LIMIT 1",
                                            caughtUp ? [.real(Date().timeIntervalSince1970)] : []),
              var window = windows.first {
            let past = window.due <= Date()
            if !past {
                window.attempt = window.totals
                do { try db.save(window) } catch { return }
            }
            if past, window.catchup == nil {
                window.catchup = Catchup(id: window.id + "-late", totals: window.totals)
                do { try db.save(window) } catch { return }
            }
            let delivered = past ? window.catchup!.totals : window.totals
            let id = past ? window.catchup!.id : window.id
            let totals = past ? delivered.minus(window.submitted) : delivered
            guard !totals.empty else { return }
            if past {
                // If the original was accepted by iOS right before a crash,
                // don't repeat its already displayed counts as a catch-up.
                async let deliveredNotifications = center.deliveredNotifications()
                async let pendingRequests = center.pendingNotificationRequests()
                let (existing, pending) = await (deliveredNotifications, pendingRequests)
                guard revisions[url] == revision else { return }
                if let attempted = window.attempt, window.submitted != attempted,
                   existing.contains(where: { $0.request.identifier == window.id }) || pending.contains(where: { $0.identifier == window.id }) {
                    window.submitted = attempted; window.catchup = nil; window.attempt = nil
                    do { try db.save(window) } catch { return }
                    continue
                }
                if existing.contains(where: { $0.request.identifier == id }) || pending.contains(where: { $0.identifier == id }) {
                    window.submitted = delivered; window.catchup = nil
                    try? db.save(window); caughtUp = true; continue
                }
            }
            guard revisions[url] == revision else { return }
            let content = UNMutableNotificationContent()
            content.title = "Thingtime Photos backup"
            content.body = totals.body(start: window.start, end: window.due)
            content.threadIdentifier = "thingtime-photos-backup"
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, window.due.timeIntervalSinceNow), repeats: false)
            do { try await center.add(.init(identifier: id, content: content, trigger: trigger)) } catch { return }
            guard revisions[url] == revision else { center.removePendingNotificationRequests(withIdentifiers: [id]); return }
            do {
                guard var latest = try db.windows("WHERE id = ?", [.text(window.id)]).first else { return }
                latest.submitted = delivered; latest.attempt = nil; latest.catchup = nil
                try db.save(latest)
            } catch { return }
            if past { caughtUp = true }
        }
    }

    private func database(_ url: URL) throws -> Database {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var folder = directory, values = URLResourceValues()
        values.isExcludedFromBackup = true; try folder.setResourceValues(values)
        return try Database(url)
    }

    private enum Value { case text(String), int(Int64), real(Double), blob(Data) }
    private final class Database {
        private let db: OpaquePointer
        init(_ url: URL) throws {
            var handle: OpaquePointer?
            guard sqlite3_open_v2(url.path, &handle, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK,
                  let handle else { if let handle { sqlite3_close(handle) }; throw MobileFolderStore.Failure.unavailable }
            db = handle
            let schema = """
            CREATE TABLE IF NOT EXISTS receipt (id TEXT PRIMARY KEY, seen REAL NOT NULL);
            CREATE INDEX IF NOT EXISTS receipt_seen ON receipt(seen);
            CREATE TABLE IF NOT EXISTS asset (id TEXT PRIMARY KEY, received INTEGER NOT NULL, newReceipt INTEGER NOT NULL, counted INTEGER NOT NULL, seen REAL NOT NULL);
            CREATE INDEX IF NOT EXISTS asset_seen ON asset(seen);
            CREATE TABLE IF NOT EXISTS resource (asset TEXT NOT NULL, id TEXT NOT NULL, seen REAL NOT NULL, PRIMARY KEY(asset,id));
            CREATE INDEX IF NOT EXISTS resource_seen ON resource(seen);
            CREATE TABLE IF NOT EXISTS window (id TEXT PRIMARY KEY, due REAL NOT NULL, complete INTEGER NOT NULL, json BLOB NOT NULL);
            CREATE INDEX IF NOT EXISTS window_due ON window(due);
            CREATE TABLE IF NOT EXISTS totals (id INTEGER PRIMARY KEY CHECK(id = 1), json BLOB NOT NULL);
            """
            guard sqlite3_exec(db, schema, nil, nil, nil) == SQLITE_OK else { throw MobileFolderStore.Failure.unavailable }
        }
        deinit { sqlite3_close(db) }
        var changes: Int { Int(sqlite3_changes(db)) }
        func transaction(_ action: () throws -> Void) throws {
            try run("BEGIN IMMEDIATE")
            do { try action(); try run("COMMIT") } catch { try? run("ROLLBACK"); throw error }
        }
        func run(_ query: String, _ values: [Value] = []) throws {
            try statement(query, values) { stmt in
                guard sqlite3_step(stmt) == SQLITE_DONE else { throw MobileFolderStore.Failure.unavailable }
            }
        }
        func windows(_ suffix: String = "", _ values: [Value] = []) throws -> [Window] {
            try statement("SELECT json FROM window " + suffix, values) { stmt in
                var windows: [Window] = []
                while true {
                    switch sqlite3_step(stmt) {
                    case SQLITE_DONE: return windows
                    case SQLITE_ROW:
                        guard let ptr = sqlite3_column_blob(stmt, 0) else { throw MobileFolderStore.Failure.invalid }
                        let data = Data(bytes: ptr, count: Int(sqlite3_column_bytes(stmt, 0)))
                        windows.append(try JSONDecoder().decode(Window.self, from: data))
                    default: throw MobileFolderStore.Failure.unavailable
                    }
                }
            }
        }
        func save(_ window: Window) throws {
            try run("INSERT OR REPLACE INTO window VALUES (?,?,?,?)", [.text(window.id), .real(window.due.timeIntervalSince1970),
                .int(window.submitted == window.totals ? 1 : 0), .blob(try JSONEncoder().encode(window))])
        }
        func totals() throws -> Totals {
            try statement("SELECT json FROM totals WHERE id = 1", []) { stmt in
                switch sqlite3_step(stmt) {
                case SQLITE_DONE: return Totals()
                case SQLITE_ROW:
                    guard let ptr = sqlite3_column_blob(stmt, 0) else { throw MobileFolderStore.Failure.invalid }
                    return try JSONDecoder().decode(Totals.self, from: Data(bytes: ptr, count: Int(sqlite3_column_bytes(stmt, 0))))
                default: throw MobileFolderStore.Failure.unavailable
                }
            }
        }
        func saveTotals(_ totals: Totals) throws {
            try run("INSERT OR REPLACE INTO totals VALUES (1,?)", [.blob(try JSONEncoder().encode(totals))])
        }
        func prune(now: Date) throws {
            let before = Value.real(now.timeIntervalSince1970 - 172_800)
            try run("DELETE FROM receipt WHERE seen < ?", [before])
            // Prune resources by their asset's last activity; independently
            // deleting a resource would allow its exact observation twice.
            try run("DELETE FROM resource WHERE asset IN (SELECT id FROM asset WHERE seen < ?)", [before])
            try run("DELETE FROM asset WHERE seen < ?", [before])
            try run("DELETE FROM window WHERE complete=1 AND due < ?", [before])
        }
        private func statement<T>(_ query: String, _ values: [Value], _ body: (OpaquePointer) throws -> T) throws -> T {
            var stmt: OpaquePointer?
            guard sqlite3_prepare_v2(db, query, -1, &stmt, nil) == SQLITE_OK, let stmt else { throw MobileFolderStore.Failure.unavailable }
            defer { sqlite3_finalize(stmt) }
            let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
            for (offset, value) in values.enumerated() {
                let i = Int32(offset + 1), result: Int32
                switch value {
                case .text(let value): result = sqlite3_bind_text(stmt, i, value, -1, transient)
                case .int(let value): result = sqlite3_bind_int64(stmt, i, value)
                case .real(let value): result = sqlite3_bind_double(stmt, i, value)
                case .blob(let value): result = value.withUnsafeBytes { sqlite3_bind_blob(stmt, i, $0.baseAddress, Int32($0.count), transient) }
                }
                guard result == SQLITE_OK else { throw MobileFolderStore.Failure.unavailable }
            }
            return try body(stmt)
        }
    }
}
