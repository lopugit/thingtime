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
    let script = SettingsWindowController.settingsTabScriptForTesting(.extensions)
    XCTAssertTrue(script.contains("commander:settings-tab"))
    XCTAssertTrue(script.contains("detail:'extensions'"))
    XCTAssertNil(CommanderSettingsTab(rawValue: "not-a-tab"))
  }

  func testFileDragAcceptsAnExistingAbsolutePathAndRejectsUnsafeInputs() throws {
    let file = FileManager.default.temporaryDirectory
      .appendingPathComponent("commander-drag-\(UUID().uuidString).txt")
    XCTAssertTrue(FileManager.default.createFile(atPath: file.path, contents: Data("drag".utf8)))
    defer { try? FileManager.default.removeItem(at: file) }

    XCTAssertEqual(try CommanderWebView.validatedFileURL(for: file.path), file.standardizedFileURL)
    XCTAssertThrowsError(try CommanderWebView.validatedFileURL(for: "relative/file.txt"))
    XCTAssertThrowsError(
      try CommanderWebView.validatedFileURL(
        for: FileManager.default.temporaryDirectory
          .appendingPathComponent(UUID().uuidString)
          .path
      )
    )
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
    XCTAssertTrue(panel.hidesOnDeactivate)
    controller.windowDidResignKey(
      Notification(name: NSWindow.didResignKeyNotification, object: panel)
    )
    XCTAssertFalse(panel.isVisible)
  }

  func testCommandHotKeyScriptEscapesTheItemIDAsJSON() {
    let script = LauncherPanelController.commandHotKeyScriptForTesting(
      itemID: "extension:test:command-'\""
    )
    XCTAssertTrue(script.contains("commander:command-hotkey"))
    XCTAssertTrue(script.contains(#"detail:"extension:test:command-'\"""#))
  }

  private func descendants(of view: NSView) -> [NSView] {
    view.subviews + view.subviews.flatMap(descendants)
  }
}
