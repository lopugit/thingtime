import CryptoKit
import Darwin
import Foundation

public final class RecoveryCache {
    public let component: RecoveryComponent
    public let root: URL
    private let fileManager: FileManager
    private let maximumBundles = 12

    public init(component: RecoveryComponent, root: URL, fileManager: FileManager = .default) {
        self.component = component
        self.root = root.standardizedFileURL
        self.fileManager = fileManager
    }

    public func listBundles() throws -> [CachedBundle] {
        try ensureRoot()
        let manifest = try readManifest()
        return manifest.entries.compactMap { entry in
            guard Self.isValidKey(entry.key) else { return nil }
            let bundleDirectory = bundlesDirectory.appendingPathComponent(entry.key, isDirectory: true)
            let appURL = bundleDirectory.appendingPathComponent(component.appName, isDirectory: true)
            guard Self.isRegularDirectory(bundleDirectory), Self.isRegularDirectory(appURL), isDescendant(appURL, of: root) else { return nil }
            return CachedBundle(entry: entry, appURL: appURL, component: component)
        }.sorted { ($0.entry.cachedAt ?? "") > ($1.entry.cachedAt ?? "") }
    }

    /// Resolves a handoff source back to its manifest entry. The installer
    /// derives the trust lane from this local metadata rather than accepting a
    /// caller-controlled "unsigned" flag in its launch plan.
    public func bundle(at appURL: URL) throws -> CachedBundle? {
        let requested = appURL.standardizedFileURL
        return try listBundles().first { $0.appURL.standardizedFileURL == requested }
    }

    public func remove(key: String) throws {
        guard Self.isValidKey(key) else { throw RecoveryError.invalidPath("That cached bundle key is invalid.") }
        try ensureRoot()
        var manifest = try readManifest()
        guard manifest.entries.contains(where: { $0.key == key }) else {
            throw RecoveryError.operationFailed("That cached recovery bundle is no longer available.")
        }
        let directory = bundlesDirectory.appendingPathComponent(key, isDirectory: true)
        guard isDescendant(directory, of: root) else { throw RecoveryError.invalidPath("The cache removal path is invalid.") }
        try fileManager.removeItem(at: directory)
        manifest.entries.removeAll { $0.key == key }
        try writeManifest(manifest)
    }

