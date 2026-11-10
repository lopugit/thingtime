import CryptoKit
import Darwin
import Foundation

/// Reads integration data from verified Recovery releases. Downloaded code is
/// never launched and the installed app is never replaced by this service.
public struct AIIntegrationUpdateSource {
    public let homeDirectory: URL
    public let installedApp: URL
    private var root: URL { homeDirectory.appendingPathComponent("Library/Caches/com.thingtime.desktop.recovery/ai-integration-updates") }
    private var stateURL: URL { root.appendingPathComponent("selection.json") }
    private struct Selection: Codable {
        var checkedAt: Date?
        var publishedAt: Date?
        var releaseID: String?
        var appPath: String?
        var pluginVersion: String?
        var selectedAsset: String?
        var noPayloadAsset: String?
    }

    public init(homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser, installedApp: URL? = nil) {
        self.homeDirectory = homeDirectory.standardizedFileURL
        self.installedApp = (installedApp ?? homeDirectory.appendingPathComponent("Applications/Thingtime Recovery.app")).standardizedFileURL
    }

    public func currentBundle() throws -> URL? {
        let selection = try load()
        guard selection.appPath != nil else { return nil }
        let context = try productionContext()
        return try selectedBundle(selection, context: context)
    }

    public func refresh() async throws -> URL? {
        let context = try productionContext()
        try prepareRoot()
        let lockURL = root.appendingPathComponent("refresh.lock")
        try Self.validatePath(lockURL, beneath: homeDirectory)
        let descriptor = open(lockURL.path, O_CREAT | O_RDWR | O_NOFOLLOW, 0o600)
        guard descriptor >= 0 else { throw failure("Cannot open the integration update lock.") }
        defer { _ = flock(descriptor, LOCK_UN); close(descriptor) }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else { throw failure("An integration update check is already running.") }
        var selection = try load()
        if !Self.shouldRefresh(lastCheck: selection.checkedAt, now: Date()) {
            return try selectedBundle(selection, context: context)
        }
        // Persist before networking so failures and repeated launches obey the
        // same hourly request budget. Existing verified data remains selected.
        selection.checkedAt = Date()
        try save(selection)
        let catalog = GitHubReleaseCatalog()
        let snapshot = try await bounded { try await catalog.fetchAll() }
        guard let release = Self.newestEligible(snapshot.recovery),
              Self.assetIdentity(release) != selection.selectedAsset,
              Self.assetIdentity(release) != selection.noPayloadAsset,
              selection.publishedAt == nil || release.publishedAt! >= selection.publishedAt! else {
            return try selectedBundle(selection, context: context)
        }
        let attempt = root.appendingPathComponent("release-" + UUID().uuidString)
        try Self.validatePath(attempt, beneath: root)
        try FileManager.default.createDirectory(at: attempt, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        var retained = false
        defer { if !retained { try? FileManager.default.removeItem(at: attempt) } }
        let archive = try await bounded { try await catalog.download(release.asset, into: attempt) }
        defer { try? FileManager.default.removeItem(at: archive) }
        let cached = try RecoveryArchive.cache(archive, release: release, component: .recovery, cacheRoot: attempt.appendingPathComponent("verified"), signingContext: context)
        let payload = cached.appURL.appendingPathComponent("Contents/Resources/AIIntegrationBundle")
        // Older authentic Recovery releases predate integration packaging. Only
        // record that result after complete signature/notarization verification;
        // transport and trust failures must remain retryable.
        if !FileManager.default.fileExists(atPath: payload.path) {
            selection.noPayloadAsset = Self.assetIdentity(release)
            try save(selection)
            return try selectedBundle(selection, context: context)
        }
        let version = try verifiedPayload(payload)
        let installedPayload = installedApp.appendingPathComponent("Contents/Resources/AIIntegrationBundle")
        let installedVersion = try verifiedPayload(installedPayload)
        guard AIIntegrationManager.compareVersions(version, installedVersion) != .orderedAscending,
              selection.pluginVersion.map({ AIIntegrationManager.compareVersions(version, $0) != .orderedAscending }) ?? true else {
            throw failure("The signed release contains an older Thingtime integration; the current bundle was preserved.")
        }
        let oldPath = selection.appPath
        selection.appPath = String(cached.appURL.path.dropFirst(root.path.count + 1))
        selection.pluginVersion = version
        selection.publishedAt = release.publishedAt
        selection.releaseID = release.id
        selection.selectedAsset = Self.assetIdentity(release)
        selection.noPayloadAsset = nil
        try save(selection)
        retained = true
        // Only the superseded service-owned release directory is disposable.
        if let oldPath, let first = oldPath.split(separator: "/").first, first.hasPrefix("release-"), UUID(uuidString: String(first.dropFirst(8))) != nil {
            let old = root.appendingPathComponent(String(first))
            if old != attempt { try Self.validatePath(old, beneath: root); try? FileManager.default.removeItem(at: old) }
        }
        return payload
    }

    internal static func newestEligible(_ releases: [RecoveryRelease]) -> RecoveryRelease? {
        releases.filter { release in
            let url = release.asset.downloadURL
            return !release.isUnsigned && !release.isPrerelease && release.unavailableReason == nil && release.publishedAt != nil &&
                url.scheme == "https" && url.host == "github.com" && url.user == nil && url.password == nil &&
                url.path.hasPrefix("/lopugit/thingtime/releases/download/") &&
                release.asset.name.hasPrefix("Thingtime-Recovery-App-Release-") && release.asset.name.hasSuffix(".zip") &&
                release.asset.name == (release.asset.name as NSString).lastPathComponent
        }.max { $0.publishedAt! < $1.publishedAt! }
    }

    internal static func shouldRefresh(lastCheck: Date?, now: Date) -> Bool {
        guard let lastCheck else { return true }
        // Clock rollback cannot suppress updates indefinitely.
        return now.timeIntervalSince(lastCheck) >= 3600 || now < lastCheck
    }

    internal static func assetIdentity(_ release: RecoveryRelease) -> String {
        // Catalog metadata is part of identity so replacing a release asset
        // permits a fresh compatibility check rather than a permanent skip.
        let fields = [release.id, release.asset.id.map(String.init) ?? "unknown", release.asset.updatedAt ?? "unknown", release.asset.name, release.asset.downloadURL.absoluteString, release.asset.size.map(String.init) ?? "unknown"]
        return SHA256.hash(data: Data(fields.joined(separator: "\n").utf8)).map { String(format: "%02x", $0) }.joined()
    }

    internal static func validatePath(_ url: URL, beneath anchor: URL) throws {
        let path = url.standardizedFileURL
        let base = anchor.standardizedFileURL
        guard path.path == base.path || path.path.hasPrefix(base.path + "/") else { throw RecoveryError.invalidPath("Integration update path escapes its private cache.") }
        var current = path
        while current.path != "/" {
            if let attrs = try? FileManager.default.attributesOfItem(atPath: current.path), attrs[.type] as? FileAttributeType == .typeSymbolicLink {
                throw RecoveryError.invalidPath("Integration updates refuse symbolic-link paths.")
            }
            current.deleteLastPathComponent()
        }
    }

    private func productionContext() throws -> SigningContext {
        try Self.validatePath(installedApp, beneath: homeDirectory.appendingPathComponent("Applications"))
        let context = try BundleVerifier.signingContext(for: installedApp)
        guard context.isProduction else { throw failure("Remote integration updates require an installed Developer ID-signed Recovery app with a stable team identity. The bundled integration remains available.") }
        // A locally built host needs a valid Developer ID signature, expected
        // identifier and stable team, but may not have a distribution ticket.
        // Downloaded apps always receive the original production context below,
        // preserving Gatekeeper and stapled-notarization checks for remote data.
        try BundleVerifier.verify(installedApp, component: .recovery, signingContext: SigningContext(teamIdentifier: context.teamIdentifier, isProduction: false))
        return context
    }

    private func selectedBundle(_ selection: Selection, context: SigningContext) throws -> URL? {
        guard let relative = selection.appPath else { return nil }
        guard !relative.hasPrefix("/"), !relative.split(separator: "/").contains(".."), relative.split(separator: "/").first?.hasPrefix("release-") == true else { throw failure("Invalid cached integration selection.") }
        let app = root.appendingPathComponent(relative)
        try Self.validatePath(app, beneath: root)
        try BundleVerifier.verify(app, component: .recovery, signingContext: context)
        let payload = app.appendingPathComponent("Contents/Resources/AIIntegrationBundle")
        let version = try verifiedPayload(payload)
        guard version == selection.pluginVersion else { throw failure("Cached integration version does not match its selection.") }
        let builtin = try verifiedPayload(installedApp.appendingPathComponent("Contents/Resources/AIIntegrationBundle"))
        guard AIIntegrationManager.compareVersions(version, builtin) != .orderedAscending else { return nil }
        return payload
    }

    private func verifiedPayload(_ payload: URL) throws -> String {
        try Self.validatePath(payload, beneath: payload)
        let metadata = payload.appendingPathComponent(".codex-plugin/plugin.json")
        try Self.validatePath(metadata, beneath: payload)
        guard let metadataObject = try JSONSerialization.jsonObject(with: Data(contentsOf: metadata)) as? [String: Any], metadataObject["name"] as? String == "thingtime", let version = metadataObject["version"] as? String,
              version.range(of: "^[0-9]+\\.[0-9]+\\.[0-9]+(?:[-+][A-Za-z0-9.+-]+)?$", options: .regularExpression) != nil else { throw failure("The signed release has invalid integration metadata.") }
        let manifest = payload.appendingPathComponent("bundle-manifest.json")
        try Self.validatePath(manifest, beneath: payload)
        guard let object = try JSONSerialization.jsonObject(with: Data(contentsOf: manifest)) as? [String: Any], object["version"] as? String == version, let hashes = object["sha256"] as? [String: String], hashes["skills/thingtime/SKILL.md"] != nil else { throw failure("The signed integration manifest is missing or invalid.") }
        for (relative, expected) in hashes {
            guard !relative.hasPrefix("/"), !relative.split(separator: "/").contains("..") else { throw failure("Unsafe integration manifest path.") }
            let file = payload.appendingPathComponent(relative)
            try Self.validatePath(file, beneath: payload)
            let actual = SHA256.hash(data: try Data(contentsOf: file)).map { String(format: "%02x", $0) }.joined()
            guard actual == expected else { throw failure("The signed integration payload failed its hash check.") }
        }
        return version
    }

    private func prepareRoot() throws {
        try Self.validatePath(root, beneath: homeDirectory)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: root.path)
    }
    private func load() throws -> Selection {
        try Self.validatePath(stateURL, beneath: homeDirectory)
        guard FileManager.default.fileExists(atPath: stateURL.path) else { return Selection() }
        return try JSONDecoder().decode(Selection.self, from: Data(contentsOf: stateURL))
    }
    private func save(_ selection: Selection) throws {
        try Self.validatePath(stateURL, beneath: homeDirectory)
        try JSONEncoder().encode(selection).write(to: stateURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: stateURL.path)
    }
    private func bounded<T>(_ work: @escaping () async throws -> T) async throws -> T {
        try await withThrowingTaskGroup(of: T.self) { group in
            group.addTask { try await work() }
            group.addTask { try await Task.sleep(nanoseconds: 120_000_000_000); throw failure("The remote integration update check timed out.") }
            defer { group.cancelAll() }
            return try await group.next()!
        }
    }
    private func failure(_ message: String) -> RecoveryError { .operationFailed(message) }
}
