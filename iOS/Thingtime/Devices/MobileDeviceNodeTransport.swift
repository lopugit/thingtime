import Foundation

/// Device-bound bearer transport; never borrows a WebView or account cookie.
@MainActor
final class MobileDeviceNodeTransport {
    enum Failure: Error { case http(Int, String?) }
    private let load: (MobileDevicePairing.Scope) throws -> MobileDevicePairing.Record?
    private let save: (MobileDevicePairing.Record) throws -> Void
    private let transport: MobileDevicePairing.Transport
    init(load: @escaping (MobileDevicePairing.Scope) throws -> MobileDevicePairing.Record? = MobileDeviceKeychain.load,
         save: @escaping (MobileDevicePairing.Record) throws -> Void = MobileDeviceKeychain.save,
         transport: @escaping MobileDevicePairing.Transport) {
        self.load = load; self.save = save; self.transport = transport
    }
    static func make() -> MobileDeviceNodeTransport {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil; configuration.urlCredentialStorage = nil
        configuration.httpShouldSetCookies = false
        let session = URLSession(configuration: configuration, delegate: MobileDeviceRedirectPolicy(), delegateQueue: nil)
        return MobileDeviceNodeTransport(transport: { request in
            let (bytes, response) = try await session.bytes(for: request)
            guard let http = response as? HTTPURLResponse else { throw MobileDevicePairing.Failure.invalid }
            var data = Data()
            for try await byte in bytes {
                guard data.count < 512 * 1024 else { throw MobileDevicePairing.Failure.invalid }
                data.append(byte)
            }
            return (data, http)
        })
    }
    func request(_ scope: MobileDevicePairing.Scope, _ path: String, body: Data? = nil,
                         check: () throws -> Void) async throws -> [String: Any] {
        try check(); try Task.checkCancellation()
        guard var record = try load(scope), record.scope == scope, !record.revoked, record.deviceId != nil else { throw MobileDevicePairing.Failure.revoked }
        let url = URL(string: path, relativeTo: scope.origin)!.absoluteURL
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if path != LopuVoiceContract.manifestPath {
            request.setValue("Bearer \(record.credential)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.httpMethod = "POST"; request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("Bearer \(record.credential)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await transport(request)
        try check(); try Task.checkCancellation()
        guard let actual = response.url, LopuVoiceContract.sameOrigin(actual, scope.origin) else { throw MobileDevicePairing.Failure.destination }
        if response.statusCode == 401 {
            record.revoked = true; try save(record)
            throw MobileDevicePairing.Failure.revoked
        }
        guard response.statusCode == 200 else {
            let result = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            throw Failure.http(response.statusCode, result?["code"] as? String)
        }
        guard let result = try JSONSerialization.jsonObject(with: data) as? [String: Any], result["ok"] as? Bool != false else { throw MobileDevicePairing.Failure.invalid }
        return result
    }

    func negotiate(_ requirements: [String: [Int]], scope: MobileDevicePairing.Scope, check: () throws -> Void) async throws {
        let manifest = try await request(scope, LopuVoiceContract.manifestPath, check: check)
        guard requirements.allSatisfy({ LopuVoiceContract.accepts(manifest, baseURL: scope.origin, feature: $0.key, minimum: $0.value) }) else {
            throw MobileDevicePairing.Failure.incompatible
        }
    }
    func deviceId(_ scope: MobileDevicePairing.Scope) throws -> String {
        guard let record = try load(scope), record.scope == scope, !record.revoked, let id = record.deviceId else { throw MobileDevicePairing.Failure.revoked }
        return id
    }
}