    @discardableResult
    public func cacheBundle(sourceApp: URL, descriptor: CacheReleaseDescriptor, verify: (URL) throws -> Void) throws -> CachedBundle {
        try ensureRoot()
        let key = cacheKey(for: descriptor)
        if let existing = try listBundles().first(where: { $0.entry.key == key }) {
            try verify(existing.appURL)
            return existing
        }
        let recoverableEntries = try listBundles().map(\.entry)
        guard recoverableEntries.count < maximumBundles else {
            throw RecoveryError.operationFailed("Thingtime keeps up to \(maximumBundles) verified \(component.title) recovery bundles. Remove one before adding another.")
        }
        guard Self.isRegularDirectory(sourceApp), sourceApp.lastPathComponent == component.appName else {
            throw RecoveryError.invalidPath("The source is not a regular \(component.appName) bundle.")
        }
        try verify(sourceApp)
        let destinationDirectory = bundlesDirectory.appendingPathComponent(key, isDirectory: true)
        let destinationApp = destinationDirectory.appendingPathComponent(component.appName, isDirectory: true)
        do {
            try fileManager.createDirectory(at: destinationDirectory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
            try ProcessExecution.run("/usr/bin/ditto", arguments: ["--rsrc", "--extattr", sourceApp.path, destinationApp.path], label: "\(component.title) recovery bundle copy")
            guard Self.isRegularDirectory(destinationApp) else { throw RecoveryError.operationFailed("The copied recovery bundle is not a regular app directory.") }
            try verify(destinationApp)
            let entry = CacheManifestEntry(
                assetName: descriptor.assetName,
                branch: descriptor.branch,
                cachedAt: ISO8601DateFormatter().string(from: Date()),
                commit: descriptor.commit,
                key: key,
                name: descriptor.name,
                pullRequestNumber: descriptor.pullRequestNumber,
                releaseUrl: descriptor.releaseURL,
                sourceSha256: nil,
                tag: descriptor.tag,
                isUnsigned: descriptor.isUnsigned,
                version: descriptor.version
            )
            var manifest = try readManifest()
            manifest.entries = [entry] + recoverableEntries
            try writeManifest(manifest)
            return CachedBundle(entry: entry, appURL: destinationApp, component: component)
        } catch {
            try? fileManager.removeItem(at: destinationDirectory)
            throw error
        }
    }

    private var bundlesDirectory: URL { root.appendingPathComponent("bundles", isDirectory: true) }
    private var manifestURL: URL { root.appendingPathComponent("manifest.json") }

    private func ensureRoot() throws {
        try makeRegularDirectory(root, label: "Thingtime recovery cache")
        try makeRegularDirectory(bundlesDirectory, label: "Thingtime recovery cache bundles directory")
    }

    private func readManifest() throws -> CacheManifest {
        guard fileManager.fileExists(atPath: manifestURL.path) else { return CacheManifest() }
        do {
            let manifest = try JSONDecoder().decode(CacheManifest.self, from: Data(contentsOf: manifestURL))
            guard manifest.format == 1 else { return CacheManifest() }
            return manifest
        } catch {
            throw RecoveryError.operationFailed("Thingtime recovery cache metadata is unreadable.")
        }
    }

    private func writeManifest(_ manifest: CacheManifest) throws {
        let temporary = root.appendingPathComponent(".manifest-\(UUID().uuidString).json")
        let data = try JSONEncoder.pretty.encode(CacheManifest(format: 1, entries: manifest.entries))
        try data.write(to: temporary, options: [.atomic])
        try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: temporary.path)
        if fileManager.fileExists(atPath: manifestURL.path) { try fileManager.removeItem(at: manifestURL) }
        try fileManager.moveItem(at: temporary, to: manifestURL)
    }

    private func cacheKey(for descriptor: CacheReleaseDescriptor) -> String {
        let readable = (descriptor.tag.isEmpty ? "release" : descriptor.tag)
            .lowercased()
            .map { $0.isLetter || $0.isNumber || $0 == "." || $0 == "-" ? $0 : "-" }
        let normalized = String(readable).trimmingCharacters(in: CharacterSet(charactersIn: "-")).prefix(80)
        let hash = StableDigest.sha256("\(descriptor.id)|\(descriptor.tag)").prefix(12)
        return "\(normalized.isEmpty ? "release" : normalized)-\(hash)"
    }

    private func makeRegularDirectory(_ url: URL, label: String) throws {
        if fileManager.fileExists(atPath: url.path) {
            guard Self.isRegularDirectory(url) else { throw RecoveryError.invalidPath("\(label) must be a regular directory.") }
        } else {
            try fileManager.createDirectory(at: url, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        }
        try fileManager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: url.path)
    }

    public static func isRegularDirectory(_ url: URL) -> Bool {
        var status = stat()
        return lstat(url.path, &status) == 0 && (status.st_mode & S_IFMT) == S_IFDIR
    }

    private func isDescendant(_ child: URL, of parent: URL) -> Bool {
        let childPath = child.standardizedFileURL.path
        let parentPath = parent.standardizedFileURL.path
        return childPath.hasPrefix(parentPath + "/")
    }

    public static func isValidKey(_ key: String) -> Bool {
        key.range(of: "^[a-z0-9.-]{1,100}-[a-f0-9]{12}$", options: .regularExpression) != nil
    }
}

private extension JSONEncoder {
    static var pretty: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return encoder
    }
}

private enum StableDigest {
    static func sha256(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
