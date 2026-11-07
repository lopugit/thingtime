import AppKit

/// Own the native resize border outside WebKit's descendant view/tracking tree.
/// The center has no overlay, so web controls keep their normal cursor and input.
@MainActor
final class CommanderLauncherContentView: NSView {
  let webView: CommanderWebView
  private(set) var resizeHandles: [CommanderResizeHandleView] = []
  var surfaceInset = CommanderWebView.launcherSurfaceInset {
    didSet { layoutResizeHandles() }
  }
  var usesCustomWindowResizeHandling = true {
    didSet { layoutResizeHandles() }
  }

  init(webView: CommanderWebView, frame: NSRect) {
    self.webView = webView
    super.init(frame: frame)
    webView.frame = bounds
    webView.autoresizingMask = [.width, .height]
    addSubview(webView)
    layoutResizeHandles()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func layout() {
    super.layout()
    layoutResizeHandles()
  }

  override func resizeSubviews(withOldSize oldSize: NSSize) {
    super.resizeSubviews(withOldSize: oldSize)
    layoutResizeHandles()
  }

  func resizeEdges(at point: NSPoint) -> CommanderResizeEdges {
    guard usesCustomWindowResizeHandling else { return [] }
    return CommanderWebView.resizeEdges(
      at: point,
      frame: bounds.insetBy(dx: surfaceInset, dy: surfaceInset),
      handleWidth: CommanderWebView.resizeHandleWidth
    )
  }

  private func layoutResizeHandles() {
    let regions = CommanderWebView.resizeRegions(
      frame: bounds.insetBy(dx: surfaceInset, dy: surfaceInset),
      handleWidth: CommanderWebView.resizeHandleWidth
    )
    if resizeHandles.count != regions.count {
      resizeHandles.forEach { $0.removeFromSuperview() }
      resizeHandles = regions.map { CommanderResizeHandleView(edges: $0.edges) }
      // Native siblings keep resize hit ownership outside WebKit's descendant
      // tracking tree, including when its content hierarchy is rebuilt.
      resizeHandles.forEach { addSubview($0, positioned: .above, relativeTo: webView) }
    }
    for (handle, region) in zip(resizeHandles, regions) {
      let changed = handle.frame != region.frame || handle.isHidden == usesCustomWindowResizeHandling
      handle.frame = region.frame
      handle.isHidden = !usesCustomWindowResizeHandling
      if changed { window?.invalidateCursorRects(for: handle) }
    }
  }
}

@MainActor
final class CommanderResizeHandleView: NSView {
  let edges: CommanderResizeEdges
  let resizeCursor: NSCursor
  private var cursorTrackingAreas: [NSTrackingArea] = []

  init(edges: CommanderResizeEdges) {
    self.edges = edges
    resizeCursor = Self.cursor(for: edges)
    super.init(frame: .zero)
    setAccessibilityElement(false)
    // WindowServer ignores fully transparent pixels even when AppKit hitTest
    // finds this view. Keep the exterior half of the native resize band in the
    // window's input surface without painting an opaque outer rectangle.
    wantsLayer = true
    layer?.backgroundColor = NSColor.black.withAlphaComponent(0.01).cgColor
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override var mouseDownCanMoveWindow: Bool { false }

  override func resetCursorRects() {
    guard !isHidden else { return }
    addCursorRect(bounds, cursor: resizeCursor)
  }

  override func updateTrackingAreas() {
    cursorTrackingAreas.forEach { removeTrackingArea($0) }
    cursorTrackingAreas = []
    if !isHidden {
      // cursorUpdate is entry-based and activeAlways suppresses it. Keep key
      // window cursor updates separate from movement/entry tracking so pinned
      // non-key panels still receive normal pointer events.
      for options: NSTrackingArea.Options in [
        [.cursorUpdate, .activeInKeyWindow, .inVisibleRect],
        [.mouseMoved, .mouseEnteredAndExited, .activeAlways, .inVisibleRect],
      ] {
        let area = NSTrackingArea(rect: .zero, options: options, owner: self, userInfo: nil)
        addTrackingArea(area)
        cursorTrackingAreas.append(area)
      }
    }
    super.updateTrackingAreas()
  }

  override func cursorUpdate(with event: NSEvent) {
    guard !isHidden else { return }
    resizeCursor.set()
  }

  private static func cursor(for edges: CommanderResizeEdges) -> NSCursor {
    if #available(macOS 15.0, *) {
      let position: NSCursor.FrameResizePosition
      switch edges {
      case [.top, .left]: position = .topLeft
      case [.top, .right]: position = .topRight
      case [.bottom, .left]: position = .bottomLeft
      case [.bottom, .right]: position = .bottomRight
      case .left: position = .left
      case .right: position = .right
      case .bottom: position = .bottom
      default: position = .top
      }
      return .frameResize(position: position, directions: .all)
    }
    // Preserve the older supported system cursors on macOS 14.
    return edges.intersection([.left, .right]).isEmpty ? .resizeUpDown : .resizeLeftRight
  }
}
