import Foundation
import ThingtimeRecoveryCore

// No shell evaluation or discovered client execution. The same engine serves
// the UI, scheduled job and isolated acceptance harness.
do {
    var args = Array(CommandLine.arguments.dropFirst())
    let command = args.first ?? "scan"
    if !args.isEmpty { args.removeFirst() }
    var home = FileManager.default.homeDirectoryForCurrentUser
    let executable = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL
    var bundle = executable.deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("Resources/AIIntegrationBundle")
    var targetID: String?
    var isolatedHome = false
    var explicitBundle = false
    while !args.isEmpty {
        let option = args.removeFirst()
        guard !args.isEmpty else { throw RecoveryError.operationFailed("Missing argument for \(option)") }
        let value = args.removeFirst()
        switch option {
        case "--home":
            guard value.hasPrefix("/") else { throw RecoveryError.operationFailed("--home must be an absolute path.") }
            home = URL(fileURLWithPath: value, isDirectory: true); isolatedHome = true
        case "--bundle": bundle = URL(fileURLWithPath: value, isDirectory: true); explicitBundle = true
        case "--target": targetID = value
        default: throw RecoveryError.operationFailed("Unknown option \(option)")
        }
    }
    func makeManager(_ source: URL) -> AIIntegrationManager {
        AIIntegrationManager(homeDirectory: home, bundleDirectory: source,
            applicationDirectories: isolatedHome ? [home.appendingPathComponent("Applications")] : nil,
            environment: isolatedHome ? ["PATH": home.appendingPathComponent("bin").path, "CODEX_HOME": home.appendingPathComponent(".codex").path] : ProcessInfo.processInfo.environment)
    }
    func needsSchedule(_ state: AIIntegrationState) -> Bool {
        state.automaticSetup || state.targets.contains { $0.installedVersion != nil && $0.autoUpdate && $0.pinnedVersion == nil }
    }
    var warnings: [AIIntegrationResult] = []
    if !isolatedHome && !explicitBundle {
        let source = AIIntegrationUpdateSource(homeDirectory: home)
        do { if let cached = try source.currentBundle() { bundle = cached } }
        catch { warnings.append(.init(targetID: "update-source", success: false, message: error.localizedDescription)) }
        if (command == "sync" && needsSchedule(makeManager(bundle).state())) || command == "enable" {
            do { if let latest = try await source.refresh() { bundle = latest } }
            catch { warnings.append(.init(targetID: "update-source", success: false, message: error.localizedDescription)) }
        }
    }
    let manager = makeManager(bundle)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    func output<T: Encodable>(_ value: T) throws {
        FileHandle.standardOutput.write(try encoder.encode(value))
        FileHandle.standardOutput.write(Data("\n".utf8))
    }
    switch command {
    case "scan": try output(manager.discover())
    case "state": try output(manager.state())
    case "sync": try output(manager.sync() + warnings)
    case "enable", "disable":
        let previous = manager.state().automaticSetup
        try manager.setAutomaticSetup(command == "enable")
        do {
            if !isolatedHome { try AIIntegrationBackgroundService(homeDirectory: home).setEnabled(needsSchedule(manager.state())) }
        } catch { try? manager.setAutomaticSetup(previous); throw error }
        try output(command == "enable" ? manager.sync() + warnings : warnings)
    case "install", "uninstall", "rollback":
        guard let target = manager.discover().first(where: { $0.id == targetID }) else {
            throw RecoveryError.operationFailed("Choose an exact discovered --target ID.")
        }
        var result: AIIntegrationResult
        if command == "install" { result = try manager.install(target: target) }
        else if command == "uninstall" { result = try manager.uninstall(target: target) }
        else { result = try manager.rollback(target: target) }
        // Client files and receipts are already committed. A launchd failure
        // cannot undo that successful operation or make its report disappear.
        if !isolatedHome {
            do {
                try AIIntegrationBackgroundService(homeDirectory: home).setEnabled(needsSchedule(manager.state()))
            } catch {
                warnings.append(.init(targetID: "background-schedule", success: false,
                    message: "Integration changes succeeded, but the background schedule could not be reconciled: \(error.localizedDescription)"))
            }
        }
        for warning in warnings { result.message += "\nWarning: " + warning.message }
        try output(result)
    default:
        throw RecoveryError.operationFailed("Use scan, state, sync, enable, disable, install, uninstall or rollback; optional --home, --bundle and --target.")
    }
} catch {
    FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
    exit(1)
}
