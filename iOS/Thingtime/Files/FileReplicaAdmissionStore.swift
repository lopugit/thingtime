import AppleFileSync
import CryptoKit
import Foundation

/// The cookie itself remains in WebKit. Its digest binds an earlier server
/// admission to the same live cookie, and any JWT expiration only narrows it.
struct FileReplicaCookieBinding: Codable, Equatable {
    let digest: Data
    let expiresAt: Date?

    init(header: String, expiresAt: Date?) {
        digest = Data(SHA256.hash(data: Data(header.utf8)))
        let token = header.dropFirst("tt_auth=".count).split(separator: ".", omittingEmptySubsequences: false)
        var tokenExpiry: Date?
        if token.count == 3 {
            var base64 = token[1].replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
            base64.append(String(repeating: "=", count: (4 - base64.count % 4) % 4))
            struct Claims: Decodable { let exp: Double? }
            if let bytes = Data(base64Encoded: base64),
               let claims = try? JSONDecoder().decode(Claims.self, from: bytes),
               let expiration = claims.exp, expiration.isFinite {
                tokenExpiry = Date(timeIntervalSince1970: expiration)
            }
        }
        self.expiresAt = [expiresAt, tokenExpiry].compactMap { $0 }.min()
    }

    func matches(_ current: Self, now: Date) -> Bool {
        digest.count == 32 && digest == current.digest &&
            (expiresAt.map { $0 > now } ?? true) && (current.expiresAt.map { $0 > now } ?? true)
    }
}

struct FileReplicaAdmissionStore {
    struct Admission: Codable, Equatable {
        let owner: FileSyncOwnerScope
        let dataPlane: String
        let deviceId: String
        let thingId: String
        let cookie: FileReplicaCookieBinding
        let revision: String
        let name: String
        let folderId: String?
        let content: FileVersionExport.Content

        fileprivate init(scope: ManagedFileReplica.Scope, file: NativeCloudFile, cookie: FileReplicaCookieBinding) {
            owner = scope.owner; dataPlane = "home"; deviceId = scope.deviceId; thingId = file.id
            self.cookie = cookie; revision = file.revision; name = file.name; folderId = file.folderId; content = file.content
        }

        var file: NativeCloudFile {
            .init(id: thingId, revision: revision, name: name, folderId: folderId, trashed: false, content: content)
        }

        fileprivate func validate(scope: ManagedFileReplica.Scope, cookie: FileReplicaCookieBinding,
                                  expectedRevision: String?, now: Date) throws {
            guard owner == scope.owner, dataPlane == "home", deviceId == scope.deviceId, thingId == scope.thingId,
                  ManagedFileReplica.Scope.validIdentifier(revision),
                  folderId.map(ManagedFileReplica.Scope.validIdentifier) ?? true,
                  expectedRevision == nil || expectedRevision == revision, self.cookie.matches(cookie, now: now)
            else { throw MobileFolderStore.Failure.changed }
            try FileVersionExport.Request(name: "bytes", content: content).validate()
        }
    }

    let directory: URL

    func sessionKey(_ scope: ManagedFileReplica.Scope, _ cookie: FileReplicaCookieBinding) -> String {
        Self.digest(Data("\(scope.owner.key)\u{0}home\u{0}\(scope.deviceId)".utf8) + cookie.digest)
    }

    private func sessionDirectory(_ scope: ManagedFileReplica.Scope, _ cookie: FileReplicaCookieBinding) -> URL {
        directory.appendingPathComponent(sessionKey(scope, cookie), isDirectory: true)
    }

    private func recordURL(_ scope: ManagedFileReplica.Scope, _ cookie: FileReplicaCookieBinding) -> URL {
        sessionDirectory(scope, cookie).appendingPathComponent(Self.digest(Data(scope.thingId.utf8)))
    }

    private static func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    @discardableResult
    func save(_ scope: ManagedFileReplica.Scope, file: NativeCloudFile,
              cookie: FileReplicaCookieBinding, now: Date = Date()) throws -> Admission {
        guard !file.trashed else { throw MobileFolderStore.Failure.changed }
        let admission = Admission(scope: scope, file: file, cookie: cookie)
        try admission.validate(scope: scope, cookie: cookie, expectedRevision: nil, now: now)
        try FileManager.default.createDirectory(at: sessionDirectory(scope, cookie), withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        var root = directory
        var resource = URLResourceValues()
        resource.isExcludedFromBackup = true
        try root.setResourceValues(resource)
        #if os(iOS)
        let options: Data.WritingOptions = [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
        #else
        let options: Data.WritingOptions = .atomic
        #endif
        try JSONEncoder().encode(admission).write(to: recordURL(scope, cookie), options: options)
        return admission
    }

    func recoverOffline(_ scope: ManagedFileReplica.Scope, cookie: FileReplicaCookieBinding, expectedRevision: String?,
                        after error: URLError, now: Date = Date()) throws -> Admission {
        guard error.code == .notConnectedToInternet else { throw error }
        return try load(scope, cookie: cookie, expectedRevision: expectedRevision, now: now)
    }

    func load(_ scope: ManagedFileReplica.Scope, cookie: FileReplicaCookieBinding, expectedRevision: String?,
              now: Date = Date()) throws -> Admission {
        let url = recordURL(scope, cookie)
        let info = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard info.isRegularFile == true, info.isSymbolicLink == false else { throw MobileFolderStore.Failure.invalid }
        let admission = try JSONDecoder().decode(Admission.self, from: Data(contentsOf: url))
        try admission.validate(scope: scope, cookie: cookie, expectedRevision: expectedRevision, now: now)
        return admission
    }

    func remove(_ scope: ManagedFileReplica.Scope, cookie: FileReplicaCookieBinding) throws {
        try removeIfPresent(recordURL(scope, cookie))
    }

    func revoke(_ scope: ManagedFileReplica.Scope, cookie: FileReplicaCookieBinding) throws {
        let session = sessionDirectory(scope, cookie)
        let retired = directory.appendingPathComponent(".retired-\(UUID().uuidString)", isDirectory: true)
        // Rename first so an interruption during recursive cleanup never
        // leaves part of a revoked session eligible for offline disclosure.
        do { try FileManager.default.moveItem(at: session, to: retired) }
        catch let error as CocoaError where error.code == .fileNoSuchFile { return }
        try? FileManager.default.removeItem(at: retired)
    }

    private func removeIfPresent(_ url: URL) throws {
        do { try FileManager.default.removeItem(at: url) }
        catch let error as CocoaError where error.code == .fileNoSuchFile { }
    }
}
