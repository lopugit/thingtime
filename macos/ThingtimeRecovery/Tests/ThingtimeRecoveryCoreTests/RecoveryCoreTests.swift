import Foundation
import Testing
@testable import ThingtimeRecoveryCore
@testable import ThingtimeRecovery

private func makeAdHocDesktopBundle(at appURL: URL) throws {
    let contents = appURL.appendingPathComponent("Contents", isDirectory: true)
    let executable = contents.appendingPathComponent("MacOS/Thingtime")
    try FileManager.default.createDirectory(at: executable.deletingLastPathComponent(), withIntermediateDirectories: true)
    try FileManager.default.copyItem(at: URL(fileURLWithPath: "/usr/bin/true"), to: executable)
    let info: [String: Any] = [
        "CFBundleExecutable": "Thingtime",
        "CFBundleIdentifier": RecoveryComponent.desktop.bundleIdentifier,
        "CFBundleName": "Thingtime",
        "CFBundlePackageType": "APPL",
        "CFBundleShortVersionString": "0.0.0",
        "CFBundleVersion": "1",
        "LSMinimumSystemVersion": "13.0"
    ]
    let data = try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0)
    try data.write(to: contents.appendingPathComponent("Info.plist"))
    _ = try ProcessExecution.run("/usr/bin/codesign", arguments: ["--force", "--deep", "--sign", "-", "--identifier", RecoveryComponent.desktop.bundleIdentifier, appURL.path], label: "Test unsigned Thingtime signing")
}

@Test("recovery app initialization never depends on implicit StateObject storage")
@MainActor
func recoveryAppInitializesExplicitly() {
    _ = ThingtimeRecoveryApp()
}

@Test("recovery catalog follows every GitHub page and fails closed on pagination loops")
func recoveryCatalogFollowsEveryPage() async throws {
    func releaseData(page: Int) throws -> Data {
        try JSONSerialization.data(withJSONObject: [[
            "assets": [[
                "browser_download_url": "https://github.com/lopugit/thingtime/releases/download/electron-v0.1.\(page)%2Bbuild.1/Thingtime-Electron-App-Release-0.1.\(page)-build.1-macos-arm64.zip",
                "name": "Thingtime-Electron-App-Release-0.1.\(page)-build.1-macos-arm64.zip",
                "size": 1024
            ]],
            "draft": false,
            "html_url": "https://github.com/lopugit/thingtime/releases/tag/electron-v0.1.\(page)%2Bbuild.1",
            "id": page,
            "name": "Thingtime Electron App Release 0.1.\(page)+build.1",
            "prerelease": false,
            "published_at": "2026-08-0\(page)T00:00:00Z",
            "tag_name": "electron-v0.1.\(page)+build.1"
        ]])
    }

    func response(for url: URL, next: URL?) -> HTTPURLResponse {
        HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: next.map { ["Link": "<\($0.absoluteString)>; rel=\"next\""] }
        )!
    }

    let pages = (1...4).map { URL(string: "https://api.github.com/repos/lopugit/thingtime/releases?page=\($0)")! }
    let catalog = GitHubReleaseCatalog(endpoint: pages[0]) { url in
        guard let index = pages.firstIndex(of: url) else { throw RecoveryError.operationFailed("Unexpected test release page.") }
        return (try releaseData(page: index + 1), response(for: url, next: index + 1 < pages.count ? pages[index + 1] : nil))
    }
    let releases = try await catalog.fetch(component: .desktop)
    #expect(releases.map(\.tag) == [
        "electron-v0.1.4+build.1",
        "electron-v0.1.3+build.1",
        "electron-v0.1.2+build.1",
        "electron-v0.1.1+build.1"
    ])

    let loopCatalog = GitHubReleaseCatalog(endpoint: pages[0]) { url in
        (try releaseData(page: 1), response(for: url, next: pages[0]))
    }
    do {
        _ = try await loopCatalog.fetch(component: .desktop)
        Issue.record("Expected GitHub release catalog pagination loop to be rejected.")
    } catch {
        #expect(error.localizedDescription.contains("loop"))
    }
}

