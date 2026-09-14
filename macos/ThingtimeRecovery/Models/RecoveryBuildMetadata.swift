import Foundation

public enum RecoveryProduct: String, CaseIterable, Identifiable {
    case electron
    case commander
    case widgets
    case recovery

    public var id: String { rawValue }
    public var title: String { self == .electron ? "Thingtime Electron" : component.title }
    public var component: RecoveryComponent {
        switch self {
        case .electron: .desktop
        case .commander: .commander
        case .widgets: .widgets
        case .recovery: .recovery
        }
    }
    public var systemImage: String {
        switch self {
        case .electron: "desktopcomputer"
        case .commander: "command"
        case .widgets: "rectangle.3.group"
        case .recovery: "cross.case.fill"
        }
    }
}

/// Read legacy bundles directly as well as new manifests. Never invent a build
/// number when an old bundle contains only a marketing version.
public struct RecoveryBuildMetadata {
    public let version: String?
    public let buildNumber: String?
    public let commit: String?
    public let branch: String?
    public let pullRequest: String?
    public let builtAt: Date?

    public init(bundleURL: URL? = nil, version: String? = nil, buildNumber: String? = nil, tag: String? = nil, commit: String? = nil, branch: String? = nil) {
        let info = bundleURL.flatMap { NSDictionary(contentsOf: $0.appendingPathComponent("Contents/Info.plist")) }
        let web = bundleURL.flatMap { try? Data(contentsOf: $0.appendingPathComponent("Contents/Resources/web/metadata.json")) }
            .flatMap { (try? JSONSerialization.jsonObject(with: $0)) as? [String: Any] }
        let desktopRelease = web?["desktopRelease"] as? [String: Any]
        self.version = version ?? info?["ThingtimeReleaseVersion"] as? String ?? desktopRelease?["version"] as? String ?? info?["CFBundleShortVersionString"] as? String
        let releaseTag = tag ?? info?["ThingtimeReleaseTag"] as? String ?? desktopRelease?["tag"] as? String
        let embeddedBuild = buildNumber ?? desktopRelease?["buildNumber"] as? String ?? info?["CFBundleVersion"] as? String
        // Older Electron bundles put the entire SemVer in CFBundleVersion.
        // Do not turn that unbounded string into a graphical build badge.
        self.buildNumber = Self.capture("(?:^|[.+-])build[.]([0-9]+)", in: releaseTag)
            ?? embeddedBuild.flatMap { $0.range(of: "^[0-9]{1,20}$", options: .regularExpression) != nil ? $0 : nil }
        self.commit = commit ?? info?["ThingtimeGitCommit"] as? String ?? Self.capture("(?:^|[.])g([a-f0-9]{7,40})(?:[.]|$)", in: releaseTag) ?? web?["gitCommit"] as? String
        self.pullRequest = Self.capture("(?:^|[.-])pr[.]([0-9]+)[.]", in: releaseTag)
        self.branch = branch ?? info?["ThingtimeGitBranch"] as? String ?? web?["gitBranch"] as? String
        self.builtAt = RecoveryBuildDate.parse(info?["ThingtimeBuildDate"] as? String)
            ?? RecoveryBuildDate.parse(web?["builtAt"] as? String)
    }

    public var shortCommit: String? { commit.map { String($0.prefix(12)) } }
    public var buildLabel: String { buildNumber.map { "Build \($0)" } ?? shortCommit.map { "Build \($0)" } ?? "Build ID unavailable" }

    private static func capture(_ pattern: String, in text: String?) -> String? {
        guard let text, let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              let range = Range(match.range(at: 1), in: text) else { return nil }
        return String(text[range])
    }
}

/// Release publication is a useful fallback, but never pretend a cache/copy
/// timestamp is when the app was built.
public enum RecoveryBuildDate: Equatable {
    case built(Date)
    case released(Date)
    case unavailable

    public var label: String {
        switch self {
        case .built(let date): "Built \(Self.format(date))"
        case .released(let date): "Released \(Self.format(date))"
        case .unavailable: "Build date unavailable"
        }
    }

    public static func parse(_ value: String?) -> Date? {
        guard let value else { return nil }
        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions.insert(.withFractionalSeconds)
        return formatter.date(from: value)
    }

    private static func format(_ date: Date) -> String {
        date.formatted(.dateTime.day().month(.abbreviated).year().hour().minute())
    }
}

public extension RecoveryRelease {
    var metadata: RecoveryBuildMetadata { RecoveryBuildMetadata(version: version, tag: tag, commit: commit, branch: branch) }
    var architectureLabel: String {
        if asset.name.contains("-macos-universal") { return "Universal" }
        return asset.name.contains("-macos-arm64") ? "Apple silicon" : "Intel"
    }
    var sizeLabel: String? { asset.size.map { ByteCountFormatter.string(fromByteCount: $0, countStyle: .file) } }
}
