import XCTest
@testable import ThingtimePasswordCore

final class ProviderFeedbackTests: XCTestCase {
    func testRegistrationStartsOnceForEitherPresentationOrder() {
        for appearsFirst in [false, true] {
            var start = PasswordProviderRegistrationStart()
            if appearsFirst { start.setVisible(true) }
            start.prepare()
            if !appearsFirst {
                XCTAssertFalse(start.takeStart(), "Preparation must not prompt before the provider appears")
                start.setVisible(true)
            }
            XCTAssertTrue(start.takeStart())
            XCTAssertFalse(start.takeStart(), "Repeated readiness callbacks must not duplicate registration")
            start.setVisible(false)
            start.setVisible(true)
            XCTAssertFalse(start.takeStart(), "Reappearance must not repeat device verification")
        }
    }

    func testCancelledPendingRegistrationCannotStartWhenViewAppears() {
        var start = PasswordProviderRegistrationStart()
        start.prepare()
        start.reset()
        start.setVisible(true)
        XCTAssertFalse(start.takeStart())
        start.prepare()
        XCTAssertTrue(start.takeStart(), "A replacement OS request may start in an already-visible provider")
    }

    func testFailedAutomaticRegistrationRequiresExplicitRetryAndKeepsRequestFence() throws {
        var start = PasswordProviderRegistrationStart()
        var requests = PasswordProviderRequests()
        start.prepare()
        start.setVisible(true)
        XCTAssertTrue(start.takeStart())
        let automatic = try XCTUnwrap(requests.start())
        XCTAssertNil(requests.start())
        XCTAssertTrue(requests.finish(automatic))
        start.setVisible(false)
        start.setVisible(true)
        XCTAssertFalse(start.takeStart(), "A failed attempt must not enter an automatic retry loop")
        let retry = try XCTUnwrap(requests.start(), "The explicit Retry action can start another attempt")
        requests.reset()
        start.reset()
        XCTAssertFalse(requests.finish(retry), "Cancellation fences a late retry completion")
        XCTAssertFalse(start.takeStart())
    }

    func testReplacingRequestRejectsOldCompletionAndDoubleSubmission() throws {
        var requests = PasswordProviderRequests()
        let old = try XCTUnwrap(requests.start())
        XCTAssertNil(requests.start())
        requests.reset()
        let current = try XCTUnwrap(requests.start())
        XCTAssertFalse(requests.isCurrent(old))
        XCTAssertFalse(requests.finish(old))
        XCTAssertNil(requests.start(), "A stale completion must not unlock the new request")
        XCTAssertTrue(requests.finish(current))
        XCTAssertNotNil(requests.start(), "The current request can be retried after it finishes")
    }

    func testReconnectedSessionRequiresNewCeremonyWithoutRetryingOldKey() throws {
        let initial = try ProviderSession(origin: URL(string: "https://example.com")!, ownerId: "synthetic", cookie: "tt_auth=first-session")
        let reconnected = try ProviderSession(origin: initial.origin, ownerId: initial.ownerId, cookie: "tt_auth=rotated-session")
        XCTAssertNoThrow(try initial.requireUnchanged(from: initial))
        XCTAssertThrowsError(try reconnected.requireUnchanged(from: initial)) { error in
            XCTAssertEqual(error as? PasswordProviderError, .sessionChanged)
        }
        XCTAssertFalse(PasswordProviderError.sessionChanged.allowsRetryInCurrentRequest)
        XCTAssertTrue(PasswordProviderError.invalidSession.allowsRetryInCurrentRequest)
        let message = PasswordProviderPhase.confirming.failure(.sessionChanged)
        XCTAssertTrue(message.contains("Cancel this request"))
        XCTAssertTrue(message.contains("start again from the website"))
        XCTAssertFalse(message.contains("try again"))
    }

    func testCancellationAndNetworkRecoveryDoNotAskForReconnect() {
        for phase in PasswordProviderPhase.allCases {
            XCTAssertFalse(phase.failure(.cancelled).contains("expired"))
            XCTAssertFalse(phase.failure(.cancelled).contains("reconnect"))
            XCTAssertFalse(phase.failure(.networkUnavailable).contains("expired"))
            XCTAssertFalse(phase.failure(.permissionDenied).contains("expired"))
        }
        XCTAssertTrue(PasswordProviderPhase.connection.failure(.invalidSession).contains("Connect Password AutoFill"))
        XCTAssertTrue(PasswordProviderPhase.verification.failure(.sessionUnavailable).contains("Unlock"))
    }

    func testPostWriteRecoveryPreservesPasskeyAndExplainsSavedState() {
        XCTAssertTrue(PasswordProviderPhase.saving.failure(.networkUnavailable).contains("same passkey"))
        XCTAssertTrue(PasswordProviderPhase.confirming.failure(.networkUnavailable).contains("same passkey"))
        XCTAssertTrue(PasswordProviderPhase.indexing.failure(.unavailable).contains("passkey is saved"))
        XCTAssertTrue(PasswordProviderPhase.indexing.failure(.unavailable).contains("AutoFill & Passwords"))
    }

    func testAttemptConfirmsExactKeyAndOwnerHandle() throws {
        let attempt = try PasskeyRegistrationAttempt(relyingParty: "example.com", userHandle: Data([1, 2, 3]), username: "test")
        let retained = attempt
        XCTAssertEqual(attempt.recordID, retained.recordID)
        XCTAssertEqual(attempt.writeID, retained.writeID)
        XCTAssertEqual(attempt.key.entry, retained.key.entry)
        XCTAssertTrue(try attempt.matches(attempt.key.entry))
        let other = try PasskeyRegistrationAttempt(relyingParty: "example.com", userHandle: Data([1, 2, 3]), username: "test")
        XCTAssertFalse(try attempt.matches(other.key.entry))
        var wrongHandle = attempt.key.entry
        wrongHandle.fields = wrongHandle.fields.map { field in
            field.id == "userHandle" ? PasswordField(field.id, field.label, field.type, Data([4]).base64URL) : field
        }
        XCTAssertFalse(try attempt.matches(wrongHandle))
    }
}
