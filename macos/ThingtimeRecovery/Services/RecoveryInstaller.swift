import AppKit
import Darwin
import Foundation

public enum RecoveryInstallAction: String, Codable, Hashable {
    case installDesktop
    case installRecovery
    case launchDesktop
}

public struct RecoveryInstallPlan: Codable, Hashable {
    public let action: RecoveryInstallAction
    public let cacheRoot: URL
    public let format: Int
    public let sourceApp: URL
    public let waitForPID: Int32

    public init(action: RecoveryInstallAction, cacheRoot: URL, format: Int = 1, sourceApp: URL, waitForPID: Int32) {
        self.action = action
        self.cacheRoot = cacheRoot
        self.format = format
        self.sourceApp = sourceApp
        self.waitForPID = waitForPID
    }

    public func validate(paths: RecoveryPaths) throws -> RecoveryComponent {
        guard format == 1, waitForPID > 1 else { throw RecoveryError.invalidPlan("Thingtime Recovery's handoff plan is invalid.") }
        let component: RecoveryComponent
        switch action {
        case .installDesktop, .launchDesktop: component = .desktop
        case .installRecovery: component = .recovery
        }
        let expectedCacheRoot = paths.cacheRoot(for: component).standardizedFileURL
        guard cacheRoot.standardizedFileURL == expectedCacheRoot else { throw RecoveryError.invalidPlan("Thingtime Recovery's cache location is invalid.") }
        let source = sourceApp.standardizedFileURL
        let expectedParent = expectedCacheRoot.appendingPathComponent("bundles", isDirectory: true)
        guard source.lastPathComponent == component.appName, source.path.hasPrefix(expectedParent.path + "/") else {
            throw RecoveryError.invalidPlan("Thingtime Recovery's selected bundle is invalid.")
        }
        let key = source.deletingLastPathComponent().lastPathComponent
        guard RecoveryCache.isValidKey(key) else { throw RecoveryError.invalidPlan("Thingtime Recovery's cache key is invalid.") }
        guard RecoveryCache.isRegularDirectory(expectedCacheRoot), RecoveryCache.isRegularDirectory(expectedParent), RecoveryCache.isRegularDirectory(source.deletingLastPathComponent()), RecoveryCache.isRegularDirectory(source) else {
            throw RecoveryError.invalidPlan("Thingtime Recovery's selected bundle is not a regular cached app directory.")
        }
        return component
    }
}

public enum RecoveryInstaller {
    public static func execute(plan: RecoveryInstallPlan, paths: RecoveryPaths = RecoveryPaths(), signingContext: SigningContext? = nil) throws {
        let component = try plan.validate(paths: paths)
        guard regularDirectory(plan.sourceApp) else { throw RecoveryError.invalidPlan("The selected recovery bundle is no longer available.") }
        let cache = RecoveryCache(component: component, root: paths.cacheRoot(for: component))
        guard let cachedBundle = try cache.bundle(at: plan.sourceApp) else {
            throw RecoveryError.invalidPlan("The selected recovery bundle is missing its cache metadata.")
        }
        let trust = verificationTrust(for: cachedBundle)
        try verify(plan.sourceApp, component: component, trust: trust, signingContext: signingContext)
        try waitForExit(plan.waitForPID)
        switch plan.action {
        case .launchDesktop:
            try ProcessExecution.launchApplication(plan.sourceApp)
        case .installDesktop, .installRecovery:
            try closeRunningApplications(bundleIdentifier: component.bundleIdentifier)
            let target = paths.installedApp(for: component)
            if FileManager.default.fileExists(atPath: target.path) {
                let existingVersion = Bundle(url: target)?.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown"
                let existingTrust = try BundleVerifier.distribution(for: target, component: component)
                try cache.cacheBundle(
                    sourceApp: target,
                    descriptor: CacheReleaseDescriptor(id: "installed-\(component.rawValue)-\(existingVersion)-\(UUID().uuidString)", name: "Previously installed \(component.title) \(existingVersion)", tag: "installed-\(existingVersion)", isUnsigned: existingTrust == .unsigned, version: existingVersion),
                    verify: { try verify($0, component: component, trust: existingTrust, signingContext: signingContext) }
                )
            }
            try atomicallyInstall(source: plan.sourceApp, target: target, component: component, trust: trust, signingContext: signingContext)
            try ProcessExecution.launchApplication(target)
        }
    }

    static func verificationTrust(for bundle: CachedBundle) -> RecoveryBundleTrust {
        bundle.entry.isUnsigned == true ? .unsigned : .signed
    }

    private static func verify(_ appURL: URL, component: RecoveryComponent, trust: RecoveryBundleTrust, signingContext: SigningContext?) throws {
        switch trust {
        case .unsigned:
            try BundleVerifier.verifyUnsigned(appURL, component: component)
        case .signed:
            guard let signingContext else {
                throw RecoveryError.operationFailed("A signed Thingtime release can only be verified by a signed Thingtime Recovery app.")
            }
            try BundleVerifier.verify(appURL, component: component, signingContext: signingContext)
        }
    }

    private static func atomicallyInstall(source: URL, target: URL, component: RecoveryComponent, trust: RecoveryBundleTrust, signingContext: SigningContext?) throws {
        let manager = FileManager.default
        let parent = target.deletingLastPathComponent()
        try manager.createDirectory(at: parent, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let staging = parent.appendingPathComponent(".\(component.rawValue)-install-\(UUID().uuidString).app")
        let backup = parent.appendingPathComponent(".\(component.rawValue)-backup-\(UUID().uuidString).app")
        defer {
            try? manager.removeItem(at: staging)
            try? manager.removeItem(at: backup)
        }
        try ProcessExecution.run("/usr/bin/ditto", arguments: ["--rsrc", "--extattr", source.path, staging.path], label: "\(component.title) installation copy")
        try verify(staging, component: component, trust: trust, signingContext: signingContext)
        if manager.fileExists(atPath: target.path) { try manager.moveItem(at: target, to: backup) }
        do {
            try manager.moveItem(at: staging, to: target)
            try verify(target, component: component, trust: trust, signingContext: signingContext)
        } catch {
            if manager.fileExists(atPath: target.path) { try? manager.removeItem(at: target) }
            if manager.fileExists(atPath: backup.path) { try? manager.moveItem(at: backup, to: target) }
            throw error
        }
    }

    private static func closeRunningApplications(bundleIdentifier: String) throws {
        let apps = NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier)
        for application in apps { application.terminate() }
        let deadline = Date().addingTimeInterval(60)
        while !NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier).isEmpty {
            guard Date() < deadline else {
                throw RecoveryError.operationFailed("\(bundleIdentifier) did not quit within one minute; the installed bundle was left unchanged.")
            }
            Thread.sleep(forTimeInterval: 0.25)
        }
    }

    private static func waitForExit(_ pid: Int32) throws {
        let deadline = Date().addingTimeInterval(60)
        while kill(pid, 0) == 0 {
            guard Date() < deadline else {
                throw RecoveryError.operationFailed("Thingtime Recovery did not quit within one minute; the installed app was left unchanged.")
            }
            Thread.sleep(forTimeInterval: 0.25)
        }
    }

    private static func regularDirectory(_ url: URL) -> Bool {
        var status = stat()
        return lstat(url.path, &status) == 0 && (status.st_mode & S_IFMT) == S_IFDIR
    }
}
