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
        guard CGDisplaySetDisplayMode(displayID, mode, nil) == .success else {
            throw ThingtimeNodeError.policyDenied("macOS did not accept the selected display mode.")
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
            guard let id = PMPrinterGetID(printer) as String?,
                  let name = PMPrinterGetName(printer) as String? else { return nil }
            return PrinterTelemetry(id: id, name: name, isDefault: PMPrinterIsDefault(printer))
        }
        .sorted { ($0.name, $0.id) < ($1.name, $1.id) }
        .prefix(64)
        .map { $0 }
    }

    public static func setDefault(id: String) throws {
        guard let printers = printerList(),
              let printer = printers.first(where: { PMPrinterGetID($0) as String? == id }) else {
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

    public static func isValidOperation(_ value: String?) -> Bool {
        guard let value else { return false }
        return commands[value] != nil
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
