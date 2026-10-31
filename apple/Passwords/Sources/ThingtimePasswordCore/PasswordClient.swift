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
    public convenience init(account: ProviderSession) {
        self.init(account: account, configuration: .ephemeral)
    }
    init(account: ProviderSession, configuration: URLSessionConfiguration) {
        self.account = account
        configuration.httpCookieStorage = nil; configuration.urlCache = nil; configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 25; configuration.timeoutIntervalForResource = 40
        transport = URLSession(configuration: configuration, delegate: NoRedirect(), delegateQueue: nil)
    }
    deinit { transport.invalidateAndCancel() }
    private func receive(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let data: Data, response: URLResponse
        do { (data, response) = try await transport.data(for: request) }
        catch {
            if Task.isCancelled || (error as? URLError)?.code == .cancelled { throw CancellationError() }
            throw PasswordProviderError.networkUnavailable
        }
        guard let http = response as? HTTPURLResponse, http.url == request.url else { throw PasswordProviderError.invalidResponse }
        switch http.statusCode {
        case 200: return (data, http)
        case 401: throw PasswordProviderError.invalidSession
        case 403: throw PasswordProviderError.permissionDenied
        case 404, 405: throw PasswordProviderError.incompatibleService
        case 409: throw PasswordProviderError.conflict
        case 429: throw PasswordProviderError.rateLimited
        case 500...599: throw PasswordProviderError.serviceUnavailable
        default: throw PasswordProviderError.invalidResponse
        }
    }
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
        let (data, _) = try await receive(request)
        guard data.count <= 2 * 1024 * 1024, let reply = try? JSONDecoder().decode(Reply.self, from: data) else { throw PasswordProviderError.invalidResponse }
        guard reply.ok, reply.ownerId == account.ownerId else { throw PasswordProviderError.invalidSession }
        return reply
    }
    // The provider uses only these semantic operations. Origin and schema are
    // part of negotiation; a manifest from another account endpoint is invalid.
    static let capabilityRequirements = ["api.passwords": [1, 0, 0]]
    static func compatibleCapabilities(_ data: Data, origin: URL) -> Bool {
        guard data.count < 512 * 1024,
              let manifest = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              manifest["schemaVersion"] as? Int == 1,
              manifest["origin"] as? String == origin.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")),
              let features = manifest["features"] as? [String: [String: Any]] else { return false }
        for (feature, minimum) in capabilityRequirements {
            guard let version = features[feature]?["version"] as? String,
                  version.range(of: "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$", options: .regularExpression) != nil else { return false }
            let parts = version.split(separator: ".").compactMap { Int($0) }
            guard parts.count == 3, parts[0] == minimum[0],
                  parts[1] > minimum[1] || parts[1] == minimum[1] && parts[2] >= minimum[2] else { return false }
        }
        return true
    }
    public func requireCapability() async throws {
        var request = URLRequest(url: account.origin.appendingPathComponent(".well-known/thingtime-capabilities.json"))
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, _) = try await receive(request)
        guard Self.compatibleCapabilities(data, origin: account.origin) else { throw PasswordProviderError.incompatibleService }
    }
    public func catalog() async throws -> [PasswordCatalogItem] {
        try await requireCapability()
        var result: [PasswordCatalogItem] = [], cursor: String?
        var visitedCursors = Set<String>()
        repeat {
            var body: [String: Any] = ["operation": "catalog"]
            if let cursor { body["cursor"] = cursor }
            let reply = try await call(body)
            guard let entries = reply.catalog else { throw PasswordProviderError.invalidResponse }
            // Pagination is a processing boundary, never a vault item limit.
            // Refuse repeated cursors, including cycles spanning multiple pages.
            if let next = reply.nextCursor, !visitedCursors.insert(next).inserted { throw PasswordProviderError.invalidResponse }
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
