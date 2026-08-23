import AppKit
import ApplicationServices
import Foundation
import IOKit.pwr_mgt

public enum ActionOrigin: String, Codable, Equatable, Sendable {
    case localUser
    case remoteAccount
}

public enum SafeActionKind: String, Codable, Equatable, Sendable {
    case refreshTelemetry = "telemetry.refresh"
    case setOutputVolume = "system.volume.set"
    case setOutputMuted = "system.audio.mute.set"
    case setInputVolume = "system.audio.input.volume.set"
    case setInputMuted = "system.audio.input.mute.set"
    case setSoundEffectsOutputVolume = "system.audio.sound-effects.volume.set"
    case setSoundEffectsOutputMuted = "system.audio.sound-effects.mute.set"
    case setDefaultOutputDevice = "system.audio.output.set"
    case setDefaultInputDevice = "system.audio.input.set"
    case setDefaultSoundEffectsOutputDevice = "system.audio.sound-effects-output.set"
    case setDisplayBrightness = "system.brightness.set"
    case activateApplication = "application.activate"
    case launchApplication = "application.launch"
    case terminateApplication = "application.quit"
    case forceTerminateApplication = "application.force-quit"
    case hideApplication = "application.hide"
    case unhideApplication = "application.unhide"
    case hideOtherApplications = "application.hide-others"
    case lockScreen = "system.lock"
    case sleepSystem = "system.sleep"
    case connectWiFi = "system.wifi.connect"
    case disconnectWiFi = "system.wifi.disconnect"
    case setWiFiPower = "system.wifi.power.set"
}

public struct SafeActionRequest: Codable, Equatable, Sendable {
    public let kind: SafeActionKind
    public let parameters: [String: JSONValue]

    public init(kind: SafeActionKind, parameters: [String: JSONValue] = [:]) {
        self.kind = kind
        self.parameters = parameters
    }
}

public struct SafeActionContext: Codable, Equatable, Sendable {
    public let origin: ActionOrigin
    public let sessionLocked: Bool
    public let userApproved: Bool

    public init(origin: ActionOrigin, sessionLocked: Bool, userApproved: Bool) {
        self.origin = origin
        self.sessionLocked = sessionLocked
        self.userApproved = userApproved
    }
}

public enum ActionPolicyDecision: Codable, Equatable, Sendable {
    case allow
    case requireApproval(reason: String)
    case deny(reason: String)
}

public struct SafeActionPolicy: Sendable {
    public init() {}

    public func evaluate(action: SafeActionRequest, context: SafeActionContext) -> ActionPolicyDecision {
        if let invalid = validateParameters(action) {
            return .deny(reason: invalid)
        }
        if action.kind == .refreshTelemetry {
            return .allow
        }
        if context.sessionLocked {
            return .deny(reason: "Remote computer control is disabled while the user session is locked.")
        }
        if context.origin == .remoteAccount, !context.userApproved {
            return .requireApproval(reason: "This computer action requires explicit approval.")
        }
        return .allow
    }

