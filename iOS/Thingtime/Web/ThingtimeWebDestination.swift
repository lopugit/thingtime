import Foundation

enum ThingtimeWebDestination {
    struct StartupSelection: Equatable {
        let selectedDestinationID: String
        let lastConfiguredDestinationID: String
    }

    struct Destination: Identifiable, Equatable {
        enum Source: Equatable {
            case production
            case configured
            case vercelDeployment
        }

        let id: String
        let title: String
        let subtitle: String
        let url: URL
        let source: Source
    }

    struct DeploymentSummary: Decodable, Equatable {
        let branch: String?
        let commitSha: String?
        let createdAt: String?
        let dashboardUrl: String?
        let environment: String?
        let id: String?
        let readyAt: String?
        let readyLabel: String?
        let state: String
        let url: String
    }

    struct DeploymentGroup: Decodable, Equatable, Identifiable {
        let branch: String?
        let deployments: [DeploymentSummary]
        let id: String
    }

    struct DeploymentOption: Equatable, Identifiable {
        let deployment: DeploymentSummary
        let destination: Destination

        var id: String {
            destination.id
        }
    }

    struct DeploymentSection: Equatable, Identifiable {
        let deployments: [DeploymentOption]
        let id: String
        let title: String

        var latestDeployment: DeploymentOption? {
            deployments.first
        }

        var latestSuccessfulDeploymentID: String? {
            deployments.first(where: { $0.deployment.state.lowercased() == "ready" })?.id
        }
    }

    struct DeploymentsOverview: Decodable, Equatable {
        let configured: Bool?
        let deploymentGroups: [DeploymentGroup]?
        let deployments: [DeploymentSummary]
        let hasError: Bool?
        let source: String?

        init(
            deploymentGroups: [DeploymentGroup]?,
            deployments: [DeploymentSummary],
            configured: Bool? = nil,
            hasError: Bool? = nil,
            source: String? = nil
        ) {
            self.configured = configured
            self.deploymentGroups = deploymentGroups
            self.deployments = deployments
            self.hasError = hasError
            self.source = source
        }

        var resolvedDeploymentGroups: [DeploymentGroup] {
            guard let deploymentGroups, !deploymentGroups.isEmpty else {
                return ThingtimeWebDestination.deploymentGroups(from: deployments)
            }

            return deploymentGroups
        }

        var supportsDeploymentHistory: Bool {
            deploymentGroups != nil && configured != false && hasError != true
        }

        var fallbackDeploymentCount: Int {
            resolvedDeploymentGroups.reduce(0) { count, group in
                count + group.deployments.count
            }
        }
    }

    private static let productionHome = URL(string: "https://thingtime.com")!

    static let production = Destination(
        id: normalizedIdentifier(for: productionHome),
        title: "Thingtime.com",
        subtitle: productionHome.absoluteString,
        url: productionHome,
        source: .production
    )

    static var home: URL {
        defaultDestination.url
    }

    static var defaultDestination: Destination {
        configuredDestination(from: Bundle.main.infoDictionary) ?? production
    }

    static var defaultDestinationID: String {
        defaultDestination.id
    }

    static func availableDestinations(
        from infoDictionary: [String: Any]? = Bundle.main.infoDictionary,
        vercelDeployments: [DeploymentSummary] = []
    ) -> [Destination] {
        var destinations = [production]

        if let configuredDestination = configuredDestination(from: infoDictionary) {
            append(configuredDestination, to: &destinations)
        }

        for deployment in vercelDeployments {
            if let destination = vercelDeploymentDestination(from: deployment) {
                append(destination, to: &destinations)
            }
        }

        return destinations
    }

    static func startupSelection(
        selectedDestinationID: String,
        lastConfiguredDestinationID: String,
        hasExplicitSelection: Bool,
        destinations: [Destination]
    ) -> StartupSelection {
        let configured = destinations.first(where: { $0.source == .configured })
        let fallback = configured ?? destinations.first ?? production
        let selected = destinations.first(where: { $0.id == selectedDestinationID }) ?? fallback

        guard let configured else {
            return StartupSelection(
                selectedDestinationID: selected.id,
                lastConfiguredDestinationID: ""
            )
        }

        let followsBuildConfiguration = !hasExplicitSelection
            || selectedDestinationID == lastConfiguredDestinationID
            || (lastConfiguredDestinationID.isEmpty && selectedDestinationID == production.id)

        return StartupSelection(
            selectedDestinationID: followsBuildConfiguration ? configured.id : selected.id,
            lastConfiguredDestinationID: configured.id
        )
    }

    static func url(from infoDictionary: [String: Any]?) -> URL? {
        guard let configuredURL = infoDictionary?["ThingtimeWebURL"] as? String else {
            return nil
        }

        let trimmedURL = configuredURL.trimmingCharacters(in: .whitespacesAndNewlines)

        guard
            !trimmedURL.isEmpty,
            !trimmedURL.hasPrefix("$("),
            let url = URL(string: trimmedURL),
            isAllowedConfiguredURL(url)
        else {
            return nil
        }

        return url
    }

    static func deploymentsAPIURL(
        from infoDictionary: [String: Any]? = Bundle.main.infoDictionary,
        limit: Int = 50,
        historyLimit: Int = 10
    ) -> URL {
        let apiHome = url(from: infoDictionary) ?? productionHome
        var components = URLComponents(url: apiHome, resolvingAgainstBaseURL: false)!
        components.path = "/api/v1/vercel/deployments"
        components.queryItems = [
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "history", value: String(historyLimit))
        ]

