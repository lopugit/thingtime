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
