import AppleFileSync
import CryptoKit
import Foundation
import UIKit

/// Opt-in for the canonical direct object-store signer. Background URLSession
/// follows redirects itself; never infer this trust from an arbitrary PUT URL.
@MainActor
struct NativeBackgroundPhotoTransport {
    let expiry: Date
    static func parse(_ response: [String: Any], request: URLRequest, partNumber: Int, now: Date = Date()) throws -> Self? {
        guard let parts = response["parts"] as? [[String: Any]],
              let part = parts.first(where: { $0["partNumber"] as? Int == partNumber }), let raw = part["transport"] else { return nil }
        guard let descriptor = raw as? [String: Any], descriptor["kind"] as? String == "background-file-v1",
              descriptor["method"] as? String == "PUT", descriptor["redirects"] as? String == "provider-managed",
              let url = request.url, let c = URLComponents(url: url, resolvingAgainstBaseURL: false),
              c.scheme == "https", c.user == nil, c.password == nil, c.fragment == nil, c.port == nil || c.port == 443,
              let host = c.host, host.range(of: "^[a-z0-9][a-z0-9-]*[a-z0-9]\\.s3\\.[a-z]{2}(-gov)?-[a-z]+-[0-9]\\.amazonaws\\.com$", options: .regularExpression) != nil,
              let origin = descriptor["origin"] as? String, let expected = URL(string: origin),
              expected.scheme == "https", expected.host == host, expected.user == nil, expected.password == nil, expected.fragment == nil,
              expected.path.isEmpty || expected.path == "/", expected.query == nil,
              LopuVoiceContract.sameOrigin(url, expected), descriptor["path"] as? String == c.percentEncodedPath,
              let rawDate = descriptor["expiresAt"] as? String, let expiry = MobileDevicePairing.date(rawDate),
              rawDate == part["expiresAt"] as? String,
              expiry > now, expiry.timeIntervalSince(now) <= 610,
              request.httpMethod == "PUT", request.httpBody == nil, request.httpBodyStream == nil,
              (request.allHTTPHeaderFields ?? [:]).keys.allSatisfy({
                  ["content-type", "content-length", "x-amz-checksum-sha256"].contains($0.lowercased())
              }) else { throw NativeDeferredUploadClient.Failure.invalid }
        return .init(expiry: expiry)
    }
}

/// Scheduling controls the average admitted payload rate. earliestBeginDate is
/// advisory: it is not a promise that iOS emits each network quantum at a cap.
@MainActor
final class NativeBackgroundUploadCalendar {
    private let directory: URL
    init(directory: URL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]) {
        self.directory = directory.appendingPathComponent("NativePhotoUploadCalendar-v1", isDirectory: true)
    }
    func admit(key: String, bytes: Int64, rate: Int64, expiry: Date, now: Date = Date()) throws -> Date {
        guard bytes > 0, rate > 0 else { throw MobileFolderStore.Failure.invalid }
        let leaf = PhotoLibraryReader.hash(Data(key.utf8)) + ".json"
        let file = directory.appendingPathComponent(leaf)
        let prior: Date
        do { prior = try JSONDecoder().decode(Date.self, from: Data(contentsOf: file)) }
        catch let error as CocoaError where error.code == .fileReadNoSuchFile { prior = now }
        let begin = max(now, prior)
        let duration = Double(bytes) / Double(rate)
        guard begin.addingTimeInterval(duration + 15) < expiry else {
            throw NativePhotoUploadBudget.Wait(retryAt: max(now.addingTimeInterval(5), prior))
        }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(begin.addingTimeInterval(duration)).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        return begin
    }
}

enum NativeBackgroundTaskBinding {
    static func matches(stored: Int?, delivered: Int) -> Bool { stored == delivered && delivered > 0 }
    static func canRestore(stored: Int?, delivered: Int, terminal: Bool) -> Bool { matches(stored: stored, delivered: delivered) && !terminal }
    static func persistBeforeResume(_ task: URLSessionTask, persist: () throws -> Void) throws {
        do { try persist() } catch { task.cancel(); throw error }
    }
}

