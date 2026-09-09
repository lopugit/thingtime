import Foundation

/// The native client negotiates only the semantic operation it will call.
/// Deployment hashes and route existence are not compatibility evidence.
enum LopuVoiceContract {
    static func accepts(_ manifest: [String: Any], baseURL: URL, feature: String, minimum: [Int]) -> Bool {
        guard manifest["schemaVersion"] as? Int == 1,
              let origin = manifest["origin"] as? String,
              let advertised = URL(string: origin), sameOrigin(advertised, baseURL),
              advertised.path.isEmpty || advertised.path == "/",
              advertised.query == nil, advertised.fragment == nil,
              let features = manifest["features"] as? [String: [String: Any]],
              let version = features[feature]?["version"] as? String else { return false }
        let parts = version.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3, parts.allSatisfy({ $0.allSatisfy(\.isNumber) && !$0.isEmpty }), minimum.count == 3 else { return false }
        let numbers = parts.compactMap { Int($0) }
        guard numbers.count == 3, numbers[0] == minimum[0] else { return false }
        return numbers[1] > minimum[1] || (numbers[1] == minimum[1] && numbers[2] >= minimum[2])
    }

    static func sameOrigin(_ a: URL, _ b: URL) -> Bool {
        func port(_ url: URL) -> Int { url.port ?? (url.scheme == "https" ? 443 : 80) }
        return a.scheme?.lowercased() == b.scheme?.lowercased()
            && a.host?.lowercased() == b.host?.lowercased() && port(a) == port(b)
            && a.user == nil && a.password == nil
    }

    static func negotiate(baseURL: URL, feature: String, minimum: [Int]) async throws {
        guard let url = URL(string: "/api/v1/capabilities", relativeTo: baseURL)?.absoluteURL else { throw incompatible }
        var request = URLRequest(url: url)
        request.timeoutInterval = 15
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              let finalURL = http.url, sameOrigin(finalURL, baseURL),
              let body = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              accepts(body, baseURL: baseURL, feature: feature, minimum: minimum) else { throw incompatible }
    }

    private static var incompatible: NSError {
        NSError(domain: "LopuVoice", code: 20, userInfo: [NSLocalizedDescriptionKey:
            "This Thingtime destination does not support this voice operation. Your recording remains saved on this iPhone."])
    }
}
