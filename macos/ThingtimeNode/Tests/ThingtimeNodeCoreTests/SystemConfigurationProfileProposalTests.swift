import Foundation
import XCTest
@testable import ThingtimeNodeCore

@MainActor
final class SystemConfigurationProfileProposalTests: XCTestCase {
    func testAirDropProfileIsFixedAndCarriesOnlyTheClosedAvailabilityFlag() throws {
        let root = try propertyList(scope: .airDrop, enabled: false)
        XCTAssertEqual(root["PayloadType"] as? String, "Configuration")
        XCTAssertEqual(root["PayloadIdentifier"] as? String, "com.thingtime.desktop.policy.airdrop")
        XCTAssertEqual(root["PayloadUUID"] as? String, "214A9B35-3D42-4AFC-BFF4-D52C6B7EE911")
        let content = try XCTUnwrap(root["PayloadContent"] as? [[String: Any]])
        XCTAssertEqual(content.count, 1)
        XCTAssertEqual(content[0]["PayloadType"] as? String, "com.apple.applicationaccess")
        XCTAssertEqual(content[0]["allowAirDrop"] as? Bool, false)
        XCTAssertNil(content[0]["allowCamera"])
    }

    func testCameraProfileIsFixedAndDoesNotClaimToGrantPerAppCameraAccess() throws {
        let root = try propertyList(scope: .camera, enabled: true)
        XCTAssertEqual(root["PayloadIdentifier"] as? String, "com.thingtime.desktop.policy.camera")
        XCTAssertEqual(root["PayloadUUID"] as? String, "4C245E03-60C5-4D6A-8663-C2A3E6BC30A4")
        let content = try XCTUnwrap(root["PayloadContent"] as? [[String: Any]])
        XCTAssertEqual(content.count, 1)
        XCTAssertEqual(content[0]["PayloadType"] as? String, "com.apple.applicationaccess")
        XCTAssertEqual(content[0]["allowCamera"] as? Bool, true)
        XCTAssertNil(content[0]["allowAirDrop"])
        XCTAssertFalse((root["PayloadDescription"] as? String ?? "").contains("per-app"))
    }

    private func propertyList(scope: SystemConfigurationProfileProposal.Scope, enabled: Bool) throws -> [String: Any] {
        let value = try PropertyListSerialization.propertyList(
            from: try SystemConfigurationProfileProposal.profileData(scope: scope, enabled: enabled),
            options: [],
            format: nil
        )
        return try XCTUnwrap(value as? [String: Any])
    }
}
