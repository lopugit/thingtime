import AppKit
import ApplicationServices
import AudioToolbox
import CoreAudio
import CoreGraphics
import Darwin
import Foundation
import IOKit
import IOKit.graphics
import OSLog

public enum PermissionPreflightState: String, Codable, Equatable, Sendable {
    case granted
    case denied
}

public enum ThingtimePermissionKind: String, Codable, Equatable, Sendable {
    case accessibility
    case screenRecording = "screen-recording"
}

public struct PermissionPreflight: Codable, Equatable, Sendable {
    public let accessibility: PermissionPreflightState
    public let screenRecording: PermissionPreflightState

    public init(accessibility: PermissionPreflightState, screenRecording: PermissionPreflightState) {
        self.accessibility = accessibility
        self.screenRecording = screenRecording
    }
}

public struct RunningApplicationTelemetry: Codable, Equatable, Sendable {
    public let processIdentifier: Int32
    public let bundleIdentifier: String?
    public let name: String?
    public let isActive: Bool
    public let isHidden: Bool

    public init(
        processIdentifier: Int32,
        bundleIdentifier: String?,
        name: String?,
        isActive: Bool,
        isHidden: Bool
    ) {
        self.processIdentifier = processIdentifier
        self.bundleIdentifier = bundleIdentifier
        self.name = name
        self.isActive = isActive
        self.isHidden = isHidden
    }
}

public struct DisplayTelemetry: Codable, Equatable, Sendable {
    public let displayID: UInt32
    public let width: Int
    public let height: Int
    public let isMain: Bool
    public let isBuiltIn: Bool
    public let brightness: Double?
    public let brightnessControlSupported: Bool

    public init(
        displayID: UInt32,
        width: Int,
        height: Int,
        isMain: Bool,
        isBuiltIn: Bool,
        brightness: Double? = nil,
        brightnessControlSupported: Bool = false
    ) {
        self.displayID = displayID
        self.width = width
        self.height = height
        self.isMain = isMain
        self.isBuiltIn = isBuiltIn
        self.brightness = brightness
        self.brightnessControlSupported = brightnessControlSupported
    }
}

public struct SessionTelemetry: Codable, Equatable, Sendable {
    public let isLocked: Bool
    public let isOnConsole: Bool

    public init(isLocked: Bool, isOnConsole: Bool) {
        self.isLocked = isLocked
        self.isOnConsole = isOnConsole
    }
}

public struct DeviceTelemetry: Codable, Equatable, Sendable {
    public let deviceName: String
    public let hostName: String
    public let modelIdentifier: String?
    public let operatingSystemVersion: String
    public let architecture: String
    public let outputVolume: Double?
    public let session: SessionTelemetry
    public let permissions: PermissionPreflight
    public let runningApplications: [RunningApplicationTelemetry]
    public let displays: [DisplayTelemetry]
    public let collectedAt: Date

    public init(
        deviceName: String,
        hostName: String,
        modelIdentifier: String?,
        operatingSystemVersion: String,
        architecture: String,
        outputVolume: Double?,
        session: SessionTelemetry,
        permissions: PermissionPreflight,
        runningApplications: [RunningApplicationTelemetry],
        displays: [DisplayTelemetry],
        collectedAt: Date
    ) {
        self.deviceName = deviceName
        self.hostName = hostName
        self.modelIdentifier = modelIdentifier
        self.operatingSystemVersion = operatingSystemVersion
        self.architecture = architecture
        self.outputVolume = outputVolume
        self.session = session
        self.permissions = permissions
        self.runningApplications = runningApplications
        self.displays = displays
        self.collectedAt = collectedAt
    }
}

public enum ThingtimeNodeLog {
    public static let lifecycle = Logger(subsystem: "com.thingtime.desktop.node", category: "lifecycle")
    public static let connector = Logger(subsystem: "com.thingtime.desktop.node", category: "connector")
    public static let actions = Logger(subsystem: "com.thingtime.desktop.node", category: "actions")
}

