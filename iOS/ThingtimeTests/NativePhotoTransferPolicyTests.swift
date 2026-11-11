import AppleFileSync
import XCTest
@testable import Thingtime

@MainActor
final class NativePhotoTransferPolicyTests: XCTestCase {
    private func scope(_ owner: String = "owner", _ origin: String = "https://sync.test") throws -> FileSyncOwnerScope {
        try FileSyncOwnerScope(ownerId: owner, url: URL(string: origin)!)
    }
    func testPolicyPersistenceExactUnsetAndAccountOriginDeviceFolderIsolation() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let owner = try scope(), store = NativePhotoTransferPolicyStore(directory: directory)
        let device = NativePhotoTransferPolicy(uploadBytesPerSecond: 100, uploadBytesPerHour: 1_000)
        let folder = NativePhotoTransferPolicy(uploadBytesPerSecond: 20, uploadBytesPerHour: nil)
        try store.save(device, scope: owner, deviceId: "device")
        try store.save(folder, scope: owner, deviceId: "device", rootId: "photos")
        let reopened = NativePhotoTransferPolicyStore(directory: directory)
        XCTAssertEqual(try reopened.read(scope: owner, deviceId: "device"), device)
        XCTAssertEqual(try reopened.read(scope: owner, deviceId: "device", rootId: "photos"), folder)
        XCTAssertEqual(try reopened.read(scope: owner, deviceId: "other"), .unlimited)
        XCTAssertEqual(try reopened.read(scope: scope("other"), deviceId: "device"), .unlimited)
        XCTAssertEqual(try reopened.read(scope: scope("owner", "https://other.test"), deviceId: "device"), .unlimited)
        XCTAssertEqual(try reopened.read(scope: owner, deviceId: "device", rootId: "other"), .unlimited)
        try reopened.save(.unlimited, scope: owner, deviceId: "device", rootId: "photos")
        XCTAssertTrue(try reopened.read(scope: owner, deviceId: "device", rootId: "photos").json.isEmpty)
        XCTAssertEqual(try reopened.read(scope: owner, deviceId: "device"), device)
    }
    func testPolicyRejectsBooleanFractionNonPositiveOverflowAndUnknownFields() throws {
        for value: [String: Any] in [["uploadBytesPerSecond": true], ["uploadBytesPerSecond": 1.5],
            ["uploadBytesPerHour": 0], ["uploadBytesPerHour": -1], ["uploadBytesPerHour": Double.infinity],
            ["uploadBytesPerHour": 9_007_199_254_740_992.0], ["unknown": 1], ["uploadBytesPerHour": NSNull()]] {
            XCTAssertThrowsError(try NativePhotoTransferPolicy.parse(value))
        }
        XCTAssertEqual(try NativePhotoTransferPolicy.parse([:]), .unlimited)
        XCTAssertEqual(try NativePhotoTransferPolicy.parse(["uploadBytesPerHour": 9_007_199_254_740_991 as Int64]).uploadBytesPerHour, 9_007_199_254_740_991)
    }
    func testHourlyDeviceAndFolderLimitsAggregateAcrossConfigurationsAndSurviveRelaunch() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let owner = try scope(), now = Date(timeIntervalSince1970: 1_800_000_000)
        let budget = NativePhotoUploadBudget(directory: directory)
        let first = try budget.reserve(scope: owner, deviceId: "device", bytes: 40, cap: 60, rootId: "photos", configurationId: "first", deviceCap: 100, folderCap: 70, now: now)
        XCTAssertThrowsError(try budget.reserve(scope: owner, deviceId: "device", bytes: 21, cap: 60, rootId: "photos", configurationId: "first", deviceCap: 100, folderCap: 70, now: now))
        let second = try budget.reserve(scope: owner, deviceId: "device", bytes: 30, cap: 60, rootId: "photos", configurationId: "copied", deviceCap: 100, folderCap: 70, now: now)
        XCTAssertThrowsError(try budget.reserve(scope: owner, deviceId: "device", bytes: 1, cap: 60, rootId: "photos", configurationId: "third", deviceCap: 100, folderCap: 70, now: now))
        let reopened = NativePhotoUploadBudget(directory: directory)
        _ = try reopened.reserve(scope: owner, deviceId: "device", bytes: 30, cap: 60, rootId: "other", configurationId: "fourth", deviceCap: 100, now: now)
        XCTAssertThrowsError(try reopened.reserve(scope: owner, deviceId: "device", bytes: 1, cap: 60, rootId: "other", configurationId: "fifth", deviceCap: 100, now: now))
        // Definitive zero-byte cancellation releases only the exact reservation.
        try reopened.finish(second, observedBytes: 0, now: now)
        _ = try reopened.reserve(scope: owner, deviceId: "device", bytes: 30, cap: 60, rootId: "photos", configurationId: "copied", deviceCap: 100, folderCap: 70, now: now)
        try reopened.finish(first, observedBytes: 40, now: now)
        // Lowered preferences do not reset either settled or uncertain usage.
        XCTAssertThrowsError(try reopened.reserve(scope: owner, deviceId: "device", bytes: 1, cap: nil, rootId: "photos", configurationId: "new", deviceCap: 50, now: now))
        _ = try reopened.reserve(scope: scope("other"), deviceId: "device", bytes: 50, cap: nil, deviceCap: 50, now: now)
    }
    func testLegacyUnscopedUsageCannotBeFreedByAddingFolderOrConfigurationLimits() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let owner = try scope(), now = Date(timeIntervalSince1970: 1_800_000_000)
        let budget = NativePhotoUploadBudget(directory: directory)
        let lease = try budget.reserve(scope: owner, deviceId: "device", bytes: 60, cap: nil, now: now)
        try budget.finish(lease, observedBytes: 60, now: now)
        XCTAssertThrowsError(try NativePhotoUploadBudget(directory: directory).reserve(scope: owner, deviceId: "device", bytes: 1, cap: 60, rootId: "photos", configurationId: "new", folderCap: 60, now: now))
    }
    func testScopedCalendarSharesDeviceAndFolderSchedulesButIndependentConfigurationBudgets() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let now = Date(timeIntervalSince1970: 1_800_000_000), expiry = now.addingTimeInterval(600)
        let calendar = NativeBackgroundUploadCalendar(directory: directory)
        func rates(_ folder: String, _ configuration: String) -> [NativePhotoRateConstraint] {
            [.init(key: "device", rate: 10), .init(key: "folder:" + folder, rate: 5), .init(key: "configuration:" + configuration, rate: 20)]
        }
        XCTAssertEqual(try calendar.admit(key: "owner-device", bytes: 100, constraints: rates("photos", "one"), expiry: expiry, now: now), now)
        XCTAssertEqual(try NativeBackgroundUploadCalendar(directory: directory).admit(key: "owner-device", bytes: 100, constraints: rates("photos", "two"), expiry: expiry, now: now), now.addingTimeInterval(20))
        XCTAssertEqual(try calendar.admit(key: "owner-device", bytes: 100, constraints: rates("other", "three"), expiry: expiry, now: now), now.addingTimeInterval(30))
        XCTAssertEqual(try calendar.admit(key: "other-owner", bytes: 100, constraints: rates("photos", "one"), expiry: expiry, now: now), now)
    }
    func testSlowPartsUseActualSignerStartDeadlineAndFutureWaitsDoNotConsumeAllowance() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let calendar = NativeBackgroundUploadCalendar(directory: directory)
        let now = Date(timeIntervalSince1970: 1_800_000_000), rates: [NativePhotoRateConstraint] = [.init(key: "device", rate: 1)]
        // The background daemon emits one authorized part, then defers later
        // parts to preserve average payload admission even at very low rates.
        XCTAssertEqual(try calendar.admit(key: "daemon", bytes: 1_000, constraints: rates, expiry: now.addingTimeInterval(120), now: now,
            requiresCompletionBeforeExpiry: false, deferFutureAdmission: true), now)
        for _ in 0..<3 {
            XCTAssertThrowsError(try calendar.admit(key: "daemon", bytes: 1_000, constraints: rates, expiry: now.addingTimeInterval(120), now: now,
                requiresCompletionBeforeExpiry: false, deferFutureAdmission: true)) { error in
                XCTAssertEqual((error as? NativePhotoUploadBudget.Wait)?.retryAt, now.addingTimeInterval(1_000))
            }
        }
        // Fresh signing at the due time succeeds; the failed attempts did not
        // keep moving the calendar into an unreachable future.
        XCTAssertEqual(try NativeBackgroundUploadCalendar(directory: directory).admit(key: "daemon", bytes: 1_000, constraints: rates,
            expiry: now.addingTimeInterval(1_120), now: now.addingTimeInterval(1_000), requiresCompletionBeforeExpiry: false,
            deferFutureAdmission: true), now.addingTimeInterval(1_000))
        // Refuse a stale signer before charging any allowance.
        XCTAssertThrowsError(try calendar.admit(key: "foreground", bytes: 1_000, constraints: rates,
            expiry: now.addingTimeInterval(10), now: now, requiresCompletionBeforeExpiry: false, deferFutureAdmission: true))
        XCTAssertEqual(try calendar.admit(key: "foreground", bytes: 1_000, constraints: rates,
            expiry: now.addingTimeInterval(120), now: now, requiresCompletionBeforeExpiry: false, deferFutureAdmission: true), now)
    }
    func testSignedExpiryRequiresExactPartReceiptAndNeverInventsRelativeLifetime() throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000), expiry = now.addingTimeInterval(120)
        let receipt: [String: Any] = ["ok": true, "parts": [["partNumber": 1, "expiresAt": ISO8601DateFormatter().string(from: expiry)]]]
        XCTAssertEqual(try NativeFileSession.signedUploadExpiry(receipt, partNumber: 1, now: now), expiry)
        XCTAssertThrowsError(try NativeFileSession.signedUploadExpiry(receipt, partNumber: 2, now: now))
        XCTAssertThrowsError(try NativeFileSession.signedUploadExpiry(["ok": true, "parts": [["partNumber": 1]]], partNumber: 1, now: now))
        XCTAssertThrowsError(try NativeFileSession.signedUploadExpiry(receipt, partNumber: 1, now: expiry))
    }
    func testFiveDaemonStartsReserveOneDurableAggregateScheduleWithinActualSignerExpiry() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let now = Date(timeIntervalSince1970: 1_800_000_000), expiry = now.addingTimeInterval(120)
        let constraints: [NativePhotoRateConstraint] = [.init(key: "device", rate: 10), .init(key: "folder:photos", rate: 20),
            .init(key: "configuration:one", rate: 50)]
        for index in 0..<5 {
            let calendar = NativeBackgroundUploadCalendar(directory: directory)
            XCTAssertEqual(try calendar.admit(key: "owner-device", bytes: 100, constraints: constraints, expiry: expiry,
                now: now, requiresCompletionBeforeExpiry: false), now.addingTimeInterval(Double(index * 10)))
        }
        let calendar = NativeBackgroundUploadCalendar(directory: directory)
        // A refused sixth admission cannot move the already reserved schedule.
        XCTAssertThrowsError(try calendar.admit(key: "owner-device", bytes: 100, constraints: constraints,
            expiry: now.addingTimeInterval(60), now: now, requiresCompletionBeforeExpiry: false))
        XCTAssertEqual(try calendar.admit(key: "owner-device", bytes: 100, constraints: constraints, expiry: expiry,
            now: now, requiresCompletionBeforeExpiry: false), now.addingTimeInterval(50))
    }
    func testForegroundWaitCannotBorrowOrMoveAlreadyAdmittedDaemonSlots() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let now = Date(timeIntervalSince1970: 1_800_000_000), expiry = now.addingTimeInterval(120)
        let rates: [NativePhotoRateConstraint] = [.init(key: "device", rate: 10)]
        let calendar = NativeBackgroundUploadCalendar(directory: directory)
        for _ in 0..<5 { _ = try calendar.admit(key: "shared", bytes: 100, constraints: rates, expiry: expiry,
            now: now, requiresCompletionBeforeExpiry: false) }
        for _ in 0..<3 {
            XCTAssertThrowsError(try calendar.admit(key: "shared", bytes: 100, constraints: rates, expiry: expiry,
                now: now, requiresCompletionBeforeExpiry: false, deferFutureAdmission: true)) { error in
                XCTAssertEqual((error as? NativePhotoUploadBudget.Wait)?.retryAt, now.addingTimeInterval(50))
            }
        }
        XCTAssertEqual(try calendar.admit(key: "shared", bytes: 100, constraints: rates, expiry: expiry,
            now: now.addingTimeInterval(50), requiresCompletionBeforeExpiry: false, deferFutureAdmission: true), now.addingTimeInterval(50))
    }

}
