import Foundation
import CryptoKit

extension AIIntegrationManager {
    internal func candidates() -> [AIIntegrationTarget] {
        let fm = FileManager.default
        var apps: [AIIntegrationKind: [String]] = [:]
        let identifiers: [String: AIIntegrationKind] = ["com.openai.codex": .codex, "com.openai.chat": .chatGPT, "com.anthropic.claudefordesktop": .claudeDesktop, "com.todesktop.230313mzl4w4u92": .cursor, "com.microsoft.VSCode": .vscode, "com.exafunction.windsurf": .windsurf]
        for directory in applicationDirectories {
            guard let enumerator = fm.enumerator(at: directory, includingPropertiesForKeys: [.isSymbolicLinkKey, .isDirectoryKey], options: [.skipsHiddenFiles]) else { continue }
            for case let app as URL in enumerator {
                if (try? app.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) == true { enumerator.skipDescendants(); continue }
                guard app.pathExtension == "app" else { continue }
                enumerator.skipDescendants()
                let infoURL = app.appendingPathComponent("Contents/Info.plist")
                let info = (try? Data(contentsOf: infoURL)).flatMap { try? PropertyListSerialization.propertyList(from: $0, format: nil) as? [String: Any] }
                let identifier = info?["CFBundleIdentifier"] as? String ?? ""
                let name = app.deletingPathExtension().lastPathComponent.lowercased()
                let kind = identifiers[identifier] ?? (name.contains("codex") ? .codex : name.contains("chatgpt") ? .chatGPT : name.contains("claude") ? .claudeDesktop : name.contains("cursor") ? .cursor : name.contains("windsurf") || name == "devin" || name == "devin desktop" ? .windsurf : name.contains("visual studio code") && !name.contains("insiders") ? .vscode : nil)
                if let kind { apps[kind, default: []].append(app.path) }
                else if ["ollama", "lm studio", "jan", "perplexity", "msty", "cherry studio", "open webui", "kiro", "trae", "zed", "goose", "continue", "qwen", "aider", "gemini", "grok", "deepseek", "mistral", "chatbox", "boltai", "typingmind", "anythingllm", "visual studio code", "vscodium"].contains(where: { name.contains($0) }) { apps[.unsupported, default: []].append(app.path) }
            }
        }
        let binaryNames: [AIIntegrationKind: [String]] = [.codex:["codex"], .claudeCode:["claude"], .cursor:["cursor"], .vscode:["code"], .windsurf:["windsurf"], .gemini:["gemini"], .openCode:["opencode"], .unsupported:["copilot", "aider", "goose", "qwen", "amp", "continue", "kiro"]]
        var bins: [AIIntegrationKind:[String]] = [:]
        let dirs = (environment["PATH"] ?? "").split(separator: ":").map(String.init) + [homeDirectory.appendingPathComponent(".local/bin").path] + (includesSystemBinaryDirectories ? ["/opt/homebrew/bin", "/usr/local/bin"] : [])
        for (kind, names) in binaryNames { for dir in Set(dirs) { for name in names {
            let path = URL(fileURLWithPath: dir).appendingPathComponent(name).path
            if fm.isExecutableFile(atPath: path) { bins[kind, default: []].append(path) }
        } } }
        var results: [AIIntegrationTarget] = []
        func add(_ kind: AIIntegrationKind, _ title: String, _ config: URL?, _ skill: URL?, detected: Bool = false, manual: String? = nil) {
            guard detected || !(apps[kind] ?? []).isEmpty || !(bins[kind] ?? []).isEmpty || config.map({ $0.deletingLastPathComponent() != homeDirectory && fm.fileExists(atPath: $0.deletingLastPathComponent().path) }) == true else { return }
            let supports = config != nil && manual == nil
            results.append(AIIntegrationTarget(id: "\(kind.rawValue)-\(Self.hash(Data((config?.path ?? title).utf8)).prefix(16))", title: title, kind: kind, applicationPaths: (apps[kind] ?? []).sorted(), binaryPaths: (bins[kind] ?? []).sorted(), configurationPath: config?.path, skillPath: skill?.path, supportsMCP: supports, supportsSkills: skill != nil && manual == nil, manualSetup: manual, status: manual == nil ? .available : kind == .unsupported ? .unsupported : .manual, installedVersion: nil, latestVersion: nil, conflictReason: nil, autoUpdate: true, pinnedVersion: nil))
        }
        let defaultCodex = homeDirectory.appendingPathComponent(".codex")
        var codexHomes = [defaultCodex]
        if let custom = environment["CODEX_HOME"], custom.hasPrefix("/") { codexHomes.append(URL(fileURLWithPath: custom)) }
        for path in (try? fm.contentsOfDirectory(at: homeDirectory, includingPropertiesForKeys: nil)) ?? [] where path.lastPathComponent.hasPrefix(".codex-") {
            var isDir: ObjCBool = false; if fm.fileExists(atPath: path.path, isDirectory: &isDir), isDir.boolValue { codexHomes.append(path) }
        }
        for dir in Set(codexHomes.map(\.standardizedFileURL)).sorted(by: { $0.path < $1.path }) {
            // The standard home uses Codex's documented shared skill directory.
            let skills = dir == defaultCodex ? homeDirectory.appendingPathComponent(".agents/skills/thingtime") : dir.appendingPathComponent("skills/thingtime")
            add(.codex, dir == defaultCodex ? "Codex" : "Codex (\(dir.lastPathComponent))", dir.appendingPathComponent("config.toml"), skills, detected: fm.fileExists(atPath: dir.path))
        }
        let claude = environment["CLAUDE_CONFIG_DIR"].flatMap { $0.hasPrefix("/") ? URL(fileURLWithPath: $0) : nil } ?? homeDirectory.appendingPathComponent(".claude")
        let claudeConfig = claude == homeDirectory.appendingPathComponent(".claude") ? homeDirectory.appendingPathComponent(".claude.json") : claude.appendingPathComponent(".claude.json")
        add(.claudeCode, "Claude Code", claudeConfig, claude.appendingPathComponent("skills/thingtime"), detected: fm.fileExists(atPath: claude.path) || fm.fileExists(atPath: claudeConfig.path))
        add(.cursor, "Cursor", homeDirectory.appendingPathComponent(".cursor/mcp.json"), homeDirectory.appendingPathComponent(".cursor/skills/thingtime"))
        add(.gemini, "Gemini CLI", homeDirectory.appendingPathComponent(".gemini/settings.json"), homeDirectory.appendingPathComponent(".gemini/skills/thingtime"))
        add(.vscode, "Visual Studio Code", homeDirectory.appendingPathComponent("Library/Application Support/Code/User/mcp.json"), nil)
        add(.chatGPT, "ChatGPT", nil, nil, manual: "Enable Thingtime in ChatGPT's app directory or account settings; this signed-in account operation requires ChatGPT's supported UI.")
        add(.claudeDesktop, "Claude Desktop", nil, nil, manual: "Add the remote Thingtime connector in Claude Settings → Connectors using \(AIIntegrationConfiguration.endpoint). Local claude_desktop_config.json does not support direct remote HTTP connectors.")
        let windsurf = homeDirectory.appendingPathComponent(".codeium/windsurf")
        let devin = homeDirectory.appendingPathComponent(".config/devin")
        // Legacy Cascade and current Devin Desktop have documented independent
        // configuration locations. Do not invent a second target for one app.
        if fm.fileExists(atPath: windsurf.path) || !(bins[.windsurf] ?? []).isEmpty || (apps[.windsurf] ?? []).contains(where: { $0.lowercased().contains("windsurf") }) {
            add(.windsurf, "Windsurf (Cascade)", windsurf.appendingPathComponent("mcp_config.json"), windsurf.appendingPathComponent("skills/thingtime"), detected: true)
        }
        if fm.fileExists(atPath: devin.path) || (apps[.windsurf] ?? []).contains(where: { URL(fileURLWithPath: $0).lastPathComponent.lowercased().hasPrefix("devin") }) {
            let override = environment["XDG_CONFIG_HOME"].flatMap { $0.hasPrefix(homeDirectory.path + "/") ? URL(fileURLWithPath: $0).appendingPathComponent("devin") : nil }
            let directory = override ?? devin
            add(.windsurf, "Devin Desktop (Cascade)", directory.appendingPathComponent("mcp_config.json"), directory.appendingPathComponent("skills/thingtime"), detected: true,
                manual: environment["XDG_CONFIG_HOME"].map({ !$0.hasPrefix(homeDirectory.path + "/") }) == true ? "This Devin configuration uses an external XDG_CONFIG_HOME; Recovery preserved that custom destination." : nil)
        }
        let openCodeDirectory = homeDirectory.appendingPathComponent(".config/opencode")
        let openCodeJSON = openCodeDirectory.appendingPathComponent("opencode.json")
        let openCodeJSONC = openCodeDirectory.appendingPathComponent("opencode.jsonc")
        let openCodeConfig = fm.fileExists(atPath: openCodeJSONC.path) ? openCodeJSONC : openCodeJSON
        let hasOverride = environment["OPENCODE_CONFIG"] != nil || environment["OPENCODE_CONFIG_CONTENT"] != nil || environment["OPENCODE_CONFIG_DIR"] != nil || environment["XDG_CONFIG_HOME"].map({ $0 != homeDirectory.appendingPathComponent(".config").path }) == true
        let openCodeData: Data?
        // Path validation precedes config inspection; do not follow redirects
        // while deciding whether an automatic adapter is applicable.
        if (try? safe(openCodeConfig, anchor: homeDirectory)) != nil { openCodeData = try? Data(contentsOf: openCodeConfig) } else { openCodeData = nil }
        let layoutKnown = (try? AIIntegrationConfiguration.openCodeLayout(openCodeData)) != nil
        let openCodeManual = hasOverride ? "OpenCode uses an explicit custom configuration location; Recovery preserved its override and did not guess a destination." : layoutKnown ? nil : "OpenCode V1 and V2 use different MCP layouts. Recovery needs an existing valid JSON MCP configuration to establish the installed format; no executable was launched or configuration guessed."
        add(.openCode, "OpenCode", openCodeConfig, openCodeDirectory.appendingPathComponent("skills/thingtime"), detected: fm.fileExists(atPath: openCodeDirectory.path), manual: openCodeManual)
        for path in apps[.unsupported] ?? [] {
            let name = URL(fileURLWithPath: path).deletingPathExtension().lastPathComponent
            results.append(AIIntegrationTarget(id: "unsupported-" + String(Self.hash(Data(path.utf8)).prefix(16)), title: name, kind: .unsupported, applicationPaths: [path], binaryPaths: [], configurationPath: nil, skillPath: nil, supportsMCP: false, supportsSkills: false, manualSetup: "No verified Thingtime MCP or skill installation contract is available for this application.", status: .unsupported, installedVersion: nil, latestVersion: nil, conflictReason: nil, autoUpdate: false, pinnedVersion: nil))
        }
        for path in bins[.unsupported] ?? [] {
            results.append(AIIntegrationTarget(id: "unsupported-cli-" + String(Self.hash(Data(path.utf8)).prefix(16)), title: URL(fileURLWithPath: path).lastPathComponent, kind: .unsupported, applicationPaths: [], binaryPaths: [path], configurationPath: nil, skillPath: nil, supportsMCP: false, supportsSkills: false, manualSetup: "Detected CLI only; no verified Thingtime installation contract is available.", status: .unsupported, installedVersion: nil, latestVersion: nil, conflictReason: nil, autoUpdate: false, pinnedVersion: nil))
        }
        return results.sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
    }
}
