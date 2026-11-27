import AppleFileSync
import Foundation

/// Finishing a native queue batch requires canonical, freshly observed cloud
/// bytes. A valid origin, connection and batch identifier alone cannot finish it.
enum NativePhotoQueueReceipt {
    private struct ObservationEnvelope: Decodable {
        let ok: Bool
        let observation: Observation
    }
    private struct Observation: Decodable {
        let version: Int
        let complete: Bool
        let rootId: String
        let path: String
        let entry: MobileFolderReader.Entry?
    }
    static func validate(_ raw: [String: Any], rootId: String, source: MobileFolderReader.Entry) throws {
        let data = try JSONSerialization.data(withJSONObject: raw)
        let decoded = try JSONDecoder().decode(ObservationEnvelope.self, from: data)
        let value = decoded.observation
        guard decoded.ok, value.version == 1, value.complete, value.rootId == rootId,
              value.path == source.path, let entry = value.entry, entry.path == source.path, entry.kind == "file",
              entry.size == source.size, entry.symbolicLink == nil else { throw MobileFolderStore.Failure.changed }
        if let fingerprint = source.fingerprint {
            guard entry.fingerprint == fingerprint else { throw MobileFolderStore.Failure.changed }
        } else {
            guard let digest = source.sha256, entry.sha256 == digest else { throw MobileFolderStore.Failure.changed }
        }
    }
    static func observationPath(rootId: String, path: String) throws -> String {
        var components = URLComponents()
        components.path = "/api/v1/files"
        components.queryItems = [.init(name: "rootId", value: rootId), .init(name: "path", value: path)]
        guard let result = components.string else { throw MobileFolderStore.Failure.invalid }
        return result
    }
}