@MainActor
public final class DeviceTelemetryCollector {
    private let sessionActivity: SessionActivityMonitor

    public init() {
        sessionActivity = SessionActivityMonitor()
    }

    init(sessionActivity: SessionActivityMonitor) {
        self.sessionActivity = sessionActivity
    }

    /// Call from applicationDidFinishLaunching after this collector was
    /// constructed before NSApplication.run(). AppKit delivers an inactive
    /// session's resign notification before did-finish; no observed transition
    /// therefore establishes the normal active launch state.
    public func establishSessionActivityAfterApplicationLaunch() {
        sessionActivity.establishAfterApplicationDidFinishLaunching()
    }

    public func permissionPreflight() -> PermissionPreflight {
        // Deliberately use only non-prompting APIs. Permission requests belong to
        // explicit user actions in a future signed UI flow.
        PermissionPreflight(
            accessibility: AXIsProcessTrusted() ? .granted : .denied,
            screenRecording: CGPreflightScreenCaptureAccess() ? .granted : .denied
        )
    }

    public func requestPermission(_ kind: ThingtimePermissionKind) -> PermissionPreflight {
        switch kind {
        case .accessibility:
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
            _ = AXIsProcessTrustedWithOptions(options)
        case .screenRecording:
            _ = CGRequestScreenCaptureAccess()
        }
        return permissionPreflight()
    }

    public func snapshot(now: Date = Date()) -> DeviceTelemetry {
        DeviceTelemetry(
            deviceName: Host.current().localizedName ?? ProcessInfo.processInfo.hostName,
            hostName: ProcessInfo.processInfo.hostName,
            modelIdentifier: Self.sysctlString("hw.model"),
            operatingSystemVersion: ProcessInfo.processInfo.operatingSystemVersionString,
            architecture: Self.sysctlString("hw.machine") ?? "unknown",
            outputVolume: SystemAudio.outputVolume(),
            session: sessionTelemetry(),
            permissions: permissionPreflight(),
            runningApplications: NSWorkspace.shared.runningApplications
                .map {
                    RunningApplicationTelemetry(
                        processIdentifier: $0.processIdentifier,
                        bundleIdentifier: $0.bundleIdentifier,
                        name: $0.localizedName,
                        isActive: $0.isActive,
                        isHidden: $0.isHidden
                    )
                }
                .sorted {
                    ($0.name ?? $0.bundleIdentifier ?? "") < ($1.name ?? $1.bundleIdentifier ?? "")
                },
            displays: Self.displays(),
            collectedAt: now
        )
    }

    private static func displays() -> [DisplayTelemetry] {
        var count: UInt32 = 0
        guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0 else { return [] }
        var identifiers = Array(repeating: CGDirectDisplayID(), count: Int(count))
        guard CGGetActiveDisplayList(count, &identifiers, &count) == .success else { return [] }
        return identifiers.prefix(Int(count)).map { identifier in
            let bounds = CGDisplayBounds(identifier)
            let brightness = SystemDisplayBrightness.snapshot(for: identifier)
            return DisplayTelemetry(
                displayID: identifier,
                width: Int(bounds.width),
                height: Int(bounds.height),
                isMain: CGDisplayIsMain(identifier) != 0,
                isBuiltIn: CGDisplayIsBuiltin(identifier) != 0,
                brightness: brightness?.level,
                brightnessControlSupported: brightness?.canSet ?? false
            )
        }
    }

    private func sessionTelemetry() -> SessionTelemetry {
        let dictionary = CGSessionCopyCurrentDictionary() as? [String: Any]
        return SessionTelemetry(
            // NSWorkspace notifications are the public authority. The extra
            // WindowServer value is an undocumented, conservative
            // compatibility signal for Control-Command-Q: true may only add a
            // lock, while false/missing can never clear the public state.
            isLocked: Self.resolvedLockState(
                publicMonitorLocked: sessionActivity.isLocked,
                compatibilityValue: dictionary?["CGSSessionScreenIsLocked"]
            ),
            isOnConsole: (dictionary?[kCGSessionOnConsoleKey as String] as? Bool) ?? true
        )
    }

