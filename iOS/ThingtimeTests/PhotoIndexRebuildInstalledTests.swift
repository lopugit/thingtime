import AppleFileSync
import CryptoKit
import Photos
import UIKit
import WebKit
import XCTest
@testable import Thingtime

/// Opt-in acceptance over an already completed disposable Photos backup. This
/// exercises the owner HTTP discard and ordinary app-entry recovery, never a
/// journal rewrite, upload rearm, or fabricated native authorization.
@MainActor
final class PhotoIndexRebuildInstalledTests: XCTestCase {
    private func webView(in view: UIView) -> WKWebView? {
        if let web = view as? WKWebView { return web }
        return view.subviews.lazy.compactMap { self.webView(in: $0) }.first
    }
    func testOwnerMetadataDiscardRebuildsWithoutReuploadingOriginals() async throws {
        let env = ProcessInfo.processInfo.environment
        guard env["THINGTIME_PHOTO_INDEX_REBUILD_TEST"] == "1" else {
            throw XCTSkip("Use the explicit retained-fixture metadata rebuild acceptance")
        }
        let base = try XCTUnwrap(env["THINGTIME_DEVICE_TEST_ORIGIN"]), origin = try XCTUnwrap(URL(string: base))
        guard origin.scheme == "http", ["127.0.0.1", "localhost"].contains(origin.host ?? "") else { throw CancellationError() }
        XCTAssertEqual(Bundle.main.object(forInfoDictionaryKey: "ThingtimeWebURL") as? String, base)
        let input = try XCTUnwrap(env["THINGTIME_PHOTO_REOPEN_RECEIPT"]?.data(using: .utf8))
        let receipt = try XCTUnwrap(try JSONSerialization.jsonObject(with: input) as? [String: Any])
        let configId = try XCTUnwrap(receipt["id"] as? String), rootId = try XCTUnwrap(receipt["rootId"] as? String)
        let grantId = try XCTUnwrap(receipt["localRootId"] as? String), expectedOwner = try XCTUnwrap(receipt["ownerId"] as? String)
        let baseline = try XCTUnwrap(receipt["baselineFiles"] as? [[String: Any]])
        let resumedDiscard = receipt["discardedIndexId"] as? String
        guard !baseline.isEmpty else { throw CancellationError() }
        let session = URLSession(configuration: .ephemeral)
        defer { session.invalidateAndCancel() }
        var evidence: [String: Any] = ["origin": base, "ownerId": expectedOwner, "configurationId": configId, "expectedFiles": baseline.count]
        let output = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("photo-index-rebuild-acceptance.json")
        func save() throws { try JSONSerialization.data(withJSONObject: evidence, options: [.sortedKeys, .prettyPrinted]).write(to: output, options: .atomic) }
        func api(_ path: String, _ body: [String: Any]? = nil) async throws -> [String: Any] {
            var request = URLRequest(url: URL(string: path, relativeTo: origin)!.absoluteURL, timeoutInterval: 20)
            request.setValue(base, forHTTPHeaderField: "Origin"); request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            if let body { request.httpMethod = "POST"; request.httpBody = try JSONSerialization.data(withJSONObject: body) }
            let (data, response) = try await session.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw NSError(domain: "PhotoIndexRebuildHTTP", code: (response as? HTTPURLResponse)?.statusCode ?? 0) }
            return try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        }
        func inventory() async throws -> [[String: Any]] {
            let result = try await api("/api/v1/files?rootId=" + rootId)
            return try XCTUnwrap((result["inventory"] as? [String: Any])?["nodes"] as? [[String: Any]])
        }
        func verifyFiles(_ nodes: [[String: Any]]) async throws {
            XCTAssertEqual(nodes.count, baseline.count)
            XCTAssertEqual(Set(nodes.compactMap { ($0["file"] as? [String: Any])?["id"] as? String }).count, baseline.count)
            for expected in baseline {
                let path = try XCTUnwrap(expected["path"] as? String)
                let file = try XCTUnwrap(nodes.first { $0["path"] as? String == path }?["file"] as? [String: Any])
                XCTAssertEqual(file["id"] as? String, expected["id"] as? String)
                XCTAssertEqual(file["revision"] as? String, expected["revision"] as? String)
                let content = try XCTUnwrap(file["content"] as? [String: Any]), id = try XCTUnwrap(content["attachmentId"] as? String)
                let (bytes, response) = try await session.data(from: origin.appendingPathComponent("api/v1/attachments/content").appending(queryItems: [.init(name: "id", value: id), .init(name: "cache", value: "bytes")]))
                XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
                XCTAssertEqual(bytes.count, expected["bytes"] as? Int)
                XCTAssertEqual(SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined(), expected["sha256"] as? String)
            }
        }
        _ = try await api("/api/v1/login", ["username": try XCTUnwrap(env["THINGTIME_DEVICE_TEST_USERNAME"]), "password": try XCTUnwrap(env["THINGTIME_DEVICE_TEST_PASSWORD"])])
        let me = try await api("/api/v1/auth/me")
        guard (me["user"] as? [String: Any])?["id"] as? String == expectedOwner else { throw CancellationError() }
        let manifest = try await api("/.well-known/thingtime-capabilities.json")
        guard LopuVoiceContract.accepts(manifest, baseURL: origin, feature: "api.file-sync-transfer-admissions", minimum: [1,8,0]) else { throw CancellationError() }
        let scope = try FileSyncOwnerScope(ownerId: expectedOwner, url: origin)
        let device = try XCTUnwrap(MobileDeviceKeychain.load(scope)?.deviceId)
        let runs = NativePhotoRunStore(directory: NativeDeferredUploadStore().url.deletingLastPathComponent())
        // The ordinary initial launch may already be doing its no-change pass.
        // Observe its completed checkpoint before the explicit metadata discard.
        let setupDeadline = Date().addingTimeInterval(60)
        while resumedDiscard == nil && Date() < setupDeadline {
            if try runs.load().first(where: { $0.scope == scope && $0.authorization.id == configId && $0.rootId == grantId && $0.authorization.scope.deviceId == device })?.stage == "complete" { break }
            try await Task.sleep(for: .milliseconds(250))
        }
        let before = try XCTUnwrap(try runs.load().first { $0.scope == scope && $0.authorization.id == configId && $0.rootId == grantId && $0.authorization.scope.deviceId == device })
        guard (resumedDiscard != nil || before.stage == "complete"), before.armed, before.userPaused != true, !before.authorization.configuration.paused else { throw CancellationError() }
        if let epoch = receipt["byteEpoch"] as? String { XCTAssertEqual(before.epoch.uuidString.lowercased(), epoch.lowercased()) }
        if let runId = receipt["runId"] as? String { XCTAssertEqual(before.runId, runId) }
        _ = try MobileFolderStore().grant(scope, id: grantId)
        let configurationBefore = try await api("/api/v1/things?id=" + configId)
        try await verifyFiles(try await inventory())
        let resources = try SystemPhotoResources().inventory()
        XCTAssertEqual(Set(resources.map(\.path)), Set(baseline.compactMap { $0["path"] as? String }))
        evidence["sourceAssetCount"] = PHAsset.fetchAssets(with: nil).count
        let budgetURL = NativeDeferredUploadStore().url.deletingLastPathComponent().appendingPathComponent("NativePhotoUploadBudget-v1")
            .appendingPathComponent(PhotoLibraryReader.hash(Data([scope.origin.absoluteString, scope.ownerId, device].joined(separator: "\n").utf8)) + ".json")
        func budget() throws -> (buckets: [String: Int64], reservations: Set<String>, hash: String) {
            let data = try Data(contentsOf: budgetURL), state = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
            var buckets: [String: Int64] = [:]
            for row in state["buckets"] as? [[String: Any]] ?? [] {
                let key = "\(row["until"] ?? "")|\(row["rootId"] ?? "")|\(row["configurationId"] ?? "")"
                buckets[key, default: 0] += (row["bytes"] as? NSNumber)?.int64Value ?? 0
            }
            let pending = (state["reservations"] as? [[String: Any]] ?? []) + ((state["pending"] as? [String: Any]).map { [$0] } ?? [])
            return (buckets, Set(pending.compactMap { $0["id"] as? String }), PhotoLibraryReader.hash(data))
        }
        let budgetBefore = try budget()
        if let priorHash = receipt["baselineBudgetHash"] as? String { XCTAssertEqual(budgetBefore.hash, priorHash, "The upgrade must preserve prior payload consumption") }
        let old = try await api("/api/v1/files/sync-transfer-admissions", ["action": "read-source-index", resumedDiscard == nil ? "configurationId" : "indexId": resumedDiscard ?? configId])
        let oldIndex = try XCTUnwrap(old["index"] as? [String: Any]), oldId = try XCTUnwrap(oldIndex["indexId"] as? String), oldEpoch = try XCTUnwrap(oldIndex["epoch"] as? String)
        if resumedDiscard != nil {
            guard oldIndex["discarded"] as? Bool == true else { throw CancellationError() }
            XCTAssertEqual(oldId, resumedDiscard)
            XCTAssertEqual(oldEpoch, receipt["discardedMetadataEpoch"] as? String)
        } else {
            guard oldIndex["scanComplete"] as? Bool == true, oldIndex["discoveredResources"] as? Int == baseline.count else { throw CancellationError() }
        }
        evidence["oldIndexId"] = oldId; evidence["oldMetadataEpoch"] = oldEpoch; evidence["byteEpoch"] = before.epoch.uuidString; evidence["runId"] = before.runId
        evidence["budgetBeforeHash"] = budgetBefore.hash; evidence["phase"] = "owner-discard"
        try save()
        // This is the only intended mutation: the supported current-owner,
        // exact-index discard. No source grant, saved policy or run is edited.
        var hasMore = resumedDiscard == nil
        evidence["resumedPreviouslyProvenDiscard"] = resumedDiscard != nil
        for _ in 0..<8 where hasMore {
            let result = try await api("/api/v1/files/sync-transfer-admissions", ["action": "discard-source-index", "indexId": oldId])
            let discarded = try XCTUnwrap(result["index"] as? [String: Any])
            guard discarded["discarded"] as? Bool == true, discarded["indexId"] as? String == oldId else { throw CancellationError() }
            hasMore = discarded["hasMore"] as? Bool == true
        }
        guard !hasMore else { throw CancellationError() }
        let removed = try await api("/api/v1/files/sync-transfer-admissions", ["action": "read-source-index", "indexId": oldId])
        XCTAssertEqual((removed["index"] as? [String: Any])?["discarded"] as? Bool, true)
        evidence["ownerDiscarded"] = true
        var found: WKWebView?
        for _ in 0..<300 {
            found = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).filter(\.isKeyWindow).compactMap { self.webView(in: $0) }.first
            if let web = found, !web.isLoading, (try? await web.evaluateJavaScript("location.origin")) as? String == base { break }
            try await Task.sleep(for: .milliseconds(100))
        }
        let web = try XCTUnwrap(found)
        let current = try await web.callAsyncJavaScript("return await(await fetch('/api/v1/auth/me')).json()", arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
        guard (current?["user"] as? [String: Any])?["id"] as? String == expectedOwner else { throw CancellationError() }
        web.load(URLRequest(url: origin)) // ordinary app/page foreground entry; no Retry or native rearm
        evidence["phase"] = "ordinary-foreground-rebuild"; try save()
        let began = Date(), deadline = began.addingTimeInterval(420)
        var observations: [[String: Any]] = [], last = "", rebuilt: [String: Any]?
        while Date() < deadline {
            let live = try XCTUnwrap(try runs.load().first { $0.sameRun(before) })
            XCTAssertEqual(live.epoch, before.epoch)
            let result = try await api("/api/v1/files/sync-transfer-admissions", ["action": "read-source-index", "configurationId": configId])
            let index = try XCTUnwrap(result["index"] as? [String: Any])
            let row: [String: Any] = ["elapsed": Date().timeIntervalSince(began), "stage": live.stage ?? "unknown", "nativeMetadataEpoch": live.sourceIndexMetadataEpoch as Any? ?? NSNull(), "indexId": index["indexId"] ?? NSNull(), "metadataEpoch": index["epoch"] ?? NSNull(), "discarded": index["discarded"] ?? false, "scanComplete": index["scanComplete"] ?? false, "resources": index["discoveredResources"] ?? 0, "publications": (index["entries"] as? [[String: Any]] ?? []).filter { $0["publication"] is [String: Any] }.count]
            let signature = "\(live.stage ?? "")|\(live.sourceIndexMetadataEpoch ?? "")|\(index["indexId"] ?? "")|\(index["discoveredResources"] ?? 0)|\(row["publications"] ?? 0)"
            if signature != last { observations.append(row); evidence["observations"] = observations; last = signature; try save() }
            if index["indexId"] as? String != oldId, index["epoch"] as? String != oldEpoch,
               index["scanComplete"] as? Bool == true, index["discoveredResources"] as? Int == baseline.count,
               row["publications"] as? Int == baseline.count, live.stage == "complete" { rebuilt = index; break }
            try await Task.sleep(for: .seconds(2))
        }
        evidence["elapsed"] = Date().timeIntervalSince(began); evidence["rebuilt"] = rebuilt != nil
        let after = try XCTUnwrap(try runs.load().first { $0.sameRun(before) })
        XCTAssertEqual(after.epoch, before.epoch); XCTAssertEqual(after.runId, before.runId)
        XCTAssertEqual(after.authorization, before.authorization); XCTAssertEqual(after.grantRevision, before.grantRevision)
        let budgetAfter = try budget()
        for (key, bytes) in budgetAfter.buckets { XCTAssertLessThanOrEqual(bytes, budgetBefore.buckets[key] ?? 0, "Metadata rebuild must not emit new blob payload bytes") }
        XCTAssertTrue(budgetAfter.reservations.isSubset(of: budgetBefore.reservations))
        if let priorHash = receipt["baselineBudgetHash"] as? String { XCTAssertEqual(budgetAfter.hash, priorHash) }
        evidence["budgetAfterHash"] = budgetAfter.hash; evidence["newPayloadBytes"] = budgetAfter.buckets.reduce(Int64(0)) { $0 + max(0, $1.value - (budgetBefore.buckets[$1.key] ?? 0)) }
        try await verifyFiles(try await inventory())
        let configurationAfter = try await api("/api/v1/things?id=" + configId)
        XCTAssertEqual((configurationAfter["thing"] as? [String: Any])?["updatedAt"] as? String, (configurationBefore["thing"] as? [String: Any])?["updatedAt"] as? String)
        evidence["files"] = baseline; evidence["phase"] = rebuilt == nil ? "rebuild-incomplete" : "verified-complete"
        if let rebuilt { evidence["newIndexId"] = rebuilt["indexId"]; evidence["newMetadataEpoch"] = rebuilt["epoch"] }
        try save()
        guard rebuilt != nil else { XCTFail("Owner metadata discard was not rebuilt by ordinary foreground recovery before the finite deadline"); return }
        print("IOS_PHOTO_INDEX_REBUILD_PASS: \(baseline.count) originals, new metadata epoch, same byte epoch and file receipts, no new payload bytes")
    }
}
