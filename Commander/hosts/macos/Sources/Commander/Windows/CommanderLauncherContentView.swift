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
      // Native siblings above the whole WKWebView cannot be superseded by a
      // later WebKit content-view cursor rectangle or tracking-area rebuild.
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
  private var cursorTrackingArea: NSTrackingArea?

  init(edges: CommanderResizeEdges) {
    self.edges = edges
    resizeCursor = Self.cursor(for: edges)
    super.init(frame: .zero)
    setAccessibilityElement(false)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override var mouseDownCanMoveWindow: Bool { false }

  override func resetCursorRects() {
    guard !isHidden else { return }
    addCursorRect(bounds, cursor: resizeCursor)
  }

  override func updateTrackingAreas() {
    if let cursorTrackingArea { removeTrackingArea(cursorTrackingArea) }
    cursorTrackingArea = nil
    if !isHidden {
      let area = NSTrackingArea(
        rect: .zero, options: [.cursorUpdate, .activeInKeyWindow, .inVisibleRect],
        owner: self, userInfo: nil
      )
      addTrackingArea(area)
      cursorTrackingArea = area
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
