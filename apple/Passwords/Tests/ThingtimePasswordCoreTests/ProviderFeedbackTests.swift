import XCTest
@testable import ThingtimePasswordCore

final class ProviderFeedbackTests: XCTestCase {
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
