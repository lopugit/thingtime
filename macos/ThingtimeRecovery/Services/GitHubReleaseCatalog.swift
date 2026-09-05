import Foundation

public actor GitHubReleaseCatalog {
    typealias PageRequest = (URL) async throws -> (Data, HTTPURLResponse)

    private let architecture: String
    private let endpoint: URL
    private let maximumArchiveBytes: Int64 = 5 * 1024 * 1024 * 1024
    private let requestPage: PageRequest

    public init() {
        #if arch(arm64)
        architecture = "arm64"
        #else
        architecture = "x64"
        #endif
        endpoint = URL(string: "https://api.github.com/repos/lopugit/thingtime/releases?per_page=100")!
        requestPage = { url in
            var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
            request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
            request.setValue("Thingtime-Recovery", forHTTPHeaderField: "User-Agent")
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw RecoveryError.operationFailed("GitHub releases are temporarily unavailable.")
            }
            return (data, http)
        }
    }

    init(endpoint: URL, architecture: String = "arm64", requestPage: @escaping PageRequest) {
        self.architecture = architecture
        self.endpoint = endpoint
        self.requestPage = requestPage
    }

    public func fetch(component: RecoveryComponent) async throws -> [RecoveryRelease] {
        let snapshot = try await fetchAll()
        return component == .desktop ? snapshot.desktop : snapshot.recovery
    }

    public func fetchAll() async throws -> RecoveryCatalogSnapshot {
        var url: URL? = endpoint
        var visitedURLs = Set<URL>()
        var collected: [GitHubRelease] = []
        while let pageURL = url {
            guard pageURL.scheme == "https", pageURL.host == "api.github.com", pageURL.path == endpoint.path, pageURL.user == nil, pageURL.password == nil else {
                throw RecoveryError.operationFailed("Thingtime Recovery rejected a non-GitHub release catalog URL.")
            }
            guard visitedURLs.insert(pageURL).inserted else {
                throw RecoveryError.operationFailed("Thingtime Recovery detected a loop in GitHub's release catalog pagination.")
            }
            let (data, http) = try await requestPage(pageURL)
            guard (200..<300).contains(http.statusCode) else {
                if http.statusCode == 403 || http.statusCode == 429 {
                    throw RecoveryError.operationFailed("GitHub is limiting release requests. Try refreshing later.")
                }
                throw RecoveryError.operationFailed("GitHub releases are unavailable (HTTP \(http.statusCode)).")
            }
            collected += try JSONDecoder().decode([GitHubRelease].self, from: data)
            url = nextPage(from: http.value(forHTTPHeaderField: "Link"))
        }
        var seen = Set<String>()
        let releases = collected.filter { release in
            guard release.draft != true, let key = release.id.map(String.init) ?? release.tagName else { return false }
            return seen.insert(key).inserted
        }
        return RecoveryCatalogSnapshot(publishedReleaseCount: releases.count, desktop: project(releases, component: .desktop), recovery: project(releases, component: .recovery))
    }

    private func project(_ collected: [GitHubRelease], component: RecoveryComponent) -> [RecoveryRelease] {
        return collected.compactMap { release -> RecoveryRelease? in
            guard release.draft != true, let tag = release.tagName ?? release.name, !tag.isEmpty else { return nil }
            let isUnsigned = tag.hasSuffix(".unsigned")
            guard let asset = selectAsset(release.assets, component: component, isUnsigned: isUnsigned) else { return nil }
            return RecoveryRelease(
                asset: asset,
                id: release.id.map(String.init) ?? tag,
                isPrerelease: release.prerelease == true,
                isUnsigned: isUnsigned,
                name: release.name ?? tag,
                publishedAt: release.publishedAt.flatMap(ISO8601DateFormatter().date(from:)),
                releaseURL: release.htmlURL.flatMap(URL.init(string:)),
                tag: tag,
                version: semanticVersion(in: tag),
                unavailableReason: unavailableReason(release, component: component)
            )
        }.sorted {
            ($0.publishedAt ?? .distantPast) > ($1.publishedAt ?? .distantPast)
        }
    }

    public func download(_ asset: RecoveryReleaseAsset, into directory: URL) async throws -> URL {
        guard asset.name.lowercased().hasSuffix(".zip"), asset.name == (asset.name as NSString).lastPathComponent, isAllowedAssetURL(asset.downloadURL) else {
            throw RecoveryError.invalidPath("Thingtime Recovery accepts only GitHub-hosted macOS ZIP release assets.")
        }
        if let size = asset.size, size > maximumArchiveBytes {
            throw RecoveryError.operationFailed("That release archive is larger than the recovery cache permits.")
        }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let (temporaryURL, response) = try await URLSession.shared.download(from: asset.downloadURL)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw RecoveryError.operationFailed("The GitHub release archive could not be downloaded.")
        }
        let values = try temporaryURL.resourceValues(forKeys: [.fileSizeKey])
        let actualSize = Int64(values.fileSize ?? 0)
        guard actualSize <= maximumArchiveBytes, asset.size == nil || asset.size == actualSize else {
            throw RecoveryError.operationFailed("The downloaded release archive did not match GitHub's expected size.")
        }
        let destination = directory.appendingPathComponent("\(UUID().uuidString)-\(asset.name)")
        try FileManager.default.moveItem(at: temporaryURL, to: destination)
        return destination
    }

    private func unavailableReason(_ release: GitHubRelease, component: RecoveryComponent) -> String? {
        let marker = "<!-- thingtime-recovery-unavailable:v1:\(component.rawValue):missing-resource-seal -->"
        guard release.body?.components(separatedBy: .newlines).contains(where: { $0.trimmingCharacters(in: .whitespaces) == marker }) == true else { return nil }
        return "This older release was published with a damaged app archive and has been withdrawn from installation. Choose a newer release in the sidebar or use a cached version."
    }

    private func selectAsset(_ assets: [GitHubAsset]?, component: RecoveryComponent, isUnsigned: Bool) -> RecoveryReleaseAsset? {
        (assets ?? [])
            .compactMap { asset -> RecoveryReleaseAsset? in
                guard let name = asset.name, let rawURL = asset.browserDownloadURL, let url = URL(string: rawURL), isAllowedAssetURL(url) else { return nil }
                let prefix: String
                if component == .desktop {
                    prefix = isUnsigned ? "Thingtime-Electron-App-UNSIGNED-Release-" : "Thingtime-Electron-App-Release-"
                } else {
                    prefix = isUnsigned ? "Thingtime-Recovery-App-UNSIGNED-Release-" : "Thingtime-Recovery-App-Release-"
                }
                guard name.hasPrefix(prefix), name.lowercased().hasSuffix(".zip"), name == (name as NSString).lastPathComponent else { return nil }
                let pattern = "-macos-(arm64|x64|x86_64|universal)(?:-[0-9]+)?\\.zip$"
                guard let range = name.range(of: pattern, options: .regularExpression) else { return nil }
                let suffix = String(name[range])
                let compatible = suffix.hasPrefix("-macos-universal") || suffix.hasPrefix("-macos-\(architecture)-") || suffix.hasPrefix("-macos-\(architecture).") || (architecture == "x64" && suffix.hasPrefix("-macos-x86_64"))
                guard compatible else { return nil }
                return RecoveryReleaseAsset(downloadURL: url, name: name, size: asset.size)
            }
            .sorted { $0.name < $1.name }
            .first
    }

    private func isAllowedAssetURL(_ url: URL) -> Bool {
        guard url.scheme == "https", url.host == "github.com" else { return false }
        return url.path.hasPrefix("/lopugit/thingtime/releases/download/")
    }

    private func nextPage(from header: String?) -> URL? {
        guard let header else { return nil }
        for segment in header.split(separator: ",") {
            let value = String(segment)
            guard value.contains("rel=\"next\"") else { continue }
            guard let start = value.firstIndex(of: "<"), let end = value.firstIndex(of: ">") else { continue }
            return URL(string: String(value[value.index(after: start)..<end]))
        }
        return nil
    }

    private func semanticVersion(in value: String) -> String? {
        let pattern = "[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?"
        return value.range(of: pattern, options: .regularExpression).map { String(value[$0]) }
    }
}

private struct GitHubRelease: Decodable {
    let assets: [GitHubAsset]?
    let body: String?
    let draft: Bool?
    let htmlURL: String?
    let id: Int?
    let name: String?
    let prerelease: Bool?
    let publishedAt: String?
    let tagName: String?

    enum CodingKeys: String, CodingKey {
        case assets, body, draft, id, name, prerelease
        case htmlURL = "html_url"
        case publishedAt = "published_at"
        case tagName = "tag_name"
    }
}

private struct GitHubAsset: Decodable {
    let browserDownloadURL: String?
    let name: String?
    let size: Int64?

    enum CodingKeys: String, CodingKey {
        case name, size
        case browserDownloadURL = "browser_download_url"
    }
}
