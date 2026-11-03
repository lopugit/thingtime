import AppKit
import XCTest
@testable import Commander

final class ProcessUsageHistoryTests: XCTestCase {
  private func row(cpu: Double, started: Int = 1) -> [String: Any] {
    ["pid": 20, "startedAtMs": started, "name": "Test", "cpuPercent": cpu,
     "residentMemoryBytes": 100, "diskReadBytesPerSecond": 10, "diskWriteBytesPerSecond": 2]
  }
  func testWeightedAveragesAndMissingHistory() {
    let history = ProcessUsageHistory()
    history.record([row(cpu: 0)], at: 100)
    XCTAssertNil(history.average(pid: 20, seconds: 300, at: 100))
    history.record([row(cpu: 20)], at: 102)
    history.record([row(cpu: 80)], at: 106)
    let average = history.average(pid: 20, seconds: 300, at: 106)
    XCTAssertEqual(average?["cpuPercent"] as? Double, 60)
    XCTAssertEqual(average?["observedSeconds"] as? Double, 6)
    XCTAssertNil(average?["gpuPercent"])
    XCTAssertNil(history.average(pid: 20, seconds: 0, at: 106))
  }
  func testGapsExpiryAndPIDReuseDoNotInventHistory() {
    let history = ProcessUsageHistory()
    history.record([row(cpu: 0)], at: 100)
    history.record([row(cpu: 80)], at: 102)
    history.record([row(cpu: 0)], at: 500)
    XCTAssertNil(history.average(pid: 20, seconds: 300, at: 500))
    XCTAssertEqual(history.average(pid: 20, seconds: 600, at: 500)?["observedSeconds"] as? Double, 2)
    history.record([row(cpu: 20, started: 2)], at: 502)
    XCTAssertNil(history.average(pid: 20, seconds: 600, at: 502))
    history.record([row(cpu: 10, started: 2)], at: 504)
    history.record([], at: 506)
    XCTAssertNil(history.average(pid: 20, seconds: 600, at: 506))
  }
}

@MainActor
final class CommanderUtilityWindowTests: XCTestCase {
  func testNativeFullscreenActionStaysOnDesktop() {
    _ = NSApplication.shared
    let window = CommanderUtilityWindow(contentRect: NSRect(x: 120, y: 140, width: 800, height: 500), styleMask: [.titled, .resizable], backing: .buffered, defer: false)
    XCTAssertTrue(window.collectionBehavior.contains(.fullScreenNone))
    window.toggleFullScreen(nil)
    XCTAssertFalse(window.styleMask.contains(.fullScreen))
    XCTAssertEqual(window.frame, NSScreen.main!.visibleFrame)
    window.orderOut(nil)
  }

  func testDuplicateNativeAndWebZoomDeliveriesOnlyToggleOnce() {
    _ = NSApplication.shared
    let window = CommanderUtilityWindow(contentRect: NSRect(x: 120, y: 140, width: 800, height: 500), styleMask: [.titled, .resizable], backing: .buffered, defer: false)
    let original = window.frame
    let usable = NSScreen.main!.visibleFrame
    window.requestZoom(in: usable, at: 10)
    let maximized = window.frame
    window.requestZoom(in: usable, at: 10.01)
    XCTAssertEqual(window.frame, maximized)
    window.requestZoom(in: usable, at: 12)
    XCTAssertEqual(window.frame, original)
    window.orderOut(nil)
  }

  func testMaximizeRestoresExactFrameAndKeepsResizableNormalWindow() {
    _ = NSApplication.shared
    let original = NSRect(x: 120, y: 140, width: 800, height: 500)
    let window = CommanderUtilityWindow(contentRect: original, styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
    window.setFrame(original, display: false)
    let full = NSRect(x: 0, y: 30, width: 1440, height: 870)
    window.toggleMaximize(in: full)
    XCTAssertEqual(window.frame, full)
    XCTAssertFalse(window.styleMask.contains(.fullScreen))
    XCTAssertTrue(window.styleMask.contains(.resizable))
    window.toggleMaximize(in: full)
    XCTAssertEqual(window.frame, original)
    window.orderOut(nil)
  }
}
