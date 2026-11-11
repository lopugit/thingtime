import Foundation

/// The browser handoff can open controls only; it cannot select an account,
/// destination, callback or start the camera. The selected native origin wins.
enum LiDARLaunchRoute {
    static func canConsume(pendingOrigin: URL?, selectedOrigin: URL?, currentURL: URL?, isLoading: Bool) -> Bool {
        guard !isLoading, let pendingOrigin, let selectedOrigin, let currentURL else { return false }
        return LopuVoiceContract.sameOrigin(pendingOrigin, selectedOrigin)
            && LopuVoiceContract.sameOrigin(currentURL, selectedOrigin)
    }

    static func accepts(_ url: URL, selectedOrigin: URL) -> Bool {
        guard url.scheme == "thingtime", url.host == "scan", url.path == "/lidar",
              url.user == nil, url.password == nil, url.port == nil, url.fragment == nil,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        let query = components.queryItems ?? []
        guard query.count <= 1, query.allSatisfy({ $0.name == "origin" }) else { return false }
        guard let item = query.first else { return true }
        guard let raw = item.value, let origin = URL(string: raw),
              origin.user == nil, origin.password == nil, origin.query == nil, origin.fragment == nil,
              origin.path.isEmpty || origin.path == "/",
              LopuVoiceContract.sameOrigin(origin, selectedOrigin) else { return false }
        return true
    }
}
