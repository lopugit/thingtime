import Carbon
import Foundation

enum HotKeyError: LocalizedError {
  case invalidShortcut(String)
  case registrationFailed(OSStatus)

  var errorDescription: String? {
    switch self {
    case .invalidShortcut(let shortcut): "Unsupported shortcut: \(shortcut)"
    case .registrationFailed(let status): "macOS rejected this shortcut (\(status)). It may already be assigned."
    }
  }
}

@MainActor
final class GlobalHotKey {
  private var hotKeyRef: EventHotKeyRef?
  private var eventHandler: EventHandlerRef?
  private let handler: () -> Void

  init(shortcut: String, handler: @escaping () -> Void) throws {
    self.handler = handler
    let parsed = try Self.parse(shortcut)
    var specification = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
    let status = InstallEventHandler(
      GetApplicationEventTarget(),
      { _, _, pointer -> OSStatus in
        MainActor.assumeIsolated {
          guard let pointer else { return }
          Unmanaged<GlobalHotKey>.fromOpaque(pointer).takeUnretainedValue().handler()
        }
        return noErr
      },
      1,
      &specification,
      Unmanaged.passUnretained(self).toOpaque(),
      &eventHandler
    )
    guard status == noErr else { throw HotKeyError.registrationFailed(status) }
    let identifier = EventHotKeyID(signature: 0x434D4452, id: 1) // CMDR
    let register = RegisterEventHotKey(parsed.keyCode, parsed.modifiers, identifier, GetApplicationEventTarget(), 0, &hotKeyRef)
    guard register == noErr else {
      if let eventHandler { RemoveEventHandler(eventHandler) }
      self.eventHandler = nil
      throw HotKeyError.registrationFailed(register)
    }
  }

  func invalidate() {
    if let hotKeyRef { UnregisterEventHotKey(hotKeyRef) }
    if let eventHandler { RemoveEventHandler(eventHandler) }
    hotKeyRef = nil
    eventHandler = nil
  }

  private static func parse(_ shortcut: String) throws -> (keyCode: UInt32, modifiers: UInt32) {
    let parts = shortcut.split(separator: "+").map { String($0).lowercased() }
    guard let key = parts.last else { throw HotKeyError.invalidShortcut(shortcut) }
    var modifiers: UInt32 = 0
    if parts.contains("command") { modifiers |= UInt32(cmdKey) }
    if parts.contains("option") { modifiers |= UInt32(optionKey) }
    if parts.contains("control") { modifiers |= UInt32(controlKey) }
    if parts.contains("shift") { modifiers |= UInt32(shiftKey) }
    guard modifiers != 0 else { throw HotKeyError.invalidShortcut(shortcut) }
    let keys: [String: UInt32] = [
      "space": 49, "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7,
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
