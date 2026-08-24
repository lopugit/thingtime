import AppKit
import AVFoundation
import CoreGraphics
import CryptoKit
import Foundation
import IOBluetooth
import IOKit.ps
import IOKit.pwr_mgt
import SystemConfiguration

/// Public CoreGraphics display configuration only. Every mutation is matched
/// to a display or mode advertised in the node's own telemetry; no caller can
/// pass a display profile, preference-pane URL, or arbitrary command string.
public enum SystemDisplayConfiguration {
    public static func displays() -> [DisplayTelemetry] {
        activeDisplayIDs().map { displayID in
            let bounds = CGDisplayBounds(displayID)
            let brightness = SystemDisplayBrightness.snapshot(for: displayID)
            let current = CGDisplayCopyDisplayMode(displayID)
            let currentMode = current.map(modeTelemetry)
            let modes = (CGDisplayCopyAllDisplayModes(displayID, nil) as? [CGDisplayMode] ?? [])
                .map(modeTelemetry)
                .reduce(into: [String: DisplayModeTelemetry]()) { $0[$1.id] = $1 }
                .values
                .sorted { ($0.width, $0.height, $0.refreshRate, $0.id) < ($1.width, $1.height, $1.refreshRate, $1.id) }
                .prefix(64)
                .map { $0 }
            let mirrored = CGDisplayIsInMirrorSet(displayID) != 0 ? CGDisplayMirrorsDisplay(displayID) : 0
            let colourSpace = CGDisplayCopyColorSpace(displayID)
            return DisplayTelemetry(
                displayID: displayID,
                width: Int(bounds.width),
                height: Int(bounds.height),
                isMain: CGDisplayIsMain(displayID) != 0,
                isBuiltIn: CGDisplayIsBuiltin(displayID) != 0,
                brightness: brightness?.level,
                brightnessControlSupported: brightness?.canSet ?? false,
                currentMode: currentMode,
                availableModes: modes,
                originX: Int(bounds.origin.x),
                originY: Int(bounds.origin.y),
                mirroredDisplayID: mirrored == 0 ? nil : mirrored,
                hdrActive: colourSpace.isHDR()
            )
        }
    }

    public static func setMode(displayID: UInt32, modeID: String) throws {
        guard activeDisplayIDs().contains(displayID) else {
            throw ThingtimeNodeError.policyDenied("The selected display is no longer active.")
        }
        guard let mode = (CGDisplayCopyAllDisplayModes(displayID, nil) as? [CGDisplayMode])?.first(where: { modeIdentifier($0) == modeID }) else {
            throw ThingtimeNodeError.policyDenied("That display mode is not currently available for the selected display.")
        }
        // CGDisplaySetDisplayMode applies only while this process lives. A
        // paired-computer setting must instead use the same permanent display
        // configuration transaction as layout and mirroring, so it survives a
        // Thingtime Node restart and matches the user's Displays preference.
        try withConfiguration { configuration in
            CGConfigureDisplayWithDisplayMode(configuration, displayID, mode, nil)
        }
    }

    public static func setOrigin(displayID: UInt32, x: Int, y: Int) throws {
        guard activeDisplayIDs().contains(displayID) else {
            throw ThingtimeNodeError.policyDenied("The selected display is no longer active.")
        }
        try withConfiguration { configuration in
            CGConfigureDisplayOrigin(configuration, displayID, Int32(x), Int32(y))
        }
    }

    /// `sourceDisplayID == nil` clears mirroring for the selected display.
    public static func setMirroring(displayID: UInt32, sourceDisplayID: UInt32?) throws {
        let displays = activeDisplayIDs()
        guard displays.contains(displayID), sourceDisplayID.map(displays.contains) ?? true else {
            throw ThingtimeNodeError.policyDenied("The requested display is no longer active.")
        }
        guard sourceDisplayID != displayID else {
            throw ThingtimeNodeError.invalidRequest("A display cannot mirror itself.")
        }
        try withConfiguration { configuration in
            CGConfigureDisplayMirrorOfDisplay(configuration, displayID, sourceDisplayID ?? 0)
        }
    }

    static func modeIdentifier(_ mode: CGDisplayMode) -> String {
        let refresh = Int((mode.refreshRate * 1_000).rounded())
        return "\(mode.width)x\(mode.height)@\(refresh):\(mode.ioFlags)"
    }

