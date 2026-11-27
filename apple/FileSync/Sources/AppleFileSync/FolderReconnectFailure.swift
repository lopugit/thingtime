import Foundation

/// Availability is not a new grant. Reconnected sources require fresh inventory
/// and receipt reconciliation; callers must never reuse an old inode snapshot.
public enum FolderReconnectFailure: Error, LocalizedError {
    case offline, remounted
    public var errorDescription: String? {
        switch self {
        case .offline: return "[folder_volume_offline] The granted volume is offline. Saved sync will retry."
        case .remounted: return "[folder_volume_remounted] The granted volume returned. Reconcile its saved transfer before continuing."
        }
    }
}
