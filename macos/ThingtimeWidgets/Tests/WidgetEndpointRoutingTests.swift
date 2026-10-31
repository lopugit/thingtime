import XCTest
@testable import Thingtime_Widgets

final class WidgetEndpointRoutingTests: XCTestCase {
    func testSnapshotsAreIsolatedAndRemovalDoesNotFallBack() throws {
        let suite = "group.com.thingtime.widgets.tests.per-endpoint"
        guard WidgetStore.group == suite else { throw XCTSkip("Run with the isolated widget test App Group") }
        let defaults = try XCTUnwrap(WidgetStore.defaults)
        defaults.removePersistentDomain(forName: suite)
        defer { defaults.removePersistentDomain(forName: suite) }
        let a = WidgetEndpointChoice(id: UUID().uuidString, name: "A", origin: "https://a.example")
        let b = WidgetEndpointChoice(id: UUID().uuidString, name: "B", origin: "https://b.example")
        WidgetEndpointCatalog.publish([a, b], activeOrigin: a.origin)
        WidgetStore.setEnabled(true)
        WidgetStore.save(["owner": "owner-a", "things": [["id": "same", "title": "A only"]]], origin: a.origin)
        WidgetStore.save(["owner": "owner-b", "things": [["id": "same", "title": "B only"]]], origin: b.origin, active: false)
        XCTAssertEqual(WidgetStore.read(endpointID: a.id)?.things.first?.title, "A only")
        XCTAssertEqual(WidgetStore.read(endpointID: b.id)?.things.first?.title, "B only")
        XCTAssertEqual(WidgetStore.read()?.owner, "owner-a")
        WidgetStore.clear(origin: a.origin)
        XCTAssertNil(WidgetStore.read(endpointID: a.id))
        XCTAssertEqual(WidgetStore.read(endpointID: b.id)?.owner, "owner-b")
        WidgetEndpointCatalog.publish([a], activeOrigin: a.origin)
        XCTAssertNil(WidgetStore.read(endpointID: b.id))
        XCTAssertNil(WidgetStore.read(origin: b.origin))
        WidgetStore.setEnabled(false)
        XCTAssertNil(WidgetStore.read())
    }
    func testMissingEndpointRetainsItsIdentityInsteadOfFollowingActive() async throws {
        let id = UUID().uuidString
        let entities = try await WidgetEndpointQuery().entities(for: [id])
        XCTAssertEqual(entities.first?.id, id)
        XCTAssertEqual(entities.first?.name, "Removed endpoint")
    }
    func testEndpointTravelsWithEveryActionAndThingLink() {
        let id = UUID().uuidString
        for action in WidgetAction.allCases {
            let url = WidgetRoute.url(action: action, endpointID: id)
            XCTAssertEqual(WidgetRoute.path(for: url), action.path)
            XCTAssertEqual(WidgetRoute.endpointID(for: url), id)
        }
        let url = WidgetRoute.url(action: .things, thingID: "same-id", endpointID: id)
        XCTAssertEqual(WidgetRoute.path(for: url), "/thing/same-id")
        XCTAssertEqual(WidgetRoute.endpointID(for: url), id)
        XCTAssertNil(WidgetRoute.path(for: URL(string: "thingtime-widgets://widget/search?endpoint=https://evil.example")!))
        XCTAssertNil(WidgetRoute.path(for: URL(string: "thingtime-widgets://widget/search?endpoint=\(id)&endpoint=\(id)")!))
    }
    func testIdenticalThingIDsRemainBoundToTheirEndpoint() {
        let a = WidgetEndpointChoice(id: UUID().uuidString, name: "A", origin: "https://a.example")
        let b = WidgetEndpointChoice(id: UUID().uuidString, name: "B", origin: "https://b.example")
        let selection = WidgetEndpointCatalog.thingID("same-id", endpoint: a)
        XCTAssertTrue(WidgetEndpointCatalog.matches(selection, thingID: "same-id", endpoint: a, explicit: true))
        XCTAssertFalse(WidgetEndpointCatalog.matches(selection, thingID: "same-id", endpoint: b, explicit: true))
        XCTAssertFalse(WidgetEndpointCatalog.matches("same-id", thingID: "same-id", endpoint: b, explicit: true))
        XCTAssertTrue(WidgetEndpointCatalog.matches("same-id", thingID: "same-id", endpoint: a, explicit: false))
    }
}