    private static func modeTelemetry(_ mode: CGDisplayMode) -> DisplayModeTelemetry {
        DisplayModeTelemetry(
            id: modeIdentifier(mode),
            width: mode.width,
            height: mode.height,
            refreshRate: mode.refreshRate
        )
    }

    private static func activeDisplayIDs() -> [CGDirectDisplayID] {
        var count: UInt32 = 0
        guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0 else { return [] }
        var displays = Array(repeating: CGDirectDisplayID(), count: Int(count))
        guard CGGetActiveDisplayList(count, &displays, &count) == .success else { return [] }
        return Array(displays.prefix(Int(count)))
    }

    private static func withConfiguration(_ update: (CGDisplayConfigRef) -> CGError) throws {
        var configuration: CGDisplayConfigRef?
        guard CGBeginDisplayConfiguration(&configuration) == .success, let configuration else {
            throw ThingtimeNodeError.policyDenied("macOS display configuration is unavailable.")
        }
        let updateResult = update(configuration)
        guard updateResult == .success else {
            CGCancelDisplayConfiguration(configuration)
            throw ThingtimeNodeError.policyDenied("macOS did not accept the requested display configuration.")
        }
        guard CGCompleteDisplayConfiguration(configuration, .permanently) == .success else {
            throw ThingtimeNodeError.policyDenied("macOS could not apply the requested display configuration.")
        }
    }
}

public enum SystemPrinters {
    public static func all() -> [PrinterTelemetry] {
        guard let printers = printerList() else { return [] }
        return printers.compactMap { printer in
            guard let id = printerString(PMPrinterGetID(printer)),
                  let name = printerString(PMPrinterGetName(printer)) else { return nil }
            return PrinterTelemetry(id: id, name: name, isDefault: PMPrinterIsDefault(printer))
        }
        .sorted { ($0.name, $0.id) < ($1.name, $1.id) }
        .prefix(64)
        .map { $0 }
    }

    public static func setDefault(id: String) throws {
        guard let printers = printerList(),
              let printer = printers.first(where: { printerString(PMPrinterGetID($0)) == id }) else {
            throw ThingtimeNodeError.policyDenied("The selected printer is no longer available.")
        }
        guard PMPrinterSetDefault(printer) == noErr else {
            throw ThingtimeNodeError.policyDenied("macOS could not set the selected default printer.")
        }
    }

    private static func printerList() -> [PMPrinter]? {
        var list: Unmanaged<CFArray>?
        guard PMServerCreatePrinterList(nil, &list) == noErr,
              let list = list?.takeRetainedValue() as? [PMPrinter] else { return nil }
        return list
    }

    // Different macOS SDK overlays have imported Core Printing's `Get` APIs as
    // `String?`, `CFString?`, or an unretained `Unmanaged<CFString>?`. Keep the
    // public telemetry shape stable and obey the Core Foundation Get rule for
    // the unmanaged form instead of force-casting a build-SDK-specific type.
    static func printerString(_ value: String?) -> String? { value }

    static func printerString(_ value: CFString?) -> String? {
        value.map { $0 as String }
    }

    static func printerString(_ value: Unmanaged<CFString>?) -> String? {
        value.map { $0.takeUnretainedValue() as String }
    }
}

public enum SystemCameras {
    public static func all() -> [CameraTelemetry] {
        let authorization: PermissionPreflightState = AVCaptureDevice.authorizationStatus(for: .video) == .authorized ? .granted : .denied
        let preferredID = AVCaptureDevice.userPreferredCamera?.uniqueID
        return AVCaptureDevice.DiscoverySession(
            deviceTypes: [.builtInWideAngleCamera, .externalUnknown],
            mediaType: .video,
            position: .unspecified
        ).devices
        .map {
            CameraTelemetry(
                id: $0.uniqueID,
                name: $0.localizedName,
                isConnected: $0.isConnected,
                isPreferred: $0.uniqueID == preferredID,
                authorization: authorization
            )
        }
        .sorted { ($0.name, $0.id) < ($1.name, $1.id) }
        .prefix(32)
        .map { $0 }
    }

    public static func setPreferred(id: String) throws {
        guard let device = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.builtInWideAngleCamera, .externalUnknown],
            mediaType: .video,
            position: .unspecified
        ).devices.first(where: { $0.uniqueID == id }) else {
            throw ThingtimeNodeError.policyDenied("The selected camera is no longer available.")
        }
        AVCaptureDevice.userPreferredCamera = device
    }
}

