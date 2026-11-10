import Foundation
import XCTest
@testable import ThingtimeRecoveryCore

final class AIIntegrationAdditionalAdaptersTests: XCTestCase {
    private func object(_ data: Data?) throws -> [String: Any] {
        try JSONSerialization.jsonObject(with: XCTUnwrap(data)) as! [String: Any]
    }

    func testWindsurfUsesNativeRemoteFieldAndPreservesOtherServers() throws {
        let original = Data(#"{"theme":"dark","mcpServers":{"other":{"command":"existing"}}}"#.utf8)
        let installed = try AIIntegrationConfiguration.transform(original, kind: .windsurf, oldEntry: nil, removing: false)
        let result = try object(installed)
        let servers = try XCTUnwrap(result["mcpServers"] as? [String: Any])
        XCTAssertEqual((servers["thingtime"] as? [String: String])?["serverUrl"], AIIntegrationConfiguration.endpoint)
        XCTAssertEqual((servers["other"] as? [String: String])?["command"], "existing")
        let removed = try object(AIIntegrationConfiguration.transform(installed, kind: .windsurf, oldEntry: AIIntegrationConfiguration.ownedEntry(kind: .windsurf), removing: true))
        XCTAssertEqual(try AIIntegrationConfiguration.canonical(removed), try AIIntegrationConfiguration.canonical(object(original)))
    }

    func testOpenCodeBothLayoutsPreserveConfigurationAndRoundTrip() throws {
        for original in [#"{"model":"chosen","mcp":{"other":{"type":"remote","url":"https://other"}}}"#,
                         #"{"model":"chosen","mcp":{"timeout":{"startup":45000},"servers":{"other":{"type":"remote","url":"https://other"}}}}"#] {
            let data = Data(original.utf8)
            let installed = try AIIntegrationConfiguration.transform(data, kind: .openCode, oldEntry: nil, removing: false)
            let result = try object(installed)
            let mcp = try XCTUnwrap(result["mcp"] as? [String: Any])
            let servers = mcp["servers"] as? [String: Any] ?? mcp
            XCTAssertEqual((servers["thingtime"] as? [String: String])?["type"], "remote")
            XCTAssertEqual((servers["thingtime"] as? [String: String])?["url"], AIIntegrationConfiguration.endpoint)
            XCTAssertNotNil(servers["other"])
            let removed = try object(AIIntegrationConfiguration.transform(installed, kind: .openCode, oldEntry: AIIntegrationConfiguration.ownedEntry(kind: .openCode), removing: true))
            XCTAssertEqual(try AIIntegrationConfiguration.canonical(removed), try AIIntegrationConfiguration.canonical(object(data)))
        }
    }

    func testV1ServerNamedServersDoesNotBecomeV2() throws {
        let data = Data(#"{"mcp":{"servers":{"type":"remote","url":"https://other"}}}"#.utf8)
        let result = try object(AIIntegrationConfiguration.transform(data, kind: .openCode, oldEntry: nil, removing: false))
        let mcp = try XCTUnwrap(result["mcp"] as? [String: Any])
        XCTAssertNotNil(mcp["thingtime"])
        XCTAssertEqual((mcp["servers"] as? [String: String])?["url"], "https://other")
    }

    func testOpenCodeUnknownAndMalformedLayoutsRemainUntouched() throws {
        for text in ["{}", #"{"mcp":{}}"#, #"{"mcp":{"timeout":3000}}"#, #"{"mcp":{"servers":{},"servers":{}}}"#, "// JSONC\n{}"] {
            XCTAssertThrowsError(try AIIntegrationConfiguration.transform(Data(text.utf8), kind: .openCode, oldEntry: nil, removing: false))
        }
        XCTAssertThrowsError(try AIIntegrationConfiguration.transform(nil, kind: .openCode, oldEntry: nil, removing: false))
    }

    func testDiscoveryOffersKnownAdaptersAndPreservesOverrides() throws {
        let root = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Caches/RecoveryAdapterTests-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let home = root.resolvingSymlinksInPath()
        for relative in [".codeium/windsurf", ".config/devin", ".config/opencode"] {
            try FileManager.default.createDirectory(at: home.appendingPathComponent(relative), withIntermediateDirectories: true)
        }
        try Data(#"{"mcp":{"servers":{}}}"#.utf8).write(to: home.appendingPathComponent(".config/opencode/opencode.json"))
        func targets(_ environment: [String: String]) -> [AIIntegrationTarget] {
            AIIntegrationManager(homeDirectory: home, bundleDirectory: home.appendingPathComponent("bundle"), applicationDirectories: [], environment: environment).candidates()
        }
        let known = targets(["PATH": ""])
        XCTAssertEqual(known.filter { $0.kind == .windsurf && $0.supportsMCP && $0.supportsSkills }.count, 2)
        XCTAssertTrue(try XCTUnwrap(known.first { $0.kind == .openCode }).supportsMCP)
        let overridden = targets(["PATH": "", "OPENCODE_CONFIG": "/external/opencode.json"])
        XCTAssertFalse(try XCTUnwrap(overridden.first { $0.kind == .openCode }).supportsMCP)
    }
}
