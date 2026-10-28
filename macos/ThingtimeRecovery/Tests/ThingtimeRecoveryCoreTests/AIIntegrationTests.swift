import Foundation
import Testing
@testable import ThingtimeRecoveryCore

private final class AIFixture {
    let root = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent("ai-test-" + UUID().uuidString)
    var home: URL { root.appendingPathComponent("home") }
    var bundle: URL { root.appendingPathComponent("bundle") }
    var apps: URL { root.appendingPathComponent("apps") }
    var manager: AIIntegrationManager { AIIntegrationManager(homeDirectory: home, bundleDirectory: bundle, applicationDirectories: [apps], environment: ["PATH": ""]) }
    init() throws { try FileManager.default.createDirectory(at: home.appendingPathComponent(".codex"), withIntermediateDirectories: true); try package() }
    deinit { try? FileManager.default.removeItem(at: root) }
    func write(_ text: String, _ url: URL) throws { try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true); try Data(text.utf8).write(to: url) }
    func package(_ version: String = "1.0.0", _ text: String = "# Thingtime canonical full skill") throws {
        try write("{\"name\":\"thingtime\",\"version\":\"\(version)\"}", bundle.appendingPathComponent(".codex-plugin/plugin.json"))
        try write("{\"mcpServers\":{\"thingtime\":{\"url\":\"https://thingtime.com/api/v1/integrations/chatgpt/mcp\"}}}", bundle.appendingPathComponent(".mcp.json"))
        try write(text, bundle.appendingPathComponent("skills/thingtime/SKILL.md"))
    }
    func codex() throws -> AIIntegrationTarget { try #require(manager.discover().first { $0.kind == .codex && $0.title == "Codex" }) }
}

@Test("integration lifecycle preserves settings, rollback pins, uninstall opts out")
func integrationLifecycle() throws {
    let f = try AIFixture(), config = f.home.appendingPathComponent(".codex/config.toml")
    let original = "model = \"chosen\"\n[mcp_servers.other]\nurl = \"https://example.com\"\n"
    try f.write(original, config)
    let target = try f.codex()
    _ = try f.manager.install(target: target)
    #expect(try String(contentsOf: config, encoding: .utf8).hasPrefix(original))
    try f.package("1.1.0", "# New version")
    #expect(try f.codex().status == .updateAvailable)
    #expect(f.manager.sync().count == 1)
    _ = try f.manager.rollback(target: target)
    #expect(try f.codex().installedVersion == "1.0.0")
    #expect(try f.codex().pinnedVersion == "1.0.0")
    #expect(f.manager.sync().isEmpty)
    try f.manager.setAutomaticSetup(true)
    _ = try f.manager.uninstall(target: target)
    #expect(try String(contentsOf: config, encoding: .utf8) == original)
    #expect(try !f.codex().autoUpdate)
    #expect(f.manager.sync().isEmpty)
}

@Test("integration JSON preserves unrelated values, refuses malformed duplicate JSON and unknown entries")
func integrationJSON() throws {
    let f = try AIFixture(), url = f.home.appendingPathComponent(".cursor/mcp.json")
    try f.write("{\"theme\":\"night\",\"mcpServers\":{\"other\":{\"url\":\"https://other\"}}}", url)
    let target = try #require(f.manager.discover().first { $0.kind == .cursor })
    _ = try f.manager.install(target: target)
    let json = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
    #expect(json["theme"] as? String == "night")
    #expect((json["mcpServers"] as? [String: Any])?["other"] != nil)
    _ = try f.manager.uninstall(target: target)
    for invalid in ["{bad", "{\"mcpServers\":{},\"mcpServers\":{}}", "{\"mcpServers\":{\"thingtime\":{}}}", "// JSONC\n{}"] {
        try f.write(invalid, url)
        #expect(throws: (any Error).self) { try f.manager.install(target: target) }
        #expect(try String(contentsOf: url, encoding: .utf8) == invalid)
    }
}

