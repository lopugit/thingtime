#if THINGTIME_LOCAL_DEVELOPMENT
import Foundation
import Security
import LocalAuthentication

/// OS-protected account keys, separate from the ordinary WebView device home.
/// No recovery/rekey operation: interrupted or inconsistent state fails closed.
struct ThingtimeLocalAccountProfile {
    enum Failure: Error { case unavailable; case keychain(OSStatus) }
    struct Envelope: Codable {
        let format: Int
        let provider: String
        let profileId: String
        let homePlaneId: String
        let origin: String
        let sqliteFile: String
        let keyId: String
        let jwt: String
        let vault: String
        let outbox: String
    }
    struct Store {
        let read: () throws -> Data?
        let add: (Data) throws -> Void
        static func keychain(service: String) -> Store {
            let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service, kSecAttrAccount as String: "native-account-home-v1",
                kSecAttrSynchronizable as String: false]
            return Store(read: {
                var request = query
                request[kSecReturnData as String] = true
                request[kSecMatchLimit as String] = kSecMatchLimitOne
                let context = LAContext()
                context.interactionNotAllowed = true
                request[kSecUseAuthenticationContext as String] = context
                var item: CFTypeRef?
                let status = SecItemCopyMatching(request as CFDictionary, &item)
                if status == errSecItemNotFound { return nil }
                guard status == errSecSuccess else { throw Failure.keychain(status) }
                guard let bytes = item as? Data else { throw Failure.unavailable }
                return bytes
            }, add: { bytes in
                var request = query
                request[kSecValueData as String] = bytes
                request[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
                let status = SecItemAdd(request as CFDictionary, nil)
                guard status == errSecSuccess else { throw Failure.keychain(status) }
            })
        }
    }
    static func prepare(root: URL, origin: String, store: Store, files: FileManager = .default) throws -> Data {
        guard let url = URL(string: origin), url.scheme == "http", url.host == "127.0.0.1",
              let port = url.port, port > 1024, port < 65536, url.user == nil, url.password == nil,
              url.path.isEmpty, url.query == nil, url.fragment == nil,
              root.isFileURL, root.standardizedFileURL.path == root.path else { throw Failure.unavailable }
        if files.fileExists(atPath: root.path) {
            guard try root.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else { throw Failure.unavailable }
        }
        let marker = root.appendingPathComponent("profile.json")
        let sqlite = root.appendingPathComponent("accounts.sqlite")
        let markerExists = files.fileExists(atPath: marker.path)
        let protected = try store.read()
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let envelope: Envelope
        if let protected {
            guard markerExists, try marker.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true, let decoded = try? JSONDecoder().decode(Envelope.self, from: protected),
                  decoded.format == 1, decoded.provider == "sqlite", decoded.origin == origin,
                  decoded.sqliteFile == sqlite.path,
                  validUUID(decoded.profileId), validUUID(decoded.keyId),
                  decoded.homePlaneId == "native-sqlite:" + decoded.profileId,
                  [decoded.jwt, decoded.vault, decoded.outbox].allSatisfy(validKey),
                  let markerValue = try JSONSerialization.jsonObject(with: Data(contentsOf: marker)) as? [String: String],
                  markerValue == metadata(decoded) else { throw Failure.unavailable }
            envelope = decoded
        } else {
            guard !markerExists else { throw Failure.unavailable }
            if files.fileExists(atPath: root.path) {
                // Never silently adopt even an empty existing database or an orphaned WAL.
                guard try files.contentsOfDirectory(atPath: root.path).isEmpty else { throw Failure.unavailable }
            }
            try files.createDirectory(at: root, withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700])
            let id = UUID().uuidString.lowercased()
            envelope = Envelope(format: 1, provider: "sqlite", profileId: id,
                homePlaneId: "native-sqlite:" + id, origin: origin, sqliteFile: sqlite.path,
                keyId: UUID().uuidString.lowercased(), jwt: try randomKey(), vault: try randomKey(), outbox: try randomKey())
            let bytes = try encoder.encode(envelope)
            try store.add(bytes) // Atomic no-replace; never overwrite an existing Keychain item.
            let markerBytes = try JSONSerialization.data(withJSONObject: metadata(envelope), options: [.sortedKeys])
            try markerBytes.write(to: marker, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
        return try encoder.encode(envelope)
    }
    private static func metadata(_ value: Envelope) -> [String: String] {
        ["profileId": value.profileId, "keyId": value.keyId, "origin": value.origin, "sqliteFile": value.sqliteFile]
    }
    private static func validUUID(_ value: String) -> Bool {
        value.range(of: "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$", options: .regularExpression) != nil
    }
    private static func validKey(_ value: String) -> Bool {
        guard let bytes = Data(base64Encoded: value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/") + "="), bytes.count == 32 else { return false }
        return encode(bytes) == value
    }
    private static func encode(_ bytes: Data) -> String {
        bytes.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
    private static func randomKey() throws -> String {
        var bytes = Data(count: 32)
        let result = bytes.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }
        guard result == errSecSuccess else { throw Failure.unavailable }
        defer { bytes.resetBytes(in: 0..<bytes.count) }
        return encode(bytes)
    }
}
#endif
