#if os(macOS)
import Foundation
import XCTest
import ThingtimePasswordCore

@MainActor final class AuthenticatorSetupBridgeStatusTests: XCTestCase {
    private let root = URL(string: "https://thingtime.example")!
    // RFC 6238's published fixture, never a real account credential.
    private var uri: URL { URL(string: "otpauth://totp/Example:synthetic?secret=" + ["GEZD", "GNBV", "GY3T", "QOJQ", "GEZD", "GNBV", "GY3T", "QOJQ"].joined())! }
    private func binding() -> AuthenticatorSetupInbox.Binding {
        .init(owner: "synthetic-owner", nonce: UUID().uuidString, generation: UUID())
    }

    func testConsumedIntakeAndEmptyInboxReloadDoNotReplayWorkflowInstructions() throws {
        let bridge = AuthenticatorSetupBridge(); defer { bridge.cancel() }
        bridge.offer(uri)
        let original = try XCTUnwrap(bridge.inbox.requestID)
        XCTAssertEqual(bridge.destinationVerified(root), "")
        let scope = binding()
        XCTAssertEqual(bridge.bindPendingSetup(scope), original, "Verified ready retains pending available guidance")
        bridge.offer(uri) // Duplicate cannot replace the original pending setup.
        XCTAssertEqual(bridge.inbox.requestID, original)
        XCTAssertNil(bridge.statusMessage, "Busy workflow guidance must not enter the replay cache")
        XCTAssertNotNil(bridge.consumePendingSetup(original, binding: scope))
        XCTAssertNil(bridge.inbox.requestID)
        bridge.navigationStarted()
        XCTAssertEqual(bridge.destinationVerified(root), "", "An empty-inbox reload emits a clear status, not stale sign-in/review copy")
        XCTAssertNil(bridge.statusMessage)
    }

    func testCancelledIntakeAndEmptyInboxReloadDoNotReplayWorkflowInstructions() throws {
        let bridge = AuthenticatorSetupBridge(); defer { bridge.cancel() }
        bridge.offer(uri)
        XCTAssertEqual(bridge.destinationVerified(root), "")
        XCTAssertNotNil(bridge.bindPendingSetup(binding()))
        bridge.report("Finish or cancel the pending setup.", kind: .workflow)
        bridge.cancel()
        XCTAssertNil(bridge.inbox.requestID)
        bridge.navigationStarted()
        XCTAssertEqual(bridge.destinationVerified(root), "")
        XCTAssertNil(bridge.statusMessage)
    }

    func testConsumeCancelAndReadyClearDoNotHideGenuineErrors() throws {
        let bridge = AuthenticatorSetupBridge(); defer { bridge.cancel() }
        var nativeNotice: String?
        bridge.onStatus = { nativeNotice = $0 }
        bridge.offer(uri)
        _ = bridge.destinationVerified(root)
        let scope = binding(), id = try XCTUnwrap(bridge.bindPendingSetup(scope))
        let error = "This link is not a supported TOTP setup code."
        bridge.report(error)
        bridge.report("Review the pending setup.", kind: .workflow)
        XCTAssertEqual(nativeNotice, error)
        XCTAssertNotNil(bridge.consumePendingSetup(id, binding: scope))
        bridge.cancel(); bridge.navigationStarted()
        XCTAssertEqual(bridge.statusMessage, error)
        XCTAssertEqual(bridge.destinationVerified(root), error)
        XCTAssertEqual(nativeNotice, error)
    }

    func testVerificationFailureSurvivesNewIntakeAndCancelUntilActualVerifiedReadiness() throws {
        let bridge = AuthenticatorSetupBridge()
        var nativeNotice: String?
        bridge.onStatus = { nativeNotice = $0 }
        let error = "Sign in to the configured account."
        bridge.report(error, kind: .verificationFailure)
        XCTAssertTrue(try bridge.acceptPendingSetup(uri.absoluteString))
        XCTAssertEqual(bridge.statusMessage, error, "A valid URI cannot resolve authentication failures")
        bridge.cancel(); bridge.navigationStarted()
        XCTAssertEqual(bridge.statusMessage, error)
        XCTAssertEqual(nativeNotice, error, "A page that cannot initialize keeps its native error")
        XCTAssertEqual(bridge.destinationVerified(root), "")
        XCTAssertNil(bridge.statusMessage)
        XCTAssertEqual(nativeNotice, "Destination: https://thingtime.example")
    }

    func testNewAcceptedIntakeSupersedesInvalidAndExpiredRequestErrors() throws {
        for expired in [false, true] {
            let bridge = AuthenticatorSetupBridge(); defer { bridge.cancel() }
            if expired {
                XCTAssertTrue(try bridge.acceptPendingSetup(uri.absoluteString))
                bridge.expirePendingSetup(try XCTUnwrap(bridge.inbox.requestID))
            } else {
                bridge.offer(URL(string: "otpauth://hotp/Unsupported")!)
            }
            let error = try XCTUnwrap(bridge.statusMessage)
            XCTAssertNil(bridge.inbox.requestID)
            XCTAssertThrowsError(try bridge.acceptPendingSetup("otpauth://hotp/Unsupported"))
            XCTAssertEqual(bridge.statusMessage, error, "A malformed offer cannot acknowledge the error")
            XCTAssertTrue(try bridge.acceptPendingSetup(uri.absoluteString))
            XCTAssertNil(bridge.statusMessage, "A newly accepted request supersedes the prior intake error")
            XCTAssertNotNil(bridge.inbox.requestID)
            XCTAssertEqual(bridge.destinationVerified(root), "")
        }
    }

    func testMalformedAndDuplicateOffersWithPendingIntakePreserveErrorAndOriginalRequest() throws {
        let bridge = AuthenticatorSetupBridge(); defer { bridge.cancel() }
        XCTAssertTrue(try bridge.acceptPendingSetup(uri.absoluteString))
        let original = try XCTUnwrap(bridge.inbox.requestID)
        let error = "The previous setup code was not supported."
        bridge.report(error)
        bridge.offer(URL(string: "otpauth://hotp/Unsupported")!)
        XCTAssertEqual(bridge.statusMessage, error)
        XCTAssertEqual(bridge.inbox.requestID, original)
        bridge.offer(uri)
        XCTAssertEqual(bridge.statusMessage, error)
        XCTAssertEqual(bridge.inbox.requestID, original)
        bridge.cancel()
        XCTAssertEqual(bridge.statusMessage, error, "Only accepted new intake, not cancellation, supersedes the error")
    }
}
#endif
