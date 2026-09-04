import AppKit
import ApplicationServices
import AudioToolbox
import CoreAudio
import CoreGraphics
import CoreWLAN
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
    /// A stable, non-secret identifier for the selected display mode. It is
    /// deliberately derived from public CoreGraphics mode attributes rather
    /// than accepting an arbitrary EDID or display profile from a caller.
    public let currentMode: DisplayModeTelemetry?
    public let availableModes: [DisplayModeTelemetry]
    public let originX: Int
    public let originY: Int
    public let mirroredDisplayID: UInt32?
    /// macOS exposes the active HDR colour space but does not provide a public
    /// API to toggle system HDR. This is therefore read-only telemetry.
    public let hdrActive: Bool

    public init(
        displayID: UInt32,
        width: Int,
        height: Int,
        isMain: Bool,
        isBuiltIn: Bool,
        brightness: Double? = nil,
        brightnessControlSupported: Bool = false,
        currentMode: DisplayModeTelemetry? = nil,
        availableModes: [DisplayModeTelemetry] = [],
        originX: Int = 0,
        originY: Int = 0,
        mirroredDisplayID: UInt32? = nil,
        hdrActive: Bool = false
    ) {
        self.displayID = displayID
        self.width = width
        self.height = height
        self.isMain = isMain
        self.isBuiltIn = isBuiltIn
        self.brightness = brightness
        self.brightnessControlSupported = brightnessControlSupported
        self.currentMode = currentMode
        self.availableModes = availableModes
        self.originX = originX
        self.originY = originY
        self.mirroredDisplayID = mirroredDisplayID
        self.hdrActive = hdrActive
    }
}

public struct DisplayModeTelemetry: Codable, Equatable, Sendable {
    public let id: String
    public let width: Int
    public let height: Int
    public let refreshRate: Double

    public init(id: String, width: Int, height: Int, refreshRate: Double) {
        self.id = id
        self.width = width
        self.height = height
        self.refreshRate = refreshRate
    }
}

public struct PrinterTelemetry: Codable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let isDefault: Bool

    public init(id: String, name: String, isDefault: Bool) {
        self.id = id
        self.name = name
        self.isDefault = isDefault
    }
}

public struct CameraTelemetry: Codable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let isConnected: Bool
    public let isPreferred: Bool
    public let authorization: PermissionPreflightState

    public init(id: String, name: String, isConnected: Bool, isPreferred: Bool, authorization: PermissionPreflightState) {
        self.id = id
        self.name = name
        self.isConnected = isConnected
        self.isPreferred = isPreferred
        self.authorization = authorization
    }
}

/// Bluetooth device identifiers are a one-way digest of the public address.
/// This lets a paired node match a device without publishing its hardware
/// address to the remote control plane.
public struct BluetoothDeviceTelemetry: Codable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let isConnected: Bool

    public init(id: String, name: String, isConnected: Bool) {
        self.id = id
        self.name = name
        self.isConnected = isConnected
    }
}

public struct VPNServiceTelemetry: Codable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let isConnected: Bool

    public init(id: String, name: String, isConnected: Bool) {
        self.id = id
        self.name = name
        self.isConnected = isConnected
    }
}

public struct BatteryTelemetry: Codable, Equatable, Sendable {
    public let level: Double?
    public let isCharging: Bool?
    public let isExternalPower: Bool?
    public let isPreventingIdleSleep: Bool
    public let isLowPowerModeEnabled: Bool

    public init(level: Double?, isCharging: Bool?, isExternalPower: Bool?, isPreventingIdleSleep: Bool, isLowPowerModeEnabled: Bool = false) {
        self.level = level
        self.isCharging = isCharging
        self.isExternalPower = isExternalPower
        self.isPreventingIdleSleep = isPreventingIdleSleep
        self.isLowPowerModeEnabled = isLowPowerModeEnabled
    }
}

/// The supported root-domain idle timers, measured in minutes. Zero means the
/// corresponding timer is disabled. No energy profile names or opaque power
/// preference dictionaries leave the node.
public struct PowerTimerTelemetry: Codable, Equatable, Sendable {
    public let displayIdleMinutes: Int?
    public let systemSleepMinutes: Int?
    public let diskIdleMinutes: Int?

    public init(displayIdleMinutes: Int?, systemSleepMinutes: Int?, diskIdleMinutes: Int?) {
        self.displayIdleMinutes = displayIdleMinutes
        self.systemSleepMinutes = systemSleepMinutes
        self.diskIdleMinutes = diskIdleMinutes
    }
}

