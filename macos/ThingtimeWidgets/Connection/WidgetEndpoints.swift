import Foundation

struct WidgetEndpoint: Codable, Identifiable, Equatable {
    let id: UUID
    var name: String
    var origin: String
}

/// Non-secret bookmarks only. Each origin's credential remains in Keychain.
struct WidgetEndpoints {
    static let key = "widgets.connection.endpoints.v1"
    static let production = "https://thingtime.com"
    private(set) var entries: [WidgetEndpoint]

    init(defaults: UserDefaults = .standard, currentOrigin: String) {
        let restored = defaults.data(forKey: Self.key).flatMap { try? JSONDecoder().decode([WidgetEndpoint].self, from: $0) }
        let saved = restored ?? []
        var seen = Set<String>()
        entries = saved.filter {
            (try? WidgetOAuthRequest.normalizeOrigin($0.origin).absoluteString) == $0.origin &&
            !$0.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && seen.insert($0.origin).inserted
        }
        for origin in (restored == nil ? [Self.production, currentOrigin] : [currentOrigin]) where !entries.contains(where: { $0.origin == origin }) {
            guard (try? WidgetOAuthRequest.normalizeOrigin(origin)) != nil else { continue }
            entries.append(WidgetEndpoint(id: UUID(), name: origin == Self.production ? "Thingtime" : "Previous connection", origin: origin))
        }
    }

    mutating func save(id: UUID?, name: String, address: String) throws -> WidgetEndpoint {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.count <= 80 else { throw Failure.message("Give this endpoint a name of 1–80 characters.") }
        let origin = try WidgetOAuthRequest.normalizeOrigin(address).absoluteString
        guard !entries.contains(where: { $0.origin == origin && $0.id != id }) else {
            throw Failure.message("This address is already saved. Choose its existing endpoint.")
        }
        let entry = WidgetEndpoint(id: id ?? UUID(), name: name, origin: origin)
        if let index = entries.firstIndex(where: { $0.id == entry.id }) { entries[index] = entry }
        else { entries.append(entry) }
        return entry
    }

    mutating func remove(_ id: UUID) { entries.removeAll { $0.id == id } }
    func persist(to defaults: UserDefaults = .standard) throws {
        defaults.set(try JSONEncoder().encode(entries), forKey: Self.key)
    }
    enum Failure: LocalizedError {
        case message(String)
        var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
    }
}
