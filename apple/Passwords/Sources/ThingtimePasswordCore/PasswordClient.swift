import Foundation
private final class NoRedirect: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
public struct PasswordCatalogItem: Codable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public let username: String
    public let domains: [String]
    public let hasPassword: Bool
    public let hasTotp: Bool
    public let relyingParty: String?
    public let credentialId: String?
    public let userHandle: String?
}
public final class PasswordClient: @unchecked Sendable {
    public let account: ProviderSession
    private let transport: URLSession
    public init(account: ProviderSession) {
        self.account = account
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil; configuration.urlCache = nil; configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 25; configuration.timeoutIntervalForResource = 40
        transport = URLSession(configuration: configuration, delegate: NoRedirect(), delegateQueue: nil)
    }
    deinit { transport.invalidateAndCancel() }
    private struct Reply: Decodable {
        let ok: Bool
        let ownerId: String?
        let entries: [PasswordRecord]?
        let catalog: [PasswordCatalogItem]?
        let nextCursor: String?
        let record: PasswordRecord?
        let id: String?
        let revision: Int?
        let entry: PasswordEntry?
    }
    private func call(_ body: [String: Any]) async throws -> Reply {
        var request = URLRequest(url: account.origin.appendingPathComponent("api/v1/passwords"))
        request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(account.cookie, forHTTPHeaderField: "Cookie"); request.setValue(account.origin.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), forHTTPHeaderField: "Origin")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        var content = body; content["expectedOwnerId"] = account.ownerId
        request.httpBody = try JSONSerialization.data(withJSONObject: content)
        let (data, response) = try await transport.data(for: request)
        guard let response = response as? HTTPURLResponse, response.statusCode == 200, data.count <= 2 * 1024 * 1024 else { throw PasswordProviderError.unavailable }
        let reply = try JSONDecoder().decode(Reply.self, from: data)
        guard reply.ok, reply.ownerId == account.ownerId else { throw PasswordProviderError.invalidSession }
        return reply
    }
    public func requireCapability() async throws {
        var request = URLRequest(url: account.origin.appendingPathComponent(".well-known/thingtime-capabilities.json"))
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try await transport.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200, data.count < 512 * 1024,
              let manifest = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let features = manifest["features"] as? [String: [String: String]],
              let version = features["api.passwords"]?["version"], version.range(of: "^1\\.[0-9]+\\.[0-9]+$", options: .regularExpression) != nil else { throw PasswordProviderError.unavailable }
    }
    public func catalog() async throws -> [PasswordCatalogItem] {
        try await requireCapability()
        var result: [PasswordCatalogItem] = [], cursor: String?
        repeat {
            var body: [String: Any] = ["operation": "catalog"]
            if let cursor { body["cursor"] = cursor }
            let reply = try await call(body)
            guard let entries = reply.catalog, result.count + entries.count <= 10_000, reply.nextCursor != cursor || cursor == nil else { throw PasswordProviderError.unavailable }
            result.append(contentsOf: entries); cursor = reply.nextCursor
        } while cursor != nil
        return result
    }
    public func read(_ id: String) async throws -> PasswordEntry {
        try await requireCapability()
        let reply = try await call(["operation": "read", "id": id])
        guard reply.id == id, let entry = reply.entry else { throw PasswordProviderError.invalidCredential }
        return entry
    }
    public func save(_ entry: PasswordEntry, id: String, writeId: String) async throws -> String {
        try await requireCapability()
        let value = try JSONSerialization.jsonObject(with: JSONEncoder().encode(entry))
        let reply = try await call(["operation": "save", "id": id, "writeId": writeId, "revision": 0, "entry": value])
        guard reply.record?.id == id else { throw PasswordProviderError.unavailable }
        return id
    }
}
