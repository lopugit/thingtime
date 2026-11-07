import AppleFileSync
import Foundation

/// PhotoKit's own transport cannot be interface-pinned. Only the saved
/// explicit unrestricted network choice can create this controller. Power
/// and connectivity are sampled by the host and checked off the main actor.
final class NativePhotoDownloadConditions: @unchecked Sendable {
    private let lock = NSLock()
    private var network = "unknown"
    private var charging = false
    func setNetwork(_ value: String) { lock.lock(); defer { lock.unlock() }; network = value }
    func setCharging(_ value: Bool) { lock.lock(); defer { lock.unlock() }; charging = value }
    func control(for authorization: NativeUploadAuthorization) -> PhotoOriginalDownloadControl? {
        guard authorization.configuration.sourceKind == "photos", authorization.configuration.network == "any" else { return nil }
        return PhotoOriginalDownloadControl(authorize: { [self] in
            try Task.checkCancellation()
            lock.lock(); defer { lock.unlock() }
            try authorization.verifyConditions(network: network, charging: charging)
        })
    }
}
