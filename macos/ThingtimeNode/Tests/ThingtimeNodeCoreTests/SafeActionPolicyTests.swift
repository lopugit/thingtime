import XCTest
@testable import ThingtimeNodeCore

final class SafeActionPolicyTests: XCTestCase {
    private let policy = SafeActionPolicy()

    func testRemoteMutationRequiresApproval() {
        let decision = policy.evaluate(
            action: SafeActionRequest(kind: .setOutputVolume, parameters: ["volume": .number(0.5)]),
            context: SafeActionContext(origin: .remoteAccount, sessionLocked: false, userApproved: false)
        )
        guard case .requireApproval = decision else {
            return XCTFail("Expected approval requirement")
        }
    }

    func testLockedSessionDeniesMutationEvenWhenApproved() {
        let decision = policy.evaluate(
            action: SafeActionRequest(kind: .launchApplication, parameters: [
                "bundleIdentifier": .string("com.example.App")
            ]),
            context: SafeActionContext(origin: .remoteAccount, sessionLocked: true, userApproved: true)
        )
        guard case .deny = decision else { return XCTFail("Expected deny") }
    }

    func testQuitRequiresApprovalAndAValidBundleIdentifier() {
        let valid = SafeActionRequest(kind: .terminateApplication, parameters: [
            "bundleIdentifier": .string("com.example.App")
        ])
        guard case .requireApproval = policy.evaluate(
            action: valid,
            context: SafeActionContext(origin: .remoteAccount, sessionLocked: false, userApproved: false)
        ) else { return XCTFail("Expected approval requirement") }

        let invalid = SafeActionRequest(kind: .terminateApplication, parameters: [
            "bundleIdentifier": .string("")
        ])
        guard case .deny = policy.evaluate(
            action: invalid,
            context: SafeActionContext(origin: .remoteAccount, sessionLocked: false, userApproved: true)
        ) else { return XCTFail("Expected invalid bundle identifier to be denied") }
    }

    func testReadOnlyRefreshIsAllowedWhileLocked() {
        XCTAssertEqual(
            policy.evaluate(
                action: SafeActionRequest(kind: .refreshTelemetry),
                context: SafeActionContext(origin: .remoteAccount, sessionLocked: true, userApproved: false)
            ),
            .allow
        )
    }

    func testLockScreenRequiresApprovalAndAcceptsNoParameters() {
        let valid = SafeActionRequest(kind: .lockScreen)
        guard case .requireApproval = policy.evaluate(
            action: valid,
            context: SafeActionContext(origin: .remoteAccount, sessionLocked: false, userApproved: false)
        ) else { return XCTFail("Expected approval requirement") }

        let invalid = SafeActionRequest(kind: .lockScreen, parameters: ["command": .string("arbitrary")])
        guard case .deny = policy.evaluate(
            action: invalid,
            context: SafeActionContext(origin: .remoteAccount, sessionLocked: false, userApproved: true)
        ) else { return XCTFail("Expected unexpected parameters to be denied") }
    }

    func testInvalidParametersAreDenied() {
        let decision = policy.evaluate(
            action: SafeActionRequest(kind: .setOutputVolume, parameters: ["volume": .number(2)]),
            context: SafeActionContext(origin: .localUser, sessionLocked: false, userApproved: true)
        )
        guard case .deny = decision else { return XCTFail("Expected deny") }
    }

    func testBrightnessRequiresApprovalAndRejectsOutOfRangeValues() {
        let valid = SafeActionRequest(kind: .setDisplayBrightness, parameters: ["brightness": .number(0.7)])
        guard case .requireApproval = policy.evaluate(
            action: valid,
            context: SafeActionContext(origin: .remoteAccount, sessionLocked: false, userApproved: false)
        ) else { return XCTFail("Expected approval requirement") }

        let invalid = SafeActionRequest(kind: .setDisplayBrightness, parameters: ["brightness": .number(-0.1)])
        guard case .deny = policy.evaluate(
            action: invalid,
            context: SafeActionContext(origin: .localUser, sessionLocked: false, userApproved: true)
        ) else { return XCTFail("Expected invalid brightness to be denied") }
    }

    func testMainDisplayBrightnessSnapshotIsBoundedWhenAvailable() {
        guard let snapshot = SystemDisplayBrightness.snapshot(for: CGMainDisplayID()) else { return }
        XCTAssertTrue((0 ... 1).contains(snapshot.level))
        XCTAssertTrue(snapshot.canSet)
    }

    func testBrightnessSnapshotRejectsInvalidDriverValues() {
        XCTAssertEqual(
            SystemDisplayBrightness.normalizedSnapshot(level: 0.42, canSet: true),
            DisplayBrightnessSnapshot(level: 0.42, canSet: true)
        )
        XCTAssertNil(SystemDisplayBrightness.normalizedSnapshot(level: -0.01, canSet: true))
        XCTAssertNil(SystemDisplayBrightness.normalizedSnapshot(level: 1.01, canSet: true))
        XCTAssertNil(SystemDisplayBrightness.normalizedSnapshot(level: .infinity, canSet: true))
        XCTAssertNil(SystemDisplayBrightness.normalizedSnapshot(level: .nan, canSet: true))
    }

    @MainActor
    func testSessionLockMonitorUsesPublicWorkspaceNotifications() {
        let center = NotificationCenter()
        let monitor = SessionActivityMonitor(center: center, initiallyLocked: false)
        XCTAssertFalse(monitor.isLocked)

        center.post(name: NSWorkspace.sessionDidResignActiveNotification, object: nil)
        XCTAssertTrue(monitor.isLocked)

        center.post(name: NSWorkspace.sessionDidBecomeActiveNotification, object: nil)
        XCTAssertFalse(monitor.isLocked)
    }

    @MainActor
    func testSessionLockMonitorLaunchesFailClosedAndEstablishesActiveOrInactiveState() {
        let activeCenter = NotificationCenter()
        let active = SessionActivityMonitor(center: activeCenter)
        XCTAssertTrue(active.isLocked)
        active.establishAfterApplicationDidFinishLaunching()
        XCTAssertFalse(active.isLocked)

        let inactiveCenter = NotificationCenter()
        let inactive = SessionActivityMonitor(center: inactiveCenter)
        inactiveCenter.post(name: NSWorkspace.sessionDidResignActiveNotification, object: nil)
        inactive.establishAfterApplicationDidFinishLaunching()
        XCTAssertTrue(inactive.isLocked)
    }

    @MainActor
    func testCompatibilityLockSignalCanOnlyMakeStateMoreConservative() {
        XCTAssertTrue(DeviceTelemetryCollector.resolvedLockState(publicMonitorLocked: true, compatibilityValue: false))
        XCTAssertTrue(DeviceTelemetryCollector.resolvedLockState(publicMonitorLocked: true, compatibilityValue: nil))
        XCTAssertTrue(DeviceTelemetryCollector.resolvedLockState(publicMonitorLocked: false, compatibilityValue: true))
        XCTAssertFalse(DeviceTelemetryCollector.resolvedLockState(publicMonitorLocked: false, compatibilityValue: false))
        XCTAssertFalse(DeviceTelemetryCollector.resolvedLockState(publicMonitorLocked: false, compatibilityValue: "true"))
    }
}
