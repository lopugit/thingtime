import Foundation
import WidgetKit

struct WidgetThing: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let text: String
    let kind: String
    let value: String
    var url: URL { WidgetRoute.url(action: .things, thingID: id) }
}
struct WidgetSnapshot: Codable {
    let owner: String
    let origin: String
    let date: Date
    let things: [WidgetThing]
    func isFresh(at now: Date) -> Bool { now >= date && now.timeIntervalSince(date) < 1800 }
}
enum WidgetStore {
    static var group: String { Bundle.main.object(forInfoDictionaryKey: "ThingtimeWidgetGroup") as? String ?? "group.com.thingtime.widgets" }
    static var defaults: UserDefaults? { UserDefaults(suiteName: group) }
    static var enabled: Bool { defaults?.bool(forKey: "widget.content.enabled") ?? false }
    static func setEnabled(_ enabled: Bool) {
        defaults?.set(enabled, forKey: "widget.content.enabled")
        if !enabled {
            for endpoint in WidgetEndpointCatalog.entries { clear(origin: endpoint.origin) }
            clear()
        }
    }
    private static func key(_ origin: String) -> String { "widget.snapshot.origin." + Data(origin.utf8).base64EncodedString() }
    static func clear(origin: String) {
        defaults?.removeObject(forKey: key(origin))
        WidgetCenter.shared.reloadAllTimelines()
    }
    static func clearLegacy() {
        defaults?.removeObject(forKey: "widget.snapshot")
        WidgetCenter.shared.reloadAllTimelines()
    }
    static func clear() {
        if let active = WidgetEndpointCatalog.resolve(nil) { clear(origin: active.origin) }
        defaults?.removeObject(forKey: "widget.snapshot")
        WidgetCenter.shared.reloadAllTimelines()
    }
    static func read(now: Date = Date(), endpointID: String? = nil) -> WidgetSnapshot? {
        #if os(macOS)
        if let endpointID {
            guard let endpoint = WidgetEndpointCatalog.resolve(endpointID) else { return nil }
            return read(origin: endpoint.origin, now: now)
        }
        #endif
        guard enabled, let data = defaults?.data(forKey: "widget.snapshot"),
              let snapshot = try? JSONDecoder().decode(WidgetSnapshot.self, from: data),
              snapshot.isFresh(at: now) else { return nil }
        return snapshot
    }
    static func read(origin: String, now: Date = Date()) -> WidgetSnapshot? {
        guard enabled, let data = defaults?.data(forKey: key(origin)),
              let snapshot = try? JSONDecoder().decode(WidgetSnapshot.self, from: data),
              snapshot.origin == origin, snapshot.isFresh(at: now) else { return nil }
        return snapshot
    }
    static func save(_ payload: [String: Any], origin: String, date: Date = Date(), active: Bool = true) {
        guard enabled, let owner = payload["owner"] as? String, !owner.isEmpty,
              let rows = payload["things"] as? [[String: Any]] else { clear(origin: origin); if active { clearLegacy() }; return }
        let things = rows.prefix(50).compactMap { row -> WidgetThing? in
            guard let id = row["id"] as? String,
                  WidgetRoute.path(for: WidgetRoute.url(action: .things, thingID: id)) != nil else { return nil }
            func string(_ key: String, _ limit: Int) -> String { String((row[key] as? String ?? "").prefix(limit)) }
            return WidgetThing(id: id, title: string("title", 160), text: string("text", 1200), kind: string("kind", 40), value: string("value", 100))
        }
        let snapshot = WidgetSnapshot(owner: String(owner.prefix(200)), origin: origin, date: date, things: things)
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        #if os(macOS)
        defaults?.set(data, forKey: key(origin))
        #endif
        if active { defaults?.set(data, forKey: "widget.snapshot") }
        WidgetCenter.shared.reloadAllTimelines()
    }
}