/// A deliberately minimal, privacy-preserving Apple Music presence signal.
/// Playback title, library, queue, and listening history are never collected.
public struct AppleMusicTelemetry: Codable, Equatable, Sendable {
    public let isInstalled: Bool
    public let isRunning: Bool

    public init(isInstalled: Bool, isRunning: Bool) {
        self.isInstalled = isInstalled
        self.isRunning = isRunning
    }
}

/// A deliberately minimal, privacy-preserving Spotify presence signal.
/// Playback title, library, queue, and listening history are never collected.
public struct SpotifyTelemetry: Codable, Equatable, Sendable {
    public let isInstalled: Bool
    public let isRunning: Bool

    public init(isInstalled: Bool, isRunning: Bool) {
        self.isInstalled = isInstalled
        self.isRunning = isRunning
    }
}

/// A deliberately minimal Chrome capability signal. The node never reports a
/// tab URL, title, playback state, page contents, or browser history.
public struct ChromeYouTubeTelemetry: Codable, Equatable, Sendable {
    public let isInstalled: Bool
    public let isRunning: Bool

    public init(isInstalled: Bool, isRunning: Bool) {
        self.isInstalled = isInstalled
        self.isRunning = isRunning
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

/// A deliberately small, non-secret description of an audio route. Device UIDs
/// let the node switch a route without accepting a filesystem path, shell
/// fragment, or opaque driver object from a remote caller.
public struct AudioDeviceTelemetry: Codable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let hasInput: Bool
    public let hasOutput: Bool
    public let isDefaultInput: Bool
    public let isDefaultOutput: Bool
    public let isDefaultSoundEffectsOutput: Bool

    public init(
        id: String,
        name: String,
        hasInput: Bool,
        hasOutput: Bool,
        isDefaultInput: Bool,
        isDefaultOutput: Bool,
        isDefaultSoundEffectsOutput: Bool
    ) {
        self.id = id
        self.name = name
        self.hasInput = hasInput
        self.hasOutput = hasOutput
        self.isDefaultInput = isDefaultInput
        self.isDefaultOutput = isDefaultOutput
        self.isDefaultSoundEffectsOutput = isDefaultSoundEffectsOutput
    }
}

/// A bounded, credential-free Wi-Fi status projection. The node never sends
/// saved passwords, BSSIDs, or scan history to the control plane.
public struct WiFiTelemetry: Codable, Equatable, Sendable {
    public let powerOn: Bool?
    public let ssid: String?

    public init(powerOn: Bool?, ssid: String?) {
        self.powerOn = powerOn
        self.ssid = ssid
    }
}

public struct DeviceTelemetry: Codable, Equatable, Sendable {
    public let deviceName: String
    public let hostName: String
    public let modelIdentifier: String?
    public let operatingSystemVersion: String
    public let architecture: String
    public let outputVolume: Double?
    public let outputMuted: Bool?
    public let inputVolume: Double?
    public let inputMuted: Bool?
    public let soundEffectsOutputVolume: Double?
    public let soundEffectsOutputMuted: Bool?
    public let audioDevices: [AudioDeviceTelemetry]
    public let wifi: WiFiTelemetry
    public let session: SessionTelemetry
    public let permissions: PermissionPreflight
    public let runningApplications: [RunningApplicationTelemetry]
    public let displays: [DisplayTelemetry]
    public let printers: [PrinterTelemetry]
    public let cameras: [CameraTelemetry]
    public let bluetoothDevices: [BluetoothDeviceTelemetry]
    public let vpnServices: [VPNServiceTelemetry]
    public let battery: BatteryTelemetry
    public let powerTimers: PowerTimerTelemetry
    public let appleMusic: AppleMusicTelemetry
    public let spotify: SpotifyTelemetry
    public let chromeYouTube: ChromeYouTubeTelemetry
    public let collectedAt: Date

