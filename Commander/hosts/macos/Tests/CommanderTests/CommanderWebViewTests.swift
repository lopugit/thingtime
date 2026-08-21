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
    controller.shutdown()
  }

  func testSettingsDeepLinkDispatchesOnlyKnownTabs() {
    let script = SettingsWindowController.settingsTabScriptForTesting(.search)
    XCTAssertTrue(script.contains("commander:settings-tab"))
    XCTAssertTrue(script.contains("detail:'search'"))
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
