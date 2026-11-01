import Foundation
import CryptoKit
public struct PasskeyMaterial: Sendable {
    public let relyingParty: String
    public let credentialID: Data
    public let userHandle: Data
    public let privateKey: Data
    public let username: String
    public init(relyingParty: String, userHandle: Data, username: String) throws {
        guard Self.validRP(relyingParty), !userHandle.isEmpty, userHandle.count <= 64 else { throw PasswordProviderError.invalidCredential }
        self.relyingParty = relyingParty; self.userHandle = userHandle; self.username = username
        self.privateKey = P256.Signing.PrivateKey().rawRepresentation
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw PasswordProviderError.unavailable }
        self.credentialID = Data(bytes)
    }
    public init(entry: PasswordEntry) throws {
        let rp = entry.value("relyingParty")
        guard entry.passwordType == "passkey", Self.validRP(rp), let key = Data(base64URL: entry.value("privateKey")), key.count == 32,
              let credential = Data(base64URL: entry.value("credentialId")), credential.count == 32,
              let user = Data(base64URL: entry.value("userHandle")), !user.isEmpty, user.count <= 64 else { throw PasswordProviderError.invalidCredential }
        _ = try P256.Signing.PrivateKey(rawRepresentation: key)
        self.relyingParty = rp; self.privateKey = key; self.credentialID = credential; self.userHandle = user; self.username = entry.value("username")
    }
    public static func validRP(_ rp: String) -> Bool {
        guard !rp.isEmpty, rp.count <= 253, !rp.contains(":"), !rp.contains("/"), !rp.hasPrefix("."), !rp.hasSuffix(".") else { return false }
        return rp.unicodeScalars.allSatisfy { CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-.").contains($0) }
    }
    public var entry: PasswordEntry {
        PasswordEntry(title: "\(relyingParty) · \(username)", passwordType: "passkey", fields: [
            PasswordField("username", "Username", "text", username), PasswordField("website", "Website", "url", "https://\(relyingParty)"),
            PasswordField("relyingParty", "Relying party", "text", relyingParty), PasswordField("credentialId", "Credential id", "text", credentialID.base64URL),
            PasswordField("userHandle", "User handle", "text", userHandle.base64URL), PasswordField("privateKey", "Passkey private key", "password", privateKey.base64URL)
        ])
    }
    private func authenticatorData(attested: Bool) throws -> Data {
        // User presence + verification are only asserted after the extension's
        // LocalAuthentication succeeds. Synced credentials set BE and BS; a
        // zero signature counter is the WebAuthn contract for multi-device keys.
        var data = Data(SHA256.hash(data: Data(relyingParty.utf8)))
        data.append(attested ? 0x5d : 0x1d); data.append(contentsOf: [0, 0, 0, 0])
        if attested {
            data.append(Data(repeating: 0, count: 16)) // no vendor attestation
            data.append(contentsOf: [0, UInt8(credentialID.count)]); data.append(credentialID)
            let publicKey = try P256.Signing.PrivateKey(rawRepresentation: privateKey).publicKey.x963Representation
            // COSE EC2 / ES256 / P-256, x and y.
            data.append(CBOR.map([(CBOR.integer(1), CBOR.integer(2)), (CBOR.integer(3), CBOR.integer(-7)),
                (CBOR.integer(-1), CBOR.integer(1)), (CBOR.integer(-2), CBOR.bytes(publicKey.subdata(in: 1..<33))),
                (CBOR.integer(-3), CBOR.bytes(publicKey.subdata(in: 33..<65)))]))
        }
        return data
    }
    public func registration() throws -> Data {
        CBOR.map([(CBOR.text("fmt"), CBOR.text("none")), (CBOR.text("attStmt"), CBOR.map([])), (CBOR.text("authData"), CBOR.bytes(try authenticatorData(attested: true)))])
    }
    public func assertion(clientDataHash: Data, relyingParty: String) throws -> (authenticatorData: Data, signature: Data) {
        guard clientDataHash.count == 32, relyingParty == self.relyingParty else { throw PasswordProviderError.invalidCredential }
        let data = try authenticatorData(attested: false)
        let signature = try P256.Signing.PrivateKey(rawRepresentation: privateKey).signature(for: data + clientDataHash)
        return (data, signature.derRepresentation)
    }
}
import Security
// Closed encoder for the authenticator's own bounded WebAuthn structures.
enum CBOR {
    static func head(_ major: UInt8, _ count: Int) -> Data {
        if count < 24 { return Data([major << 5 | UInt8(count)]) }
        if count < 256 { return Data([major << 5 | 24, UInt8(count)]) }
        return Data([major << 5 | 25, UInt8(count >> 8), UInt8(count & 255)])
    }
    static func integer(_ value: Int) -> Data { head(value >= 0 ? 0 : 1, value >= 0 ? value : -value - 1) }
    static func text(_ value: String) -> Data { let data = Data(value.utf8); return head(3, data.count) + data }
    static func bytes(_ value: Data) -> Data { head(2, value.count) + value }
    static func map(_ values: [(Data, Data)]) -> Data { values.reduce(head(5, values.count)) { $0 + $1.0 + $1.1 } }
}
