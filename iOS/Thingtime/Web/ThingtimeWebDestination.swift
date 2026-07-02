import Foundation

enum ThingtimeWebDestination {
    private static let productionHome = URL(string: "https://thingtime.com")!

    static var home: URL {
        url(from: Bundle.main.infoDictionary) ?? productionHome
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
}
