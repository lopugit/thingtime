import Foundation

/// Remote-only configuration adapters. No discovered executable is launched.
internal enum AIIntegrationConfiguration {
    static let endpoint = "https://thingtime.com/api/v1/integrations/chatgpt/mcp"
    static let begin = "# BEGIN Thingtime Recovery managed MCP"
    static let end = "# END Thingtime Recovery managed MCP"
    static let tomlBlock = "\(begin)\n[mcp_servers.thingtime]\nurl = \"\(endpoint)\"\n\(end)\n"

    static func entry(kind: AIIntegrationKind) -> [String: Any] {
        switch kind {
        case .claudeCode: return ["type": "http", "url": endpoint]
        case .gemini: return ["httpUrl": endpoint]
        case .windsurf: return ["serverUrl": endpoint]
        case .openCode: return ["type": "remote", "url": endpoint]
        case .copilot: return ["type": "http", "url": endpoint, "tools": ["*"]]
        default: return ["url": endpoint]
        }
    }
    static func rootKey(kind: AIIntegrationKind) -> String { kind == .vscode ? "servers" : kind == .openCode ? "mcp" : "mcpServers" }
    enum OpenCodeLayout { case flat, nested }
    /// Existing executable configuration establishes the contract without
    /// launching an untrusted discovered binary or guessing its major version.
    static func openCodeLayout(_ data: Data?) throws -> OpenCodeLayout? {
        guard let data else { return nil }
        try JSONKeyValidator.validate(data)
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any], let mcp = root["mcp"] as? [String: Any] else { return nil }
        let flat = !mcp.isEmpty && mcp.values.allSatisfy({ value in
            guard let server = value as? [String: Any], let type = server["type"] as? String else { return false }
            return type == "local" || type == "remote"
        })
        if flat { return .flat }
        if mcp["servers"] is [String: Any] { return .nested }
        return nil
    }
    static func canonical(_ value: Any) throws -> Data {
        try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .fragmentsAllowed])
    }
    static func transform(_ data: Data?, kind: AIIntegrationKind, oldEntry: Data?, removing: Bool) throws -> Data? {
        if kind == .codex {
            var text = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            if data != nil && String(data: data!, encoding: .utf8) == nil { throw problem("Config is not UTF-8.") }
            try validateTOML(text)
            if let oldEntry {
                guard let owned = String(data: oldEntry, encoding: .utf8), text.components(separatedBy: owned).count == 2 else {
                    throw problem("Managed MCP configuration was changed outside Recovery.")
                }
                let tail = text.components(separatedBy: owned)[1]
                for line in tail.components(separatedBy: .newlines) {
                    let trimmed = line.trimmingCharacters(in: .whitespaces)
                    if trimmed.hasPrefix("[") { break }
                    if !trimmed.isEmpty && !trimmed.hasPrefix("#") { throw problem("Managed MCP table has additional external settings.") }
                }
                text = text.replacingOccurrences(of: owned, with: "")
            }
            // Catch quoted/dotted aliases and nested sections as well as ordinary headers.
            let normalized = text.replacingOccurrences(of: "\"", with: "").replacingOccurrences(of: "'", with: "")
            var section = ""
            for raw in normalized.components(separatedBy: .newlines) {
                let line = raw.trimmingCharacters(in: .whitespaces)
                if line.hasPrefix("[") { section = line.components(separatedBy: "#")[0].replacingOccurrences(of: " ", with: "") }
                if section == "[mcp_servers]" && line.range(of: "^thingtime\\s*=", options: .regularExpression) != nil { throw problem("Existing Thingtime MCP entry is not owned by Recovery.") }
            }
            if normalized.range(of: "(?m)^\\s*(?:\\[+\\s*mcp_servers\\s*\\.\\s*thingtime(?:\\s*[.\\]])|mcp_servers\\s*\\.\\s*thingtime\\s*[.=]|mcp_servers\\s*=)", options: .regularExpression) != nil {
                throw problem("An existing Thingtime or inline MCP entry is not owned by Recovery.")
            }
            if !removing { text += (text.isEmpty || text.hasSuffix("\n") ? "" : "\n") + tomlBlock }
            return text.isEmpty ? nil : Data(text.utf8)
        }
        var root: [String: Any] = [:]
        if let data {
            try JSONKeyValidator.validate(data)
            guard let parsed = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw problem("Configuration must be a JSON object.") }
            root = parsed
        }
        let key = rootKey(kind: kind)
        if root[key] != nil && !(root[key] is [String: Any]) { throw problem("MCP configuration is not an object.") }
        var container = root[key] as? [String: Any] ?? [:]
        var nested = false
        if kind == .openCode {
            guard let layout = try openCodeLayout(data) else { throw problem("OpenCode's installed MCP configuration format is not established; configure one MCP server through OpenCode first.") }
            if case .nested = layout { nested = true }
        }
        var servers = nested ? container["servers"] as? [String: Any] ?? [:] : container
        if let oldEntry {
            guard let current = servers["thingtime"], try canonical(current) == oldEntry else { throw problem("Managed Thingtime entry was changed outside Recovery.") }
        } else if servers["thingtime"] != nil { throw problem("Existing Thingtime entry is not owned by Recovery.") }
        if removing { servers.removeValue(forKey: "thingtime") } else { servers["thingtime"] = entry(kind: kind) }
        if nested { container["servers"] = servers; root[key] = container }
        else if servers.isEmpty { root.removeValue(forKey: key) } else { root[key] = servers }
        return try JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
    }
    static func ownedEntry(kind: AIIntegrationKind) throws -> Data {
        kind == .codex ? Data(tomlBlock.utf8) : try canonical(entry(kind: kind))
    }
    static func problem(_ text: String) -> RecoveryError { .operationFailed(text) }

    /// Quoted TOML keys may contain paths, punctuation, spaces and equals signs.
    /// Parse delimiters without rewriting those names; escaped keys are refused
    /// until their aliases can be decoded with the complete TOML string grammar.
    static func assignment(_ line: String) throws -> ([String], String) {
        var quote: Character?
        for index in line.indices {
            let char = line[index]
            if let active = quote {
                if char == "\\" { throw problem("Escaped TOML keys require manual setup.") }
                if char == active { quote = nil }
            } else if char == "\"" || char == "'" { quote = char }
            else if char == "=" {
                return (try keyPath(String(line[..<index])), String(line[line.index(after: index)...]).trimmingCharacters(in: .whitespaces))
            }
        }
        throw problem("Malformed TOML assignment.")
    }
    static func keyPath(_ key: String) throws -> [String] {
        let bytes = Array(key.utf8); var position = 0; var keys: [String] = []
        func whitespace(_ byte: UInt8) -> Bool { byte == 32 || byte == 9 }
        while true {
            while position < bytes.count && whitespace(bytes[position]) { position += 1 }
            guard position < bytes.count else { throw problem("Malformed TOML key.") }
            if bytes[position] == 34 || bytes[position] == 39 {
                let quote = bytes[position]; position += 1; let start = position
                while position < bytes.count && bytes[position] != quote {
                    guard bytes[position] >= 32, bytes[position] != 92, bytes[position] != 127 else { throw problem("Escaped or control-character TOML keys require manual setup.") }
                    position += 1
                }
                guard position < bytes.count else { throw problem("Unclosed TOML key.") }
                keys.append(String(decoding: bytes[start..<position], as: UTF8.self)); position += 1
            } else {
                let start = position
                while position < bytes.count && (bytes[position] == 45 || bytes[position] == 95 || (48...57).contains(bytes[position]) || (65...90).contains(bytes[position]) || (97...122).contains(bytes[position])) { position += 1 }
                guard position > start else { throw problem("Malformed TOML key.") }
                keys.append(String(decoding: bytes[start..<position], as: UTF8.self))
            }
            while position < bytes.count && whitespace(bytes[position]) { position += 1 }
            if position == bytes.count { return keys }
            guard bytes[position] == 46 else { throw problem("Malformed TOML dotted key.") }
            position += 1
        }
    }

    /// Conservative TOML subset, rejecting syntax that cannot be preserved safely.
    /// Existing multiline strings/arrays require manual setup instead of a rewrite.
    static func validateTOML(_ text: String) throws {
        var section = "", seen = Set<String>()
        for raw in text.components(separatedBy: .newlines) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix("#") { continue }
            if line.hasPrefix("[") {
                guard line.range(of: "^\\[\\[?[^\\[\\]\\n]+\\]\\]?(?:\\s*#.*)?$", options: .regularExpression) != nil else { throw problem("Malformed or unsupported TOML table.") }
                section = line.components(separatedBy: "#")[0].trimmingCharacters(in: .whitespaces)
                guard section.hasPrefix("[[") == section.hasSuffix("]]"), !section.contains("\\") else { throw problem("Malformed or unsupported TOML table.") }
                section = section.replacingOccurrences(of: "\"", with: "").replacingOccurrences(of: "'", with: "").replacingOccurrences(of: " ", with: "")
                guard seen.insert("table:" + section).inserted else { throw problem("Duplicate TOML table.") }
            } else {
                let (keys, value) = try assignment(line)
                guard !value.isEmpty, seen.insert(section + ":key:" + keys.joined(separator: "\0")).inserted else { throw problem("Malformed or duplicate TOML key.") }
                var scanner = TOMLValueValidator(bytes: Array(value.utf8))
                try scanner.validate()
            }
        }
    }
}

