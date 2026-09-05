import Foundation

public enum RecoveryComponent: String, CaseIterable, Codable, Hashable, Identifiable {
    case desktop
    case recovery
    case commander

    public var id: String { rawValue }

    public var appName: String {
        switch self {
        case .desktop: "Thingtime.app"
        case .recovery: "Thingtime Recovery.app"
        case .commander: "Commander.app"
        }
    }

    public var bundleIdentifier: String {
        switch self {
        case .desktop: "com.thingtime.desktop"
        case .recovery: "com.thingtime.desktop.recovery"
        case .commander: "com.thingtime.Commander"
        }
    }

    public var title: String {
        switch self {
        case .desktop: "Thingtime Desktop"
        case .recovery: "Thingtime Recovery"
        case .commander: "Commander"
        }
    }
}

public struct CacheManifest: Codable, Equatable {
    public let format: Int
    public var entries: [CacheManifestEntry]

    public init(format: Int = 1, entries: [CacheManifestEntry] = []) {
        self.format = format
        self.entries = entries
    }
}

public struct CacheManifestEntry: Codable, Hashable, Identifiable {
    public let assetName: String?
    public let branch: String?
    public let buildNumber: String?
    public let cachedAt: String?
    public let commit: String?
    public let key: String
    public let name: String?
    public let pullRequestNumber: Int?
    public let releaseUrl: String?
    public let sourceSha256: String?
    public let tag: String?
    public let isUnsigned: Bool?
    public let version: String?

    public var id: String { key }
    public var cachedDate: Date? {
        guard let cachedAt else { return nil }
        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: cachedAt) { return date }
        formatter.formatOptions.insert(.withFractionalSeconds)
        return formatter.date(from: cachedAt)
    }

    public init(
        assetName: String? = nil,
        branch: String? = nil,
        buildNumber: String? = nil,
        cachedAt: String? = nil,
        commit: String? = nil,
        key: String,
        name: String? = nil,
        pullRequestNumber: Int? = nil,
        releaseUrl: String? = nil,
        sourceSha256: String? = nil,
        tag: String? = nil,
        isUnsigned: Bool? = nil,
        version: String? = nil
    ) {
        self.assetName = assetName
        self.branch = branch
        self.buildNumber = buildNumber
        self.cachedAt = cachedAt
        self.commit = commit
        self.key = key
        self.name = name
        self.pullRequestNumber = pullRequestNumber
        self.releaseUrl = releaseUrl
        self.sourceSha256 = sourceSha256
        self.tag = tag
        self.isUnsigned = isUnsigned
        self.version = version
    }
}

public struct CachedBundle: Hashable, Identifiable {
    public let entry: CacheManifestEntry
    public let appURL: URL
    public let component: RecoveryComponent

    public var id: String { "\(component.rawValue)-\(entry.key)" }
    public var displayName: String { "\(component.title) \(entry.version ?? metadata.version ?? "Unknown version")" }
    public var metadata: RecoveryBuildMetadata {
        RecoveryBuildMetadata(bundleURL: appURL, version: entry.version, buildNumber: entry.buildNumber, tag: entry.tag, commit: entry.commit, branch: entry.branch)
    }
}

/// The cache records the distribution lane explicitly. A missing value is the
/// legacy signed lane, so older cache manifests cannot silently downgrade a
/// signed release into the unsigned path.
public enum RecoveryBundleTrust: Hashable {
    case signed
    case unsigned
}

public struct RecoveryRelease: Hashable, Identifiable {
    public let asset: RecoveryReleaseAsset
    public let unavailableReason: String?
    public let id: String
    public let isPrerelease: Bool
    public let isUnsigned: Bool
    public let name: String
    public let publishedAt: Date?
    public let releaseURL: URL?
    public let tag: String
    public let version: String?
    public let branch: String?
    public let commit: String?

    public init(asset: RecoveryReleaseAsset, id: String, isPrerelease: Bool, isUnsigned: Bool = false, name: String, publishedAt: Date?, releaseURL: URL?, tag: String, version: String?, unavailableReason: String? = nil, branch: String? = nil, commit: String? = nil) {
        self.asset = asset
        self.branch = branch
        self.commit = commit
        self.unavailableReason = unavailableReason
        self.id = id
        self.isPrerelease = isPrerelease
        self.isUnsigned = isUnsigned
        self.name = name
        self.publishedAt = publishedAt
        self.releaseURL = releaseURL
        self.tag = tag
        self.version = version
    }
}

public struct RecoveryReleaseAsset: Hashable {
    public let downloadURL: URL
    public let name: String
    public let size: Int64?

    public init(downloadURL: URL, name: String, size: Int64?) {
        self.downloadURL = downloadURL
        self.name = name
        self.size = size
    }
}

public struct CacheReleaseDescriptor: Hashable {
    public let assetName: String?
    public let branch: String?
    public let commit: String?
    public let id: String
    public let name: String?
    public let pullRequestNumber: Int?
    public let releaseURL: String?
    public let tag: String
    public let isUnsigned: Bool
    public let version: String?

    public init(assetName: String? = nil, branch: String? = nil, commit: String? = nil, id: String, name: String? = nil, pullRequestNumber: Int? = nil, releaseURL: String? = nil, tag: String, isUnsigned: Bool = false, version: String? = nil) {
        self.assetName = assetName
        self.branch = branch
        self.commit = commit
        self.id = id
        self.name = name
        self.pullRequestNumber = pullRequestNumber
        self.releaseURL = releaseURL
        self.tag = tag
        self.isUnsigned = isUnsigned
        self.version = version
    }

    public init(release: RecoveryRelease) {
        self.init(
            assetName: release.asset.name,
            branch: release.branch,
            commit: release.commit,
            id: release.id,
            name: release.name,
            releaseURL: release.releaseURL?.absoluteString,
            tag: release.tag,
            isUnsigned: release.isUnsigned,
            version: release.version
        )
    }
}

public enum RecoveryError: LocalizedError {
    case invalidPath(String)
    case invalidPlan(String)
    case operationFailed(String)

    public var errorDescription: String? {
        switch self {
        case .invalidPath(let message), .invalidPlan(let message), .operationFailed(let message): message
        }
    }
}

public struct RecoveryCatalogSnapshot {
    public let publishedReleaseCount: Int
    public let desktop: [RecoveryRelease]
    public let recovery: [RecoveryRelease]
    public var commander: [RecoveryRelease] = []

    public func releases(for component: RecoveryComponent) -> [RecoveryRelease] {
        switch component {
        case .desktop: desktop
        case .recovery: recovery
        case .commander: commander
        }
    }
}

public struct RecoveryInstallNotice: Codable {
    public let message: String
    public let isError: Bool

    public init(message: String, isError: Bool) {
        self.message = message
        self.isError = isError
    }

    public func save(paths: RecoveryPaths = RecoveryPaths()) throws {
        try FileManager.default.createDirectory(at: paths.recoveryCacheRoot, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(self).write(to: paths.recoveryCacheRoot.appendingPathComponent("last-install-result.json"), options: .atomic)
    }

    public static func consume(paths: RecoveryPaths = RecoveryPaths()) -> RecoveryInstallNotice? {
        let url = paths.recoveryCacheRoot.appendingPathComponent("last-install-result.json")
        guard let data = try? Data(contentsOf: url), let notice = try? JSONDecoder().decode(Self.self, from: data) else { return nil }
        try? FileManager.default.removeItem(at: url)
        return notice
    }
}