    static func resolvedLockState(publicMonitorLocked: Bool, compatibilityValue: Any?) -> Bool {
        publicMonitorLocked || (compatibilityValue as? Bool) == true
    }

    private static func sysctlString(_ name: String) -> String? {
        var size = 0
        guard sysctlbyname(name, nil, &size, nil, 0) == 0, size > 0 else { return nil }
        var buffer = [CChar](repeating: 0, count: size)
        guard sysctlbyname(name, &buffer, &size, nil, 0) == 0 else { return nil }
        return String(cString: buffer)
    }
}

/// Tracks the current Aqua session using public AppKit notifications. The node
/// is a RunAtLoad agent, so it observes subsequent lock/unlock transitions for
/// the lifetime of the signed-in session without polling private state.
@MainActor
final class SessionActivityMonitor: NSObject {
    private(set) var isLocked: Bool
    private let center: NotificationCenter
    private var observedSessionTransition = false

    init(center: NotificationCenter = NSWorkspace.shared.notificationCenter, initiallyLocked: Bool = true) {
        self.center = center
        isLocked = initiallyLocked
        super.init()
        center.addObserver(
            self,
            selector: #selector(sessionDidResignActive),
            name: NSWorkspace.sessionDidResignActiveNotification,
            object: nil
        )
        center.addObserver(
            self,
            selector: #selector(sessionDidBecomeActive),
            name: NSWorkspace.sessionDidBecomeActiveNotification,
            object: nil
        )
    }

    deinit {
        center.removeObserver(self)
    }

    @objc private func sessionDidResignActive() {
        observedSessionTransition = true
        isLocked = true
    }

    @objc private func sessionDidBecomeActive() {
        observedSessionTransition = true
        isLocked = false
    }

    func establishAfterApplicationDidFinishLaunching() {
        if !observedSessionTransition { isLocked = false }
    }
}

public struct DisplayBrightnessSnapshot: Equatable, Sendable {
    public let level: Double
    public let canSet: Bool

    public init(level: Double, canSet: Bool) {
        self.level = level
        self.canSet = canSet
    }
}

public enum SystemDisplayBrightness {
    public static func snapshot(for displayID: CGDirectDisplayID) -> DisplayBrightnessSnapshot? {
        withUniqueMatchingService(for: displayID) { service -> DisplayBrightnessSnapshot? in
            var value = Float.zero
            guard IODisplayGetFloatParameter(
                service,
                0,
                kIODisplayBrightnessKey as CFString,
                &value
            ) == kIOReturnSuccess else { return nil }
            return normalizedSnapshot(level: Double(value), canSet: true)
        } ?? nil
    }

    public static func setMainDisplayBrightness(_ level: Double) throws {
        guard level.isFinite, (0 ... 1).contains(level) else {
            throw ThingtimeNodeError.invalidRequest("Brightness must be between 0 and 1.")
        }
        let displayID = CGMainDisplayID()
        let result = withUniqueMatchingService(for: displayID) { service in
            IODisplaySetFloatParameter(
                service,
                0,
                kIODisplayBrightnessKey as CFString,
                Float(level)
            )
        }
        if result == kIOReturnSuccess { return }
        throw ThingtimeNodeError.policyDenied(
            "The main display does not expose public IOKit brightness control."
        )
    }

    static func normalizedSnapshot(level: Double, canSet: Bool) -> DisplayBrightnessSnapshot? {
        guard level.isFinite, (0 ... 1).contains(level) else { return nil }
        return DisplayBrightnessSnapshot(level: level, canSet: canSet)
    }

