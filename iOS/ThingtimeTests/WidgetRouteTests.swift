import XCTest
@testable import Thingtime

final class WidgetRouteTests: XCTestCase {
    func testEveryActionRoundTrips() {
        for action in WidgetAction.allCases {
            XCTAssertEqual(WidgetRoute.path(for: action.url), action.path)
        }
    }
    func testThingLinkAndUnsafeInputs() {
        XCTAssertEqual(WidgetRoute.path(for: WidgetRoute.url(action: .things, thingID: "abc_123-XYZ")), "/thing/abc_123-XYZ")
        for raw in ["https://widget/transcribe", "thingtime://widget/unknown", "thingtime://widget/things?thing=../admin", "thingtime://widget/things?thing=a&thing=b", "thingtime://widget/transcribe?thing=abc", "thingtime://widget/search?url=https://evil.test", "thingtime://user@widget/voice", "thingtime://widget:99/voice", "thingtime://widget/voice#fragment"] {
            XCTAssertNil(WidgetRoute.path(for: URL(string: raw)!), raw)
        }
    }
    func testVoiceRoutesAreExplicitAndSeparate() {
        XCTAssertEqual(WidgetAction.transcribe.path, "/lopu/voice?widget=transcribe")
        XCTAssertEqual(WidgetAction.voice.path, "/lopu/voice?widget=voice")
    }
    func testSnapshotExpiryAndFutureDates() {
        let now = Date()
        let snapshot = WidgetSnapshot(owner: "account-a", origin: "https://thingtime.com", date: now, things: [])
        XCTAssertTrue(snapshot.isFresh(at: now))
        XCTAssertTrue(snapshot.isFresh(at: now.addingTimeInterval(1799)))
        XCTAssertFalse(snapshot.isFresh(at: now.addingTimeInterval(1800)))
        XCTAssertFalse(snapshot.isFresh(at: now.addingTimeInterval(-1)))
    }
    func testDisplayProjectionDecodingDoesNotRequireSecrets() throws {
        let thing = WidgetThing(id: "abc", title: "A thing", text: "A note", kind: "data", value: "42")
        let data = try JSONEncoder().encode(thing)
        let fields = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(Set(fields.keys), ["id", "title", "text", "kind", "value"])
    }
}