@Test("recovery catalog separates unsigned release assets from verified release assets")
func recoveryCatalogLabelsUnsignedAssets() async throws {
    let endpoint = URL(string: "https://api.github.com/repos/lopugit/thingtime/releases?per_page=100")!
    let data = try JSONSerialization.data(withJSONObject: [[
        "assets": [
            [
                "browser_download_url": "https://github.com/lopugit/thingtime/releases/download/electron-v0.1.0-pr.68.example.gabcdef123456.unsigned/Thingtime-Electron-App-UNSIGNED-Release-0.1.0-pr.68.example.gabcdef123456.unsigned-macos-arm64.zip",
                "name": "Thingtime-Electron-App-UNSIGNED-Release-0.1.0-pr.68.example.gabcdef123456.unsigned-macos-arm64.zip",
                "size": 1024
            ],
            [
                "browser_download_url": "https://github.com/lopugit/thingtime/releases/download/electron-v0.1.0-pr.68.example.gabcdef123456.unsigned/Thingtime-Electron-App-Release-0.1.0-pr.68.example.gabcdef123456.unsigned-macos-arm64.zip",
                "name": "Thingtime-Electron-App-Release-0.1.0-pr.68.example.gabcdef123456.unsigned-macos-arm64.zip",
                "size": 1024
            ]
        ],
        "draft": false,
        "html_url": "https://github.com/lopugit/thingtime/releases/tag/electron-v0.1.0-pr.68.example.gabcdef123456.unsigned",
        "id": 68,
        "name": "Thingtime Desktop UNSIGNED 0.1.0-pr.68.example.gabcdef123456.unsigned",
        "prerelease": true,
        "published_at": "2026-08-24T00:00:00Z",
        "tag_name": "electron-v0.1.0-pr.68.example.gabcdef123456.unsigned"
    ]])
    let response = HTTPURLResponse(url: endpoint, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: nil)!
    let catalog = GitHubReleaseCatalog(endpoint: endpoint) { _ in (data, response) }

    let releases = try await catalog.fetch(component: .desktop)
    #expect(releases.count == 1)
    #expect(releases[0].isUnsigned)
    #expect(releases[0].asset.name.contains("UNSIGNED"))
    #expect(CacheReleaseDescriptor(release: releases[0]).isUnsigned)
}

@Test("shared desktop cache and independent recovery cache are stable under Application Support")
func stableCacheLocations() {
    let paths = RecoveryPaths(homeDirectory: URL(fileURLWithPath: "/Users/example"))
    #expect(paths.desktopCacheRoot.path == "/Users/example/Library/Application Support/com.thingtime.desktop/release-cache")
    #expect(paths.recoveryCacheRoot.path == "/Users/example/Library/Application Support/com.thingtime.desktop/recovery-cache")
    #expect(paths.desktopCacheRoot != paths.recoveryCacheRoot)
}

@Test("cached bundle discovery rejects traversal-shaped metadata")
func cacheDiscoveryIsConstrained() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("thingtime-recovery-test-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let cache = RecoveryCache(component: .desktop, root: root)
    let goodKey = "release-abcdef123456"
    let app = root.appendingPathComponent("bundles/\(goodKey)/Thingtime.app", isDirectory: true)
    try FileManager.default.createDirectory(at: app, withIntermediateDirectories: true)
    let manifest = CacheManifest(entries: [
        CacheManifestEntry(key: goodKey, tag: "electron-v0.1.0"),
        CacheManifestEntry(key: "../../Applications/Thingtime.app", tag: "tampered")
    ])
    let data = try JSONEncoder().encode(manifest)
    try data.write(to: root.appendingPathComponent("manifest.json"))
    #expect(try cache.listBundles().count == 1)
}

