import Foundation
import Darwin

/// The installed, signed helper owns periodic work; launchd never downloads or
/// executes vendor binaries. Recovery's UI remains optional after setup.
public struct AIIntegrationBackgroundService {
    public static let label = "com.thingtime.recovery.ai-integrations"
    public let homeDirectory: URL

    public init(homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser) {
        self.homeDirectory = homeDirectory.standardizedFileURL
    }

    public var plistURL: URL {
        homeDirectory.appendingPathComponent("Library/LaunchAgents/\(Self.label).plist")
    }

    public var isEnabled: Bool { (try? ownedJob()) != nil }

    private var helperURL: URL { homeDirectory.appendingPathComponent("Applications/Thingtime Recovery.app/Contents/Helpers/ThingtimeIntegrationManager") }

    private func safePath(_ url: URL) throws {
        guard url.standardizedFileURL.path.hasPrefix(homeDirectory.path + "/") else {
            throw RecoveryError.operationFailed("The automatic setup path is outside this user's home.")
        }
        var path = url
        while path.path != homeDirectory.deletingLastPathComponent().path {
            var entry = stat()
            if lstat(path.path, &entry) == 0 && (entry.st_mode & S_IFMT) == S_IFLNK {
                throw RecoveryError.operationFailed("The automatic setup path is a symbolic link. It was left unchanged.")
            }
            if path == homeDirectory { break }
            path.deleteLastPathComponent()
        }
    }

    private func ownedJob() throws -> Data? {
        try safePath(plistURL)
        guard FileManager.default.fileExists(atPath: plistURL.path) else { return nil }
        let data = try Data(contentsOf: plistURL)
        guard let job = try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
              job["Label"] as? String == Self.label,
              job["ProgramArguments"] as? [String] == [helperURL.path, "sync"],
              Set(job.keys).isSubset(of: ["Label", "ProgramArguments", "StartInterval", "RunAtLoad", "ProcessType", "ThrottleInterval", "LowPriorityIO"]) else {
            throw RecoveryError.operationFailed("An existing background job has different settings. Recovery left it unchanged.")
        }
        return data
    }

    public func setEnabled(_ enabled: Bool) throws {
        let fm = FileManager.default
        let app = homeDirectory.appendingPathComponent("Applications/Thingtime Recovery.app")
        let helper = helperURL
        let domain = "gui/\(getuid())"
        let prior = try ownedJob()
        let loaded = (try? ProcessExecution.run("/bin/launchctl", arguments: ["print", "\(domain)/\(Self.label)"], label: "Read automatic setup job")) != nil
        guard prior != nil || !loaded else {
            throw RecoveryError.operationFailed("A background job with this name is already loaded without a Recovery-owned definition. It was left unchanged.")
        }
        if !enabled {
            if prior != nil {
                if loaded {
                    try ProcessExecution.run("/bin/launchctl", arguments: ["bootout", "\(domain)/\(Self.label)"], label: "Stop automatic integration setup")
                }
                try safePath(plistURL)
                try fm.removeItem(at: plistURL)
            }
            return
        }
        try safePath(helper)
        guard fm.isExecutableFile(atPath: helper.path) else {
            throw RecoveryError.operationFailed("Install this Recovery build in Applications before enabling background updates.")
        }
        try ProcessExecution.run("/usr/bin/codesign", arguments: ["--verify", "--deep", "--strict", app.path], label: "Verify Recovery background helper")
        guard Bundle(url: app)?.bundleIdentifier == "com.thingtime.desktop.recovery" else {
            throw RecoveryError.operationFailed("The installed app is not Thingtime Recovery.")
        }
        _ = try BundleVerifier.signingContext(for: app)
        let parent = plistURL.deletingLastPathComponent()
        try safePath(parent)
        let job: [String: Any] = [
            "Label": Self.label,
            "ProgramArguments": [helper.path, "sync"],
            "StartInterval": 3600,
            "RunAtLoad": true,
            "ProcessType": "Background",
            "ThrottleInterval": 300,
            "LowPriorityIO": true
        ]
        let data = try PropertyListSerialization.data(fromPropertyList: job, format: .xml, options: 0)
        try fm.createDirectory(at: parent, withIntermediateDirectories: true)
        if prior == data,
           (try? ProcessExecution.run("/bin/launchctl", arguments: ["print", "\(domain)/\(Self.label)"], label: "Read automatic setup job")) != nil { return }
        try safePath(plistURL)
        guard try ownedJob() == prior else { throw RecoveryError.operationFailed("The background job changed during setup. Retry after reviewing its settings.") }
        try data.write(to: plistURL, options: .atomic)
        try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: plistURL.path)
        _ = try? ProcessExecution.run("/bin/launchctl", arguments: ["bootout", "\(domain)/\(Self.label)"], label: "Reload automatic setup job")
        do {
            try ProcessExecution.run("/bin/launchctl", arguments: ["bootstrap", domain, plistURL.path], label: "Enable automatic integration setup")
        } catch {
            if let prior {
                try prior.write(to: plistURL, options: .atomic)
                do { try ProcessExecution.run("/bin/launchctl", arguments: ["bootstrap", domain, plistURL.path], label: "Restore prior automatic setup job") }
                catch { throw RecoveryError.operationFailed("The background schedule could not be loaded or restored. Its previous settings remain saved; automatic setup needs a retry.") }
            } else { try fm.removeItem(at: plistURL) }
            throw error
        }
    }
}
