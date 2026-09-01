import CryptoKit
import Foundation
import Security

public struct DeviceCredential: Codable, Equatable, Sendable {
    public let deviceID: String
    public let refreshToken: String
    public let signingPrivateKey: Data
    public let signingPublicKey: Data
    public let issuedAt: Date

    public init(
        deviceID: String,
        refreshToken: String,
        signingPrivateKey: Data,
        signingPublicKey: Data,
        issuedAt: Date = Date()
    ) {
        self.deviceID = deviceID
        self.refreshToken = refreshToken
        self.signingPrivateKey = signingPrivateKey
        self.signingPublicKey = signingPublicKey
        self.issuedAt = issuedAt
    }
}

public protocol DeviceCredentialStore: Sendable {
    func load() async throws -> DeviceCredential?
    func loadAll() async throws -> [DeviceCredential]
    func save(_ credential: DeviceCredential) async throws
    func delete() async throws
    func loadPendingPairingClaim() async throws -> PendingPairingClaim?
    func savePendingPairingClaim(_ claim: PendingPairingClaim) async throws
    func deletePendingPairingClaim() async throws
}

public extension DeviceCredentialStore {
    func loadAll() async throws -> [DeviceCredential] {
        if let credential = try await load() { return [credential] }
        return []
    }
}

public final class KeychainDeviceCredentialStore: DeviceCredentialStore, @unchecked Sendable {
    private struct CredentialVault: Codable {
        let schemaVersion: Int
        var credentials: [DeviceCredential]
    }

    private static let maximumCredentials = 32
    private let service: String
    private let account: String
    private let legacyAccount: String?
    private let pendingPairingAccount: String
    private let legacyPendingPairingAccount: String?

    public init(
        service: String = "com.thingtime.desktop.node",
        account: String = "device-credential-v1",
        legacyAccount: String? = nil
    ) {
        self.service = service
        self.account = account
        self.legacyAccount = legacyAccount == account ? nil : legacyAccount
        pendingPairingAccount = account + ".pending-pairing-claim-v1"
        legacyPendingPairingAccount = self.legacyAccount.map { $0 + ".pending-pairing-claim-v1" }
    }

    public func load() async throws -> DeviceCredential? {
        try await loadAll().first
    }

    public func loadAll() async throws -> [DeviceCredential] {
        if let credentials = try loadCredentials(account: account) { return credentials }
        guard let legacyAccount,
              let credentials = try loadCredentials(account: legacyAccount) else { return [] }
        try saveCredentials(credentials, account: account)
        try delete(account: legacyAccount)
        return credentials
    }

    public func save(_ credential: DeviceCredential) async throws {
        var credentials = try await loadAll()
        if let index = credentials.firstIndex(where: { $0.deviceID == credential.deviceID }) {
            credentials[index] = credential
        } else {
            guard credentials.count < Self.maximumCredentials else {
                throw ThingtimeNodeError.invalidRequest("This Mac already has the maximum number of paired Thingtime accounts.")
            }
            credentials.append(credential)
        }
        try saveCredentials(credentials, account: account)
    }

    public func delete() async throws {
        try delete(account: account)
        if let legacyAccount { try delete(account: legacyAccount) }
    }

    public func loadPendingPairingClaim() async throws -> PendingPairingClaim? {
        if let claim = try load(PendingPairingClaim.self, account: pendingPairingAccount) { return claim }
        guard let legacyPendingPairingAccount,
              let claim = try load(PendingPairingClaim.self, account: legacyPendingPairingAccount) else { return nil }
        try save(claim, account: pendingPairingAccount)
        try delete(account: legacyPendingPairingAccount)
        return claim
    }

    public func savePendingPairingClaim(_ claim: PendingPairingClaim) async throws {
        try save(claim, account: pendingPairingAccount)
    }

    public func deletePendingPairingClaim() async throws {
        try delete(account: pendingPairingAccount)
        if let legacyPendingPairingAccount { try delete(account: legacyPendingPairingAccount) }
    }

    private func load<Value: Decodable>(_ type: Value.Type, account: String) throws -> Value? {
        guard let data = try loadData(account: account) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(Value.self, from: data)
    }