@Test("installer derives the unsigned lane from trusted cache metadata")
func installerUsesCachedUnsignedProvenance() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("thingtime-recovery-unsigned-mode-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let key = "unsigned-abcdef123456"
    let app = root.appendingPathComponent("bundles/\(key)/Thingtime.app", isDirectory: true)
    try FileManager.default.createDirectory(at: app, withIntermediateDirectories: true)
    let cache = RecoveryCache(component: .desktop, root: root)
    let manifest = CacheManifest(entries: [CacheManifestEntry(key: key, tag: "electron-v0.1.0.unsigned", isUnsigned: true)])
    try JSONEncoder().encode(manifest).write(to: root.appendingPathComponent("manifest.json"))
    let cachedBundle = try cache.bundle(at: app)
    let bundle = try #require(cachedBundle)
    #expect(RecoveryInstaller.verificationTrust(for: bundle) == .unsigned)
}

@Test("unsigned cached desktop bundles launch through the Recovery installer without a signing context")
func unsignedCachedBundleCanUseDetachedLaunchPath() throws {
    let home = FileManager.default.temporaryDirectory.appendingPathComponent("thingtime-recovery-unsigned-launch-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: home) }
    let paths = RecoveryPaths(homeDirectory: home)
    let key = "unsigned-abcdef123456"
    let app = paths.desktopCacheRoot.appendingPathComponent("bundles/\(key)/Thingtime.app", isDirectory: true)
    try makeAdHocDesktopBundle(at: app)
    let manifest = CacheManifest(entries: [CacheManifestEntry(key: key, tag: "electron-v0.0.0.unsigned", isUnsigned: true)])
    try FileManager.default.createDirectory(at: paths.desktopCacheRoot, withIntermediateDirectories: true)
    try JSONEncoder().encode(manifest).write(to: paths.desktopCacheRoot.appendingPathComponent("manifest.json"))

    let plan = RecoveryInstallPlan(action: .launchDesktop, cacheRoot: paths.desktopCacheRoot, sourceApp: app, waitForPID: .max)
    try RecoveryInstaller.execute(plan: plan, paths: paths, signingContext: nil)
}

@Test("a missing unsigned cache marker never downgrades signed verification")
func signedCachedBundleStillRequiresSigningContext() throws {
    let home = FileManager.default.temporaryDirectory.appendingPathComponent("thingtime-recovery-signed-context-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: home) }
    let paths = RecoveryPaths(homeDirectory: home)
    let key = "signed-abcdef123456"
    let app = paths.desktopCacheRoot.appendingPathComponent("bundles/\(key)/Thingtime.app", isDirectory: true)
    try makeAdHocDesktopBundle(at: app)
    let manifest = CacheManifest(entries: [CacheManifestEntry(key: key, tag: "electron-v0.0.0")])
    try FileManager.default.createDirectory(at: paths.desktopCacheRoot, withIntermediateDirectories: true)
    try JSONEncoder().encode(manifest).write(to: paths.desktopCacheRoot.appendingPathComponent("manifest.json"))

    let plan = RecoveryInstallPlan(action: .launchDesktop, cacheRoot: paths.desktopCacheRoot, sourceApp: app, waitForPID: .max)
    #expect(throws: RecoveryError.self) { try RecoveryInstaller.execute(plan: plan, paths: paths, signingContext: nil) }
}

@Test("handoff plans accept only the exact shared cache and expected cached bundle layout")
func planValidationIsConstrained() throws {
    let temporaryHome = FileManager.default.temporaryDirectory.appendingPathComponent("thingtime-recovery-plan-\(UUID().uuidString)", isDirectory: true)
    let paths = RecoveryPaths(homeDirectory: temporaryHome)
    let source = paths.desktopCacheRoot.appendingPathComponent("bundles/release-abcdef123456/Thingtime.app")
    try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: temporaryHome) }
    let plan = RecoveryInstallPlan(action: .installDesktop, cacheRoot: paths.desktopCacheRoot, sourceApp: source, waitForPID: 100)
    #expect(try plan.validate(paths: paths) == .desktop)
    let invalid = RecoveryInstallPlan(action: .installDesktop, cacheRoot: paths.recoveryCacheRoot, sourceApp: source, waitForPID: 100)
    #expect(throws: RecoveryError.self) { try invalid.validate(paths: paths) }
}

