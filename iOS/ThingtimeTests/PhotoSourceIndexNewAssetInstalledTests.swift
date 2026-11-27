import XCTest
import UIKit
import Photos
import WebKit
import CryptoKit
import AppleFileSync
@testable import Thingtime

@MainActor
final class PhotoSourceIndexNewAssetInstalledTests: XCTestCase {
    func testLastDiscoverySurvivesReopen() async throws {
        let env = ProcessInfo.processInfo.environment
        guard env["THINGTIME_PHOTO_NEW_INDEX_TEST"] == "1", let base = env["THINGTIME_DEVICE_TEST_ORIGIN"],
              let origin = URL(string: base), ["localhost","127.0.0.1"].contains(origin.host ?? ""),
              let username = env["THINGTIME_DEVICE_TEST_USERNAME"], let password = env["THINGTIME_DEVICE_TEST_PASSWORD"],
              let raw = env["THINGTIME_PHOTO_REOPEN_RECEIPT"]?.data(using: .utf8) else { throw XCTSkip("Retained disposable fixture required") }
        let receipt = try XCTUnwrap(JSONSerialization.jsonObject(with: raw) as? [String: Any])
        let id = try XCTUnwrap(receipt["id"] as? String), local = try XCTUnwrap(receipt["localRootId"] as? String)
        let session = URLSession(configuration: .ephemeral); defer { session.invalidateAndCancel() }
        var login = URLRequest(url: origin.appendingPathComponent("api/v1/login")); login.httpMethod = "POST"
        login.setValue(base, forHTTPHeaderField: "Origin"); login.setValue("application/json", forHTTPHeaderField: "Content-Type")
        login.httpBody = try JSONSerialization.data(withJSONObject: ["username": username, "password": password])
        let (_, response) = try await session.data(for: login); XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        let (me, _) = try await session.data(from: origin.appendingPathComponent("api/v1/auth/me"))
        let identity = try XCTUnwrap(JSONSerialization.jsonObject(with: me) as? [String: Any])
        let owner = try XCTUnwrap((identity["user"] as? [String: Any])?["id"] as? String)
        let scope = try FileSyncOwnerScope(ownerId: owner, url: origin)
        let device = try XCTUnwrap(MobileDeviceKeychain.load(scope)?.deviceId)
        let progress = try XCTUnwrap(NativeDeferredUpload.shared.photoRunProgress(scope: scope, configurationId: id, rootId: local, deviceId: device))
        let activity = try XCTUnwrap(progress["activity"] as? [String: Any])
        let indexing = try XCTUnwrap(activity["indexing"] as? [String: Any])
        XCTAssertEqual(indexing["completed"] as? Int, 13); XCTAssertEqual(indexing["total"] as? Int, 13)
        let latest = try XCTUnwrap(activity["latestFound"] as? [String: Any])
        let captured = try XCTUnwrap(latest["capturedAt"] as? String)
        let date = try XCTUnwrap(ISO8601DateFormatter().date(from: captured))
        let library = try SystemPhotoResources().inventory()
        XCTAssertTrue(library.contains { $0.capturedAt.map { abs($0.timeIntervalSince(date)) < 2 } == true })
        print("IOS_PHOTO_LAST_DISCOVERY_REOPEN_PASS:13/13 indexing and the actual last indexed PhotoKit item survive terminal progress and reopen; no new media or rearm")
    }

