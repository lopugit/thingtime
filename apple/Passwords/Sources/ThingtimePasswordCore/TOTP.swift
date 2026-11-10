import Foundation
import CryptoKit
public enum TOTP {
    public static func code(_ input: String, at date: Date = Date()) throws -> String {
        var secret = input.trimmingCharacters(in: .whitespacesAndNewlines), algorithm = "SHA1", digits = 6, period = 30
        if secret.contains(":") {
            guard let url = URLComponents(string: secret), url.scheme == "otpauth", url.host == "totp", url.user == nil, url.password == nil, url.port == nil, url.fragment == nil else { throw PasswordProviderError.invalidCredential }
            let items = url.queryItems ?? []
            guard Set(items.map(\.name)).count == items.count else { throw PasswordProviderError.invalidCredential }
            func value(_ name: String) -> String? { items.first { $0.name == name }?.value }
            secret = value("secret") ?? ""; algorithm = (value("algorithm") ?? "SHA1").uppercased()
            guard let d = Int(value("digits") ?? "6"), let p = Int(value("period") ?? "30"), [6, 8].contains(d), (15...120).contains(p) else { throw PasswordProviderError.invalidCredential }
            digits = d; period = p
        }
        let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"), chars = secret.uppercased().filter { !$0.isWhitespace }
        let normalized = String(chars).replacingOccurrences(of: "=+$", with: "", options: .regularExpression)
        guard (16...1024).contains(normalized.count), ["SHA1", "SHA256", "SHA512"].contains(algorithm), date.timeIntervalSince1970 >= 0 else { throw PasswordProviderError.invalidCredential }
        var buffer: UInt32 = 0, bits = 0, bytes = Data()
        for char in normalized {
            guard let value = alphabet.firstIndex(of: char) else { throw PasswordProviderError.invalidCredential }
            buffer = (buffer << 5) | UInt32(value); bits += 5
            if bits >= 8 { bits -= 8; bytes.append(UInt8((buffer >> bits) & 255)) }
        }
        guard buffer & ((1 << bits) - 1) == 0 else { throw PasswordProviderError.invalidCredential }
        defer { bytes.resetBytes(in: 0..<bytes.count) }
        var counter = UInt64(date.timeIntervalSince1970 / Double(period)).bigEndian
        let message = withUnsafeBytes(of: &counter) { Data($0) }, key = SymmetricKey(data: bytes)
        let hash: Data
        switch algorithm {
        case "SHA256": hash = Data(HMAC<SHA256>.authenticationCode(for: message, using: key))
        case "SHA512": hash = Data(HMAC<SHA512>.authenticationCode(for: message, using: key))
        default: hash = Data(HMAC<Insecure.SHA1>.authenticationCode(for: message, using: key))
        }
        let offset = Int(hash.last! & 15)
        let value = (UInt32(hash[offset] & 127) << 24) | (UInt32(hash[offset + 1]) << 16) | (UInt32(hash[offset + 2]) << 8) | UInt32(hash[offset + 3])
        return String(format: "%0*u", digits, value % (digits == 8 ? 100_000_000 : 1_000_000))
    }
}