public enum SystemBluetooth {
    public static func pairedDevices() -> [BluetoothDeviceTelemetry] {
        (IOBluetoothDevice.pairedDevices() as? [IOBluetoothDevice] ?? [])
            .compactMap { device in
                guard let address = device.addressString, let name = device.name else { return nil }
                return BluetoothDeviceTelemetry(id: opaqueID(address), name: name, isConnected: device.isConnected())
            }
            .sorted { ($0.name, $0.id) < ($1.name, $1.id) }
            .prefix(64)
            .map { $0 }
    }

    public static func setConnected(id: String, connected: Bool) throws {
        guard let device = (IOBluetoothDevice.pairedDevices() as? [IOBluetoothDevice])?.first(where: { device in
            guard let address = device.addressString else { return false }
            return opaqueID(address) == id
        }) else {
            throw ThingtimeNodeError.policyDenied("The selected paired Bluetooth device is no longer available.")
        }
        let result = connected ? device.openConnection() : device.closeConnection()
        guard result == kIOReturnSuccess else {
            throw ThingtimeNodeError.policyDenied("macOS could not change the selected Bluetooth device connection.")
        }
    }

    private static func opaqueID(_ address: String) -> String {
        let digest = SHA256.hash(data: Data(address.utf8))
        return "bt-" + digest.prefix(12).map { String(format: "%02x", $0) }.joined()
    }
}

public enum SystemVPN {
	public static func services() -> [VPNServiceTelemetry] {
		guard let preferences = SCPreferencesCreate(nil, "com.thingtime.desktop.node" as CFString, nil),
			  let services = SCNetworkServiceCopyAll(preferences) as? [SCNetworkService] else { return [] }
		return services.compactMap { service in
			guard isRemoteAccessService(service),
				  let id = SCNetworkServiceGetServiceID(service) as String?,
				  let name = SCNetworkServiceGetName(service) as String? else { return nil }
			// SCNetworkConnection creation can synchronously contact a configured
			// provider. Never do that on every heartbeat; connection status is
			// therefore conservative until a subsequent node refresh confirms it.
			return VPNServiceTelemetry(id: id, name: name, isConnected: false)
		}
        .sorted { ($0.name, $0.id) < ($1.name, $1.id) }
        .prefix(32)
        .map { $0 }
    }

    public static func setConnected(id: String, connected: Bool) throws {
        guard let connection = SCNetworkConnectionCreateWithServiceID(nil, id as CFString, nil, nil) else {
            throw ThingtimeNodeError.policyDenied("The selected VPN service is no longer available.")
        }
        let result = connected
            ? SCNetworkConnectionStart(connection, nil, true)
            : SCNetworkConnectionStop(connection, true)
        guard result else {
            throw ThingtimeNodeError.policyDenied("macOS did not accept the selected VPN connection request.")
        }
    }

	private static func isRemoteAccessService(_ service: SCNetworkService) -> Bool {
		var interface = SCNetworkServiceGetInterface(service)
		while let current = interface {
			let kind = SCNetworkInterfaceGetInterfaceType(current) as String? ?? ""
			if ["PPP", "IPSec", "VPN"].contains(where: { kind.caseInsensitiveCompare($0) == .orderedSame }) { return true }
			interface = SCNetworkInterfaceGetInterface(current)
		}
		return false
	}
}

public enum SystemBattery {
    public static func snapshot(isPreventingIdleSleep: Bool) -> BatteryTelemetry {
        let isLowPowerModeEnabled = ProcessInfo.processInfo.isLowPowerModeEnabled
        guard let info = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
              let sources = IOPSCopyPowerSourcesList(info)?.takeRetainedValue() as? [CFTypeRef] else {
            return BatteryTelemetry(level: nil, isCharging: nil, isExternalPower: nil, isPreventingIdleSleep: isPreventingIdleSleep, isLowPowerModeEnabled: isLowPowerModeEnabled)
        }
        let values = sources.compactMap { IOPSGetPowerSourceDescription(info, $0)?.takeUnretainedValue() as? [String: Any] }
        guard !values.isEmpty else {
            return BatteryTelemetry(level: nil, isCharging: nil, isExternalPower: nil, isPreventingIdleSleep: isPreventingIdleSleep, isLowPowerModeEnabled: isLowPowerModeEnabled)
        }
        let level = values.compactMap { value -> Double? in
            guard let current = value[kIOPSCurrentCapacityKey] as? NSNumber,
                  let maximum = value[kIOPSMaxCapacityKey] as? NSNumber,
                  maximum.doubleValue > 0 else { return nil }
            return current.doubleValue / maximum.doubleValue
        }.first
        let charging = values.compactMap { $0[kIOPSIsChargingKey] as? Bool }.first
        let external = values.compactMap { $0[kIOPSPowerSourceStateKey] as? String }.contains(kIOPSACPowerValue)
        return BatteryTelemetry(level: level, isCharging: charging, isExternalPower: external, isPreventingIdleSleep: isPreventingIdleSleep, isLowPowerModeEnabled: isLowPowerModeEnabled)
    }
}

