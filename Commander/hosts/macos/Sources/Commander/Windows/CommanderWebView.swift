import AppKit
import WebKit

struct CommanderResizeEdges: OptionSet {
  let rawValue: Int

  static let left = CommanderResizeEdges(rawValue: 1 << 0)
  static let right = CommanderResizeEdges(rawValue: 1 << 1)
  static let bottom = CommanderResizeEdges(rawValue: 1 << 2)
  static let top = CommanderResizeEdges(rawValue: 1 << 3)
}

@MainActor
final class CommanderWebView: WKWebView, WKNavigationDelegate, NSDraggingSource {
  override var isOpaque: Bool { false }

  var firstPresentationReady: (() -> Void)? {
    didSet {
      if presentationReady { firstPresentationReady?() }
    }
  }
  var fileDragSessionChanged: ((_ active: Bool, _ completed: Bool) -> Void)?
  private var hasCommittedContent = false
  private var presentationReady = false
  private let allowedOrigin: String
  private var surfaceMask: (inset: CGFloat, cornerRadius: CGFloat)?
  private var preparedFileDragURL: URL?
  var usesCustomWindowResizeHandling = true {
    didSet {
      guard oldValue != usesCustomWindowResizeHandling else { return }
      window?.invalidateCursorRects(for: self)
    }
  }
  static let launcherSurfaceInset: CGFloat = 18
  static let resizeHandleWidth: CGFloat = 10

