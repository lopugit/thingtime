#if THINGTIME_LOCAL_DEVELOPMENT
import Foundation

/// Native document ownership fence, shared by admission and post-await commit.
struct ThingtimeLocalWorkspaceFence {
    static let featureVersion = "1.0.0"
    struct Snapshot { let documentId: String; let url: URL }
    static func allowsOrigin(nativeOrigin: URL, selectedRoot: URL, currentURL: URL, frameURL: URL) -> Bool {
        guard nativeOrigin.scheme == "http", nativeOrigin.host == "127.0.0.1", nativeOrigin.port != nil,
              nativeOrigin.user == nil, nativeOrigin.password == nil else { return false }
        return [selectedRoot, currentURL, frameURL].allSatisfy { LopuVoiceContract.sameOrigin($0, nativeOrigin) }
    }
    private(set) var documentId = UUID().uuidString
    mutating func navigationStarted() { documentId = UUID().uuidString }
    func capture(url: URL) -> Snapshot { Snapshot(documentId: documentId, url: url) }
    func isCurrent(_ snapshot: Snapshot, currentURL: URL?) -> Bool {
        snapshot.documentId == documentId && currentURL == snapshot.url
    }
    func allowsInitialization(_ snapshot: Snapshot, currentURL: URL?, expectedVersion: String?, expectedDocumentId: String?) -> Bool {
        expectedVersion == Self.featureVersion && expectedDocumentId == documentId && isCurrent(snapshot, currentURL: currentURL)
    }
}
#endif