    private func validateParameters(_ action: SafeActionRequest) -> String? {
        switch action.kind {
        case .refreshTelemetry:
            return action.parameters.isEmpty ? nil : "telemetry.refresh does not accept parameters."
        case .lockScreen, .sleepSystem, .hideOtherApplications:
            return action.parameters.isEmpty ? nil : "The requested system power action does not accept parameters."
        case .setOutputVolume, .setInputVolume, .setSoundEffectsOutputVolume:
            guard let volume = action.parameters["volume"]?.numberValue, (0 ... 1).contains(volume) else {
                return "The requested audio level must be a number between 0 and 1."
            }
            return nil
        case .setOutputMuted, .setInputMuted, .setSoundEffectsOutputMuted:
            guard action.parameters.count == 1, case .bool = action.parameters["muted"] else {
                return "The requested audio mute action requires only a boolean muted value."
            }
            return nil
        case .setDefaultOutputDevice, .setDefaultInputDevice, .setDefaultSoundEffectsOutputDevice:
            guard action.parameters.count == 1,
                  let id = action.parameters["deviceId"]?.stringValue,
                  validIdentifier(id) else {
                return "The audio route action requires only a valid deviceId."
            }
            return nil
        case .setDisplayBrightness:
            guard let brightness = action.parameters["brightness"]?.numberValue,
                  brightness.isFinite,
                  (0 ... 1).contains(brightness) else {
                return "system.brightness.set requires a numeric brightness between 0 and 1."
            }
            return nil
        case .activateApplication, .launchApplication, .terminateApplication, .forceTerminateApplication, .hideApplication, .unhideApplication:
            guard action.parameters.count == 1,
                  let bundleID = action.parameters["bundleIdentifier"]?.stringValue,
                  validIdentifier(bundleID) else {
                return "The action requires a valid bundleIdentifier."
            }
            return nil
        case .connectWiFi:
            guard action.parameters.count == 1,
                  let ssid = action.parameters["ssid"]?.stringValue,
                  (try? SystemWiFi.validatedSSID(ssid)) != nil else {
                return "system.wifi.connect requires only a valid visible SSID and never accepts a password."
            }
            return nil
        case .disconnectWiFi:
            return action.parameters.isEmpty ? nil : "system.wifi.disconnect does not accept parameters."
        case .setWiFiPower:
            guard action.parameters.count == 1, case .bool = action.parameters["enabled"] else {
                return "system.wifi.power.set requires only a boolean enabled value."
            }
            return nil
        }
    }

    private func validIdentifier(_ value: String) -> Bool {
        !value.isEmpty &&
            value == value.trimmingCharacters(in: .whitespacesAndNewlines) &&
            value.utf8.count <= 512 &&
            value.rangeOfCharacter(from: .controlCharacters) == nil
    }
}

@MainActor
public final class SafeActionExecutor {
    private let policy: SafeActionPolicy
    private let telemetry: DeviceTelemetryCollector

    public init(policy: SafeActionPolicy = SafeActionPolicy(), telemetry: DeviceTelemetryCollector) {
        self.policy = policy
        self.telemetry = telemetry
    }

    public func evaluate(action: SafeActionRequest, context: SafeActionContext) -> ActionPolicyDecision {
        policy.evaluate(action: action, context: context)
    }

