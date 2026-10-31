import XCTest
import WebKit
import UIKit
import CryptoKit
@testable import Thingtime

@MainActor
private final class HistoryExportReplies: NSObject, WKScriptMessageHandler {
    var values: [[String: Any]] = []
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let value = message.body as? [String: Any] else { return }
        values.append(value)
    }
    func wait(for count: Int) async throws {
        for _ in 0..<1200 {
            if values.count >= count { return }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        throw NSError(domain: "FileExportAcceptance", code: 3,
            userInfo: [NSLocalizedDescriptionKey: "Timed out waiting for native export replies: received \(values.count), expected \(count)"])
    }
}

/// Real API fixtures and installed History, with CUA/manual interaction for every
/// History action and Files picker. No fabricated native callbacks or completion file.
@MainActor
final class FileExportInstalledTests: XCTestCase {
    private func webView(in view: UIView) -> WKWebView? {
        if let web = view as? WKWebView { return web }
        return view.subviews.lazy.compactMap { self.webView(in: $0) }.first
    }
    private func awaitTrue(_ web: WKWebView, _ expression: String, seconds: Int = 300) async throws {
        for _ in 0..<(seconds * 4) {
            if (try? await web.evaluateJavaScript(expression)) as? Bool == true { return }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        throw NSError(domain: "FileExportAcceptance", code: 1, userInfo: [NSLocalizedDescriptionKey: "Timed out waiting for installed History interaction"])
    }
    func testHistoryExportsAndRestore() async throws {
        let env = ProcessInfo.processInfo.environment
        guard env["THINGTIME_FILE_EXPORT_TEST"] == "1", let base = env["THINGTIME_DEVICE_TEST_ORIGIN"],
              let origin = URL(string: base), origin.scheme == "http", ["localhost", "127.0.0.1"].contains(origin.host ?? ""),
              let username = env["THINGTIME_DEVICE_TEST_USERNAME"], let password = env["THINGTIME_DEVICE_TEST_PASSWORD"] else {
            throw XCTSkip("Run opt-in installed export acceptance with a disposable loopback account")
        }
        XCTAssertEqual(Bundle.main.object(forInfoDictionaryKey: "ThingtimeWebURL") as? String, base)
        let configuration = URLSessionConfiguration.ephemeral, session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        func api(_ path: String, body: [String: Any]? = nil) async throws -> [String: Any] {
            var request = URLRequest(url: URL(string: path, relativeTo: origin)!.absoluteURL)
            request.setValue(base, forHTTPHeaderField: "Origin"); request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            if let body { request.httpMethod = "POST"; request.httpBody = try JSONSerialization.data(withJSONObject: body) }
            let (data, response) = try await session.data(for: request)
            guard (200..<300).contains((response as? HTTPURLResponse)?.statusCode ?? 0),
                  let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw NSError(domain: "FileExportAcceptance", code: 2, userInfo: [NSLocalizedDescriptionKey: "Fixture API refused \(path.components(separatedBy: "?")[0]) (HTTP \((response as? HTTPURLResponse)?.statusCode ?? 0))"])
            }
            return result
        }
        _ = try await api("/api/v1/login", body: ["username": username, "password": password])
        let identity = try await api("/api/v1/auth/me"), owner = try XCTUnwrap((identity["user"] as? [String: Any])?["id"] as? String)
        var found: WKWebView?
        for _ in 0..<600 {
            found = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
                .filter(\.isKeyWindow).compactMap { self.webView(in: $0) }.first
            if let web = found, !web.isLoading, (try? await web.evaluateJavaScript("location.origin")) as? String == base { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        let web = try XCTUnwrap(found)
        // Observe real replies at document start. Dev-server reloads must not
        // silently erase a page-global counter while Files writes still succeed.
        let exports = HistoryExportReplies(), replyHandler = "thingtimeHistoryAcceptanceReplies"
        web.configuration.userContentController.add(exports, name: replyHandler)
        web.configuration.userContentController.addUserScript(WKUserScript(source:
            "window.addEventListener('thingtime:native-message',e=>{if(e.detail?.type==='file-export-result')window.webkit.messageHandlers.thingtimeHistoryAcceptanceReplies.postMessage(e.detail.payload)})",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        defer { web.configuration.userContentController.removeScriptMessageHandler(forName: replyHandler) }
        let existing = try await web.callAsyncJavaScript("return await (await fetch('/api/v1/auth/me')).json()", arguments: [:], in: nil, contentWorld: .page) as? [String: Any]
        if let current = (existing?["user"] as? [String: Any])?["id"] as? String, current != owner { throw XCTSkip("Preserve the simulator's other signed-in account") }
        let cookies = configuration.httpCookieStorage?.cookies(for: origin) ?? []; XCTAssertFalse(cookies.isEmpty)
        for cookie in cookies { await web.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) }
        func upload(_ bytes: Data) async throws -> [String: Any] {
            let start = try await api("/api/v1/attachments/uploads", body: ["requestId": UUID().uuidString.lowercased(), "filename": "ios-history.bin", "contentType": "application/octet-stream", "sizeBytes": bytes.count, "purpose": "file"])
            let id = try XCTUnwrap((start["upload"] as? [String: Any])?["id"] as? String)
            let parts = try await api("/api/v1/attachments/uploads/parts", body: ["uploadId": id, "parts": [["partNumber": 1, "checksumSha256": Data(SHA256.hash(data: bytes)).base64EncodedString()]]])
            let part = try XCTUnwrap((parts["parts"] as? [[String: Any]])?.first)
            let url = try XCTUnwrap(URL(string: try XCTUnwrap(part["url"] as? String), relativeTo: origin)?.absoluteURL)
            guard url.scheme == "https" || LopuVoiceContract.sameOrigin(url, origin) else { throw URLError(.badURL) }
            var put = URLRequest(url: url); put.httpMethod = "PUT"; put.httpBody = bytes
            for (key, value) in part["headers"] as? [String: String] ?? [:] { put.setValue(value, forHTTPHeaderField: key) }
            let (_, response) = try await session.data(for: put); XCTAssertTrue((200..<300).contains((response as? HTTPURLResponse)?.statusCode ?? 0))
            _ = try await api("/api/v1/attachments/uploads/complete", body: ["uploadId": id])
            let fingerprint = try await api("/api/v1/attachments/content?id=\(id)&fingerprint=1")
            return ["attachmentId": id, "version": try XCTUnwrap(fingerprint["version"] as? String)]
        }
        let id = UUID().uuidString.lowercased(), name = "iOS history " + String(id.prefix(8)) + ".bin"
        func commit(_ content: [String: Any], revision: Any, trashed: Bool = false) async throws -> [String: Any] {
            let result = try await api("/api/v1/files", body: ["id": id, "operationId": UUID().uuidString.lowercased(), "expectedRevision": revision,
                "name": name, "folderId": NSNull(), "attachmentId": content["attachmentId"]!, "contentVersion": content["version"]!, "trashed": trashed])
            return try XCTUnwrap(result["file"] as? [String: Any])
        }
        let before = Data(repeating: 11, count: 128), after = Data(repeating: 22, count: 257)
        let first = try await upload(before), second = try await upload(after)
        var current = try await commit(first, revision: NSNull())
        current = try await commit(second, revision: try XCTUnwrap(current["revision"]))
        let replacementRevision = try XCTUnwrap(current["revision"] as? String)
        let selected = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("History export " + String(id.prefix(8)), isDirectory: true)
        try FileManager.default.createDirectory(at: selected, withIntermediateDirectories: true)
        var failure: Error?
        do {
            web.load(URLRequest(url: URL(string: "/history?storage=home&kind=file&q=iOS&thing=\(id)", relativeTo: origin)!.absoluteURL))
            try await awaitTrue(web, "document.querySelectorAll('.history-event').length === 2", seconds: 60)
            print("IOS_EXPORT_READY: Open the update History row. Cancel the first save, then save both versions into \(selected.lastPathComponent). File: \(name)")
            try await exports.wait(for: 1)
            let cancelled = exports.values[0]
            XCTAssertEqual(cancelled["saved"] as? Bool, false); XCTAssertNil(cancelled["error"])
            XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: selected.path), [])
            let unchanged = try await api("/api/v1/files?id=\(id)")
            XCTAssertEqual((unchanged["file"] as? [String: Any])?["revision"] as? String, replacementRevision)
            print("IOS_EXPORT_CANCEL_PASS: Save the earlier and later versions into the prepared folder.")
            try await exports.wait(for: 3)
            let replies = Array(exports.values[1..<3])
            XCTAssertTrue(replies.allSatisfy { $0["saved"] as? Bool == true && $0["error"] == nil })
            XCTAssertEqual(try Data(contentsOf: selected.appendingPathComponent(name)), before)
            let collision = (name as NSString).deletingPathExtension + " (1).bin"
            XCTAssertEqual(try Data(contentsOf: selected.appendingPathComponent(collision)), after)
            XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: selected.path).sorted(), [name, collision].sorted())
            print("IOS_EXPORT_BYTES_PASS: Both destination files match independently. Review and cancel restore, then review and restore the earlier version.")
            try await awaitTrue(web, "document.body.innerText.includes('Restore this version')")
            try await awaitTrue(web, "!document.body.innerText.includes('Restore this version')")
            let cancelledRestore = try await api("/api/v1/files?id=\(id)")
            XCTAssertEqual((cancelledRestore["file"] as? [String: Any])?["revision"] as? String, replacementRevision)
            print("IOS_RESTORE_CANCEL_PASS: Apply the earlier version through Review restore.")
            try await awaitTrue(web, "document.body.innerText.includes('File version restored. Earlier versions remain in History.')")
            let currentValue = try await api("/api/v1/files?id=\(id)")
            current = try XCTUnwrap(currentValue["file"] as? [String: Any])
            XCTAssertEqual((current["content"] as? [String: Any])?["attachmentId"] as? String, first["attachmentId"] as? String)
            XCTAssertNotEqual(current["revision"] as? String, replacementRevision)
            for (content, bytes) in [(first, before), (second, after)] {
                let path = "/api/v1/attachments/content?id=\(content["attachmentId"]!)&cache=bytes"
                let (saved, response) = try await session.data(from: URL(string: path, relativeTo: origin)!.absoluteURL)
                XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200); XCTAssertEqual(saved, bytes)
            }
            print("IOS_HISTORY_PASS: Installed History cancel, two verified exports, restore cancel/commit and both retained cloud versions.")
        } catch { failure = error }
        let currentValue = try await api("/api/v1/files?id=\(id)")
        current = try XCTUnwrap(currentValue["file"] as? [String: Any])
        _ = try await commit(try XCTUnwrap(current["content"] as? [String: Any]), revision: try XCTUnwrap(current["revision"]), trashed: true)
        if let failure { throw failure }
    }
}
