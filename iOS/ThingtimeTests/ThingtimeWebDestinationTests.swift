import XCTest
@testable import Thingtime

final class ThingtimeWebDestinationTests: XCTestCase {
    func testHomeURLLoadsProductionThingtime() {
        XCTAssertEqual(ThingtimeWebDestination.home.absoluteString, "https://thingtime.com")
        XCTAssertEqual(ThingtimeWebDestination.home.scheme, "https")
        XCTAssertEqual(ThingtimeWebDestination.home.host, "thingtime.com")
    }

    func testConfiguredHTTPSURLCanOverrideHomeURL() {
        let url = ThingtimeWebDestination.url(
            from: ["ThingtimeWebURL": "https://codex-add-ios-webview-shell.thingtime.vercel.app"]
        )

        XCTAssertEqual(
            url?.absoluteString,
            "https://codex-add-ios-webview-shell.thingtime.vercel.app"
        )
    }

    func testInvalidConfiguredURLFallsBackToProduction() {
        XCTAssertNil(ThingtimeWebDestination.url(from: ["ThingtimeWebURL": "http://thingtime.com"]))
        XCTAssertNil(ThingtimeWebDestination.url(from: ["ThingtimeWebURL": "$(THINGTIME_WEB_URL)"]))
        XCTAssertNil(ThingtimeWebDestination.url(from: ["ThingtimeWebURL": ""]))
    }
}
