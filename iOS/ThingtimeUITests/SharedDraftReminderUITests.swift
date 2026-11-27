import XCTest

/// Opt-in installed-app acceptance. Seed only the dedicated simulator's local
/// ShareInbox before running; never use a personal device or production account.
final class SharedDraftReminderUITests: XCTestCase {
    func testDismissRelaunchAndRecover() throws {
        guard ProcessInfo.processInfo.environment["THINGTIME_SHARED_DRAFT_UI_AUTOMATION"] == "1" else {
            throw XCTSkip("Requires the isolated seeded shared-draft simulator fixture")
        }
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.thingtime.appletime")
        app.launch()
        let dismiss = app.buttons["dismiss-shared-draft-reminder"]
        XCTAssertTrue(dismiss.waitForExistence(timeout: 20))
        XCTAssertGreaterThanOrEqual(dismiss.frame.width, 44)
        XCTAssertGreaterThanOrEqual(dismiss.frame.height, 44)
        XCTAssertTrue(app.buttons["continue-shared-draft"].isHittable)
        attach("shared-draft-before-dismiss")
        dismiss.tap()
        XCTAssertFalse(dismiss.exists)
        attach("shared-draft-dismissed")
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertFalse(dismiss.exists)
        app.terminate()
        app.launch()
        XCTAssertFalse(dismiss.waitForExistence(timeout: 3))
        // The native drawer uses an edge gesture, independently of web login.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.5))
            .press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.75, dy: 0.5)))
        let drafts = app.buttons["native-open-shared-drafts"]
        XCTAssertTrue(drafts.waitForExistence(timeout: 10))
        drafts.tap()
        let draft = app.buttons["shared-draft-11111111-1111-4111-8111-111111111111"]
        XCTAssertTrue(draft.waitForExistence(timeout: 10))
        attach("shared-draft-recovery-list")
        draft.tap()
        XCTAssertFalse(draft.exists)
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 15))
    }

    private func attach(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
