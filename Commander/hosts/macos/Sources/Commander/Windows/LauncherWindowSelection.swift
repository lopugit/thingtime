import AppKit

/// Chooses which launcher window the Commander hotkey, a per-command shortcut,
/// a Dock reopen or the menu-bar Open item uses.
///
/// A visible pinned launcher belongs to the display it was left on. Reusing it
/// from another display either makes it key there, which moves keyboard focus
/// and the active menu bar to that display, or (for command shortcuts) moves
/// the pinned panel itself. Neither should happen because a shortcut was used
/// somewhere else, so with per-display focus enabled a pinned launcher is only
/// a candidate on its own display. Hidden launchers are presented on the
/// active display and stay reusable everywhere; when nothing is eligible a new
/// launcher is created on the active display.
enum LauncherWindowSelection {
  enum Request: Equatable, Sendable {
    /// Commander hotkey, Dock reopen, menu-bar Open and Open Commander Window:
    /// focus a pinned launcher, toggle a transient one or present a hidden one.
    case open
    /// A per-command shortcut such as Emoji & Symbols. The command replaces the
    /// launcher's view, re-centers it and hides it after a paste, so it never
    /// borrows a visible pinned launcher on any display.
    case command
  }

  struct Candidate: Equatable, Sendable {
    let id: UUID
    let recency: UInt64
    let screenNumber: Int?
    let isVisible: Bool
    let isPinned: Bool
  }

  /// Returns the launcher to use, or nil when a new launcher should be created
  /// on the active display.
  static func choose(
    _ request: Request,
    among candidates: [Candidate],
    activeScreenNumber: Int?,
    preferCurrentDisplay: Bool
  ) -> UUID? {
    let displayAware = preferCurrentDisplay && activeScreenNumber != nil
    let eligible = candidates.filter { candidate in
      guard candidate.isVisible, candidate.isPinned else { return true }
      switch request {
      case .command:
        return false
      case .open:
        // Turning per-display focus off explicitly opts into focusing the most
        // recent window on any display.
        return !displayAware || candidate.screenNumber == activeScreenNumber
      }
    }
    let sameDisplay = displayAware ? eligible.filter { $0.screenNumber == activeScreenNumber } : []
    let pool = sameDisplay.isEmpty ? eligible : sameDisplay
    return pool.max { $0.recency < $1.recency }?.id
  }
}

/// Keeps a launcher's dismissal from moving keyboard focus to another display.
///
/// When the key window is ordered out while Commander is active, AppKit
/// synchronously makes the next eligible Commander window key. A pinned
/// launcher or Settings window left on another display would win, moving
/// keyboard focus and the active menu bar there even though the user dismissed
/// something on their current display. While a launcher is being ordered out,
/// other Commander windows on a different display decline that automatic key
/// promotion. Clicks, explicit focus and later activation are unaffected.
@MainActor
enum CommanderKeyWindowHandoff {
  private static weak var dismissedWindow: NSWindow?
  private static var dismissedScreenNumber: Int?

  static func allowsAutomaticKey(_ window: NSWindow) -> Bool {
    guard let dismissedWindow, dismissedWindow !== window else { return true }
    return allowsHandoff(from: dismissedScreenNumber, to: window.commanderScreenNumber)
  }

  /// Unknown displays keep AppKit's normal behavior; only a known display
  /// change is refused.
  nonisolated static func allowsHandoff(from dismissedScreen: Int?, to candidateScreen: Int?) -> Bool {
    guard let dismissedScreen, let candidateScreen else { return true }
    return dismissedScreen == candidateScreen
  }

  static func orderOut(_ window: NSWindow) {
    guard window.isKeyWindow, dismissedWindow == nil else {
      window.orderOut(nil)
      return
    }
    dismissedWindow = window
    dismissedScreenNumber = window.commanderScreenNumber
    defer {
      dismissedWindow = nil
      dismissedScreenNumber = nil
    }
    window.orderOut(nil)
  }

  static var isOrderingOutForTesting: Bool { dismissedWindow != nil }
}

extension NSWindow {
  /// The display a window is on, or that its frame most overlaps when AppKit
  /// does not report one, such as for an ordered-out launcher.
  var commanderScreenNumber: Int? {
    let frame = self.frame
    let screen = self.screen ?? NSScreen.screens.max { left, right in
      NSIntersectionRect(left.frame, frame).width * NSIntersectionRect(left.frame, frame).height
        < NSIntersectionRect(right.frame, frame).width * NSIntersectionRect(right.frame, frame).height
    }
    return screen?.commanderScreenNumber
  }
}

extension NSScreen {
  var commanderScreenNumber: Int? {
    (deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.intValue
  }
}
