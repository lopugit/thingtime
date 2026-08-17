import Carbon
import Foundation

enum HotKeyError: LocalizedError {
  case invalidShortcut(String)
  case registrationFailed(OSStatus)

  var errorDescription: String? {
    switch self {
    case .invalidShortcut(let shortcut): "Unsupported shortcut: \(shortcut)"
    case .registrationFailed(let status):
      "macOS rejected this shortcut (\(status)). It may already be assigned."
    }
  }
}

@MainActor
final class GlobalHotKeyRegistry {
  private static let signature: OSType = 0x434D4452 // CMDR
  private var hotKeyRefs: [EventHotKeyRef] = []
  private var eventHandler: EventHandlerRef?
  private var keysByIdentifier: [UInt32: String] = [:]
  private let handler: (String) -> Void

  init(shortcuts: [String: String], handler: @escaping (String) -> Void) throws {
    self.handler = handler
    guard !shortcuts.isEmpty else { return }

    var specification = EventTypeSpec(
      eventClass: OSType(kEventClassKeyboard),
      eventKind: UInt32(kEventHotKeyPressed)
    )
    let install = InstallEventHandler(
      GetApplicationEventTarget(),
      { _, event, pointer -> OSStatus in
        guard let pointer else { return OSStatus(eventNotHandledErr) }
        return MainActor.assumeIsolated {
          Unmanaged<GlobalHotKeyRegistry>.fromOpaque(pointer).takeUnretainedValue()
            .handle(event: event)
        }
      },
      1,
      &specification,
      Unmanaged.passUnretained(self).toOpaque(),
      &eventHandler
    )
    guard install == noErr else { throw HotKeyError.registrationFailed(install) }

    do {
      for (offset, entry) in shortcuts.sorted(by: { $0.key < $1.key }).enumerated() {
        let parsed = try Self.parse(entry.value)
        let identifierValue = UInt32(offset + 1)
        let identifier = EventHotKeyID(signature: Self.signature, id: identifierValue)
        var reference: EventHotKeyRef?
        let register = RegisterEventHotKey(
          parsed.keyCode,
          parsed.modifiers,
          identifier,
          GetApplicationEventTarget(),
          0,
          &reference
        )
        guard register == noErr, let reference else {
          throw HotKeyError.registrationFailed(register)
        }
        hotKeyRefs.append(reference)
        keysByIdentifier[identifierValue] = entry.key
      }
    } catch {
      invalidate()
      throw error
    }
  }

  func invalidate() {
    hotKeyRefs.forEach { UnregisterEventHotKey($0) }
    if let eventHandler { RemoveEventHandler(eventHandler) }
    hotKeyRefs = []
    eventHandler = nil
    keysByIdentifier = [:]
  }

  private func handle(event: EventRef?) -> OSStatus {
    guard let event else { return OSStatus(eventNotHandledErr) }
    var identifier = EventHotKeyID()
    let read = GetEventParameter(
      event,
      EventParamName(kEventParamDirectObject),
      EventParamType(typeEventHotKeyID),
      nil,
      MemoryLayout<EventHotKeyID>.size,
      nil,
      &identifier
    )
    guard read == noErr,
          identifier.signature == Self.signature,
          let key = keysByIdentifier[identifier.id] else { return OSStatus(eventNotHandledErr) }
    handler(key)
    return noErr
  }

  static func parse(_ shortcut: String) throws -> (keyCode: UInt32, modifiers: UInt32) {
    let parts = shortcut.split(separator: "+").map { String($0).lowercased() }
    guard let key = parts.last else { throw HotKeyError.invalidShortcut(shortcut) }
    var modifiers: UInt32 = 0
    if parts.contains("command") { modifiers |= UInt32(cmdKey) }
    if parts.contains("option") { modifiers |= UInt32(optionKey) }
    if parts.contains("control") { modifiers |= UInt32(controlKey) }
    if parts.contains("shift") { modifiers |= UInt32(shiftKey) }
    guard modifiers != 0 else { throw HotKeyError.invalidShortcut(shortcut) }
    let keys: [String: UInt32] = [
      "space": UInt32(kVK_Space), "return": UInt32(kVK_Return), "tab": UInt32(kVK_Tab),
      "delete": UInt32(kVK_Delete), "forwarddelete": UInt32(kVK_ForwardDelete),
      "left": UInt32(kVK_LeftArrow), "right": UInt32(kVK_RightArrow),
      "up": UInt32(kVK_UpArrow), "down": UInt32(kVK_DownArrow),
      "home": UInt32(kVK_Home), "end": UInt32(kVK_End),
      "pageup": UInt32(kVK_PageUp), "pagedown": UInt32(kVK_PageDown),
      "f1": UInt32(kVK_F1), "f2": UInt32(kVK_F2), "f3": UInt32(kVK_F3),
      "f4": UInt32(kVK_F4), "f5": UInt32(kVK_F5), "f6": UInt32(kVK_F6),
      "f7": UInt32(kVK_F7), "f8": UInt32(kVK_F8), "f9": UInt32(kVK_F9),
      "f10": UInt32(kVK_F10), "f11": UInt32(kVK_F11), "f12": UInt32(kVK_F12),
      "f13": UInt32(kVK_F13), "f14": UInt32(kVK_F14), "f15": UInt32(kVK_F15),
      "f16": UInt32(kVK_F16), "f17": UInt32(kVK_F17), "f18": UInt32(kVK_F18),
      "f19": UInt32(kVK_F19), "f20": UInt32(kVK_F20),
      "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7,
      "c": 8, "v": 9, "b": 11, "q": 12, "w": 13, "e": 14, "r": 15, "y": 16,
      "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24,
      "9": 25, "7": 26, "-": 27, "8": 28, "0": 29, "]": 30, "o": 31, "u": 32,
      "[": 33, "i": 34, "p": 35, "l": 37, "j": 38, "'": 39, "k": 40, ";": 41,
      "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46, ".": 47, "`": 50,
    ]
    guard let keyCode = keys[key] else { throw HotKeyError.invalidShortcut(shortcut) }
    return (keyCode, modifiers)
  }
}