    private func loadData(account: String) throws -> Data? {
        var query = baseQuery(account: account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data else {
            throw KeychainError(status: status)
        }
        return data
    }

    private func loadCredentials(account: String) throws -> [DeviceCredential]? {
        guard let data = try loadData(account: account) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        if let vault = try? decoder.decode(CredentialVault.self, from: data), vault.schemaVersion == 1 {
            return try Self.normalized(vault.credentials)
        }
        let legacy = try decoder.decode(DeviceCredential.self, from: data)
        let credentials = [legacy]
        try saveCredentials(credentials, account: account)
        return credentials
    }

    private func saveCredentials(_ credentials: [DeviceCredential], account: String) throws {
        let normalized = try Self.normalized(credentials)
        try save(CredentialVault(schemaVersion: 1, credentials: normalized), account: account)
    }

    private static func normalized(_ credentials: [DeviceCredential]) throws -> [DeviceCredential] {
        guard credentials.count <= maximumCredentials else {
            throw ThingtimeNodeError.invalidRequest("The paired Thingtime account vault is too large.")
        }
        var seen = Set<String>()
        return credentials.filter { credential in
            !credential.deviceID.isEmpty && seen.insert(credential.deviceID).inserted
        }
    }

    private func save<Value: Encodable>(_ value: Value, account: String) throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(value)
        var add = baseQuery(account: account)
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(add as CFDictionary, nil)
        if status == errSecDuplicateItem {
            let updateStatus = SecItemUpdate(
                baseQuery(account: account) as CFDictionary,
                [kSecValueData as String: data] as CFDictionary
            )
            guard updateStatus == errSecSuccess else { throw KeychainError(status: updateStatus) }
        } else if status != errSecSuccess {
            throw KeychainError(status: status)
        }
    }

    private func delete(account: String) throws {
        let status = SecItemDelete(baseQuery(account: account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError(status: status)
        }
    }

    func baseQuery(account: String) -> [String: Any] {
        // This is a macOS-only agent signed outside Xcode. The Data Protection
        // Keychain requires an application-identifier/keychain access-group
        // entitlement authorized by a provisioning profile; a manually signed
        // Developer ID or Apple Development bundle otherwise fails every write
        // with errSecMissingEntitlement (-34018). The traditional macOS login
        // keychain remains encrypted and binds access to this stable signed app.
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }
}

public struct KeychainError: Error, LocalizedError, Equatable {
    public let status: OSStatus

    public var errorDescription: String? {
        SecCopyErrorMessageString(status, nil) as String? ?? "Keychain error \(status)."
    }
}

public actor InMemoryDeviceCredentialStore: DeviceCredentialStore {
    private var credentials: [DeviceCredential]
    private var pendingPairingClaim: PendingPairingClaim?

    public init(credential: DeviceCredential? = nil, pendingPairingClaim: PendingPairingClaim? = nil) {
        credentials = credential.map { [$0] } ?? []
        self.pendingPairingClaim = pendingPairingClaim
    }

    public init(credentials: [DeviceCredential], pendingPairingClaim: PendingPairingClaim? = nil) {
        self.credentials = credentials
        self.pendingPairingClaim = pendingPairingClaim
    }

    public func load() async throws -> DeviceCredential? { credentials.first }
    public func loadAll() async throws -> [DeviceCredential] { credentials }
    public func save(_ credential: DeviceCredential) async throws {
        if let index = credentials.firstIndex(where: { $0.deviceID == credential.deviceID }) {
            credentials[index] = credential
        } else {
            credentials.append(credential)
        }
    }
    public func delete() async throws { credentials = [] }
    public func loadPendingPairingClaim() async throws -> PendingPairingClaim? { pendingPairingClaim }
    public func savePendingPairingClaim(_ claim: PendingPairingClaim) async throws { pendingPairingClaim = claim }
    public func deletePendingPairingClaim() async throws { pendingPairingClaim = nil }
}

public struct PendingPairingClaim: Codable, Equatable, Sendable {
    public let pairingSecret: String
    public let credential: String
    public let signingPrivateKey: Data
    public let signingPublicKey: Data
    public let nonce: Data
    public let createdAt: Date
    public let expiresAt: Date
    public var completeRequest: PairingClaimRequest?

    public init(
        pairingSecret: String,
        credential: String,
        signingPrivateKey: Data,
        signingPublicKey: Data,
        nonce: Data,
        createdAt: Date,
        expiresAt: Date,
        completeRequest: PairingClaimRequest? = nil
    ) {
        self.pairingSecret = pairingSecret
        self.credential = credential
        self.signingPrivateKey = signingPrivateKey
        self.signingPublicKey = signingPublicKey
        self.nonce = nonce
        self.createdAt = createdAt
        self.expiresAt = expiresAt
        self.completeRequest = completeRequest
    }
}

public struct PairingChallenge: Codable, Equatable, Sendable {
    public let pairingID: String
    public let publicKey: Data
    public let nonce: Data
    public let expiresAt: Date

