import Foundation

public enum RecoveryArchive {
    /// The complete archive is verified before anything enters the shared
    /// cache. Failed extraction and verification never leave partial bundles.
    public static func cache(_ archive: URL, release: RecoveryRelease, component: RecoveryComponent, cacheRoot: URL, signingContext: SigningContext?) throws -> CachedBundle {
        let staging = cacheRoot.appendingPathComponent(".extract-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: staging) }
        try ProcessExecution.run("/usr/bin/ditto", arguments: ["-x", "-k", archive.path, staging.path], label: "Thingtime Recovery archive extraction")
        let app = staging.appendingPathComponent(component.appName, isDirectory: true)
        guard RecoveryCache.isRegularDirectory(app) else {
            throw RecoveryError.operationFailed("The GitHub archive does not contain \(component.appName). The installed app was left unchanged.")
        }
        guard FileManager.default.fileExists(atPath: app.appendingPathComponent("Contents/_CodeSignature/CodeResources").path) else {
            throw RecoveryError.operationFailed("This GitHub archive is missing its code-signature resource seal. It was published incorrectly and cannot be installed safely. Choose a newer release; your installed app and cached versions are unchanged.")
        }
        return try RecoveryCache(component: component, root: cacheRoot).cacheBundle(sourceApp: app, descriptor: CacheReleaseDescriptor(release: release)) { candidate in
            if release.isUnsigned {
                try BundleVerifier.verifyUnsigned(candidate, component: component)
            } else {
                guard let signingContext else {
                    throw RecoveryError.operationFailed("Use a signed Thingtime Recovery app to verify this signed release.")
                }
                try BundleVerifier.verify(candidate, component: component, signingContext: signingContext)
            }
        }
    }
}
