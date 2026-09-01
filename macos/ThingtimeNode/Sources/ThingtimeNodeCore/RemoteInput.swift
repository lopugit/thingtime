import ApplicationServices
import CoreGraphics
import Foundation

/// Narrow, consent-gated event injection for a paired Thingtime device. This
/// deliberately has no event tap, key logging, clipboard access, process
/// inspection, shell execution, or arbitrary script surface.
public enum SystemRemoteInput {
    public static let maximumTextUTF8Bytes = 4_096
    public static let maximumScrollDelta = 5_000

    private static let allowedButtons: Set<String> = ["left", "right", "middle"]
    private static let allowedModifiers: Set<String> = ["command", "control", "option", "shift", "function"]
    private static let keyCodes: [String: CGKeyCode] = [
        "a": 0x00, "b": 0x0B, "c": 0x08, "d": 0x02, "e": 0x0E, "f": 0x03,
        "g": 0x05, "h": 0x04, "i": 0x22, "j": 0x26, "k": 0x28, "l": 0x25,
        "m": 0x2E, "n": 0x2D, "o": 0x1F, "p": 0x23, "q": 0x0C, "r": 0x0F,
        "s": 0x01, "t": 0x11, "u": 0x20, "v": 0x09, "w": 0x0D, "x": 0x07,
        "y": 0x10, "z": 0x06,
        "0": 0x1D, "1": 0x12, "2": 0x13, "3": 0x14, "4": 0x15,
        "5": 0x17, "6": 0x16, "7": 0x1A, "8": 0x1C, "9": 0x19,
        "return": 0x24, "tab": 0x30, "space": 0x31, "delete": 0x33, "escape": 0x35,
        "left": 0x7B, "right": 0x7C, "down": 0x7D, "up": 0x7E,
        "home": 0x73, "end": 0x77, "pageup": 0x74, "pagedown": 0x79,
        "f1": 0x7A, "f2": 0x78, "f3": 0x63, "f4": 0x76, "f5": 0x60, "f6": 0x61,
        "f7": 0x62, "f8": 0x64, "f9": 0x65, "f10": 0x6D, "f11": 0x67, "f12": 0x6F
    ]

    public static func isValidButton(_ value: String?) -> Bool {
        guard let value else { return false }
        return allowedButtons.contains(value)
    }

    public static func isValidText(_ value: String?) -> Bool {
        guard let value, !value.isEmpty, value.utf8.count <= maximumTextUTF8Bytes else { return false }
        return value.unicodeScalars.allSatisfy { scalar in
            let code = scalar.value
            return code == 0x09 || code == 0x0A || code == 0x0D || (code > 0x1F && !(0x7F ... 0x9F).contains(code))
        }
    }

    public static func isValidShortcut(key: String?, modifiers: [String]?) -> Bool {
        guard let key, keyCodes[key] != nil, let modifiers, modifiers.count <= allowedModifiers.count else { return false }
        let values = Set(modifiers)
        return values.count == modifiers.count && values.isSubset(of: allowedModifiers)
    }

    public static func isValidScroll(deltaX: Double?, deltaY: Double?) -> Bool {
        guard let deltaX, let deltaY,
              deltaX.isFinite, deltaY.isFinite,
              deltaX.rounded() == deltaX, deltaY.rounded() == deltaY,
              abs(deltaX) <= Double(maximumScrollDelta), abs(deltaY) <= Double(maximumScrollDelta) else {
            return false
        }
        return deltaX != 0 || deltaY != 0
    }

