import AppKit

/// Maximize within the usable screen, preserving the exact prior frame. This
/// deliberately never enters a fullscreen Space.
@MainActor
final class CommanderUtilityWindow: NSWindow {
  private var restoredFrame: NSRect?
  private var maximizedFrame: NSRect?

  override func zoom(_ sender: Any?) {
    guard let screen = screen ?? NSScreen.main else { return }
    toggleMaximize(in: screen.visibleFrame)
  }

  func toggleMaximize(in visibleFrame: NSRect) {
    if let restoredFrame, let maximizedFrame, frame.equalTo(maximizedFrame) {
      setFrame(restoredFrame, display: true)
      self.restoredFrame = nil
      self.maximizedFrame = nil
    } else {
      restoredFrame = frame
      maximizedFrame = visibleFrame
      setFrame(visibleFrame, display: true)
    }
  }
}
