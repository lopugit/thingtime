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
    private var active: (scope: FileSyncOwnerScope, config: String, root: String, device: String, sender: NativeFileUpload)?
    init(budget: NativePhotoUploadBudget) { self.budget = budget }

    func send(_ request: URLRequest, file: URL, length: Int64, configuration: URLSessionConfiguration,
              scope: FileSyncOwnerScope, authorization: NativeUploadAuthorization, conditions: NativePhotoDownloadConditions,
              sender: NativeFileUpload = NativeFileUpload(),
              account: (NativePhotoTransferBytes) throws -> Void = { _ in }) async throws {
        guard let policy = authorization.configuration.managedPhotos, policy.valid else { throw MobileFolderStore.Failure.invalid }
        guard active == nil else { throw NativePhotoUploadBudget.Wait(retryAt: Date(timeIntervalSinceNow: 5)) }
        try conditions.verify(authorization)
        let lease = try budget.reserve(scope: scope, deviceId: authorization.scope.deviceId, bytes: length,
            cap: policy.uploadBytesPerHour, duration: NativeFileUpload.timeout(length: length, rate: policy.rate))
        active = (scope, authorization.id, authorization.configuration.localRootId, authorization.scope.deviceId, sender)
        defer { active = nil }
        let path = conditions.snapshot()
        let outcome: Result<Void, Error>
        do {
            try await sender.send(request, file: file, configuration: configuration, rate: policy.rate, length: length,
                                  check: { try conditions.verify(authorization) })
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

    func cancel(matching scope: FileSyncOwnerScope? = nil, configurationId: String? = nil, rootId: String? = nil, deviceId: String? = nil) {
        guard let active, scope == nil || scope == active.scope,
              configurationId == nil || configurationId == active.config, rootId == nil || rootId == active.root,
              deviceId == nil || deviceId == active.device else { return }
        active.sender.cancel()
    }
    func activeMeasurement(scope: FileSyncOwnerScope, configurationId: String, rootId: String, deviceId: String) -> NativeFileUpload.Measurement? {
        guard let active, active.scope == scope, active.config == configurationId, active.root == rootId, active.device == deviceId else { return nil }
        return active.sender.measurement()
    }
}
