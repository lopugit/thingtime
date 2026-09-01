import XCTest
@testable import ThingtimeNodeCore

final class BridgeParentPolicyTests: XCTestCase {
    func testAcceptsStableDirectParentFromSameTeamAndExactApplicationIdentifier() {
        XCTAssertTrue(ThingtimeNodeBridgeParentPolicy.accepts(evidence()))
    }

    func testRejectsLaunchdOrKernelParent() {
        XCTAssertFalse(ThingtimeNodeBridgeParentPolicy.accepts(evidence(initialParent: 1, finalParent: 1)))
        XCTAssertFalse(ThingtimeNodeBridgeParentPolicy.accepts(evidence(initialParent: 0, finalParent: 0)))
    }

    func testRejectsParentChangeDuringSignatureValidation() {
        XCTAssertFalse(ThingtimeNodeBridgeParentPolicy.accepts(evidence(initialParent: 123, finalParent: 1)))
        XCTAssertFalse(ThingtimeNodeBridgeParentPolicy.accepts(evidence(initialParent: 123, finalParent: 456)))
    }

    func testRejectsMissingMalformedOrLowercaseTeamIdentifier() {
        for invalidTeamIdentifier in [nil, "", "ABCDE1234", "ABCDE123456", "6dqq9v7c84", "ABCDE12-45"] {
            XCTAssertFalse(ThingtimeNodeBridgeParentPolicy.accepts(evidence(bridgeTeamIdentifier: invalidTeamIdentifier)))
        }
    }

    func testRejectsNonElectronParentEvenWhenItIsAppleAnchoredAndFromTheSameTeam() {
        for identifier in ["com.apple.Terminal", "com.thingtime.desktop.node", "com.thingtime.desktop.node.bridge"] {
            XCTAssertFalse(ThingtimeNodeBridgeParentPolicy.accepts(evidence(parentIdentifier: identifier)))
        }
    }

    func testRejectsDifferentTeamOrMissingAppleGenericAnchor() {
        XCTAssertFalse(ThingtimeNodeBridgeParentPolicy.accepts(evidence(parentTeamIdentifier: "ABCDE12345")))
        XCTAssertFalse(ThingtimeNodeBridgeParentPolicy.accepts(evidence(bridgeHasAppleAnchor: false)))
        XCTAssertFalse(ThingtimeNodeBridgeParentPolicy.accepts(evidence(parentHasAppleAnchor: false)))
    }

    func testRejectsMissingSigningIdentity() {
        XCTAssertFalse(ThingtimeNodeBridgeParentPolicy.accepts(evidence(bridgeIdentityPresent: false)))
        XCTAssertFalse(ThingtimeNodeBridgeParentPolicy.accepts(evidence(parentIdentityPresent: false)))
    }

    private func evidence(
        initialParent: Int32 = 123,
        finalParent: Int32 = 123,
        bridgeIdentifier: String? = "com.thingtime.desktop.node.bridge",
        parentIdentifier: String? = "com.thingtime.desktop",
        bridgeTeamIdentifier: String? = "6DQQ9V7C84",
        parentTeamIdentifier: String? = "6DQQ9V7C84",
        bridgeHasAppleAnchor: Bool = true,
        parentHasAppleAnchor: Bool = true,
        bridgeIdentityPresent: Bool = true,
        parentIdentityPresent: Bool = true
    ) -> ThingtimeNodeBridgeParentEvidence {
        ThingtimeNodeBridgeParentEvidence(
            initialParentProcessIdentifier: initialParent,
            finalParentProcessIdentifier: finalParent,
            bridgeIdentity: bridgeIdentityPresent ? ThingtimeNodeBridgeCodeIdentity(
                identifier: bridgeIdentifier,
                teamIdentifier: bridgeTeamIdentifier,
                hasAppleGenericAnchor: bridgeHasAppleAnchor
            ) : nil,
            parentIdentity: parentIdentityPresent ? ThingtimeNodeBridgeCodeIdentity(
                identifier: parentIdentifier,
                teamIdentifier: parentTeamIdentifier,
                hasAppleGenericAnchor: parentHasAppleAnchor
            ) : nil
        )
    }
}
