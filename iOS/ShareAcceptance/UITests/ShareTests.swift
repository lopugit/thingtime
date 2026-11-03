import XCTest
import UIKit

final class ShareTests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
        addUIInterruptionMonitor(withDescription: "Synthetic fixture photo access") { alert in
            let allow = alert.buttons["Allow Full Access"]
            if allow.exists { allow.tap(); return true }
            return false
        }
    }
    func testProviderFailureCanRetryAndCancel() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--fixture", "unavailable"]
        app.launch()
        app.buttons["share-fixture"].tap()
        let target = app.cells.containing(.staticText, identifier: "Thingtime").firstMatch
        XCTAssertTrue(target.waitForExistence(timeout: 10), app.debugDescription)
        target.tap()
        XCTAssertTrue(app.staticTexts["Couldn’t save this share"].waitForExistence(timeout: 30), app.debugDescription)
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); shot.name = "provider-failure-retry-cancel"; shot.lifetime = .keepAlways; add(shot)
        app.buttons["Try Again"].tap()
        XCTAssertTrue(app.buttons["Try Again"].waitForExistence(timeout: 10))
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.buttons["share-fixture"].waitForExistence(timeout: 10))
    }
    func testPhotosLivePhoto() throws {
        let app = XCUIApplication()
        app.launch()
        app.buttons["seed-live-photo"].tap()
        let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons.matching(NSPredicate(format: "label CONTAINS[c] 'Allow Full Access' OR label == 'Allow Access to All Photos'" )).firstMatch
        if allow.waitForExistence(timeout: 3) { allow.tap() }
        XCTAssertTrue(app.staticTexts["live-photo-seeded"].waitForExistence(timeout: 45), app.debugDescription)
        let photos = XCUIApplication(bundleIdentifier: "com.apple.mobileslideshow")
        photos.launch()
        for label in ["Continue", "Get Started", "Not Now"] {
            let button = photos.buttons[label].firstMatch
            if button.waitForExistence(timeout: 2) { button.tap() }
        }
        let back = photos.buttons["Back"].firstMatch
        if back.exists { back.tap() }
        let library = photos.buttons["Library"].firstMatch
        if library.exists { library.tap() }
        let liveImages = photos.images.matching(NSPredicate(format: "label BEGINSWITH 'Live Photo,'"))
        let thumbnail = liveImages.allElementsBoundByIndex.last ?? liveImages.firstMatch
        XCTAssertTrue(thumbnail.waitForExistence(timeout: 10), photos.debugDescription)
        if thumbnail.isHittable { thumbnail.tap() }
        else {
            let frame = thumbnail.frame
            XCTAssertTrue(photos.frame.contains(CGPoint(x: frame.midX, y: frame.midY)), photos.debugDescription)
            photos.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0)).withOffset(CGVector(dx: frame.midX, dy: frame.midY)).tap()
        }
        let share = photos.buttons["Share"].firstMatch
        XCTAssertTrue(share.waitForExistence(timeout: 10), photos.debugDescription)
        share.tap()
        let target = photos.cells.containing(.staticText, identifier: "Thingtime").firstMatch
        XCTAssertTrue(target.waitForExistence(timeout: 10), photos.debugDescription)
        let offered = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); offered.name = "photos-live-photo-thingtime-offered"; offered.lifetime = .keepAlways; add(offered)
        target.tap()
        XCTAssertTrue(photos.staticTexts["Saved locally"].waitForExistence(timeout: 30), photos.debugDescription)
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); shot.name = "saved-photos-live-photo"; shot.lifetime = .keepAlways; add(shot)
        photos.buttons["Done"].firstMatch.tap()
        XCUIApplication(bundleIdentifier: "com.thingtime.appletime").launch()
        sleep(2)
    }
    func testSystemShareFixtures() throws {
        let cases = ProcessInfo.processInfo.environment["SHARE_ACCEPTANCE_CASES"]?.split(separator: ",").map(String.init) ?? ["text", "url", "image", "pdf", "zip", "wav", "mp4", "custom", "mixed", "many", "directory"]
        for kind in cases {
            let app = XCUIApplication()
            app.launchArguments = ["--fixture", kind]
            app.launch()
            app.buttons["share-fixture"].tap()
            let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
            let thingtime = app.buttons["Thingtime"].firstMatch
            if !thingtime.waitForExistence(timeout: 5) {
                let more = app.buttons["More"].firstMatch
                if more.exists { more.tap() }
            }
            let selectable = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            selectable.name = "system-share-sheet-\(kind)"; selectable.lifetime = .keepAlways; add(selectable)
            let target = app.buttons["Thingtime"].firstMatch
            let alternate = app.cells.containing(.staticText, identifier: "Thingtime").firstMatch
            if target.waitForExistence(timeout: 5) { target.tap() }
            else if alternate.exists { alternate.tap() }
            else if springboard.buttons["Thingtime"].exists { springboard.buttons["Thingtime"].tap() }
            else { XCTFail("Thingtime missing from real share sheet for \(kind): \(app.debugDescription)"); return }
            if kind == "slow" {
                XCTAssertTrue(app.staticTexts["Saving locally…"].waitForExistence(timeout: 3), app.debugDescription)
                let progress = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); progress.name = "saving-progress"; progress.lifetime = .keepAlways; add(progress)
            }
            let saved = app.staticTexts["Saved locally"]
            XCTAssertTrue(saved.waitForExistence(timeout: 30), "Save failed for \(kind): \(app.debugDescription)")
            if UIDevice.current.userInterfaceIdiom == .pad {
                XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "On My iPad")).firstMatch.exists, app.debugDescription)
            }
            let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            shot.name = "saved-\(kind)"; shot.lifetime = .keepAlways; add(shot)
            app.buttons["Done"].firstMatch.tap()
            let main = XCUIApplication(bundleIdentifier: "com.thingtime.appletime")
            main.launch()
            sleep(2)
            main.terminate()
            app.terminate()
        }
    }
}
