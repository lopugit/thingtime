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

    func testAvailableDestinationsIncludesProductionAndConfiguredVercelURL() {
        let destinations = ThingtimeWebDestination.availableDestinations(
            from: ["ThingtimeWebURL": "https://codex-add-ios-webview-shell.thingtime.vercel.app"]
        )

        XCTAssertEqual(destinations.map(\.title), ["Thingtime.com", "Configured Vercel deployment"])
        XCTAssertEqual(destinations.map(\.url.absoluteString), [
            "https://thingtime.com",
            "https://codex-add-ios-webview-shell.thingtime.vercel.app"
        ])
    }

    func testAvailableDestinationsDeduplicatesConfiguredProductionURL() {
        let destinations = ThingtimeWebDestination.availableDestinations(
            from: ["ThingtimeWebURL": "https://thingtime.com/"]
        )

        XCTAssertEqual(destinations.map(\.url.absoluteString), ["https://thingtime.com"])
    }

    func testCustomVercelDestinationAcceptsHostWithoutScheme() {
        let destination = ThingtimeWebDestination.customVercelDestination(
            from: "codex-add-ios-webview-shell.thingtime.vercel.app"
        )

        XCTAssertEqual(destination?.title, "Vercel deployment")
        XCTAssertEqual(
            destination?.url.absoluteString,
            "https://codex-add-ios-webview-shell.thingtime.vercel.app"
        )
    }

    func testCustomVercelDestinationRejectsNonVercelURL() {
        XCTAssertNil(ThingtimeWebDestination.customVercelDestination(from: "https://example.com"))
        XCTAssertNil(ThingtimeWebDestination.customVercelDestination(from: "http://thingtime.vercel.app"))
    }
}