/// A closed interface to the three documented IOKit idle timers. It never
/// exposes arbitrary `pmset` keys, power profiles, or a shell command.
public enum SystemPowerTimers {
    public enum Scope: String, CaseIterable, Sendable {
        case display
        case system
        case disk

        fileprivate var aggressiveness: UInt {
            switch self {
            case .display: return UInt(kPMMinutesToDim)
            case .system: return UInt(kPMMinutesToSleep)
            case .disk: return UInt(kPMMinutesToSpinDown)
            }
        }
    }

    public static func snapshot() -> PowerTimerTelemetry {
        PowerTimerTelemetry(
            displayIdleMinutes: read(.display),
            systemSleepMinutes: read(.system),
            diskIdleMinutes: read(.disk)
        )
    }

    public static func set(scope: String, minutes: Int) throws -> Int {
        guard let scope = Scope(rawValue: scope), isValidMinutes(minutes) else {
            throw ThingtimeNodeError.invalidRequest("The requested power idle timer is invalid.")
        }
        let connection = IOPMFindPowerManagement(mach_port_t(0))
        guard connection != 0 else {
            throw ThingtimeNodeError.policyDenied("macOS did not provide the power-management service.")
        }
        defer { IOServiceClose(connection) }
        guard IOPMSetAggressiveness(connection, scope.aggressiveness, UInt(minutes)) == kIOReturnSuccess else {
            throw ThingtimeNodeError.policyDenied("macOS did not accept the requested power idle timer.")
        }
        guard let observed = read(scope), observed == minutes else {
            throw ThingtimeNodeError.policyDenied("macOS did not persist the requested power idle timer.")
        }
        return observed
    }

    public static func isValid(scope: String?, minutes: Double?) -> Bool {
        guard let scope, Scope(rawValue: scope) != nil,
              let minutes, minutes.isFinite, minutes.rounded() == minutes,
              minutes >= 0, minutes <= 180 else { return false }
        return true
    }

    private static func isValidMinutes(_ minutes: Int) -> Bool {
        (0 ... 180).contains(minutes)
    }

    private static func read(_ scope: Scope) -> Int? {
        let connection = IOPMFindPowerManagement(mach_port_t(0))
        guard connection != 0 else { return nil }
        defer { IOServiceClose(connection) }
        var minutes: UInt = 0
        guard IOPMGetAggressiveness(connection, scope.aggressiveness, &minutes) == kIOReturnSuccess,
              minutes <= UInt(Int.max) else { return nil }
        return Int(minutes)
    }
}

/// Generates one of two fixed configuration profiles and opens macOS's own
/// profile review. This is not an MDM enrolment or installation API: macOS
/// remains the only party that can show and accept the installation UI.
///
/// The payloads use the documented Restrictions payload and have no caller
/// controlled identifiers, display names, payload keys, or values other than
/// the closed boolean for the selected restriction.
@MainActor
public enum SystemConfigurationProfileProposal {
    public enum Scope: String, CaseIterable, Sendable {
        case airDrop = "airdrop"
        case camera

        fileprivate var restrictionKey: String {
            switch self {
            case .airDrop: return "allowAirDrop"
            case .camera: return "allowCamera"
            }
        }

        fileprivate var identifier: String {
            switch self {
            case .airDrop: return "com.thingtime.desktop.policy.airdrop"
            case .camera: return "com.thingtime.desktop.policy.camera"
            }
        }

        fileprivate var rootUUID: String {
            switch self {
            case .airDrop: return "214A9B35-3D42-4AFC-BFF4-D52C6B7EE911"
            case .camera: return "4C245E03-60C5-4D6A-8663-C2A3E6BC30A4"
            }
        }

