import Foundation

enum ThingtimeWebDestination {
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

    struct DeploymentsOverview: Decodable, Equatable {
        let deployments: [DeploymentSummary]
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

    static func url(from infoDictionary: [String: Any]?) -> URL? {
        guard let configuredURL = infoDictionary?["ThingtimeWebURL"] as? String else {
            return nil
        }

        let trimmedURL = configuredURL.trimmingCharacters(in: .whitespacesAndNewlines)

        guard
            !trimmedURL.isEmpty,
            !trimmedURL.hasPrefix("$("),
            let url = URL(string: trimmedURL),
            url.scheme == "https",
            url.host?.isEmpty == false
        else {
            return nil
        }

        return url
    }

    static func deploymentsAPIURL(limit: Int = 50) -> URL {
        var components = URLComponents(url: productionHome, resolvingAgainstBaseURL: false)!
        components.path = "/api/v1/vercel/deployments"
        components.queryItems = [
            URLQueryItem(name: "limit", value: String(limit))
        ]

        return components.url!
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

    private static func append(_ destination: Destination, to destinations: inout [Destination]) {
        guard !destinations.contains(where: { $0.id == destination.id }) else {
            return
        }

        destinations.append(destination)
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
