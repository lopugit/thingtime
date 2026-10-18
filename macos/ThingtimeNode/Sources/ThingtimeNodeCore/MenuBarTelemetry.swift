import AppKit
import ApplicationServices
import CoreGraphics
import Darwin
import Foundation

/// Read-only status-item inventory. No menus are opened, images captured, or
/// commands/arguments inspected. Paths identify only the owning executable/app.
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
}

public struct MenuBarTelemetry: Codable, Equatable, Sendable {
    public let status: String
    public let collectedAt: Date
    public let accessibility: Bool
    public let unreadableApplications: Int
    public let items: [MenuBarItemTelemetry]
}

public enum SystemMenuBar {
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
                      cpuTimeSeconds: measured ? Double(measurements.ri_user_time + measurements.ri_system_time) / 1_000_000_000 : nil)
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
