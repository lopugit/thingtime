import AppKit
import XCTest
@testable import ThingtimeNode

@MainActor
final class MacFolderSyncDialogTests: XCTestCase {
    func testChooserKeepsMainActorResponsiveAndClosesOnlyItsOwnSheet() async throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["THINGTIME_TEST_MAC_DIALOG"] == "1",
                          "This AppKit integration test requires an interactive macOS session.")
        let app = NSApplication.shared
        let previousPolicy = app.activationPolicy()
        app.setActivationPolicy(.accessory)
        defer { app.setActivationPolicy(previousPolicy) }

        let otherHost = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 200, height: 100),
                                 styleMask: [.titled], backing: .buffered, defer: true)
        let otherSheet = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 200, height: 100),
                                  styleMask: [.titled], backing: .buffered, defer: true)
        otherHost.makeKeyAndOrderFront(nil)
        otherHost.beginSheet(otherSheet, completionHandler: nil)
        defer {
            otherHost.endSheet(otherSheet)
            otherHost.orderOut(nil)
        }
        XCTAssertTrue(otherHost.attachedSheet === otherSheet)

        let dialogs = MacFolderSyncDialogs(alertTimeout: .seconds(2))
        defer { dialogs.cancel() }
        let first = Task { try await dialogs.chooseSource() }
        let firstHost = try await visibleChooser()
        XCTAssertNil(app.modalWindow)
        dialogs.cancel()
        dialogs.cancel()
        let cancelled = try await first.value
        XCTAssertNil(cancelled)
        XCTAssertFalse(firstHost.isVisible)
        XCTAssertTrue(otherHost.attachedSheet === otherSheet)

        let second = Task { try await dialogs.chooseSource() }
        let secondHost = try await visibleChooser()
        XCTAssertFalse(firstHost === secondHost)
        let expired = try await second.value
        XCTAssertNil(expired)
        XCTAssertFalse(secondHost.isVisible)
        XCTAssertTrue(otherHost.attachedSheet === otherSheet)

        let reopened = Task { try await dialogs.chooseSource() }
        let reopenedHost = try await visibleChooser()
        XCTAssertFalse(secondHost === reopenedHost)
        dialogs.cancel()
        let reopenedResult = try await reopened.value
        XCTAssertNil(reopenedResult)
        XCTAssertFalse(reopenedHost.isVisible)
    }

    private func visibleChooser() async throws -> NSWindow {
        let deadline = ContinuousClock.now + .seconds(1)
        repeat {
            if let host = NSApp.windows.first(where: { $0.title == "Thingtime Folder Sync" && $0.attachedSheet != nil }) {
                return host
            }
            try await Task.sleep(for: .milliseconds(10))
        } while ContinuousClock.now < deadline
        return try XCTUnwrap(nil as NSWindow?, "The AppKit test host did not present the chooser sheet in time.")
    }
}
