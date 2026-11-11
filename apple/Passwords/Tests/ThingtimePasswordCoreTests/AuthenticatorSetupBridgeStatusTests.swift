#if os(macOS)
import Foundation
import XCTest

@MainActor final class AuthenticatorSetupBridgeStatusTests: XCTestCase {
    func testNormalWebReviewMessagesDoNotReplaceNativeErrors() {
        let bridge = AuthenticatorSetupBridge()
        var notices: [String] = []
        bridge.onStatus = { notices.append($0) }
        bridge.report("The configured destination is unavailable.")
        bridge.report("Review the pending setup.", nativeNotice: false)
        XCTAssertEqual(notices, ["The configured destination is unavailable."])
    }

    func testVerifiedDestinationReplacesStaleSignInCopyAndRemainsNeutral() {
        let bridge = AuthenticatorSetupBridge()
        var notice: String?
        bridge.onStatus = { notice = $0 }
        bridge.report("Sign in to the configured account.")
        bridge.destinationVerified(URL(string: "https://thingtime.example")!)
        XCTAssertEqual(notice, "Destination: https://thingtime.example")
        bridge.report("Review the draft and select Save.", nativeNotice: false)
        XCTAssertEqual(notice, "Destination: https://thingtime.example")
        bridge.report("The pending setup expired.")
        XCTAssertEqual(notice, "The pending setup expired.")
    }
}
#endif
