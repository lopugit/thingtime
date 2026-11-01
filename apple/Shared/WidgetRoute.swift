import Foundation

enum WidgetAction: String, CaseIterable, Codable {
    case transcribe, voice, newThing, search, things, chat, newFolder, feed
    var title: String {
        switch self {
        case .transcribe: return "Transcribe with Lopu"
        case .voice: return "Talk to Lopu"
        case .newThing: return "New Thing"
        case .search: return "Search Things"
        case .things: return "My Things"
        case .chat: return "Chat with Lopu"
        case .newFolder: return "New Folder"
        case .feed: return "Feed"
        }
    }
    var symbol: String {
        switch self {
        case .transcribe: return "waveform"
        case .voice: return "mic.fill"
        case .newThing: return "plus"
        case .search: return "magnifyingglass"
        case .things: return "square.grid.2x2"
        case .chat: return "bubble.left.and.bubble.right"
        case .newFolder: return "folder.badge.plus"
        case .feed: return "text.bubble"
        }
    }
    var path: String {
        switch self {
        case .transcribe: return "/lopu/voice?widget=transcribe"
        case .voice: return "/lopu/voice?widget=voice"
        case .newThing: return "/schemas"
        case .search: return "/things?widget=search"
        case .things: return "/things"
        case .chat: return "/lopu"
        case .newFolder: return "/things?widget=newFolder"
        case .feed: return "/feed"
        }
    }
    var url: URL { WidgetRoute.url(action: self) }
}

enum WidgetRoute {
    #if os(macOS)
    static let scheme = "thingtime-widgets"
    #else
    static let scheme = "thingtime"
    #endif
    static func url(action: WidgetAction, thingID: String? = nil, endpointID: String? = nil) -> URL {
        var parts = URLComponents()
        parts.scheme = scheme
        parts.host = "widget"
        parts.path = "/\(action.rawValue)"
        if let thingID { parts.queryItems = [URLQueryItem(name: "thing", value: thingID)] }
        #if os(macOS)
        if let endpointID { parts.queryItems = (parts.queryItems ?? []) + [URLQueryItem(name: "endpoint", value: endpointID)] }
        #endif
        return parts.url!
    }
    static func endpointID(for url: URL) -> String? {
        URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "endpoint" })?.value
    }
    static func path(for url: URL) -> String? {
        guard url.scheme == scheme, url.host == "widget", url.user == nil, url.password == nil,
              url.port == nil, url.fragment == nil,
              let action = WidgetAction(rawValue: String(url.path.dropFirst())) else { return nil }
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        #if os(macOS)
        guard items.count <= 2, Set(items.map(\.name)).count == items.count,
              items.allSatisfy({ $0.name == "thing" || ($0.name == "endpoint" && UUID(uuidString: $0.value ?? "") != nil) }) else { return nil }
        #else
        guard items.count <= 1, items.allSatisfy({ $0.name == "thing" }) else { return nil }
        #endif
        if let id = items.first(where: { $0.name == "thing" })?.value {
            guard action == .things, !id.isEmpty, id.count <= 200,
                  id.unicodeScalars.allSatisfy({ CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_-" )).contains($0) }) else { return nil }
            return "/thing/\(id)"
        }
        return action.path
    }
}