    public init(
        deviceName: String,
        hostName: String,
        modelIdentifier: String?,
        operatingSystemVersion: String,
        architecture: String,
        outputVolume: Double?,
        outputMuted: Bool? = nil,
        inputVolume: Double? = nil,
        inputMuted: Bool? = nil,
        soundEffectsOutputVolume: Double? = nil,
        soundEffectsOutputMuted: Bool? = nil,
        audioDevices: [AudioDeviceTelemetry] = [],
        wifi: WiFiTelemetry = WiFiTelemetry(powerOn: nil, ssid: nil),
        session: SessionTelemetry,
        permissions: PermissionPreflight,
        runningApplications: [RunningApplicationTelemetry],
        displays: [DisplayTelemetry],
        collectedAt: Date,
        printers: [PrinterTelemetry] = [],
        cameras: [CameraTelemetry] = [],
        bluetoothDevices: [BluetoothDeviceTelemetry] = [],
        vpnServices: [VPNServiceTelemetry] = [],
        battery: BatteryTelemetry = BatteryTelemetry(level: nil, isCharging: nil, isExternalPower: nil, isPreventingIdleSleep: false),
        powerTimers: PowerTimerTelemetry = PowerTimerTelemetry(displayIdleMinutes: nil, systemSleepMinutes: nil, diskIdleMinutes: nil),
        appleMusic: AppleMusicTelemetry = AppleMusicTelemetry(isInstalled: false, isRunning: false),
        spotify: SpotifyTelemetry = SpotifyTelemetry(isInstalled: false, isRunning: false),
        chromeYouTube: ChromeYouTubeTelemetry = ChromeYouTubeTelemetry(isInstalled: false, isRunning: false)
    ) {
        self.deviceName = deviceName
        self.hostName = hostName
        self.modelIdentifier = modelIdentifier
        self.operatingSystemVersion = operatingSystemVersion
        self.architecture = architecture
        self.outputVolume = outputVolume
        self.outputMuted = outputMuted
        self.inputVolume = inputVolume
        self.inputMuted = inputMuted
        self.soundEffectsOutputVolume = soundEffectsOutputVolume
        self.soundEffectsOutputMuted = soundEffectsOutputMuted
        self.audioDevices = audioDevices
        self.wifi = wifi
        self.session = session
        self.permissions = permissions
        self.runningApplications = runningApplications
        self.displays = displays
        self.collectedAt = collectedAt
        self.printers = printers
        self.cameras = cameras
        self.bluetoothDevices = bluetoothDevices
        self.vpnServices = vpnServices
        self.battery = battery
        self.powerTimers = powerTimers
        self.appleMusic = appleMusic
        self.spotify = spotify
        self.chromeYouTube = chromeYouTube
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
    private let powerAssertions: PowerAssertionController

    public init() {
        sessionActivity = SessionActivityMonitor()
        powerAssertions = PowerAssertionController()
    }

    init(sessionActivity: SessionActivityMonitor, powerAssertions: PowerAssertionController) {
        self.sessionActivity = sessionActivity
        self.powerAssertions = powerAssertions
    }

    convenience init(sessionActivity: SessionActivityMonitor) {
        self.init(sessionActivity: sessionActivity, powerAssertions: PowerAssertionController())
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
            outputMuted: SystemAudio.outputMuted(),
            inputVolume: SystemAudio.inputVolume(),
            inputMuted: SystemAudio.inputMuted(),
            soundEffectsOutputVolume: SystemAudio.soundEffectsOutputVolume(),
            soundEffectsOutputMuted: SystemAudio.soundEffectsOutputMuted(),
            audioDevices: SystemAudio.devices(),
            wifi: SystemWiFi.snapshot(),
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
            displays: SystemDisplayConfiguration.displays(),
            collectedAt: now,
            printers: SystemPrinters.all(),
            cameras: SystemCameras.all(),
            bluetoothDevices: SystemBluetooth.pairedDevices(),
            vpnServices: SystemVPN.services(),
            battery: SystemBattery.snapshot(isPreventingIdleSleep: powerAssertions.isPreventingIdleSleep),
            powerTimers: SystemPowerTimers.snapshot(),
            appleMusic: SystemAppleMusic.telemetry(),
            spotify: SystemSpotify.telemetry(),
            chromeYouTube: SystemChromeYouTube.telemetry()
        )
    }

    public func setPreventIdleSleep(_ enabled: Bool) throws {
        try powerAssertions.setPreventingIdleSleep(enabled)
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
        try setDisplayBrightness(level, displayID: CGMainDisplayID())
    }

