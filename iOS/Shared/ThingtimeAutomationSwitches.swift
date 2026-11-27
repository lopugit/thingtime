import Foundation

/// Administrator on/off switches for automatic background work, read from the
/// public `GET /api/v1/automation/switches` endpoint of the selected origin.
///
/// Every switch is off unless the server says it is on. A missing, unknown or
/// malformed switch counts as off. When the server can't be reached, the last
/// answer saved for that origin applies; with no saved answer, everything is
/// off, so this app never starts repeating or scheduled traffic on its own.
/// Answers are reused for five minutes.
actor ThingtimeAutomationSwitches {
    static let shared = ThingtimeAutomationSwitches()

    private struct Answer { let switches: [String: Bool]; let at: Date }
    private var answers: [String: Answer] = [:]
    private var inFlight: [String: Task<[String: Bool]?, Never>] = [:]
    private let freshness: TimeInterval = 300
    private let defaultsKey = "tt-automation-switches:v1"

    /// Whether the switch is on for this origin. Off on any doubt.
    func isEnabled(_ id: String, origin: URL) async -> Bool {
        guard let key = Self.originKey(origin) else { return false }
        if let answer = answers[key], Date().timeIntervalSince(answer.at) < freshness { return answer.switches[id] == true }
        if let fetched = await fetch(key: key, origin: origin) { return fetched[id] == true }
        return stored(key)?[id] == true
    }

    private func fetch(key: String, origin: URL) async -> [String: Bool]? {
        if let task = inFlight[key] { return await task.value }
        let task = Task<[String: Bool]?, Never> {
            guard let url = URL(string: "/api/v1/automation/switches", relativeTo: origin)?.absoluteURL else { return nil }
            var request = URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 10)
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            request.httpShouldHandleCookies = false
            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                guard (response as? HTTPURLResponse)?.statusCode == 200,
                      let body = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      body["ok"] as? Bool == true,
                      let raw = body["switches"] as? [String: Any] else { return nil }
                var switches: [String: Bool] = [:]
                for (id, value) in raw { switches[id] = (value as? Bool) == true }
                return switches
            } catch { return nil }
        }
        inFlight[key] = task
        let result = await task.value
        inFlight[key] = nil
        if let result {
            answers[key] = Answer(switches: result, at: Date())
            store(key, result)
        }
        return result
    }

    private static func originKey(_ origin: URL) -> String? {
        guard let scheme = origin.scheme?.lowercased(), let host = origin.host?.lowercased() else { return nil }
        return "\(scheme)://\(host)\(origin.port.map { ":\($0)" } ?? "")"
    }

    private func stored(_ key: String) -> [String: Bool]? {
        (UserDefaults.standard.dictionary(forKey: defaultsKey)?[key] as? [String: Bool])
    }

    private func store(_ key: String, _ switches: [String: Bool]) {
        var all = UserDefaults.standard.dictionary(forKey: defaultsKey) ?? [:]
        all[key] = switches
        UserDefaults.standard.set(all, forKey: defaultsKey)
    }
}