@Test("one catalog snapshot deduplicates pages and selects this Mac's architecture")
func catalogSnapshotMatchesArchitecture() async throws {
    let endpoint = URL(string: "https://api.github.com/repos/lopugit/thingtime/releases?per_page=100")!
    let assets = ["arm64", "x64", "x86_64", "universal"].map { arch in
        ["name": "Thingtime-Electron-App-Release-0.2.0-macos-\(arch).zip", "browser_download_url": "https://github.com/lopugit/thingtime/releases/download/electron-v0.2.0/Thingtime-Electron-App-Release-0.2.0-macos-\(arch).zip"]
    }
    let release: [String: Any] = ["id": 5, "tag_name": "electron-v0.2.0", "assets": assets]
    let data = try JSONSerialization.data(withJSONObject: [release, release])
    let catalog = GitHubReleaseCatalog(endpoint: endpoint, architecture: "x64") { url in
        (data, HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
    let snapshot = try await catalog.fetchAll()
    #expect(snapshot.publishedReleaseCount == 1)
    #expect(snapshot.desktop.count == 1)
    #expect(snapshot.recovery.isEmpty)
    #expect(!snapshot.desktop[0].asset.name.contains("arm64"))
}

@Test("catalog fails instead of returning a partial snapshot on a later-page rate limit")
func catalogRejectsPartialRefresh() async throws {
    let endpoint = URL(string: "https://api.github.com/repos/lopugit/thingtime/releases?page=1")!
    let next = URL(string: "https://api.github.com/repos/lopugit/thingtime/releases?page=2")!
    let catalog = GitHubReleaseCatalog(endpoint: endpoint) { url in
        if url == endpoint {
            return (Data("[]".utf8), HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Link": "<\(next)>; rel=\"next\""])!)
        }
        return (Data("{}".utf8), HTTPURLResponse(url: url, statusCode: 403, httpVersion: nil, headerFields: nil)!)
    }
    do {
        _ = try await catalog.fetchAll()
        Issue.record("Expected rate limit rejection")
    } catch {
        #expect(error.localizedDescription.contains("limiting"))
    }
}

@Test("archive cache rejects missing signature resources and removes staging without changing installed apps")
func archiveRejectsMissingResourceSeal() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("recovery-archive-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: root) }
    let app = root.appendingPathComponent("source/Thingtime.app")
    try makeAdHocDesktopBundle(at: app)
    try FileManager.default.removeItem(at: app.appendingPathComponent("Contents/_CodeSignature"))
    let archive = root.appendingPathComponent("broken.zip")
    try ProcessExecution.run("/usr/bin/ditto", arguments: ["-c", "-k", "--keepParent", app.path, archive.path], label: "Test archive")
    let release = RecoveryRelease(asset: .init(downloadURL: URL(string: "https://github.com/lopugit/thingtime/releases/download/test/broken.zip")!, name: "broken.zip", size: nil), id: "test", isPrerelease: true, isUnsigned: true, name: "test", publishedAt: nil, releaseURL: nil, tag: "test.unsigned", version: nil)
    let cacheRoot = root.appendingPathComponent("cache")
    do {
        _ = try RecoveryArchive.cache(archive, release: release, component: .desktop, cacheRoot: cacheRoot, signingContext: nil)
        Issue.record("Expected malformed archive to be rejected")
    } catch {
        #expect(error.localizedDescription.contains("resource seal"))
    }
    #expect(try FileManager.default.contentsOfDirectory(atPath: cacheRoot.path).isEmpty)
}

