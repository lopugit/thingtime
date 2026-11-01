import AppleFileSync
import Foundation

/// Snapshot of the reviewed editable Thing, never an independent permission.
/// Each part re-reads that Thing and checks the live device and local conditions.
struct NativeUploadAuthorization: Decodable, Sendable {
    struct Scope: Decodable, Sendable { let ownerId: String; let origin: String; let dataPlane: String; let rootId: String; let deviceId: String }
    struct Configuration: Decodable, Equatable, Sendable {
        let configurationVersion: Int
        let name: String
        let deviceId: String
        let localRootId: String
        let remoteFolderId: String
        let sourceKind: String?
        let mode: String
        let paused: Bool
        let propagateDeletes: Bool
        let network: String
        let chargingOnly: Bool
        let excludedPaths: [String]
    }
    let id: String
    let updatedAt: String
    let configuration: Configuration
    let scope: Scope
    func validate(owner: FileSyncOwnerScope, rootId: String, photos: Bool) throws {
        let c = configuration
        guard id.range(of: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$", options: .regularExpression) != nil,
              scope.rootId == id, scope.ownerId == owner.ownerId, (scope.origin == owner.origin.absoluteString || scope.origin + "/" == owner.origin.absoluteString),
              scope.dataPlane == "home", scope.deviceId == c.deviceId, c.localRootId == rootId,
              c.configurationVersion == 1, !c.paused, ["upload", "two-way", "backup"].contains(c.mode),
              ["wifi", "any"].contains(c.network), (c.sourceKind == "photos") == photos,
              !photos || (c.mode == "backup" && !c.propagateDeletes) else { throw MobileFolderStore.Failure.changed }
    }
    func verify(_ response: [String: Any], network: String, charging: Bool) throws {
        struct Row: Decodable {
            struct Author: Decodable { let id: String }
            let id: String; let updatedAt: String; let author: Author
            let appId: String?; let targetId: String?; let acl: [String]; let thingtime: [String]; let crystal: Configuration
        }
        guard response["ok"] as? Bool == true, let thing = response["thing"] as? [String: Any] else { throw MobileFolderStore.Failure.changed }
        let row = try JSONDecoder().decode(Row.self, from: JSONSerialization.data(withJSONObject: thing))
        guard row.id == id, row.updatedAt == updatedAt, row.author.id == scope.ownerId, row.appId == nil, row.targetId == nil,
              row.acl == ["tt:user"], row.thingtime == ["file-sync"], row.crystal == configuration,
              ["wifi", "cellular", "ethernet"].contains(network), configuration.network != "wifi" || network == "wifi",
              !configuration.chargingOnly || charging else { throw MobileFolderStore.Failure.changed }
    }
}
