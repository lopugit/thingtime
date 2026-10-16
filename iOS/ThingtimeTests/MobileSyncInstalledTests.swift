import XCTest
import WebKit
import UIKit
@testable import Thingtime

/// Opt-in setup for CUA/manual acceptance of the actual installed app surface.
/// Authenticates a disposable loopback account through the normal login API; no
/// native grants, write approvals, pairing or transfer responses are fabricated.
/// All picker/consent/connection controls must be operated through the visible UI.
@MainActor
final class MobileSyncInstalledTests: XCTestCase {
    private func webView(in view: UIView) -> WKWebView? {
        if let web = view as? WKWebView { return web }
        return view.subviews.lazy.compactMap { self.webView(in: $0) }.first
    }
    func testInstalledFolderDownloadControls() async throws {
        let env = ProcessInfo.processInfo.environment
        guard env["THINGTIME_SYNC_INSTALLED_ACCEPTANCE"] == "1", let base = env["THINGTIME_DEVICE_TEST_ORIGIN"],
              let origin = URL(string: base), origin.scheme == "http", ["localhost", "127.0.0.1"].contains(origin.host ?? ""),
              let username = env["THINGTIME_DEVICE_TEST_USERNAME"], let password = env["THINGTIME_DEVICE_TEST_PASSWORD"] else {
            throw XCTSkip("Run the opt-in installed-app acceptance with a disposable local account")
        }
        guard (Bundle.main.object(forInfoDictionaryKey: "ThingtimeWebURL") as? String) == base else {
            XCTFail("Build and fixture must select the identical loopback origin"); return
        }
        let configuration = URLSessionConfiguration.ephemeral, session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        func api(_ path: String, body: [String: Any]? = nil) async throws -> [String: Any] {
            var request = URLRequest(url: URL(string: path, relativeTo: origin)!.absoluteURL)
            request.setValue(base, forHTTPHeaderField: "Origin"); request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            if let body { request.httpMethod = "POST"; request.httpBody = try JSONSerialization.data(withJSONObject: body) }
            let (data, response) = try await session.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200, let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw MobileFolderStore.Failure.unavailable }
            return value
        }
        _ = try await api("/api/v1/login", body: ["username": username, "password": password])
        let identity = try await api("/api/v1/auth/me"), owner = try XCTUnwrap((identity["user"] as? [String: Any])?["id"] as? String)
        var found: WKWebView?
        for _ in 0..<600 {
            found = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
                .filter(\.isKeyWindow).compactMap { self.webView(in: $0) }.first
            if let web = found, let url = web.url, LopuVoiceContract.sameOrigin(url, origin), !web.isLoading,
               let documentOrigin = try? await web.evaluateJavaScript("location.origin"), documentOrigin as? String == base { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        let web = try XCTUnwrap(found)
        guard let url = web.url, LopuVoiceContract.sameOrigin(url, origin) else { throw MobileFolderStore.Failure.unavailable }
        let existing = try await web.callAsyncJavaScript("return await (await fetch(origin + '/api/v1/auth/me', {credentials:'include'})).json()", arguments: ["origin": base], in: nil, contentWorld: .page) as? [String: Any]
        if let current = (existing?["user"] as? [String: Any])?["id"] as? String, current != owner {
            throw XCTSkip("Another account is signed into the simulator; preserve its session")
        }
        let cookies = configuration.httpCookieStorage?.cookies(for: origin) ?? []
        XCTAssertFalse(cookies.isEmpty)
        for cookie in cookies { await web.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) }
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let selected = documents.appendingPathComponent("Download acceptance " + UUID().uuidString.prefix(8), isDirectory: true)
        try FileManager.default.createDirectory(at: selected, withIntermediateDirectories: true)
        let control = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("MobileSyncInstalledAcceptance", isDirectory: true)
        try FileManager.default.createDirectory(at: control, withIntermediateDirectories: true)
        let completion = control.appendingPathComponent("complete.json")
        if FileManager.default.fileExists(atPath: completion.path) { try FileManager.default.removeItem(at: completion) }
        try JSONSerialization.data(withJSONObject: ["ownerId": owner, "origin": base, "selected": selected.path])
            .write(to: control.appendingPathComponent("ready.json"), options: .atomic)
        web.load(URLRequest(url: origin.appendingPathComponent("things")))
        print("Installed sync acceptance ready; use the visible Things, Files picker and native consent controls.")
        for _ in 0..<1200 {
            if FileManager.default.fileExists(atPath: completion.path) {
                let done = try JSONSerialization.jsonObject(with: Data(contentsOf: completion)) as? [String: Any]
                XCTAssertEqual(done?["verified"] as? Bool, true)
                return
            }
            try await Task.sleep(nanoseconds: 500_000_000)
        }
        XCTFail("Installed-app acceptance did not finish within ten minutes")
    }
}
