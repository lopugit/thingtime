import AppleFileSync
import CryptoKit
import Foundation
import Security

/// Native-only pairing material. Neither keys nor device credentials cross the web bridge.
@MainActor
final class MobileDevicePairing {
    typealias Scope = FileSyncOwnerScope
    struct Record: Codable {
        let scope: Scope
        let privateKey: Data
        let nonce: String
        let credential: String
        let pairingSecret: String
        let expiresAt: Date
        var completeBody: Data?
        var deviceId: String?
        var revoked = false
        var revision: Int64 = 0
    }
    struct Status {
        let state: String
        let deviceId: String?
    }
    enum Failure: Error, LocalizedError {
        case identity, destination, incompatible, invalid, revoked, storage, http(Int)
        var errorDescription: String? {
            switch self {
            case .identity: return "Your account changed. Reopen Things and try again."
            case .destination, .incompatible: return "This destination does not support mobile pairing yet."
            case .revoked: return "This device connection was revoked. Add this device again to reconnect."
            case .storage: return "Device credentials could not be saved securely. Retry when this device is unlocked."
            case .http: return "The device service is unavailable. Your saved pairing can be retried."
            case .invalid: return "The device service returned an invalid pairing response."
            }
        }
    }
    typealias Transport = (URLRequest) async throws -> (Data, HTTPURLResponse)
    private let load: (Scope) throws -> Record?
    private let save: (Record) throws -> Void
    private let transport: Transport
    private let check: () throws -> Void
    private let cookie: (URL) async throws -> String
    static let requirements = ["api.auth-me": [1,0,0], "api.devices": [1,10,0], "api.devices-pairing": [1,0,0],
                               "api.devices-pairing-claim": [1,1,0], "api.devices-node-state": [1,9,0]]

