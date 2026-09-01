import Foundation
import XCTest
@testable import ThingtimeNodeCore

final class CommandJournalTests: XCTestCase {
    func testReplaysSamePayloadAndRejectsConflictingReuse() async throws {
        let url = temporaryURL("journal.json")
        let journal = try CommandJournal(fileURL: url, maxEntries: 8)
        let payload = Data("same-command".utf8)
        let disposition = try await journal.begin(commandId: "server-1", payload: payload)
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        XCTAssertEqual((attributes[.posixPermissions] as? NSNumber)?.intValue, 0o600)
        guard case let .execute(hash) = disposition else {
            return XCTFail("First delivery should execute")
        }
        let response = NodeResponse.success(id: "request-1", result: .string("done"))
        try await journal.finish(
            commandId: "server-1",
            payloadHash: hash,
            outcome: JournaledOutcome(response: response)
        )

        let replay = try await journal.begin(commandId: "server-1", payload: payload)
        XCTAssertEqual(replay, .replay(JournaledOutcome(response: response)))

        do {
            _ = try await journal.begin(commandId: "server-1", payload: Data("different".utf8))
            XCTFail("Conflicting reuse should fail")
        } catch {
            XCTAssertEqual(error as? ThingtimeNodeError, .commandConflict)
        }
    }

    func testRunningEntryRecoversAsUncertainAcrossRestart() async throws {
        let url = temporaryURL("journal.json")
        let first = try CommandJournal(fileURL: url)
        _ = try await first.begin(commandId: "server-2", payload: Data("payload".utf8))

        let recovered = try CommandJournal(fileURL: url)
        let recoveredDisposition = try await recovered.begin(
            commandId: "server-2",
            payload: Data("payload".utf8)
        )
        let recoveredEntry = await recovered.entry(commandId: "server-2")
        XCTAssertEqual(recoveredDisposition, .uncertain)
        XCTAssertEqual(recoveredEntry?.state, .uncertain)
    }

    func testExplicitlyRetryablePairingEntryCanExecuteAfterRestart() async throws {
        let url = temporaryURL("pairing-journal.json")
        let payload = Data("exact-pairing-command".utf8)
        let first = try CommandJournal(fileURL: url)
        guard case let .execute(hash) = try await first.begin(
            commandId: "pairing-1",
            payload: payload,
            retryableOnRecovery: true
        ) else {
            return XCTFail("Expected first execution")
        }
        let runningEntry = await first.entry(commandId: "pairing-1")
        XCTAssertEqual(runningEntry?.state, .runningRetryable)

        let recovered = try CommandJournal(fileURL: url)
        let disposition = try await recovered.begin(
            commandId: "pairing-1",
            payload: payload,
            retryableOnRecovery: true
        )
        guard case let .execute(recoveredHash) = disposition else {
            return XCTFail("An exact persisted pairing claim must be executable after restart")
        }
        XCTAssertEqual(recoveredHash, hash)
        let recoveredEntry = await recovered.entry(commandId: "pairing-1")
        XCTAssertEqual(recoveredEntry?.state, .runningRetryable)
    }

    func testBoundedJournalEvictsOnlyOldestTerminalEntry() async throws {
        let url = temporaryURL("journal.json")
        let journal = try CommandJournal(fileURL: url, maxEntries: 2)
        guard case let .execute(firstHash) = try await journal.begin(
            commandId: "first",
            payload: Data("one".utf8),
            now: Date(timeIntervalSince1970: 1)
        ) else { return XCTFail("Expected execute") }
        try await journal.finish(
            commandId: "first",
            payloadHash: firstHash,
            outcome: JournaledOutcome(response: .success(id: "1")),
            now: Date(timeIntervalSince1970: 2)
        )
        _ = try await journal.begin(
            commandId: "second",
            payload: Data("two".utf8),
            now: Date(timeIntervalSince1970: 3)
        )
        _ = try await journal.begin(
            commandId: "third",
            payload: Data("three".utf8),
            now: Date(timeIntervalSince1970: 4)
        )

        let first = await journal.entry(commandId: "first")
        let second = await journal.entry(commandId: "second")
        let third = await journal.entry(commandId: "third")
        let count = await journal.count()
        XCTAssertNil(first)
        XCTAssertNotNil(second)
        XCTAssertNotNil(third)
        XCTAssertEqual(count, 2)
    }

    func testJournalRefusesToEvictRunningOrUncertainEntries() async throws {
        let journal = try CommandJournal(fileURL: temporaryURL("journal.json"), maxEntries: 1)
        _ = try await journal.begin(commandId: "running", payload: Data("one".utf8))
        do {
            _ = try await journal.begin(commandId: "new", payload: Data("two".utf8))
            XCTFail("Capacity should fail closed")
        } catch {
            XCTAssertEqual(error as? ThingtimeNodeError, .journalCapacityReached)
        }
    }

    private func temporaryURL(_ name: String) -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ThingtimeNodeTests-\(UUID().uuidString)", isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        return directory.appendingPathComponent(name)
    }
}
