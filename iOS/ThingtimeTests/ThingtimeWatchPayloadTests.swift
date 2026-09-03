import XCTest
@testable import Thingtime

final class ThingtimeWatchPayloadTests: XCTestCase {
    func testSnapshotRoundTripsThroughWatchConnectivityEnvelope() throws {
        let notification = ThingtimeWatchNotification(
            id: "notification-1",
            type: "comment",
            actorUsername: "lopu",
            actorName: "Lopu",
            targetId: "comment-1",
            postId: "post-1",
            preview: "Hello from Thingtime",
            readAt: nil,
            createdAt: "2026-09-03T00:00:00.000Z"
        )
        let snapshot = ThingtimeWatchSnapshot(
            authenticated: true,
            unreadCount: 1,
            notifications: [notification],
            syncedAt: "2026-09-03T00:00:01.000Z",
            message: nil
        )

        let decoded = try ThingtimeWatchWire.snapshot(from: ThingtimeWatchWire.message(for: snapshot))

        XCTAssertEqual(decoded, snapshot)
        XCTAssertEqual(decoded?.notifications.first?.actionText, "commented on your post")
        XCTAssertEqual(decoded?.notifications.first?.displayActor, "Lopu")
    }

    func testSignedOutSnapshotCarriesPairingGuidance() {
        XCTAssertFalse(ThingtimeWatchSnapshot.signedOut.authenticated)
        XCTAssertTrue(ThingtimeWatchSnapshot.signedOut.notifications.isEmpty)
        XCTAssertTrue(ThingtimeWatchSnapshot.signedOut.message?.contains("iPhone") == true)
    }
}
