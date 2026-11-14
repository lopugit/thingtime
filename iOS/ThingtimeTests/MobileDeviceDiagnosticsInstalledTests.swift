import AppleFileSync
import UIKit
import WebKit
import XCTest
@testable import Thingtime

/// Explicit disposable-fixture acceptance. Uses normal owner authentication,
/// native pairing/status, production diagnostic outbox and paired transport.
@MainActor
final class MobileDeviceDiagnosticsInstalledTests: XCTestCase {
    func testNativeBackgroundOutcomeReachesExactOwnerDiagnostics() async throws {
        let env = ProcessInfo.processInfo.environment
        guard env["THINGTIME_DEVICE_DIAGNOSTICS_TEST"] == "1" else { throw XCTSkip("Opt in to isolated native diagnostics acceptance") }
        let base = try XCTUnwrap(env["THINGTIME_DEVICE_TEST_ORIGIN"]), origin = try XCTUnwrap(URL(string: base))
        guard origin.scheme == "http", ["127.0.0.1", "localhost"].contains(origin.host ?? "") else { throw CancellationError() }
        XCTAssertEqual(Bundle.main.object(forInfoDictionaryKey: "ThingtimeWebURL") as? String, base)
        let configuration = URLSessionConfiguration.ephemeral
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        func api(_ path: String, _ body: [String: Any]? = nil) async throws -> [String: Any] {
            var request = URLRequest(url: URL(string: path, relativeTo: origin)!.absoluteURL)
            request.setValue(base, forHTTPHeaderField: "Origin")
            if let body { request.httpMethod = "POST"; request.httpBody = try JSONSerialization.data(withJSONObject: body); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
            let (data, response) = try await session.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw NSError(domain: "DiagnosticsAcceptanceHTTP", code: (response as? HTTPURLResponse)?.statusCode ?? 0) }
            return try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        }
        _ = try await api("/api/v1/login", ["username": try XCTUnwrap(env["THINGTIME_DEVICE_TEST_USERNAME"]), "password": try XCTUnwrap(env["THINGTIME_DEVICE_TEST_PASSWORD"])])
        let identity = try await api("/api/v1/auth/me"), owner = try XCTUnwrap((identity["user"] as? [String: Any])?["id"] as? String)
        let manifest = try await api("/.well-known/thingtime-capabilities.json")
        for feature in ["api.devices-node-diagnostics", "api.devices-diagnostics"] {
            guard LopuVoiceContract.accepts(manifest, baseURL: origin, feature: feature, minimum: [1,0,0]) else { throw CancellationError() }
        }
        let scope = try FileSyncOwnerScope(ownerId: owner, url: origin)
        let transport: MobileDevicePairing.Transport = { request in
            let (data, response) = try await session.data(for: request)
            return (data, try XCTUnwrap(response as? HTTPURLResponse))
        }
        let pairing = MobileDevicePairing(load: MobileDeviceKeychain.load, save: MobileDeviceKeychain.save, transport: transport, cookie: { url in
            HTTPCookie.requestHeaderFields(with: configuration.httpCookieStorage?.cookies(for: url) ?? [])["Cookie"] ?? ""
        })
        let status = try await pairing.pair(scope, descriptor: ["name": "Native diagnostics acceptance", "model": "Simulator", "osVersion": UIDevice.current.systemVersion, "appVersion": "1.0"])
        let device = try XCTUnwrap(status.deviceId)
        XCTAssertEqual(status.state, "paired")
        func webView(in view: UIView) -> WKWebView? {
            if let web = view as? WKWebView { return web }
            return view.subviews.lazy.compactMap { webView(in: $0) }.first
        }
        var installedWeb: WKWebView?
        let sceneDeadline = Date().addingTimeInterval(30)
        while installedWeb == nil, Date() < sceneDeadline {
            installedWeb = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
                .filter(\.isKeyWindow).compactMap { webView(in: $0) }.first
            if installedWeb == nil { try await Task.sleep(for: .milliseconds(100)) }
        }
        let web = try XCTUnwrap(installedWeb)
        if let url = web.url, LopuVoiceContract.sameOrigin(url, origin), !web.isLoading {
            let existing = try await web.callAsyncJavaScript("return await (await fetch(origin + '/api/v1/auth/me', {credentials:'include'})).json()", arguments: ["origin": base], in: nil, contentWorld: .page) as? [String: Any]
            if let current = (existing?["user"] as? [String: Any])?["id"] as? String, current != owner {
                throw XCTSkip("Another account is signed into the simulator; preserve its session")
            }
        }
        for cookie in configuration.httpCookieStorage?.cookies(for: origin) ?? [] { await web.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) }
        web.load(URLRequest(url: origin))
        let webDeadline = Date().addingTimeInterval(20)
        while (web.isLoading || web.url == nil), Date() < webDeadline { try await Task.sleep(for: .milliseconds(100)) }
        guard web.url.map({ LopuVoiceContract.sameOrigin($0, origin) }) == true else { throw CancellationError() }
        let bridge = MobileDeviceBridge(), checked = expectation(description: "Normal native paired status")
        var verified = false
        bridge.handle(["payload": ["requestId": UUID().uuidString.lowercased(), "ownerId": owner, "action": "status"]], webView: web, root: origin,
            currentRoot: { origin }, cookies: { cookies, _ in cookies }, reply: { _, result in
                verified = result["state"] as? String == "paired" && result["deviceId"] as? String == device
                checked.fulfill()
            })
        await fulfillment(of: [checked], timeout: 30)
        guard verified else { XCTFail("Current native pairing/status did not authorize diagnostics"); return }
        let diagnostics = MobileDeviceDiagnostics.shared
        let recorder = try XCTUnwrap(diagnostics.recorder(for: scope, expectedDeviceId: device))
        var sent: [MobileDeviceDiagnosticEvent] = []
        let lease = await NativeUploadBackgroundCoordinator.shared.begin(presentation: .init(title: "Native diagnostics acceptance", subtitle: "Checking system outcome", completedSubtitle: "Completed", bytes: 1),
            diagnostic: { outcome, error in
                let event = NativePhotoDiagnosticProjection.outcome(outcome, error: error)
                sent.append(event); recorder(event)
            }, expired: {})
        lease?.finish(success: false)
        await diagnostics.flushAndWait()
        let deadline = Date().addingTimeInterval(30)
        var found: [[String: Any]] = []
        while Date() < deadline {
            let read = try await api("/api/v1/devices/diagnostics?deviceId=" + device)
            found = (read["events"] as? [[String: Any]] ?? []).filter { row in
                guard let id = row["eventId"] as? String else { return false }
                return sent.contains { $0.eventId == id }
            }
            if found.count == sent.count && !sent.isEmpty { break }
            try await diagnostics.flushAndWait(); try await Task.sleep(for: .milliseconds(250))
        }
        XCTAssertFalse(sent.isEmpty)
        XCTAssertEqual(found.count, sent.count)
        for event in sent {
            let row = try XCTUnwrap(found.first { $0["eventId"] as? String == event.eventId })
            XCTAssertEqual(row["deviceId"] as? String, device)
            let thing = try await api("/api/v1/things?id=" + (try XCTUnwrap(row["id"] as? String)))
            let crystal = try XCTUnwrap((thing["thing"] as? [String: Any])?["crystal"] as? [String: Any])
            let saved = try JSONDecoder().decode(MobileDeviceDiagnosticEvent.self, from: JSONSerialization.data(withJSONObject: try XCTUnwrap(crystal["event"] as? [String: Any])))
            XCTAssertEqual(saved, event)
        }
        var lifecycleEvents: [[String: Any]] = []
        var observedApplicationStates: [Int] = []
        if env["THINGTIME_DEVICE_DIAGNOSTICS_LIFECYCLE_TEST"] == "1" {
            let observers = [UIApplication.didEnterBackgroundNotification, UIApplication.didBecomeActiveNotification].map { name in
                NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { _ in
                    MainActor.assumeIsolated { observedApplicationStates.append(UIApplication.shared.applicationState.rawValue) }
                }
            }
            defer { observers.forEach(NotificationCenter.default.removeObserver) }
            let before = try await api("/api/v1/devices/diagnostics?deviceId=" + device)
            let prior = Set((before["events"] as? [[String: Any]] ?? []).compactMap { $0["eventId"] as? String })
            let ready = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("native-device-diagnostics-lifecycle-ready.json")
            try JSONSerialization.data(withJSONObject: ["origin": base, "ownerId": owner, "deviceId": device]).write(to: ready, options: .atomic)
            defer { try? FileManager.default.removeItem(at: ready) }
            let lifecycleDeadline = Date().addingTimeInterval(45)
            while Date() < lifecycleDeadline {
                await diagnostics.flushAndWait()
                let read = try await api("/api/v1/devices/diagnostics?deviceId=" + device)
                lifecycleEvents = (read["events"] as? [[String: Any]] ?? []).filter { row in
                    guard row["deviceId"] as? String == device,
                          let id = row["eventId"] as? String, !prior.contains(id) else { return false }
                    return ["app.background", "app.foreground"].contains(row["code"] as? String ?? "")
                }
                if Set(lifecycleEvents.compactMap { $0["code"] as? String }) == ["app.background", "app.foreground"] { break }
                try await Task.sleep(for: .milliseconds(250))
            }
            XCTAssertEqual(Set(lifecycleEvents.compactMap { $0["code"] as? String }), ["app.background", "app.foreground"])
            XCTAssertTrue(observedApplicationStates.contains(UIApplication.State.background.rawValue))
            XCTAssertTrue(observedApplicationStates.contains(UIApplication.State.active.rawValue))
        }
        let output: [String: Any] = ["origin": base, "ownerId": owner, "deviceId": device, "eventIds": sent.map(\.eventId),
            "outcomes": sent.compactMap { $0.background?.outcome?.rawValue }, "exactPayloads": found.count == sent.count,
            "lifecycleEvents": lifecycleEvents,
            "observedApplicationStates": observedApplicationStates,
            "systemErrors": sent.compactMap { $0.systemError }.map { ["domain": $0.domain.rawValue, "code": $0.code] as [String: Any] }]
        let file = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("native-device-diagnostics-acceptance.json")
        try JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys]).write(to: file, options: .atomic)
        guard found.count == sent.count, !sent.isEmpty else { return }
        if env["THINGTIME_DEVICE_DIAGNOSTICS_LIFECYCLE_TEST"] == "1" {
            guard Set(lifecycleEvents.compactMap { $0["code"] as? String }) == ["app.background", "app.foreground"],
                  observedApplicationStates.contains(UIApplication.State.background.rawValue),
                  observedApplicationStates.contains(UIApplication.State.active.rawValue) else { return }
        }
        print("IOS_DEVICE_DIAGNOSTICS_PASS: normal native status, \(sent.count) exact paired outcomes independently owner-read")
    }
}
