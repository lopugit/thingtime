import AppleFileSync
import XCTest
import UIKit
@testable import Thingtime

@MainActor
final class NativeBackgroundPhotoTransportTests: XCTestCase {
    private func response(url: String = "https://photos-bucket.s3.eu-west-1.amazonaws.com/exact/key?signature=synthetic",
                          date: Date) -> (URLRequest, [String: Any]) {
        let expiry = ISO8601DateFormatter().string(from: date)
        var request = URLRequest(url: URL(string: url)!)
        request.httpMethod = "PUT"; request.setValue("synthetic", forHTTPHeaderField: "x-amz-checksum-sha256")
        return (request, ["parts": [["partNumber": 1, "expiresAt": expiry, "transport": ["kind": "background-file-v1",
            "origin": "https://photos-bucket.s3.eu-west-1.amazonaws.com", "path": "/exact/key", "method": "PUT",
            "redirects": "provider-managed", "expiresAt": expiry]]]])
    }
    func testCanonicalBackgroundDescriptorBindsExactTargetAndGrantExpiry() throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let (request, result) = response(date: now.addingTimeInterval(600))
        XCTAssertNotNil(try NativeBackgroundPhotoTransport.parse(result, request: request, partNumber: 1, now: now))
        for raw in ["https://evil.test/exact/key", "https://photos.bucket.s3.eu-west-1.amazonaws.com/exact/key",
                    "https://photos-bucket.s3.eu-west-1.amazonaws.com/different", "http://photos-bucket.s3.eu-west-1.amazonaws.com/exact/key"] {
            var wrong = request; wrong.url = URL(string: raw)
            XCTAssertThrowsError(try NativeBackgroundPhotoTransport.parse(result, request: wrong, partNumber: 1, now: now))
        }
        var headers = request; headers.setValue("secret-not-sent", forHTTPHeaderField: "Authorization")
        XCTAssertThrowsError(try NativeBackgroundPhotoTransport.parse(result, request: headers, partNumber: 1, now: now))
        var part = (result["parts"] as! [[String: Any]])[0]
        part["expiresAt"] = ISO8601DateFormatter().string(from: now.addingTimeInterval(590))
        XCTAssertThrowsError(try NativeBackgroundPhotoTransport.parse(["parts": [part]], request: request, partNumber: 1, now: now))
        var descriptor = part["transport"] as! [String: Any]
        descriptor["origin"] = "https://user@photos-bucket.s3.eu-west-1.amazonaws.com"
        part["transport"] = descriptor
        XCTAssertThrowsError(try NativeBackgroundPhotoTransport.parse(["parts": [part]], request: request, partNumber: 1, now: now))
        XCTAssertNil(try NativeBackgroundPhotoTransport.parse(["parts": [["partNumber": 1]]], request: request, partNumber: 1, now: now))
    }
    func testAverageCalendarPersistsAcrossRestartAndRejectsExpiredAdmission() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let now = Date(timeIntervalSince1970: 1_800_000_000), expiry = now.addingTimeInterval(600)
        let first = NativeBackgroundUploadCalendar(directory: directory)
        XCTAssertEqual(try first.admit(key: "exact-owner-device", bytes: 100, rate: 10, expiry: expiry, now: now), now)
        let reopened = NativeBackgroundUploadCalendar(directory: directory)
        XCTAssertEqual(try reopened.admit(key: "exact-owner-device", bytes: 100, rate: 10, expiry: expiry, now: now), now.addingTimeInterval(10))
        XCTAssertThrowsError(try reopened.admit(key: "exact-owner-device", bytes: 6_000, rate: 10, expiry: expiry, now: now))
        XCTAssertEqual(try reopened.admit(key: "other-owner-device", bytes: 100, rate: 10, expiry: expiry, now: now), now)
    }
    func testFiveBudgetReservationsSurviveRestartAndReconcileOnlyExactLease() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let scope = try FileSyncOwnerScope(ownerId: "owner", url: URL(string: "https://sync.test")!)
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let budget = NativePhotoUploadBudget(directory: directory)
        let ids = (0..<5).map { _ in UUID() }
        let leases = try ids.map { try budget.reserve(scope: scope, deviceId: "device", bytes: 20, cap: 100, now: now, reservationId: $0) }
        XCTAssertThrowsError(try budget.reserve(scope: scope, deviceId: "device", bytes: 1, cap: 100, now: now))
        let reopened = NativePhotoUploadBudget(directory: directory)
        let attached = try reopened.reserve(scope: scope, deviceId: "device", bytes: 20, cap: 100, now: now, reservationId: ids[0])
        try reopened.finish(attached, observedBytes: 5, now: now)
        _ = try reopened.reserve(scope: scope, deviceId: "device", bytes: 15, cap: 100, now: now)
        XCTAssertThrowsError(try reopened.reserve(scope: scope, deviceId: "device", bytes: 1, cap: 100, now: now))
        try reopened.finish(leases[1], observedBytes: 0, now: now)
        _ = try reopened.reserve(scope: scope, deviceId: "device", bytes: 20, cap: 100, now: now)
    }
    func testBudgetSettlementReplaysAcrossCrashWithoutChargingTwice() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let scope = try FileSyncOwnerScope(ownerId: "owner", url: URL(string: "https://sync.test")!)
        let now = Date(timeIntervalSince1970: 1_800_000_000), job = UUID()
        let original = NativePhotoUploadBudget(directory: directory)
        let lease = try original.reserve(scope: scope, deviceId: "device", bytes: 80, cap: 100, now: now, reservationId: job)
        try original.finish(lease, observedBytes: 30, now: now, idempotent: true)
        // Simulate death after bucket settlement, before record/job settlement.
        let reopened = NativePhotoUploadBudget(directory: directory)
        let same = try reopened.reserve(scope: scope, deviceId: "device", bytes: 80, cap: 100, now: now, reservationId: job)
        try reopened.finish(same, observedBytes: 30, now: now, idempotent: true)
        try reopened.finish(same, observedBytes: 30, now: now, idempotent: true)
        _ = try reopened.reserve(scope: scope, deviceId: "device", bytes: 70, cap: 100, now: now)
        XCTAssertThrowsError(try reopened.reserve(scope: scope, deviceId: "device", bytes: 1, cap: 100, now: now))
        XCTAssertThrowsError(try reopened.finish(same, observedBytes: 31, now: now, idempotent: true))
    }

    func testUnpersistedTaskIsCancelledAndRestoreRequiresExactIdentifier() throws {
        enum WriteFailure: Error { case unavailable }
        let session = URLSession(configuration: .ephemeral)
        defer { session.invalidateAndCancel() }
        let task = session.uploadTask(with: URLRequest(url: URL(string: "https://fixture.invalid/never-resumed")!), from: Data([1]))
        XCTAssertEqual(task.state, .suspended)
        XCTAssertThrowsError(try NativeBackgroundTaskBinding.persistBeforeResume(task) { throw WriteFailure.unavailable })
        XCTAssertTrue(task.state == .canceling || task.state == .completed)
        XCTAssertFalse(NativeBackgroundTaskBinding.matches(stored: nil, delivered: task.taskIdentifier))
        XCTAssertFalse(NativeBackgroundTaskBinding.matches(stored: task.taskIdentifier + 1, delivered: task.taskIdentifier))
        XCTAssertTrue(NativeBackgroundTaskBinding.matches(stored: task.taskIdentifier, delivered: task.taskIdentifier))
        XCTAssertFalse(NativeBackgroundTaskBinding.canRestore(stored: task.taskIdentifier, delivered: task.taskIdentifier, terminal: true), "A terminal row cannot regain a live slot while its canceled task is still delivered")
        XCTAssertTrue(NativeBackgroundTaskBinding.canRestore(stored: task.taskIdentifier, delivered: task.taskIdentifier, terminal: false))
    }

    func testBackgroundCompletionDeadlineAndInvalidAssertionEndExactlyOnce() async throws {
        var completed = 0, expired = 0, ended = 0
        let task = NativeBackgroundUploadCompletionTask(timeoutNanoseconds: 1_000_000,
            beginAssertion: { _ in UIBackgroundTaskIdentifier(rawValue: 123) }, endAssertion: { _ in ended += 1 },
            completion: { completed += 1 })
        task.expiration = { expired += 1 }
        try await Task.sleep(nanoseconds: 10_000_000)
        task.complete(true); task.complete(false)
        XCTAssertEqual(completed, 1); XCTAssertEqual(expired, 1); XCTAssertEqual(ended, 1)
        XCTAssertFalse(task.available)
        let invalid = NativeBackgroundUploadCompletionTask(beginAssertion: { _ in .invalid },
            endAssertion: { _ in XCTFail("No assertion to end") }, completion: { completed += 1 })
        XCTAssertFalse(invalid.available); invalid.complete(true)
        XCTAssertEqual(completed, 2)
    }

}