    func testAutomaticNewPhotoIndex() async throws {
        let env = ProcessInfo.processInfo.environment
        guard env["THINGTIME_PHOTO_NEW_INDEX_TEST"] == "1", let base = env["THINGTIME_DEVICE_TEST_ORIGIN"],
              let origin = URL(string: base), origin.scheme == "http", ["localhost","127.0.0.1"].contains(origin.host ?? ""),
              let username = env["THINGTIME_DEVICE_TEST_USERNAME"], let password = env["THINGTIME_DEVICE_TEST_PASSWORD"],
              let raw = env["THINGTIME_PHOTO_REOPEN_RECEIPT"]?.data(using: .utf8) else { throw XCTSkip("Requires the retained disposable Photos fixture") }
        let receipt = try XCTUnwrap(JSONSerialization.jsonObject(with: raw) as? [String: Any])
        let id = try XCTUnwrap(receipt["id"] as? String), root = try XCTUnwrap(receipt["rootId"] as? String)
        let local = try XCTUnwrap(receipt["localRootId"] as? String)
        let session = URLSession(configuration: .ephemeral)
        defer { session.invalidateAndCancel() }
        func api(_ path: String, _ body: [String: Any]? = nil) async throws -> [String: Any] {
            var request = URLRequest(url: URL(string: path, relativeTo: origin)!.absoluteURL)
            request.setValue(base, forHTTPHeaderField: "Origin"); request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            if let body { request.httpMethod = "POST"; request.httpBody = try JSONSerialization.data(withJSONObject: body) }
            let (data, response) = try await session.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw NSError(domain: "NewPhotoIndex", code: 1) }
            return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        }
        _ = try await api("/api/v1/login", ["username": username, "password": password])
        let me = try await api("/api/v1/auth/me"), owner = try XCTUnwrap((me["user"] as? [String: Any])?["id"] as? String)
        let scope = try FileSyncOwnerScope(ownerId: owner, url: origin)
        let device = try XCTUnwrap(MobileDeviceKeychain.load(scope)?.deviceId)
        let grants = MobileFolderStore(); XCTAssertEqual(try grants.grant(scope, id: local).sourceKind, "photos")
        func nodes() async throws -> [[String: Any]] {
            let result = try await api("/api/v1/files?rootId=" + root)
            return try XCTUnwrap((result["inventory"] as? [String: Any])?["nodes"] as? [[String: Any]])
        }
        let before = try await nodes()
        XCTAssertEqual(before.count, 12)
        // Ordinary navigation starts the existing saved automatic connection.
        // No upload/retry button, run re-arm or checkpoint modification is used.
        func findWeb(_ view: UIView) -> WKWebView? {
            if let web = view as? WKWebView { return web }
            return view.subviews.lazy.compactMap(findWeb).first
        }
        let web = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows).compactMap(findWeb).first)
        web.load(URLRequest(url: origin.appendingPathComponent("things")))
        for _ in 0..<200 where web.isLoading { try await Task.sleep(for: .milliseconds(100)) }
        let provider = SystemPhotoResources(); XCTAssertEqual(provider.access(), "full")
        let name = "index-live-new-" + UUID().uuidString + ".png", date = Date().addingTimeInterval(3600)
        let width = 2048, height = 1536
        var pixels = [UInt8](repeating: 0, count: width * height * 3), seed: UInt32 = 0x84169bad
        for index in pixels.indices { seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5; pixels[index] = UInt8(truncatingIfNeeded: seed) }
        let data = try XCTUnwrap(CGDataProvider(data: Data(pixels) as CFData))
        let image = try XCTUnwrap(CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 24,
            bytesPerRow: width * 3, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGBitmapInfo(rawValue: 0), provider: data,
            decode: nil, shouldInterpolate: false, intent: .defaultIntent))
        let original = try XCTUnwrap(UIImage(cgImage: image).pngData())
        try await PHPhotoLibrary.shared().performChanges {
            let request = PHAssetCreationRequest.forAsset(); request.creationDate = date
            let options = PHAssetResourceCreationOptions(); options.originalFilename = name
            request.addResource(with: .photo, data: original, options: options)
        }
        let resource = try XCTUnwrap(provider.inventory().first { $0.name == name })
        let actualDates = try provider.inventory().compactMap(\.capturedAt)
        var sawIndexing = false, sawPending = false, published: [String: Any]?
        let deadline = Date().addingTimeInterval(600)
        while Date() < deadline {
            if let progress = try NativeDeferredUpload.shared.photoRunProgress(scope: scope, configurationId: id, rootId: local, deviceId: device),
               let activity = progress["activity"] as? [String: Any], let indexing = activity["indexing"] as? [String: Any],
               let total = indexing["total"] as? Int, total == 13, let completed = indexing["completed"] as? Int, completed > 0,
               let latest = activity["latestFound"] as? [String: Any], let captured = latest["capturedAt"] as? String,
               let foundDate = ISO8601DateFormatter().date(from: captured), actualDates.contains(where: { abs(foundDate.timeIntervalSince($0)) < 2 }) {
                sawIndexing = true
            }
            let result = try await api("/api/v1/files/sync-transfer-admissions", ["action": "read-source-index", "configurationId": id])
            let index = try XCTUnwrap(result["index"] as? [String: Any]), entries = try XCTUnwrap(index["entries"] as? [[String: Any]])
            let current = try await nodes()
            if let entry = entries.first(where: { $0["path"] as? String == resource.path }) {
                if current.allSatisfy({ $0["path"] as? String != resource.path }), entry["publication"] is NSNull { sawPending = true }
                if let node = current.first(where: { $0["path"] as? String == resource.path }), let file = node["file"] as? [String: Any],
                   let proof = entry["publication"] as? [String: Any] {
                    XCTAssertEqual(proof["fileId"] as? String, file["id"] as? String)
                    XCTAssertEqual(proof["sourceVersion"] as? String, entry["sourceVersion"] as? String)
                    published = file; break
                }
            }
            try await Task.sleep(for: .seconds(2))
        }
        XCTAssertTrue(sawIndexing, "New discovery must populate canonical native indexing/latestFound before or at publication")
        XCTAssertTrue(sawPending, "The new resource must be persisted remotely before its File is published")
        let file = try XCTUnwrap(published), content = try XCTUnwrap(file["content"] as? [String: Any])
        let attachment = try XCTUnwrap(content["attachmentId"] as? String)
        let (cloud, response) = try await session.data(from: origin.appendingPathComponent("api/v1/attachments/content").appending(queryItems: [URLQueryItem(name: "id", value: attachment), URLQueryItem(name: "cache", value: "bytes")]))
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        XCTAssertEqual(SHA256.hash(data: cloud), SHA256.hash(data: original))
        let after = try await nodes(); XCTAssertEqual(after.count, 13)
        for node in before {
            let old = try XCTUnwrap(node["file"] as? [String: Any])
            let same = try XCTUnwrap(after.first { $0["path"] as? String == node["path"] as? String }?["file"] as? [String: Any])
            XCTAssertEqual(same["id"] as? String, old["id"] as? String)
            XCTAssertEqual(same["revision"] as? String, old["revision"] as? String)
        }
        if sawIndexing && sawPending {
            print("IOS_PHOTO_NEW_INDEX_PASS: automatic discovery/live activity, pending cloud index, exact new File proof/hash and old12 revisions verified")
        } else {
            print("IOS_PHOTO_NEW_INDEX_INCOMPLETE: File proof/hash and old12 revisions verified, required live activity predicate failed")
        }
    }
}
