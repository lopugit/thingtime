import AppKit
import ApplicationServices
import CoreGraphics
import Darwin
import Foundation
import ScreenCaptureKit

/// Read-only status-item inventory. No menus are opened or commands/arguments inspected.
/// Optional thumbnails capture only verified status windows, with app-icon fallback. Paths identify only the owning executable/app.
public struct MenuBarItemTelemetry: Codable, Equatable, Sendable {
    public let id: String
    public let label: String?
    public let processId: Int32
    public let program: String
    public let bundleId: String?
    public let appPath: String?
    public let executablePath: String?
    public let source: String
    public let visible: Bool?
    public let x: Double?
    public let y: Double?
    public let width: Double?
    public let height: Double?
    public let residentBytes: UInt64?
    public let cpuTimeSeconds: Double?
    public var iconDataUrl: String? = nil
    public var iconSource: String? = nil
}

public struct MenuBarTelemetry: Codable, Equatable, Sendable {
    public let status: String
    public let collectedAt: Date
    public let accessibility: Bool
    public let unreadableApplications: Int
    public let items: [MenuBarItemTelemetry]
}

public enum SystemMenuBar {
    /// Pixel data stays in the owner-only device snapshot. Never capture a display
    /// or an arbitrary application window, and never prompt from telemetry.
    public static func snapshotWithIcons() async -> MenuBarTelemetry {
        let snapshot = snapshot()
        var items = snapshot.items
        let fallback = await MainActor.run { () -> [Int32: String] in
            var icons: [Int32: String] = [:]
            for pid in Set(snapshot.items.map(\.processId)) {
                guard let image = NSRunningApplication(processIdentifier: pid)?.icon,
                      let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil),
                      let data = thumbnail(cg) else { continue }
                icons[pid] = data
            }
            return icons
        }
        for index in items.indices {
            items[index].iconDataUrl = fallback[items[index].processId]
            items[index].iconSource = items[index].iconDataUrl == nil ? nil : "application"
        }
        if #available(macOS 14.0, *), CGPreflightScreenCaptureAccess(), let content = try? await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true) {
            let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
            let statusIDs = Set(windows.filter { ($0[kCGWindowLayer as String] as? Int) == Int(CGWindowLevelForKey(.statusWindow)) }
                .compactMap { $0[kCGWindowNumber as String] as? UInt32 })
            for index in items.indices where items[index].visible == true {
                let item = items[index]
                guard let x = item.x, let y = item.y, let width = item.width, let height = item.height,
                      height > 0, height <= 64, width > 0,
                      let window = content.windows.first(where: {
                        statusIDs.contains($0.windowID) && $0.owningApplication?.processID == item.processId
                        && abs($0.frame.minX - x) < 2 && abs($0.frame.minY - y) < 2
                        && abs($0.frame.width - width) < 2 && abs($0.frame.height - height) < 2
                      }) else { continue }
                let configuration = SCStreamConfiguration()
                configuration.width = max(1, min(128, Int(width * 2)))
                configuration.height = max(1, min(128, Int(height * 2)))
                configuration.showsCursor = false
                configuration.ignoreShadowsSingleWindow = true
                guard let image = try? await SCScreenshotManager.captureImage(contentFilter: SCContentFilter(desktopIndependentWindow: window), configuration: configuration),
                      let icon = thumbnail(image) else { continue }
                items[index].iconDataUrl = icon
                items[index].iconSource = "menu-bar"
            }
        }
        return .init(status: snapshot.status, collectedAt: snapshot.collectedAt, accessibility: snapshot.accessibility,
                     unreadableApplications: snapshot.unreadableApplications, items: items)
    }

    static func thumbnail(_ image: CGImage) -> String? {
        let scale = min(1, 64 / Double(max(image.width, image.height)))
        let width = max(1, Int(Double(image.width) * scale)), height = max(1, Int(Double(image.height) * scale))
        guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        context.interpolationQuality = .high
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        guard let resized = context.makeImage(), let data = NSBitmapImageRep(cgImage: resized).representation(using: .png, properties: [:]) else { return nil }
        return "data:image/png;base64," + data.base64EncodedString()
    }

    private static let timebase: mach_timebase_info_data_t = {
        var value = mach_timebase_info_data_t()
        mach_timebase_info(&value)
        return value
    }()

    /// proc_pid_rusage CPU counters are Mach absolute ticks, not nanoseconds.
    /// Convert before adding so even two large counters cannot overflow UInt64.
    static func cpuSeconds(user: UInt64, system: UInt64,
                           timebase: mach_timebase_info_data_t = timebase) -> Double? {
        guard timebase.numer > 0, timebase.denom > 0 else { return nil }
        return (Double(user) + Double(system)) * Double(timebase.numer)
            / Double(timebase.denom) / 1_000_000_000
    }

    private static func value(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
        var result: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &result) == .success else { return nil }
        return result
    }

    private static func bounds(_ element: AXUIElement) -> CGRect? {
        guard let p = value(element, kAXPositionAttribute), CFGetTypeID(p) == AXValueGetTypeID(),
              let s = value(element, kAXSizeAttribute), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
        var point = CGPoint.zero, size = CGSize.zero
        guard AXValueGetValue(p as! AXValue, .cgPoint, &point), AXValueGetValue(s as! AXValue, .cgSize, &size) else { return nil }
        return CGRect(origin: point, size: size)
    }

    public static func snapshot(now: Date = Date(), locked: Bool = false) -> MenuBarTelemetry {
        let trusted = AXIsProcessTrusted()
        guard !locked else { return .init(status: "locked", collectedAt: now, accessibility: trusted, unreadableApplications: 0, items: []) }
        let windows = CGWindowListCopyWindowInfo([.excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
        // Public CoreGraphics status-window layer. Window names are deliberately
        // excluded: a label comes only from the status item's AX attributes.
        let statusWindows = windows.filter { ($0[kCGWindowLayer as String] as? Int) == Int(CGWindowLevelForKey(.statusWindow)) }
        var apps = Dictionary(NSWorkspace.shared.runningApplications.filter { $0.activationPolicy != .prohibited }.map { ($0.processIdentifier, $0) }, uniquingKeysWith: { first, _ in first })
        for window in statusWindows {
            if let pid = window[kCGWindowOwnerPID as String] as? Int32, apps[pid] == nil,
               let app = NSRunningApplication(processIdentifier: pid) { apps[pid] = app }
        }
        var items: [MenuBarItemTelemetry] = []
        var unreadable = 0
        for (pid, app) in apps.sorted(by: { $0.key < $1.key }) {
            var measurements = rusage_info_v2()
            let measured = withUnsafeMutablePointer(to: &measurements) { pointer in
                pointer.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) { proc_pid_rusage(pid, RUSAGE_INFO_V2, $0) == 0 }
            }
            func item(_ id: String, _ label: String?, _ rect: CGRect?, _ visible: Bool?, _ source: String) -> MenuBarItemTelemetry {
                .init(id: id, label: label, processId: pid, program: app.localizedName ?? app.bundleIdentifier ?? "Process \(pid)",
                      bundleId: app.bundleIdentifier, appPath: app.bundleURL?.path, executablePath: app.executableURL?.path,
                      source: source, visible: visible, x: rect.map { Double($0.minX) }, y: rect.map { Double($0.minY) },
                      width: rect.map { Double($0.width) }, height: rect.map { Double($0.height) },
                      residentBytes: measured ? measurements.ri_resident_size : nil,
                      cpuTimeSeconds: measured ? cpuSeconds(user: measurements.ri_user_time, system: measurements.ri_system_time) : nil)
            }
            var appItems: [MenuBarItemTelemetry] = []
            if trusted {
                let element = AXUIElementCreateApplication(pid)
                AXUIElementSetMessagingTimeout(element, 0.15)
                var extras: CFTypeRef?
                let error = AXUIElementCopyAttributeValue(element, kAXExtrasMenuBarAttribute as CFString, &extras)
                if error == .success, let extras, CFGetTypeID(extras) == AXUIElementGetTypeID() {
                    let bar = extras as! AXUIElement
                    AXUIElementSetMessagingTimeout(bar, 0.15)
                    let children = value(bar, kAXChildrenAttribute) as? [AXUIElement] ?? []
                    for (index, child) in children.enumerated() {
                        AXUIElementSetMessagingTimeout(child, 0.15)
                        let rect = bounds(child)
                        let label = [kAXTitleAttribute, kAXDescriptionAttribute, kAXHelpAttribute]
                            .compactMap { value(child, $0) as? String }.first { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
                        let window = statusWindows.first { candidate in
                            guard (candidate[kCGWindowOwnerPID as String] as? Int32) == pid, let rect,
                                  let raw = candidate[kCGWindowBounds as String] as? NSDictionary,
                                  let frame = CGRect(dictionaryRepresentation: raw) else { return false }
                            return abs(rect.minX - frame.minX) < 2 && abs(rect.minY - frame.minY) < 2
                        }
                        appItems.append(item("ax:\(pid):\(index)", label, rect, window?[kCGWindowIsOnscreen as String] as? Bool, "accessibility"))
                    }
                } else if error != .attributeUnsupported && error != .noValue { unreadable += 1 }
            }
            for window in statusWindows where (window[kCGWindowOwnerPID as String] as? Int32) == pid {
                guard let dictionary = window[kCGWindowBounds as String] as? NSDictionary,
                      let rect = CGRect(dictionaryRepresentation: dictionary), rect.width > 0, rect.height > 0 else { continue }
                if appItems.contains(where: { existing in
                    guard let x = existing.x, let y = existing.y else { return false }
                    return abs(x - rect.minX) < 2 && abs(y - rect.minY) < 2
                }) { continue }
                let number = window[kCGWindowNumber as String] as? Int ?? 0
                appItems.append(item("window:\(pid):\(number)", nil, rect, window[kCGWindowIsOnscreen as String] as? Bool, "window"))
            }
            items.append(contentsOf: appItems)
        }
        items.sort { ($0.x ?? .greatestFiniteMagnitude, $0.processId, $0.id) < ($1.x ?? .greatestFiniteMagnitude, $1.processId, $1.id) }
        return .init(status: trusted && unreadable == 0 ? "available" : "partial", collectedAt: now,
                     accessibility: trusted, unreadableApplications: unreadable, items: items)
    }
}