        return components.url!
    }

    static func deploymentsAPIURLs(
        from infoDictionary: [String: Any]? = Bundle.main.infoDictionary,
        limit: Int = 50,
        historyLimit: Int = 10
    ) -> [URL] {
        let configuredURL = deploymentsAPIURL(
            from: infoDictionary,
            limit: limit,
            historyLimit: historyLimit
        )
        let productionURL = deploymentsAPIURL(
            from: nil,
            limit: limit,
            historyLimit: historyLimit
        )

        return configuredURL == productionURL ? [productionURL] : [configuredURL, productionURL]
    }

    static func deploymentGroups(from deployments: [DeploymentSummary]) -> [DeploymentGroup] {
        var groups: [DeploymentGroup] = []
        var groupIndexes: [String: Int] = [:]
        var seenDestinations = Set<String>()

        for deployment in deployments {
            guard let destination = vercelDeploymentDestination(from: deployment) else {
                continue
            }

            guard seenDestinations.insert(destination.id).inserted else {
                continue
            }

            let groupID = deploymentGroupIdentifier(for: deployment)

            if let index = groupIndexes[groupID] {
                let group = groups[index]
                groups[index] = DeploymentGroup(
                    branch: group.branch,
                    deployments: group.deployments + [deployment],
                    id: group.id
                )
            } else {
                groupIndexes[groupID] = groups.count
                groups.append(
                    DeploymentGroup(
                        branch: nonEmpty(deployment.branch),
                        deployments: [deployment],
                        id: groupID
                    )
                )
            }
        }

        return groups
    }

    static func deploymentSections(
        from groups: [DeploymentGroup],
        excludingDestinationIDs: Set<String> = []
    ) -> [DeploymentSection] {
        groups.compactMap { group in
            var seenDestinations = Set<String>()
            let options = group.deployments.compactMap { deployment -> DeploymentOption? in
                guard let destination = vercelDeploymentDestination(from: deployment) else {
                    return nil
                }

                guard !excludingDestinationIDs.contains(destination.id) else {
                    return nil
                }

                guard seenDestinations.insert(destination.id).inserted else {
                    return nil
                }

                return DeploymentOption(deployment: deployment, destination: destination)
            }

            guard !options.isEmpty else {
                return nil
            }

            return DeploymentSection(
                deployments: options,
                id: group.id,
                title: nonEmpty(group.branch) ?? nonEmpty(options.first?.deployment.branch) ?? "Vercel deployment"
            )
        }
    }

    static func vercelDeploymentDestination(from deployment: DeploymentSummary) -> Destination? {
        guard
            let url = validatedHTTPSURL(from: deployment.url)
        else {
            return nil
        }

        let title = nonEmpty(deployment.branch) ?? "Vercel deployment"
        let subtitle = [
            deployment.state,
            nonEmpty(deployment.readyLabel),
            url.host
        ]
            .compactMap(nonEmpty)
            .joined(separator: " - ")

        return Destination(
            id: normalizedIdentifier(for: url),
            title: title,
            subtitle: subtitle.isEmpty ? url.absoluteString : subtitle,
            url: url,
            source: .vercelDeployment
        )
    }

    private static func configuredDestination(from infoDictionary: [String: Any]?) -> Destination? {
        guard let url = url(from: infoDictionary) else {
            return nil
        }

        let destination = Destination(
            id: normalizedIdentifier(for: url),
            title: isVercelDeployment(url) ? "Configured Vercel deployment" : "Configured URL",
            subtitle: url.host ?? url.absoluteString,
            url: url,
            source: .configured
        )

        return destination.id == production.id ? production : destination
    }

    private static func isVercelDeployment(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else {
            return false
        }

        return host == "vercel.app" || host.hasSuffix(".vercel.app")
    }

    private static func isAllowedConfiguredURL(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased(), !host.isEmpty else {
            return false
        }

        if scheme == "https" {
            return true
        }

        #if DEBUG
        if scheme == "http", ["localhost", "127.0.0.1", "::1"].contains(host) {
            return true
        }
        #endif

        return false
    }

    private static func append(_ destination: Destination, to destinations: inout [Destination]) {
        guard !destinations.contains(where: { $0.id == destination.id }) else {
            return
        }

        destinations.append(destination)
    }

    private static func deploymentGroupIdentifier(for deployment: DeploymentSummary) -> String {
        if let branch = nonEmpty(deployment.branch)?.lowercased() {
            return branch
        }

        if let url = validatedHTTPSURL(from: deployment.url) {
            return "url:\(normalizedIdentifier(for: url))"
        }

        return "deployment:\(deployment.id ?? deployment.url)"
    }

    private static func normalizedIdentifier(for url: URL) -> String {
        let absoluteString: String

        if var components = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            let scheme = components.scheme?.lowercased()
            let host = components.host?.lowercased()
            components.scheme = scheme
            components.host = host
            absoluteString = components.url?.absoluteString ?? url.absoluteString
        } else {
            absoluteString = url.absoluteString
        }

        if absoluteString.hasSuffix("/") {
            return String(absoluteString.dropLast())
        }

        return absoluteString
    }

    private static func validatedHTTPSURL(from rawURL: String) -> URL? {
        let trimmedURL = rawURL.trimmingCharacters(in: .whitespacesAndNewlines)

        guard
            !trimmedURL.isEmpty,
            let url = URL(string: trimmedURL),
            url.scheme == "https",
            url.host?.isEmpty == false
        else {
            return nil
        }

        return url
    }

    private static func nonEmpty(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines)

        guard let trimmed, !trimmed.isEmpty else {
            return nil
        }

        return trimmed
    }
}