    public func execute(action: SafeActionRequest, context: SafeActionContext) async throws -> JSONValue {
        switch policy.evaluate(action: action, context: context) {
        case .allow:
            break
        case let .requireApproval(reason):
            throw ThingtimeNodeError.approvalRequired(reason)
        case let .deny(reason):
            throw ThingtimeNodeError.policyDenied(reason)
        }

        switch action.kind {
        case .refreshTelemetry:
            return try JSONValue.from(telemetry.snapshot())
        case .setOutputVolume:
            guard let volume = action.parameters["volume"]?.numberValue else {
                throw ThingtimeNodeError.invalidRequest("Missing volume.")
            }
            try SystemAudio.setOutputVolume(volume)
            return .object(["volume": .number(volume)])
        case .setOutputMuted:
            guard case let .bool(muted)? = action.parameters["muted"] else {
                throw ThingtimeNodeError.invalidRequest("Missing mute state.")
            }
            try SystemAudio.setOutputMuted(muted)
            return .object(["muted": .bool(muted)])
        case .setInputVolume:
            guard let volume = action.parameters["volume"]?.numberValue else {
                throw ThingtimeNodeError.invalidRequest("Missing input volume.")
            }
            try SystemAudio.setInputVolume(volume)
            return .object(["volume": .number(volume), "route": .string("input")])
        case .setInputMuted:
            guard case let .bool(muted)? = action.parameters["muted"] else {
                throw ThingtimeNodeError.invalidRequest("Missing input mute state.")
            }
            try SystemAudio.setInputMuted(muted)
            return .object(["muted": .bool(muted), "route": .string("input")])
        case .setSoundEffectsOutputVolume:
            guard let volume = action.parameters["volume"]?.numberValue else {
                throw ThingtimeNodeError.invalidRequest("Missing sound-effects volume.")
            }
            try SystemAudio.setSoundEffectsOutputVolume(volume)
            return .object(["volume": .number(volume), "route": .string("sound-effects-output")])
        case .setSoundEffectsOutputMuted:
            guard case let .bool(muted)? = action.parameters["muted"] else {
                throw ThingtimeNodeError.invalidRequest("Missing sound-effects mute state.")
            }
            try SystemAudio.setSoundEffectsOutputMuted(muted)
            return .object(["muted": .bool(muted), "route": .string("sound-effects-output")])
        case .setDefaultOutputDevice:
            guard let id = action.parameters["deviceId"]?.stringValue else {
                throw ThingtimeNodeError.invalidRequest("Missing audio output device identifier.")
            }
            try SystemAudio.setDefaultOutputDevice(id: id)
            return .object(["deviceId": .string(id), "route": .string("output")])
        case .setDefaultInputDevice:
            guard let id = action.parameters["deviceId"]?.stringValue else {
                throw ThingtimeNodeError.invalidRequest("Missing audio input device identifier.")
            }
            try SystemAudio.setDefaultInputDevice(id: id)
            return .object(["deviceId": .string(id), "route": .string("input")])
        case .setDefaultSoundEffectsOutputDevice:
            guard let id = action.parameters["deviceId"]?.stringValue else {
                throw ThingtimeNodeError.invalidRequest("Missing sound-effects output device identifier.")
            }
            try SystemAudio.setDefaultSoundEffectsOutputDevice(id: id)
            return .object(["deviceId": .string(id), "route": .string("sound-effects-output")])
        case .setDisplayBrightness:
            guard let brightness = action.parameters["brightness"]?.numberValue else {
                throw ThingtimeNodeError.invalidRequest("Missing brightness.")
            }
            try SystemDisplayBrightness.setMainDisplayBrightness(brightness)
            return .object(["brightness": .number(brightness)])
        case .activateApplication:
            guard let bundleID = action.parameters["bundleIdentifier"]?.stringValue,
                  let application = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first else {
                throw ThingtimeNodeError.policyDenied("The requested application is not running.")
            }
            guard application.activate(options: [.activateIgnoringOtherApps]) else {
                throw ThingtimeNodeError.policyDenied("macOS did not activate the requested application.")
            }
            return .object(["bundleIdentifier": .string(bundleID), "activated": .bool(true)])
        case .launchApplication:
            guard let bundleID = action.parameters["bundleIdentifier"]?.stringValue,
                  let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID) else {
                throw ThingtimeNodeError.policyDenied("The requested application is not installed.")
            }
            let configuration = NSWorkspace.OpenConfiguration()
            configuration.activates = true
            _ = try await NSWorkspace.shared.openApplication(at: url, configuration: configuration)
            return .object(["bundleIdentifier": .string(bundleID), "launched": .bool(true)])
        case .terminateApplication:
            guard let bundleID = action.parameters["bundleIdentifier"]?.stringValue,
                  let application = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first else {
                throw ThingtimeNodeError.policyDenied("The requested application is not running.")
            }
            guard application.terminate() else {
                throw ThingtimeNodeError.policyDenied("macOS did not allow the requested application to quit.")
            }
            return .object(["bundleIdentifier": .string(bundleID), "quitRequested": .bool(true)])
        case .forceTerminateApplication:
            guard let bundleID = action.parameters["bundleIdentifier"]?.stringValue,
                  let application = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first else {
                throw ThingtimeNodeError.policyDenied("The requested application is not running.")
            }
            guard application.forceTerminate() else {
                throw ThingtimeNodeError.policyDenied("macOS did not allow the requested application to force quit.")
            }
            return .object(["bundleIdentifier": .string(bundleID), "forceQuitRequested": .bool(true)])
        case .hideApplication, .unhideApplication:
            guard let bundleID = action.parameters["bundleIdentifier"]?.stringValue,
                  let application = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first else {
                throw ThingtimeNodeError.policyDenied("The requested application is not running.")
            }
            let changed = action.kind == .hideApplication ? application.hide() : application.unhide()
            guard changed else {
                throw ThingtimeNodeError.policyDenied("macOS did not change the requested application visibility.")
            }
            return .object([
                "bundleIdentifier": .string(bundleID),
                "hidden": .bool(action.kind == .hideApplication)
            ])
        case .hideOtherApplications:
            NSWorkspace.shared.hideOtherApplications()
            return .object(["otherApplicationsHidden": .bool(true)])
        case .lockScreen:
            try SystemSession.lockScreen()
            for attempt in 0 ..< 20 {
                if telemetry.snapshot().session.isLocked {
                    return .object(["locked": .bool(true)])
                }
                if attempt < 19 { try await Task.sleep(for: .milliseconds(100)) }
            }
            // The shortcut was posted, but macOS never exposed the resulting
            // lock state. Do not turn an ambiguous device effect into success.
            throw ThingtimeNodeError.commandOutcomeUncertain
        case .sleepSystem:
            try SystemPower.sleep()
            return .object(["sleepRequested": .bool(true)])
        case .connectWiFi:
            guard let ssid = action.parameters["ssid"]?.stringValue else {
                throw ThingtimeNodeError.invalidRequest("Missing Wi-Fi network name.")
            }
            try SystemWiFi.connect(ssid: ssid)
            return .object(["ssid": .string(ssid), "connected": .bool(true)])
        case .disconnectWiFi:
            try SystemWiFi.disconnect()
            return .object(["disconnected": .bool(true)])
        case .setWiFiPower:
            guard case let .bool(enabled)? = action.parameters["enabled"] else {
                throw ThingtimeNodeError.invalidRequest("Missing Wi-Fi power state.")
            }
            try SystemWiFi.setPower(enabled)
            return .object(["enabled": .bool(enabled)])
        }
    }
}

