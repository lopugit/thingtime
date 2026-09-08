import AppKit
import Combine
import Foundation
import ThingtimeRecoveryCore

@MainActor
final class RecoveryStore: ObservableObject {
    @Published private(set) var desktopBundles: [CachedBundle] = []
    @Published private(set) var commanderBundles: [CachedBundle] = []
    @Published private(set) var commanderReleases: [RecoveryRelease] = []
    @Published var selectedProduct = RecoveryProduct(rawValue: UserDefaults.standard.string(forKey: "recovery.selectedProduct") ?? "") ?? .electron {
        didSet { UserDefaults.standard.set(selectedProduct.rawValue, forKey: "recovery.selectedProduct") }
    }
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
    private var installerNotice: String?

    init() {
        reloadCaches()
        if let result = RecoveryInstallNotice.consume(paths: paths) {
            installerNotice = result.message
            notice = result.message
            if result.isError { errorMessage = result.message }
        }
    }

    func reloadCaches() {
        do {
            desktopBundles = try cache(for: .desktop).listBundles()
            recoveryBundles = try cache(for: .recovery).listBundles()
            commanderBundles = try cache(for: .commander).listBundles()
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
            commanderReleases = snapshot.commander
            catalogStatus = "GitHub: \(snapshot.publishedReleaseCount) published releases · \(snapshot.desktop.count) desktop · \(snapshot.recovery.count) Recovery for this Mac"
            reloadCaches()
            notice = installerNotice ?? "Release catalog refreshed. Cached bundles remain available if GitHub is offline later."
        } catch {
            reloadCaches()
            errorMessage = "\(error.localizedDescription) Cached recovery bundles are still available on this Mac."
        }
    }

    func cache(_ release: RecoveryRelease, component: RecoveryComponent) async {
        if let reason = release.unavailableReason {
            notice = reason
            return
        }
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
        guard bundle.component != .recovery else { return }
        handoff(action: bundle.component == .commander ? .launchCommander : .launchDesktop, bundle: bundle)
    }

    func install(_ bundle: CachedBundle) {
        let action: RecoveryInstallAction
        switch bundle.component {
        case .desktop: action = .installDesktop
        case .recovery: action = .installRecovery
        case .commander: action = .installCommander
        }
        handoff(action: action, bundle: bundle)
    }

    func remove(_ bundle: CachedBundle) {
        do {
            try cache(for: bundle.component).remove(key: bundle.entry.key)
            reloadCaches()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func bundles(for component: RecoveryComponent) -> [CachedBundle] {
        switch component {
        case .desktop: desktopBundles
        case .recovery: recoveryBundles
        case .commander: commanderBundles
        }
    }

    func releases(for component: RecoveryComponent) -> [RecoveryRelease] {
        switch component {
        case .desktop: desktopReleases
        case .recovery: recoveryReleases
        case .commander: commanderReleases
        }
    }

    func cacheInstalled(_ component: RecoveryComponent) async {
        guard !isCaching else { return }
        isCaching = true
        defer { isCaching = false }
        let source = paths.installedApp(for: component)
        notice = "Verifying the installed \(component.title)…"
        do {
            let root = paths.cacheRoot(for: component)
            let recoveryApp = Bundle.main.bundleURL
            _ = try await Task.detached(priority: .userInitiated) {
                let context = try BundleVerifier.signingContext(for: recoveryApp)
                let trust = try BundleVerifier.distribution(for: source, component: component)
                // Unsigned local apps require the explicit GitHub acknowledgement
                // path; this button cannot silently grant unsigned provenance.
                guard trust == .signed else { throw RecoveryError.operationFailed("This installed app is unsigned. Cache its explicitly labelled GitHub release instead.") }
                let info = RecoveryBuildMetadata(bundleURL: source)
                let version = info.version ?? "unknown"
                let descriptor = CacheReleaseDescriptor(id: "installed-\(component.rawValue)-\(version)-\(info.buildNumber ?? "unknown")-\(UUID().uuidString)", name: "Saved installed \(component.title)", tag: "installed-\(version)", version: version)
                return try RecoveryCache(component: component, root: root).cacheBundle(sourceApp: source, descriptor: descriptor) {
                    try BundleVerifier.verify($0, component: component, signingContext: context)
                }
            }.value
            reloadCaches()
            notice = "Saved the verified installed \(component.title) for recovery."
        } catch { errorMessage = error.localizedDescription; notice = "The installed app was left unchanged." }
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
        guard !isCaching else { return }
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