    public static func setDisplayBrightness(_ level: Double, displayID: CGDirectDisplayID) throws {
        guard level.isFinite, (0 ... 1).contains(level) else {
            throw ThingtimeNodeError.invalidRequest("Brightness must be between 0 and 1.")
        }
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
            "The selected display does not expose public IOKit brightness control."
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

    public static func outputMuted() -> Bool? {
        guard let device = defaultOutputDevice() else { return nil }
        return muted(device: device, scope: kAudioDevicePropertyScopeOutput)
    }

    public static func setOutputMuted(_ muted: Bool) throws {
        guard let device = defaultOutputDevice() else {
            throw ThingtimeNodeError.policyDenied("No controllable default output device is available.")
        }
        try setMuted(muted, device: device, scope: kAudioDevicePropertyScopeOutput)
    }

    public static func inputVolume() -> Double? {
        guard let device = defaultInputDevice() else { return nil }
        return volume(device: device, scope: kAudioDevicePropertyScopeInput)
    }

    public static func setInputVolume(_ volume: Double) throws {
        guard let device = defaultInputDevice() else {
            throw ThingtimeNodeError.policyDenied("No controllable default input device is available.")
        }
        try setVolume(volume, device: device, scope: kAudioDevicePropertyScopeInput, route: "input")
    }

    public static func inputMuted() -> Bool? {
        guard let device = defaultInputDevice() else { return nil }
        return muted(device: device, scope: kAudioDevicePropertyScopeInput)
    }

    public static func setInputMuted(_ muted: Bool) throws {
        guard let device = defaultInputDevice() else {
            throw ThingtimeNodeError.policyDenied("No controllable default input device is available.")
        }
        try setMuted(muted, device: device, scope: kAudioDevicePropertyScopeInput, route: "input")
    }

    public static func soundEffectsOutputVolume() -> Double? {
        guard let device = defaultSoundEffectsOutputDevice() else { return nil }
        return volume(device: device, scope: kAudioDevicePropertyScopeOutput)
    }

    public static func setSoundEffectsOutputVolume(_ volume: Double) throws {
        guard let device = defaultSoundEffectsOutputDevice() else {
            throw ThingtimeNodeError.policyDenied("No controllable sound-effects output device is available.")
        }
        try setVolume(volume, device: device, scope: kAudioDevicePropertyScopeOutput, route: "sound-effects output")
    }

    public static func soundEffectsOutputMuted() -> Bool? {
        guard let device = defaultSoundEffectsOutputDevice() else { return nil }
        return muted(device: device, scope: kAudioDevicePropertyScopeOutput)
    }

    public static func setSoundEffectsOutputMuted(_ muted: Bool) throws {
        guard let device = defaultSoundEffectsOutputDevice() else {
            throw ThingtimeNodeError.policyDenied("No controllable sound-effects output device is available.")
        }
        try setMuted(muted, device: device, scope: kAudioDevicePropertyScopeOutput, route: "sound-effects output")
    }

    public static func devices() -> [AudioDeviceTelemetry] {
        let defaultOutput = defaultOutputDevice()
        let defaultInput = defaultInputDevice()
        let defaultSoundEffects = defaultSoundEffectsOutputDevice()
        return allDevices().compactMap { device in
            guard let id = stringProperty(device, selector: kAudioDevicePropertyDeviceUID),
                  let name = stringProperty(device, selector: kAudioObjectPropertyName) else {
                return nil
            }
            let hasInput = hasStreams(device, scope: kAudioDevicePropertyScopeInput)
            let hasOutput = hasStreams(device, scope: kAudioDevicePropertyScopeOutput)
            guard hasInput || hasOutput else { return nil }
            return AudioDeviceTelemetry(
                id: id,
                name: name,
                hasInput: hasInput,
                hasOutput: hasOutput,
                isDefaultInput: device == defaultInput,
                isDefaultOutput: device == defaultOutput,
                isDefaultSoundEffectsOutput: device == defaultSoundEffects
            )
        }
        .sorted { ($0.name, $0.id) < ($1.name, $1.id) }
        .prefix(32)
        .map { $0 }
    }

    public static func setDefaultOutputDevice(id: String) throws {
        try setDefaultDevice(id: id, selector: kAudioHardwarePropertyDefaultOutputDevice, requiredScope: kAudioDevicePropertyScopeOutput)
    }

    public static func setDefaultInputDevice(id: String) throws {
        try setDefaultDevice(id: id, selector: kAudioHardwarePropertyDefaultInputDevice, requiredScope: kAudioDevicePropertyScopeInput)
    }

    public static func setDefaultSoundEffectsOutputDevice(id: String) throws {
        try setDefaultDevice(id: id, selector: kAudioHardwarePropertyDefaultSystemOutputDevice, requiredScope: kAudioDevicePropertyScopeOutput)
    }

    private static func setDefaultDevice(
        id: String,
        selector: AudioObjectPropertySelector,
        requiredScope: AudioObjectPropertyScope
    ) throws {
        guard validDeviceID(id), let device = allDevices().first(where: { stringProperty($0, selector: kAudioDevicePropertyDeviceUID) == id }) else {
            throw ThingtimeNodeError.invalidRequest("The audio device identifier is invalid or unavailable.")
        }
        guard hasStreams(device, scope: requiredScope) else {
            throw ThingtimeNodeError.policyDenied("The requested audio device does not support that route.")
        }
        var address = AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var value = device
        let size = UInt32(MemoryLayout<AudioDeviceID>.size)
        guard AudioObjectSetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, size, &value) == noErr else {
            throw ThingtimeNodeError.policyDenied("macOS could not change the selected audio device.")
        }
    }