    private static func withUniqueMatchingService<T>(
        for displayID: CGDirectDisplayID,
        body: (io_service_t) -> T
    ) -> T? {
        var iterator: io_iterator_t = 0
        guard let matching = IOServiceMatching("IODisplayConnect"),
              IOServiceGetMatchingServices(kIOMainPortDefault, matching, &iterator) == kIOReturnSuccess else {
            return nil
        }
        defer { IOObjectRelease(iterator) }

        let target = DisplayIdentity(
            vendor: CGDisplayVendorNumber(displayID),
            product: CGDisplayModelNumber(displayID),
            serial: CGDisplaySerialNumber(displayID)
        )
        var matches: [io_service_t] = []
        while case let service = IOIteratorNext(iterator), service != 0 {
            if identity(for: service)?.matches(target) == true {
                matches.append(service)
            } else {
                IOObjectRelease(service)
            }
        }
        guard matches.count == 1, let service = matches.first else {
            matches.forEach { IOObjectRelease($0) }
            return nil
        }
        defer { IOObjectRelease(service) }
        return body(service)
    }

    private struct DisplayIdentity {
        let vendor: UInt32
        let product: UInt32
        let serial: UInt32

        func matches(_ other: DisplayIdentity) -> Bool {
            guard vendor == other.vendor, product == other.product else { return false }
            return serial == 0 || other.serial == 0 || serial == other.serial
        }
    }

    private static func identity(for service: io_service_t) -> DisplayIdentity? {
        guard let unmanaged = IODisplayCreateInfoDictionary(service, 0),
              let dictionary = unmanaged.takeRetainedValue() as? [String: Any],
              let vendor = (dictionary[kDisplayVendorID] as? NSNumber)?.uint32Value,
              let product = (dictionary[kDisplayProductID] as? NSNumber)?.uint32Value else {
            return nil
        }
        return DisplayIdentity(
            vendor: vendor,
            product: product,
            serial: (dictionary[kDisplaySerialNumber] as? NSNumber)?.uint32Value ?? 0
        )
    }
}

public enum SystemAudio {
    public static func outputVolume() -> Double? {
        guard let device = defaultOutputDevice() else { return nil }
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwareServiceDeviceProperty_VirtualMainVolume,
            mScope: kAudioDevicePropertyScopeOutput,
            mElement: kAudioObjectPropertyElementMain
        )
        guard AudioObjectHasProperty(device, &address) else { return nil }
        var volume = Float32.zero
        var size = UInt32(MemoryLayout<Float32>.size)
        guard AudioObjectGetPropertyData(device, &address, 0, nil, &size, &volume) == noErr else { return nil }
        return Double(volume)
    }

    public static func setOutputVolume(_ volume: Double) throws {
        guard (0 ... 1).contains(volume) else {
            throw ThingtimeNodeError.invalidRequest("Volume must be between 0 and 1.")
        }
        guard let device = defaultOutputDevice() else {
            throw ThingtimeNodeError.policyDenied("No controllable default output device is available.")
        }
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwareServiceDeviceProperty_VirtualMainVolume,
            mScope: kAudioDevicePropertyScopeOutput,
            mElement: kAudioObjectPropertyElementMain
        )
        guard AudioObjectHasProperty(device, &address) else {
            throw ThingtimeNodeError.policyDenied("The default output device does not expose a main-volume control.")
        }
        var settable = DarwinBoolean(false)
        guard AudioObjectIsPropertySettable(device, &address, &settable) == noErr, settable.boolValue else {
            throw ThingtimeNodeError.policyDenied("The default output volume is read-only.")
        }
        var scalar = Float32(volume)
        let size = UInt32(MemoryLayout<Float32>.size)
        guard AudioObjectSetPropertyData(device, &address, 0, nil, size, &scalar) == noErr else {
            throw ThingtimeNodeError.policyDenied("macOS could not change the output volume.")
        }
    }

    private static func defaultOutputDevice() -> AudioDeviceID? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultOutputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var identifier = AudioDeviceID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        guard AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            0,
            nil,
            &size,
            &identifier
        ) == noErr, identifier != kAudioObjectUnknown else { return nil }
        return identifier
    }
}
