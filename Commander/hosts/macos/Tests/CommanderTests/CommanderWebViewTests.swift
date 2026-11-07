import AppKit
import WebKit
import XCTest
@testable import Commander

@MainActor
final class CommanderWebViewTests: XCTestCase {
  func testTransparentCanvasDoesNotPaintAnOuterRectangle() {
    let ready = DaemonReady(
      type: "ready",
      protocolVersion: 1,
      port: 1,
      url: "http://127.0.0.1:1",
      sessionToken: "test-session",
      nativeToken: "test-native",
      pid: 1
    )
    let bridge = CommanderNativeBridge(
      ready: ready,
      keychain: KeychainStore(),
      loginItem: LaunchAtLoginService(),
      showLauncher: {},
      hideLauncher: {},
      showSettings: { _ in },
      updateHotKeys: { _, _ in },
      updateMenuBar: { _ in },
      updateWindowMode: { _ in }
    )
    let webView = CommanderWebView(ready: ready, surface: "launcher", bridge: bridge)

    XCTAssertFalse(webView.isOpaque)
    XCTAssertTrue(webView.configuration.websiteDataStore.isPersistent)
    XCTAssertEqual(webView.underPageBackgroundColor?.alphaComponent, 0)
    XCTAssertEqual(webView.value(forKey: "drawsBackground") as? Bool, false)
    XCTAssertTrue(webView.wantsLayer)
    XCTAssertEqual(webView.layer?.backgroundColor?.alpha, 0)
    for view in descendants(of: webView) {
      if let scrollView = view as? NSScrollView {
        XCTAssertFalse(scrollView.drawsBackground)
        XCTAssertEqual(scrollView.backgroundColor.alphaComponent, 0)
      }
      if let clipView = view as? NSClipView {
        XCTAssertFalse(clipView.drawsBackground)
        XCTAssertEqual(clipView.backgroundColor.alphaComponent, 0)
      }
    }
    webView.shutdown()
  }

  func testLauncherPanelAndItsContentHierarchyStayTransparent() {
    let ready = DaemonReady(
      type: "ready",
      protocolVersion: 1,
      port: 1,
      url: "http://127.0.0.1:1",
      sessionToken: "test-session",
      nativeToken: "test-native",
      pid: 1
    )
    let bridge = CommanderNativeBridge(
      ready: ready,
      keychain: KeychainStore(),
      loginItem: LaunchAtLoginService(),
      showLauncher: {},
      hideLauncher: {},
      showSettings: { _ in },
      updateHotKeys: { _, _ in },
      updateMenuBar: { _ in },
      updateWindowMode: { _ in }
    )
    let controller = LauncherPanelController(ready: ready, bridge: bridge)
    let panel = controller.panelForTesting

    XCTAssertFalse(panel.isOpaque)
    XCTAssertEqual(panel.backgroundColor.alphaComponent, 0)
    XCTAssertTrue(panel.hasShadow)
    XCTAssertTrue(panel.isMovableByWindowBackground)
    XCTAssertTrue(panel.styleMask.contains(.resizable))
    XCTAssertTrue(panel.canBecomeKey)
    XCTAssertTrue(panel.canBecomeMain)
    XCTAssertEqual(panel.minSize, LauncherWindowMode.standard.minimumSize)
    XCTAssertTrue(panel.contentView is CommanderWebView)
    XCTAssertEqual(panel.contentView?.layer?.backgroundColor?.alpha, 0)
    XCTAssertEqual(panel.contentView?.superview?.layer?.backgroundColor?.alpha, 0)
    guard let webView = panel.contentView as? CommanderWebView else {
      return XCTFail("Launcher content is not a CommanderWebView")
    }
    webView.layoutSubtreeIfNeeded()
    let maskBounds = (webView.layer?.mask as? CAShapeLayer)?.path?.boundingBox
    XCTAssertEqual(maskBounds, webView.bounds.insetBy(dx: 18, dy: 18))
    XCTAssertTrue(
      LauncherPanelController.launcherOpenedScriptForTesting.contains("commander:launcher-opened")
    )
    let resizedFrame = NSRect(
      origin: panel.frame.origin,
      size: NSSize(width: panel.frame.width + 120, height: panel.frame.height + 80)
    )
    panel.setFrame(resizedFrame, display: false)
    XCTAssertEqual(panel.frame.size, resizedFrame.size)
    controller.setWindowMode(.compact)
    webView.layoutSubtreeIfNeeded()
    XCTAssertEqual(panel.minSize, LauncherWindowMode.compact.minimumSize)
    XCTAssertEqual(
      (webView.layer?.mask as? CAShapeLayer)?.path?.boundingBox,
      webView.bounds.insetBy(dx: 12, dy: 12)
    )
    controller.shutdown()
  }

  func testOpenNewWindowPinOverrideWinsOverTheGlobalDefault() {
    XCTAssertFalse(
      CommanderAppDelegate.initialPinnedState(defaultPinned: false, pinnedOverride: nil)
    )
    XCTAssertTrue(
      CommanderAppDelegate.initialPinnedState(defaultPinned: false, pinnedOverride: true)
    )
  }

