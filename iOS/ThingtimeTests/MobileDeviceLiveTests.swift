import XCTest
@testable import Thingtime

/// Opt-in contract acceptance against the running local API and a disposable
/// account created through auth/register. Never takes credentials from the app.
@MainActor
final class MobileDeviceLiveTests: XCTestCase {
    func testPairReadbackAndResumeAgainstSelectedAPI() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let base = env["THINGTIME_DEVICE_TEST_ORIGIN"], let url = URL(string: base),
              let username = env["THINGTIME_DEVICE_TEST_USERNAME"], let password = env["THINGTIME_DEVICE_TEST_PASSWORD"] else {
            throw XCTSkip("Set disposable local device-test account environment variables to run live acceptance")
        }
        guard url.scheme == "http", ["127.0.0.1", "localhost"].contains(url.host ?? "") else { XCTFail("Live acceptance requires a local test origin"); return }
        let config = URLSessionConfiguration.ephemeral
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        func json(_ path: String, body: [String: Any]? = nil) async throws -> [String: Any] {
            var request = URLRequest(url: URL(string: path, relativeTo: url)!.absoluteURL)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue(base, forHTTPHeaderField: "Origin")
            if let body { request.httpMethod = "POST"; request.httpBody = try MobileDevicePairing.json(body) }
            let (data, response) = try await session.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  let result = try JSONSerialization.jsonObject(with: data) as? [String: Any], result["ok"] as? Bool != false else {
                throw MobileDevicePairing.Failure.invalid
            }
            return result
        }
        _ = try await json("/api/v1/login", body: ["username": username, "password": password])
        let identity = try await json("/api/v1/auth/me")
        let owner = try XCTUnwrap((identity["user"] as? [String: Any])?["id"] as? String)
        let scope = try MobileDevicePairing.Scope(ownerId: owner, url: url)
        func engine() -> MobileDevicePairing {
            MobileDevicePairing(load: MobileDeviceKeychain.load, save: MobileDeviceKeychain.save,
                transport: { request in
                    let (data, response) = try await session.data(for: request)
                    return (data, try XCTUnwrap(response as? HTTPURLResponse))
                }, cookie: { target in HTTPCookie.requestHeaderFields(with: config.httpCookieStorage?.cookies(for: target) ?? [])["Cookie"] ?? "" })
        }
        let paired = try await engine().pair(scope, descriptor: ["name": "Mobile pairing QA", "model": "iOS Simulator", "osVersion": "17.0", "appVersion": "1.0"])
        XCTAssertEqual(paired.state, "paired")
        let id = try XCTUnwrap(paired.deviceId)
        let resumed = try await engine().pair(scope, descriptor: ["name": "Must not create another device"])
        XCTAssertEqual(resumed.deviceId, id)
        let listing = try await json("/api/v1/devices")
        let devices = try XCTUnwrap(listing["devices"] as? [[String: Any]])
        let matches = devices.filter { $0["id"] as? String == id }
        XCTAssertEqual(matches.count, 1)
        XCTAssertEqual(matches.first?["platform"] as? String, "ios")
        XCTAssertEqual(matches.first?["online"] as? Bool, true)
        XCTAssertEqual((matches.first?["capabilities"] as? [String])?.count, 0)
        XCTAssertNotNil(try MobileDeviceKeychain.load(scope)?.deviceId)
        _ = try await json("/api/v1/auth/accounts/remove", body: ["userId": owner])
    }
}