    init(load: @escaping (Scope) throws -> Record?, save: @escaping (Record) throws -> Void,
         transport: @escaping Transport, cookie: @escaping (URL) async throws -> String,
         check: @escaping () throws -> Void = {}) {
        self.load = load; self.save = save; self.transport = transport; self.cookie = cookie; self.check = check
    }
    private func checked() throws { try Task.checkCancellation(); try check() }
    private func request(_ scope: Scope, _ path: String, body: Data? = nil, credential: String? = nil,
                         authenticated: Bool = true) async throws -> [String: Any] {
        try checked()
        let url = URL(string: path, relativeTo: scope.origin)!.absoluteURL
        guard LopuVoiceContract.sameOrigin(url, scope.origin) else { throw Failure.destination }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        request.httpMethod = body == nil ? "GET" : "POST"
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let credential { request.setValue("Bearer \(credential)", forHTTPHeaderField: "Authorization") }
        else if authenticated { request.setValue(try await cookie(url), forHTTPHeaderField: "Cookie") }
        try checked()
        let (data, response) = try await transport(request)
        try checked()
        guard response.url.map({ LopuVoiceContract.sameOrigin($0, scope.origin) }) == true else { throw Failure.destination }
        guard response.statusCode == 200 else {
            if response.statusCode == 401 && credential != nil { throw Failure.revoked }
            throw Failure.http(response.statusCode)
        }
        guard data.count <= 512 * 1024,
              let result = try JSONSerialization.jsonObject(with: data) as? [String: Any], result["ok"] as? Bool != false else { throw Failure.invalid }
        return result
    }
    private func verify(_ scope: Scope) async throws {
        let manifest = try await request(scope, LopuVoiceContract.manifestPath, authenticated: false)
        guard Self.requirements.allSatisfy({ LopuVoiceContract.accepts(manifest, baseURL: scope.origin, feature: $0.key, minimum: $0.value) }) else { throw Failure.incompatible }
        try await verifyIdentity(scope)
    }
    func verifyIdentity(_ scope: Scope) async throws {
        let identity = try await request(scope, "/api/v1/auth/me")
        guard let user = identity["user"] as? [String: Any], user["id"] as? String == scope.ownerId,
              user["accountKind"] as? String == "user", user["temporary"] as? Bool != true else { throw Failure.identity }
    }
    private func record(_ scope: Scope) throws -> Record? {
        let value = try load(scope)
        guard value == nil || value?.scope == scope else { throw Failure.identity }
        if let value {
            guard value.privateKey.count == 32, value.revision >= 0, value.revision < 9_007_199_254_740_991,
                  value.completeBody.map({ $0.count <= 32 * 1024 }) ?? true else { throw Failure.invalid }
        }
        return value
    }
    func status(_ scope: Scope, battery: [String: Any] = [:]) async throws -> Status {
        try await verify(scope)
        guard var value = try record(scope) else { return Status(state: "unpaired", deviceId: nil) }
        if value.revoked { return Status(state: "revoked", deviceId: nil) }
        guard let deviceId = value.deviceId else { return Status(state: "pending", deviceId: nil) }
        // Persist the monotonic revision before sending. A lost acknowledgement can
        // be superseded by a newer observation; it never starts a second pairing.
        value.revision = max(value.revision + 1, Int64(Date().timeIntervalSince1970 * 1000))
        try save(value)
        var state: [String: Any] = ["locked": false]
        if !battery.isEmpty { state["battery"] = battery }
        let snapshot: [String: Any] = ["revision": value.revision, "capabilities": [String](), "connectors": [String](), "state": state]
        do {
            _ = try await request(scope, "/api/v1/devices/node/state", body: Self.json(snapshot), credential: value.credential)
        } catch Failure.revoked {
            value.revoked = true; try save(value)
            return Status(state: "revoked", deviceId: nil)
        }
        return Status(state: "paired", deviceId: deviceId)
    }
    func pair(_ scope: Scope, descriptor: [String: String]) async throws -> Status {
        try await verify(scope)
        var value = try record(scope)
        if value?.deviceId != nil && value?.revoked == false { return try await status(scope) }
        // Once complete is persisted, expiry is not permission to create a new
        // claim: the server may already have accepted those exact bytes.
        if value == nil || value!.revoked || (value!.completeBody == nil && value!.expiresAt <= Date()) {
            let session = try await request(scope, "/api/v1/devices/pairing", body: Self.json([:]))
            guard session["ownerId"] as? String == scope.ownerId,
                  let pairing = session["pairing"] as? [String: Any],
                  let secret = pairing["pairingSecret"] as? String, secret.range(of: "^ttpair_[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
                  let expiry = pairing["expiresAt"] as? String, let date = Self.date(expiry), date > Date() else { throw Failure.invalid }
            let key = Curve25519.Signing.PrivateKey()
            value = Record(scope: scope, privateKey: key.rawRepresentation, nonce: Self.base64(try Self.random()),
                           credential: "ttnode_" + Self.base64(try Self.random()), pairingSecret: secret, expiresAt: date)
            try save(value!)
        }
        var pending = value!
        if pending.completeBody == nil {
            let publicKey = Self.base64(try Curve25519.Signing.PrivateKey(rawRepresentation: pending.privateKey).publicKey.rawRepresentation)
            let prepared = try await request(scope, "/api/v1/devices/pairing/claim", body: Self.json([
                "op": "prepare", "pairingSecret": pending.pairingSecret, "publicKey": publicKey, "nonce": pending.nonce
            ]), authenticated: false)
            guard let proof = prepared["proof"] as? [String: Any], let pairingId = proof["pairingId"] as? String,
                  !pairingId.isEmpty, pairingId.utf8.count <= 256, let nonce = proof["serverNonce"] as? String,
                  nonce.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil,
                  let expiry = proof["expiresAt"] as? String, let date = Self.date(expiry), date > Date() else { throw Failure.invalid }
            let device = try Self.descriptor(descriptor)
            let fields = ["thingtime-device-pairing-claim-v1", pairingId, pending.pairingSecret, pending.credential,
                          publicKey, pending.nonce, nonce, device["name"]!, "ios", device["model"] ?? "",
                          device["osVersion"]!, device["appVersion"]!, "0"]
            let signature = try Curve25519.Signing.PrivateKey(rawRepresentation: pending.privateKey).signature(for: Self.message(fields))
            pending.completeBody = try Self.json([
                "op": "complete", "pairingSecret": pending.pairingSecret, "credential": pending.credential,
                "device": device, "capabilities": [], "proof": ["pairingId": pairingId, "publicKey": publicKey,
                    "nonce": pending.nonce, "serverNonce": nonce, "signature": Self.base64(signature)]
            ])
            try save(pending)
        }
        try await verifyIdentity(scope)
        let completed = try await request(scope, "/api/v1/devices/pairing/claim", body: pending.completeBody, authenticated: false)
        guard completed["credentialStored"] as? Bool == true,
              let device = completed["device"] as? [String: Any], let id = device["id"] as? String,
              !id.isEmpty, id.utf8.count <= 512, device["platform"] as? String == "ios" else { throw Failure.invalid }
        pending.deviceId = id
        try save(pending)
        return try await status(scope)
    }
    static func json(_ object: [String: Any]) throws -> Data { try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) }
    static func base64(_ data: Data) -> String { data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
    static func message(_ fields: [String]) -> Data { fields.reduce(into: Data()) { result, field in result.append(Data("\(field.utf8.count):\(field)".utf8)) } }
    static func date(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
    static func descriptor(_ source: [String: String]) throws -> [String: String] {
        var result = ["platform": "ios"]
        for (name, limit) in [("name",120),("model",160),("osVersion",80),("appVersion",80)] {
            let trimmed = (source[name] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            var units = 0, output = ""
            for scalar in trimmed.unicodeScalars {
                let width = scalar.value > 0xffff ? 2 : 1
                if units + width > limit { break }; units += width; output.unicodeScalars.append(scalar)
            }
            if name != "model" && output.isEmpty { throw Failure.invalid }
            result[name] = output
        }
        return result
    }
    private static func random() throws -> Data {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw Failure.storage }
        return Data(bytes)
    }
}

@MainActor
enum MobileDeviceKeychain {
    private static func query(_ scope: MobileDevicePairing.Scope) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.thingtime.mobile-device.v1",
         kSecAttrAccount as String: scope.key, kSecAttrSynchronizable as String: false]
    }
    static func load(_ scope: MobileDevicePairing.Scope) throws -> MobileDevicePairing.Record? {
        var q = query(scope); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else { throw MobileDevicePairing.Failure.storage }
        return try JSONDecoder().decode(MobileDevicePairing.Record.self, from: data)
    }
    static func save(_ value: MobileDevicePairing.Record) throws {
        let data = try JSONEncoder().encode(value)
        var q = query(value.scope); q[kSecValueData as String] = data
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(q as CFDictionary, nil)
        if status == errSecDuplicateItem {
            guard SecItemUpdate(query(value.scope) as CFDictionary, [kSecValueData as String: data] as CFDictionary) == errSecSuccess else { throw MobileDevicePairing.Failure.storage }
        } else if status != errSecSuccess { throw MobileDevicePairing.Failure.storage }
    }
}
