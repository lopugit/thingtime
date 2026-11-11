import AppleFileSync
import Foundation

struct NativePhotoTransferBytes: Codable, Equatable, Sendable {
    var wifi: Int64 = 0
    var cellular: Int64 = 0
    var unknown: Int64 = 0
    var total: Int64 { wifi + cellular + unknown }
    mutating func add(_ value: Self) {
        wifi += value.wifi; cellular += value.cellular; unknown += value.unknown
    }
}

/// Foreground and BGProcessing share one transfer governor. Every payload
/// source is scoped to the current reservation and is paced before it reaches
/// URLSession. iOS-managed PhotoKit fetches aren't counted as Thingtime PUTs.
@MainActor
final class NativeManagedPhotoPartTransfer {
    static let shared = NativeManagedPhotoPartTransfer(budget: .init())
    private let budget: NativePhotoUploadBudget
    private var active: [UUID: (scope: FileSyncOwnerScope, config: String, root: String, device: String, admission: String?, sender: NativeFileUpload)] = [:]
    init(budget: NativePhotoUploadBudget) { self.budget = budget }

    func send(_ request: URLRequest, file: URL, length: Int64, configuration: URLSessionConfiguration,
              scope: FileSyncOwnerScope, authorization: NativeUploadAuthorization, conditions: NativePhotoDownloadConditions,
              sender: NativeFileUpload = NativeFileUpload(),
              background: NativeBackgroundPhotoTransport? = nil, record: NativeDeferredUploadRecord? = nil,
              partNumber: Int = 0, checksum: String = "",
              accountOnce: ((NativePhotoTransferBytes, UUID) throws -> Void)? = nil,
              account: (NativePhotoTransferBytes) throws -> Void = { _ in }) async throws {
        guard let policy = authorization.configuration.managedPhotos, policy.valid else { throw MobileFolderStore.Failure.invalid }
        try conditions.verify(authorization)
        if let background, let record, Double(length) / Double(policy.rate) + 15 < background.expiry.timeIntervalSinceNow {
            let daemon = NativeBackgroundPhotoUpload.shared
            let ticket = try await daemon.prepare(record: record, part: partNumber, checksum: checksum, length: length, file: file, transport: background)
            if try daemon.isAccounted(ticket), ticket.settled { _ = try await daemon.send(ticket, request: request, rate: policy.rate); return }
            let lease = try budget.reserve(scope: scope, deviceId: authorization.scope.deviceId, bytes: length,
                cap: policy.uploadBytesPerHour, duration: 600, reservationId: ticket.id, retaining: daemon.retainedReservationIds)
            let outcome: Result<NativeBackgroundPhotoUpload.Result, Error>
            do { outcome = .success(try await daemon.send(ticket, request: request, rate: policy.rate, foregroundCount: { self.active.count })) }
            catch { outcome = .failure(error) }
            // An unsettled daemon task keeps its full reserved budget.
            if let result = try daemon.settledMeasurement(ticket) {
                try budget.finish(lease, observedBytes: result.sent, idempotent: true, observedAt: result.at)
                var bytes = NativePhotoTransferBytes()
                if result.cellular == true { bytes.cellular = result.sent }
                else { bytes.unknown = result.sent }
                if let accountOnce { try accountOnce(bytes, ticket.id) }
                else if result.sent > 0 { try account(bytes) }
                try daemon.markAccounted(ticket)
                try budget.forgetSettlement(scope: scope, deviceId: authorization.scope.deviceId, id: ticket.id)
            }
            _ = try outcome.get()
            return
        }
        guard active.count + NativeBackgroundPhotoUpload.shared.activeCount < 5 else { throw NativePhotoUploadBudget.Wait(retryAt: Date(timeIntervalSinceNow: 5)) }
        let lease = try budget.reserve(scope: scope, deviceId: authorization.scope.deviceId, bytes: length,
            cap: policy.uploadBytesPerHour, duration: NativeFileUpload.timeout(length: length, rate: policy.rate), retaining: NativeBackgroundPhotoUpload.shared.retainedReservationIds)
        let id = UUID()
        active[id] = (scope, authorization.id, authorization.configuration.localRootId, authorization.scope.deviceId, record?.admissionId, sender)
        defer { active.removeValue(forKey: id) }
        let path = conditions.snapshot()
        let outcome: Result<Void, Error>
        do {
            try await sender.send(request, file: file, configuration: configuration, rate: policy.rate, length: length,
                                  pace: { bytes, rate in
                                      try await NativePhotoUploadPacer.shared.consume(key: [scope.origin.absoluteString, scope.ownerId, authorization.scope.deviceId].joined(separator: "\n"), bytes: bytes, rate: rate)
                                  }, check: { try conditions.verify(authorization) })
            outcome = .success(())
        } catch { outcome = .failure(error) }
        let measurement = sender.measurement()
        var sent = measurement.sent
        if case .success = outcome { sent = max(sent, length) }
        try budget.finish(lease, observedBytes: sent)
        let end = conditions.snapshot()
        var bytes = NativePhotoTransferBytes()
        if measurement.cellular == true { bytes.cellular = measurement.measured }
        else if measurement.cellular == false, path.network == "wifi", path.networkRevision == end.networkRevision {
            bytes.wifi = measurement.measured
        }
        bytes.unknown = max(0, sent - bytes.wifi - bytes.cellular)
        if sent > 0 { try account(bytes) }
        try outcome.get()
    }