  init(ready: DaemonReady, surface: String, bridge: CommanderNativeBridge) {
    self.allowedOrigin = URL(string: ready.url)!.commanderOrigin
    let configuration = WKWebViewConfiguration()
    // Commander's renderer stores only bounded emoji recents, tone, and query
    // learning. A persistent store lets those device-local preferences survive
    // a complete app restart; credentials continue to live exclusively in the
    // native Keychain bridge.
    configuration.websiteDataStore = .default()
    configuration.preferences.isElementFullscreenEnabled = false
    configuration.defaultWebpagePreferences.allowsContentJavaScript = true
    configuration.userContentController.add(bridge, name: "commander")
    super.init(frame: .zero, configuration: configuration)
    bridge.webView = self
    navigationDelegate = self
    Self.makeCanvasTransparent(self)
    allowsMagnification = false
    let url = URL(string: "\(ready.url)/\(surface).html?token=\(ready.sessionToken)")!
    load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10))
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func layout() {
    super.layout()
    updateSurfaceMask()
  }

  override func resetCursorRects() {
    super.resetCursorRects()
    guard usesCustomWindowResizeHandling, let surfaceMask else { return }
    let surfaceBounds = bounds.insetBy(dx: surfaceMask.inset, dy: surfaceMask.inset)
    let width = min(Self.resizeHandleWidth, surfaceBounds.width / 2)
    let height = min(Self.resizeHandleWidth, surfaceBounds.height / 2)
    addCursorRect(
      NSRect(x: surfaceBounds.minX, y: surfaceBounds.minY, width: width, height: surfaceBounds.height),
      cursor: .resizeLeftRight
    )
    addCursorRect(
      NSRect(x: surfaceBounds.maxX - width, y: surfaceBounds.minY, width: width, height: surfaceBounds.height),
      cursor: .resizeLeftRight
    )
    addCursorRect(
      NSRect(x: surfaceBounds.minX, y: surfaceBounds.minY, width: surfaceBounds.width, height: height),
      cursor: .resizeUpDown
    )
    addCursorRect(
      NSRect(x: surfaceBounds.minX, y: surfaceBounds.maxY - height, width: surfaceBounds.width, height: height),
      cursor: .resizeUpDown
    )
  }

  func maskToSurface(inset: CGFloat, cornerRadius: CGFloat) {
    surfaceMask = (inset, cornerRadius)
    updateSurfaceMask()
  }

  override func mouseDown(with event: NSEvent) {
    cancelPreparedFileDrag()
    super.mouseDown(with: event)
  }

  override func mouseDragged(with event: NSEvent) {
    guard let url = preparedFileDragURL else {
      super.mouseDragged(with: event)
      return
    }
    preparedFileDragURL = nil
    let draggingItem = NSDraggingItem(pasteboardWriter: url as NSURL)
    let icon = NSWorkspace.shared.icon(forFile: url.path)
    icon.size = NSSize(width: 48, height: 48)
    let point = convert(event.locationInWindow, from: nil)
    draggingItem.setDraggingFrame(
      NSRect(x: point.x - 24, y: point.y - 24, width: 48, height: 48),
      contents: icon
    )
    let session = beginDraggingSession(with: [draggingItem], event: event, source: self)
    session.animatesToStartingPositionsOnCancelOrFail = true
  }

  override func mouseUp(with event: NSEvent) {
    cancelPreparedFileDrag()
    super.mouseUp(with: event)
  }

  static func resizedFrame(
    from startingFrame: NSRect,
    edges: CommanderResizeEdges,
    startingMouseLocation: NSPoint,
    mouseLocation: NSPoint,
    minimumSize: NSSize
  ) -> NSRect {
    let delta = NSPoint(
      x: mouseLocation.x - startingMouseLocation.x,
      y: mouseLocation.y - startingMouseLocation.y
    )
    var frame = startingFrame
    if edges.contains(.left) {
      frame.size.width = max(minimumSize.width, startingFrame.width - delta.x)
      frame.origin.x = startingFrame.maxX - frame.width
    } else if edges.contains(.right) {
      frame.size.width = max(minimumSize.width, startingFrame.width + delta.x)
    }
    if edges.contains(.bottom) {
      frame.size.height = max(minimumSize.height, startingFrame.height - delta.y)
      frame.origin.y = startingFrame.maxY - frame.height
    } else if edges.contains(.top) {
      frame.size.height = max(minimumSize.height, startingFrame.height + delta.y)
    }
    return frame
  }

  static func resizeEdges(
    at point: NSPoint,
    frame: NSRect,
    handleWidth: CGFloat
  ) -> CommanderResizeEdges {
    var edges: CommanderResizeEdges = []
    if abs(point.x - frame.minX) <= handleWidth { edges.insert(.left) }
    if abs(point.x - frame.maxX) <= handleWidth { edges.insert(.right) }
    if abs(point.y - frame.minY) <= handleWidth { edges.insert(.bottom) }
    if abs(point.y - frame.maxY) <= handleWidth { edges.insert(.top) }
    return edges
  }

  func prepareFileDrag(path: String) throws {
    preparedFileDragURL = try Self.validatedFileURL(for: path)
    fileDragSessionChanged?(true, false)
  }

  func cancelPreparedFileDrag() {
    guard preparedFileDragURL != nil else { return }
    preparedFileDragURL = nil
    fileDragSessionChanged?(false, false)
  }

  func draggingSession(
    _ session: NSDraggingSession,
    sourceOperationMaskFor context: NSDraggingContext
  ) -> NSDragOperation { .copy }

  func draggingSession(
    _ session: NSDraggingSession,
    endedAt screenPoint: NSPoint,
    operation: NSDragOperation
  ) {
    fileDragSessionChanged?(false, operation != [])
  }

  static func validatedFileURL(for path: String) throws -> URL {
    guard path.hasPrefix("/"), !path.contains("\0") else {
      throw CommanderFileDragError.invalidPath
    }
    let url = URL(fileURLWithPath: path).standardizedFileURL
    guard FileManager.default.fileExists(atPath: url.path) else {
      throw CommanderFileDragError.missingFile
    }
    return url
  }

  static func validatedDestructiveFileURL(for path: String) throws -> URL {
    let url = try validatedFileURL(for: path)
    let protectedPaths = Set(
      [
        "/",
        FileManager.default.homeDirectoryForCurrentUser.standardizedFileURL.path,
        Bundle.main.bundleURL.standardizedFileURL.path,
      ]
        + (FileManager.default.mountedVolumeURLs(
          includingResourceValuesForKeys: nil,
          options: [.skipHiddenVolumes]
        ) ?? []).map { $0.standardizedFileURL.path }
    )
    guard url.pathComponents.count > 2, !protectedPaths.contains(url.path) else {
      throw CommanderFileDragError.protectedPath
    }
    return url
  }

  static func fileIconDataURL(for path: String, pixelSize: Int = 64) throws -> String {
    let url = try validatedFileURL(for: path)
    guard pixelSize > 0, pixelSize <= 256,
          let bitmap = NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: pixelSize,
            pixelsHigh: pixelSize,
            bitsPerSample: 8,
            samplesPerPixel: 4,
            hasAlpha: true,
            isPlanar: false,
            colorSpaceName: .deviceRGB,
            bytesPerRow: 0,
            bitsPerPixel: 0
          ) else { throw CommanderFileIconError.couldNotEncode }

    let icon = NSWorkspace.shared.icon(forFile: url.path)
    let size = CGFloat(pixelSize)
    NSGraphicsContext.saveGraphicsState()
    defer { NSGraphicsContext.restoreGraphicsState() }
    guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
      throw CommanderFileIconError.couldNotEncode
    }
    NSGraphicsContext.current = context
    context.imageInterpolation = .high
    icon.draw(
      in: NSRect(x: 0, y: 0, width: size, height: size),
      from: .zero,
      operation: .copy,
      fraction: 1
    )
    context.flushGraphics()
    guard let data = bitmap.representation(using: .png, properties: [:]) else {
      throw CommanderFileIconError.couldNotEncode
    }
    guard data.count <= 128 * 1024 else { throw CommanderFileIconError.couldNotEncode }
    return "data:image/png;base64,\(data.base64EncodedString())"
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    Self.makeCanvasTransparent(webView)
    guard !hasCommittedContent else { return }
    hasCommittedContent = true
    // A hidden WKWebView may suppress requestAnimationFrame indefinitely. The
    // completed navigation is the safe gate for ordering its panel onscreen.
    presentationReady = true
    firstPresentationReady?()
  }

  func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
    guard let url = navigationAction.request.url else { return .cancel }
    if url.commanderOrigin == allowedOrigin { return .allow }
    NSWorkspace.shared.open(url)
    return .cancel
  }

  func shutdown() {
    stopLoading()
    firstPresentationReady = nil
    fileDragSessionChanged = nil
    navigationDelegate = nil
    configuration.userContentController.removeScriptMessageHandler(forName: "commander")
  }

  private static func makeCanvasTransparent(_ webView: WKWebView) {
    // WebKit can otherwise composite its rectangular page canvas behind the
    // rounded launcher surface even when the containing NSPanel is clear.
    webView.underPageBackgroundColor = .clear
    webView.setValue(false, forKey: "drawsBackground")
    webView.wantsLayer = true
    webView.layer?.backgroundColor = NSColor.clear.cgColor
    clearBackgroundDrawing(in: webView)
  }

  private static func clearBackgroundDrawing(in view: NSView) {
    if let scrollView = view as? NSScrollView {
      scrollView.drawsBackground = false
      scrollView.backgroundColor = .clear
    }
    if let clipView = view as? NSClipView {
      clipView.drawsBackground = false
      clipView.backgroundColor = .clear
    }
    view.subviews.forEach(clearBackgroundDrawing)
  }

  private func updateSurfaceMask() {
    guard let surfaceMask, let layer else { return }
    let shape = (layer.mask as? CAShapeLayer) ?? CAShapeLayer()
    shape.frame = bounds
    shape.path = CGPath(
      roundedRect: bounds.insetBy(dx: surfaceMask.inset, dy: surfaceMask.inset),
      cornerWidth: surfaceMask.cornerRadius,
      cornerHeight: surfaceMask.cornerRadius,
      transform: nil
    )
    layer.mask = shape
  }
}

enum CommanderFileDragError: LocalizedError {
  case invalidPath
  case missingFile
  case protectedPath

  var errorDescription: String? {
    switch self {
    case .invalidPath: "Commander can only drag an absolute local file path."
    case .missingFile: "That file no longer exists. Refresh Commander and try again."
    case .protectedPath: "Commander will not move or delete a protected filesystem location."
    }
  }
}

enum CommanderFileIconError: LocalizedError {
  case couldNotEncode

  var errorDescription: String? { "Commander could not render that file’s icon." }
}

private extension URL {
  var commanderOrigin: String {
    let defaultPort = scheme == "https" ? 443 : 80
    return "\(scheme ?? "")://\(host ?? ""):\(port ?? defaultPort)"
  }
}
