import AppIntents
import WidgetKit

extension WidgetAction: AppEnum {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Thingtime action"
    static var caseDisplayRepresentations: [WidgetAction: DisplayRepresentation] = [
        .transcribe: "Transcribe with Lopu", .voice: "Talk to Lopu", .newThing: "New Thing", .search: "Search Things",
        .things: "My Things", .chat: "Chat with Lopu", .newFolder: "New Folder", .feed: "Feed"
    ]
}
enum ThingLayout: String, AppEnum {
    case card, note, value
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Layout"
    static var caseDisplayRepresentations: [Self: DisplayRepresentation] = [.card: "Card", .note: "Note", .value: "Value"]
}
#if os(macOS)
struct WidgetEndpointEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Saved endpoint"
    static var defaultQuery = WidgetEndpointQuery()
    let id: String
    let name: String
    let origin: String
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)", subtitle: "\(origin)") }
}
struct WidgetEndpointQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [WidgetEndpointEntity] {
        identifiers.map { id in
            candidates.first(where: { $0.id == id }) ?? WidgetEndpointEntity(id: id, name: "Removed endpoint", origin: "Edit this widget to choose another endpoint")
        }
    }
    func suggestedEntities() async throws -> [WidgetEndpointEntity] { candidates }
    private var candidates: [WidgetEndpointEntity] {
        WidgetEndpointCatalog.entries.map { .init(id: $0.id, name: $0.name, origin: $0.origin) }
    }
}
#endif
struct WidgetThingEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Thing"
    static var defaultQuery = WidgetThingQuery()
    let id: String
    let title: String
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(title)") }
}
struct WidgetThingQuery: EntityStringQuery {
    #if os(macOS)
    @IntentParameterDependency<ThingWidgetConfiguration>(\.$endpoint) var configuration
    #endif
    func entities(for identifiers: [String]) async throws -> [WidgetThingEntity] {
        candidates.filter { identifiers.contains($0.id) }
    }
    func suggestedEntities() async throws -> [WidgetThingEntity] { candidates }
    func entities(matching string: String) async throws -> [WidgetThingEntity] {
        candidates.filter { $0.title.localizedCaseInsensitiveContains(string) }
    }
    private var candidates: [WidgetThingEntity] {
        #if os(macOS)
        let selectedID = configuration?.endpoint.id
        let endpoint = WidgetEndpointCatalog.resolve(selectedID)
        if selectedID != nil && endpoint == nil { return [] }
        return (WidgetStore.read(endpointID: endpoint?.id)?.things ?? []).map {
            WidgetThingEntity(id: WidgetEndpointCatalog.thingID($0.id, endpoint: endpoint), title: $0.title)
        }
        #else
        return (WidgetStore.read()?.things ?? []).map { WidgetThingEntity(id: $0.id, title: $0.title) }
        #endif
    }
}
struct ThingWidgetConfiguration: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Your Thingtime widget"
    #if os(macOS)
    @Parameter(title: "Endpoint", description: "Choose a saved endpoint from Thingtime Widgets. Leave empty to follow the app’s active endpoint.") var endpoint: WidgetEndpointEntity?
    #endif
    var endpointID: String? {
        #if os(macOS)
        return endpoint?.id
        #else
        return nil
        #endif
    }
    func url(action: WidgetAction, thingID: String? = nil) -> URL {
        WidgetRoute.url(action: action, thingID: thingID, endpointID: endpointID)
    }
    @Parameter(title: "Action", default: .transcribe) var action: WidgetAction
    @Parameter(title: "Thing") var thing: WidgetThingEntity?
    @Parameter(title: "Title", default: "") var customTitle: String
    @Parameter(title: "Layout", default: .card) var layout: ThingLayout
    @Parameter(title: "Show content", default: false) var showContent: Bool
}

// Included in the app and extension. Controls must foreground the app before
// initiating audio; the web/native voice controller retains permission ownership.
@available(iOS 18.0, macOS 15.0, *)
struct OpenThingtimeAction: AppIntent {
    static var title: LocalizedStringResource = "Open Thingtime action"
    static var openAppWhenRun = true
    @Parameter(title: "Action") var action: WidgetAction
    init() { action = .transcribe }
    init(_ action: WidgetAction) { self.action = action }
    @MainActor func perform() async throws -> some IntentResult {
        WidgetActionInbox.enqueue(action)
        NotificationCenter.default.post(name: .thingtimeWidgetAction, object: nil)
        return .result()
    }
}
extension Notification.Name {
    static let thingtimeWidgetAction = Notification.Name("thingtime.widget.action")
}
