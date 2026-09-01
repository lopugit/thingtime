import Foundation

public actor GitHubReleaseCatalog {
    typealias PageRequest = (URL) async throws -> (Data, HTTPURLResponse)

    private let endpoint: URL
    private let maximumArchiveBytes: Int64 = 5 * 1024 * 1024 * 1024
    private let requestPage: PageRequest

    public init() {
        endpoint = URL(string: "https://api.github.com/repos/lopugit/thingtime/releases?per_page=100")!
        requestPage = { url in
            var request = URLRequest(url: url)
            request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
            request.setValue("Thingtime-Recovery", forHTTPHeaderField: "User-Agent")
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw RecoveryError.operationFailed("GitHub releases are temporarily unavailable.")
            }
            return (data, http)
        }
    }

    init(endpoint: URL, requestPage: @escaping PageRequest) {
        self.endpoint = endpoint
        self.requestPage = requestPage
    }

    public func fetch(component: RecoveryComponent) async throws -> [RecoveryRelease] {
        var url: URL? = endpoint
        var visitedURLs = Set<URL>()
        var collected: [GitHubRelease] = []
        while let pageURL = url {
            guard pageURL.scheme == "https", pageURL.host == "api.github.com" else {
                throw RecoveryError.operationFailed("Thingtime Recovery rejected a non-GitHub release catalog URL.")
            }
            guard visitedURLs.insert(pageURL).inserted else {
                throw RecoveryError.operationFailed("Thingtime Recovery detected a loop in GitHub's release catalog pagination.")
            }
            let (data, http) = try await requestPage(pageURL)
            collected += try JSONDecoder().decode([GitHubRelease].self, from: data)
            url = nextPage(from: http.value(forHTTPHeaderField: "Link"))
        }
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
                version: semanticVersion(in: tag)
            )
        }.sorted {
            ($0.publishedAt ?? .distantPast) > ($1.publishedAt ?? .distantPast)
        }
    }

    public func download(_ asset: RecoveryReleaseAsset, into directory: URL) async throws -> URL {
        guard asset.name.lowercased().hasSuffix(".zip"), isAllowedAssetURL(asset.downloadURL) else {
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
                guard name.hasPrefix(prefix), name.lowercased().hasSuffix(".zip") else { return nil }
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
    let draft: Bool?
    let htmlURL: String?
    let id: Int?
    let name: String?
    let prerelease: Bool?
    let publishedAt: String?
    let tagName: String?

    enum CodingKeys: String, CodingKey {
        case assets, draft, id, name, prerelease
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
