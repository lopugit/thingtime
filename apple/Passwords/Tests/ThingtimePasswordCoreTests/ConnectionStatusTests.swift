import XCTest
@testable import ThingtimePasswordCore

final class ConnectionStatusTests: XCTestCase {
    @MainActor func testSuccessfulIndexRequiresCurrentSessionBeforeAndAfter() async throws {
        var events: [String] = []
        let status = try await PasswordConnectionSynchronization.perform(isCurrent: { events.append("current") },
            replace: { events.append("replace") }, clear: { events.append("clear") })
        XCTAssertEqual(status, .synchronized); XCTAssertEqual(events, ["current", "replace", "current"])
    }
    @MainActor func testDisabledIndexPreservesLinkAndReportsPendingEvenIfClearFails() async throws {
        var linked = true, clears = 0
        let status = try await PasswordConnectionSynchronization.perform(isCurrent: { XCTAssertTrue(linked) },
            replace: { throw PasswordProviderError.unavailable },
            clear: { clears += 1; throw PasswordProviderError.unavailable })
        XCTAssertEqual(status, .indexPending); XCTAssertTrue(linked); XCTAssertEqual(clears, 1)
        linked = false; XCTAssertFalse(linked) // Fixture state only; no session/Keychain operations.
    }
    @MainActor func testSupersededBeforeReplaceNeverTouchesIndex() async {
        do {
            _ = try await PasswordConnectionSynchronization.perform(isCurrent: { throw PasswordProviderError.invalidSession },
                replace: { XCTFail("No stale replace") }, clear: { XCTFail("No stale clear") })
            XCTFail("Must reject stale session")
        } catch {}
    }
    @MainActor func testSupersededSuccessfulReplaceClearsBeforeThrowing() async {
        var current = true, events: [String] = []
        do {
            _ = try await PasswordConnectionSynchronization.perform(isCurrent: { if !current { throw PasswordProviderError.invalidSession } },
                replace: { events.append("old-replace"); current = false }, clear: { events.append("old-clear") })
            XCTFail("Must not return old success")
        } catch {}
        XCTAssertEqual(events, ["old-replace", "old-clear"])
    }
    @MainActor func testFailedSupersededReplaceCannotReportLinkedStatus() async {
        var current = true, cleared = false
        do {
            _ = try await PasswordConnectionSynchronization.perform(isCurrent: { if !current { throw PasswordProviderError.invalidSession } },
                replace: { current = false; throw PasswordProviderError.unavailable }, clear: { cleared = true })
            XCTFail("Must reject old linkage result")
        } catch {}
        XCTAssertTrue(cleared)
    }
    @MainActor func testOldCleanupFinishesBeforeNewQueuedIndex() async throws {
        let queue = PasswordIdentityOperations(); var current = true; var release: CheckedContinuation<Void, Never>?
        var events: [String] = []
        let old = queue.submit {
            _ = try await PasswordConnectionSynchronization.perform(isCurrent: { if !current { throw PasswordProviderError.invalidSession } },
                replace: { events.append("old-replace"); await withCheckedContinuation { release = $0 } }, clear: { events.append("old-clear") })
        }
        while release == nil { await Task.yield() }
        current = false
        let next = queue.submit { events.append("new-replace") }
        release?.resume(); _ = try? await old.value; try await next.value
        XCTAssertEqual(events, ["old-replace", "old-clear", "new-replace"])
    }
    @MainActor func testFixedExitProtocolDoesNotReuseLegacySuccess() {
        XCTAssertEqual(PasswordConnectionStatus.synchronized.helperExitCode, 20)
        XCTAssertEqual(PasswordConnectionStatus.indexPending.helperExitCode, 21)
        XCTAssertEqual(PasswordConnectionStatus.disconnected.helperExitCode, 22)
        XCTAssertTrue(PasswordConnectionStatus.indexPending.message.contains("not synchronized"))
        for state in [PasswordConnectionStatus.synchronized, .indexPending, .disconnected] {
            XCTAssertEqual(state.exitCode(detailed: false), 0) // Older Electron consumes legacy exit0.
            XCTAssertEqual(state.exitCode(detailed: true), state.helperExitCode)
        }
    }
    @MainActor func testLiveAuthorityChangeDuringPostCallbackCheckClearsOldIndex() async {
        var checks = 0, current = true, cleared = false
        do {
            _ = try await PasswordConnectionSynchronization.perform(isCurrent: {
                checks += 1
                if checks == 2 { await Task.yield(); current = false }
                if !current { throw PasswordProviderError.invalidSession }
            }, replace: {}, clear: { cleared = true })
            XCTFail("A changed live browser authority must not return synchronized")
        } catch {}
        XCTAssertEqual(checks, 2); XCTAssertTrue(cleared)
    }

}
