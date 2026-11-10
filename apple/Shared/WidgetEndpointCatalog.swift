import Foundation
import WidgetKit

/// Display-only endpoint metadata shared with extensions. Never credentials.
struct WidgetEndpointChoice: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let origin: String
}
enum WidgetEndpointCatalog {
    static var entries: [WidgetEndpointChoice] {
        guard let data = WidgetStore.defaults?.data(forKey: "widget.endpoints") else { return [] }
        return (try? JSONDecoder().decode([WidgetEndpointChoice].self, from: data)) ?? []
    }
    static var activeID: String? { WidgetStore.defaults?.string(forKey: "widget.endpoint.active") }
    static func resolve(_ id: String?) -> WidgetEndpointChoice? {
        entries.first { $0.id == (id ?? activeID) }
    }
    static func publish(_ choices: [WidgetEndpointChoice], activeOrigin: String) {
        for old in entries where !choices.contains(old) { WidgetStore.clear(origin: old.origin) }
        WidgetStore.defaults?.set(try? JSONEncoder().encode(choices), forKey: "widget.endpoints")
        WidgetStore.defaults?.set(choices.first { $0.origin == activeOrigin }?.id, forKey: "widget.endpoint.active")
        WidgetCenter.shared.reloadAllTimelines()
    }
    static func thingID(_ id: String, endpoint: WidgetEndpointChoice?) -> String {
        guard let endpoint else { return id }
        return endpoint.id + "|" + id
    }
    static func matches(_ selection: String, thingID: String, endpoint: WidgetEndpointChoice?, explicit: Bool) -> Bool {
        selection == self.thingID(thingID, endpoint: endpoint) || (!explicit && !selection.contains("|") && selection == thingID)
    }
}
