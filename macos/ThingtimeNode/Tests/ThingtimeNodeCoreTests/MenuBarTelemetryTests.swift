import Foundation
import XCTest
@testable import ThingtimeNodeCore
final class MenuBarTelemetryTests: XCTestCase {
    @MainActor func testLockedSnapshotContainsNoInventory() {
        let snapshot = SystemMenuBar.snapshot(locked: true)
        XCTAssertEqual(snapshot.status, "locked")
        XCTAssertTrue(snapshot.items.isEmpty)
    }
    func testMenuBarNegotiationRequiresCompatibleSelectedOrigin() throws {
        let origin = URL(string: "https://thingtime.test")!
        for (version, expected) in [("1.10.0", false), ("1.11.0", true), ("1.12.0", true), ("2.0.0", false)] {
            var features = ThingtimeAPIClient.capabilityRequirements.mapValues { ["version": $0] }
            features["api.devices-node-state"] = ["version": version]
            let bytes = try JSONSerialization.data(withJSONObject: ["schemaVersion": 1, "origin": origin.absoluteString, "features": features])
            XCTAssertEqual(ThingtimeAPIClient.supportsMenuBar(bytes, origin: origin), expected)
            XCTAssertFalse(ThingtimeAPIClient.supportsMenuBar(bytes, origin: URL(string: "https://other.test")!))
        }
    }
}
