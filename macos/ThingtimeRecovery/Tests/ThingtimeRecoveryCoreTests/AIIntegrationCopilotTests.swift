import Foundation
import XCTest
@testable import ThingtimeRecoveryCore

final class AIIntegrationCopilotTests: XCTestCase {
    func testCopilotHTTPConfigurationPreservesExistingServersAndRoundTrips() throws {
        let original = Data(#"{"mcpServers":{"other":{"type":"http","url":"https://other","tools":["read"]}},"custom":true}"#.utf8)
        let installed = try XCTUnwrap(AIIntegrationConfiguration.transform(original, kind: .copilot, oldEntry: nil, removing: false))
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: installed) as? [String: Any])
        let servers = try XCTUnwrap(root["mcpServers"] as? [String: Any])
        let thingtime = try XCTUnwrap(servers["thingtime"] as? [String: Any])
        XCTAssertEqual(thingtime["type"] as? String, "http")
        XCTAssertEqual(thingtime["url"] as? String, AIIntegrationConfiguration.endpoint)
        XCTAssertEqual(thingtime["tools"] as? [String], ["*"])
        XCTAssertEqual((servers["other"] as? [String: Any])?["tools"] as? [String], ["read"])
        let removed = try XCTUnwrap(AIIntegrationConfiguration.transform(installed, kind: .copilot, oldEntry: AIIntegrationConfiguration.ownedEntry(kind: .copilot), removing: true))
        XCTAssertEqual(try AIIntegrationConfiguration.canonical(JSONSerialization.jsonObject(with: removed)), try AIIntegrationConfiguration.canonical(JSONSerialization.jsonObject(with: original)))
    }

    func testCopilotRefusesUnownedAndModifiedEntries() throws {
        XCTAssertThrowsError(try AIIntegrationConfiguration.transform(Data(#"{"mcpServers":{"thingtime":{"type":"http","url":"https://existing"}}}"#.utf8), kind: .copilot, oldEntry: nil, removing: false))
        let installed = try XCTUnwrap(AIIntegrationConfiguration.transform(nil, kind: .copilot, oldEntry: nil, removing: false))
        let altered = Data(String(decoding: installed, as: UTF8.self).replacingOccurrences(of: AIIntegrationConfiguration.endpoint, with: "https://changed").utf8)
        XCTAssertThrowsError(try AIIntegrationConfiguration.transform(altered, kind: .copilot, oldEntry: AIIntegrationConfiguration.ownedEntry(kind: .copilot), removing: true))
    }

    func testCopilotDiscoveryRespectsCustomHomeWithoutReadingCredentialState() throws {
        let home = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Caches/RecoveryCopilotTests-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: home.appendingPathComponent(".copilot"), withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: home) }
        func discover(_ environment: [String: String]) throws -> AIIntegrationTarget {
            try XCTUnwrap(AIIntegrationManager(homeDirectory: home, bundleDirectory: home.appendingPathComponent("bundle"), applicationDirectories: [], environment: environment).candidates().first { $0.kind == .copilot })
        }
        let standard = try discover(["PATH": ""])
        XCTAssertTrue(standard.supportsMCP && standard.supportsSkills)
        XCTAssertEqual(standard.configurationPath, home.appendingPathComponent(".copilot/mcp-config.json").path)
        let custom = home.appendingPathComponent("copilot-custom")
        try FileManager.default.createDirectory(at: custom, withIntermediateDirectories: true)
        let redirected = try discover(["PATH": "", "COPILOT_HOME": custom.path])
        XCTAssertEqual(redirected.configurationPath, custom.appendingPathComponent("mcp-config.json").path)
        XCTAssertEqual(redirected.skillPath, custom.appendingPathComponent("skills/thingtime").path)
        XCTAssertTrue(redirected.supportsMCP)
        let external = try discover(["PATH": "", "COPILOT_HOME": "/external/copilot"])
        XCTAssertFalse(external.supportsMCP)
    }
}
