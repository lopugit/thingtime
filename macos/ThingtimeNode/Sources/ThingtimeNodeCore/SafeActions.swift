import AppKit
import ApplicationServices
import Foundation

public enum ActionOrigin: String, Codable, Equatable, Sendable {
    case localUser
    case remoteAccount
}

public enum SafeActionKind: String, Codable, Equatable, Sendable {
    case refreshTelemetry = "telemetry.refresh"
    case setOutputVolume = "system.volume.set"
    case setDisplayBrightness = "system.brightness.set"
    case activateApplication = "application.activate"
    case launchApplication = "application.launch"
    case terminateApplication = "application.quit"
    case lockScreen = "system.lock"
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
        case .lockScreen:
            return action.parameters.isEmpty ? nil : "system.lock does not accept parameters."
        case .setOutputVolume:
            guard let volume = action.parameters["volume"]?.numberValue, (0 ... 1).contains(volume) else {
                return "system.volume.set requires a numeric volume between 0 and 1."
            }
            return nil
        case .setDisplayBrightness:
            guard let brightness = action.parameters["brightness"]?.numberValue,
                  brightness.isFinite,
                  (0 ... 1).contains(brightness) else {
                return "system.brightness.set requires a numeric brightness between 0 and 1."
            }
            return nil
        case .activateApplication, .launchApplication, .terminateApplication:
            guard let bundleID = action.parameters["bundleIdentifier"]?.stringValue,
                  !bundleID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  bundleID.utf8.count <= 255 else {
                return "The action requires a valid bundleIdentifier."
            }
            return nil
        }
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
