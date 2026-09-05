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
    @Published private(set) var isCaching = false
    @Published private(set) var catalogStatus: String?
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
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            let snapshot = try await catalog.fetchAll()
            desktopReleases = snapshot.desktop
            recoveryReleases = snapshot.recovery
            catalogStatus = "GitHub: \(snapshot.publishedReleaseCount) published releases · \(snapshot.desktop.count) desktop · \(snapshot.recovery.count) Recovery for this Mac"
            errorMessage = nil
            reloadCaches()
            notice = "Release catalog refreshed. Cached bundles remain available if GitHub is offline later."
        } catch {
            reloadCaches()
            errorMessage = "\(error.localizedDescription) Cached recovery bundles are still available on this Mac."
        }
    }

    func cache(_ release: RecoveryRelease, component: RecoveryComponent) async {
        guard !isCaching else { return }
        isCaching = true
        notice = "Downloading \(component.title) \(release.version ?? release.tag)…"
        defer { isCaching = false }
        do {
            let cache = cache(for: component)
            let archive = try await catalog.download(release.asset, into: cache.root.appendingPathComponent("downloads", isDirectory: true))
            defer { try? FileManager.default.removeItem(at: archive) }
            notice = "Checking archive integrity…"
            let recoveryApp = Bundle.main.bundleURL
            let cacheRoot = cache.root
            _ = try await Task.detached(priority: .userInitiated) {
                let context = release.isUnsigned ? nil : try BundleVerifier.signingContext(for: recoveryApp)
                return try RecoveryArchive.cache(archive, release: release, component: component, cacheRoot: cacheRoot, signingContext: context)
            }.value
            reloadCaches()
            notice = release.isUnsigned
                ? "Cached UNSIGNED \(component.title) \(release.version ?? release.tag). macOS may require Open Anyway before first launch."
                : "Cached verified \(component.title) \(release.version ?? release.tag)."
        } catch {
            notice = "Download was not cached. Installed apps and existing cached versions are unchanged."
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

}
