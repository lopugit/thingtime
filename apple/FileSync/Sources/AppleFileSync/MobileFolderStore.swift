import Foundation
import Security

/// OS grants stay native and account/origin scoped. Editable sync settings must
/// reference these opaque IDs, never store a bookmark or an absolute path.
@MainActor
public final class MobileFolderStore {
    public struct WriteApproval: Codable, Equatable, Sendable {
        public init(scope: MobileSyncStaging.Scope, configurationRevision: String, configurationHash: String, allowTrash: Bool? = nil) { self.scope = scope; self.configurationRevision = configurationRevision; self.configurationHash = configurationHash; self.allowTrash = allowTrash }

        public let scope: MobileSyncStaging.Scope
        public let configurationRevision: String
        public let configurationHash: String
        // Omitted on older grants. Ordinary download permission never implies
        // permission to propagate deletions into native recovery storage.
        public let allowTrash: Bool?
        public func validate(owner: FileSyncOwnerScope) throws {
            guard scope.origin == owner.origin.absoluteString, scope.ownerId == owner.ownerId, scope.dataPlane == "home",
                  !scope.rootId.isEmpty, scope.rootId.utf16.count <= 4096, !scope.deviceId.isEmpty, scope.deviceId.utf16.count <= 4096,
                  !configurationRevision.isEmpty, configurationRevision.utf8.count <= 128,
                  configurationHash.count == 64, configurationHash.unicodeScalars.allSatisfy({ (48...57).contains($0.value) || (97...102).contains($0.value) }) else { throw Failure.invalid }
        }
    }
    public struct Grant: Codable, Sendable {
        public init(id: String, scope: FileSyncOwnerScope, name: String, bookmark: Data, writeApprovals: [WriteApproval]? = nil) { self.id = id; self.scope = scope; self.name = name; self.bookmark = bookmark; self.writeApprovals = writeApprovals }

        public let id: String
        public let scope: FileSyncOwnerScope
        public let name: String
        public let bookmark: Data
        public var writeApprovals: [WriteApproval]?
    }
    public enum Failure: Error, LocalizedError {
        case unavailable, invalid, limit, changed, storage, approvalCancelled
        public var errorDescription: String? {
            switch self {
            case .approvalCancelled: return "Download approval cancelled. No folder write permission was granted."
            case .unavailable: return "This folder is unavailable. Check Files permissions or choose it again."
            case .invalid: return "This folder contains an unsupported path or item. No complete scan was produced."
            case .limit: return "This folder exceeds the current scan limit. Choose a smaller folder."
            case .changed: return "The folder changed while it was being read. Check it again."
            case .storage: return "Folder access could not be saved securely. Try again when the device is unlocked."
            }
        }
    }
    private let loadData: @MainActor (FileSyncOwnerScope) throws -> Data?
    private let saveData: @MainActor (FileSyncOwnerScope, Data) throws -> Void
    public init(load: @escaping @MainActor (FileSyncOwnerScope) throws -> Data? = MobileFolderStore.loadKeychain,
         save: @escaping @MainActor (FileSyncOwnerScope, Data) throws -> Void = MobileFolderStore.saveKeychain) { loadData = load; saveData = save }
    public func list(_ scope: FileSyncOwnerScope) throws -> [Grant] {
        guard let data = try loadData(scope) else { return [] }
        guard data.count <= 1024 * 1024 else { throw Failure.storage }
        let rows = try JSONDecoder().decode([Grant].self, from: data)
        guard rows.count <= 32, Set(rows.map(\.id)).count == rows.count,
              rows.allSatisfy({ $0.scope == scope && UUID(uuidString: $0.id) != nil && !$0.name.isEmpty && $0.name.utf8.count <= 1024 && $0.bookmark.count <= 32 * 1024 }) else { throw Failure.storage }
        for row in rows {
            guard (row.writeApprovals?.count ?? 0) <= 32 else { throw Failure.storage }
            for approval in row.writeApprovals ?? [] { try approval.validate(owner: scope) }
        }
        return rows
    }
    public func grant(_ scope: FileSyncOwnerScope, id: String) throws -> Grant {
        guard let grant = try list(scope).first(where: { $0.id == id }) else { throw Failure.unavailable }
        return grant
    }
    public func remove(_ scope: FileSyncOwnerScope, id: String) throws {
        let rows = try list(scope).filter { $0.id != id }; try persist(scope, rows)
    }
    public func isWriteApproved(_ scope: FileSyncOwnerScope, id: String, approval: WriteApproval) throws -> Bool {
        try approval.validate(owner: scope)
        return try grant(scope, id: id).writeApprovals?.contains(approval) == true
    }
    /// Call only after the native consent dialog and fresh owner verification.
    /// Re-selecting/removing a grant clears these bindings; editable Things alone
    /// cannot create native write authority.
    public func approveWrite(_ scope: FileSyncOwnerScope, grant original: Grant, approval: WriteApproval) throws {
        try approval.validate(owner: scope)
        var rows = try list(scope)
        guard let index = rows.firstIndex(where: { $0.id == original.id }), rows[index].bookmark == original.bookmark else { throw Failure.changed }
        var approvals = (rows[index].writeApprovals ?? []).filter { $0.scope != approval.scope }
        guard approvals.count < 32 else { throw Failure.limit }
        approvals.append(approval); rows[index].writeApprovals = approvals
        try persist(scope, rows)
    }
    private func persist(_ scope: FileSyncOwnerScope, _ rows: [Grant]) throws {
        let data = try JSONEncoder().encode(rows)
        guard data.count <= 1024 * 1024 else { throw Failure.limit }
        try saveData(scope, data)
    }
    /// Called only with a native picker result, never a URL supplied by JavaScript.
    public func add(_ scope: FileSyncOwnerScope, selected url: URL) throws -> Grant {
        guard url.isFileURL else { throw Failure.invalid }
        let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
        let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard values.isDirectory == true, values.isSymbolicLink != true else { throw Failure.invalid }
        let bookmark = try FolderBookmark.create(url)
        guard bookmark.count <= 32 * 1024 else { throw Failure.limit }
        var rows = try list(scope)
        let existing = rows.firstIndex { row in
            var stale = false
            return (try? FolderBookmark.resolve(row.bookmark, stale: &stale))?.standardizedFileURL == url.standardizedFileURL
        }
        guard existing != nil || rows.count < 32 else { throw Failure.limit }
        let name = url.lastPathComponent
        guard !name.isEmpty, name.utf8.count <= 1024 else { throw Failure.invalid }
        let grant = Grant(id: existing.map { rows[$0].id } ?? UUID().uuidString.lowercased(), scope: scope, name: name, bookmark: bookmark)
        if let existing { rows[existing] = grant } else { rows.append(grant) }
        try persist(scope, rows); return grant
    }
    private static func query(_ scope: FileSyncOwnerScope) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.thingtime.folder-grants.v1",
         kSecAttrAccount as String: scope.key, kSecAttrSynchronizable as String: false]
    }
    public static func loadKeychain(_ scope: FileSyncOwnerScope) throws -> Data? {
        var q = query(scope); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?; let status = SecItemCopyMatching(q as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else { throw Failure.storage }; return data
    }
    public static func saveKeychain(_ scope: FileSyncOwnerScope, data: Data) throws {
        var q = query(scope); q[kSecValueData as String] = data; q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(q as CFDictionary, nil)
        if status == errSecDuplicateItem {
            guard SecItemUpdate(query(scope) as CFDictionary, [kSecValueData as String: data] as CFDictionary) == errSecSuccess else { throw Failure.storage }
        } else if status != errSecSuccess { throw Failure.storage }
    }
}
