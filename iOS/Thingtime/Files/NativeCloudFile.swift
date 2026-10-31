import AppleFileSync
import Foundation

/// An exact existing cloud file, never an arbitrary URL or a new grant. The
/// selected server reauthorizes it before/after every native binary range.
struct NativeCloudFile: Decodable, Equatable, Sendable {
    let id: String
    let revision: String
    let name: String
    let folderId: String?
    let trashed: Bool
    let content: FileVersionExport.Content
    var download: FileVersionExport.Request { .init(name: name, content: content) }
    func validate(source: MobileFolderReader.Entry) throws {
        try download.validate()
        let identifier = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$"
        guard !trashed, id.range(of: identifier, options: .regularExpression) != nil,
              revision.range(of: identifier, options: .regularExpression) != nil,
              folderId == nil || folderId!.range(of: identifier, options: .regularExpression) != nil,
              source.kind == "file", source.id == id, source.version == revision,
              source.size == content.size, source.fingerprint == content.fingerprint else { throw MobileFolderStore.Failure.changed }
    }
    @MainActor func check(using transport: NativeFileSession) async throws {
        let response = try await transport.json("/api/v1/files?id=\(id)")
        guard response["ok"] as? Bool == true, let value = response["file"] as? [String: Any],
              try JSONDecoder().decode(Self.self, from: JSONSerialization.data(withJSONObject: value)) == self else {
            throw MobileFolderStore.Failure.changed
        }
    }
}