@Test("integration drift and symlinks fail closed")
func integrationDriftAndSymlink() throws {
    let f = try AIFixture(), target = try f.codex()
    _ = try f.manager.install(target: target)
    try f.write("User's edited skill", URL(fileURLWithPath: target.skillPath!).appendingPathComponent("SKILL.md"))
    #expect(try f.codex().status == .conflict)
    #expect(throws: (any Error).self) { try f.manager.uninstall(target: target) }
    #expect(throws: (any Error).self) { try f.manager.install(target: target) }
    let second = try AIFixture(), config = second.home.appendingPathComponent(".codex/config.toml"), outside = second.root.appendingPathComponent("private")
    try second.write("untouched", outside)
    try FileManager.default.createSymbolicLink(at: config, withDestinationURL: outside)
    #expect(throws: (any Error).self) { try second.manager.install(target: try second.codex()) }
    #expect(try String(contentsOf: outside, encoding: .utf8) == "untouched")
}

@Test("integration TOML rejects malformed and existing Thingtime entries")
func integrationTOML() throws {
    let f = try AIFixture(), config = f.home.appendingPathComponent(".codex/config.toml")
    for text in ["broken", "[mcp_servers.thingtime]\nurl = \"existing\"\n", "[mcp_servers]\nthingtime = {}\n", "model = \"x\"\nmodel = \"y\"", "model = \"unclosed", "features = {bad}", "tools = [unquoted]", "[mcp_servers.\"\\\\u0074hingtime\"]\nurl = \"bad\""] {
        try f.write(text, config)
        #expect(throws: (any Error).self) { try f.manager.install(target: try f.codex()) }
        #expect(try String(contentsOf: config, encoding: .utf8) == text)
    }
}

@Test("integration discovery separates homes and recognizes renamed app copies")
func integrationDiscovery() throws {
    let f = try AIFixture()
    try FileManager.default.createDirectory(at: f.home.appendingPathComponent(".codex-work"), withIntermediateDirectories: true)
    for name in ["Copies/Codex Work.app", "Renamed.app"] {
        let info = f.apps.appendingPathComponent(name + "/Contents/Info.plist")
        try FileManager.default.createDirectory(at: info.deletingLastPathComponent(), withIntermediateDirectories: true)
        try PropertyListSerialization.data(fromPropertyList: ["CFBundleIdentifier": "com.openai.codex"], format: .xml, options: 0).write(to: info)
    }
    let targets = f.manager.discover().filter { $0.kind == .codex }
    #expect(targets.count == 2)
    #expect(targets.allSatisfy { $0.applicationPaths.count == 2 })
    #expect(Set(targets.compactMap(\.skillPath)).count == 2)
    #expect(!f.manager.state().automaticSetup)
    #expect(f.manager.sync().isEmpty)
    try f.manager.setAutomaticSetup(true)
    #expect(f.manager.sync().filter(\.success).count == 2)
}

@Test("integration version precedence handles codex release revisions and prevents downgrade")
func integrationVersion() throws {
    let f = try AIFixture(), target = try f.codex()
    try f.package("2.1.0+codex.20260903100802")
    _ = try f.manager.install(target: target)
    try f.package("2.1.0+codex.20261028100802", "new codex release")
    #expect(try f.codex().status == .updateAvailable)
    #expect(f.manager.sync().count == 1)
    try f.package("1.9.0", "old")
    #expect(try f.codex().status == .installed)
    #expect(f.manager.sync().isEmpty)
    #expect(throws: (any Error).self) { try f.manager.install(target: target) }
    try f.package("2.1.0+codex.20261028100802", "silently changed")
    #expect(try f.codex().status == .conflict)
    #expect(throws: (any Error).self) { try f.manager.install(target: target) }
    #expect(AIIntegrationManager.compareVersions("1.2.0-rc.2", "1.2.0-rc.10") == .orderedAscending)
    #expect(AIIntegrationManager.compareVersions("1.2.0", "1.2.0-rc.10") == .orderedDescending)
}

