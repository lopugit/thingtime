import AppKit
import Combine
import Foundation
import ThingtimeRecoveryCore

@MainActor
final class RecoveryStore: ObservableObject {
    @Published private(set) var desktopBundles: [CachedBundle] = []
    @Published private(set) var recoveryBundles: [CachedBundle] = []
    @Published private(set) var desktopReleases: [RecoveryRelease] = []
    @Published private(set) var recoveryReleases: [RecoveryRelease] = []
    @Published private(set) var isRefreshing = false
    @Published var errorMessage: String?
    @Published var notice: String?

    let paths = RecoveryPaths()
    private let catalog = GitHubReleaseCatalog()

    init() {
        reloadCaches()
    }

    func reloadCaches() {
        do {
            desktopBundles = try cache(for: .desktop).listBundles()
            recoveryBundles = try cache(for: .recovery).listBundles()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func refresh() async {
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            async let desktop = catalog.fetch(component: .desktop)
            async let recovery = catalog.fetch(component: .recovery)
            desktopReleases = try await desktop
            recoveryReleases = try await recovery
            reloadCaches()
            notice = "Release catalog refreshed. Cached bundles remain available if GitHub is offline later."
        } catch {
            reloadCaches()
            errorMessage = "\(error.localizedDescription) Cached recovery bundles are still available on this Mac."
        }
    }

    func cache(_ release: RecoveryRelease, component: RecoveryComponent) async {
        do {
            let cache = cache(for: component)
            let archive = try await catalog.download(release.asset, into: cache.root.appendingPathComponent("downloads", isDirectory: true))
            defer { try? FileManager.default.removeItem(at: archive) }
            let staging = try extractArchive(archive, component: component, cacheRoot: cache.root)
            defer { try? FileManager.default.removeItem(at: staging.deletingLastPathComponent()) }
            if release.isUnsigned {
                _ = try cache.cacheBundle(
                    sourceApp: staging,
                    descriptor: CacheReleaseDescriptor(release: release),
                    verify: { try BundleVerifier.verifyUnsigned($0, component: component) }
                )
            } else {
                let context = try BundleVerifier.signingContext(for: Bundle.main.bundleURL)
                _ = try cache.cacheBundle(
                    sourceApp: staging,
                    descriptor: CacheReleaseDescriptor(release: release),
                    verify: { try BundleVerifier.verify($0, component: component, signingContext: context) }
                )
            }
            reloadCaches()
            notice = release.isUnsigned
                ? "Cached UNSIGNED \(component.title) \(release.version ?? release.tag). macOS may require Open Anyway before first launch."
                : "Cached verified \(component.title) \(release.version ?? release.tag)."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func launch(_ bundle: CachedBundle) {
        handoff(action: .launchDesktop, bundle: bundle)
    }

    func install(_ bundle: CachedBundle) {
        handoff(action: bundle.component == .desktop ? .installDesktop : .installRecovery, bundle: bundle)
    }

    func remove(_ bundle: CachedBundle) {
        do {
            try cache(for: bundle.component).remove(key: bundle.entry.key)
            reloadCaches()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func reveal(_ component: RecoveryComponent) {
        let root = paths.cacheRoot(for: component)
        do {
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            NSWorkspace.shared.activateFileViewerSelecting([root])
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func handoff(action: RecoveryInstallAction, bundle: CachedBundle) {
        do {
            let plan = RecoveryInstallPlan(action: action, cacheRoot: paths.cacheRoot(for: bundle.component), sourceApp: bundle.appURL, waitForPID: ProcessInfo.processInfo.processIdentifier)
            let pending = paths.recoveryCacheRoot.appendingPathComponent("pending", isDirectory: true)
            try FileManager.default.createDirectory(at: pending, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let planURL = pending.appendingPathComponent("\(UUID().uuidString).json")
            let data = try JSONEncoder().encode(plan)
            try data.write(to: planURL, options: [.atomic])
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: planURL.path)
            let helper = Bundle.main.bundleURL.appendingPathComponent("Contents/Helpers/ThingtimeRecoveryInstaller")
            guard FileManager.default.isExecutableFile(atPath: helper.path) else {
                throw RecoveryError.operationFailed("Thingtime Recovery's signed installer helper is unavailable.")
            }
            let process = Process()
            process.executableURL = helper
            process.arguments = [planURL.path]
            try process.run()
            notice = action == .launchDesktop ? "Closing Thingtime Recovery and launching the cached desktop bundle." : "Closing Thingtime Recovery to switch bundles safely."
            NSApplication.shared.terminate(nil)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func cache(for component: RecoveryComponent) -> RecoveryCache {
        RecoveryCache(component: component, root: paths.cacheRoot(for: component))
    }

    private func extractArchive(_ archive: URL, component: RecoveryComponent, cacheRoot: URL) throws -> URL {
        let stagingRoot = cacheRoot.appendingPathComponent(".extract-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: stagingRoot, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        try ProcessExecution.run("/usr/bin/ditto", arguments: ["-x", "-k", archive.path, stagingRoot.path], label: "Thingtime Recovery archive extraction")
        let app = stagingRoot.appendingPathComponent(component.appName, isDirectory: true)
        guard FileManager.default.fileExists(atPath: app.path) else {
            throw RecoveryError.operationFailed("The GitHub release archive does not contain \(component.appName).")
        }
        return app
    }
}
