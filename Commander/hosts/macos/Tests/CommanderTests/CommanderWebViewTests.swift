import AppKit
import WebKit
import XCTest
@testable import Commander

@MainActor
final class CommanderWebViewTests: XCTestCase {
  func testNativeOAuthCallbackOnlyAcceptsTheRegisteredCommanderRoute() {
    XCTAssertTrue(
      CommanderOAuthCallback.isValid(
        URL(string: "com.thingtime.commander://oauth/callback?code=code-value&state=0123456789abcdef")!
      )
    )
    XCTAssertTrue(
      CommanderOAuthCallback.isValid(
        URL(string: "com.thingtime.commander://oauth/callback?error=access_denied&state=0123456789abcdef")!
      )
    )
    for raw in [
      "commander://oauth/callback?code=code-value&state=0123456789abcdef",
      "com.thingtime.commander://other/callback?code=code-value&state=0123456789abcdef",
      "com.thingtime.commander://oauth/callback?code=code-value",
      "com.thingtime.commander://oauth/callback?code=one&code=two&state=0123456789abcdef",
      "com.thingtime.commander://oauth/callback?code=code-value&state=0123456789abcdef#fragment",
    ] {
      XCTAssertFalse(CommanderOAuthCallback.isValid(URL(string: raw)!))
    }
  }

  func testKeychainEnvironmentParserRejectsAmbiguousKeys() {
    XCTAssertEqual(
      KeychainStore.environment(from: "https://dev.thingtime.com|ttapp_development|user-1"),
      KeychainCredentialEnvironment(
        issuer: "https://dev.thingtime.com",
        clientID: "ttapp_development",
        accountID: "user-1"
      )
    )
    XCTAssertNil(KeychainStore.environment(from: "https://thingtime.com|ttapp|user|extra"))
    XCTAssertNil(KeychainStore.environment(from: "https://thingtime.com||user"))
  }

  func testDeniedEmojiPasteDoesNotTouchTheClipboard() async {
    let ready = DaemonReady(
      type: "ready", protocolVersion: 1, port: 1, url: "http://127.0.0.1:1",
      sessionToken: "test-session", nativeToken: "test-native", pid: 1
    )
    let bridge = CommanderNativeBridge(
      ready: ready, keychain: KeychainStore(), loginItem: LaunchAtLoginService(),
      showLauncher: {}, hideLauncher: {}, showSettings: { _ in },
      updateHotKeys: { _, _ in }, updateMenuBar: { _ in }, updateWindowMode: { _ in }
    )
    let controller = LauncherPanelController(
      ready: ready, bridge: bridge, isAccessibilityTrusted: { false }
    )
    defer { controller.shutdown() }
    let changeCount = NSPasteboard.general.changeCount

    let result = await controller.paste("❤️", preserveClipboard: true)

    XCTAssertEqual(result["requiresAccessibility"] as? Bool, true)
    XCTAssertEqual(result["copied"] as? Bool, false)
    XCTAssertEqual(result["pasted"] as? Bool, false)
    XCTAssertEqual(NSPasteboard.general.changeCount, changeCount)
  }

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

  func testNewWindowPinningUsesTheGlobalDefault() {
    XCTAssertFalse(
      CommanderAppDelegate.initialPinnedState(defaultPinned: false)
    )
    XCTAssertTrue(
      CommanderAppDelegate.initialPinnedState(defaultPinned: true)
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

  func testNativeFileIconQueueCoalescesAndCachesRepeatedPaths() async throws {
    let file = FileManager.default.temporaryDirectory
      .appendingPathComponent("commander-icon-cache-\(UUID().uuidString).txt")
    XCTAssertTrue(FileManager.default.createFile(atPath: file.path, contents: Data("icon".utf8)))
    defer { try? FileManager.default.removeItem(at: file) }

    var renderedPaths: [String] = []
    let queue = CommanderFileIconRequestQueue { path in
      renderedPaths.append(path)
      return "data:image/png;base64,Y2FjaGVk"
    }

    async let first = queue.dataURL(for: file.path)
    async let duplicate = queue.dataURL(for: file.path)
    let responses = try await (first, duplicate)
    XCTAssertEqual(responses.0, "data:image/png;base64,Y2FjaGVk")
    XCTAssertEqual(responses.1, "data:image/png;base64,Y2FjaGVk")
    XCTAssertEqual(renderedPaths, [file.standardizedFileURL.path])

    let cachedResponse = try await queue.dataURL(for: file.path)
    XCTAssertEqual(cachedResponse, "data:image/png;base64,Y2FjaGVk")
    XCTAssertEqual(renderedPaths.count, 1)
  }

  func testApplicationOpenSubmissionDoesNotWaitForLaunchServicesCompletion() {
    let target = URL(fileURLWithPath: "/Applications/Notes.app")
    var submittedURL: URL?
    var activates: Bool?
    let opener = CommanderApplicationOpener { url, configuration, _ in
      submittedURL = url
      activates = configuration.activates
      // Deliberately never call the completion handler: this models a stuck
      // Launch Services XPC reply, which must not hold Commander's UI thread.
    }

    opener.submit(target)

    XCTAssertEqual(submittedURL, target)
    XCTAssertEqual(activates, true)
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
