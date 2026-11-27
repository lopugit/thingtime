import AppKit
import XCTest
@testable import Commander

@MainActor
final class LauncherWindowSelectionTests: XCTestCase {
  private let builtIn = 1
  private let external = 5

  private func candidate(
    _ id: UUID = UUID(),
    recency: UInt64,
    screen: Int?,
    visible: Bool,
    pinned: Bool
  ) -> LauncherWindowSelection.Candidate {
    .init(id: id, recency: recency, screenNumber: screen, isVisible: visible, isPinned: pinned)
  }

  func testHotkeyOnAnotherDisplayNeverFocusesAPinnedWindowThere() {
    let pinned = candidate(recency: 9, screen: builtIn, visible: true, pinned: true)

    // Only a pinned window on the other display: create a launcher here.
    XCTAssertNil(LauncherWindowSelection.choose(
      .open, among: [pinned], activeScreenNumber: external, preferCurrentDisplay: true
    ))

    // A hidden launcher last shown on the pinned window's display is reused
    // and presented on the active display instead.
    let hidden = candidate(recency: 3, screen: builtIn, visible: false, pinned: false)
    XCTAssertEqual(LauncherWindowSelection.choose(
      .open, among: [pinned, hidden], activeScreenNumber: external, preferCurrentDisplay: true
    ), hidden.id)

    // On its own display the pinned window is still focused.
    XCTAssertEqual(LauncherWindowSelection.choose(
      .open, among: [pinned, hidden], activeScreenNumber: builtIn, preferCurrentDisplay: true
    ), pinned.id)
  }

  func testOpenKeepsMostRecentOnTheCurrentDisplay() {
    let pinnedHere = candidate(recency: 4, screen: external, visible: true, pinned: true)
    let hiddenHere = candidate(recency: 6, screen: external, visible: false, pinned: false)
    let hiddenElsewhere = candidate(recency: 8, screen: builtIn, visible: false, pinned: false)
    let all = [pinnedHere, hiddenHere, hiddenElsewhere]

    XCTAssertEqual(LauncherWindowSelection.choose(
      .open, among: all, activeScreenNumber: external, preferCurrentDisplay: true
    ), hiddenHere.id)
    XCTAssertEqual(LauncherWindowSelection.choose(
      .open, among: [pinnedHere, hiddenElsewhere], activeScreenNumber: external, preferCurrentDisplay: true
    ), pinnedHere.id)
  }

  func testTransientWindowOnAnotherDisplayRemainsAToggleTarget() {
    // An unpinned launcher left open while the pointer moved to another
    // display still toggles closed on the next hotkey press.
    let transient = candidate(recency: 2, screen: builtIn, visible: true, pinned: false)
    XCTAssertEqual(LauncherWindowSelection.choose(
      .open, among: [transient], activeScreenNumber: external, preferCurrentDisplay: true
    ), transient.id)
  }

  func testCommandShortcutsNeverBorrowAVisiblePinnedWindow() {
    let pinnedElsewhere = candidate(recency: 9, screen: builtIn, visible: true, pinned: true)
    let pinnedHere = candidate(recency: 8, screen: external, visible: true, pinned: true)

    for preferCurrentDisplay in [true, false] {
      XCTAssertNil(LauncherWindowSelection.choose(
        .command, among: [pinnedElsewhere, pinnedHere],
        activeScreenNumber: external, preferCurrentDisplay: preferCurrentDisplay
      ))
    }

    // A hidden pinned launcher is not anchored anywhere and can present here.
    let hiddenPinned = candidate(recency: 1, screen: builtIn, visible: false, pinned: true)
    XCTAssertEqual(LauncherWindowSelection.choose(
      .command, among: [pinnedElsewhere, pinnedHere, hiddenPinned],
      activeScreenNumber: external, preferCurrentDisplay: true
    ), hiddenPinned.id)
  }

  func testDisablingPerDisplayFocusOrUnknownDisplayUsesGlobalRecency() {
    let pinnedElsewhere = candidate(recency: 9, screen: builtIn, visible: true, pinned: true)
    let hiddenHere = candidate(recency: 3, screen: external, visible: false, pinned: false)

    XCTAssertEqual(LauncherWindowSelection.choose(
      .open, among: [pinnedElsewhere, hiddenHere], activeScreenNumber: external, preferCurrentDisplay: false
    ), pinnedElsewhere.id)
    XCTAssertEqual(LauncherWindowSelection.choose(
      .open, among: [pinnedElsewhere, hiddenHere], activeScreenNumber: nil, preferCurrentDisplay: true
    ), pinnedElsewhere.id)
    XCTAssertNil(LauncherWindowSelection.choose(
      .open, among: [], activeScreenNumber: external, preferCurrentDisplay: true
    ))
  }

  func testKeyHandoffOnlyRefusesAKnownDisplayChange() {
    XCTAssertTrue(CommanderKeyWindowHandoff.allowsHandoff(from: external, to: external))
    XCTAssertFalse(CommanderKeyWindowHandoff.allowsHandoff(from: external, to: builtIn))
    XCTAssertTrue(CommanderKeyWindowHandoff.allowsHandoff(from: nil, to: builtIn))
    XCTAssertTrue(CommanderKeyWindowHandoff.allowsHandoff(from: external, to: nil))
    XCTAssertFalse(CommanderKeyWindowHandoff.isOrderingOutForTesting)
  }