    public init(pairingID: String, publicKey: Data, nonce: Data, expiresAt: Date) {
        self.pairingID = pairingID
        self.publicKey = publicKey
        self.nonce = nonce
        self.expiresAt = expiresAt
    }
}

public struct PairingStatus: Codable, Equatable, Sendable {
    public let paired: Bool
    public let deviceID: String?
    public let deviceIDs: [String]

    public init(paired: Bool, deviceID: String?, deviceIDs: [String]? = nil) {
        self.paired = paired
        self.deviceID = deviceID
        self.deviceIDs = deviceIDs ?? deviceID.map { [$0] } ?? []
    }
}

public actor PairingManager {
    private let store: any DeviceCredentialStore

    public init(store: any DeviceCredentialStore) {
        self.store = store
    }

    public func status() async throws -> PairingStatus {
        let credentials = try await store.loadAll()
        let deviceIDs = credentials.map(\.deviceID)
        return PairingStatus(paired: !deviceIDs.isEmpty, deviceID: deviceIDs.first, deviceIDs: deviceIDs)
    }

    public func credentials() async throws -> [DeviceCredential] {
        try await store.loadAll()
    }

    public func begin(
        pairingID suppliedPairingID: String? = nil,
        now: Date = Date(),
        lifetime: TimeInterval = 10 * 60
    ) async throws -> PairingChallenge {
        guard lifetime > 0, lifetime <= 60 * 60 else {
            throw ThingtimeNodeError.invalidRequest("Pairing lifetime must be between 1 second and 1 hour.")
        }
        let identifier: String
        if let suppliedPairingID {
            let normalized = suppliedPairingID.trimmingCharacters(in: .whitespacesAndNewlines)
            guard Self.isServerPairingSecret(normalized) else {
                throw ThingtimeNodeError.invalidRequest("The pairing secret is invalid.")
            }
            identifier = normalized
        } else {
            identifier = UUID().uuidString
        }

        if let pending = try await store.loadPendingPairingClaim() {
            if pending.completeRequest == nil, pending.expiresAt <= now {
                try await store.deletePendingPairingClaim()
            } else if suppliedPairingID != nil,
                      !Self.isServerPairingSecret(pending.pairingSecret),
                      pending.completeRequest == nil {
                let rebound = PendingPairingClaim(
                    pairingSecret: identifier,
                    credential: pending.credential,
                    signingPrivateKey: pending.signingPrivateKey,
                    signingPublicKey: pending.signingPublicKey,
                    nonce: pending.nonce,
                    createdAt: pending.createdAt,
                    expiresAt: now.addingTimeInterval(lifetime)
                )
                try await store.savePendingPairingClaim(rebound)
                return PairingChallenge(
                    pairingID: rebound.pairingSecret,
                    publicKey: rebound.signingPublicKey,
                    nonce: rebound.nonce,
                    expiresAt: rebound.expiresAt
                )
            } else {
                guard pending.pairingSecret == identifier else {
                    throw ThingtimeNodeError.invalidRequest("Another pairing claim is pending and must be reconciled first.")
                }
                return PairingChallenge(
                    pairingID: pending.pairingSecret,
                    publicKey: pending.signingPublicKey,
                    nonce: pending.nonce,
                    expiresAt: pending.expiresAt
                )
            }
        }
        let privateKey = Curve25519.Signing.PrivateKey()
        let credential = try Self.secureToken(prefix: "ttnode_", byteCount: 32)
        let nonce = try Self.secureRandomData(byteCount: 32)
        let expiresAt = now.addingTimeInterval(lifetime)
        try await store.savePendingPairingClaim(PendingPairingClaim(
            pairingSecret: identifier,
            credential: credential,
            signingPrivateKey: privateKey.rawRepresentation,
            signingPublicKey: privateKey.publicKey.rawRepresentation,
            nonce: nonce,
            createdAt: now,
            expiresAt: expiresAt
        ))
        return PairingChallenge(
            pairingID: identifier,
            publicKey: privateKey.publicKey.rawRepresentation,
            nonce: nonce,
            expiresAt: expiresAt
        )
    }

    public func preparedClaim(pairingID: String) async throws -> PairingClaimRequest? {
        guard let pending = try await store.loadPendingPairingClaim(), pending.pairingSecret == pairingID else {
            throw ThingtimeNodeError.invalidRequest("The pairing challenge is missing.")
        }
        return pending.completeRequest
    }

    public func hasRecoverablePairing(now: Date = Date()) async throws -> Bool {
        guard let pending = try await store.loadPendingPairingClaim(),
              Self.isServerPairingSecret(pending.pairingSecret) else {
            return false
        }
        return pending.completeRequest != nil || pending.expiresAt > now
    }

    func pendingPairingSecretForResume(now: Date = Date()) async throws -> String {
        guard let pending = try await store.loadPendingPairingClaim(),
              Self.isServerPairingSecret(pending.pairingSecret),
              pending.completeRequest != nil || pending.expiresAt > now else {
            throw ThingtimeNodeError.invalidRequest("No recoverable pairing claim is pending.")
        }
        return pending.pairingSecret
    }

    func clearCompletedClaimForResume() async throws {
        guard let pending = try await store.loadPendingPairingClaim() else { return }
        let credentials = try await store.loadAll()
        guard let credential = credentials.first(where: { $0.refreshToken == pending.completeRequest?.credential }),
              pending.completeRequest?.credential == credential.refreshToken,
              pending.signingPrivateKey == credential.signingPrivateKey,
              pending.signingPublicKey == credential.signingPublicKey else {
            throw ThingtimeNodeError.invalidRequest("The completed credential does not match the pending pairing claim.")
        }
        try await store.deletePendingPairingClaim()
    }

    public func bindPreparedClaim(
        pairingID: String,
        serverProof: PairingPrepareResponse,
        device: PairingDeviceDescriptor,
        capabilities: [String],
        now: Date = Date()
    ) async throws -> PairingClaimRequest {
        guard var pending = try await store.loadPendingPairingClaim(), pending.pairingSecret == pairingID else {
            throw ThingtimeNodeError.invalidRequest("The pairing challenge is missing.")
        }
        if let completeRequest = pending.completeRequest { return completeRequest }
        guard pending.expiresAt > now, serverProof.expiresAt > now,
              serverProof.serverNonce.count == 32,
              !serverProof.pairingID.isEmpty,
              serverProof.pairingID.utf8.count <= 256 else {
            throw ThingtimeNodeError.invalidRequest("The server pairing proof is invalid or expired.")
        }
        let normalizedDevice = try Self.normalized(device)
        let normalizedCapabilities = try Self.normalized(capabilities)
        let message = PairingClaimProof.canonicalMessage(
            pairingID: serverProof.pairingID,
            pairingSecret: pending.pairingSecret,
            credential: pending.credential,
            publicKey: pending.signingPublicKey,
            nonce: pending.nonce,
            serverNonce: serverProof.serverNonce,
            device: normalizedDevice,
            capabilities: normalizedCapabilities
        )
        let privateKey = try Curve25519.Signing.PrivateKey(rawRepresentation: pending.signingPrivateKey)
        let signature = try privateKey.signature(for: message)
        let request = PairingClaimRequest(
            pairingSecret: pending.pairingSecret,
            credential: pending.credential,
            device: normalizedDevice,
            capabilities: normalizedCapabilities,
            proof: PairingClaimProof(
                pairingID: serverProof.pairingID,
                publicKey: pending.signingPublicKey,
                nonce: pending.nonce,
                serverNonce: serverProof.serverNonce,
                signature: signature
            )
        )
        pending.completeRequest = request
        try await store.savePendingPairingClaim(pending)
        return request
    }

    public func complete(
        pairingID: String,
        deviceID: String,
        refreshToken: String,
        now: Date = Date()
    ) async throws -> PairingStatus {
        guard let pairing = try await store.loadPendingPairingClaim(),
              pairing.pairingSecret == pairingID,
              pairing.completeRequest != nil else {
            throw ThingtimeNodeError.invalidRequest("The pairing challenge is missing or expired.")
        }
        guard !deviceID.isEmpty, deviceID.utf8.count <= 512 else {
            throw ThingtimeNodeError.invalidRequest("The deviceID is invalid.")
        }
        guard !refreshToken.isEmpty, refreshToken.utf8.count <= 65_536 else {
            throw ThingtimeNodeError.invalidRequest("The device credential is invalid.")
        }
        guard refreshToken == pairing.credential else {
            throw ThingtimeNodeError.invalidRequest("The device credential does not match the pending pairing claim.")
        }
        let credential = DeviceCredential(
            deviceID: deviceID,
            refreshToken: refreshToken,
            signingPrivateKey: pairing.signingPrivateKey,
            signingPublicKey: pairing.signingPublicKey,
            issuedAt: now
        )
        try await store.save(credential)
        return try await status()
    }

    public func clearCompletedClaim(pairingID: String) async throws {
        guard let pending = try await store.loadPendingPairingClaim() else { return }
        guard pending.pairingSecret == pairingID else {
            throw ThingtimeNodeError.invalidRequest("The pending pairing claim does not match.")
        }
        try await store.deletePendingPairingClaim()
    }

    public func cancelClaim(pairingID: String) async throws {
        guard let pending = try await store.loadPendingPairingClaim() else { return }
        guard pending.pairingSecret == pairingID else { return }
        try await store.deletePendingPairingClaim()
    }

    public func unpair() async throws -> PairingStatus {
        try await store.deletePendingPairingClaim()
        try await store.delete()
        return PairingStatus(paired: false, deviceID: nil)
    }

    private static func normalized(_ device: PairingDeviceDescriptor) throws -> PairingDeviceDescriptor {
        let name = bounded(device.name, utf16Units: 120)
        let platform = bounded(device.platform, utf16Units: 32)
        let model = device.model.map { bounded($0, utf16Units: 160) }
        let osVersion = bounded(device.osVersion, utf16Units: 80)
        let appVersion = bounded(device.appVersion, utf16Units: 80)
        guard !name.isEmpty, platform == "macos", !osVersion.isEmpty, !appVersion.isEmpty else {
            throw ThingtimeNodeError.invalidRequest("The pairing device descriptor is invalid.")
        }
        return PairingDeviceDescriptor(
            name: name,
            platform: platform,
            model: model?.isEmpty == true ? nil : model,
            osVersion: osVersion,
            appVersion: appVersion
        )
    }

    private static func isServerPairingSecret(_ value: String) -> Bool {
        let suffix = value.dropFirst("ttpair_".utf8.count)
        return value.hasPrefix("ttpair_") && suffix.utf8.count == 43 && suffix.utf8.allSatisfy {
            ($0 >= 48 && $0 <= 57) || ($0 >= 65 && $0 <= 90) || ($0 >= 97 && $0 <= 122) || $0 == 45 || $0 == 95
        }
    }

    /// Keeps the signed descriptor inside the server's JavaScript string
    /// bounds without ever splitting an extended Unicode scalar.
    private static func bounded(_ value: String, utf16Units limit: Int) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        var units = 0
        var scalars = String.UnicodeScalarView()
        for scalar in trimmed.unicodeScalars {
            let width = scalar.value > 0xFFFF ? 2 : 1
            guard units + width <= limit else { break }
            scalars.append(scalar)
            units += width
        }
        return String(scalars)
    }

