import Foundation
import CryptoKit

public struct FileSyncOwnerScope: Codable, Equatable, Sendable {
    public let ownerId: String
    public let origin: URL
    public init(ownerId: String, url: URL) throws {
        guard !ownerId.isEmpty, ownerId.utf8.count <= 128,
              var c = URLComponents(url: url, resolvingAgainstBaseURL: false),
              c.user == nil, c.password == nil, let host = c.host else { throw Failure.identity }
        let loopback = ["localhost", "127.0.0.1", "::1"].contains(host.lowercased())
        guard c.scheme == "https" || (c.scheme == "http" && loopback) else { throw Failure.destination }
        c.host = host.lowercased(); c.path = ""; c.query = nil; c.fragment = nil
        if (c.scheme == "https" && c.port == 443) || (c.scheme == "http" && c.port == 80) { c.port = nil }
        guard let origin = c.url else { throw Failure.destination }
        self.ownerId = ownerId; self.origin = origin
    }
    public var key: String {
        SHA256.hash(data: Data("\(origin.absoluteString)\u{0}\(ownerId)".utf8)).map { String(format: "%02x", $0) }.joined()
    }
    public enum Failure: Error, LocalizedError {
        case identity, destination
        public var errorDescription: String? {
            switch self {
            case .identity: return "Your account changed. Reopen Things and try again."
            case .destination: return "Choose a supported HTTPS or loopback destination."
            }
        }
    }
}
