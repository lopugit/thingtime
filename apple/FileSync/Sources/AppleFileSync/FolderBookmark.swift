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
        let options: URL.BookmarkResolutionOptions = [.withoutUI, .withSecurityScope]
        #else
        let options: URL.BookmarkResolutionOptions = [.withoutUI]
        #endif
        return try URL(resolvingBookmarkData: data, options: options, relativeTo: nil, bookmarkDataIsStale: &stale)
    }
}
