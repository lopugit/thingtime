import Foundation

/// One platform-specific bookmark boundary for grants, reads and publication.
/// macOS persists the native picker security scope; iOS keeps its existing format.
enum FolderBookmark {
    static func create(_ url: URL) throws -> Data {
        #if os(macOS)
        let options: URL.BookmarkCreationOptions = [.withSecurityScope]
        #else
        let options: URL.BookmarkCreationOptions = [.minimalBookmark]
        #endif
        return try url.bookmarkData(options: options, includingResourceValuesForKeys: nil, relativeTo: nil)
    }
    static func resolve(_ data: Data, stale: inout Bool) throws -> URL {
        #if os(macOS)
        let options: URL.BookmarkResolutionOptions = [.withoutUI, .withoutMounting, .withSecurityScope]
        #else
        let options: URL.BookmarkResolutionOptions = [.withoutUI]
        #endif
        do {
            return try URL(resolvingBookmarkData: data, options: options, relativeTo: nil, bookmarkDataIsStale: &stale)
        } catch {
            #if os(macOS)
            let failure = error as NSError
            // Measured on a detached APFS picker bookmark. Invalid, stale,
            // denied and malformed bookmarks retain their ordinary refusal.
            if failure.domain == NSCocoaErrorDomain, failure.code == NSFileNoSuchFileError {
                let original = URL.resourceValues(forKeys: [.volumeUUIDStringKey], fromBookmarkData: data)?.volumeUUIDString
                if let original, let mounted = FileManager.default.mountedVolumeURLs(includingResourceValuesForKeys: [.volumeUUIDStringKey], options: []),
                   !mounted.contains(where: { (try? $0.resourceValues(forKeys: [.volumeUUIDStringKey]).volumeUUIDString)?.lowercased() == original.lowercased() }) {
                    throw FolderReconnectFailure.offline
                }
            }
            #endif
            throw error
        }
    }
}
