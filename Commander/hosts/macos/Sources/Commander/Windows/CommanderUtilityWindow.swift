import AppKit

/// Maximize within the usable screen, preserving the exact prior frame. This
/// deliberately never enters a fullscreen Space.
@MainActor
final class CommanderUtilityWindow: NSWindow {
  private var restoredFrame: NSRect?
  private var maximizedFrame: NSRect?
  private var lastZoomTime = -Double.infinity

  override func zoom(_ sender: Any?) {
    guard let screen = screen ?? NSScreen.main else { return }
    requestZoom(in: screen.visibleFrame, at: ProcessInfo.processInfo.systemUptime)
  }

  // AppKit and the web titlebar can both deliver the same double-click.
  // Coalesce one gesture so its second delivery cannot immediately undo it.
  func requestZoom(in visibleFrame: NSRect, at now: TimeInterval) {
    guard now - lastZoomTime > NSEvent.doubleClickInterval else { return }
    lastZoomTime = now
    toggleMaximize(in: visibleFrame)
  }

  func toggleMaximize(in visibleFrame: NSRect) {
    if let restoredFrame, let maximizedFrame, frame.equalTo(maximizedFrame) {
      setFrame(restoredFrame, display: true)
      self.restoredFrame = nil
      self.maximizedFrame = nil
    } else {
      restoredFrame = frame
      setFrame(visibleFrame, display: true)
      // AppKit may constrain or round the requested screen rectangle.
      maximizedFrame = frame
    }
  }
}