/// JSONSerialization accepts duplicate keys. This preflight rejects them (including
/// escaped equivalents) so editing cannot silently discard an existing setting.
private struct JSONKeyValidator {
    var bytes: [UInt8]; var position = 0
    static func validate(_ data: Data) throws {
        _ = try JSONSerialization.jsonObject(with: data)
        var scanner = Self(bytes: Array(data)); try scanner.value()
    }
    mutating func whitespace() { while position < bytes.count && [9,10,13,32].contains(bytes[position]) { position += 1 } }
    mutating func string() throws -> String {
        whitespace(); let start = position; position += 1
        while position < bytes.count {
            let byte = bytes[position]; position += 1
            if byte == 92 { position += 1 } else if byte == 34 {
                let data = Data(bytes[start..<position]); return try JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed) as! String
            }
        }
        throw AIIntegrationConfiguration.problem("Malformed JSON string.")
    }
    mutating func value() throws {
        whitespace(); guard position < bytes.count else { throw AIIntegrationConfiguration.problem("Malformed JSON.") }
        if bytes[position] == 123 {
            position += 1; whitespace(); var keys = Set<String>()
            if bytes[position] == 125 { position += 1; return }
            while true {
                let key = try string(); guard keys.insert(key).inserted else { throw AIIntegrationConfiguration.problem("Duplicate JSON key: manual repair required.") }
                whitespace(); position += 1; try value(); whitespace()
                if bytes[position] == 125 { position += 1; return }; position += 1
            }
        } else if bytes[position] == 91 {
            position += 1; whitespace(); if bytes[position] == 93 { position += 1; return }
            while true { try value(); whitespace(); if bytes[position] == 93 { position += 1; return }; position += 1 }
        } else if bytes[position] == 34 { _ = try string() }
        else { while position < bytes.count && ![9,10,13,32,44,93,125].contains(bytes[position]) { position += 1 } }
    }
}

