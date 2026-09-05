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
            message: nil,
            accountUsername: "lopu",
            phoneOrigin: "https://pr-596.previews.dev.thingtime.com",
            phoneBuild: "22"
        )

        let decoded = try ThingtimeWatchWire.snapshot(from: ThingtimeWatchWire.message(for: snapshot))

        XCTAssertEqual(decoded, snapshot)
        XCTAssertEqual(decoded?.notifications.first?.actionText, "commented on your post")
        XCTAssertEqual(decoded?.notifications.first?.displayActor, "Lopu")
        XCTAssertEqual(decoded?.accountUsername, "lopu")
        XCTAssertEqual(decoded?.phoneOrigin, "https://pr-596.previews.dev.thingtime.com")
        XCTAssertEqual(decoded?.phoneBuild, "22")
    }

    func testSnapshotDecodesPayloadFromOlderPhoneWithoutDiagnostics() throws {
        let data = Data(#"{"authenticated":true,"unreadCount":0,"notifications":[],"syncedAt":"2026-09-03T00:00:01.000Z","message":null}"#.utf8)

        let decoded = try JSONDecoder().decode(ThingtimeWatchSnapshot.self, from: data)

        XCTAssertNil(decoded.phoneOrigin)
        XCTAssertNil(decoded.phoneBuild)
        XCTAssertNil(decoded.accountUsername)
    }

    func testSignedOutSnapshotCarriesPairingGuidance() {
        XCTAssertFalse(ThingtimeWatchSnapshot.signedOut.authenticated)
        XCTAssertTrue(ThingtimeWatchSnapshot.signedOut.notifications.isEmpty)
        XCTAssertTrue(ThingtimeWatchSnapshot.signedOut.message?.contains("directly") == true)
        XCTAssertFalse(ThingtimeWatchSnapshot.signedOut.message?.contains("iPhone") == true)
    }

    func testConnectionFailureRoundTripsWithBoundedMessage() {
        let message = String(repeating: "x", count: 400)
        let envelope = ThingtimeWatchWire.connectionResult(ok: false, message: message)
        let result = ThingtimeWatchWire.connectionResult(from: envelope)

        XCTAssertEqual(result?.ok, false)
        XCTAssertEqual(result?.message.count, 300)
        XCTAssertNil(ThingtimeWatchWire.connectionResult(from: ["kind": "unexpected"]))
    }

    func testConnectionRetryBackoffIsBounded() {
        XCTAssertEqual(ThingtimeWatchWire.connectionRetryDelay(afterAttempt: 0), 2)
        XCTAssertEqual(ThingtimeWatchWire.connectionRetryDelay(afterAttempt: 1), 5)
        XCTAssertEqual(ThingtimeWatchWire.connectionRetryDelay(afterAttempt: 2), 10)
        XCTAssertNil(ThingtimeWatchWire.connectionRetryDelay(afterAttempt: 3))
        XCTAssertNil(ThingtimeWatchWire.connectionRetryDelay(afterAttempt: -1))
    }

    func testAttachmentMetadataRoundTripsThroughTransferDictionary() throws {
        let requestId = "86cdb8af-2bf8-4c9c-9447-0fb449e43d1d"
        let metadata = try ThingtimeWatchAttachmentTransfer.makeMetadata(
            requestId: requestId,
            filename: "Apple-Watch-Audio.m4a",
            contentType: "audio/mp4",
            sizeBytes: 4_096
        )

        XCTAssertEqual(try ThingtimeWatchAttachmentTransfer.metadata(from: metadata.transferDictionary), metadata)
    }

    func testAttachmentMetadataRejectsUnsafeOrOversizedFiles() {
        XCTAssertThrowsError(try ThingtimeWatchAttachmentTransfer.makeMetadata(
            filename: "../secret.txt",
            contentType: "text/plain",
            sizeBytes: 100
        ))
        XCTAssertThrowsError(try ThingtimeWatchAttachmentTransfer.makeMetadata(
            filename: "large.mov",
            contentType: "video/quicktime",
            sizeBytes: ThingtimeWatchAttachmentTransfer.maximumBytes + 1
        ))
        XCTAssertThrowsError(try ThingtimeWatchAttachmentTransfer.makeMetadata(
            filename: "audio.m4a",
            contentType: "not a mime type",
            sizeBytes: 100
        ))
    }

    func testWatchUploadCapabilityVersionsFailClosed() {
        XCTAssertTrue(ThingtimeWatchUploadRequirements.satisfies(actual: "1.1.0", minimum: "1.0.0"))
        XCTAssertTrue(ThingtimeWatchUploadRequirements.satisfies(actual: "1.0.1", minimum: "1.0.0"))
        XCTAssertFalse(ThingtimeWatchUploadRequirements.satisfies(actual: "0.9.9", minimum: "1.0.0"))
        XCTAssertFalse(ThingtimeWatchUploadRequirements.satisfies(actual: "2.0.0", minimum: "1.0.0"))
        XCTAssertFalse(ThingtimeWatchUploadRequirements.satisfies(actual: "latest", minimum: "1.0.0"))
    }

    func testNotificationHistoryRequestAndPageRoundTrip() throws {
        let request = ThingtimeWatchNotificationHistoryRequest(
            requestId: "5b36db4d-2e2b-44fe-a21e-23aeef7c9a22",
            target: .range,
            from: "2026-09-01T00:00:00.000Z",
            to: "2026-09-03T00:00:00.000Z",
            cursor: "opaque-cursor",
            limit: 10
        )
        let requestMessage = try ThingtimeWatchNotificationHistory.requestMessage(request)
        XCTAssertEqual(
            try ThingtimeWatchNotificationHistory.request(
                from: requestMessage,
                kind: ThingtimeWatchNotificationHistory.requestKind
            ),
            request
        )

        let page = ThingtimeWatchNotificationHistoryPage(
            requestId: request.requestId,
            target: .range,
            from: request.from,
            to: request.to,
            notifications: [],
            unreadCount: 3,
            nextCursor: "next-page"
        )
        XCTAssertEqual(
            try ThingtimeWatchNotificationHistory.page(
                from: ThingtimeWatchNotificationHistory.pageMessage(page)
            ),
            page
        )
    }

    func testNotificationArchiveIsBoundedAndCapabilityGated() {
        XCTAssertEqual(ThingtimeWatchNotificationHistory.pageSize, 10)
        XCTAssertEqual(ThingtimeWatchNotificationHistory.maximumArchiveNotifications, 500)
        XCTAssertEqual(ThingtimeWatchNotificationHistory.minimumVersions["api.notifications-list"], "1.1.0")
    }
}