/// One stable daemon session per cellular policy and one exact receipt per
/// staged part. The daemon owns only already-authorized bytes, not discovery or
/// publication. A process restart reattaches by hash; a user Pause cancels it.
@MainActor
final class NativeBackgroundPhotoUpload: NSObject, URLSessionDataDelegate {
    static let shared = NativeBackgroundPhotoUpload()
    struct Ticket { let key: String; let id: UUID; let settled: Bool }
    struct Result { let sent: Int64; let cellular: Bool?; let at: Date }
    private struct Job: Codable {
        let key: String
        let id: UUID
        let record: NativeDeferredUploadRecord
        let part: Int
        let checksum: String
        let length: Int64
        let expiry: Date
        let cellularAllowed: Bool
        var taskId: Int?
        var sent: Int64 = 0
        var cellular: Bool?
        var succeeded = false
        var failed = false
        var accounted = false
        var cancelled = false
        var endedAt: Date?
    }
    private let directory: URL
    private let calendar = NativeBackgroundUploadCalendar()
    private let liveRecord: ((NativeDeferredUploadRecord) -> Bool)?
    private let sessionPrefix: String?
    private let beforeWrite: (Data) throws -> Void
    private var sessions: [Bool: URLSession] = [:]
    private var tasks: [String: URLSessionTask] = [:]
    private var retiring: [String: Set<Int>] = [:]
    private var receiptWrites: [String: Job] = [:]
    private var waiters: [String: (UUID, CheckedContinuation<Result, Error>)] = [:]
    private var completions: [String: () -> Void] = [:]
    private var responseBytes: [String: Int] = [:]
    private var lastWrite: [String: TimeInterval] = [:]
    private var measured: [String: Int64] = [:]
    private var samples: [String: [(time: UInt64, bytes: Int64)]] = [:]
    var activeCount: Int { tasks.count + retiring.values.reduce(0) { $0 + $1.count } }
    private var restored = false
    private var restoring: Task<Void, Never>?
    init(directory: URL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0],
         sessionPrefix: String? = nil, liveRecord: ((NativeDeferredUploadRecord) -> Bool)? = nil,
         beforeWrite: @escaping (Data) throws -> Void = { _ in }) {
        self.directory = directory.appendingPathComponent("NativeBackgroundPhotoUploads-v1", isDirectory: true)
        self.sessionPrefix = sessionPrefix; self.liveRecord = liveRecord; self.beforeWrite = beforeWrite
        super.init()
    }
    private func identifier(_ cellular: Bool) -> String {
        (sessionPrefix ?? Bundle.main.bundleIdentifier ?? "com.thingtime.appletime") + ".photo-parts." + (cellular ? "any" : "wifi")
    }
    private func session(_ cellular: Bool) -> URLSession {
        if let existing = sessions[cellular] { return existing }
        let c = URLSessionConfiguration.background(withIdentifier: identifier(cellular))
        c.httpCookieStorage = nil; c.urlCredentialStorage = nil; c.httpShouldSetCookies = false; c.urlCache = nil
        c.allowsCellularAccess = cellular; c.isDiscretionary = false; c.sessionSendsLaunchEvents = true
        c.timeoutIntervalForResource = 600; c.httpMaximumConnectionsPerHost = 5
        let value = URLSession(configuration: c, delegate: self, delegateQueue: .main)
        sessions[cellular] = value
        return value
    }
    func activate() {
        guard restoring == nil, !restored else { return }
        restoring = Task {
            for cellular in [false, true] {
                let outstanding = await session(cellular).allTasks
                for task in outstanding {
                    guard let key = task.taskDescription, key.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { task.cancel(); continue }
                    guard var job = try? load(key), job.cellularAllowed == cellular,
                          NativeBackgroundTaskBinding.canRestore(stored: job.taskId, delivered: task.taskIdentifier,
                              terminal: job.failed || job.succeeded) else {
                        retiring[key, default: []].insert(task.taskIdentifier); task.cancel(); continue
                    }
                    tasks[key] = task
                    if job.cancelled || !live(job.record) || job.expiry <= Date() {
                        job.cancelled = true; try? save(job); task.cancel()
                    }
                }
            }
            restored = true; restoring = nil; prune()
        }
    }
    private func live(_ record: NativeDeferredUploadRecord) -> Bool {
        if let liveRecord { return liveRecord(record) }
        guard let saved = try? NativeDeferredUploadStore().lookup(record), saved.armed, !saved.ready, saved.expiresAt > Date(),
              let grant = try? MobileFolderStore().grant(record.scope, id: record.rootId),
              NativeUploadPartStaging.grantRevision(grant) == record.grantRevision else { return false }
        guard let runId = record.photoRunId,
              let run = try? NativePhotoRunStore(directory: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]).load().first(where: { $0.runId == runId && $0.scope == record.scope &&
                  $0.authorization == record.request.authorization }), run.armed, run.expiresAt > Date() else { return false }
        return true
    }
    private func url(_ key: String, suffix: String) throws -> URL {
        guard key.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw MobileFolderStore.Failure.invalid }
        return directory.appendingPathComponent(key + suffix)
    }
    private func load(_ key: String) throws -> Job? {
        do {
            let data = try Data(contentsOf: url(key, suffix: ".json"))
            guard data.count < 65_536 else { throw MobileFolderStore.Failure.invalid }
            let job = try JSONDecoder().decode(Job.self, from: data)
            try job.record.validate()
            guard job.key == key, job.length > 0, job.part > 0 else { throw MobileFolderStore.Failure.invalid }
            return job
        } catch let e as CocoaError where e.code == .fileReadNoSuchFile { return nil }
    }
    private func save(_ job: Job) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(job)
        try beforeWrite(data)
        try data.write(to: url(job.key, suffix: ".json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        var folder = directory, values = URLResourceValues(); values.isExcludedFromBackup = true; try folder.setResourceValues(values)
    }
    func prepare(record: NativeDeferredUploadRecord, part: Int, checksum: String, length: Int64,
                 file: URL, transport: NativeBackgroundPhotoTransport) async throws -> Ticket {
        activate(); await restoring?.value
        try flushReceipts()
        let key = PhotoLibraryReader.hash(Data([record.scope.origin.absoluteString, record.scope.ownerId, record.admissionId,
            record.grantRevision, record.request.source.version, String(part), checksum].joined(separator: "\n").utf8))
        if let job = try load(key) {
            if job.cancelled { throw NativePhotoUploadBudget.Wait(retryAt: Date(timeIntervalSinceNow: 5)) }
            guard job.record.matches(record), job.part == part, job.checksum == checksum, job.length == length else { throw MobileFolderStore.Failure.changed }
            if job.succeeded || job.failed && !job.accounted || tasks[key] != nil { return .init(key: key, id: job.id, settled: job.succeeded) }
            if job.accounted { try NativePhotoUploadBudget().forgetSettlement(scope: record.scope, deviceId: record.configuration.deviceId, id: job.id) }
            // A failure or a process death before resume has no live daemon
            // task. Keep immutable bytes; renew only the short signed grant.
        }
        guard activeCount < 5 else { throw NativePhotoUploadBudget.Wait(retryAt: Date(timeIntervalSinceNow: 5)) }
        try Task.checkCancellation()
        guard live(record) else { throw CancellationError() }
        let payload = try url(key, suffix: ".part")
        var retained = false
        defer { if !retained { try? FileManager.default.removeItem(at: payload) } }
        if !FileManager.default.fileExists(atPath: payload.path) {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try FileManager.default.copyItem(at: file, to: payload)
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: payload.path)
        }
        guard (try FileManager.default.attributesOfItem(atPath: payload.path)[.size] as? NSNumber)?.int64Value == length else {
            throw MobileFolderStore.Failure.changed
        }
        var hash = SHA256()
        let handle = try FileHandle(forReadingFrom: payload)
        defer { try? handle.close() }
        while let data = try handle.read(upToCount: 262_144), !data.isEmpty { try Task.checkCancellation(); hash.update(data: data) }
        guard Data(hash.finalize()).base64EncodedString() == checksum else { throw MobileFolderStore.Failure.changed }
        let job = Job(key: key, id: UUID(), record: record, part: part, checksum: checksum, length: length,
                      expiry: transport.expiry, cellularAllowed: record.configuration.network == "any")
        try Task.checkCancellation()
        guard live(record) else { throw CancellationError() }
        try save(job); retained = true
        return .init(key: key, id: job.id, settled: false)
    }
    func isAccounted(_ ticket: Ticket) throws -> Bool { try load(ticket.key)?.accounted == true }
    func markAccounted(_ ticket: Ticket) throws {
        guard var job = try load(ticket.key), job.id == ticket.id, job.succeeded || job.failed else { throw MobileFolderStore.Failure.changed }
        job.accounted = true; try save(job)
    }
    func send(_ ticket: Ticket, request: URLRequest, rate: Int64, foregroundCount: () -> Int = { 0 }) async throws -> Result {
        guard var job = try load(ticket.key), job.id == ticket.id, !job.cancelled, live(job.record) else { throw CancellationError() }
        if job.succeeded { return .init(sent: job.sent, cellular: job.cellular, at: job.endedAt ?? Date()) }
        if job.failed { throw NativeDeferredUploadClient.Failure.unavailable }
        let waiter = UUID()
        return try await withTaskCancellationHandler(operation: {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { done in
                guard waiters[ticket.key] == nil else { done.resume(throwing: MobileFolderStore.Failure.changed); return }
                waiters[ticket.key] = (waiter, done)
                do {
                    if tasks[ticket.key] == nil {
                        guard activeCount + foregroundCount() < 5 else { throw NativePhotoUploadBudget.Wait(retryAt: Date(timeIntervalSinceNow: 5)) }
                        let policyKey = [job.record.scope.origin.absoluteString, job.record.scope.ownerId, job.record.configuration.deviceId].joined(separator: "\n")
                        let begin = try calendar.admit(key: policyKey, bytes: job.length, rate: rate, expiry: job.expiry)
                        let task = session(job.cellularAllowed).uploadTask(with: request, fromFile: try url(job.key, suffix: ".part"))
                        task.taskDescription = job.key; task.earliestBeginDate = begin
                        job.taskId = task.taskIdentifier
                        try NativeBackgroundTaskBinding.persistBeforeResume(task) { try save(job) }
                        tasks[job.key] = task; task.resume()
                    }
                } catch {
                    if tasks[ticket.key] == nil { job.failed = true; job.endedAt = Date(); try? save(job) }
                    waiters.removeValue(forKey: ticket.key)?.1.resume(throwing: error)
                }
            }
        }, onCancel: {
            // Expiration ends the app's lease, not the daemon's authorized PUT.
            // Explicit Pause/logout goes through cancel(matching:) below.
            Task { @MainActor in
                if self.waiters[ticket.key]?.0 == waiter { self.waiters.removeValue(forKey: ticket.key)?.1.resume(throwing: CancellationError()) }
            }
        })
    }
    func acknowledge(record: NativeDeferredUploadRecord, part: Int) {
        guard let rows = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return }
        for row in rows where row.pathExtension == "json" {
            let key = row.deletingPathExtension().lastPathComponent
            guard let job = try? load(key), job.record.matches(record), job.part == part, job.succeeded else { continue }
            try? NativePhotoUploadBudget().forgetSettlement(scope: record.scope, deviceId: record.configuration.deviceId, id: job.id)
            try? FileManager.default.removeItem(at: row); try? FileManager.default.removeItem(at: url(key, suffix: ".part"))
        }
    }
    func cancel(scope: FileSyncOwnerScope?, configurationId: String?, rootId: String?, deviceId: String?) {
        guard let rows = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return }
        for row in rows where row.pathExtension == "json" {
            let key = row.deletingPathExtension().lastPathComponent
            guard var job = try? load(key), scope == nil || job.record.scope == scope,
                  configurationId == nil || job.record.request.authorization.id == configurationId,
                  rootId == nil || job.record.rootId == rootId, deviceId == nil || job.record.configuration.deviceId == deviceId else { continue }
            job.cancelled = true; try? save(job)
            tasks[key]?.cancel()
            waiters.removeValue(forKey: key)?.1.resume(throwing: CancellationError())
        }
        if restored { prune() }
    }
    private func flushReceipts() throws {
        // The URLSession task is already terminal. Never attach a waiter to it
        // when its receipt write failed; retry the same protected receipt first.
        for (key, job) in receiptWrites {
            try save(job); receiptWrites.removeValue(forKey: key)
        }
    }
    private func prune() {
        guard restored, let rows = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return }
        for row in rows where row.pathExtension == "part" {
            let key = row.deletingPathExtension().lastPathComponent
            if (try? load(key)) == nil, tasks[key] == nil, receiptWrites[key] == nil, retiring[key]?.isEmpty != false { try? FileManager.default.removeItem(at: row) }
        }
        for row in rows where row.pathExtension == "json" {
            let key = row.deletingPathExtension().lastPathComponent
            guard var job = try? load(key), tasks[key] == nil, receiptWrites[key] == nil, retiring[key]?.isEmpty != false,
                  job.cancelled || job.record.expiresAt <= Date() || !live(job.record) else { continue }
            // Account a settled inactive attempt before retiring its protected
            // file. Uncertain daemon tasks retain both file and reservation.
            do {
                if !job.accounted, job.failed || job.succeeded {
                    try NativePhotoUploadBudget().reconcile(scope: job.record.scope, deviceId: job.record.configuration.deviceId,
                        id: job.id, observedBytes: job.sent, observedAt: job.endedAt)
                    if var record = try NativeDeferredUploadStore().lookup(job.record) {
                        var bytes = NativePhotoTransferBytes()
                        if job.cellular == true { bytes.cellular = job.sent } else { bytes.unknown = job.sent }
                        if record.accountTransfer(bytes, settlement: job.id, partNumber: job.part) { try NativeDeferredUploadStore().update(record) }
                    }
                }
                job.accounted = true; try save(job)
                try NativePhotoUploadBudget().forgetSettlement(scope: job.record.scope, deviceId: job.record.configuration.deviceId, id: job.id)
                try FileManager.default.removeItem(at: row)
                try? FileManager.default.removeItem(at: url(key, suffix: ".part"))
            } catch { continue }
        }
    }
    func measurement(scope: FileSyncOwnerScope, configurationId: String, rootId: String, deviceId: String, admissionId: String? = nil) -> NativeFileUpload.Measurement? {
        let values = tasks.keys.compactMap { key -> Int64? in
            guard let job = try? load(key), job.record.scope == scope, job.record.request.authorization.id == configurationId,
                  job.record.rootId == rootId, job.record.configuration.deviceId == deviceId, admissionId == nil || job.record.admissionId == admissionId else { return nil }
            return max(job.sent, measured[key] ?? 0)
        }
        guard !values.isEmpty else { return nil }
        let now = DispatchTime.now().uptimeNanoseconds
        let rates = tasks.keys.compactMap { key -> Int64? in
            guard let job = try? load(key), job.record.scope == scope, job.record.request.authorization.id == configurationId,
                  job.record.rootId == rootId, job.record.configuration.deviceId == deviceId,
                  admissionId == nil || job.record.admissionId == admissionId,
                  let first = samples[key]?.first, let last = samples[key]?.last,
                  last.time > first.time, last.time - first.time >= 250_000_000, now - last.time <= 1_500_000_000,
                  last.bytes > first.bytes else { return nil }
            return Int64(Double(last.bytes - first.bytes) * 1_000_000_000 / Double(last.time - first.time))
        }
        return .init(sent: values.reduce(0, +), measured: 0, cellular: nil, uploadBytesPerSecond: rates.isEmpty ? nil : rates.reduce(0, +))
    }
    var retainedReservationIds: Set<UUID> {
        guard let rows = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return [] }
        return Set(rows.filter { $0.pathExtension == "json" }.compactMap { (try? load($0.deletingPathExtension().lastPathComponent))?.id })
    }
    func completedRecords() -> [NativeDeferredUploadRecord] {
        guard let rows = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return [] }
        return rows.filter { $0.pathExtension == "json" }.compactMap { row in
            guard let job = try? load(row.deletingPathExtension().lastPathComponent), job.succeeded || job.failed else { return nil }
            return job.record
        }
    }
    func settledMeasurement(_ ticket: Ticket) throws -> Result? {
        guard let job = try load(ticket.key), job.id == ticket.id, job.succeeded || job.failed else { return nil }
        return .init(sent: job.sent, cellular: job.cellular, at: job.endedAt ?? Date())
    }
    func enforce(_ conditions: NativePhotoDownloadConditions) {
        for (key, task) in tasks {
            guard let job = try? load(key), live(job.record), (try? conditions.verify(job.record.request.authorization)) != nil else { task.cancel(); continue }
        }
    }
    func handleEvents(identifier: String, completion: @escaping () -> Void) -> Bool {
        guard [self.identifier(false), self.identifier(true)].contains(identifier) else { return false }
        completions[identifier] = completion; activate(); return true
    }
    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64,
                               totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        MainActor.assumeIsolated {
            guard let key = task.taskDescription, var job = try? self.load(key), job.taskId == task.taskIdentifier else { return }
            self.measured[key] = max(self.measured[key] ?? 0, totalBytesSent)
            let time = DispatchTime.now().uptimeNanoseconds
            var history = self.samples[key] ?? []
            if history.last.map({ time - $0.time >= 100_000_000 }) ?? true {
                history.append((time, totalBytesSent)); history.removeAll { time - $0.time > 1_500_000_000 }
                self.samples[key] = history
            }
            let now = ProcessInfo.processInfo.systemUptime
            if now - (self.lastWrite[key] ?? 0) >= 0.5 {
                job.sent = max(job.sent, totalBytesSent); try? self.save(job); self.lastWrite[key] = now
            }
        }
    }
    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didFinishCollecting metrics: URLSessionTaskMetrics) {
        let sent = metrics.transactionMetrics.filter { $0.countOfRequestBodyBytesSent > 0 }
        let cellular = sent.first?.isCellular
        let consistent = cellular != nil && sent.allSatisfy { $0.isCellular == cellular }
        MainActor.assumeIsolated {
            guard let key = task.taskDescription, var job = try? self.load(key), job.taskId == task.taskIdentifier else { return }
            if consistent { job.cellular = cellular }; try? self.save(job)
        }
    }
    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        MainActor.assumeIsolated {
            guard let key = task.taskDescription else { return }
            if self.retiring[key]?.remove(task.taskIdentifier) != nil {
                if self.retiring[key]?.isEmpty == true { self.retiring.removeValue(forKey: key) }
                self.prune(); return
            }
            guard self.receiptWrites[key] == nil, var job = try? self.load(key), job.taskId == task.taskIdentifier, !job.succeeded, !job.failed else { return }
            job.sent = max(job.sent, task.countOfBytesSent)
            // No device credentials reach this transport. The canonical provider
            // opts into its own redirect handling; receipt checks remain server-side.
            job.succeeded = !job.cancelled && error == nil && (task.response as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) && $0.expectedContentLength <= 65_536 } == true
            job.failed = !job.succeeded; job.endedAt = Date()
            do {
                try self.save(job)
                self.tasks.removeValue(forKey: key)
                self.measured.removeValue(forKey: key); self.lastWrite.removeValue(forKey: key); self.responseBytes.removeValue(forKey: key); self.samples.removeValue(forKey: key)
                let done = self.waiters.removeValue(forKey: key)?.1
                if job.succeeded { done?.resume(returning: .init(sent: job.sent, cellular: job.cellular, at: job.endedAt ?? Date())) }
                else { done?.resume(throwing: error ?? NativeDeferredUploadClient.Failure.unavailable) }
                self.prune()
            } catch {
                self.tasks.removeValue(forKey: key)
                self.receiptWrites[key] = job
                self.waiters.removeValue(forKey: key)?.1.resume(throwing: error)
            }
        }
    }
    nonisolated func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        MainActor.assumeIsolated {
            guard let id = session.configuration.identifier, let completion = self.completions.removeValue(forKey: id) else { return }
            do { try self.flushReceipts() }
            catch {
                // The pre-resume exact part journal and protected bytes remain
                // durable and uncertain, with a full allowance reservation.
                // End this finite event; next execution retries the receipt save.
                completion(); return
            }
            // Flush the durable result before giving the system its completion.
            // The queue reauthorizes and publishes in an ordinary permitted slice.
            NativeDeferredUpload.shared.backgroundPartsFinished(completion: completion)
        }
    }
    nonisolated func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                               completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        completionHandler(response.expectedContentLength <= 65_536 ? .allow : .cancel)
    }
    nonisolated func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        // S3 PUT returns no payload. Do not accumulate response bytes in memory.
        MainActor.assumeIsolated {
            guard let key = dataTask.taskDescription else { dataTask.cancel(); return }
            let bytes = (self.responseBytes[key] ?? 0) + data.count
            self.responseBytes[key] = bytes
            if bytes > 65_536 { dataTask.cancel() }
        }
    }
}