        fileprivate var restrictionsUUID: String {
            switch self {
            case .airDrop: return "1E3231EE-791E-463D-8361-E9E5FE5B116F"
            case .camera: return "470F9F7A-1553-4EEF-9EFD-0FA06AD2E7F7"
            }
        }

        fileprivate var displayName: String {
            switch self {
            case .airDrop: return "Thingtime AirDrop availability"
            case .camera: return "Thingtime Camera availability"
            }
        }
    }

    public static func profileData(scope: Scope, enabled: Bool) throws -> Data {
        let restrictions: [String: Any] = [
            "PayloadType": "com.apple.applicationaccess",
            "PayloadVersion": 1,
            "PayloadIdentifier": "\(scope.identifier).restrictions",
            "PayloadUUID": scope.restrictionsUUID,
            "PayloadDisplayName": scope.displayName,
            scope.restrictionKey: enabled
        ]
        let profile: [String: Any] = [
            "PayloadType": "Configuration",
            "PayloadVersion": 1,
            "PayloadIdentifier": scope.identifier,
            "PayloadUUID": scope.rootUUID,
            "PayloadDisplayName": scope.displayName,
            "PayloadDescription": "A locally approved Thingtime policy proposal. Review before installing.",
            "PayloadContent": [restrictions]
        ]
        return try PropertyListSerialization.data(fromPropertyList: profile, format: .xml, options: 0)
    }

    public static func propose(scope: Scope, enabled: Bool, fileManager: FileManager = .default) async throws -> URL {
        let directory = try proposalDirectory(fileManager: fileManager)
        let state = enabled ? "enabled" : "disabled"
        let url = directory.appendingPathComponent("thingtime-\(scope.rawValue)-\(state).mobileconfig", isDirectory: false)
        try profileData(scope: scope, enabled: enabled).write(to: url, options: .atomic)
        try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)

        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        _ = try await NSWorkspace.shared.open(url, configuration: configuration)
        return url
    }

    private static func proposalDirectory(fileManager: FileManager) throws -> URL {
        guard let applicationSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            throw ThingtimeNodeError.policyDenied("macOS did not provide an application-support directory for the policy proposal.")
        }
        let directory = applicationSupport
            .appendingPathComponent("Thingtime Node", isDirectory: true)
            .appendingPathComponent("policy-proposals", isDirectory: true)
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try fileManager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
        return directory
    }
}

/// A fixed, consent-gated Apple Events surface for the user's Apple Music
/// application. This intentionally does not expose a generic media player,
/// arbitrary script source, media library data, queue, title, or history.
public enum SystemAppleMusic {
    private static let bundleIdentifier = "com.apple.Music"
    private static let commands: [String: String] = [
        "play": "tell application id \"com.apple.Music\" to play",
        "pause": "tell application id \"com.apple.Music\" to pause",
        "next": "tell application id \"com.apple.Music\" to next track",
        "previous": "tell application id \"com.apple.Music\" to previous track"
    ]

    public static func telemetry() -> AppleMusicTelemetry {
        AppleMusicTelemetry(
            isInstalled: NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleIdentifier) != nil,
            isRunning: !NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier).isEmpty
        )
    }

    public static func perform(operation: String) throws {
        guard let source = commands[operation] else {
            throw ThingtimeNodeError.invalidRequest("The requested Apple Music operation is invalid.")
        }
        guard telemetry().isInstalled else {
            throw ThingtimeNodeError.policyDenied("Apple Music is not installed on this Mac.")
        }
        guard let script = NSAppleScript(source: source) else {
            throw ThingtimeNodeError.policyDenied("macOS could not prepare the fixed Apple Music automation event.")
        }
        var error: NSDictionary?
        _ = script.executeAndReturnError(&error)
        if let error, let message = error[NSAppleScript.errorMessage] as? String {
            throw ThingtimeNodeError.policyDenied("Apple Music did not accept the approved operation: \(message)")
        }
    }

    /// Changes only Apple Music's own documented sound-volume property. This
    /// deliberately does not read player state, the media library, or queue.
    public static func setVolume(level: Double) throws {
        guard let percent = volumePercent(level) else {
            throw ThingtimeNodeError.invalidRequest("The requested Apple Music volume is invalid.")
        }
        guard telemetry().isInstalled else {
            throw ThingtimeNodeError.policyDenied("Apple Music is not installed on this Mac.")
        }
        guard telemetry().isRunning else {
            throw ThingtimeNodeError.policyDenied("Apple Music must be running before its volume can be changed.")
        }
        guard let script = NSAppleScript(source: "tell application id \"com.apple.Music\" to set sound volume to \(percent)") else {
            throw ThingtimeNodeError.policyDenied("macOS could not prepare the fixed Apple Music volume event.")
        }
        var error: NSDictionary?
        _ = script.executeAndReturnError(&error)
        if let error, let message = error[NSAppleScript.errorMessage] as? String {
            throw ThingtimeNodeError.policyDenied("Apple Music did not accept the approved volume change: \(message)")
        }
    }

    public static func isValidOperation(_ value: String?) -> Bool {
        guard let value else { return false }
        return commands[value] != nil
    }

    public static func isValidVolume(_ value: Double?) -> Bool {
        guard let value else { return false }
        return value.isFinite && (0 ... 1).contains(value)
    }

    private static func volumePercent(_ level: Double) -> Int? {
        guard isValidVolume(level) else { return nil }
        return Int((level * 100).rounded())
    }
}

