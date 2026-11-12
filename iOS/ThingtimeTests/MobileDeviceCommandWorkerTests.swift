import XCTest
@testable import Thingtime

@MainActor
final class MobileDeviceCommandWorkerTests: XCTestCase {
    private let scope = try! MobileDevicePairing.Scope(ownerId: "synthetic-owner", url: URL(string: "https://example.test")!)
    private func command(kind: String = "notification.show", approved: Bool = true) -> MobileDeviceCommandWorker.Command {
        .init(id: "synthetic-command", kind: kind, input: [:], leaseId: "synthetic-lease",
              leaseExpiresAt: Date().addingTimeInterval(60), approved: approved)
    }
    func testLostReportAcknowledgementCannotReplayAudibleAction() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        var executions = 0, reports: [String] = [], lose = true
        let worker = MobileDeviceCommandWorker(journal: .init(root: root), report: { _, event, status in
            reports.append(event + ":" + status)
            if status == "succeeded", lose { throw URLError(.networkConnectionLost) }
        }, execute: { _, check in try check(); executions += 1 })
        do { try await worker.perform(command(), scope: scope, check: {}); XCTFail("Expected lost report response") } catch { }
        lose = false
        try await worker.perform(command(), scope: scope, check: {})
        XCTAssertEqual(executions, 1)
        XCTAssertEqual(reports[1], reports[2], "Terminal report identity survives uncertain acknowledgement")
    }
    func testStartedJournalAfterCrashRequiresReviewAndNeverReplays() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let journal = MobileDeviceCommandJournal(root: root)
        try journal.write(.init(commandId: "synthetic-command", kind: "notification.show", eventId: UUID().uuidString, outcome: "started"), scope: scope)
        var statuses: [String] = []
        let worker = MobileDeviceCommandWorker(journal: journal, report: { _, _, status in statuses.append(status) },
            execute: { _, _ in XCTFail("Uncertain command replayed") })
        try await worker.perform(command(), scope: scope, check: {})
        XCTAssertEqual(statuses, ["needs-review"])
    }
    func testUnsupportedOrUnapprovedCommandCannotExecute() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        var statuses: [String] = []
        let worker = MobileDeviceCommandWorker(journal: .init(root: root), report: { _, _, status in statuses.append(status) },
            execute: { _, _ in XCTFail("Unsupported command executed") })
        try await worker.perform(command(kind: "script.run"), scope: scope, check: {})
        try await worker.perform(command(approved: false), scope: scope, check: {})
        XCTAssertEqual(statuses, ["failed", "failed"])
    }
}