    func cancel(matching scope: FileSyncOwnerScope? = nil, configurationId: String? = nil, rootId: String? = nil, deviceId: String? = nil, preserveBackground: Bool = false) {
        if !preserveBackground { NativeBackgroundPhotoUpload.shared.cancel(scope: scope, configurationId: configurationId, rootId: rootId, deviceId: deviceId) }
        for value in active.values where (scope == nil || scope == value.scope) &&
            (configurationId == nil || configurationId == value.config) && (rootId == nil || rootId == value.root) &&
            (deviceId == nil || deviceId == value.device) { value.sender.cancel() }

    }
    func activeMeasurement(scope: FileSyncOwnerScope, configurationId: String, rootId: String, deviceId: String, admissionId: String? = nil) -> NativeFileUpload.Measurement? {
        let values = active.values.filter { $0.scope == scope && $0.config == configurationId && $0.root == rootId && $0.device == deviceId && (admissionId == nil || $0.admission == admissionId) }.map { $0.sender.measurement() }
        let background = NativeBackgroundPhotoUpload.shared.measurement(scope: scope, configurationId: configurationId, rootId: rootId, deviceId: deviceId, admissionId: admissionId)
        guard !values.isEmpty || background != nil else { return nil }
        let rates = values.compactMap(\.uploadBytesPerSecond) + [background?.uploadBytesPerSecond].compactMap { $0 }
        return .init(sent: values.reduce(background?.sent ?? 0) { $0 + $1.sent }, measured: values.reduce(0) { $0 + $1.measured },
            cellular: nil, uploadBytesPerSecond: rates.isEmpty ? nil : rates.reduce(0, +))
    }
}

/// All foreground lanes share one small-quantum schedule. A stalled lane does
/// not accumulate burst credit, and cancellation never advances byte counters.
actor NativePhotoUploadPacer {
    static let shared = NativePhotoUploadPacer()
    private var next: [String: UInt64] = [:]
    func consume(key: String, bytes: Int64, rate: Int64) async throws {
        try Task.checkCancellation()
        guard bytes > 0, rate > 0 else { throw MobileFolderStore.Failure.invalid }
        let now = DispatchTime.now().uptimeNanoseconds
        let duration = UInt64((Double(bytes) / Double(rate) * 1_000_000_000).rounded(.up))
        let end = max(now, next[key] ?? now) + duration
        next[key] = end
        try await Task.sleep(nanoseconds: end - now)
        try Task.checkCancellation()
    }
}
