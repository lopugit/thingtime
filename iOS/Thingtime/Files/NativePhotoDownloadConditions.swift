import AppleFileSync
import Foundation

/// PhotoKit's own transport cannot be interface-pinned. Only the saved
/// explicit unrestricted network choice can create this controller. Power
/// and connectivity are sampled by the host and checked off the main actor.
final class NativePhotoDownloadConditions: @unchecked Sendable {
    private let lock = NSLock()
    private var network = "unknown"
    private var charging = false
    private var networkRevision: UInt64 = 0
    func setNetwork(_ value: String) {
        lock.lock(); defer { lock.unlock() }
        if network != value { network = value; networkRevision &+= 1 }
    }
    func setCharging(_ value: Bool) { lock.lock(); defer { lock.unlock() }; charging = value }
    func snapshot() -> (network: String, charging: Bool, networkRevision: UInt64) {
        lock.lock(); defer { lock.unlock() }; return (network, charging, networkRevision)
    }
    func verify(_ authorization: NativeUploadAuthorization) throws {
        try Task.checkCancellation()
        let current = snapshot()
        try authorization.verifyConditions(network: current.network, charging: current.charging)
    }
    func control(for authorization: NativeUploadAuthorization) -> PhotoOriginalDownloadControl? {
        guard authorization.configuration.sourceKind == "photos", authorization.configuration.network == "any" else { return nil }
        return PhotoOriginalDownloadControl(authorize: { [self] in try verify(authorization) })
    }
}