@Test("integration explicit homes and complete skill descendants remain isolated")
func integrationCustomHomes() throws {
    let f = try AIFixture(), custom = f.root.appendingPathComponent("custom-codex"), claude = f.root.appendingPathComponent("custom-claude")
    try FileManager.default.createDirectory(at: custom, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: claude, withIntermediateDirectories: true)
    try f.write("# bundled reference", f.bundle.appendingPathComponent("skills/thingtime/references/contract.md"))
    let manager = AIIntegrationManager(homeDirectory: f.home, bundleDirectory: f.bundle, applicationDirectories: [], environment: ["PATH": "", "CODEX_HOME": custom.path, "CLAUDE_CONFIG_DIR": claude.path])
    let target = try #require(manager.discover().first { $0.configurationPath == custom.appendingPathComponent("config.toml").path })
    _ = try manager.install(target: target)
    #expect(try String(contentsOf: custom.appendingPathComponent("skills/thingtime/references/contract.md"), encoding: .utf8) == "# bundled reference")
    #expect(!FileManager.default.fileExists(atPath: f.home.appendingPathComponent(".agents/skills/thingtime").path))
    let claudeTarget = try #require(manager.discover().first { $0.kind == .claudeCode })
    #expect(claudeTarget.configurationPath == claude.appendingPathComponent(".claude.json").path)
    _ = try manager.install(target: claudeTarget)
    let config = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: claudeTarget.configurationPath!))) as! [String: Any]
    let servers = config["mcpServers"] as! [String: Any], entry = servers["thingtime"] as! [String: String]
    #expect(entry["type"] == "http")
}

@Test("integration package hash manifest and skill symlink tampering fail closed")
func integrationPackageIntegrity() throws {
    let f = try AIFixture()
    try f.write("{\"version\":\"1.0.0\",\"sha256\":{}}", f.bundle.appendingPathComponent("bundle-manifest.json"))
    #expect(throws: (any Error).self) { try f.manager.install(target: try f.codex()) }
    try FileManager.default.removeItem(at: f.bundle.appendingPathComponent("bundle-manifest.json"))
    let outside = f.root.appendingPathComponent("external.md")
    try f.write("must not copy", outside)
    try FileManager.default.createSymbolicLink(at: f.bundle.appendingPathComponent("skills/thingtime/alias.md"), withDestinationURL: outside)
    #expect(throws: (any Error).self) { try f.manager.install(target: try f.codex()) }
}

@Test("integration config drift and managed table additions are preserved")
func integrationConfigurationDrift() throws {
    let f = try AIFixture(), target = try f.codex(), config = f.home.appendingPathComponent(".codex/config.toml")
    _ = try f.manager.install(target: target)
    let altered = try String(contentsOf: config, encoding: .utf8) + "custom_owned_table_setting = true\n"
    try f.write(altered, config)
    #expect(throws: (any Error).self) { try f.manager.uninstall(target: target) }
    #expect(try String(contentsOf: config, encoding: .utf8) == altered)
}

@Test("integration rollback refuses a corrupted archived receipt without changing the active version")
func integrationRollbackReceiptIntegrity() throws {
    let f = try AIFixture(), target = try f.codex()
    _ = try f.manager.install(target: target)
    try f.package("1.1.0", "# Current skill version")
    _ = try f.manager.install(target: target)
    let stateURL = f.home.appendingPathComponent("Library/Application Support/com.thingtime.desktop/ai-integrations/state.json")
    var state = try JSONSerialization.jsonObject(with: Data(contentsOf: stateURL)) as! [String: Any]
    var history = state["history"] as! [String: Any]
    var versions = history[target.id] as! [[String: Any]]
    versions[0]["hashes"] = ["SKILL.md": "corrupt"]
    history[target.id] = versions; state["history"] = history
    try JSONSerialization.data(withJSONObject: state).write(to: stateURL)
    #expect(throws: (any Error).self) { try f.manager.rollback(target: target) }
    #expect(try f.codex().installedVersion == "1.1.0")
    #expect(try String(contentsOf: URL(fileURLWithPath: target.skillPath!).appendingPathComponent("SKILL.md"), encoding: .utf8) == "# Current skill version")
}