/// A fixed, consent-gated Apple Events surface for the user's Spotify app.
/// This remains intentionally app-specific: it does not expose generic media
/// routing, arbitrary script source, track URIs, queues, library data, or
/// listening history.
public enum SystemSpotify {
    private static let bundleIdentifier = "com.spotify.client"
    private static let commands: [String: String] = [
        "play": "tell application id \"com.spotify.client\" to play",
        "pause": "tell application id \"com.spotify.client\" to pause",
        "next": "tell application id \"com.spotify.client\" to next track",
        "previous": "tell application id \"com.spotify.client\" to previous track"
    ]

    public static func telemetry() -> SpotifyTelemetry {
        SpotifyTelemetry(
            isInstalled: NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleIdentifier) != nil,
            isRunning: !NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier).isEmpty
        )
    }

    public static func perform(operation: String) throws {
        guard let source = commands[operation] else {
            throw ThingtimeNodeError.invalidRequest("The requested Spotify operation is invalid.")
        }
        guard telemetry().isInstalled else {
            throw ThingtimeNodeError.policyDenied("Spotify is not installed on this Mac.")
        }
        guard let script = NSAppleScript(source: source) else {
            throw ThingtimeNodeError.policyDenied("macOS could not prepare the fixed Spotify automation event.")
        }
        var error: NSDictionary?
        _ = script.executeAndReturnError(&error)
        if let error, let message = error[NSAppleScript.errorMessage] as? String {
            throw ThingtimeNodeError.policyDenied("Spotify did not accept the approved operation: \(message)")
        }
    }

    /// Changes only Spotify's own documented sound-volume property. This
    /// deliberately does not expose player metadata, queue, or library data.
    public static func setVolume(level: Double) throws {
        guard let percent = volumePercent(level) else {
            throw ThingtimeNodeError.invalidRequest("The requested Spotify volume is invalid.")
        }
        guard telemetry().isInstalled else {
            throw ThingtimeNodeError.policyDenied("Spotify is not installed on this Mac.")
        }
        guard telemetry().isRunning else {
            throw ThingtimeNodeError.policyDenied("Spotify must be running before its volume can be changed.")
        }
        guard let script = NSAppleScript(source: "tell application id \"com.spotify.client\" to set sound volume to \(percent)") else {
            throw ThingtimeNodeError.policyDenied("macOS could not prepare the fixed Spotify volume event.")
        }
        var error: NSDictionary?
        _ = script.executeAndReturnError(&error)
        if let error, let message = error[NSAppleScript.errorMessage] as? String {
            throw ThingtimeNodeError.policyDenied("Spotify did not accept the approved volume change: \(message)")
        }
    }

    public static func isValidOperation(_ value: String?) -> Bool {
        guard let value else { return false }
        return commands[value] != nil
    }

    public static func isValidVolume(_ value: Double?) -> Bool {
        guard let value else { return false }
        return value.isFinite && (0 ... 1).contains(value)
    }

    private static func volumePercent(_ level: Double) -> Int? {
        guard isValidVolume(level) else { return nil }
        return Int((level * 100).rounded())
    }
}