    public static func move(displayID: UInt32, x: Double, y: Double) throws {
        let point = try point(displayID: displayID, x: x, y: y)
        guard let source = try eventSource(),
              let event = CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left) else {
            throw ThingtimeNodeError.policyDenied("macOS could not create the pointer move event.")
        }
        event.post(tap: .cghidEventTap)
    }

    public static func click(displayID: UInt32, x: Double, y: Double, button: String) throws {
        let point = try point(displayID: displayID, x: x, y: y)
        guard isValidButton(button), let source = try eventSource() else {
            throw ThingtimeNodeError.invalidRequest("The pointer button is invalid.")
        }
        let details: (CGMouseButton, CGEventType, CGEventType)
        switch button {
        case "left": details = (.left, .leftMouseDown, .leftMouseUp)
        case "right": details = (.right, .rightMouseDown, .rightMouseUp)
        case "middle": details = (.center, .otherMouseDown, .otherMouseUp)
        default: throw ThingtimeNodeError.invalidRequest("The pointer button is invalid.")
        }
        guard let moved = CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: details.0),
              let down = CGEvent(mouseEventSource: source, mouseType: details.1, mouseCursorPosition: point, mouseButton: details.0),
              let up = CGEvent(mouseEventSource: source, mouseType: details.2, mouseCursorPosition: point, mouseButton: details.0) else {
            throw ThingtimeNodeError.policyDenied("macOS could not create the pointer click event.")
        }
        moved.post(tap: .cghidEventTap)
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    }

    public static func scroll(deltaX: Double, deltaY: Double) throws {
        guard isValidScroll(deltaX: deltaX, deltaY: deltaY), let source = try eventSource(),
              let event = CGEvent(
                scrollWheelEvent2Source: source,
                units: .pixel,
                wheelCount: 2,
                wheel1: Int32(deltaY),
                wheel2: Int32(deltaX),
                wheel3: 0
              ) else {
            throw ThingtimeNodeError.invalidRequest("The pointer scroll values are invalid.")
        }
        event.post(tap: .cghidEventTap)
    }

    public static func type(text: String) throws {
        guard isValidText(text), let source = try eventSource(),
              let keyDown = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
              let keyUp = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false) else {
            throw ThingtimeNodeError.invalidRequest("The text input is invalid.")
        }
        var codeUnits = Array(text.utf16)
        keyDown.keyboardSetUnicodeString(stringLength: codeUnits.count, unicodeString: &codeUnits)
        keyUp.keyboardSetUnicodeString(stringLength: codeUnits.count, unicodeString: &codeUnits)
        keyDown.post(tap: .cghidEventTap)
        keyUp.post(tap: .cghidEventTap)
    }

    public static func shortcut(key: String, modifiers: [String]) throws {
        guard isValidShortcut(key: key, modifiers: modifiers), let code = keyCodes[key], let source = try eventSource(),
              let keyDown = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true),
              let keyUp = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false) else {
            throw ThingtimeNodeError.invalidRequest("The keyboard shortcut is invalid.")
        }
        let flags = modifierFlags(modifiers)
        keyDown.flags = flags
        keyUp.flags = flags
        keyDown.post(tap: .cghidEventTap)
        keyUp.post(tap: .cghidEventTap)
    }

    private static func eventSource() throws -> CGEventSource? {
        guard AXIsProcessTrusted() else {
            throw ThingtimeNodeError.policyDenied("Remote pointer and keyboard control requires Accessibility permission for Thingtime Node.")
        }
        return CGEventSource(stateID: .hidSystemState)
    }

    private static func point(displayID: UInt32, x: Double, y: Double) throws -> CGPoint {
        guard x.isFinite, y.isFinite, x.rounded() == x, y.rounded() == y else {
            throw ThingtimeNodeError.invalidRequest("Pointer coordinates must be whole finite pixels.")
        }
        let online = onlineDisplayIDs()
        guard online.contains(displayID) else {
            throw ThingtimeNodeError.policyDenied("The selected display is no longer available.")
        }
        let bounds = CGDisplayBounds(displayID)
        guard x >= 0, y >= 0, x < bounds.width, y < bounds.height else {
            throw ThingtimeNodeError.policyDenied("The pointer target is outside the selected display.")
        }
        return CGPoint(x: bounds.origin.x + x, y: bounds.origin.y + y)
    }

    private static func onlineDisplayIDs() -> Set<UInt32> {
        var count: UInt32 = 0
        guard CGGetOnlineDisplayList(0, nil, &count) == .success, count > 0 else { return [] }
        var ids = Array(repeating: CGDirectDisplayID(), count: Int(count))
        guard CGGetOnlineDisplayList(count, &ids, &count) == .success else { return [] }
        return Set(ids.prefix(Int(count)))
    }

    private static func modifierFlags(_ modifiers: [String]) -> CGEventFlags {
        modifiers.reduce(into: CGEventFlags()) { flags, modifier in
            switch modifier {
            case "command": flags.insert(.maskCommand)
            case "control": flags.insert(.maskControl)
            case "option": flags.insert(.maskAlternate)
            case "shift": flags.insert(.maskShift)
            case "function": flags.insert(.maskSecondaryFn)
            default: break
            }
        }
    }
}
