import Foundation
import XCTest
@testable import ThingtimeRecoveryCore

final class AIIntegrationUpdateSourceTests: XCTestCase {
    private func fixtureRoot() throws -> URL {
        // macOS exposes temporaryDirectory through /var, a system symlink.
        // Use an existing, resolved user-cache root rather than weakening the
        // production guard that refuses redirected writable cache ancestors.
        let root = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Caches/ThingtimeRecoveryUpdateTests-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root.resolvingSymlinksInPath()
    }
    private func release(_ id: String, at time: TimeInterval, unsigned: Bool = false, prerelease: Bool = false, unavailable: String? = nil, host: String = "github.com", asset: String = "Thingtime-Recovery-App-Release-1.0.0-macos-arm64.zip") -> RecoveryRelease {
        RecoveryRelease(asset: RecoveryReleaseAsset(downloadURL: URL(string: "https://\(host)/lopugit/thingtime/releases/download/recovery-v1/\(asset)")!, name: asset, size: nil), id: id, isPrerelease: prerelease, isUnsigned: unsigned, name: id, publishedAt: Date(timeIntervalSince1970: time), releaseURL: nil, tag: id, version: "1.0.0", unavailableReason: unavailable)
    }

    func testNewestStableCanonicalSignedReleaseWins() {
        let releases = [release("old", at: 1), release("new", at: 2), release("unsigned", at: 20, unsigned: true), release("preview", at: 30, prerelease: true), release("withdrawn", at: 40, unavailable: "withdrawn"), release("foreign", at: 50, host: "example.com")]
        XCTAssertEqual(AIIntegrationUpdateSource.newestEligible(releases)?.id, "new")
    }

    func testNoUnsignedPrereleaseOrWrongComponentFallback() {
        XCTAssertNil(AIIntegrationUpdateSource.newestEligible([release("unsigned", at: 1, unsigned: true), release("preview", at: 2, prerelease: true), release("desktop", at: 3, asset: "Thingtime-Electron-App-Release-1.0.0-macos-arm64.zip")]))
    }

    func testHourlyThrottleAndClockRecovery() {
        let now = Date(timeIntervalSince1970: 10_000)
        XCTAssertTrue(AIIntegrationUpdateSource.shouldRefresh(lastCheck: nil, now: now))
        XCTAssertFalse(AIIntegrationUpdateSource.shouldRefresh(lastCheck: now.addingTimeInterval(-3599), now: now))
        XCTAssertTrue(AIIntegrationUpdateSource.shouldRefresh(lastCheck: now.addingTimeInterval(-3600), now: now))
        XCTAssertTrue(AIIntegrationUpdateSource.shouldRefresh(lastCheck: now.addingTimeInterval(1), now: now))
    }

    func testContainmentRejectsTraversalAndPrefixSibling() throws {
        let root = try fixtureRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        XCTAssertNoThrow(try AIIntegrationUpdateSource.validatePath(root.appendingPathComponent("release-abc/data"), beneath: root))
        XCTAssertThrowsError(try AIIntegrationUpdateSource.validatePath(root.appendingPathComponent("../outside"), beneath: root))
        XCTAssertThrowsError(try AIIntegrationUpdateSource.validatePath(URL(fileURLWithPath: root.path + "-other/data"), beneath: root))
    }

    func testSelectionCannotFollowSymlinkedAncestor() throws {
        let root = try fixtureRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("redirect"), withDestinationURL: root.deletingLastPathComponent())
        XCTAssertThrowsError(try AIIntegrationUpdateSource.validatePath(root.appendingPathComponent("redirect/selection.json"), beneath: root))
    }

    func testCustomHomeDeterminesInstalledAppWithoutPersonalFallback() {
        let home = URL(fileURLWithPath: "/isolated/home")
        let source = AIIntegrationUpdateSource(homeDirectory: home)
        XCTAssertEqual(source.installedApp.path, "/isolated/home/Applications/Thingtime Recovery.app")
    }

    func testNoCachedSelectionDoesNotRequireAnInstalledSigningIdentity() throws {
        let home = try fixtureRoot()
        defer { try? FileManager.default.removeItem(at: home) }
        XCTAssertNil(try AIIntegrationUpdateSource(homeDirectory: home).currentBundle())
    }

    func testAssetIdentityChangesWhenPublishedReleaseChanges() {
        XCTAssertNotEqual(AIIntegrationUpdateSource.assetIdentity(release("old", at: 1)), AIIntegrationUpdateSource.assetIdentity(release("new", at: 2)))
        XCTAssertNotEqual(AIIntegrationUpdateSource.assetIdentity(release("same", at: 1)), AIIntegrationUpdateSource.assetIdentity(release("same", at: 1, asset: "Thingtime-Recovery-App-Release-2.0.0-macos-arm64.zip")))
    }

    func testReplacedAssetInvalidatesNoPayloadSkipEvenAtSameURLAndSize() {
        let original = release("same", at: 1)
        func replacingAsset(id: Int, updatedAt: String) -> RecoveryRelease {
            let asset = RecoveryReleaseAsset(downloadURL: original.asset.downloadURL, name: original.asset.name, size: original.asset.size, id: id, updatedAt: updatedAt)
            return RecoveryRelease(asset: asset, id: original.id, isPrerelease: false, name: original.name, publishedAt: original.publishedAt, releaseURL: nil, tag: original.tag, version: original.version)
        }
        let prior = replacingAsset(id: 1, updatedAt: "2026-10-28T00:00:00Z")
        XCTAssertNotEqual(AIIntegrationUpdateSource.assetIdentity(prior), AIIntegrationUpdateSource.assetIdentity(replacingAsset(id: 2, updatedAt: "2026-10-28T00:00:00Z")))
        XCTAssertNotEqual(AIIntegrationUpdateSource.assetIdentity(prior), AIIntegrationUpdateSource.assetIdentity(replacingAsset(id: 1, updatedAt: "2026-10-28T01:00:00Z")))
    }
}
