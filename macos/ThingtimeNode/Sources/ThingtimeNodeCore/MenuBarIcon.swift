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

    public static let defaultID = ThingtimeMenuBarIconID.treeColor

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

@MainActor
public enum ThingtimeMenuBarIconRenderer {
    private struct Pixel {
        let x: CGFloat
        let y: CGFloat
        let color: NSColor
    }

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
        let size = NSSize(width: 108, height: 20)
        let pixels = wordmarkPixels
        let image = NSImage(size: size, flipped: false) { _ in
            let scale = min((size.width - 4) / 837, (size.height - 2) / 155)
            let drawnWidth = 837 * scale
            let drawnHeight = 155 * scale
            let origin = CGPoint(x: (size.width - drawnWidth) / 2, y: (size.height - drawnHeight) / 2)
            for pixel in pixels {
                let color: NSColor
                switch id {
                case .wordmarkColor:
                    color = pixel.color
                case .wordmarkWhite:
                    color = .white
                default:
                    color = .black
                }
                color.setFill()
                NSRect(
                    x: origin.x + pixel.x * scale,
                    y: origin.y + (155 - pixel.y - 31) * scale,
                    width: 31 * scale,
                    height: 31 * scale
                ).fill()
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

    // Exact 31-point pixel geometry and brand colours from the canonical
    // Thingtime horizontal wordmark SVG.
    private static let wordmarkPixels: [Pixel] = {
        let mint = NSColor(srgbRed: 0x58 / 255, green: 0xFF / 255, blue: 0x9C / 255, alpha: 1)
        let cyan = NSColor(srgbRed: 0x58 / 255, green: 0xBD / 255, blue: 0xFF / 255, alpha: 1)
        let red = NSColor(srgbRed: 0xED / 255, green: 0x1C / 255, blue: 0x25 / 255, alpha: 1)
        let sky = NSColor(srgbRed: 0x02 / 255, green: 0xB7 / 255, blue: 0xEF / 255, alpha: 1)
        let purple = NSColor(srgbRed: 0x6F / 255, green: 0x30 / 255, blue: 0x98 / 255, alpha: 1)
        let yellow = NSColor(srgbRed: 0xFF / 255, green: 0xC2 / 255, blue: 0x0D / 255, alpha: 1)
        let orange = NSColor(srgbRed: 0xFF / 255, green: 0x7E / 255, blue: 0, alpha: 1)
        func pixels(_ coordinates: [(CGFloat, CGFloat)], color: NSColor) -> [Pixel] {
            coordinates.map { Pixel(x: $0.0, y: $0.1, color: color) }
        }
        return pixels([(0, 0), (31, 0), (62, 0), (31, 31), (31, 62)], color: mint)
            + pixels([(124, 0), (124, 31), (155, 31), (124, 62), (155, 62)], color: cyan)
            + pixels([(217, 0)], color: red)
            + pixels([(217, 62), (589, 0)], color: sky)
            + pixels([(279, 31), (310, 31), (279, 62), (310, 62)], color: pink)
            + pixels([(372, 31), (403, 31), (372, 62), (403, 62), (403, 93), (372, 124), (403, 124)], color: purple)
            + pixels([(496, 0), (465, 31), (527, 31)], color: green)
            + pixels([(496, 62)], color: brown)
            + pixels([(589, 62)], color: red)
            + pixels([(651, 31), (682, 31), (651, 62), (682, 62), (713, 31), (713, 62)], color: yellow)
            + pixels([(775, 31), (806, 31), (775, 62), (806, 62)], color: orange)
    }()
}
