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
    case setDisplayBrightnessForDisplay = "system.display.brightness.set"
    case setDisplayMode = "system.display.mode.set"
    case setDisplayOrigin = "system.display.origin.set"
    case setDisplayMirroring = "system.display.mirroring.set"
    case setDefaultPrinter = "system.printer.default.set"
    case setPreferredCamera = "system.camera.preferred.set"
    case setBluetoothDeviceConnected = "system.bluetooth.device.connection.set"
    case setVPNConnected = "system.vpn.connection.set"
    case setPreventIdleSleep = "system.power.idle-sleep-prevention.set"
    case setPowerIdleTimer = "system.power.idle-timer.set"
    case proposeAirDropPolicy = "system.policy.airdrop.profile.propose"
    case proposeCameraPolicy = "system.policy.camera.profile.propose"
    case setAppleMusicPlayback = "system.media.apple-music.playback.set"
    case setAppleMusicVolume = "system.media.apple-music.volume.set"
    case setSpotifyPlayback = "system.media.spotify.playback.set"
    case setSpotifyVolume = "system.media.spotify.volume.set"
    case setChromeYouTubeVolume = "system.media.chrome-youtube.volume.set"
    case movePointer = "input.pointer.move"
    case clickPointer = "input.pointer.click"
    case scrollPointer = "input.pointer.scroll"
    case typeText = "input.keyboard.type"
    case sendShortcut = "input.keyboard.shortcut"
    case activateApplication = "application.activate"
    case launchApplication = "application.launch"
    case terminateApplication = "application.quit"
    case forceTerminateApplication = "application.force-quit"
    case hideApplication = "application.hide"
    case unhideApplication = "application.unhide"
    case hideOtherApplications = "application.hide-others"
    case lockScreen = "system.lock"
    case sleepSystem = "system.sleep"
    case restartSystem = "system.restart"
    case shutDownSystem = "system.shutdown"
    case logOutSession = "system.logout"
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
        case .lockScreen, .sleepSystem, .restartSystem, .shutDownSystem, .logOutSession, .hideOtherApplications:
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
            guard action.parameters.count == 1,
                  let brightness = action.parameters["brightness"]?.numberValue,
                  brightness.isFinite,
                  (0 ... 1).contains(brightness) else {
                return "system.brightness.set requires a numeric brightness between 0 and 1."
            }
            return nil
        case .setDisplayBrightnessForDisplay:
            guard action.parameters.count == 2,
                  validDisplayID(action.parameters["displayId"]),
                  let brightness = action.parameters["brightness"]?.numberValue,
                  brightness.isFinite,
                  (0 ... 1).contains(brightness) else {
                return "system.display.brightness.set requires a displayId and numeric brightness between 0 and 1."
            }
            return nil
        case .setDisplayMode:
            guard action.parameters.count == 2,
                  validDisplayID(action.parameters["displayId"]),
                  let modeID = action.parameters["modeId"]?.stringValue,
                  validIdentifier(modeID) else {
                return "system.display.mode.set requires only a displayId and advertised modeId."
            }
            return nil
        case .setDisplayOrigin:
            guard action.parameters.count == 3,
                  validDisplayID(action.parameters["displayId"]),
                  validCoordinate(action.parameters["x"]),
                  validCoordinate(action.parameters["y"]) else {
                return "system.display.origin.set requires a displayId and bounded integer x and y coordinates."
            }
            return nil
        case .setDisplayMirroring:
            guard action.parameters.count == 2,
                  validDisplayID(action.parameters["displayId"]),
                  validOptionalDisplayID(action.parameters["sourceDisplayId"]) else {
                return "system.display.mirroring.set requires a displayId and a displayId or null mirror source."
            }
            return nil
        case .setDefaultPrinter, .setPreferredCamera:
            guard action.parameters.count == 1,
                  let id = action.parameters["id"]?.stringValue,
                  validIdentifier(id) else {
                return "The requested hardware preference requires only an advertised id."
            }
            return nil
        case .setBluetoothDeviceConnected, .setVPNConnected:
            guard action.parameters.count == 2,
                  let id = action.parameters["id"]?.stringValue,
                  validIdentifier(id),
                  case .bool = action.parameters["connected"] else {
                return "The requested connection action requires an advertised id and boolean connected value."
            }
            return nil
        case .setPreventIdleSleep:
            guard action.parameters.count == 1, case .bool = action.parameters["enabled"] else {
                return "system.power.idle-sleep-prevention.set requires only a boolean enabled value."
            }
            return nil
        case .setPowerIdleTimer:
            guard action.parameters.count == 2,
                  SystemPowerTimers.isValid(
                    scope: action.parameters["scope"]?.stringValue,
                    minutes: action.parameters["minutes"]?.numberValue
                  ) else {
                return "system.power.idle-timer.set requires display, system, or disk scope and whole minutes from 0 to 180."
            }
            return nil
        case .proposeAirDropPolicy, .proposeCameraPolicy:
            guard action.parameters.count == 1, case .bool = action.parameters["enabled"] else {
                return "The policy proposal requires only a boolean enabled value."
            }
            return nil
        case .setAppleMusicPlayback:
            guard action.parameters.count == 1,
                  SystemAppleMusic.isValidOperation(action.parameters["operation"]?.stringValue) else {
                return "system.media.apple-music.playback.set requires only play, pause, next, or previous."
            }
            return nil
        case .setAppleMusicVolume:
            guard action.parameters.count == 1,
                  SystemAppleMusic.isValidVolume(action.parameters["level"]?.numberValue) else {
                return "system.media.apple-music.volume.set requires only a numeric level from 0 to 1."
            }
            return nil
        case .setSpotifyPlayback:
            guard action.parameters.count == 1,
                  SystemSpotify.isValidOperation(action.parameters["operation"]?.stringValue) else {
                return "system.media.spotify.playback.set requires only play, pause, next, or previous."
            }
            return nil
        case .setSpotifyVolume:
            guard action.parameters.count == 1,
                  SystemSpotify.isValidVolume(action.parameters["level"]?.numberValue) else {
                return "system.media.spotify.volume.set requires only a numeric level from 0 to 1."
            }
            return nil
        case .setChromeYouTubeVolume:
            guard action.parameters.count == 1,
                  SystemChromeYouTube.isValidVolume(action.parameters["level"]?.numberValue) else {
                return "system.media.chrome-youtube.volume.set requires only a numeric level from 0 to 1."
            }
            return nil
        case .movePointer:
            guard action.parameters.count == 3,
                  validDisplayID(action.parameters["displayId"]),
                  validNonnegativeCoordinate(action.parameters["x"]),
                  validNonnegativeCoordinate(action.parameters["y"]) else {
                return "input.pointer.move requires a displayId and nonnegative whole-pixel x and y coordinates."
            }
            return nil
        case .clickPointer:
            guard action.parameters.count == 4,
                  validDisplayID(action.parameters["displayId"]),
                  validNonnegativeCoordinate(action.parameters["x"]),
                  validNonnegativeCoordinate(action.parameters["y"]),
                  SystemRemoteInput.isValidButton(action.parameters["button"]?.stringValue) else {
                return "input.pointer.click requires a displayId, coordinates, and left, right, or middle button only."
            }
            return nil
        case .scrollPointer:
            guard action.parameters.count == 2,
                  SystemRemoteInput.isValidScroll(
                    deltaX: action.parameters["deltaX"]?.numberValue,
                    deltaY: action.parameters["deltaY"]?.numberValue
                  ) else {
                return "input.pointer.scroll requires bounded whole-pixel deltaX and deltaY values."
            }
            return nil
        case .typeText:
            guard action.parameters.count == 1,
                  SystemRemoteInput.isValidText(action.parameters["text"]?.stringValue) else {
                return "input.keyboard.type requires bounded text without unsafe control characters."
            }
            return nil
        case .sendShortcut:
            guard action.parameters.count == 2,
                  let key = action.parameters["key"]?.stringValue,
                  let modifiers = action.parameters["modifiers"]?.arrayValue?.compactMap({ $0.stringValue }),
                  SystemRemoteInput.isValidShortcut(key: key, modifiers: modifiers) else {
                return "input.keyboard.shortcut requires one allowlisted key and unique allowlisted modifiers."
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

    private func validDisplayID(_ value: JSONValue?) -> Bool {
        guard let value = value?.numberValue, value.isFinite, value >= 1, value <= Double(UInt32.max), value.rounded() == value else {
            return false
        }
        return true
    }

    private func validOptionalDisplayID(_ value: JSONValue?) -> Bool {
        if case .null? = value { return true }
        return validDisplayID(value)
    }

    private func validCoordinate(_ value: JSONValue?) -> Bool {
        guard let value = value?.numberValue, value.isFinite, value.rounded() == value else { return false }
        return value >= -32_768 && value <= 32_768
    }

    private func validNonnegativeCoordinate(_ value: JSONValue?) -> Bool {
        guard let value = value?.numberValue, value.isFinite, value.rounded() == value else { return false }
        return value >= 0 && value <= 32_768
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
        case .setDisplayBrightnessForDisplay:
            guard let displayID = displayID(from: action.parameters["displayId"]),
                  let brightness = action.parameters["brightness"]?.numberValue else {
                throw ThingtimeNodeError.invalidRequest("Missing display brightness parameters.")
            }
            try SystemDisplayBrightness.setDisplayBrightness(brightness, displayID: displayID)
            return .object(["displayId": .number(Double(displayID)), "brightness": .number(brightness)])
        case .setDisplayMode:
            guard let displayID = displayID(from: action.parameters["displayId"]),
                  let modeID = action.parameters["modeId"]?.stringValue else {
                throw ThingtimeNodeError.invalidRequest("Missing display mode parameters.")
            }
            try SystemDisplayConfiguration.setMode(displayID: displayID, modeID: modeID)
            return .object(["displayId": .number(Double(displayID)), "modeId": .string(modeID)])
        case .setDisplayOrigin:
            guard let displayID = displayID(from: action.parameters["displayId"]),
                  let x = action.parameters["x"]?.numberValue,
                  let y = action.parameters["y"]?.numberValue else {
                throw ThingtimeNodeError.invalidRequest("Missing display layout parameters.")
            }
            try SystemDisplayConfiguration.setOrigin(displayID: displayID, x: Int(x), y: Int(y))
            return .object(["displayId": .number(Double(displayID)), "x": .number(x), "y": .number(y)])
        case .setDisplayMirroring:
            guard let displayID = displayID(from: action.parameters["displayId"]) else {
                throw ThingtimeNodeError.invalidRequest("Missing display identifier.")
            }
            let sourceDisplayID = self.displayID(from: action.parameters["sourceDisplayId"])
            try SystemDisplayConfiguration.setMirroring(displayID: displayID, sourceDisplayID: sourceDisplayID)
            return .object([
                "displayId": .number(Double(displayID)),
                "sourceDisplayId": sourceDisplayID.map { JSONValue.number(Double($0)) } ?? JSONValue.null
            ])
        case .setDefaultPrinter:
            guard let id = action.parameters["id"]?.stringValue else { throw ThingtimeNodeError.invalidRequest("Missing printer identifier.") }
            try SystemPrinters.setDefault(id: id)
            return .object(["id": .string(id), "default": .bool(true)])
        case .setPreferredCamera:
            guard let id = action.parameters["id"]?.stringValue else { throw ThingtimeNodeError.invalidRequest("Missing camera identifier.") }
            try SystemCameras.setPreferred(id: id)
            return .object(["id": .string(id), "preferred": .bool(true)])
        case .setBluetoothDeviceConnected:
            guard let id = action.parameters["id"]?.stringValue,
                  case let .bool(connected)? = action.parameters["connected"] else {
                throw ThingtimeNodeError.invalidRequest("Missing Bluetooth connection parameters.")
            }
            try SystemBluetooth.setConnected(id: id, connected: connected)
            return .object(["id": .string(id), "connected": .bool(connected)])
        case .setVPNConnected:
            guard let id = action.parameters["id"]?.stringValue,
                  case let .bool(connected)? = action.parameters["connected"] else {
                throw ThingtimeNodeError.invalidRequest("Missing VPN connection parameters.")
            }
            try SystemVPN.setConnected(id: id, connected: connected)
            return .object(["id": .string(id), "connected": .bool(connected)])
        case .setPreventIdleSleep:
            guard case let .bool(enabled)? = action.parameters["enabled"] else {
                throw ThingtimeNodeError.invalidRequest("Missing keep-awake state.")
            }
            try telemetry.setPreventIdleSleep(enabled)
            return .object(["enabled": .bool(enabled)])
        case .setPowerIdleTimer:
            guard let scope = action.parameters["scope"]?.stringValue,
                  let rawMinutes = action.parameters["minutes"]?.numberValue,
                  rawMinutes.isFinite,
                  rawMinutes.rounded() == rawMinutes else {
                throw ThingtimeNodeError.invalidRequest("Missing power idle timer parameters.")
            }
            let minutes = try SystemPowerTimers.set(scope: scope, minutes: Int(rawMinutes))
            return .object(["scope": .string(scope), "minutes": .number(Double(minutes))])
        case .proposeAirDropPolicy, .proposeCameraPolicy:
            guard case let .bool(enabled)? = action.parameters["enabled"] else {
                throw ThingtimeNodeError.invalidRequest("Missing policy proposal state.")
            }
            let scope: SystemConfigurationProfileProposal.Scope = action.kind == .proposeAirDropPolicy ? .airDrop : .camera
            let profileURL = try await SystemConfigurationProfileProposal.propose(scope: scope, enabled: enabled)
            return .object([
                "scope": .string(scope.rawValue),
                "enabled": .bool(enabled),
                "profileProposed": .bool(true),
                "installationRequired": .bool(true),
                "profileFileName": .string(profileURL.lastPathComponent)
            ])
        case .setAppleMusicPlayback:
            guard let operation = action.parameters["operation"]?.stringValue else {
                throw ThingtimeNodeError.invalidRequest("Missing Apple Music operation.")
            }
            try SystemAppleMusic.perform(operation: operation)
            // Apple Events returning normally does not prove the player reached
            // the requested state, so retain a journalled recovery boundary.
            throw ThingtimeNodeError.commandOutcomeUncertain
        case .setAppleMusicVolume:
            guard let level = action.parameters["level"]?.numberValue else {
                throw ThingtimeNodeError.invalidRequest("Missing Apple Music volume.")
            }
            try SystemAppleMusic.setVolume(level: level)
            throw ThingtimeNodeError.commandOutcomeUncertain
        case .setSpotifyPlayback:
            guard let operation = action.parameters["operation"]?.stringValue else {
                throw ThingtimeNodeError.invalidRequest("Missing Spotify operation.")
            }
            try SystemSpotify.perform(operation: operation)
            // A normally returned Apple Event cannot prove the external player
            // reached its state; resolve through the journalled recovery path.
            throw ThingtimeNodeError.commandOutcomeUncertain
        case .setSpotifyVolume:
            guard let level = action.parameters["level"]?.numberValue else {
                throw ThingtimeNodeError.invalidRequest("Missing Spotify volume.")
            }
            try SystemSpotify.setVolume(level: level)
            throw ThingtimeNodeError.commandOutcomeUncertain
        case .setChromeYouTubeVolume:
            guard let level = action.parameters["level"]?.numberValue else {
                throw ThingtimeNodeError.invalidRequest("Missing Chrome YouTube volume.")
            }
            try SystemChromeYouTube.setVolume(level: level)
            // Chrome confirms the DOM property only; retain the same recovery
            // boundary as the app Apple Events rather than claiming audible
            // playback was independently observed.
            throw ThingtimeNodeError.commandOutcomeUncertain
        case .movePointer:
            guard let displayID = displayID(from: action.parameters["displayId"]),
                  let x = action.parameters["x"]?.numberValue,
                  let y = action.parameters["y"]?.numberValue else {
                throw ThingtimeNodeError.invalidRequest("Missing pointer move parameters.")
            }
            try SystemRemoteInput.move(displayID: displayID, x: x, y: y)
            // Quartz can enqueue an event but cannot prove that the intended
            // target accepted it, so retain the journal's recovery boundary.
            throw ThingtimeNodeError.commandOutcomeUncertain
        case .clickPointer:
            guard let displayID = displayID(from: action.parameters["displayId"]),
                  let x = action.parameters["x"]?.numberValue,
                  let y = action.parameters["y"]?.numberValue,
                  let button = action.parameters["button"]?.stringValue else {
                throw ThingtimeNodeError.invalidRequest("Missing pointer click parameters.")
            }
            try SystemRemoteInput.click(displayID: displayID, x: x, y: y, button: button)
            throw ThingtimeNodeError.commandOutcomeUncertain
        case .scrollPointer:
            guard let deltaX = action.parameters["deltaX"]?.numberValue,
                  let deltaY = action.parameters["deltaY"]?.numberValue else {
                throw ThingtimeNodeError.invalidRequest("Missing pointer scroll parameters.")
            }
            try SystemRemoteInput.scroll(deltaX: deltaX, deltaY: deltaY)
            throw ThingtimeNodeError.commandOutcomeUncertain
        case .typeText:
            guard let text = action.parameters["text"]?.stringValue else {
                throw ThingtimeNodeError.invalidRequest("Missing text input.")
            }
            try SystemRemoteInput.type(text: text)
            throw ThingtimeNodeError.commandOutcomeUncertain
        case .sendShortcut:
            guard let key = action.parameters["key"]?.stringValue,
                  let modifiers = action.parameters["modifiers"]?.arrayValue?.compactMap({ $0.stringValue }) else {
                throw ThingtimeNodeError.invalidRequest("Missing keyboard shortcut parameters.")
            }
            try SystemRemoteInput.shortcut(key: key, modifiers: modifiers)
            throw ThingtimeNodeError.commandOutcomeUncertain
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
        case .restartSystem:
            try SystemLifecycle.restart()
            throw ThingtimeNodeError.commandOutcomeUncertain
        case .shutDownSystem:
            try SystemLifecycle.shutDown()
            throw ThingtimeNodeError.commandOutcomeUncertain
        case .logOutSession:
            try SystemLifecycle.logOut()
            throw ThingtimeNodeError.commandOutcomeUncertain
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

    private func displayID(from value: JSONValue?) -> UInt32? {
        guard let number = value?.numberValue, number.isFinite, number >= 1, number <= Double(UInt32.max), number.rounded() == number else {
            return nil
        }
        return UInt32(number)
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

/// Restart, shutdown, and logout are deliberately fixed Apple Events. The
/// node never accepts script text, shell fragments, application names, or a
/// capability to automate anything else. Each operation is always presented
/// as an approval card by the service and is journalled as uncertain because
/// the process may terminate before it can confirm the terminal system effect.
public enum SystemLifecycle {
    public static func restart() throws { try run("tell application \"System Events\" to restart") }
    public static func shutDown() throws { try run("tell application \"System Events\" to shut down") }
    public static func logOut() throws { try run("tell application \"System Events\" to log out") }

    private static func run(_ source: String) throws {
        guard let script = NSAppleScript(source: source) else {
            throw ThingtimeNodeError.policyDenied("macOS could not prepare the requested system lifecycle action.")
        }
        var error: NSDictionary?
        script.executeAndReturnError(&error)
        if let error {
            let message = (error[NSAppleScript.errorMessage] as? String) ?? "System Events returned an unknown error."
            throw ThingtimeNodeError.policyDenied("macOS did not accept the requested system lifecycle action: \(message)")
        }
    }
}
