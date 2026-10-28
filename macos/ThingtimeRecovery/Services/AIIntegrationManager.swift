import Foundation
import CryptoKit
import Darwin

/// Installs only the integration payload shipped with Recovery. All destination
/// writes are serialized and constrained to explicit discovered target paths.
public final class AIIntegrationManager: @unchecked Sendable {
    internal let homeDirectory: URL
    internal let bundleDirectory: URL
    internal let applicationDirectories: [URL]
    internal let environment: [String: String]
    internal let includesSystemBinaryDirectories: Bool
    private let fm = FileManager.default
    private var pendingUndo: (() -> Void)?
    private var storage: URL { homeDirectory.appendingPathComponent("Library/Application Support/com.thingtime.desktop/ai-integrations") }
    private struct Receipt: Codable {
        var version: String
        var files: [String: Data]
        var hashes: [String: String]
        var entry: Data
        var configPath: String
        var skillPath: String?
        var originalBlankConfiguration: Data? = nil
    }
    private struct Preference: Codable { var autoUpdate = true; var pinnedVersion: String? }
    private struct Database: Codable {
        var format = 1
        var automaticSetup = false
        var preferences: [String: Preference] = [:]
        var receipts: [String: Receipt] = [:]
        var history: [String: [Receipt]] = [:]
    }
    private struct Payload { var version: String; var files: [String: Data] }
    public init(homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser, bundleDirectory: URL, applicationDirectories: [URL]? = nil, environment: [String: String] = ProcessInfo.processInfo.environment) {
        self.homeDirectory = homeDirectory.standardizedFileURL
        self.bundleDirectory = bundleDirectory.standardizedFileURL
        self.applicationDirectories = applicationDirectories ?? [URL(fileURLWithPath: "/Applications"), homeDirectory.appendingPathComponent("Applications")]
        self.environment = environment
        self.includesSystemBinaryDirectories = applicationDirectories == nil
    }
    internal static func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    public func discover() -> [AIIntegrationTarget] { state().targets }
    public func state() -> AIIntegrationState {
        var diagnostics: [String] = []
        let database: Database
        do { database = try load() } catch { database = Database(); diagnostics.append(error.localizedDescription) }
        let payload: Payload?
        do { payload = try package() } catch { payload = nil; diagnostics.append(error.localizedDescription) }
        let targets = candidates().map { candidate -> AIIntegrationTarget in
            var target = candidate
            target.latestVersion = payload?.version
            let pref = database.preferences[target.id] ?? Preference()
            target.autoUpdate = pref.autoUpdate; target.pinnedVersion = pref.pinnedVersion
            do {
                if let receipt = database.receipts[target.id] {
                    target.installedVersion = receipt.version
                    try check(target, receipt: receipt)
                    if let payload, Self.compareVersions(payload.version, receipt.version) == .orderedDescending {
                        target.status = .updateAvailable
                    } else {
                        if let payload, Self.compareVersions(payload.version, receipt.version) == .orderedSame, currentFiles(payload, for: target).mapValues(Self.hash) != receipt.hashes { throw failure("Bundled content changed without a version change; refusing replacement.") }
                        target.status = .installed
                    }
                } else if target.supportsMCP {
                    _ = try AIIntegrationConfiguration.transform(try readConfig(target), kind: target.kind, oldEntry: nil, removing: false)
                    if let path = target.skillPath, fm.fileExists(atPath: path) { throw failure("Existing Thingtime skill directory is not owned by Recovery.") }
                }
                if !diagnostics.isEmpty && target.supportsMCP { throw failure(diagnostics.joined(separator: " ")) }
            } catch { target.status = .conflict; target.conflictReason = error.localizedDescription }
            return target
        }
        return AIIntegrationState(automaticSetup: database.automaticSetup, targets: targets, latestVersion: payload?.version, diagnostics: diagnostics)
    }
    @discardableResult public func install(target: AIIntegrationTarget) throws -> AIIntegrationResult {
        try locked { database in
            let current = try verified(target)
            let payload = try package()
            if let pin = database.preferences[current.id]?.pinnedVersion, pin != payload.version { throw failure("Pinned version \(pin) differs from the bundled version; preserve the installed version or remove the pin.") }
            let previous = database.receipts[current.id]
            if let previous {
                try check(current, receipt: previous)
                guard Self.compareVersions(payload.version, previous.version) != .orderedAscending else { throw failure("Bundled version is older than the installed integration. Use explicit rollback instead.") }
                if Self.compareVersions(payload.version, previous.version) == .orderedSame && currentFiles(payload, for: current).mapValues(Self.hash) != previous.hashes { throw failure("Bundled content changed without a version change.") }
            }
            let original = try readConfig(current)
            let blank = previous?.originalBlankConfiguration ?? (current.kind != .codex && original.map(AIIntegrationConfiguration.isBlankJSON) == true ? original : nil)
            let receipt = Receipt(version: payload.version, files: current.supportsSkills ? payload.files : [:], hashes: current.supportsSkills ? payload.files.mapValues(Self.hash) : [:], entry: try AIIntegrationConfiguration.ownedEntry(kind: current.kind), configPath: current.configurationPath!, skillPath: current.skillPath, originalBlankConfiguration: blank)
            try apply(current, previous: previous, next: receipt, database: &database)
            if let previous, previous.version != receipt.version || previous.hashes != receipt.hashes { database.history[current.id, default: []].append(previous) }
            database.receipts[current.id] = receipt
            var preference = database.preferences[current.id] ?? Preference(); if previous == nil { preference.autoUpdate = true }; database.preferences[current.id] = preference
            return AIIntegrationResult(targetID: current.id, success: true, message: "Installed Thingtime \(payload.version). Restart or reconnect the AI client, then authorize its Thingtime connection.")
        }
    }
    @discardableResult public func uninstall(target: AIIntegrationTarget) throws -> AIIntegrationResult {
        try locked { database in
            let current = try verified(target)
            guard let receipt = database.receipts[current.id] else { throw failure("Recovery does not own an installation for this target.") }
            try check(current, receipt: receipt)
            try apply(current, previous: receipt, next: nil, database: &database)
            database.history[current.id, default: []].append(receipt)
            database.receipts.removeValue(forKey: current.id)
            var preference = database.preferences[current.id] ?? Preference(); preference.autoUpdate = false; database.preferences[current.id] = preference
            return AIIntegrationResult(targetID: current.id, success: true, message: "Removed Recovery-owned Thingtime integration. Other client settings were preserved.")
        }
    }
    @discardableResult public func rollback(target: AIIntegrationTarget) throws -> AIIntegrationResult {
        try locked { database in
            let current = try verified(target)
            guard let previous = database.receipts[current.id], let older = database.history[current.id]?.last else { throw failure("No installed version with a previous Recovery receipt is available.") }
            try check(current, receipt: previous)
            guard older.configPath == current.configurationPath, older.skillPath == current.skillPath,
                  older.hashes == older.files.mapValues(Self.hash),
                  older.originalBlankConfiguration.map(AIIntegrationConfiguration.isBlankJSON) != false else { throw failure("Archived rollback receipt integrity check failed.") }
            try apply(current, previous: previous, next: older, database: &database)
            database.history[current.id]?.removeLast()
            database.receipts[current.id] = older
            // Rollback is durable: automatic maintenance must not immediately undo it.
            var pref = database.preferences[current.id] ?? Preference(); pref.pinnedVersion = older.version; database.preferences[current.id] = pref
            return AIIntegrationResult(targetID: current.id, success: true, message: "Restored Thingtime \(older.version) and pinned it.")
        }
    }
    public func setAutoUpdate(target: AIIntegrationTarget, enabled: Bool) throws {
        try locked { database in
            let current = try verified(target)
            var pref = database.preferences[current.id] ?? Preference(); pref.autoUpdate = enabled; database.preferences[current.id] = pref
        }
    }
    public func setPinned(target: AIIntegrationTarget, version: String?) throws {
        try locked { database in
            let current = try verified(target)
            var pref = database.preferences[current.id] ?? Preference(); pref.pinnedVersion = version?.trimmingCharacters(in: .whitespacesAndNewlines); if pref.pinnedVersion == "" { pref.pinnedVersion = nil }; database.preferences[current.id] = pref
        }
    }
    public func setAutomaticSetup(_ enabled: Bool) throws { try locked { $0.automaticSetup = enabled } }
    public func sync() -> [AIIntegrationResult] {
        let snapshot = state()
        guard snapshot.diagnostics.isEmpty else { return [AIIntegrationResult(targetID: "maintenance", success: false, message: snapshot.diagnostics.joined(separator: " "))] }
        return snapshot.targets.compactMap { target in
            guard target.supportsMCP, target.autoUpdate, target.pinnedVersion == nil,
                  (target.status == .updateAvailable || (snapshot.automaticSetup && target.status == .available)) else { return nil }
            do { return try install(target: target) } catch { return AIIntegrationResult(targetID: target.id, success: false, message: error.localizedDescription) }
        }
    }
    private func verified(_ target: AIIntegrationTarget) throws -> AIIntegrationTarget {
        guard let current = candidates().first(where: { $0.id == target.id }), current.supportsMCP,
              current.configurationPath == target.configurationPath, current.skillPath == target.skillPath else { throw failure("Target changed or has no verified automatic installation contract.") }
        return current
    }
    private func currentFiles(_ payload: Payload, for target: AIIntegrationTarget) -> [String: Data] { target.supportsSkills ? payload.files : [:] }
    internal static func compareVersions(_ lhs: String, _ rhs: String) -> ComparisonResult {
        let l = lhs.split(separator: "+", maxSplits: 1)[0].split(separator: "-", maxSplits: 1)
        let r = rhs.split(separator: "+", maxSplits: 1)[0].split(separator: "-", maxSplits: 1)
        let ln = l[0].split(separator: ".").compactMap { Int($0) }, rn = r[0].split(separator: ".").compactMap { Int($0) }
        for index in 0..<max(ln.count, rn.count) {
            let a = index < ln.count ? ln[index] : 0, b = index < rn.count ? rn[index] : 0
            if a != b { return a < b ? .orderedAscending : .orderedDescending }
        }
        if l.count != r.count { return l.count > r.count ? .orderedAscending : .orderedDescending }
        if l.count == 2 {
            let la = l[1].split(separator: "."), ra = r[1].split(separator: ".")
            for index in 0..<min(la.count, ra.count) {
                if la[index] == ra[index] { continue }
                if let a = Int(la[index]), let b = Int(ra[index]) { return a < b ? .orderedAscending : .orderedDescending }
                if Int(la[index]) != nil { return .orderedAscending }; if Int(ra[index]) != nil { return .orderedDescending }
                return la[index] < ra[index] ? .orderedAscending : .orderedDescending
            }
            if la.count != ra.count { return la.count < ra.count ? .orderedAscending : .orderedDescending }
        }
        let lBuild = lhs.components(separatedBy: "+"), rBuild = rhs.components(separatedBy: "+")
        if lBuild.count == 2, rBuild.count == 2,
           lBuild[1].range(of: "^codex\\.[0-9]{14}$", options: .regularExpression) != nil,
           rBuild[1].range(of: "^codex\\.[0-9]{14}$", options: .regularExpression) != nil,
           lBuild[1] != rBuild[1] { return lBuild[1] < rBuild[1] ? .orderedAscending : .orderedDescending }
        return .orderedSame
    }
    private func package() throws -> Payload {
        try safe(bundleDirectory, anchor: bundleDirectory)
        let metadataURL = bundleDirectory.appendingPathComponent(".codex-plugin/plugin.json")
        try safe(metadataURL, anchor: bundleDirectory)
        guard let metadata = try JSONSerialization.jsonObject(with: Data(contentsOf: metadataURL)) as? [String: Any], metadata["name"] as? String == "thingtime", let version = metadata["version"] as? String, version.range(of: "^[0-9]+\\.[0-9]+\\.[0-9]+(?:[-+][A-Za-z0-9.+-]+)?$", options: .regularExpression) != nil else { throw failure("Bundled Thingtime plugin metadata is invalid.") }
        let mcp = bundleDirectory.appendingPathComponent(".mcp.json"); try safe(mcp, anchor: bundleDirectory)
        guard let root = try JSONSerialization.jsonObject(with: Data(contentsOf: mcp)) as? [String: Any], let servers = root["mcpServers"] as? [String: Any], let server = servers["thingtime"] as? [String: Any], server["url"] as? String == AIIntegrationConfiguration.endpoint else { throw failure("Bundled connector does not match the approved Thingtime endpoint.") }
        let source = bundleDirectory.appendingPathComponent("skills/thingtime")
        let files = try tree(source, anchor: bundleDirectory)
        let manifestURL = bundleDirectory.appendingPathComponent("bundle-manifest.json")
        if fm.fileExists(atPath: manifestURL.path) {
            try safe(manifestURL, anchor: bundleDirectory)
            guard let manifest = try JSONSerialization.jsonObject(with: Data(contentsOf: manifestURL)) as? [String: Any], manifest["version"] as? String == version, let hashes = manifest["sha256"] as? [String: String] else { throw failure("Bundled integration hash manifest is invalid.") }
            var actual = files.reduce(into: [String: String]()) { $0["skills/thingtime/" + $1.key] = Self.hash($1.value) }
            actual[".codex-plugin/plugin.json"] = Self.hash(try Data(contentsOf: metadataURL))
            actual[".mcp.json"] = Self.hash(try Data(contentsOf: mcp))
            guard hashes == actual else { throw failure("Bundled integration hash manifest does not match its content.") }
        }
        guard files["SKILL.md"] != nil else { throw failure("Bundled Thingtime skill is missing.") }
        return Payload(version: version, files: files)
    }
    private func load() throws -> Database {
        try safe(storage, anchor: homeDirectory)
        let url = storage.appendingPathComponent("state.json"); try safe(url, anchor: homeDirectory)
        guard fm.fileExists(atPath: url.path) else { return Database() }
        let result = try JSONDecoder().decode(Database.self, from: Data(contentsOf: url))
        guard result.format == 1 else { throw failure("Unsupported integration receipt format.") }
        return result
    }
    private func locked<T>(_ operation: (inout Database) throws -> T) throws -> T {
        try safe(storage, anchor: homeDirectory)
        try fm.createDirectory(at: storage, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: storage.path)
        let lockURL = storage.appendingPathComponent("maintenance.lock"); try safe(lockURL, anchor: homeDirectory)
        let descriptor = open(lockURL.path, O_CREAT | O_RDWR | O_NOFOLLOW, 0o600)
        guard descriptor >= 0 else { throw failure("Cannot open the integration maintenance lock.") }
        defer { _ = flock(descriptor, LOCK_UN); close(descriptor) }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else { throw failure("Another Recovery integration operation is active.") }
        var database = try load()
        pendingUndo = nil
        defer { pendingUndo = nil }
        do {
            let value = try operation(&database)
            try write(try JSONEncoder().encode(database), to: storage.appendingPathComponent("state.json"), anchor: homeDirectory)
            return value
        } catch { pendingUndo?(); throw error }
    }
    private func readConfig(_ target: AIIntegrationTarget) throws -> Data? {
        guard let path = target.configurationPath else { return nil }
        let url = URL(fileURLWithPath: path); try safe(url, anchor: destinationAnchor(url))
        return fm.fileExists(atPath: path) ? try Data(contentsOf: url) : nil
    }
    private func check(_ target: AIIntegrationTarget, receipt: Receipt) throws {
        guard receipt.configPath == target.configurationPath, receipt.skillPath == target.skillPath,
              receipt.hashes == receipt.files.mapValues(Self.hash),
              receipt.originalBlankConfiguration.map(AIIntegrationConfiguration.isBlankJSON) != false else { throw failure("Installation receipt integrity check failed.") }
        _ = try AIIntegrationConfiguration.transform(try readConfig(target), kind: target.kind, oldEntry: receipt.entry, removing: true)
        if let path = receipt.skillPath {
            let directory = URL(fileURLWithPath: path)
            guard try tree(directory, anchor: destinationAnchor(directory)).mapValues(Self.hash) == receipt.hashes else { throw failure("Thingtime skill files were modified externally; preserving local changes.") }
        }
    }
    private func apply(_ target: AIIntegrationTarget, previous: Receipt?, next: Receipt?, database: inout Database) throws {
        let config = URL(fileURLWithPath: target.configurationPath!)
        let oldConfig = try readConfig(target)
        var newConfig = try AIIntegrationConfiguration.transform(oldConfig, kind: target.kind, oldEntry: previous?.entry, removing: next == nil)
        if next == nil, target.kind != .codex, let blank = previous?.originalBlankConfiguration,
           let transformed = newConfig, let root = try JSONSerialization.jsonObject(with: transformed) as? [String: Any], root.isEmpty {
            // Restore exact pre-install blank bytes only when no independently
            // added settings remain after removing the managed entry.
            newConfig = blank
        }
        if let next, next.entry != (try AIIntegrationConfiguration.ownedEntry(kind: target.kind)) {
            throw failure("Archived MCP receipt has an unsupported endpoint contract.")
        }
        let directory = target.skillPath.map { URL(fileURLWithPath: $0) }
        if previous == nil, let directory, fm.fileExists(atPath: directory.path) { throw failure("Existing Thingtime skill directory is not owned by Recovery.") }
        if previous == nil && next == nil { newConfig = oldConfig }
        // The private backup is intentionally retained even when a write fails.
        let backup = storage.appendingPathComponent("backups/\(UUID().uuidString)")
        try safe(backup, anchor: homeDirectory); try fm.createDirectory(at: backup, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        if let oldConfig { try write(oldConfig, to: backup.appendingPathComponent("configuration.backup"), anchor: homeDirectory) }
        if let previous { try write(try JSONEncoder().encode(previous), to: backup.appendingPathComponent("receipt.json"), anchor: homeDirectory) }
        var skillChanged = false
        do {
            guard try readConfig(target) == oldConfig else { throw failure("Client configuration changed during installation; retry after its editor finishes.") }
            if let previous { try check(target, receipt: previous) }
            else if let directory, fm.fileExists(atPath: directory.path) { throw failure("Skill directory appeared during installation; preserving it.") }
            if let directory { try replaceTree(directory, files: next?.files, anchor: destinationAnchor(directory)); skillChanged = true }
            guard try readConfig(target) == oldConfig else { throw failure("Client configuration changed during installation; preserving the newer configuration.") }
            try write(newConfig, to: config, anchor: destinationAnchor(config))
            pendingUndo = { [self] in
                if let directory, skillChanged, matchesTree(directory, files: next?.files) { try? replaceTree(directory, files: previous?.files, anchor: destinationAnchor(directory)) }
                if (try? readConfig(target)) == newConfig { try? write(oldConfig, to: config, anchor: destinationAnchor(config)) }
            }
        } catch {
            // Best-effort restoration never follows a newly introduced symlink.
            if let directory, skillChanged, matchesTree(directory, files: next?.files) { try? replaceTree(directory, files: previous?.files, anchor: destinationAnchor(directory)) }
            // A failed configuration write is atomic; never overwrite a concurrent client edit.
            if (try? readConfig(target)) == newConfig { try? write(oldConfig, to: config, anchor: destinationAnchor(config)) }
            throw error
        }
    }
    private func matchesTree(_ directory: URL, files: [String: Data]?) -> Bool {
        if let files { return (try? tree(directory, anchor: destinationAnchor(directory)).mapValues(Self.hash)) == files.mapValues(Self.hash) }
        return !fm.fileExists(atPath: directory.path)
    }
    private func replaceTree(_ destination: URL, files: [String: Data]?, anchor: URL) throws {
        try safe(destination, anchor: anchor)
        if let files {
            for relative in files.keys { guard !relative.hasPrefix("/"), !relative.split(separator: "/").contains("..") else { throw failure("Unsafe skill manifest path.") } }
        }
        let staging = destination.deletingLastPathComponent().appendingPathComponent(".thingtime-stage-" + UUID().uuidString)
        try safe(staging, anchor: anchor)
        try fm.createDirectory(at: staging, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        defer { try? fm.removeItem(at: staging) }
        for (relative, data) in files ?? [:] { try write(data, to: staging.appendingPathComponent(relative), anchor: anchor) }
        try safe(destination, anchor: anchor)
        if fm.fileExists(atPath: destination.path) {
            // Darwin swaps both directories atomically. The old tree then lives at
            // our private staging name until this operation has completed.
            guard renameatx_np(AT_FDCWD, staging.path, AT_FDCWD, destination.path, UInt32(RENAME_SWAP)) == 0 else { throw failure("Cannot atomically replace the managed skill directory.") }
            if files == nil { try fm.removeItem(at: destination) }
        } else if files != nil {
            guard rename(staging.path, destination.path) == 0 else { throw failure("Cannot activate the staged skill directory.") }
        }
    }
    private func tree(_ directory: URL, anchor: URL) throws -> [String: Data] {
        try safe(directory, anchor: anchor)
        guard fm.fileExists(atPath: directory.path) else { throw failure("Skill directory is missing.") }
        var files: [String: Data] = [:]
        guard let enumerator = fm.enumerator(at: directory, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey], options: []) else { throw failure("Cannot inspect skill directory.") }
        for case let url as URL in enumerator {
            try safe(url, anchor: anchor)
            let attributes = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
            if attributes.isSymbolicLink == true { throw failure("Symbolic links are not accepted in an integration payload.") }
            if attributes.isRegularFile == true { files[String(url.standardizedFileURL.path.dropFirst(directory.standardizedFileURL.path.count + 1))] = try Data(contentsOf: url) }
        }
        return files
    }
    private func destinationAnchor(_ url: URL) -> URL {
        if url.path.hasPrefix(homeDirectory.path + "/") { return homeDirectory }
        // Explicit absolute custom homes are the only destination roots outside home.
        for key in ["CODEX_HOME", "CLAUDE_CONFIG_DIR"] {
            if let value = environment[key], value.hasPrefix("/"), url.path.hasPrefix(URL(fileURLWithPath: value).standardizedFileURL.path + "/") { return URL(fileURLWithPath: value).standardizedFileURL }
        }
        return homeDirectory
    }
    func safe(_ url: URL, anchor: URL) throws {
        let path = url.standardizedFileURL.path, root = anchor.standardizedFileURL.path
        guard path == root || path.hasPrefix(root + "/") else { throw failure("Integration destination escapes its approved root.") }
        var cursor = URL(fileURLWithPath: root)
        // Resolve the root itself too; custom roots cannot redirect writes.
        let rootValues = try? cursor.resourceValues(forKeys: [.isSymbolicLinkKey]); if rootValues?.isSymbolicLink == true { throw failure("Symbolic-link integration root refused.") }
        for part in path.dropFirst(root.count).split(separator: "/") {
            cursor.appendPathComponent(String(part))
            let values = try? cursor.resourceValues(forKeys: [.isSymbolicLinkKey]); if values?.isSymbolicLink == true { throw failure("Symbolic-link integration path refused.") }
        }
        // Reject symlink ancestors of explicit roots, without reading their contents.
        var parent = anchor.deletingLastPathComponent()
        while parent.path != "/" {
            if (try? parent.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) == true {
                let systemAlias = (parent.path == "/var" && ["private/var", "/private/var"].contains((try? fm.destinationOfSymbolicLink(atPath: parent.path)) ?? "")) || (parent.path == "/tmp" && ["private/tmp", "/private/tmp"].contains((try? fm.destinationOfSymbolicLink(atPath: parent.path)) ?? ""))
                if !systemAlias { throw failure("Symbolic-link ancestor refused.") }
            }
            parent.deleteLastPathComponent()
        }
    }
    private func write(_ data: Data?, to url: URL, anchor: URL) throws {
        try safe(url, anchor: anchor)
        if let data {
            try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            try data.write(to: url, options: .atomic)
            try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        } else if fm.fileExists(atPath: url.path) { try fm.removeItem(at: url) }
    }
    private func failure(_ message: String) -> RecoveryError { .operationFailed(message) }
}
