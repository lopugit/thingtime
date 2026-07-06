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

    func testConfiguredLoopbackHTTPURLCanOverrideHomeURLInDebugBuilds() {
        let url = ThingtimeWebDestination.url(
            from: ["ThingtimeWebURL": "http://127.0.0.1:9999"]
        )

        #if DEBUG
        XCTAssertEqual(url?.absoluteString, "http://127.0.0.1:9999")
        #else
        XCTAssertNil(url)
        #endif
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

    func testAvailableDestinationsIncludesVercelDeploymentsFromAPI() {
        let deployments = [
            ThingtimeWebDestination.DeploymentSummary(
                branch: "codex/ios-deployment-url-picker",
                commitSha: "37bbec3",
                createdAt: "2026-07-05T09:22:27.000Z",
                dashboardUrl: nil,
                environment: "preview",
                id: "dpl_123",
                readyAt: "2026-07-05T09:23:28.000Z",
                readyLabel: "just now",
                state: "ready",
                url: "https://thingtime-git-codex-ios-deployment-url-picker-lopugits-projects.vercel.app"
            )
        ]
        let destinations = ThingtimeWebDestination.availableDestinations(vercelDeployments: deployments)

        XCTAssertEqual(
            destinations.map(\.url.absoluteString),
            [
                "https://thingtime.com",
                "https://thingtime-git-codex-ios-deployment-url-picker-lopugits-projects.vercel.app"
            ]
        )
        XCTAssertEqual(destinations.last?.title, "codex/ios-deployment-url-picker")
        XCTAssertEqual(destinations.last?.subtitle, "ready - just now - thingtime-git-codex-ios-deployment-url-picker-lopugits-projects.vercel.app")
    }

    func testVercelDeploymentDestinationRejectsInvalidAPIURLs() {
        let deployment = ThingtimeWebDestination.DeploymentSummary(
            branch: "main",
            commitSha: nil,
            createdAt: nil,
            dashboardUrl: nil,
            environment: nil,
            id: nil,
            readyAt: nil,
            readyLabel: nil,
            state: "ready",
            url: "http://thingtime.vercel.app"
        )

        XCTAssertNil(ThingtimeWebDestination.vercelDeploymentDestination(from: deployment))
    }

    func testDeploymentsAPIURLTargetsThingtimeDeploymentsEndpoint() {
        XCTAssertEqual(
            ThingtimeWebDestination.deploymentsAPIURL(limit: 5).absoluteString,
            "https://thingtime.com/api/v1/vercel/deployments?limit=5"
        )
    }
}
