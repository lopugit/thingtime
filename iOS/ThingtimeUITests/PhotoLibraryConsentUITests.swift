import XCTest

/// Real UI automation runs in its own runner, never inside the hosted app's
/// unit-test process. The installed fixture first verifies the loopback account.
final class PhotoLibraryConsentUITests: XCTestCase {
    func testPhotoConsent() throws {
        let environment = ProcessInfo.processInfo.environment
        guard environment["THINGTIME_PHOTO_UI_AUTOMATION"] == "1",
              let value = environment["THINGTIME_DEVICE_TEST_ORIGIN"], let origin = URL(string: value),
              origin.scheme == "http", ["localhost", "127.0.0.1"].contains(origin.host ?? "") else {
            throw XCTSkip("Run the opt-in disposable installed Photos fixture")
        }
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.thingtime.appletime")
        app.launch()
        let menu = app.buttons["Open menu"]
        XCTAssertTrue(menu.waitForExistence(timeout: 30))
        menu.tap()
        let things = app.links.matching(NSPredicate(format: "label CONTAINS[c] %@", "Things")).firstMatch
        XCTAssertTrue(things.waitForExistence(timeout: 10), "The ordinary navigation menu must expose Things")
        things.tap()
        let setup = app.links["Device setup"]
        XCTAssertTrue(setup.waitForExistence(timeout: 30), "The ordinary Things page must expose native setup")
        setup.tap()
        let add = app.buttons["Add this device"]
        if add.waitForExistence(timeout: 3) { add.tap() }
        // A prior successful run can leave this exact disposable source granted.
        let persisted = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Photo library")).firstMatch
        if persisted.waitForExistence(timeout: 4) {
            print("IOS_PHOTO_UI_EXISTING_GRANT: previously granted native source is visible")
            return
        }
        let choose = app.buttons["Choose folder"]
        XCTAssertTrue(choose.waitForExistence(timeout: 30))
        choose.tap()
        let source = app.alerts["Choose backup source"]
        XCTAssertTrue(source.waitForExistence(timeout: 10))
        XCTAssertTrue(source.buttons["Photo library (backup)"].isHittable)
        source.buttons["Photo library (backup)"].tap()
        let explanation = app.alerts["Back up photo originals?"]
        XCTAssertTrue(explanation.waitForExistence(timeout: 10), "Source selection must open its native explanation")
        explanation.buttons["Choose photo access"].tap()
        let permission = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.firstMatch
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            persisted.exists || permission.exists
        }, object: app)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 35), .completed,
            "Photos must show its normal permission prompt or project its authorized source")
        if permission.exists {
            let allow = permission.buttons.matching(NSPredicate(format: "label IN %@", ["Allow Full Access", "Allow Access to All Photos"])).firstMatch
            XCTAssertTrue(allow.exists && allow.isHittable, "Unexpected Photos prompt buttons: " + permission.buttons.allElementsBoundByIndex.map(\.label).joined(separator: ", "))
            allow.tap()
        }
        XCTAssertTrue(persisted.waitForExistence(timeout: 30), "The native Photos root must be visible before ending the UI session")
        print("IOS_PHOTO_UI_CONSENT_PASS: ordinary setup, native source selection, Photos authorization and persisted native grant")
    }
}
