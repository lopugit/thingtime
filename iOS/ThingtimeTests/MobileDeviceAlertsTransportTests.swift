import XCTest
@testable import Thingtime

@MainActor
final class MobileDeviceAlertsTransportTests: XCTestCase {
    func testClaimRequiresExplicitApprovalAndMediaReauthorizationPinsVersion() async throws {
        let scope = try MobileDevicePairing.Scope(ownerId: "synthetic-owner", url: URL(string: "https://example.test")!)
        let record = MobileDevicePairing.Record(scope: scope, privateKey: Data(repeating: 1, count: 32), nonce: "synthetic",
            credential: "synthetic-device-credential", pairingSecret: "synthetic", expiresAt: .distantFuture, deviceId: "device")
        let version = String(repeating: "a", count: 64)
        var approvalState = "pending", wrongVersion = false
        let client = MobileDeviceNodeTransport(load: { _ in record }, save: { _ in }) { request in
            XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer synthetic-device-credential")
            let body = try JSONSerialization.jsonObject(with: try XCTUnwrap(request.httpBody)) as! [String: Any]
            let result: [String: Any]
            if request.url!.path == "/api/v1/devices/node/commands" {
                result = ["ok": true, "command": ["id": "command", "kind": "media.play", "input": [
                    "attachmentId": "attachment", "versionId": version], "leaseId": "synthetic-lease",
                    "leaseExpiresAt": "2099-01-01T00:00:00.000Z", "requiresApproval": true, "approvalState": approvalState]]
            } else {
                XCTAssertEqual(request.url!.path, "/api/v1/devices/node/media")
                XCTAssertEqual(Set(body.keys), ["commandId", "leaseId"], "A caller cannot substitute an arbitrary attachment or URL")
                result = ["ok": true, "attachmentId": "attachment", "versionId": wrongVersion ? "wrong" : version]
            }
            return (try MobileDevicePairing.json(result), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }
        let transport = MobileDeviceAlertsTransport(client: client)
        let pending = try await transport.claim(scope: scope, check: {})
        XCTAssertEqual(pending?.approved, false)
        approvalState = "approved"
        let claimed = try await transport.claim(scope: scope, check: {})
        let command = try XCTUnwrap(claimed)
        XCTAssertTrue(command.approved)
        try await transport.authorizeMedia(command, scope: scope, attachmentId: "attachment", versionId: version, check: {})
        wrongVersion = true
        do { try await transport.authorizeMedia(command, scope: scope, attachmentId: "attachment", versionId: version, check: {}); XCTFail("Changed version accepted") }
        catch MobileDevicePairing.Failure.invalid { }
    }
}