/// A deliberately bounded grammar (single-line TOML only), not a lossy TOML
/// serializer. Unsupported syntax remains untouched and requires manual setup.
private struct TOMLValueValidator {
    var bytes: [UInt8]; var position = 0
    mutating func whitespace() { while position < bytes.count && [9, 32].contains(bytes[position]) { position += 1 } }
    mutating func validate() throws {
        try value(); whitespace()
        guard position == bytes.count || bytes[position] == 35 else { throw invalid() }
    }
    func invalid() -> RecoveryError { AIIntegrationConfiguration.problem("Malformed or unsupported TOML value; manual setup required.") }
    mutating func value() throws {
        whitespace(); guard position < bytes.count else { throw invalid() }
        let first = bytes[position]
        if first == 34 || first == 39 { try string(); return }
        if first == 91 {
            position += 1; whitespace()
            if position < bytes.count && bytes[position] == 93 { position += 1; return }
            while true {
                try value(); whitespace(); guard position < bytes.count else { throw invalid() }
                if bytes[position] == 93 { position += 1; return }
                guard bytes[position] == 44 else { throw invalid() }; position += 1; whitespace()
                if position < bytes.count && bytes[position] == 93 { position += 1; return }
            }
        }
        if first == 123 {
            position += 1; whitespace(); var keys = Set<String>()
            if position < bytes.count && bytes[position] == 125 { position += 1; return }
            while true {
                whitespace(); let start = position
                if position < bytes.count && [34,39].contains(bytes[position]) { try string() }
                else { while position < bytes.count && (bytes[position] == 45 || bytes[position] == 95 || (48...57).contains(bytes[position]) || (65...90).contains(bytes[position]) || (97...122).contains(bytes[position])) { position += 1 } }
                let key = String(decoding: bytes[start..<position], as: UTF8.self).replacingOccurrences(of: "\"", with: "").replacingOccurrences(of: "'", with: "")
                whitespace(); guard !key.isEmpty, !key.contains("\\"), keys.insert(key).inserted, position < bytes.count, bytes[position] == 61 else { throw invalid() }
                position += 1; try value(); whitespace(); guard position < bytes.count else { throw invalid() }
                if bytes[position] == 125 { position += 1; return }
                guard bytes[position] == 44 else { throw invalid() }; position += 1
            }
        }
        let start = position
        while position < bytes.count && ![9,32,35,44,93,125].contains(bytes[position]) { position += 1 }
        let token = String(decoding: bytes[start..<position], as: UTF8.self)
        guard token.range(of: "^(?:true|false|[-+]?(?:inf|nan)|[-+]?(?:0|[1-9][0-9_]*)(?:\\.[0-9][0-9_]*)?(?:[eE][-+]?[0-9][0-9_]*)?|0[xX][0-9A-Fa-f_]+|0[oO][0-7_]+|0[bB][01_]+|[0-9]{4}-[0-9]{2}-[0-9]{2}(?:[Tt][0-9:.+-]+[Zz]?)?|[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?)$", options: .regularExpression) != nil else { throw invalid() }
    }
    mutating func string() throws {
        let quote = bytes[position]; position += 1
        while position < bytes.count {
            let byte = bytes[position]; position += 1
            if byte == quote { return }
            if byte == 92 && quote == 34 {
                guard position < bytes.count else { throw invalid() }
                let escape = bytes[position]; position += 1
                if escape == 117 || escape == 85 {
                    let count = escape == 117 ? 4 : 8
                    guard position + count <= bytes.count else { throw invalid() }
                    for hex in bytes[position..<(position + count)] { guard (48...57).contains(hex) || (65...70).contains(hex) || (97...102).contains(hex) else { throw invalid() } }
                    position += count
                } else if ![34,92,98,116,110,102,114].contains(escape) { throw invalid() }
            }
        }
        throw invalid()
    }
}
