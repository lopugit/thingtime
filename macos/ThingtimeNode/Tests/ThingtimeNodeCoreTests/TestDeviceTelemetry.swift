import Foundation
import XCTest
@testable import ThingtimeNodeCore

/// Controller tests exercise the real routing and journal without querying or
/// changing the test host's devices, privacy permissions or power assertions.
@MainActor
final class TestDeviceTelemetry: DeviceTelemetryProviding {
    var session = SessionTelemetry(isLocked: false, isOnConsole: true)
    private(set) var snapshotReads = 0
    private(set) var sessionReads = 0

    func snapshot(now: Date) -> DeviceTelemetry {
        snapshotReads += 1
        return DeviceTelemetry(
            deviceName: "Test Mac", hostName: "test-mac.invalid",
            modelIdentifier: "TestMac1,1", operatingSystemVersion: "Test OS",
            architecture: "test", outputVolume: nil, session: session,
            permissions: permissionPreflight(), runningApplications: [],
            displays: [], collectedAt: now
        )
    }

    func sessionSnapshot() -> SessionTelemetry {
        sessionReads += 1
        return session
    }

    func batterySnapshot() -> BatteryTelemetry {
        BatteryTelemetry(level: nil, isCharging: nil, isExternalPower: nil, isPreventingIdleSleep: false)
    }

    func permissionPreflight() -> PermissionPreflight {
        PermissionPreflight(accessibility: .denied, screenRecording: .denied)
    }

    func requestPermission(_ kind: ThingtimePermissionKind) -> PermissionPreflight {
        XCTFail("Controller tests must not request host privacy permissions")
        return permissionPreflight()
    }

    func setPreventIdleSleep(_ enabled: Bool) throws {
        XCTFail("Controller tests must not change host power assertions")
    }
}