    private static func normalized(_ capabilities: [String]) throws -> [String] {
        let normalized = Array(Set(capabilities)).sorted()
        guard normalized.count <= 64, normalized.allSatisfy({ capability in
            !capability.isEmpty && capability.utf8.count <= 80 && capability.utf8.allSatisfy {
                ($0 >= 48 && $0 <= 57) || ($0 >= 65 && $0 <= 90) || ($0 >= 97 && $0 <= 122) || $0 == 45 || $0 == 46 || $0 == 95
            }
        }) else {
            throw ThingtimeNodeError.invalidRequest("The pairing capabilities are invalid.")
        }
        return normalized
    }

    private static func secureRandomData(byteCount: Int) throws -> Data {
        var bytes = [UInt8](repeating: 0, count: byteCount)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw ThingtimeNodeError.invalidRequest("Secure pairing material could not be generated.")
        }
        return Data(bytes)
    }

    private static func secureToken(prefix: String, byteCount: Int) throws -> String {
        prefix + (try secureRandomData(byteCount: byteCount)).base64URLEncodedString()
    }
}

extension Data {
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    init?(base64URLUnpadded value: String) {
        guard !value.isEmpty,
              value.utf8.allSatisfy({
                  ($0 >= 48 && $0 <= 57) || ($0 >= 65 && $0 <= 90) || ($0 >= 97 && $0 <= 122) || $0 == 45 || $0 == 95
              }) else { return nil }
        let remainder = value.utf8.count % 4
        guard remainder != 1 else { return nil }
        let padding = remainder == 0 ? "" : String(repeating: "=", count: 4 - remainder)
        self.init(base64Encoded: value
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/") + padding)
    }
}