  func testLauncherResizeMathSupportsEveryCornerAndMinimumSize() {
    let frame = NSRect(x: 100, y: 100, width: 780, height: 560)
    let minimum = NSSize(width: 520, height: 300)
    let surfaceFrame = frame.insetBy(
      dx: CommanderWebView.launcherSurfaceInset,
      dy: CommanderWebView.launcherSurfaceInset
    )
    XCTAssertEqual(
      CommanderWebView.resizeEdges(
        at: NSPoint(x: surfaceFrame.maxX, y: surfaceFrame.minY),
        frame: surfaceFrame,
        handleWidth: CommanderWebView.resizeHandleWidth
      ),
      [.bottom, .right]
    )
    XCTAssertTrue(
      CommanderWebView.resizeEdges(
        at: NSPoint(x: frame.maxX, y: frame.minY),
        frame: surfaceFrame,
        handleWidth: CommanderWebView.resizeHandleWidth
      ).isEmpty
    )
    let cases: [(CommanderResizeEdges, NSPoint, NSPoint, NSRect)] = [
      (
        [.top, .left],
        NSPoint(x: 100, y: 660),
        NSPoint(x: 20, y: 740),
        NSRect(x: 20, y: 100, width: 860, height: 640)
      ),
      (
        [.top, .right],
        NSPoint(x: 880, y: 660),
        NSPoint(x: 980, y: 740),
        NSRect(x: 100, y: 100, width: 880, height: 640)
      ),
      (
        [.bottom, .left],
        NSPoint(x: 100, y: 100),
        NSPoint(x: 20, y: 20),
        NSRect(x: 20, y: 20, width: 860, height: 640)
      ),
      (
        [.bottom, .right],
        NSPoint(x: 880, y: 100),
        NSPoint(x: 980, y: 20),
        NSRect(x: 100, y: 20, width: 880, height: 640)
      ),
    ]
    for (edges, start, current, expected) in cases {
      XCTAssertEqual(
        CommanderWebView.resizedFrame(
          from: frame,
          edges: edges,
          startingMouseLocation: start,
          mouseLocation: current,
          minimumSize: minimum
        ),
        expected
      )
    }

    XCTAssertEqual(
      CommanderWebView.resizedFrame(
        from: frame,
        edges: [.bottom, .right],
        startingMouseLocation: NSPoint(x: 880, y: 100),
        mouseLocation: NSPoint(x: 0, y: 1_000),
        minimumSize: minimum
      ),
      NSRect(x: 100, y: 360, width: 520, height: 300)
    )
  }

  func testLauncherResizeBorderOwnsHitsAboveWebKitAndMatchesDragRegions() throws {
    let ready = DaemonReady(
      type: "ready", protocolVersion: 1, port: 1, url: "http://127.0.0.1:1",
      sessionToken: "test-session", nativeToken: "test-native", pid: 1
    )
    let bridge = CommanderNativeBridge(
      ready: ready, keychain: KeychainStore(), loginItem: LaunchAtLoginService(),
      showLauncher: {}, hideLauncher: {}, showSettings: { _ in },
      updateHotKeys: { _, _ in }, updateMenuBar: { _ in }, updateWindowMode: { _ in }
    )
    let controller = LauncherPanelController(ready: ready, bridge: bridge)
    let panel = controller.panelForTesting
    defer { controller.shutdown() }
    let content = try XCTUnwrap(panel.contentView)
    let webView = try XCTUnwrap(
      ([content] + descendants(of: content)).first { $0 is CommanderWebView } as? CommanderWebView
    )

    for mode in [LauncherWindowMode.standard, .compact] {
      controller.setWindowMode(mode)
      for size in [mode.minimumSize, NSSize(width: 1463, height: 1406)] {
        panel.setContentSize(size)
        content.layoutSubtreeIfNeeded()
        let inset: CGFloat = mode == .compact ? 12 : CommanderWebView.launcherSurfaceInset
        let surface = content.bounds.insetBy(dx: inset, dy: inset)
        // Probe both sides of each visible border, all corners, and points just
        // outside the resize band. Native hit ownership must match drag entry.
        var points = [NSPoint(x: surface.midX, y: surface.midY)]
        for offset: CGFloat in [-11, -9, 0, 9, 11] {
          points += [
            NSPoint(x: surface.minX + offset, y: surface.midY),
            NSPoint(x: surface.maxX + offset, y: surface.midY),
            NSPoint(x: surface.midX, y: surface.minY + offset),
            NSPoint(x: surface.midX, y: surface.maxY + offset),
          ]
        }
        for x in [surface.minX - 9, surface.minX + 9, surface.maxX - 9, surface.maxX + 9] {
          for y in [surface.minY - 9, surface.minY + 9, surface.maxY - 9, surface.maxY + 9] {
            points.append(NSPoint(x: x, y: y))
          }
        }
        for point in points where content.bounds.contains(point) {
          let edges = CommanderWebView.resizeEdges(
            at: point, frame: surface, handleWidth: CommanderWebView.resizeHandleWidth
          )
          let hit = try XCTUnwrap(content.hitTest(content.convert(point, to: content.superview)))
          let webHit = hit === webView || hit.isDescendant(of: webView)
          if edges.isEmpty {
            XCTAssertTrue(webHit, "Content must retain normal WebKit hit ownership at \(point)")
          } else {
            XCTAssertFalse(webHit, "WebKit must not own the resize cursor at \(point)")
          }
        }
        controller.setCustomWindowResizeHandling(false)
        let borderPoint = NSPoint(x: surface.minX, y: surface.midY)
        let disabledHit = try XCTUnwrap(content.hitTest(content.convert(borderPoint, to: content.superview)))
        XCTAssertTrue(disabledHit === webView || disabledHit.isDescendant(of: webView))
        controller.setCustomWindowResizeHandling(true)
      }
    }
  }