@MainActor
final class NativeBackgroundUploadCompletionTask: NativeDeferredUploadSystemTask {
    var expiration: (() -> Void)?
    var available: Bool { completion != nil && assertion != .invalid }
    private var assertion: UIBackgroundTaskIdentifier = .invalid
    private var deadline: Task<Void, Never>?
    private let endAssertion: (UIBackgroundTaskIdentifier) -> Void
    private var completion: (() -> Void)?
    init(timeoutNanoseconds: UInt64 = 25_000_000_000,
         beginAssertion: (@escaping () -> Void) -> UIBackgroundTaskIdentifier = { UIApplication.shared.beginBackgroundTask(withName: "Photo upload receipt", expirationHandler: $0) },
         endAssertion: @escaping (UIBackgroundTaskIdentifier) -> Void = { UIApplication.shared.endBackgroundTask($0) },
         completion: @escaping () -> Void) {
        self.completion = completion; self.endAssertion = endAssertion
        assertion = beginAssertion { [weak self] in self?.expire() }
        guard assertion != .invalid else { complete(false); return }
        deadline = Task { [weak self] in
            do { try await Task.sleep(nanoseconds: timeoutNanoseconds) } catch { return }
            self?.expire()
        }
    }
    private func expire() { expiration?(); complete(false) }
    func complete(_ success: Bool) {
        let done = completion; completion = nil; expiration = nil
        deadline?.cancel(); deadline = nil
        if assertion != .invalid { endAssertion(assertion); assertion = .invalid }
        done?()
    }
}