    private static func muted(device: AudioDeviceID, scope: AudioObjectPropertyScope) -> Bool? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyMute,
            mScope: scope,
            mElement: kAudioObjectPropertyElementMain
        )
        guard AudioObjectHasProperty(device, &address) else { return nil }
        var value: UInt32 = 0
        var size = UInt32(MemoryLayout<UInt32>.size)
        guard AudioObjectGetPropertyData(device, &address, 0, nil, &size, &value) == noErr else { return nil }
        return value != 0
    }

    private static func volume(device: AudioDeviceID, scope: AudioObjectPropertyScope) -> Double? {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwareServiceDeviceProperty_VirtualMainVolume,
            mScope: scope,
            mElement: kAudioObjectPropertyElementMain
        )
        guard AudioObjectHasProperty(device, &address) else { return nil }
        var volume = Float32.zero
        var size = UInt32(MemoryLayout<Float32>.size)
        guard AudioObjectGetPropertyData(device, &address, 0, nil, &size, &volume) == noErr else { return nil }
        return Double(volume)
    }

    private static func setVolume(_ volume: Double, device: AudioDeviceID, scope: AudioObjectPropertyScope, route: String) throws {
        guard (0 ... 1).contains(volume) else {
            throw ThingtimeNodeError.invalidRequest("Volume must be between 0 and 1.")
        }
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwareServiceDeviceProperty_VirtualMainVolume,
            mScope: scope,
            mElement: kAudioObjectPropertyElementMain
        )
        guard AudioObjectHasProperty(device, &address) else {
            throw ThingtimeNodeError.policyDenied("The default \(route) device does not expose a main-volume control.")
        }
        var settable = DarwinBoolean(false)
        guard AudioObjectIsPropertySettable(device, &address, &settable) == noErr, settable.boolValue else {
            throw ThingtimeNodeError.policyDenied("The default \(route) volume is read-only.")
        }
        var scalar = Float32(volume)
        let size = UInt32(MemoryLayout<Float32>.size)
        guard AudioObjectSetPropertyData(device, &address, 0, nil, size, &scalar) == noErr else {
            throw ThingtimeNodeError.policyDenied("macOS could not change the \(route) volume.")
        }
    }

    private static func setMuted(_ muted: Bool, device: AudioDeviceID, scope: AudioObjectPropertyScope, route: String = "output") throws {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyMute,
            mScope: scope,
            mElement: kAudioObjectPropertyElementMain
        )
        guard AudioObjectHasProperty(device, &address) else {
            throw ThingtimeNodeError.policyDenied("The default \(route) device does not expose mute control.")
        }
        var settable = DarwinBoolean(false)
        guard AudioObjectIsPropertySettable(device, &address, &settable) == noErr, settable.boolValue else {
            throw ThingtimeNodeError.policyDenied("The default \(route) mute control is read-only.")
        }
        var value: UInt32 = muted ? 1 : 0
        let size = UInt32(MemoryLayout<UInt32>.size)
        guard AudioObjectSetPropertyData(device, &address, 0, nil, size, &value) == noErr else {
            throw ThingtimeNodeError.policyDenied("macOS could not change the \(route) mute state.")
        }
    }

    private static func allDevices() -> [AudioDeviceID] {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var size: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size) == noErr,
              size > 0 else { return [] }
        var values = Array(repeating: AudioDeviceID(kAudioObjectUnknown), count: Int(size) / MemoryLayout<AudioDeviceID>.size)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &values) == noErr else {
            return []
        }
        return values.filter { $0 != kAudioObjectUnknown }
    }

    private static func hasStreams(_ device: AudioDeviceID, scope: AudioObjectPropertyScope) -> Bool {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreams,
            mScope: scope,
            mElement: kAudioObjectPropertyElementMain
        )
        return AudioObjectHasProperty(device, &address)
    }

    private static func stringProperty(_ device: AudioDeviceID, selector: AudioObjectPropertySelector) -> String? {
        var address = AudioObjectPropertyAddress(
            mSelector: selector,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var value: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        guard AudioObjectGetPropertyData(device, &address, 0, nil, &size, &value) == noErr,
              let value else { return nil }
        let string = value.takeUnretainedValue() as String
        guard !string.isEmpty, string.utf8.count <= 512, string.rangeOfCharacter(from: .controlCharacters) == nil else { return nil }
        return string
    }

    private static func validDeviceID(_ id: String) -> Bool {
        !id.isEmpty && id == id.trimmingCharacters(in: .whitespacesAndNewlines) && id.utf8.count <= 512 && id.rangeOfCharacter(from: .controlCharacters) == nil
    }

    private static func defaultOutputDevice() -> AudioDeviceID? {
        defaultDevice(selector: kAudioHardwarePropertyDefaultOutputDevice)
    }

    private static func defaultInputDevice() -> AudioDeviceID? {
        defaultDevice(selector: kAudioHardwarePropertyDefaultInputDevice)
    }

    private static func defaultSoundEffectsOutputDevice() -> AudioDeviceID? {
        defaultDevice(selector: kAudioHardwarePropertyDefaultSystemOutputDevice)
    }

    private static func defaultDevice(selector: AudioObjectPropertySelector) -> AudioDeviceID? {
        var address = AudioObjectPropertyAddress(
            mSelector: selector,
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

public enum SystemWiFi {
    public static func snapshot() -> WiFiTelemetry {
        guard let interface = CWWiFiClient.shared().interface() else {
            return WiFiTelemetry(powerOn: nil, ssid: nil)
        }
        let ssid = interface.ssid().flatMap { try? validatedSSID($0) }
        return WiFiTelemetry(powerOn: interface.powerOn(), ssid: ssid)
    }

    /// Joins an open network or a network whose credential is already in the
    /// local keychain. Passwords are intentionally never accepted by a remote
    /// command, journal, API request, or device event.
    public static func connect(ssid: String) throws {
        let ssid = try validatedSSID(ssid)
        guard let interface = CWWiFiClient.shared().interface() else {
            throw ThingtimeNodeError.policyDenied("No Wi-Fi interface is available on this Mac.")
        }
        let matches: Set<CWNetwork>
        do {
            matches = try interface.scanForNetworks(withName: ssid, includeHidden: false)
        } catch {
            throw ThingtimeNodeError.policyDenied("macOS could not scan for the requested Wi-Fi network.")
        }
        guard let network = matches.first(where: { $0.ssid == ssid }) else {
            throw ThingtimeNodeError.policyDenied("The requested Wi-Fi network is not currently available.")
        }
        do {
            try interface.associate(to: network, password: nil)
        } catch {
            throw ThingtimeNodeError.policyDenied("macOS could not join the requested Wi-Fi network using a saved credential.")
        }
        guard interface.ssid() == ssid else { throw ThingtimeNodeError.commandOutcomeUncertain }
    }

    public static func disconnect() throws {
        guard let interface = CWWiFiClient.shared().interface() else {
            throw ThingtimeNodeError.policyDenied("No Wi-Fi interface is available on this Mac.")
        }
        interface.disassociate()
        if interface.ssid() != nil { throw ThingtimeNodeError.commandOutcomeUncertain }
    }

    public static func setPower(_ enabled: Bool) throws {
        guard let interface = CWWiFiClient.shared().interface() else {
            throw ThingtimeNodeError.policyDenied("No Wi-Fi interface is available on this Mac.")
        }
		do {
			try interface.setPower(enabled)
		} catch {
			throw ThingtimeNodeError.policyDenied("macOS could not change the Wi-Fi power state.")
		}
		guard interface.powerOn() == enabled else { throw ThingtimeNodeError.commandOutcomeUncertain }
	}

    static func validatedSSID(_ value: String) throws -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              trimmed == value,
              trimmed.utf8.count <= 32,
              trimmed.rangeOfCharacter(from: .controlCharacters) == nil else {
            throw ThingtimeNodeError.invalidRequest("The Wi-Fi network name is invalid.")
        }
        return trimmed
    }
}
