import Foundation

/// Read-only, short-lived directory checks. Every inspection independently
/// resolves the pinned grant and O_NOFOLLOW namespace; no descriptor survives
/// a call or a remote canonical commit.
public enum MobileFolderBatchValidator {
    public static func validate(_ entries: [MobileFolderReader.Entry]) throws {
        guard !entries.isEmpty, entries.count <= 256 else { throw MobileFolderStore.Failure.limit }
        var paths = Set<String>(), identities = Set<String>()
        for entry in entries {
            _ = try MobileFolderReader.components(entry.path)
            guard entry.kind == "folder", entry.size == 0, entry.sha256 == nil, entry.fingerprint == nil,
                  !entry.id.isEmpty, !entry.version.isEmpty,
                  paths.insert(entry.path.precomposedStringWithCanonicalMapping.lowercased()).inserted,
                  identities.insert(entry.id).inserted else { throw MobileFolderStore.Failure.invalid }
        }
    }
    public static func check(bookmark: Data, expected: MobileFolderReader.Entry) throws {
        try validate([expected]); try Task.checkCancellation()
        guard let actual = try MobileFolderReader.inspectFolder(bookmark: bookmark, path: expected.path), actual == expected else {
            throw MobileFolderStore.Failure.changed
        }
        try Task.checkCancellation()
    }
}