/// A fixed Apple Events bridge for only the active Chrome YouTube or YouTube
/// Music tab. It never receives a URL, script, selector, browser profile, or
/// arbitrary page target from a remote caller. Chrome itself requires the Mac
/// user to enable "Allow JavaScript from Apple Events" before it will accept
/// this documented AppleScript command.
public enum SystemChromeYouTube {
    private static let bundleIdentifier = "com.google.Chrome"

    public static func telemetry() -> ChromeYouTubeTelemetry {
        ChromeYouTubeTelemetry(
            isInstalled: NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleIdentifier) != nil,
            isRunning: !NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier).isEmpty
        )
    }

    public static func setVolume(level: Double) throws {
        guard let percent = volumePercent(level) else {
            throw ThingtimeNodeError.invalidRequest("The requested Chrome YouTube volume is invalid.")
        }
        guard telemetry().isInstalled else {
            throw ThingtimeNodeError.policyDenied("Google Chrome is not installed on this Mac.")
        }
        guard telemetry().isRunning else {
            throw ThingtimeNodeError.policyDenied("Google Chrome must be running before its active YouTube player can be changed.")
        }
        guard let script = NSAppleScript(source: source(volumePercent: percent)) else {
            throw ThingtimeNodeError.policyDenied("macOS could not prepare the fixed Chrome YouTube volume event.")
        }
        var error: NSDictionary?
        let result = script.executeAndReturnError(&error)
        // Do not surface Chrome's raw Apple Event error: it can contain the
        // active tab's private URL or page detail. The actionable consent
        // guidance is stable without leaking browser data.
        if error != nil {
            throw ThingtimeNodeError.policyDenied("Chrome rejected the approved YouTube volume change. Confirm Automation access and Chrome's Allow JavaScript from Apple Events setting.")
        }
        switch result.stringValue {
        case "ok":
            return
        case "wrong-host":
            throw ThingtimeNodeError.policyDenied("Chrome's active tab must be a YouTube or YouTube Music player.")
        case "no-player":
            throw ThingtimeNodeError.policyDenied("Chrome's active YouTube tab has no controllable audio or video player.")
        default:
            throw ThingtimeNodeError.policyDenied("Chrome could not confirm the approved YouTube volume change.")
        }
    }

    public static func isValidVolume(_ value: Double?) -> Bool {
        guard let value else { return false }
        return value.isFinite && (0 ... 1).contains(value)
    }

    static func source(volumePercent: Int) -> String {
        let javascript = "(() => { const host = window.location.hostname; if (host !== 'www.youtube.com' && host !== 'music.youtube.com' && host !== 'm.youtube.com' && host !== 'www.youtube-nocookie.com') return 'wrong-host'; const media = document.querySelector('video, audio'); if (!(media instanceof HTMLMediaElement)) return 'no-player'; media.volume = \(volumePercent) / 100; return Math.round(media.volume * 100) === \(volumePercent) ? 'ok' : 'failed'; })()"
        return """
        tell application id "com.google.Chrome"
            tell active tab of front window
                return execute javascript "\(javascript)"
            end tell
        end tell
        """
    }

    private static func volumePercent(_ level: Double) -> Int? {
        guard isValidVolume(level) else { return nil }
        return Int((level * 100).rounded())
    }
}

@MainActor
public final class PowerAssertionController {
    private var assertionID: IOPMAssertionID = 0
    public private(set) var isPreventingIdleSleep = false

    public init() {}

    deinit {
        if isPreventingIdleSleep { IOPMAssertionRelease(assertionID) }
    }

    public func setPreventingIdleSleep(_ enabled: Bool) throws {
        guard enabled != isPreventingIdleSleep else { return }
        if enabled {
            let result = IOPMAssertionCreateWithName(
                kIOPMAssertionTypeNoIdleSleep as CFString,
                IOPMAssertionLevel(kIOPMAssertionLevelOn),
                "Thingtime Node remote approval" as CFString,
                &assertionID
            )
            guard result == kIOReturnSuccess else {
                throw ThingtimeNodeError.policyDenied("macOS could not create the keep-awake assertion.")
            }
            isPreventingIdleSleep = true
        } else {
            guard IOPMAssertionRelease(assertionID) == kIOReturnSuccess else {
                throw ThingtimeNodeError.policyDenied("macOS could not release the keep-awake assertion.")
            }
            assertionID = 0
            isPreventingIdleSleep = false
        }
    }
}
