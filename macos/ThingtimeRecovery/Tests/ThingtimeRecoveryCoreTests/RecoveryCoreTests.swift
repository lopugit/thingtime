import Foundation
import Testing
@testable import ThingtimeRecoveryCore
@testable import ThingtimeRecovery

@Test("recovery app initialization never depends on implicit StateObject storage")
@MainActor
func recoveryAppInitializesExplicitly() {
    _ = ThingtimeRecoveryApp()
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
