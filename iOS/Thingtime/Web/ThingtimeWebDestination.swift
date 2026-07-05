import Foundation

enum ThingtimeWebDestination {
    struct Destination: Identifiable, Equatable {
        enum Source: Equatable {
            case production
            case configured
            case customVercel
        }

        let id: String
        let title: String
        let subtitle: String
        let url: URL
        let source: Source
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
        customDeploymentURLString: String? = nil
    ) -> [Destination] {
        var destinations = [production]

        if let configuredDestination = configuredDestination(from: infoDictionary) {
            append(configuredDestination, to: &destinations)
        }

        if let customDestination = customVercelDestination(from: customDeploymentURLString) {
            append(customDestination, to: &destinations)
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

    static func customVercelDestination(from rawURL: String?) -> Destination? {
        guard let url = customVercelURL(from: rawURL) else {
            return nil
        }

        return Destination(
            id: normalizedIdentifier(for: url),
            title: "Vercel deployment",
            subtitle: url.host ?? url.absoluteString,
            url: url,
            source: .customVercel
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

    private static func customVercelURL(from rawURL: String?) -> URL? {
        guard let rawURL else {
            return nil
        }

        let trimmedURL = rawURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedURL.isEmpty else {
            return nil
        }

        let candidateURL = trimmedURL.contains("://") ? trimmedURL : "https://\(trimmedURL)"

        guard
            let url = url(from: ["ThingtimeWebURL": candidateURL]),
            isVercelDeployment(url)
        else {
            return nil
        }

        return url
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
}
