import AppKit
import Foundation

public enum ThingtimeMenuBarIconID: String, CaseIterable, Sendable {
    case treeColor = "tree-color"
    case treeTemplate = "tree-template"
    case treeBlack = "tree-black"
    case treeWhite = "tree-white"
    case treePink = "tree-pink"
    case treeBlue = "tree-blue"
    case wordmarkColor = "wordmark-color"
    case wordmarkTemplate = "wordmark-template"
    case wordmarkBlack = "wordmark-black"
    case wordmarkWhite = "wordmark-white"
    case custom

    public static let defaultID = ThingtimeMenuBarIconID.treePink

    public init(environmentValue: String?) {
        self = environmentValue.flatMap(Self.init(rawValue:)) ?? Self.defaultID
    }

    public var isWordmark: Bool {
        switch self {
        case .wordmarkColor, .wordmarkTemplate, .wordmarkBlack, .wordmarkWhite:
            true
        default:
            false
        }
    }
}

public enum ThingtimeStatusMenuCopy {
    public static let starting = "Starting…"
    public static let refreshStatus = "Refresh Status"
    public static let openThingtime = "Open Thingtime"
    public static let restartThingtime = "Restart Thingtime"
    public static let quitThingtime = "Quit Thingtime"
    public static let degraded = "Thingtime degraded"
    public static let unavailable = "Thingtime unavailable"
    public static let couldNotQuit = "Couldn’t quit Thingtime"

    public static func healthy(accountCount: Int) -> String {
        accountCount > 1
            ? "Paired to \(accountCount) accounts · Thingtime healthy"
            : accountCount == 1 ? "Paired · Thingtime healthy" : "Ready to pair"
    }

    public static func commandTitles(launchdManaged: Bool) -> [String] {
        [refreshStatus, openThingtime]
            + (launchdManaged ? [restartThingtime] : [])
            + [quitThingtime]
    }
}

@MainActor
public enum ThingtimeMenuBarIconRenderer {
    private static let green = NSColor(srgbRed: 0xA8 / 255, green: 0xE6 / 255, blue: 0x1D / 255, alpha: 1)
    private static let brown = NSColor(srgbRed: 0x9C / 255, green: 0x5A / 255, blue: 0x3C / 255, alpha: 1)
    private static let pink = NSColor(srgbRed: 0xFF / 255, green: 0xA9 / 255, blue: 0xDD / 255, alpha: 1)
    private static let blue = NSColor(srgbRed: 0x58 / 255, green: 0xBD / 255, blue: 0xFF / 255, alpha: 1)

    public static func image(
        id: ThingtimeMenuBarIconID,
        customPath: String? = nil
    ) -> NSImage {
        if id == .custom,
           let customPath,
           let custom = normalizedCustomImage(at: customPath) {
            return custom
        }
        return id.isWordmark ? wordmark(id: id) : tree(id: id == .custom ? .treeColor : id)
    }

    private static func tree(id: ThingtimeMenuBarIconID) -> NSImage {
        let size = NSSize(width: 18, height: 18)
        let image = NSImage(size: size, flipped: false) { _ in
            let cell: CGFloat = 4
            let gap: CGFloat = 0.75
            let origin = CGPoint(x: 2.25, y: 2.25)
            let colors: [NSColor]
            switch id {
            case .treeColor:
                colors = [green, green, green, brown]
            case .treePink:
                colors = Array(repeating: pink, count: 4)
            case .treeBlue:
                colors = Array(repeating: blue, count: 4)
            case .treeWhite:
                colors = Array(repeating: .white, count: 4)
            default:
                colors = Array(repeating: .black, count: 4)
            }
            let step = cell + gap
            let rectangles = [
                NSRect(x: origin.x + step, y: origin.y + step * 2, width: cell, height: cell),
                NSRect(x: origin.x, y: origin.y + step, width: cell, height: cell),
                NSRect(x: origin.x + step * 2, y: origin.y + step, width: cell, height: cell),
                NSRect(x: origin.x + step, y: origin.y, width: cell, height: cell)
            ]
            for (index, rectangle) in rectangles.enumerated() {
                colors[index].setFill()
                rectangle.fill()
            }
            return true
        }
        image.isTemplate = id == .treeTemplate
        image.accessibilityDescription = "Thingtime tree"
        return image
    }

    private static func wordmark(id: ThingtimeMenuBarIconID) -> NSImage {
        let size = NSSize(width: 86, height: 16)
        guard let resourceURL = Bundle.module.url(
            forResource: "thingtime-wordmark-color",
            withExtension: "png",
            subdirectory: "MenuBar"
        ) ?? Bundle.module.url(forResource: "thingtime-wordmark-color", withExtension: "png"),
        let source = NSImage(contentsOf: resourceURL) else {
            return tree(id: .treePink)
        }
        let image = NSImage(size: size, flipped: false) { _ in
            NSGraphicsContext.saveGraphicsState()
            defer { NSGraphicsContext.restoreGraphicsState() }
            NSGraphicsContext.current?.imageInterpolation = .high
            let bounds = NSRect(origin: .zero, size: size)
            source.draw(in: bounds, from: .zero, operation: .sourceOver, fraction: 1)
            if id != .wordmarkColor {
                NSGraphicsContext.current?.compositingOperation = .sourceIn
                (id == .wordmarkWhite ? NSColor.white : NSColor.black).setFill()
                bounds.fill()
            }
            return true
        }
        image.isTemplate = id == .wordmarkTemplate
        image.accessibilityDescription = "Thingtime pixel logo"
        return image
    }

    private static func normalizedCustomImage(at path: String) -> NSImage? {
        guard path.utf8.count <= 4_096,
              path.hasPrefix("/"),
              let source = NSImage(contentsOfFile: path),
              source.size.width > 0,
              source.size.height > 0 else { return nil }
        let size = NSSize(width: 18, height: 18)
        let image = NSImage(size: size, flipped: false) { bounds in
            let scale = min(bounds.width / source.size.width, bounds.height / source.size.height)
            let drawn = NSSize(width: source.size.width * scale, height: source.size.height * scale)
            let target = NSRect(
                x: (bounds.width - drawn.width) / 2,
                y: (bounds.height - drawn.height) / 2,
                width: drawn.width,
                height: drawn.height
            )
            source.draw(in: target, from: .zero, operation: .sourceOver, fraction: 1)
            return true
        }
        image.accessibilityDescription = "Custom Thingtime menu bar icon"
        return image
    }
}
