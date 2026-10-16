import Foundation
import Security

/// OS grants stay native and account/origin scoped. Editable sync settings must
/// reference these opaque IDs, never store a bookmark or an absolute path.
@MainActor
final class MobileFolderStore {
    struct WriteApproval: Codable, Equatable, Sendable {
        let scope: MobileSyncStaging.Scope
        let configurationRevision: String
        let configurationHash: String
        func validate(owner: MobileDevicePairing.Scope) throws {
            guard scope.origin == owner.origin.absoluteString, scope.ownerId == owner.ownerId, scope.dataPlane == "home",
                  !scope.rootId.isEmpty, scope.rootId.utf16.count <= 4096, !scope.deviceId.isEmpty, scope.deviceId.utf16.count <= 4096,
                  !configurationRevision.isEmpty, configurationRevision.utf8.count <= 128,
                  configurationHash.count == 64, configurationHash.unicodeScalars.allSatisfy({ (48...57).contains($0.value) || (97...102).contains($0.value) }) else { throw Failure.invalid }
        }
    }
    struct Grant: Codable, Sendable {
        let id: String
        let scope: MobileDevicePairing.Scope
        let name: String
        let bookmark: Data
        var writeApprovals: [WriteApproval]?
    }
    enum Failure: Error, LocalizedError {
        case unavailable, invalid, limit, changed, storage, approvalCancelled
        var errorDescription: String? {
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
    private let loadData: (MobileDevicePairing.Scope) throws -> Data?
    private let saveData: (MobileDevicePairing.Scope, Data) throws -> Void
    init(load: @escaping (MobileDevicePairing.Scope) throws -> Data? = MobileFolderStore.loadKeychain,
         save: @escaping (MobileDevicePairing.Scope, Data) throws -> Void = MobileFolderStore.saveKeychain) { loadData = load; saveData = save }
    func list(_ scope: MobileDevicePairing.Scope) throws -> [Grant] {
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
    func grant(_ scope: MobileDevicePairing.Scope, id: String) throws -> Grant {
        guard let grant = try list(scope).first(where: { $0.id == id }) else { throw Failure.unavailable }
        return grant
    }
    func remove(_ scope: MobileDevicePairing.Scope, id: String) throws {
        let rows = try list(scope).filter { $0.id != id }; try persist(scope, rows)
    }
    func isWriteApproved(_ scope: MobileDevicePairing.Scope, id: String, approval: WriteApproval) throws -> Bool {
        try approval.validate(owner: scope)
        return try grant(scope, id: id).writeApprovals?.contains(approval) == true
    }
    /// Call only after the native consent dialog and fresh owner verification.
    /// Re-selecting/removing a grant clears these bindings; editable Things alone
    /// cannot create native write authority.
    func approveWrite(_ scope: MobileDevicePairing.Scope, grant original: Grant, approval: WriteApproval) throws {
        try approval.validate(owner: scope)
        var rows = try list(scope)
        guard let index = rows.firstIndex(where: { $0.id == original.id }), rows[index].bookmark == original.bookmark else { throw Failure.changed }
        var approvals = (rows[index].writeApprovals ?? []).filter { $0.scope != approval.scope }
        guard approvals.count < 32 else { throw Failure.limit }
        approvals.append(approval); rows[index].writeApprovals = approvals
        try persist(scope, rows)
    }
    private func persist(_ scope: MobileDevicePairing.Scope, _ rows: [Grant]) throws {
        let data = try JSONEncoder().encode(rows)
        guard data.count <= 1024 * 1024 else { throw Failure.limit }
        try saveData(scope, data)
    }
    /// Called only with a native picker result, never a URL supplied by JavaScript.
    func add(_ scope: MobileDevicePairing.Scope, selected url: URL) throws -> Grant {
        guard url.isFileURL else { throw Failure.invalid }
        let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
        let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard values.isDirectory == true, values.isSymbolicLink != true else { throw Failure.invalid }
        let bookmark = try url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
        guard bookmark.count <= 32 * 1024 else { throw Failure.limit }
        var rows = try list(scope)
        let existing = rows.firstIndex { row in
            var stale = false
            return (try? URL(resolvingBookmarkData: row.bookmark, options: .withoutUI, relativeTo: nil, bookmarkDataIsStale: &stale))?.standardizedFileURL == url.standardizedFileURL
        }
        guard existing != nil || rows.count < 32 else { throw Failure.limit }
        let name = url.lastPathComponent
        guard !name.isEmpty, name.utf8.count <= 1024 else { throw Failure.invalid }
        let grant = Grant(id: existing.map { rows[$0].id } ?? UUID().uuidString.lowercased(), scope: scope, name: name, bookmark: bookmark)
        if let existing { rows[existing] = grant } else { rows.append(grant) }
        try persist(scope, rows); return grant
    }
    private static func query(_ scope: MobileDevicePairing.Scope) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.thingtime.folder-grants.v1",
         kSecAttrAccount as String: scope.key, kSecAttrSynchronizable as String: false]
    }
    static func loadKeychain(_ scope: MobileDevicePairing.Scope) throws -> Data? {
        var q = query(scope); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?; let status = SecItemCopyMatching(q as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else { throw Failure.storage }; return data
    }
    static func saveKeychain(_ scope: MobileDevicePairing.Scope, data: Data) throws {
        var q = query(scope); q[kSecValueData as String] = data; q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(q as CFDictionary, nil)
        if status == errSecDuplicateItem {
            guard SecItemUpdate(query(scope) as CFDictionary, [kSecValueData as String: data] as CFDictionary) == errSecSuccess else { throw Failure.storage }
        } else if status != errSecSuccess { throw Failure.storage }
    }
}
