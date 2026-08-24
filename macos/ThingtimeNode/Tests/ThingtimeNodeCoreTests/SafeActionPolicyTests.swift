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

        let extraParameter = SafeActionRequest(kind: .terminateApplication, parameters: [
            "bundleIdentifier": .string("com.example.App"),
            "force": .bool(true)
        ])
        guard case .deny = policy.evaluate(
            action: extraParameter,
            context: SafeActionContext(origin: .localUser, sessionLocked: false, userApproved: true)
        ) else { return XCTFail("Expected extra application parameters to be denied") }
    }

    func testForceQuitRequiresApprovalAndHideOthersAcceptsNoParameters() {
        let forceQuit = SafeActionRequest(kind: .forceTerminateApplication, parameters: [
            "bundleIdentifier": .string("com.example.App")
        ])
        guard case .requireApproval = policy.evaluate(
            action: forceQuit,
            context: SafeActionContext(origin: .remoteAccount, sessionLocked: false, userApproved: false)
        ) else { return XCTFail("Expected approval requirement for force quit") }

        XCTAssertEqual(
            policy.evaluate(
                action: SafeActionRequest(kind: .hideOtherApplications),
                context: SafeActionContext(origin: .localUser, sessionLocked: false, userApproved: true)
            ),
            .allow
        )
        guard case .deny = policy.evaluate(
            action: SafeActionRequest(kind: .hideOtherApplications, parameters: ["scope": .string("all")]),
            context: SafeActionContext(origin: .localUser, sessionLocked: false, userApproved: true)
        ) else { return XCTFail("Expected extra hide-other-apps parameters to be denied") }
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

    func testSleepRequiresApprovalAndAcceptsNoParameters() {
        let valid = SafeActionRequest(kind: .sleepSystem)
        guard case .requireApproval = policy.evaluate(
            action: valid,
            context: SafeActionContext(origin: .remoteAccount, sessionLocked: false, userApproved: false)
        ) else { return XCTFail("Expected sleep to require approval") }

        let invalid = SafeActionRequest(kind: .sleepSystem, parameters: ["now": .bool(true)])
        guard case .deny = policy.evaluate(
            action: invalid,
            context: SafeActionContext(origin: .localUser, sessionLocked: false, userApproved: true)
        ) else { return XCTFail("Expected unexpected sleep parameters to be denied") }
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

    func testDisplayConfigurationAndHardwareActionsStayClosed() {
        let displayMode = SafeActionRequest(kind: .setDisplayMode, parameters: [
            "displayId": .number(42), "modeId": .string("1920x1080@60000:0")
        ])
        guard case .requireApproval = policy.evaluate(
            action: displayMode,
            context: SafeActionContext(origin: .remoteAccount, sessionLocked: false, userApproved: false)
        ) else { return XCTFail("Expected display changes to require approval") }

        let mirroring = SafeActionRequest(kind: .setDisplayMirroring, parameters: [
            "displayId": .number(42), "sourceDisplayId": .null
        ])
        XCTAssertEqual(
            policy.evaluate(action: mirroring, context: SafeActionContext(origin: .localUser, sessionLocked: false, userApproved: true)),
            .allow
        )

        let invalidOrigin = SafeActionRequest(kind: .setDisplayOrigin, parameters: [
            "displayId": .number(42), "x": .number(0.5), "y": .number(0)
        ])
        guard case .deny = policy.evaluate(
            action: invalidOrigin,
            context: SafeActionContext(origin: .localUser, sessionLocked: false, userApproved: true)
        ) else { return XCTFail("Expected non-integral display coordinates to be denied") }

        let bluetooth = SafeActionRequest(kind: .setBluetoothDeviceConnected, parameters: ["id": .string("bt-opaque"), "connected": .bool(true)])
        guard case .requireApproval = policy.evaluate(
            action: bluetooth,
            context: SafeActionContext(origin: .remoteAccount, sessionLocked: false, userApproved: false)
        ) else { return XCTFail("Expected paired Bluetooth action to require approval") }

        let invalidPrinter = SafeActionRequest(kind: .setDefaultPrinter, parameters: ["id": .string("printer"), "path": .string("/tmp")])
        guard case .deny = policy.evaluate(
            action: invalidPrinter,
            context: SafeActionContext(origin: .localUser, sessionLocked: false, userApproved: true)
        ) else { return XCTFail("Expected unknown printer fields to be denied") }
    }

    func testLifecycleActionsAreArgumentFreeAndRequireApproval() {
        for kind in [SafeActionKind.restartSystem, .shutDownSystem, .logOutSession] {
            guard case .requireApproval = policy.evaluate(
                action: SafeActionRequest(kind: kind),
                context: SafeActionContext(origin: .remoteAccount, sessionLocked: false, userApproved: false)
            ) else { return XCTFail("Expected \(kind.rawValue) to require approval") }
            guard case .deny = policy.evaluate(
                action: SafeActionRequest(kind: kind, parameters: ["script": .string("do shell script")]),
                context: SafeActionContext(origin: .localUser, sessionLocked: false, userApproved: true)
            ) else { return XCTFail("Expected arbitrary lifecycle input to be denied") }
        }
    }

    func testAppleMusicPlaybackIsFixedAndRequiresApproval() {
        let play = SafeActionRequest(kind: .setAppleMusicPlayback, parameters: ["operation": .string("play")])
        guard case .requireApproval = policy.evaluate(
            action: play,
            context: SafeActionContext(origin: .remoteAccount, sessionLocked: false, userApproved: false)
        ) else { return XCTFail("Expected Apple Music playback to require approval") }

        let arbitrary = SafeActionRequest(kind: .setAppleMusicPlayback, parameters: ["operation": .string("do shell script")])
        guard case .deny = policy.evaluate(
            action: arbitrary,
            context: SafeActionContext(origin: .localUser, sessionLocked: false, userApproved: true)
        ) else { return XCTFail("Expected arbitrary Apple Music input to be denied") }

        let extra = SafeActionRequest(kind: .setAppleMusicPlayback, parameters: ["operation": .string("next"), "script": .string("tell application \"Finder\"")])
        guard case .deny = policy.evaluate(
            action: extra,
            context: SafeActionContext(origin: .localUser, sessionLocked: false, userApproved: true)
        ) else { return XCTFail("Expected unexpected Apple Music fields to be denied") }
    }

    func testSpotifyPlaybackIsFixedAndRequiresApproval() {
        let play = SafeActionRequest(kind: .setSpotifyPlayback, parameters: ["operation": .string("play")])
        guard case .requireApproval = policy.evaluate(
            action: play,
            context: SafeActionContext(origin: .remoteAccount, sessionLocked: false, userApproved: false)
        ) else { return XCTFail("Expected Spotify playback to require approval") }

        let arbitrary = SafeActionRequest(kind: .setSpotifyPlayback, parameters: ["operation": .string("do shell script")])
        guard case .deny = policy.evaluate(
            action: arbitrary,
            context: SafeActionContext(origin: .localUser, sessionLocked: false, userApproved: true)
        ) else { return XCTFail("Expected arbitrary Spotify input to be denied") }

        let extra = SafeActionRequest(kind: .setSpotifyPlayback, parameters: ["operation": .string("next"), "script": .string("tell application \"Finder\"")])
        guard case .deny = policy.evaluate(
            action: extra,
            context: SafeActionContext(origin: .localUser, sessionLocked: false, userApproved: true)
        ) else { return XCTFail("Expected unexpected Spotify fields to be denied") }
    }

    func testAudioRouteAndMuteActionsStayClosedAndRequireApproval() {
        let output = SafeActionRequest(kind: .setDefaultOutputDevice, parameters: ["deviceId": .string("BuiltInOutputDevice")])
        guard case .requireApproval = policy.evaluate(
            action: output,
            context: SafeActionContext(origin: .remoteAccount, sessionLocked: false, userApproved: false)
        ) else { return XCTFail("Expected approval requirement for output selection") }

        let muted = SafeActionRequest(kind: .setOutputMuted, parameters: ["muted": .bool(true)])
        guard case .requireApproval = policy.evaluate(
            action: muted,
            context: SafeActionContext(origin: .remoteAccount, sessionLocked: false, userApproved: false)
        ) else { return XCTFail("Expected approval requirement for mute") }

        let inputVolume = SafeActionRequest(kind: .setInputVolume, parameters: ["volume": .number(0.4)])
        guard case .requireApproval = policy.evaluate(
            action: inputVolume,
            context: SafeActionContext(origin: .remoteAccount, sessionLocked: false, userApproved: false)
        ) else { return XCTFail("Expected approval requirement for input volume") }

        let invalidSoundEffectsMute = SafeActionRequest(
            kind: .setSoundEffectsOutputMuted,
            parameters: ["muted": .bool(true), "unexpected": .bool(false)]
        )
        guard case .deny = policy.evaluate(
            action: invalidSoundEffectsMute,
            context: SafeActionContext(origin: .localUser, sessionLocked: false, userApproved: true)
        ) else { return XCTFail("Expected strict parameter denial for sound-effects mute") }

        let invalid = SafeActionRequest(kind: .setDefaultInputDevice, parameters: ["deviceId": .string("\n")])
        guard case .deny = policy.evaluate(
            action: invalid,
            context: SafeActionContext(origin: .localUser, sessionLocked: false, userApproved: true)
        ) else { return XCTFail("Expected invalid audio device identifier to be denied") }
    }

    func testWiFiActionsNeverAcceptPasswordsOrUnexpectedInput() {
        let connect = SafeActionRequest(kind: .connectWiFi, parameters: ["ssid": .string("Thingtime Guest")])
        guard case .requireApproval = policy.evaluate(
            action: connect,
            context: SafeActionContext(origin: .remoteAccount, sessionLocked: false, userApproved: false)
        ) else { return XCTFail("Expected approval requirement for Wi-Fi connection") }

        let passwordAttempt = SafeActionRequest(kind: .connectWiFi, parameters: [
            "ssid": .string("Thingtime Guest"),
            "password": .string("must-not-be-accepted")
        ])
        guard case .deny = policy.evaluate(
            action: passwordAttempt,
            context: SafeActionContext(origin: .localUser, sessionLocked: false, userApproved: true)
        ) else { return XCTFail("Wi-Fi passwords must be rejected before execution") }

        XCTAssertThrowsError(try SystemWiFi.validatedSSID(" leading-space"))
        XCTAssertThrowsError(try SystemWiFi.validatedSSID(String(repeating: "x", count: 33)))
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
