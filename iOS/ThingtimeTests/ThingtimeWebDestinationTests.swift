import XCTest
@testable import Thingtime

final class ThingtimeWebDestinationTests: XCTestCase {
    func testProductionDestinationLoadsProductionThingtime() {
        XCTAssertEqual(ThingtimeWebDestination.production.url.absoluteString, "https://thingtime.com")
        XCTAssertEqual(ThingtimeWebDestination.production.url.scheme, "https")
        XCTAssertEqual(ThingtimeWebDestination.production.url.host, "thingtime.com")
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

    func testStartupMigratesLegacyProductionSelectionToConfiguredBuildOrigin() {
        let destinations = ThingtimeWebDestination.availableDestinations(
            from: ["ThingtimeWebURL": "https://pr-596.previews.dev.thingtime.com"]
        )

        let selection = ThingtimeWebDestination.startupSelection(
            selectedDestinationID: ThingtimeWebDestination.production.id,
            lastConfiguredDestinationID: "",
            hasExplicitSelection: false,
            destinations: destinations
        )

        XCTAssertEqual(selection.selectedDestinationID, "https://pr-596.previews.dev.thingtime.com")
        XCTAssertEqual(selection.lastConfiguredDestinationID, selection.selectedDestinationID)
    }

    func testStartupPreservesExplicitProductionSelection() {
        let destinations = ThingtimeWebDestination.availableDestinations(
            from: ["ThingtimeWebURL": "https://pr-596.previews.dev.thingtime.com"]
        )

        let selection = ThingtimeWebDestination.startupSelection(
            selectedDestinationID: ThingtimeWebDestination.production.id,
            lastConfiguredDestinationID: "https://previous.preview.thingtime.com",
            hasExplicitSelection: true,
            destinations: destinations
        )

        XCTAssertEqual(selection.selectedDestinationID, ThingtimeWebDestination.production.id)
        XCTAssertEqual(selection.lastConfiguredDestinationID, "https://pr-596.previews.dev.thingtime.com")
    }

    func testStartupFollowsChangedConfiguredOriginWhenSelectionWasNotExplicit() {
        let destinations = ThingtimeWebDestination.availableDestinations(
            from: ["ThingtimeWebURL": "https://new.preview.thingtime.com"]
        )

        let selection = ThingtimeWebDestination.startupSelection(
            selectedDestinationID: "https://old.preview.thingtime.com",
            lastConfiguredDestinationID: "https://old.preview.thingtime.com",
            hasExplicitSelection: false,
            destinations: destinations
        )

        XCTAssertEqual(selection.selectedDestinationID, "https://new.preview.thingtime.com")
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
        let destinations = ThingtimeWebDestination.availableDestinations(from: nil, vercelDeployments: deployments)

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

    func testAvailableDestinationsPreservesLongUniqueDeploymentLists() {
        let deployments = (0..<50).map { index in
            ThingtimeWebDestination.DeploymentSummary(
                branch: "feature/preview-\(index)",
                commitSha: nil,
                createdAt: nil,
                dashboardUrl: nil,
                environment: "preview",
                id: "dpl_\(index)",
                readyAt: nil,
                readyLabel: nil,
                state: "ready",
                url: "https://thingtime-preview-\(index)-lopugits-projects.vercel.app"
            )
        }

        let destinations = ThingtimeWebDestination.availableDestinations(from: nil, vercelDeployments: deployments)

        XCTAssertEqual(destinations.count, 51)
        XCTAssertEqual(destinations.first, ThingtimeWebDestination.production)
        XCTAssertEqual(destinations.last?.title, "feature/preview-49")
        XCTAssertEqual(Set(destinations.map(\.id)).count, destinations.count)
    }

    func testDeploymentSectionsExposeLastSuccessfulDeploymentAfterQueuedLatest() {
        let queued = ThingtimeWebDestination.DeploymentSummary(
            branch: "codex/ios-drawer-camera-crash",
            commitSha: "queued123456789",
            createdAt: "2026-08-18T03:00:00.000Z",
            dashboardUrl: nil,
            environment: "preview",
            id: "dpl_queued",
            readyAt: nil,
            readyLabel: "just now",
            state: "queued",
            url: "https://thingtime-queued-lopugits-projects.vercel.app"
        )
        let ready = ThingtimeWebDestination.DeploymentSummary(
            branch: "codex/ios-drawer-camera-crash",
            commitSha: "ready123456789",
            createdAt: "2026-08-18T02:00:00.000Z",
            dashboardUrl: nil,
            environment: "preview",
            id: "dpl_ready",
            readyAt: "2026-08-18T02:02:00.000Z",
            readyLabel: "1h",
            state: "ready",
            url: "https://thingtime-ready-lopugits-projects.vercel.app"
        )
        let group = ThingtimeWebDestination.DeploymentGroup(
            branch: "codex/ios-drawer-camera-crash",
            deployments: [queued, ready],
            id: "codex/ios-drawer-camera-crash"
        )

        let section = ThingtimeWebDestination.deploymentSections(from: [group]).first

        XCTAssertEqual(section?.deployments.map(\.deployment.id), ["dpl_queued", "dpl_ready"])
        XCTAssertEqual(section?.latestDeployment?.deployment.state, "queued")
        XCTAssertEqual(
            section?.latestSuccessfulDeploymentID,
            "https://thingtime-ready-lopugits-projects.vercel.app"
        )
    }

    func testDeploymentOverviewFallsBackToGroupingLegacyLatestOnlyResponse() {
        let deployments = [
            ThingtimeWebDestination.DeploymentSummary(
                branch: "feature/one",
                commitSha: nil,
                createdAt: nil,
                dashboardUrl: nil,
                environment: "preview",
                id: "dpl_one",
                readyAt: nil,
                readyLabel: nil,
                state: "ready",
                url: "https://thingtime-one-lopugits-projects.vercel.app"
            ),
            ThingtimeWebDestination.DeploymentSummary(
                branch: "feature/two",
                commitSha: nil,
                createdAt: nil,
                dashboardUrl: nil,
                environment: "preview",
                id: "dpl_two",
                readyAt: nil,
                readyLabel: nil,
                state: "ready",
                url: "https://thingtime-two-lopugits-projects.vercel.app"
            )
        ]
        let overview = ThingtimeWebDestination.DeploymentsOverview(
            deploymentGroups: nil,
            deployments: deployments
        )

        XCTAssertEqual(overview.resolvedDeploymentGroups.map(\.branch), ["feature/one", "feature/two"])
        XCTAssertEqual(overview.resolvedDeploymentGroups.map(\.deployments.count), [1, 1])
    }

    func testDeploymentOverviewDecodesNestedHistory() throws {
        let data = Data(
            #"""
            {
              "deployments": [
                {
                  "branch": "feature/history",
                  "id": "dpl_queued",
                  "state": "queued",
                  "url": "https://thingtime-queued-lopugits-projects.vercel.app"
                }
              ],
              "deploymentGroups": [
                {
                  "branch": "feature/history",
                  "id": "feature/history",
                  "deployments": [
                    {
                      "branch": "feature/history",
                      "id": "dpl_queued",
                      "state": "queued",
                      "url": "https://thingtime-queued-lopugits-projects.vercel.app"
                    },
                    {
                      "branch": "feature/history",
                      "id": "dpl_ready",
                      "state": "ready",
                      "url": "https://thingtime-ready-lopugits-projects.vercel.app"
                    }
                  ]
                }
              ]
            }
            """#.utf8
        )

        let overview = try JSONDecoder().decode(
            ThingtimeWebDestination.DeploymentsOverview.self,
            from: data
        )

        XCTAssertEqual(overview.resolvedDeploymentGroups.count, 1)
        XCTAssertTrue(overview.supportsDeploymentHistory)
        XCTAssertEqual(
            overview.resolvedDeploymentGroups.first?.deployments.map(\.state),
            ["queued", "ready"]
        )
    }

    func testTokenlessPreviewHistoryFallsBackToAConfiguredAPI() {
        let overview = ThingtimeWebDestination.DeploymentsOverview(
            deploymentGroups: [],
            deployments: [],
            configured: false,
            hasError: false,
            source: "tokenless"
        )

        XCTAssertFalse(overview.supportsDeploymentHistory)
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
            ThingtimeWebDestination.deploymentsAPIURL(from: nil, limit: 5).absoluteString,
            "https://thingtime.com/api/v1/vercel/deployments?limit=5&history=10"
        )
    }

    func testDeploymentsAPIURLUsesConfiguredPreviewOrigin() {
        XCTAssertEqual(
            ThingtimeWebDestination.deploymentsAPIURL(
                from: [
                    "ThingtimeWebURL": "https://thingtime-feature-history-lopugits-projects.vercel.app/feed"
                ],
                limit: 5,
                historyLimit: 3
            ).absoluteString,
            "https://thingtime-feature-history-lopugits-projects.vercel.app/api/v1/vercel/deployments?limit=5&history=3"
        )
    }

    func testDeploymentsAPIURLsFallBackFromConfiguredPreviewToProduction() {
        XCTAssertEqual(
            ThingtimeWebDestination.deploymentsAPIURLs(
                from: [
                    "ThingtimeWebURL": "https://thingtime-feature-history-lopugits-projects.vercel.app"
                ],
                limit: 5,
                historyLimit: 3
            ).map(\.absoluteString),
            [
                "https://thingtime-feature-history-lopugits-projects.vercel.app/api/v1/vercel/deployments?limit=5&history=3",
                "https://thingtime.com/api/v1/vercel/deployments?limit=5&history=3"
            ]
        )
    }
}