public enum SystemSession {
    /// Uses macOS's built-in Control-Command-Q shortcut through Quartz. This is
    /// a closed, argument-free action and requires the node's Accessibility
    /// grant; it does not invoke a shell, AppleScript, or a private framework.
    public static func lockScreen() throws {
        guard AXIsProcessTrusted() else {
            throw ThingtimeNodeError.policyDenied("Locking this Mac requires Accessibility permission for Thingtime Node.")
        }
        guard let source = CGEventSource(stateID: .hidSystemState),
              let keyDown = CGEvent(keyboardEventSource: source, virtualKey: 0x0C, keyDown: true),
              let keyUp = CGEvent(keyboardEventSource: source, virtualKey: 0x0C, keyDown: false) else {
            throw ThingtimeNodeError.policyDenied("macOS could not create the lock-screen action.")
        }
        let modifiers: CGEventFlags = [.maskControl, .maskCommand]
        keyDown.flags = modifiers
        keyUp.flags = modifiers
        keyDown.post(tap: .cghidEventTap)
        keyUp.post(tap: .cghidEventTap)
    }
}

public enum SystemPower {
    public static func sleep() throws {
        let connection = IOPMFindPowerManagement(kIOMainPortDefault)
        guard connection != 0 else {
            throw ThingtimeNodeError.policyDenied("macOS power management is unavailable.")
        }
        defer { IOServiceClose(connection) }
        guard IOPMSleepSystem(connection) == kIOReturnSuccess else {
            throw ThingtimeNodeError.policyDenied("macOS did not accept the sleep request.")
        }
    }
}