  /// Uses real launcher panels and a Settings-class window on two displays.
  /// While a key launcher is dismissed, AppKit picks the next key window by
  /// asking each window whether it can become key (verified separately in a
  /// running app). Windows on the other display must refuse; a window on the
  /// dismissed launcher's display, and every window afterwards, must not.
  func testDismissingALauncherRefusesKeyHandoffToAnotherDisplay() throws {
    _ = NSApplication.shared
    let screens = NSScreen.screens
    try XCTSkipUnless(screens.count >= 2, "Requires two displays")
    let ready = DaemonReady(
      type: "ready", protocolVersion: 1, port: 1, url: "http://127.0.0.1:1",
      sessionToken: "test-session", nativeToken: "test-native", pid: 1
    )
    func makeController(pinned: Bool) -> LauncherPanelController {
      let bridge = CommanderNativeBridge(
        ready: ready, keychain: KeychainStore(), loginItem: LaunchAtLoginService(),
        showLauncher: {}, hideLauncher: {}, showSettings: { _ in },
        updateHotKeys: { _, _ in }, updateMenuBar: { _ in }, updateWindowMode: { _ in }
      )
      return LauncherPanelController(ready: ready, bridge: bridge, pinned: pinned)
    }
    let pinnedElsewhere = makeController(pinned: true)
    let pinnedHere = makeController(pinned: true)
    let transient = makeController(pinned: false)
    let settingsElsewhere = CommanderUtilityWindow(
      contentRect: .zero, styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false
    )
    settingsElsewhere.isReleasedWhenClosed = false
    defer {
      pinnedElsewhere.shutdown()
      pinnedHere.shutdown()
      transient.shutdown()
      settingsElsewhere.orderOut(nil)
    }
    func place(_ window: NSWindow, on screen: NSScreen, offset: CGFloat = 0) {
      let visible = screen.visibleFrame
      window.setFrame(
        NSRect(x: visible.midX - 260 + offset, y: visible.midY - 150, width: 520, height: 300),
        display: false
      )
    }
    place(pinnedElsewhere.panelForTesting, on: screens[0])
    place(settingsElsewhere, on: screens[0], offset: 40)
    place(pinnedHere.panelForTesting, on: screens[1], offset: 40)
    place(transient.panelForTesting, on: screens[1])
    XCTAssertNotEqual(pinnedElsewhere.screenNumber, transient.screenNumber)
    XCTAssertEqual(pinnedHere.screenNumber, transient.screenNumber)
    XCTAssertEqual(settingsElsewhere.commanderScreenNumber, pinnedElsewhere.screenNumber)

    pinnedElsewhere.panelForTesting.orderFrontRegardless()
    pinnedHere.panelForTesting.orderFrontRegardless()
    settingsElsewhere.orderFrontRegardless()
    let transientPanel = transient.panelForTesting
    transientPanel.makeKeyAndOrderFront(nil)
    try XCTSkipUnless(transientPanel.isKeyWindow, "The launcher fixture could not become key")

    let probe = KeyHandoffProbe(windows: [
      "pinnedElsewhere": pinnedElsewhere.panelForTesting,
      "settingsElsewhere": settingsElsewhere,
      "pinnedHere": pinnedHere.panelForTesting,
    ])
    NotificationCenter.default.addObserver(
      probe, selector: #selector(KeyHandoffProbe.capture),
      name: NSWindow.didResignKeyNotification, object: transientPanel
    )
    defer { NotificationCenter.default.removeObserver(probe) }

    transient.hide()

    XCTAssertFalse(transientPanel.isVisible)
    XCTAssertEqual(probe.wasOrderingOut, true, "Dismissal did not resign key inside the guarded order-out")
    XCTAssertEqual(probe.canBecomeKey["pinnedElsewhere"], false)
    XCTAssertEqual(probe.canBecomeMain["pinnedElsewhere"], false)
    XCTAssertEqual(probe.canBecomeKey["settingsElsewhere"], false)
    XCTAssertEqual(probe.canBecomeKey["pinnedHere"], true)
    XCTAssertFalse(pinnedElsewhere.panelForTesting.isKeyWindow)
    XCTAssertFalse(settingsElsewhere.isKeyWindow)
    XCTAssertTrue(pinnedElsewhere.panelForTesting.isVisible)

    // Outside a dismissal every window is focusable as usual.
    XCTAssertFalse(CommanderKeyWindowHandoff.isOrderingOutForTesting)
    XCTAssertTrue(pinnedElsewhere.panelForTesting.canBecomeKey)
    XCTAssertTrue(settingsElsewhere.canBecomeKey)
    pinnedElsewhere.panelForTesting.makeKeyAndOrderFront(nil)
    XCTAssertTrue(pinnedElsewhere.panelForTesting.isKeyWindow)
  }
}

/// Records which windows would accept automatic key status at the moment a
/// dismissed launcher resigns key.
@MainActor
private final class KeyHandoffProbe: NSObject {
  private let windows: [String: NSWindow]
  private(set) var wasOrderingOut: Bool?
  private(set) var canBecomeKey: [String: Bool] = [:]
  private(set) var canBecomeMain: [String: Bool] = [:]

  init(windows: [String: NSWindow]) {
    self.windows = windows
  }

  @objc func capture(_ notification: Notification) {
    wasOrderingOut = CommanderKeyWindowHandoff.isOrderingOutForTesting
    for (name, window) in windows {
      canBecomeKey[name] = window.canBecomeKey
      canBecomeMain[name] = window.canBecomeMain
    }
  }
}