@Test("cached bundles are reverified even when the release key already exists")
func cacheRechecksExistingBundle() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("recovery-recheck-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: root) }
    let source = root.appendingPathComponent("source/Thingtime.app")
    try makeAdHocDesktopBundle(at: source)
    let cache = RecoveryCache(component: .desktop, root: root.appendingPathComponent("cache"))
    let descriptor = CacheReleaseDescriptor(id: "test", tag: "test.unsigned", isUnsigned: true)
    let cached = try cache.cacheBundle(sourceApp: source, descriptor: descriptor) { try BundleVerifier.verifyUnsigned($0, component: .desktop) }
    try Data("corrupt".utf8).write(to: cached.appURL.appendingPathComponent("Contents/MacOS/Thingtime"))
    #expect(throws: RecoveryError.self) {
        try cache.cacheBundle(sourceApp: source, descriptor: descriptor) { try BundleVerifier.verifyUnsigned($0, component: .desktop) }
    }
}

@Test("process output exceeding pipe capacity is drained before waiting for exit")
func processDrainsOutput() throws {
    let output = try ProcessExecution.run("/bin/sh", arguments: ["-c", "i=0; while [ $i -lt 10000 ]; do echo 'recovery stdout test line'; echo 'recovery stderr test line' >&2; i=$((i+1)); done"], label: "Output test")
    #expect(output.utf8.count > 400_000)
}

@Test("a valid replacement repairs a damaged installed app and preserves its untrusted backup")
func installOverDamagedApp() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("recovery-damaged-install-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: root) }
    let source = root.appendingPathComponent("source/Thingtime.app")
    let target = root.appendingPathComponent("Applications/Thingtime.app")
    try makeAdHocDesktopBundle(at: source)
    try makeAdHocDesktopBundle(at: target)
    try Data("broken executable".utf8).write(to: target.appendingPathComponent("Contents/MacOS/Thingtime"))
    let cache = RecoveryCache(component: .desktop, root: root.appendingPathComponent("cache"))
    let preserved = try RecoveryInstaller.installCachedBundle(source: source, target: target, component: .desktop, cache: cache, trust: .unsigned, signingContext: nil)
    let backup = try #require(preserved)
    try BundleVerifier.verifyUnsigned(target, component: .desktop)
    #expect(try Data(contentsOf: backup.appendingPathComponent("Contents/MacOS/Thingtime")) == Data("broken executable".utf8))
    #expect(try cache.listBundles().isEmpty)
}

@Test("an invalid replacement never displaces an installed app")
func invalidReplacementPreservesInstallation() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("recovery-invalid-install-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: root) }
    let source = root.appendingPathComponent("source/Thingtime.app")
    let target = root.appendingPathComponent("Applications/Thingtime.app")
    try makeAdHocDesktopBundle(at: source)
    try makeAdHocDesktopBundle(at: target)
    try Data("broken replacement".utf8).write(to: source.appendingPathComponent("Contents/MacOS/Thingtime"))
    let cache = RecoveryCache(component: .desktop, root: root.appendingPathComponent("cache"))
    #expect(throws: RecoveryError.self) {
        try RecoveryInstaller.installCachedBundle(source: source, target: target, component: .desktop, cache: cache, trust: .unsigned, signingContext: nil)
    }
    try BundleVerifier.verifyUnsigned(target, component: .desktop)
}

@Test("installer results survive helper exit and are consumed once")
func installNoticeRoundTrip() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("recovery-notice-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: root) }
    let paths = RecoveryPaths(homeDirectory: root)
    try RecoveryInstallNotice(message: "The app was preserved", isError: true).save(paths: paths)
    let notice = try #require(RecoveryInstallNotice.consume(paths: paths))
    #expect(notice.isError)
    #expect(notice.message == "The app was preserved")
    #expect(RecoveryInstallNotice.consume(paths: paths) == nil)
}