  func testNativeResizeCursorSurvivesLoadedWebKitContentAndLayout() async throws {
    let ready = DaemonReady(
      type: "ready", protocolVersion: 1, port: 1, url: "http://127.0.0.1:1",
      sessionToken: "test-session", nativeToken: "test-native", pid: 1
    )
    let bridge = CommanderNativeBridge(
      ready: ready, keychain: KeychainStore(), loginItem: LaunchAtLoginService(),
      showLauncher: {}, hideLauncher: {}, showSettings: { _ in },
      updateHotKeys: { _, _ in }, updateMenuBar: { _ in }, updateWindowMode: { _ in }
    )
    let controller = LauncherPanelController(ready: ready, bridge: bridge)
    let panel = controller.panelForTesting
    let content = try XCTUnwrap(panel.contentView as? CommanderLauncherContentView)
    let webView = content.webView
    let previousCursor = NSCursor.current
    defer {
      previousCursor.set()
      webView.navigationDelegate = webView
      controller.shutdown()
    }
    let loaded = expectation(description: "Real WebKit cursor fixture loaded")
    let fixtureDelegate = CommanderCursorFixtureNavigationDelegate { loaded.fulfill() }
    // Keep the fixture local to this view; production navigation restrictions
    // remain unchanged. Loading real HTML builds WebKit's actual descendant and
    // tracking hierarchy rather than substituting a fake content subview.
    webView.navigationDelegate = fixtureDelegate
    webView.loadHTMLString("""
      <!doctype html><style>
      html,body { margin:0; width:100%; height:100%; cursor:text }
      a { position:absolute; left:40%; top:40%; cursor:pointer }
      input { position:absolute; left:40%; top:60%; cursor:text }
      </style><a id="link" href="#fixture">Fixture link</a><input id="field" value="editable">
      """, baseURL: nil)
    await fulfillment(of: [loaded], timeout: 10)
    let fixtureState = try await webView.evaluateJavaScript("document.readyState") as? String
    XCTAssertEqual(fixtureState, "complete")

    for mode in [LauncherWindowMode.standard, .compact] {
      controller.setWindowMode(mode)
      panel.setContentSize(mode.minimumSize)
      content.layoutSubtreeIfNeeded()
      XCTAssertEqual(content.resizeHandles.count, 8)
      let themeFrame = try XCTUnwrap(content.superview)
      for handle in content.resizeHandles {
        handle.updateTrackingAreas()
        let point = NSPoint(x: handle.frame.midX, y: handle.frame.midY)
        let target = try XCTUnwrap(themeFrame.hitTest(content.convert(point, to: themeFrame.superview)))
        XCTAssertTrue(target === handle)
        XCTAssertFalse(target.isDescendant(of: webView))
        let cursorEvent = try XCTUnwrap(NSEvent.enterExitEvent(
          with: .cursorUpdate, location: content.convert(point, to: nil),
          modifierFlags: [], timestamp: 0, windowNumber: panel.windowNumber,
          context: nil, eventNumber: 0, trackingNumber: 0, userData: nil
        ))
        NSCursor.iBeam.set()
        target.cursorUpdate(with: cursorEvent)
        XCTAssertTrue(NSCursor.current === handle.resizeCursor)
        XCTAssertTrue(handle.trackingAreas.contains {
          $0.owner as? CommanderResizeHandleView === handle && $0.options.contains(.cursorUpdate)
        })
        if #available(macOS 15.0, *) {
          let expectedPosition: NSCursor.FrameResizePosition
          switch handle.edges {
          case [.left, .bottom]: expectedPosition = .bottomLeft
          case [.right, .bottom]: expectedPosition = .bottomRight
          case [.left, .top]: expectedPosition = .topLeft
          case [.right, .top]: expectedPosition = .topRight
          case .left: expectedPosition = .left
          case .right: expectedPosition = .right
          case .bottom: expectedPosition = .bottom
          default: expectedPosition = .top
          }
          let expected = NSCursor.frameResize(position: expectedPosition, directions: .all)
          XCTAssertEqual(handle.resizeCursor.image.tiffRepresentation, expected.image.tiffRepresentation)
          XCTAssertEqual(handle.resizeCursor.hotSpot, expected.hotSpot)
        }
      }

      // Let real WebKit style/layout changes and AppKit cursor invalidation
      // settle, then verify ownership and cursor selection again after resizing.
      _ = try await webView.evaluateJavaScript("document.body.style.cursor = 'pointer'")
      panel.invalidateCursorRects(for: webView)
      panel.setContentSize(NSSize(width: 1463, height: 1406))
      content.layoutSubtreeIfNeeded()
      await Task.yield()
      let right = try XCTUnwrap(content.resizeHandles.first { $0.edges == .right })
      let border = NSPoint(x: right.frame.midX, y: right.frame.midY)
      XCTAssertTrue(themeFrame.hitTest(content.convert(border, to: themeFrame.superview)) === right)
      NSCursor.pointingHand.set()
      let update = try XCTUnwrap(NSEvent.enterExitEvent(
        with: .cursorUpdate, location: content.convert(border, to: nil), modifierFlags: [], timestamp: 0,
        windowNumber: panel.windowNumber, context: nil, eventNumber: 0, trackingNumber: 0, userData: nil
      ))
      right.cursorUpdate(with: update)
      XCTAssertTrue(NSCursor.current === right.resizeCursor)

      for elementID in ["link", "field"] {
        let state = try await webView.evaluateJavaScript("""
          (() => { const e = document.getElementById('\(elementID)'); const r = e.getBoundingClientRect();
          return { x:r.x+r.width/2, y:r.y+r.height/2, cursor:getComputedStyle(e).cursor }; })()
          """) as? [String: Any]
        let x = try XCTUnwrap(state?["x"] as? Double)
        let y = try XCTUnwrap(state?["y"] as? Double)
        XCTAssertEqual(state?["cursor"] as? String, elementID == "link" ? "pointer" : "text")
        let nativePoint = NSPoint(x: x, y: webView.isFlipped ? y : webView.bounds.height - y)
        let hit = try XCTUnwrap(themeFrame.hitTest(webView.convert(nativePoint, to: themeFrame.superview)))
        XCTAssertTrue(hit === webView || hit.isDescendant(of: webView))
      }
      _ = try await webView.evaluateJavaScript("document.getElementById('field').focus()")
      let activeID = try await webView.evaluateJavaScript("document.activeElement.id") as? String
      XCTAssertEqual(activeID, "field")
    }
  }

  func testResizeBorderWindowServerTargetingAndMotionDispatch() async throws {
    let ready = DaemonReady(
      type: "ready", protocolVersion: 1, port: 1, url: "http://127.0.0.1:1",
      sessionToken: "test-session", nativeToken: "test-native", pid: 1
    )
    let bridge = CommanderNativeBridge(
      ready: ready, keychain: KeychainStore(), loginItem: LaunchAtLoginService(),
      showLauncher: {}, hideLauncher: {}, showSettings: { _ in },
      updateHotKeys: { _, _ in }, updateMenuBar: { _ in }, updateWindowMode: { _ in }
    )
    let controller = LauncherPanelController(ready: ready, bridge: bridge)
    let panel = controller.panelForTesting
    let content = try XCTUnwrap(panel.contentView as? CommanderLauncherContentView)
    let previousCursor = NSCursor.current
    defer {
      previousCursor.set()
      content.webView.navigationDelegate = content.webView
      controller.shutdown()
    }
    let loaded = expectation(description: "Opaque WebKit surface inside transparent window")
    let fixtureDelegate = CommanderCursorFixtureNavigationDelegate { loaded.fulfill() }
    content.webView.navigationDelegate = fixtureDelegate
    content.webView.loadHTMLString("""
      <!doctype html><style>html,body { margin:0; width:100%; height:100%; background:#222; cursor:text }</style>
      <input style="position:absolute;left:40%;top:40%" value="editable">
      """, baseURL: nil)
    await fulfillment(of: [loaded], timeout: 10)
    let screen = try XCTUnwrap(NSScreen.main)
    panel.orderFrontRegardless()
    // This intentionally remains non-key, as a pinned launcher can be.
    XCTAssertFalse(panel.isKeyWindow)
    XCTAssertTrue(panel.acceptsMouseMovedEvents)
    for mode in [LauncherWindowMode.standard, .compact] {
      controller.setWindowMode(mode)
      for size in [mode.size, mode.minimumSize] {
        panel.setFrame(NSRect(x: screen.visibleFrame.midX - size.width / 2,
                             y: screen.visibleFrame.midY - size.height / 2,
                             width: size.width, height: size.height), display: true)
        content.layoutSubtreeIfNeeded()
        panel.display()
        // Let the actual WebKit backing store reach WindowServer. No OS pointer
        // movement or event injection is used by this integration check.
        try await Task.sleep(for: .milliseconds(300))
        let center = NSPoint(x: content.bounds.midX, y: content.bounds.midY)
        let centerTarget = NSWindow.windowNumber(at: panel.convertPoint(toScreen: center),
                                                belowWindowWithWindowNumber: 0)
        try XCTSkipUnless(centerTarget == panel.windowNumber,
                          "WindowServer fixture is unavailable or occluded; cannot verify native targeting")
        func motion(at point: NSPoint) throws -> NSEvent {
          try XCTUnwrap(NSEvent.mouseEvent(
            with: .mouseMoved, location: content.convert(point, to: nil), modifierFlags: [], timestamp: 1,
            windowNumber: panel.windowNumber, context: nil, eventNumber: 1, clickCount: 0, pressure: 0
          ))
        }
        for handle in content.resizeHandles {
          handle.updateTrackingAreas()
          XCTAssertTrue(handle.trackingAreas.contains {
            $0.options.contains(.activeAlways) && $0.options.contains(.mouseMoved)
          })
          // Cover visible and transparent sides, including the rounded corners
          // where WebKit's mask contains no backing pixels at all.
          for point in [
            NSPoint(x: handle.frame.minX + 1, y: handle.frame.minY + 1),
            NSPoint(x: handle.frame.midX, y: handle.frame.midY),
            NSPoint(x: handle.frame.maxX - 1, y: handle.frame.maxY - 1),
          ] {
            let target = NSWindow.windowNumber(at: panel.convertPoint(toScreen: content.convert(point, to: nil)),
                                              belowWindowWithWindowNumber: 0)
            XCTAssertEqual(target, panel.windowNumber, "Native resize region must target the launcher at \(point)")
            // Emulate a competing cursor reset before each real window event,
            // without calling the handle's cursorUpdate implementation directly.
            NSCursor.arrow.set()
            panel.sendEvent(try motion(at: point))
            XCTAssertTrue(NSCursor.current === handle.resizeCursor,
                          "Motion must keep native ownership for \(handle.edges) at \(point)")
          }
        }
        let left = try XCTUnwrap(content.resizeHandles.first { $0.edges == .left })
        let right = try XCTUnwrap(content.resizeHandles.first { $0.edges == .right })
        let rightPoint = NSPoint(x: right.frame.midX, y: right.frame.midY)
        panel.sendEvent(try motion(at: NSPoint(x: left.frame.midX, y: left.frame.midY)))
        for type: NSEvent.EventType in [.mouseEntered, .mouseExited] {
          // A delayed exit from the old area must not undo the new area's
          // cursor, even where macOS 14 reuses the same horizontal cursor.
          panel.sendEvent(try XCTUnwrap(NSEvent.enterExitEvent(
            with: type, location: content.convert(rightPoint, to: nil), modifierFlags: [], timestamp: 2,
            windowNumber: panel.windowNumber, context: nil, eventNumber: 2,
            trackingNumber: 0, userData: nil
          )))
          XCTAssertTrue(NSCursor.current === right.resizeCursor)
        }
        print("RESIZE_WINDOW_TARGET mode=\(mode) size=\(size) checked=24 panel=\(panel.windowNumber)")
        panel.sendEvent(try motion(at: center))
        XCTAssertFalse(content.resizeHandles.contains { NSCursor.current === $0.resizeCursor })
        for cursor in [NSCursor.iBeam, .pointingHand] {
          cursor.set()
          panel.sendEvent(try motion(at: center))
          XCTAssertTrue(NSCursor.current === cursor, "Central content keeps its text/link cursor")
        }
        let bottom = try XCTUnwrap(content.resizeHandles.first { $0.edges == .bottom })
        let exterior = NSPoint(x: bottom.frame.midX, y: bottom.frame.minY + 1)
        controller.setCustomWindowResizeHandling(false)
        panel.display()
        try await Task.sleep(for: .milliseconds(50))
        XCTAssertTrue(content.resizeHandles.allSatisfy(\.isHidden))
        XCTAssertNotEqual(NSWindow.windowNumber(at: panel.convertPoint(toScreen: exterior),
                                               belowWindowWithWindowNumber: 0), panel.windowNumber,
                          "Disabling custom resize removes the exterior input surface")
        NSCursor.iBeam.set()
        panel.sendEvent(try motion(at: exterior))
        XCTAssertTrue(NSCursor.current === NSCursor.iBeam)
        controller.setCustomWindowResizeHandling(true)
      }
    }
    let right = try XCTUnwrap(content.resizeHandles.first { $0.edges == .right })
    let rightPoint = NSPoint(x: right.frame.midX, y: right.frame.midY)
    panel.orderOut(nil)
    for type: NSEvent.EventType in [.mouseMoved, .mouseEntered, .mouseExited, .cursorUpdate] {
      let event: NSEvent
      if type == .mouseMoved {
        event = try XCTUnwrap(NSEvent.mouseEvent(
          with: type, location: rightPoint, modifierFlags: [], timestamp: 3,
          windowNumber: panel.windowNumber, context: nil, eventNumber: 3, clickCount: 0, pressure: 0
        ))
      } else {
        event = try XCTUnwrap(NSEvent.enterExitEvent(
          with: type, location: rightPoint, modifierFlags: [], timestamp: 3,
          windowNumber: panel.windowNumber, context: nil, eventNumber: 3,
          trackingNumber: 0, userData: nil
        ))
      }
      NSCursor.pointingHand.set()
      panel.sendEvent(event)
      XCTAssertTrue(NSCursor.current === NSCursor.pointingHand,
                    "Hidden panel must ignore queued \(type) cursor ownership")
    }
  }

  func testCustomResizeContinuesAcrossPassiveEventsUntilMouseUp() throws {
    let ready = DaemonReady(
      type: "ready", protocolVersion: 1, port: 1, url: "http://127.0.0.1:1",
      sessionToken: "test-session", nativeToken: "test-native", pid: 1
    )
    let bridge = CommanderNativeBridge(
      ready: ready, keychain: KeychainStore(), loginItem: LaunchAtLoginService(),
      showLauncher: {}, hideLauncher: {}, showSettings: { _ in },
      updateHotKeys: { _, _ in }, updateMenuBar: { _ in }, updateWindowMode: { _ in }
    )
    let controller = LauncherPanelController(ready: ready, bridge: bridge)
    let panel = controller.panelForTesting
    defer { controller.shutdown() }

    func mouseEvent(_ type: NSEvent.EventType, at screenLocation: NSPoint) throws -> NSEvent {
      try XCTUnwrap(NSEvent.mouseEvent(
        with: type, location: panel.convertPoint(fromScreen: screenLocation),
        modifierFlags: [], timestamp: 0, windowNumber: panel.windowNumber,
        context: nil, eventNumber: 0, clickCount: 1, pressure: 1
      ))
    }
    func passiveEvent(_ type: NSEvent.EventType) throws -> NSEvent {
      switch type {
      case .mouseMoved:
        return try mouseEvent(.mouseMoved, at: panel.frame.origin)
      case .cursorUpdate, .mouseEntered, .mouseExited:
        return try XCTUnwrap(NSEvent.enterExitEvent(
          with: type, location: .zero, modifierFlags: [], timestamp: 0,
          windowNumber: panel.windowNumber, context: nil, eventNumber: 0,
          trackingNumber: 0, userData: nil
        ))
      case .flagsChanged:
        return try XCTUnwrap(NSEvent.keyEvent(
          with: type, location: .zero, modifierFlags: .shift, timestamp: 0,
          windowNumber: panel.windowNumber, context: nil, characters: "",
          charactersIgnoringModifiers: "", isARepeat: false, keyCode: 56
        ))
      default:
        return try XCTUnwrap(NSEvent.otherEvent(
          with: type, location: .zero, modifierFlags: [], timestamp: 0,
          windowNumber: panel.windowNumber, context: nil, subtype: 0, data1: 0, data2: 0
        ))
      }
    }
    let passiveTypes: [NSEvent.EventType] = [
      .mouseMoved, .cursorUpdate, .mouseEntered, .mouseExited, .appKitDefined,
      .systemDefined, .applicationDefined, .periodic, .flagsChanged,
    ]

    for mode in [LauncherWindowMode.standard, .compact] {
      controller.setWindowMode(mode)
      // Exercise an edge and a corner through the panel's actual event dispatch;
      // resize math alone cannot catch a session cancelled between drag events.
      for corner in [false, true] {
        let initialFrame = NSRect(origin: NSPoint(x: 100, y: 100), size: mode.size)
        panel.setFrame(initialFrame, display: false)
        let surface = initialFrame.insetBy(
          dx: CommanderWebView.launcherSurfaceInset,
          dy: CommanderWebView.launcherSurfaceInset
        )
        let start = corner
          ? NSPoint(x: surface.minX, y: surface.minY)
          : NSPoint(x: surface.maxX, y: surface.midY)
        func screenLocation(_ distance: CGFloat) -> NSPoint {
          NSPoint(
            x: start.x + (corner ? -distance : distance),
            y: start.y + (corner ? -distance : 0)
          )
        }
        func assertFrame(_ distance: CGFloat, file: StaticString = #filePath, line: UInt = #line) {
          let expected = corner
            ? NSRect(
              x: initialFrame.minX - distance, y: initialFrame.minY - distance,
              width: initialFrame.width + distance, height: initialFrame.height + distance
            )
            : NSRect(
              origin: initialFrame.origin,
              size: NSSize(width: initialFrame.width + distance, height: initialFrame.height)
            )
          XCTAssertEqual(panel.frame, expected, file: file, line: line)
        }

        panel.sendEvent(try mouseEvent(.leftMouseDown, at: start))
        panel.sendEvent(try mouseEvent(.leftMouseDragged, at: screenLocation(1)))
        assertFrame(1)
        for (index, type) in passiveTypes.enumerated() {
          panel.sendEvent(try passiveEvent(type))
          XCTAssertTrue(controller.resizeSessionActiveForTesting, "Cancelled by \(type)")
          let distance = CGFloat((index + 1) * 8)
          panel.sendEvent(try mouseEvent(.leftMouseDragged, at: screenLocation(distance)))
          assertFrame(distance)
        }
        // Reverse direction during the same hold, then ensure release fences
        // even an out-of-order dragged event from the completed gesture.
        panel.sendEvent(try mouseEvent(.leftMouseDragged, at: screenLocation(-12)))
        assertFrame(-12)
        panel.sendEvent(try mouseEvent(.leftMouseUp, at: screenLocation(-12)))
        XCTAssertFalse(controller.resizeSessionActiveForTesting)
        panel.sendEvent(try mouseEvent(.leftMouseDragged, at: screenLocation(80)))
        assertFrame(-12)
      }
    }
  }

  func testCustomResizeCancelsOnInputLifecycleChangesIncludingReturnAndCanBeDisabled() throws {
    let ready = DaemonReady(
      type: "ready",
      protocolVersion: 1,
      port: 1,
      url: "http://127.0.0.1:1",
      sessionToken: "test-session",
      nativeToken: "test-native",
      pid: 1
    )
    let bridge = CommanderNativeBridge(
      ready: ready,
      keychain: KeychainStore(),
      loginItem: LaunchAtLoginService(),
      showLauncher: {},
      hideLauncher: {},
      showSettings: { _ in },
      updateHotKeys: { _, _ in },
      updateMenuBar: { _ in },
      updateWindowMode: { _ in }
    )
    let controller = LauncherPanelController(ready: ready, bridge: bridge)
    let panel = controller.panelForTesting
    defer { controller.shutdown() }
    let location = NSPoint(
      x: panel.frame.width - CommanderWebView.launcherSurfaceInset,
      y: panel.frame.height / 2
    )
    func mouseEvent(_ type: NSEvent.EventType) throws -> NSEvent {
      try XCTUnwrap(
        NSEvent.mouseEvent(
          with: type,
          location: location,
          modifierFlags: [],
          timestamp: 0,
          windowNumber: panel.windowNumber,
          context: nil,
          eventNumber: 0,
          clickCount: 1,
          pressure: 1
        )
      )
    }
    func returnKeyEvent() throws -> NSEvent {
      try XCTUnwrap(
        NSEvent.keyEvent(
          with: .keyDown,
          location: .zero,
          modifierFlags: [],
          timestamp: 0,
          windowNumber: panel.windowNumber,
          context: nil,
          characters: "\r",
          charactersIgnoringModifiers: "\r",
          isARepeat: false,
          keyCode: 36
        )
      )
    }

    panel.sendEvent(try mouseEvent(.leftMouseDown))
    XCTAssertTrue(controller.resizeSessionActiveForTesting)
    panel.sendEvent(try mouseEvent(.leftMouseUp))
    XCTAssertFalse(controller.resizeSessionActiveForTesting)

    panel.sendEvent(try mouseEvent(.leftMouseDown))
    controller.windowDidResignKey(Notification(name: NSWindow.didResignKeyNotification, object: panel))
    XCTAssertFalse(controller.resizeSessionActiveForTesting)

    panel.sendEvent(try mouseEvent(.leftMouseDown))
    panel.sendEvent(try returnKeyEvent())
    XCTAssertFalse(controller.resizeSessionActiveForTesting)

    panel.sendEvent(try mouseEvent(.leftMouseDown))
    controller.windowDidBecomeKey(Notification(name: NSWindow.didBecomeKeyNotification, object: panel))
    XCTAssertFalse(controller.resizeSessionActiveForTesting)

    panel.sendEvent(try mouseEvent(.leftMouseDown))
    controller.hide()
    XCTAssertFalse(controller.resizeSessionActiveForTesting)

    panel.sendEvent(try mouseEvent(.leftMouseDown))
    panel.cancelOperation(nil)
    XCTAssertFalse(controller.resizeSessionActiveForTesting)

    panel.sendEvent(try mouseEvent(.leftMouseDown))
    controller.setCustomWindowResizeHandling(false)
    XCTAssertFalse(controller.resizeSessionActiveForTesting)
    XCTAssertFalse(controller.customWindowResizeHandlingEnabledForTesting)
    panel.sendEvent(try mouseEvent(.leftMouseDown))
    XCTAssertFalse(controller.resizeSessionActiveForTesting)
  }

  func testCustomResizeCancelsWhenThePanelCloses() throws {
    let ready = DaemonReady(
      type: "ready",
      protocolVersion: 1,
      port: 1,
      url: "http://127.0.0.1:1",
      sessionToken: "test-session",
      nativeToken: "test-native",
      pid: 1
    )
    let bridge = CommanderNativeBridge(
      ready: ready,
      keychain: KeychainStore(),
      loginItem: LaunchAtLoginService(),
      showLauncher: {},
      hideLauncher: {},
      showSettings: { _ in },
      updateHotKeys: { _, _ in },
      updateMenuBar: { _ in },
      updateWindowMode: { _ in }
    )
    let controller = LauncherPanelController(ready: ready, bridge: bridge)
    let panel = controller.panelForTesting
    defer { controller.shutdown() }
    let event = try XCTUnwrap(
      NSEvent.mouseEvent(
        with: .leftMouseDown,
        location: NSPoint(
          x: panel.frame.width - CommanderWebView.launcherSurfaceInset,
          y: panel.frame.height / 2
        ),
        modifierFlags: [],
        timestamp: 0,
        windowNumber: panel.windowNumber,
        context: nil,
        eventNumber: 0,
        clickCount: 1,
        pressure: 1
      )
    )
    panel.sendEvent(event)
    XCTAssertTrue(controller.resizeSessionActiveForTesting)

    panel.close()

    XCTAssertFalse(controller.resizeSessionActiveForTesting)
  }

  func testSettingsDeepLinkDispatchesOnlyKnownTabs() {
    let script = SettingsWindowController.settingsTabScriptForTesting(.search)
    XCTAssertTrue(script.contains("commander:settings-tab"))
    XCTAssertTrue(script.contains("detail:'search'"))
    XCTAssertEqual(CommanderSettingsTab(rawValue: "activity"), .activity)
    XCTAssertNil(CommanderSettingsTab(rawValue: "not-a-tab"))
  }

  func testFileDragAcceptsAnExistingAbsolutePathAndRejectsUnsafeInputs() throws {
    let file = FileManager.default.temporaryDirectory
      .appendingPathComponent("commander-drag-\(UUID().uuidString).txt")
    XCTAssertTrue(FileManager.default.createFile(atPath: file.path, contents: Data("drag".utf8)))
    defer { try? FileManager.default.removeItem(at: file) }

    XCTAssertEqual(try CommanderWebView.validatedFileURL(for: file.path), file.standardizedFileURL)
    XCTAssertEqual(
      try CommanderWebView.validatedDestructiveFileURL(for: file.path),
      file.standardizedFileURL
    )
    XCTAssertThrowsError(try CommanderWebView.validatedFileURL(for: "relative/file.txt"))
    XCTAssertThrowsError(try CommanderWebView.validatedDestructiveFileURL(for: "/"))
    XCTAssertThrowsError(
      try CommanderWebView.validatedDestructiveFileURL(
        for: FileManager.default.homeDirectoryForCurrentUser.path
      )
    )
    XCTAssertThrowsError(
      try CommanderWebView.validatedFileURL(
        for: FileManager.default.temporaryDirectory
          .appendingPathComponent(UUID().uuidString)
          .path
      )
    )
  }

  func testNativeFileIconProducesABoundedPNGForFilesFoldersAndApplications() throws {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("commander-icons-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
    let file = directory.appendingPathComponent("document.txt")
    XCTAssertTrue(FileManager.default.createFile(atPath: file.path, contents: Data("icon".utf8)))
    defer { try? FileManager.default.removeItem(at: directory) }

    let application = URL(fileURLWithPath: "/System/Applications/Finder.app")
    for url in [file, directory, application] where FileManager.default.fileExists(atPath: url.path) {
      let dataURL = try CommanderWebView.fileIconDataURL(for: url.path)
      XCTAssertTrue(dataURL.hasPrefix("data:image/png;base64,"))
      let encoded = String(dataURL.dropFirst("data:image/png;base64,".count))
      let data = try XCTUnwrap(Data(base64Encoded: encoded))
      XCTAssertLessThanOrEqual(data.count, 128 * 1024)
      XCTAssertNotNil(NSBitmapImageRep(data: data))
    }

    XCTAssertThrowsError(try CommanderWebView.fileIconDataURL(for: "relative/file.txt"))
  }

  func testPreparedFileDragKeepsLauncherVisibleUntilTheSessionEnds() throws {
    let ready = DaemonReady(
      type: "ready",
      protocolVersion: 1,
      port: 1,
      url: "http://127.0.0.1:1",
      sessionToken: "test-session",
      nativeToken: "test-native",
      pid: 1
    )
    let bridge = CommanderNativeBridge(
      ready: ready,
      keychain: KeychainStore(),
      loginItem: LaunchAtLoginService(),
      showLauncher: {},
      hideLauncher: {},
      showSettings: { _ in },
      updateHotKeys: { _, _ in },
      updateMenuBar: { _ in },
      updateWindowMode: { _ in }
    )
    let controller = LauncherPanelController(ready: ready, bridge: bridge)
    let panel = controller.panelForTesting
    guard let webView = panel.contentView as? CommanderWebView else {
      return XCTFail("Launcher content is not a CommanderWebView")
    }
    let file = FileManager.default.temporaryDirectory
      .appendingPathComponent("commander-drag-session-\(UUID().uuidString).txt")
    XCTAssertTrue(FileManager.default.createFile(atPath: file.path, contents: Data()))
    defer {
      try? FileManager.default.removeItem(at: file)
      controller.shutdown()
    }

    panel.orderFront(nil)
    try webView.prepareFileDrag(path: file.path)
    XCTAssertFalse(panel.hidesOnDeactivate)
    controller.windowDidResignKey(
      Notification(name: NSWindow.didResignKeyNotification, object: panel)
    )
    XCTAssertTrue(panel.isVisible)

    webView.cancelPreparedFileDrag()
    XCTAssertFalse(panel.hidesOnDeactivate)
    XCTAssertFalse(
      LauncherPanelController.shouldRestoreAfterResign(
        commandPresentationActive: false,
        applicationIsActive: false,
        hasOtherKeyWindow: false
      )
    )
    controller.hide()
    XCTAssertFalse(panel.isVisible)
  }

  func testCommandPresentationSurvivesTransientKeyLossUntilTheViewIsReady() {
    let ready = DaemonReady(
      type: "ready",
      protocolVersion: 1,
      port: 1,
      url: "http://127.0.0.1:1",
      sessionToken: "test-session",
      nativeToken: "test-native",
      pid: 1
    )
    let bridge = CommanderNativeBridge(
      ready: ready,
      keychain: KeychainStore(),
      loginItem: LaunchAtLoginService(),
      showLauncher: {},
      hideLauncher: {},
      showSettings: { _ in },
      updateHotKeys: { _, _ in },
      updateMenuBar: { _ in },
      updateWindowMode: { _ in }
    )
    let controller = LauncherPanelController(ready: ready, bridge: bridge)
    let panel = controller.panelForTesting
    let itemID = "extension:builtin:emoji-symbols:search-emoji-symbols"
    defer { controller.shutdown() }

    panel.orderFront(nil)
    controller.beginCommandHotKeyPresentation(itemID: itemID)
    controller.windowDidResignKey(
      Notification(name: NSWindow.didResignKeyNotification, object: panel)
    )

    XCTAssertTrue(panel.isVisible)
    XCTAssertEqual(controller.commandPresentationItemIDForTesting, itemID)

    controller.commandHotKeyReady(itemID: itemID)
    XCTAssertNil(controller.commandPresentationItemIDForTesting)
    XCTAssertTrue(
      LauncherPanelController.shouldRestoreAfterResign(
        commandPresentationActive: true,
        applicationIsActive: false,
        hasOtherKeyWindow: false
      )
    )
    XCTAssertFalse(
      LauncherPanelController.shouldRestoreAfterResign(
        commandPresentationActive: false,
        applicationIsActive: true,
        hasOtherKeyWindow: true
      )
    )
    controller.hide()
    XCTAssertFalse(panel.isVisible)
  }

  func testCommandHotKeyScriptEscapesTheItemIDAsJSON() {
    let script = LauncherPanelController.commandHotKeyScriptForTesting(
      itemID: "extension:test:command-'\""
    )
    XCTAssertTrue(script.contains("commander:command-hotkey"))
    XCTAssertTrue(script.contains(#"detail:"extension:test:command-'\"""#))
  }

  func testPinnedLauncherDoesNotUseTransientCollectionBehaviorOrDismissOnKeyLoss() {
    let ready = DaemonReady(
      type: "ready",
      protocolVersion: 1,
      port: 1,
      url: "http://127.0.0.1:1",
      sessionToken: "test-session",
      nativeToken: "test-native",
      pid: 1
    )
    let bridge = CommanderNativeBridge(
      ready: ready,
      keychain: KeychainStore(),
      loginItem: LaunchAtLoginService(),
      showLauncher: {},
      hideLauncher: {},
      showSettings: { _ in },
      updateHotKeys: { _, _ in },
      updateMenuBar: { _ in },
      updateWindowMode: { _ in }
    )
    let controller = LauncherPanelController(
      ready: ready,
      bridge: bridge,
      pinned: true,
      pinningEnabled: true
    )
    let panel = controller.panelForTesting
    defer { controller.shutdown() }

    panel.orderFront(nil)
    XCTAssertTrue(controller.isPinned)
    XCTAssertFalse(panel.collectionBehavior.contains(.transient))
    XCTAssertEqual(controller.statePayload["pinned"] as? Bool, true)

    controller.windowDidResignKey(
      Notification(name: NSWindow.didResignKeyNotification, object: panel)
    )
    XCTAssertTrue(panel.isVisible)

    controller.setPinned(false)
    XCTAssertFalse(controller.isPinned)
    XCTAssertTrue(panel.collectionBehavior.contains(.transient))
  }

  private func descendants(of view: NSView) -> [NSView] {
    view.subviews + view.subviews.flatMap(descendants)
  }
}
